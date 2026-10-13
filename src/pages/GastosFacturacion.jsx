import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMsg, savedFx } from '../lib/saveFx'
import { useEsCelular } from '../lib/useEsCelular'
import { filtrarGastos, FILTRO_VACIO } from '../lib/buscarGastos'
import VisorDoc from '../components/VisorDoc'
import RegistrarPago from '../components/RegistrarPago'
import BuscadorGastos from '../components/BuscadorGastos'
import FichaGasto from '../components/FichaGasto'
import Paginador, { usePaginacion } from '../components/Paginador'
import { estadoGasto, numeroGasto, HojaConstancia } from '../components/ConstanciaGasto'

// GASTOS PARA FACTURACIÓN (sql/145-146, 13 oct 2026): la secretaria de la socia ve TODO
// Gastos de sus proyectos (también los anteriores), busca, abre la ficha de cada gasto,
// imprime las constancias y sube el voucher de los pagos que hizo la socia (el gasto
// queda PAGADO, con la misma lectura de la IA que usa la socia). Nada más: no pide, no
// firma, no edita, no sube RH ni reposiciones. No lee tablas directo: todo llega por
// facturacion_gastos (el candado de sql/134).
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fechaPe = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '—'
const ESTADOS = [
  ['todos', 'Todos los estados'],
  ['pendientes', '⏳ Sin pagar'],
  ['por_pagar', '💸 Por pagar (falta el voucher)'],
  ['por_firmar', 'Por firmar (quien lo pide)'],
  ['por_aprobar', 'Por aprobar (la socia)'],
  ['pagados', '✔ Pagados'],
  ['falta_rh', 'Pagados sin RH / factura'],
  ['rechazados', 'Rechazados'],
]
const MAX_LOTE = 60   // imprimir de una vez: más hojas que esto se cuelga el navegador

export default function GastosFacturacion() {
  const [msg, setMsg] = useMsg(null)
  const esCelular = useEsCelular()
  const [datos, setDatos] = useState(null)        // { proyectos, gastos }
  const [proy, setProy] = useState('todos')
  const [fest, setFest] = useState('todos')        // de entrada TODOS, también los anteriores (13 oct)
  const [f, setF] = useState(FILTRO_VACIO)         // la búsqueda (components/BuscadorGastos)
  const [verDoc, setVerDoc] = useState(null)
  const [prt, setPrt] = useState(null)             // { lista } para imprimir
  const [ficha, setFicha] = useState(null)
  const [pagar, setPagar] = useState(null)

  async function cargar() {
    const { data, error } = await supabase.rpc('facturacion_gastos')
    if (error) { setMsg({ ok: false, t: /facturacion_gastos/.test(error.message) ? 'Falta correr sql/145 en el servidor.' : error.message }); setDatos({ proyectos: [], gastos: [] }); return }
    setDatos(data || { proyectos: [], gastos: [] })
  }
  useEffect(() => { cargar() }, [])

  const proyectos = datos?.proyectos || []
  const proyDe = useMemo(() => Object.fromEntries(proyectos.map(p => [p.id, p])), [proyectos])
  const todos = useMemo(() => (datos?.gastos || []).filter(g => proy === 'todos' || g.project_id === proy), [datos, proy])
  // aprobada y firmada por la socia, sin pagar todavía: le toca subir el voucher
  const porPagar = g => !!proyDe[g.project_id]?.expense_approval && estadoGasto(g) === 'aprobado' && !g.voucher_url
  const listaPorPagar = todos.filter(porPagar)

  // primero el estado, después la búsqueda (los motivos se cuentan sobre lo que deja el estado)
  const porEstado = useMemo(() => todos.filter(g => {
    const e = estadoGasto(g)
    if (fest === 'pendientes') return !['confirmado', 'rechazado'].includes(e)
    if (fest === 'por_pagar') return porPagar(g)
    if (fest === 'por_firmar') return e === 'por_firmar'
    if (fest === 'por_aprobar') return e === 'solicitado'
    if (fest === 'pagados') return e === 'confirmado'
    if (fest === 'falta_rh') return e === 'confirmado' && !g.receipt_url && !g.receipt_na
    if (fest === 'rechazados') return e === 'rechazado'
    return true
  }), [todos, fest, proyDe])
  const filtrada = useMemo(() => filtrarGastos(porEstado, f), [porEstado, f])
  const pag = usePaginacion(filtrada, 50)
  const suma = l => l.reduce((s, g) => s + Number(g.amount || 0), 0)
  // los totales de lo que se está viendo, por estado
  const resumen = [
    ['ok', '✔ Pagado', filtrada.filter(g => estadoGasto(g) === 'confirmado')],
    ['warn', '💸 Por pagar', filtrada.filter(porPagar)],
    ['warn', '⏳ Por firmar o aprobar', filtrada.filter(g => ['por_firmar', 'solicitado'].includes(estadoGasto(g)))],
    ['bad', '✖ Rechazado', filtrada.filter(g => estadoGasto(g) === 'rechazado')],
  ].filter(([, , l]) => l.length)
  const verifDe = g => ({ valido: g.firma_valida, solicitud_valida: g.solicitud_valida })

  const estadoDe = g => {
    const e = estadoGasto(g)
    if (e === 'confirmado') return <span className="ok">✔ PAGADO{g.confirmed_at && <><br /><span className="muted small">{fechaPe(g.confirmed_at.slice(0, 10))}</span></>}</span>
    if (e === 'rechazado') return <span className="bad" title={g.rejected_reason || ''}>✖ RECHAZADO<br /><span className="muted small" style={{ textTransform: 'none' }}>{(g.rejected_reason || '').slice(0, 40)}</span></span>
    if (e === 'aprobado') return porPagar(g)
      ? <span className="warn">💸 POR PAGAR<br /><span className="muted small">aprobó {(g.approved_name || '').split(' ')[0]} · falta el voucher</span></span>
      : <span className="ok">✍ APROBADO</span>
    if (e === 'por_firmar') return <span className="warn">⏳ POR FIRMAR<br /><span className="muted small" style={{ textTransform: 'none' }}>{g.pedido_por_nombre ? 'firma ' + g.pedido_por_nombre.split(' ')[0] : 'firma quien lo pide'}</span></span>
    return <span className="warn">⏳ {proyDe[g.project_id]?.expense_approval ? 'POR APROBAR' : 'SOLICITADO'}{proyDe[g.project_id]?.expense_approval && <><br /><span className="muted small" style={{ textTransform: 'none' }}>firma la socia</span></>}</span>
  }
  const doc = (url, titulo, nota) => url
    ? <><button className="link-btn" onClick={() => setVerDoc({ url, titulo })}>VER</button>{nota && <div className="muted small" style={{ textTransform: 'none' }}>{nota}</div>}</>
    : null
  const docConstancia = g => <>
    <button className="link-btn" onClick={() => setPrt({ lista: [g] })}>🖨 imprimir</button>
    {g.request_doc_url && <> · {doc(g.request_doc_url, 'Constancia firmada · ' + numeroGasto(g))}</>}
  </>
  const docRH = g => doc(g.receipt_url, 'RH / factura · ' + numeroGasto(g), g.receipt_note)
    || (g.receipt_na ? <span className="muted small">no aplica</span> : estadoGasto(g) === 'confirmado' ? <span className="bad small">falta</span> : <span className="muted small">—</span>)
  // lo único que sube: el voucher del pago que hizo la socia
  const docVoucher = g => doc(g.voucher_url, 'Voucher del pago · ' + numeroGasto(g), g.voucher_note)
    || (porPagar(g) ? <button className="btn-primary" style={{ fontSize: 12, whiteSpace: 'nowrap' }} onClick={() => setPagar(g)}>💸 Subir voucher</button>
      : g.voucher_na ? <span className="muted small">no aplica</span> : <span className="muted small">—</span>)
  const docRepo = g => g.reposicion
    ? <>{doc(g.reposicion.voucher_url, 'Reposición a ' + g.reposicion.persona)}<div className="muted small" style={{ textTransform: 'none' }}>a {g.reposicion.persona} · {fechaPe(g.reposicion.fecha)}</div></>
    : g.adelanto_por && !g.rejected_at ? <span className="warn small">falta reponer a {g.adelanto_por.split(' ')[0]}</span> : <span className="muted small">—</span>
  const nombreProy = g => proyDe[g.project_id]?.name || ''
  const abrirFicha = g => <button className="link-btn" title="Ver todo de este gasto" onClick={() => setFicha(g)}><b>{numeroGasto(g)}</b></button>

  function imprimirLista() {
    if (filtrada.length > MAX_LOTE) { setMsg({ ok: false, t: 'Son ' + filtrada.length + ' constancias: busca o filtra por fecha (máximo ' + MAX_LOTE + ' de una vez).' }); return }
    setPrt({ lista: filtrada })
  }

  return (
    <>
      <div className="toolbar"><h1 style={{ margin: 0, flex: 1 }}>Gastos</h1></div>
      <p className="muted small" style={{ margin: '-.4rem 0 .8rem', textTransform: 'none' }}>
        Todos los gastos de tus proyectos, también los anteriores. Toca el <b>N° de la solicitud</b> para ver todo el gasto.
        Cuando la socia ya aprobó y pagó un gasto, súbele el voucher del pago: el gasto queda <b>pagado</b>.
      </p>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      {/* LO QUE LE TOCA: los pagos que esperan su voucher, arriba y con su botón */}
      {listaPorPagar.length > 0 && (
        <div className="glass form-card" style={{ maxWidth: 'none' }}>
          <p style={{ margin: '0 0 8px' }}><b>💸 FALTA SUBIR EL VOUCHER ({listaPorPagar.length})</b>
            <span className="muted small" style={{ textTransform: 'none' }}> — aprobados por la socia, esperan el voucher del pago</span></p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: esCelular ? 14 : 8 }}>
            {listaPorPagar.slice(0, 10).map(g => (
              <div key={g.id} style={{ display: 'flex', gap: esCelular ? 6 : 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ minWidth: 90 }}>{abrirFicha(g)}</span>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{soles(g.amount)}</b>
                <span className="muted small" style={{ textTransform: 'none', flexBasis: esCelular ? '100%' : undefined }}>
                  {proyectos.length > 1 ? nombreProy(g) + ' · ' : ''}{g.recipient || '—'} · {(g.description || g.type || '').slice(0, 60)}
                </span>
                <button className="btn-primary" style={esCelular ? { width: '100%', padding: '.8rem' } : { fontSize: 12, marginLeft: 'auto', whiteSpace: 'nowrap' }}
                  onClick={() => setPagar(g)}>💸 Subir voucher</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="toolbar">
        {proyectos.length > 1 && (
          <select value={proy} onChange={e => setProy(e.target.value)}>
            <option value="todos">TODOS MIS PROYECTOS</option>
            {proyectos.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select value={fest} onChange={e => setFest(e.target.value)}>
          {ESTADOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        {filtrada.length > 0 && <button className="btn-ghost" onClick={imprimirLista}>🖨 Imprimir {filtrada.length === 1 ? 'esta' : 'las ' + filtrada.length}</button>}
      </div>
      <BuscadorGastos base={porEstado} f={f} setF={setF} />

      {datos === null && <p className="muted">Cargando…</p>}
      {datos && (
        <p className="hint">
          {filtrada.length} gasto{filtrada.length === 1 ? '' : 's'} | TOTAL: <b>{soles(suma(filtrada))}</b>
          {resumen.map(([c, t, l]) => <span key={t} className={c}> | {t}: {soles(suma(l))} ({l.length})</span>)}
        </p>
      )}
      {datos && !filtrada.length && <p className="muted">No hay gastos con esta búsqueda.</p>}

      {!!filtrada.length && (esCelular ? (
        <div className="gastos-cards">
          {pag.pagina.map(g => (
            <div key={g.id} className="glass gasto-card">
              <div className="gc-top">{abrirFicha(g)}<span className="muted small">{fechaPe(g.issue_date || g.reception_date)}</span></div>
              {proyectos.length > 1 && <div className="muted small">{nombreProy(g)}</div>}
              <div>{estadoDe(g)}</div>
              <div className="gc-monto">{soles(g.amount)}</div>
              <div><b>{g.recipient || '—'}</b></div>
              <div className="muted small gc-motivo">{g.description || g.type}</div>
              <div className="gc-docs">
                <div className="gc-doc"><span className="muted">Constancia</span><span>{docConstancia(g)}</span></div>
                <div className="gc-doc"><span className="muted">RH / factura</span><span>{docRH(g)}</span></div>
                <div className="gc-doc"><span className="muted">Voucher del pago</span><span>{docVoucher(g)}</span></div>
                <div className="gc-doc"><span className="muted">Reposición</span><span>{docRepo(g)}</span></div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass table-wrap">
          <table>
            <thead><tr><th>N°</th><th>Fecha</th>{proyectos.length > 1 && proy === 'todos' && <th>Proyecto</th>}<th>Estado</th><th>Tipo</th><th>Receptor · motivo</th><th style={{ textAlign: 'right' }}>Monto</th><th>Constancia</th><th>RH / factura</th><th>Voucher del pago</th><th>Reposición</th></tr></thead>
            <tbody>
              {pag.pagina.map(g => (
                <tr key={g.id}>
                  <td>{abrirFicha(g)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fechaPe(g.issue_date || g.reception_date)}</td>
                  {proyectos.length > 1 && proy === 'todos' && <td className="small">{nombreProy(g)}</td>}
                  <td>{estadoDe(g)}</td>
                  <td className="small">{g.type}</td>
                  <td title={g.description}>{g.recipient || '—'}<div className="muted small" style={{ textTransform: 'none' }}>{(g.description || '').slice(0, 60)}</div></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><b>{soles(g.amount)}</b></td>
                  <td>{docConstancia(g)}</td>
                  <td>{docRH(g)}</td>
                  <td>{docVoucher(g)}</td>
                  <td>{docRepo(g)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <Paginador {...pag} />

      {ficha && <FichaGasto g={ficha} proyecto={proyDe[ficha.project_id]} onCerrar={() => setFicha(null)}
        onImprimir={g => { setFicha(null); setPrt({ lista: [g] }) }} />}

      {/* IMPRIMIR: una constancia o la lista entera, cada una en su hoja */}
      {prt && (
        <div className="modal-bg" onClick={() => setPrt(null)}>
          <div className="glass modal print-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head no-print">
              <h2>{prt.lista.length === 1 ? 'Constancia — ' + (prt.lista[0].recipient || numeroGasto(prt.lista[0])) : prt.lista.length + ' constancias (una por hoja)'}</h2>
              <button className="btn-primary" onClick={() => window.print()}>Imprimir / PDF</button>
              <button className="btn-ghost" onClick={() => setPrt(null)}>&#10005;</button>
            </div>
            <div className="print-area">
              {prt.lista.map(g => (
                <div key={g.id} className="contract hoja-gasto">
                  <HojaConstancia g={g} proyecto={proyDe[g.project_id]} verif={verifDe(g)} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {pagar && (
        <RegistrarPago gasto={pagar} proyecto={proyDe[pagar.project_id]}
          onCerrar={() => setPagar(null)}
          onHecho={t => { setPagar(null); setMsg({ ok: true, t }); savedFx(); cargar() }} />
      )}

      {verDoc && (
        <div className="modal-bg" onClick={() => setVerDoc(null)}>
          <div className="glass modal docs-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h2>{verDoc.titulo}</h2><button className="btn-ghost" onClick={() => setVerDoc(null)}>&#10005;</button></div>
            <p className="muted small"><a href={verDoc.url} target="_blank" rel="noreferrer">abrir aparte</a></p>
            <VisorDoc url={verDoc.url} titulo={verDoc.titulo} />
          </div>
        </div>
      )}
    </>
  )
}
