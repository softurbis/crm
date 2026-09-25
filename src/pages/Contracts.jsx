import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { subirRuta } from '../lib/archivos'
import { useMsg } from '../lib/saveFx'
import { useAuth } from '../context/AuthContext'
import ContratoModal from '../components/ContratoModal'
import { VARIABLES, BLOQUES, DEFAULT_TEMPLATE, COLS_VENTA_CONTRATO, subirContratoFirmado } from '../lib/contrato'
import { useProject, ProjectPicker } from '../context/ProjectContext'

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })

export default function Contracts() {
  const { role, profile } = useAuth()
  const { pidOp } = useProject()
  const [proyecto, setProyecto] = useState(null)
  const [ventas, setVentas] = useState([])
  const [q, setQ] = useState('')
  const [gen, setGen] = useState(null)   // id de la venta cuyo contrato se esta generando
  const [msg, setMsg] = useMsg(null)
  const [tplOpen, setTplOpen] = useState(false)
  const [tplText, setTplText] = useState('')

  async function load() {
    if (!pidOp) return
    const [v, p] = await Promise.all([
      supabase.from('sales')
        .select(COLS_VENTA_CONTRATO)
        .eq('lot.project_id', pidOp).in('status', ['en_proceso', 'pagado'])
        .order('sale_date', { ascending: false }),
      supabase.from('projects').select('*').eq('id', pidOp).single(),
    ])
    setVentas(v.data || []); setProyecto(p.data || null)
    setTplText((p.data?.contract_template) || DEFAULT_TEMPLATE)
  }
  useEffect(() => { load() }, [pidOp])

  // ?venta=<id>: se llega desde la ficha del lote y se muestra solo esa venta
  const [searchParams, setSearchParams] = useSearchParams()
  const soloVenta = searchParams.get('venta')
  const ventaFicha = soloVenta ? ventas.find(v => v.id === soloVenta) : null

  const filtradas = useMemo(() => {
    if (soloVenta) return ventas.filter(v => v.id === soloVenta)
    const t = q.trim().toLowerCase()
    if (!t) return ventas
    return ventas.filter(v =>
      (v.client?.full_name || '').toLowerCase().includes(t) ||
      `${v.lot?.mz}-${v.lot?.lt}`.toLowerCase().includes(t))
  }, [ventas, q, soloVenta])

  async function subirFirmado(v, file) {
    try {
      const t = await subirContratoFirmado(v, file)   // lib/contrato: pide la nota y reemplaza si ya habia
      if (!t) return
      setMsg({ ok: true, t }); load()
    } catch (e) { setMsg({ ok: false, t: 'ERROR: ' + e.message }) }
  }

  // corregir la fecha de venta (superusuario): la misma correccion que ya existe
  // en la ficha del lote, pero aqui — donde se revisan los contratos — que es
  // donde de verdad se descubre que la fecha no coincide con el papel firmado.
  async function editarFechaVenta(v) {
    const nueva = prompt('NUEVA FECHA DE VENTA de ' + (v.client?.full_name || 'esta venta') + ' (AAAA-MM-DD).\n\nOJO: no mueve las cuotas del cronograma; solo corrige la fecha del contrato.', v.sale_date || '')
    if (nueva === null) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nueva)) { alert('Formato invalido. Ej: 2026-05-12'); return }
    if (nueva === v.sale_date) return
    const motivo = prompt('Motivo de la correccion (obligatorio, queda en bitacora):')
    if (motivo === null) return
    if (motivo.trim().length < 5) { alert('MOTIVO OBLIGATORIO'); return }
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

  // quitar el contrato firmado (superusuario): la venta vuelve a figurar SIN CONTRATO
  async function quitarContrato(v) {
    if (!confirm('¿Quitar el contrato firmado de ' + (v.client?.full_name || 'esta venta') + '?\n\nLa venta volvera a figurar como SIN CONTRATO FIRMADO y podras subir otro. El archivo anterior queda en el almacenamiento.')) return
    const { error } = await supabase.from('sales').update({ signed_contract_url: null, contract_note: null }).eq('id', v.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setMsg({ ok: true, t: 'CONTRATO QUITADO — YA PUEDES SUBIR OTRO' }); load()
  }

  // editar/agregar la nota de un contrato ya subido
  async function notaContrato(v) {
    const nota = prompt('Comentario / nota de este contrato:', v.contract_note || '')
    if (nota === null) return
    const { error } = await supabase.from('sales').update({ contract_note: nota.trim() || null }).eq('id', v.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setMsg({ ok: true, t: 'NOTA DEL CONTRATO GUARDADA' }); load()
  }

  // ---- documentos de respaldo (máx 2 por contrato): traspaso, iniciales, adenda… ----
  const docsDe = v => Array.isArray(v.extra_docs) ? v.extra_docs : []
  async function subirDocExtra(v, file) {
    const docs = docsDe(v)
    if (docs.length >= 2) { setMsg({ ok: false, t: 'MÁXIMO 2 documentos de respaldo por contrato.' }); return }
    const nota = prompt('¿Qué documento es? (etiqueta corta)\n\nEj: TRASPASO · DOCUMENTO DE INICIALES · ADENDA · CARTA DE COMPROMISO', '')
    if (nota === null) return
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
    const path = `contratos/respaldo/${v.lot.mz}-${v.lot.lt}-${Date.now()}.${ext}`
    let url
    try { url = await subirRuta(path, file) }
    catch (e) { setMsg({ ok: false, t: 'ERROR: ' + e.message }); return }
    const next = [...docs, { url, note: (nota.trim() || 'Documento de respaldo') }]
    const { error: e2 } = await supabase.from('sales').update({ extra_docs: next }).eq('id', v.id)
    if (e2) { setMsg({ ok: false, t: 'ERROR: ' + e2.message }); return }
    setMsg({ ok: true, t: 'DOCUMENTO DE RESPALDO SUBIDO' }); load()
  }
  async function quitarDocExtra(v, idx) {
    const docs = docsDe(v)
    if (!confirm('¿Quitar "' + (docs[idx]?.note || 'este documento') + '"?\n\n(El archivo queda en el almacenamiento.)')) return
    const next = docs.filter((_, i) => i !== idx)
    const { error } = await supabase.from('sales').update({ extra_docs: next }).eq('id', v.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setMsg({ ok: true, t: 'DOCUMENTO QUITADO' }); load()
  }
  async function notaDocExtra(v, idx) {
    const docs = [...docsDe(v)]
    if (!docs[idx]) return
    const nota = prompt('¿Qué documento es? (etiqueta corta)', docs[idx].note || '')
    if (nota === null) return
    docs[idx] = { ...docs[idx], note: (nota.trim() || 'Documento de respaldo') }
    const { error } = await supabase.from('sales').update({ extra_docs: docs }).eq('id', v.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setMsg({ ok: true, t: 'ETIQUETA GUARDADA' }); load()
  }

  async function guardarPlantilla() {
    const { error } = await supabase.from('projects').update({ contract_template: tplText }).eq('id', pidOp)
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: 'PLANTILLA GUARDADA PARA ESTE PROYECTO' })
    load()
  }

  const sinFirmar = ventas.filter(v => !v.signed_contract_url).length

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Contratos</h1>
        <ProjectPicker />
        {role === 'superuser' && (
          <button className="btn-ghost" onClick={() => setTplOpen(!tplOpen)}>
            {tplOpen ? 'Cerrar plantilla' : 'Plantilla del contrato (superusuario)'}
          </button>
        )}
      </div>

      {tplOpen && role === 'superuser' && (
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
          <span className="hint">Mostrando solo el contrato de MZ {ventaFicha?.lot?.mz || '?'} LT {ventaFicha?.lot?.lt || '?'}.</span>
          <button className="link-btn" onClick={() => setSearchParams({}, { replace: true })}>ver todos los contratos</button>
        </div>
      ) : (
        <div className="toolbar">
          <input className="search" placeholder="Buscar por cliente o lote..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
      )}
      {sinFirmar > 0 && <p className="hint"><span className="bad">&#9888; {sinFirmar} venta(s) sin contrato firmado subido.</span></p>}
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Lote</th><th>Cliente</th><th>Precio</th><th>Fecha venta</th><th>Contrato firmado</th><th></th></tr></thead>
          <tbody>
            {filtradas.map(v => (
              <tr key={v.id}>
                <td>{v.lot?.mz}-{v.lot?.lt}</td>
                <td>{v.client?.full_name}{v.co_client ? <span className="muted"> + {v.co_client.full_name}</span> : ''}</td>
                <td>{soles(v.total_sale_price)}</td>
                <td>{v.sale_date}
                  {role === 'superuser' && <button className="link-btn" style={{ marginLeft: 4 }} title="Corregir fecha de venta (queda en bitácora)" onClick={() => editarFechaVenta(v)}>&#9998;</button>}
                </td>
                <td>
                  {v.signed_contract_url
                    ? <>
                        <a href={v.signed_contract_url} target="_blank" rel="noreferrer" className="ok">VER FIRMADO</a>{' '}
                        <button className="link-btn" onClick={() => notaContrato(v)}>&#128221; nota</button>
                        {role === 'superuser' && (<>
                          {' '}
                          <label className="link-btn" style={{ cursor: 'pointer' }}>&#128260; reemplazar
                            <input type="file" accept="image/*,.pdf" hidden onChange={e => e.target.files[0] && subirFirmado(v, e.target.files[0])} />
                          </label>{' '}
                          <button className="link-btn" onClick={() => quitarContrato(v)}>&#128465; quitar</button>
                        </>)}
                        {v.contract_note && <div className="muted small" style={{ textTransform: 'none' }}>{v.contract_note}</div>}
                      </>
                    : <label className="upload-btn bad">&#9888; subir firmado
                        <input type="file" accept="image/*,.pdf" hidden onChange={e => e.target.files[0] && subirFirmado(v, e.target.files[0])} />
                      </label>}
                  {/* documentos de respaldo del contrato (traspaso, iniciales, adenda…): máx 2 */}
                  <div style={{ marginTop: 6, borderTop: '1px dashed rgba(255,255,255,.12)', paddingTop: 5 }}>
                    {docsDe(v).map((d, i) => (
                      <div key={i} className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', textTransform: 'none', marginBottom: 2 }}>
                        <span>📎</span>
                        <a href={d.url} target="_blank" rel="noreferrer" className="ok">{d.note || 'Respaldo'}</a>
                        <button className="link-btn" title="Editar etiqueta" onClick={() => notaDocExtra(v, i)}>&#9998;</button>
                        {role === 'superuser' && <button className="link-btn" title="Quitar" onClick={() => quitarDocExtra(v, i)}>&#128465;</button>}
                      </div>
                    ))}
                    {docsDe(v).length < 2 && (
                      <label className="link-btn" style={{ cursor: 'pointer' }} title="Traspaso, documento de iniciales, adenda, etc.">
                        &#10133; documento de respaldo
                        <input type="file" accept="image/*,.pdf" hidden onChange={e => e.target.files[0] && subirDocExtra(v, e.target.files[0])} />
                      </label>
                    )}
                  </div>
                </td>
                <td><button className="btn-ghost" onClick={() => setGen(v.id)}>Generar contrato</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {gen && <ContratoModal saleId={gen} onClose={() => setGen(null)} />}
    </>
  )
}
