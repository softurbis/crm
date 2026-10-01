import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useMsg } from '../lib/saveFx'
import { avisar, pedirDatos } from '../lib/dialogos'
import { useAuth } from '../context/AuthContext'
import ContratoModal from '../components/ContratoModal'
import ContratoDeVenta from '../components/ContratoDeVenta'
import LoteLink from '../components/LoteLink'
import Paginador, { usePaginacion } from '../components/Paginador'
import { VARIABLES, BLOQUES, DEFAULT_TEMPLATE, COLS_VENTA_CONTRATO } from '../lib/contrato'
import { fechaPe, cobradoDeVenta } from '../lib/lotes'
import { useProject, ProjectPicker } from '../context/ProjectContext'

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const EST = {
  en_proceso: { lbl: 'EN PROCESO', color: '#7ba7f7' },
  pagado: { lbl: 'PAGADO 100%', color: '#4bb96a' },
  expropiado: { lbl: 'EXPROPIADO', color: '#b58ad9' },
  anulado: { lbl: 'ANULADO', color: '#c94f4f' },
}
const VIVA = ['en_proceso', 'pagado']     // las que llevan contrato

// VENTAS Y CONTRATOS, EN UNA SOLA LISTA (1 oct 2026). Antes eran dos pantallas con
// casi la misma tabla: "Ventas" (solo mirar: precio, cobrado, saldo) y "Contratos"
// (la misma lista con el contrato firmado). Aquí está todo; el día a día de una venta
// (cobrar, cuotas, documentos) sigue en la ficha del lote, a un clic del lote.
// Las rutas /ventas y /contratos abren esta misma pantalla.
export default function Contracts() {
  const { role, profile, puedeCorregir } = useAuth()   // puedeCorregir = superusuario u operador
  const { pidOp } = useProject()
  const [proyecto, setProyecto] = useState(null)
  const [ventas, setVentas] = useState([])
  const [q, setQ] = useState('')
  const [est, setEst] = useState('todos')
  const [soloSinFirmar, setSoloSinFirmar] = useState(false)
  const [gen, setGen] = useState(null)   // id de la venta cuyo contrato se esta generando
  const [msg, setMsg] = useMsg(null)
  const [tplOpen, setTplOpen] = useState(false)
  const [tplText, setTplText] = useState('')
  const soloMira = ['manager', 'socio'].includes(role)

  async function load() {
    if (!pidOp) return
    const [v, p] = await Promise.all([
      supabase.from('sales')
        .select(COLS_VENTA_CONTRATO + ', installments(amount, amount_paid, status)')
        .eq('lot.project_id', pidOp)
        .order('sale_date', { ascending: false }),
      supabase.from('projects').select('*').eq('id', pidOp).single(),
    ])
    setVentas(v.data || []); setProyecto(p.data || null)
    setTplText((p.data?.contract_template) || DEFAULT_TEMPLATE)
  }
  useEffect(() => { load() }, [pidOp])

  // ?venta=<id>: se llega desde la ficha del lote y se muestra solo esa venta.
  // ?estado=<estado>: se llega desde el Dashboard.
  const [searchParams, setSearchParams] = useSearchParams()
  const soloVenta = searchParams.get('venta')
  const ventaFicha = soloVenta ? ventas.find(v => v.id === soloVenta) : null
  useEffect(() => { const e = searchParams.get('estado'); if (e) setEst(e) }, [searchParams])

  const filtradas = useMemo(() => {
    if (soloVenta) return ventas.filter(v => v.id === soloVenta)
    const t = q.trim().toLowerCase()
    return ventas.filter(v => {
      if (est !== 'todos' && v.status !== est) return false
      if (soloSinFirmar && (v.signed_contract_url || !VIVA.includes(v.status))) return false
      if (!t) return true
      return (v.client?.full_name || '').toLowerCase().includes(t) ||
        (v.co_client?.full_name || '').toLowerCase().includes(t) ||
        (v.client?.doc_number || '').toLowerCase().includes(t) ||
        `${v.lot?.mz}-${v.lot?.lt}`.toLowerCase().includes(t)
    })
  }, [ventas, q, est, soloSinFirmar, soloVenta])
  const pag = usePaginacion(filtradas, 50)

  const tot = filtradas.reduce((s, v) => {
    const c = cobradoDeVenta(v)
    return { precio: s.precio + Number(v.total_sale_price), cobrado: s.cobrado + c.cobrado, saldo: s.saldo + c.saldo }
  }, { precio: 0, cobrado: 0, saldo: 0 })
  const sinFirmar = ventas.filter(v => VIVA.includes(v.status) && !v.signed_contract_url).length

  // corregir la fecha de venta (superusuario): aquí, donde se revisan los contratos,
  // es donde se descubre que la fecha no coincide con el papel firmado.
  async function editarFechaVenta(v) {
    // fecha y motivo en un solo dialogo (antes eran dos ventanas seguidas)
    const datos = await pedirDatos({
      titulo: 'Corregir la fecha de venta',
      mensaje: 'NUEVA FECHA DE VENTA de ' + (v.client?.full_name || 'esta venta') + '.\n\nOJO: no mueve las cuotas del cronograma; solo corrige la fecha del contrato.',
      campos: [
        { clave: 'nueva', etiqueta: 'Nueva fecha de venta', tipo: 'fecha', valor: v.sale_date || '', obligatorio: true },
        { clave: 'motivo', etiqueta: 'Motivo de la correccion (queda en bitacora)', tipo: 'largo', obligatorio: true },
      ],
    })
    if (datos === null) return
    const nueva = datos.nueva
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nueva)) { await avisar('Fecha invalida.'); return }
    if (nueva === v.sale_date) return
    const motivo = datos.motivo
    if (motivo.trim().length < 5) { await avisar('MOTIVO OBLIGATORIO'); return }
    const { error } = await supabase.from('sales').update({ sale_date: nueva }).eq('id', v.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    await supabase.from('activity_log').insert({
      user_id: profile?.id, user_email: profile?.email,
      action: 'UPDATE', entity_type: 'sales', entity_id: v.id,
      details: {
        cambio: 'fecha_venta', lote: (v.lot?.mz || '?') + '-' + (v.lot?.lt || '?'),
        cliente: v.client?.full_name || null, antes: v.sale_date, despues: nueva,
        motivo: motivo.trim().toUpperCase(), project_id: pidOp,
      },
    })
    setMsg({ ok: true, t: 'FECHA DE VENTA CORREGIDA: ' + (v.sale_date || '?') + ' → ' + nueva + '. MOTIVO EN BITACORA.' })
    load()
  }

  async function guardarPlantilla() {
    const { error } = await supabase.from('projects').update({ contract_template: tplText }).eq('id', pidOp)
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: 'PLANTILLA GUARDADA PARA ESTE PROYECTO' })
    load()
  }

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Ventas y contratos</h1>
        <ProjectPicker />
        {puedeCorregir &&(
          <button className="btn-ghost" onClick={() => setTplOpen(!tplOpen)}>
            {tplOpen ? 'Cerrar plantilla' : '⚙ Plantilla del contrato'}
          </button>
        )}
      </div>

      {tplOpen && puedeCorregir &&(
        <div className="glass form-card" style={{ maxWidth: 'none' }}>
          <p><b>PLANTILLA DEL CONTRATO — {proyecto?.name}</b></p>
          <p className="muted small">
            Cada proyecto tiene su propia plantilla. Escribe el texto libremente y usa variables entre dobles llaves.
            Lineas que empiezan con "CLAUSULA" o "ANEXO" salen como titulos. <b>**texto**</b> sale en negrita.
          </p>
          <p className="muted small" style={{ textTransform: 'none' }}>
            Tablas propias: cada fila en su linea, con las celdas separadas por <code>|</code> (ej. <code>| Banco | BBVA |</code>).
            Una fila <code>|---|---|</code> debajo de la primera la vuelve encabezado.
            Al inicio de una linea, <code>{'{{SI_SEPARACION}}'}</code> o <code>{'{{SI_CO_COMPRADOR}}'}</code> hace que salga solo si la venta tuvo separacion o co-comprador.
          </p>
          <p className="small">VARIABLES: {VARIABLES.map(v => <code key={v} className="tok">{'{{' + v + '}}'}</code>)}</p>
          <p className="small">BLOQUES (tablas automaticas, en linea propia): {BLOQUES.map(v => <code key={v} className="tok tok2">{'{{' + v + '}}'}</code>)}</p>
          <textarea rows="22" value={tplText} spellCheck="false"
            style={{ textTransform: 'none', fontFamily: 'monospace', fontSize: '.85rem' }}
            onChange={e => setTplText(e.target.value)} />
          <div>
            <button className="btn-primary" onClick={guardarPlantilla}>Guardar plantilla</button>{' '}
            <button className="btn-ghost" onClick={() => setTplText(DEFAULT_TEMPLATE)}>Restaurar plantilla base</button>
          </div>
        </div>
      )}

      {soloVenta ? (
        <div className="toolbar">
          {ventaFicha?.lot?.id && <Link className="btn-ghost" to={`/lotes/${ventaFicha.lot.id}`}>&#8592; Volver a la ficha del lote</Link>}
          <span className="hint">Mostrando solo la venta de MZ {ventaFicha?.lot?.mz || '?'} LT {ventaFicha?.lot?.lt || '?'}.</span>
          <button className="link-btn" onClick={() => setSearchParams({}, { replace: true })}>ver todas las ventas</button>
        </div>
      ) : (
        <div className="toolbar">
          <input className="search" placeholder="Buscar por cliente, DNI o lote..." value={q} onChange={e => setQ(e.target.value)} />
          <select value={est} onChange={e => setEst(e.target.value)}>
            <option value="todos">TODOS LOS ESTADOS</option>
            <option value="en_proceso">EN PROCESO</option>
            <option value="pagado">PAGADOS (100%)</option>
            <option value="expropiado">EXPROPIADOS</option>
            <option value="anulado">ANULADOS</option>
          </select>
          <button type="button" className={`chip ${soloSinFirmar ? 'on' : ''}`} onClick={() => setSoloSinFirmar(x => !x)}
            title="Ventas vigentes que todavía no tienen el contrato firmado subido">
            &#9888; Sin contrato firmado{sinFirmar ? ` (${sinFirmar})` : ''}
          </button>
        </div>
      )}

      <p className="hint">
        {filtradas.length} ventas | PRECIO: <b>{soles(tot.precio)}</b> | COBRADO: <b style={{ color: '#4bb96a' }}>{soles(tot.cobrado)}</b> | SALDO: <b>{soles(tot.saldo)}</b>
      </p>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Lote</th><th>Cliente</th><th>Fecha</th><th>Precio</th><th>Cobrado</th><th>Saldo</th><th>Cuotas</th><th>Estado</th><th>Contrato</th></tr></thead>
          <tbody>
            {pag.pagina.map(v => {
              const c = cobradoDeVenta(v)
              const e = EST[v.status] || { lbl: (v.status || '').toUpperCase(), color: '#9daab6' }
              const conjunta = (v.lot?.associated_to || '').startsWith('VENTA CONJUNTA')
              return (
                <tr key={v.id} style={v.status === 'pagado' ? { background: 'rgba(75,185,106,.08)' } : undefined}>
                  {/* el lote lleva a su ficha: ahí se cobra y se ven las cuotas y los pagos */}
                  <td><LoteLink lot={v.lot}>{conjunta ? v.lot.associated_to.split(' (')[0].replace('VENTA CONJUNTA ', '') : null}</LoteLink></td>
                  <td>{v.client?.full_name || '-'}{v.co_client ? <span className="muted"> + {v.co_client.full_name}</span> : ''}</td>
                  <td>{fechaPe(v.sale_date)}
                    {puedeCorregir &&<button className="link-btn" style={{ marginLeft: 4 }} title="Corregir fecha de venta (queda en bitácora)" onClick={() => editarFechaVenta(v)}>&#9998;</button>}
                  </td>
                  <td>{soles(v.total_sale_price)}</td>
                  <td style={{ color: '#4bb96a' }}>{soles(c.cobrado)}</td>
                  <td>{soles(c.saldo)}</td>
                  <td>{c.cuotasPagadas} / {v.installments_count}</td>
                  <td><span style={{ color: e.color, fontWeight: 700 }}>{e.lbl}</span></td>
                  <td style={{ whiteSpace: 'normal', minWidth: 190 }}>
                    {VIVA.includes(v.status)
                      ? <>
                          <ContratoDeVenta venta={v} puedeEditar={!soloMira}
                            alCambiar={t => { setMsg({ ok: true, t }); load() }}
                            alFallar={t => setMsg({ ok: false, t })} />
                          {/* con el firmado ya subido no se genera otro: el que vale es el firmado */}
                          {!v.signed_contract_url && <button className="btn-ghost" style={{ marginTop: 6 }} onClick={() => setGen(v.id)}>&#128196; Generar contrato</button>}
                        </>
                      : v.signed_contract_url
                        ? <a href={v.signed_contract_url} target="_blank" rel="noreferrer" className="muted">ver firmado</a>
                        : <span className="muted">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <Paginador {...pag} />
      </div>

      {gen && <ContratoModal saleId={gen} onClose={() => { setGen(null); load() }} />}
    </>
  )
}
