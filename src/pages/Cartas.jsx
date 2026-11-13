import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { upload } from '../lib/archivos'
import { useMsg } from '../lib/saveFx'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import { hoyPe } from '../lib/cobros'
import { fechaPe } from '../lib/lotes'
import { avisar, confirmar, pedir } from '../lib/dialogos'
import { soles, llenarPlantilla, VARIABLES, ESTADOS, RESULTADOS, estadoVisible, cartaPdf, nombrePdf, subirPdf, fechaLarga } from '../lib/cartas'
import FirmarCarta from '../components/FirmarCarta'

// ============================================================
// CARTAS DE COBRANZA (sql/155, 21 oct 2026)
// ------------------------------------------------------------
// A los clientes con 2 o más cuotas vencidas se les manda una carta:
//   1. la secretaria la crea desde una plantilla ("Por notificar"),
//   2. la firma la SOCIA del proyecto (contraseña + código al celular),
//   3. cualquiera la imprime; la entrega Cami: en papel (con foto del cargo)
//      y/o por WhatsApp (sale el PDF firmado),
//   4. corre el plazo y se anota el resultado: pagó, acuerdo, otra carta,
//      expropiar…
// Las cartas de una misma venta forman un CASO, que se cierra cuando pagó o se
// expropió. Todo pasa por funciones de la base: la secretaria de la socia (rol
// facturación) también entra aquí, solo para ver e imprimir.
// ============================================================
const VISTAS = [
  ['curso', 'En curso'],
  ['por_firmar', '✍ Por firmar'],
  ['firmada', '🖨 Por entregar'],
  ['entregada', '📬 En plazo'],
  ['vencida', '⏰ Plazo vencido'],
  ['cerrada', '✔ Cerradas'],
  ['anulada', '✖ Anuladas'],
]
const enCurso = e => ['por_firmar', 'firmada', 'entregada', 'vencida'].includes(e)
// la fecha de un momento, en hora de Lima
const fechaHora = s => s ? fechaPe(new Date(new Date(s).getTime() - 5 * 3600000).toISOString().slice(0, 10)) : ''

export default function Cartas() {
  const { profile, role, esSuper, puedeCorregir } = useAuth()
  const { projects, pidOp } = useProject()
  const [params, setParams] = useSearchParams()
  const esFact = role === 'facturacion'
  // facturación y la socia ven todos sus proyectos; las secretarias, el elegido en el menú
  const todosMisProyectos = esFact || role === 'socio'
  const pid = todosMisProyectos ? null : pidOp
  const proyecto = projects.find(p => p.id === pid) || null
  const trabaja = !esFact && role !== 'socio'
  const editaPlantillas = esSuper || puedeCorregir || role === 'admin'
  const hoy = hoyPe()

  const [tab, setTab] = useState('cartas')
  const [vista, setVista] = useState(role === 'socio' ? 'por_firmar' : 'curso')
  const [cartas, setCartas] = useState(null)
  const [busca, setBusca] = useState('')
  const [abierta, setAbierta] = useState(null)       // id de la carta en el detalle
  const [creando, setCreando] = useState(null)       // sale_id
  const [msg, setMsg] = useMsg(null)
  const [falta155, setFalta155] = useState(false)

  async function cargar() {
    const { data, error } = await supabase.rpc('cartas_listar', { p_project: pid })
    if (error) {
      if (/cartas_listar|schema cache|PGRST202/i.test(error.message)) setFalta155(true)
      else setMsg({ ok: false, t: error.message })
      setCartas([]); return
    }
    setCartas(data || [])
  }
  useEffect(() => { setCartas(null); if (todosMisProyectos || pid) cargar() }, [pid])

  // ?venta=<id> (desde la ficha del lote): su carta en curso, o una nueva
  useEffect(() => {
    const venta = params.get('venta')
    if (!venta || !cartas) return
    const suya = cartas.find(c => c.sale_id === venta && enCurso(c.estado))
    if (suya) setAbierta(suya.id)
    else if (trabaja) setCreando(venta)
    setParams({}, { replace: true })
  }, [cartas])

  const conVista = useMemo(() => (cartas || []).map(c => ({ ...c, vis: estadoVisible(c, hoy) })), [cartas, hoy])
  const cuenta = k => conVista.filter(c => k === 'curso' ? enCurso(c.vis) : c.vis === k).length
  const filas = useMemo(() => {
    const q = busca.trim().toUpperCase()
    return conVista.filter(c => vista === 'curso' ? enCurso(c.vis) : c.vis === vista)
      .filter(c => !q || [c.cliente, c.lote, c.dni, String(c.numero)].some(v => String(v || '').toUpperCase().includes(q)))
  }, [conVista, vista, busca])
  const carta = conVista.find(c => c.id === abierta) || null
  const varios = todosMisProyectos && new Set((cartas || []).map(c => c.project_id)).size > 1

  if (falta155) return (
    <>
      <div className="toolbar"><h1 style={{ margin: 0 }}>Cartas de cobranza</h1></div>
      <p className="warn">Falta correr <b>sql/155</b> en el servidor para usar esta pantalla.</p>
    </>
  )

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Cartas de cobranza</h1>
      </div>
      <p className="muted small" style={{ margin: '-.4rem 0 .8rem', textTransform: 'none' }}>
        {esFact ? 'Las cartas de tus proyectos: las que esperan la firma de la socia y las firmadas, para imprimirlas.'
          : role === 'socio' ? 'Las cartas que te toca firmar y su seguimiento.'
          : <>Clientes con cuotas vencidas: se crea la carta, la firma la socia del proyecto, se imprime y se entrega (en papel o por WhatsApp), y se anota el resultado.{proyecto ? <> Proyecto: <b>{proyecto.name}</b>.</> : ''}</>}
      </p>
      {msg && <p className={msg.ok ? 'ok' : 'error'} style={{ textTransform: 'none' }}>{msg.t}</p>}

      <div className="chips" style={{ marginBottom: 10 }}>
        <button className={`chip ${tab === 'cartas' ? 'on' : ''}`} onClick={() => setTab('cartas')}>📨 Cartas</button>
        {trabaja && <button className={`chip ${tab === 'notificar' ? 'on' : ''}`} onClick={() => setTab('notificar')}>⚠ Por notificar</button>}
        {editaPlantillas && <button className={`chip ${tab === 'plantillas' ? 'on' : ''}`} onClick={() => setTab('plantillas')}>📝 Plantillas</button>}
      </div>

      {tab === 'cartas' && (<>
        <div className="chips">
          {VISTAS.map(([k, t]) => (
            <button key={k} className={`chip ${vista === k ? 'on' : ''}`} onClick={() => setVista(k)}>
              {t}{cartas ? ` (${cuenta(k)})` : ''}
            </button>
          ))}
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar cliente, lote o N°…"
            style={{ maxWidth: 240, textTransform: 'none' }} />
        </div>
        {cartas === null && <p className="muted">Cargando…</p>}
        {cartas && !filas.length && (
          <p className="muted">{vista === 'curso' && !cartas.length && trabaja
            ? <>Todavía no hay cartas. Créalas desde <button className="link-btn" onClick={() => setTab('notificar')}>Por notificar</button>.</>
            : 'No hay cartas en esta vista.'}</p>
        )}
        {!!filas.length && (
          <div className="glass table-wrap">
            <table>
              <thead><tr><th>N°</th><th>Creada</th>{varios && <th>Proyecto</th>}<th>Lote</th><th>Cliente</th><th style={{ textAlign: 'right' }}>Deuda</th><th>Estado</th><th>Plazo</th><th></th></tr></thead>
              <tbody>
                {filas.map(c => {
                  const e = ESTADOS[c.vis] || {}
                  return (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setAbierta(c.id)}>
                      <td><b>{c.numero}</b></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fechaHora(c.creado_at)}</td>
                      {varios && <td className="small">{c.proyecto}</td>}
                      <td><b>{c.lote}</b></td>
                      <td className="small" style={{ textTransform: 'none', whiteSpace: 'normal', minWidth: 160 }}>{c.cliente}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{soles(c.deuda)}<div className="muted small">{c.cuotas_vencidas} cuota{c.cuotas_vencidas === 1 ? '' : 's'}</div></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className={`st-chip ${e.c || ''}`}>{e.i} {e.t}</span>
                        <div className="muted small" style={{ textTransform: 'none' }}>
                          {c.vis === 'por_firmar' && c.puedo_firmar && <b className="warn">te toca firmar</b>}
                          {c.papel_at && '📄 papel '}{c.wsp_at && (c.wsp_estado === 'fallido' ? '💬 WhatsApp falló' : c.wsp_estado === 'enviado' ? '💬 WhatsApp' : '💬 saliendo…')}
                          {c.estado === 'cerrada' && RESULTADOS[c.resultado] && <>{RESULTADOS[c.resultado].i} {RESULTADOS[c.resultado].t}</>}
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{c.plazo_vence ? fechaPe(c.plazo_vence) : <span className="muted small">{c.plazo_dias} días</span>}</td>
                      <td><button className="btn-ghost" onClick={ev => { ev.stopPropagation(); setAbierta(c.id) }}>Abrir</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </>)}

      {tab === 'notificar' && trabaja && (
        pid ? <PorNotificar pid={pid} cartas={cartas || []} onCrear={setCreando} onAbrir={setAbierta} />
          : <p className="muted">Elige un proyecto en el menú.</p>
      )}

      {tab === 'plantillas' && editaPlantillas && <Plantillas pid={pid} projects={projects} />}

      {creando && (
        <CrearCarta saleId={creando} onCerrar={() => setCreando(null)}
          onCreada={async r => {
            setCreando(null)
            const socias = (r.socias || []).map(s => s.nombre).join(' / ')
            setMsg({ ok: true, t: `✅ Carta N° ${r.numero} creada. ${socias ? 'Le llega el aviso a ' + socias + ' para firmarla.' : '⚠ Este proyecto no tiene socia asignada: nadie puede firmarla.'}` })
            setTab('cartas'); setVista('por_firmar')
            await cargar(); setAbierta(r.id)
          }} />
      )}

      {carta && (
        <DetalleCarta c={carta} proyecto={carta.membrete || projects.find(p => p.id === carta.project_id)} profile={profile} esFact={esFact}
          onCerrar={() => setAbierta(null)}
          onCambio={async t => { if (t) setMsg({ ok: true, t }); await cargar() }} />
      )}
    </>
  )
}

// ------------------------------------------------------------------
// Los clientes con N o más cuotas vencidas
// ------------------------------------------------------------------
function PorNotificar({ pid, cartas, onCrear, onAbrir }) {
  const [minimo, setMinimo] = useState(2)
  const [filas, setFilas] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let vivo = true
    setFilas(null); setErr('')
    supabase.rpc('cartas_por_notificar', { p_project: pid, p_minimo: minimo }).then(({ data, error }) => {
      if (!vivo) return
      if (error) { setErr(error.message); setFilas([]); return }
      setFilas(data || [])
    })
    return () => { vivo = false }
  }, [pid, minimo, cartas.length])
  const sinCarta = (filas || []).filter(f => !f.ultima || !enCurso(f.ultima.estado))
  const deuda = (filas || []).reduce((s, f) => s + Number(f.deuda || 0), 0)

  return (<>
    <div className="chips">
      <span className="muted small">Desde</span>
      {[2, 3, 4, 6].map(n => (
        <button key={n} className={`chip ${minimo === n ? 'on' : ''}`} onClick={() => setMinimo(n)}>{n}{n === 6 ? '+' : ''} cuotas vencidas</button>
      ))}
    </div>
    {err && <p className="error">{err}</p>}
    {filas === null && <p className="muted">Cargando…</p>}
    {filas && !filas.length && !err && <p className="ok">✅ Nadie tiene {minimo} o más cuotas vencidas en este proyecto.</p>}
    {!!filas?.length && (<>
      <p className="hint" style={{ textTransform: 'none' }}>
        <b>{filas.length}</b> cliente{filas.length === 1 ? '' : 's'} con {minimo} o más cuotas vencidas · deuda vencida <b>{soles(deuda)}</b> · <b>{sinCarta.length}</b> sin carta en curso.
      </p>
      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Lote</th><th>Cliente</th><th style={{ textAlign: 'right' }}>Vencidas</th><th style={{ textAlign: 'right' }}>Deuda</th><th>Atraso</th><th>Cartas</th><th></th></tr></thead>
          <tbody>
            {filas.map(f => {
              const u = f.ultima
              const enC = u && enCurso(u.estado)
              return (
                <tr key={f.sale_id}>
                  <td><Link to={`/lotes/${f.lot_id}`}><b>{f.lote}</b></Link></td>
                  <td className="small" style={{ textTransform: 'none', whiteSpace: 'normal', minWidth: 160 }}>{f.cliente}{f.telefono && <div className="muted">{f.telefono}</div>}</td>
                  <td style={{ textAlign: 'right' }}><b className="bad">{f.n}</b></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{soles(f.deuda)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{f.atraso} días<div className="muted small">desde {fechaPe(f.desde)}</div></td>
                  <td className="small" style={{ textTransform: 'none' }}>
                    {!u ? <span className="muted">ninguna</span>
                      : <>N° {u.numero} · {(ESTADOS[u.estado] || {}).t}{u.resultado && RESULTADOS[u.resultado] ? ' · ' + RESULTADOS[u.resultado].t : ''}</>}
                  </td>
                  <td>{enC
                    ? <button className="btn-ghost" onClick={() => onAbrir(u.id)}>Ver carta</button>
                    : <button className="btn-primary" onClick={() => onCrear(f.sale_id)}>📨 Crear carta</button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>)}
  </>)
}

// ------------------------------------------------------------------
// Crear una carta: elegir la plantilla, revisar el texto y mandarla a firmar
// ------------------------------------------------------------------
function CrearCarta({ saleId, onCerrar, onCreada }) {
  const [datos, setDatos] = useState(null)
  const [plantillas, setPlantillas] = useState([])
  const [tpl, setTpl] = useState('')
  const [texto, setTexto] = useState('')
  const [plazo, setPlazo] = useState(7)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      const { data: d, error } = await supabase.rpc('carta_datos', { p_sale: saleId })
      if (error) { setErr(error.message); return }
      const { data: ts } = await supabase.rpc('carta_plantillas_listar', { p_project: d.project_id })
      const activas = (ts || []).filter(t => t.activa)
      // la del proyecto primero; si no tiene, la general
      const pref = activas.find(t => t.project_id === d.project_id) || activas[0]
      setDatos(d); setPlantillas(activas)
      if (pref) elegir(pref, d)
    })()
  }, [saleId])

  function elegir(t, d = datos) {
    setTpl(t.id); setPlazo(t.plazo_dias)
    setTexto(llenarPlantilla(t.cuerpo, d, t.plazo_dias))
  }

  async function crear() {
    const t = plantillas.find(x => x.id === tpl)
    if (texto.includes('________') && !(await confirmar('La carta tiene datos en blanco (________): falta algo del cliente, como su dirección o su documento.\n\n¿La mandas a firmar así?', { aceptar: 'Sí, mandar así' }))) return
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('carta_crear', {
      p_sale: saleId, p_plantilla: tpl || null, p_asunto: t?.asunto || '', p_cuerpo: texto, p_plazo: Number(plazo) || 7,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onCreada(data)
  }

  return (
    <div className="modal-bg" onClick={onCerrar}>
      <div className="glass modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 820, width: '96%', maxHeight: '94vh', overflowY: 'auto' }}>
        <div className="modal-head">
          <b>📨 NUEVA CARTA {datos ? '· LOTE ' + datos.lote : ''}</b>
          <button className="btn-ghost" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        {!datos && !err && <p className="muted">Cargando los datos del cliente…</p>}
        {err && <p className="error" style={{ textTransform: 'none' }}>{err}</p>}
        {datos && (<>
          <p style={{ textTransform: 'none', margin: '0 0 8px' }}>
            <b>{datos.cliente}</b> · {datos.doc_tipo} {datos.dni || '—'} · {datos.proyecto}<br />
            <span className="bad"><b>{datos.cuotas_vencidas}</b> cuota{datos.cuotas_vencidas === 1 ? '' : 's'} vencida{datos.cuotas_vencidas === 1 ? '' : 's'} · <b>{soles(datos.deuda)}</b></span>
            {datos.cartas_previas > 0 && <span className="muted"> · ya tuvo {datos.cartas_previas} carta{datos.cartas_previas === 1 ? '' : 's'}</span>}
          </p>
          {!datos.socias.length && <p className="warn">⚠ Este proyecto no tiene una socia asignada: la carta se crea pero nadie la puede firmar. Pídele al superusuario que la asigne en Usuarios.</p>}
          {datos.cuotas_vencidas === 0 && <p className="warn">⚠ Este cliente ya no tiene cuotas vencidas.</p>}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 8 }}>
            <label style={{ flex: '1 1 260px' }}>Tipo de carta
              <select value={tpl} onChange={e => { const t = plantillas.find(x => x.id === e.target.value); if (t) elegir(t) }}>
                {!plantillas.length && <option value="">— no hay plantillas —</option>}
                {plantillas.map(t => <option key={t.id} value={t.id}>{t.nombre}{t.project_id ? '' : ' (general)'}</option>)}
              </select>
            </label>
            <label style={{ width: 130 }}>Plazo (días)
              <input type="number" min="1" max="90" value={plazo} onChange={e => setPlazo(e.target.value)} />
            </label>
          </div>
          <label>El texto de la carta (lo puedes corregir antes de mandarlo a firmar)
            <textarea className="carta-texto" value={texto} onChange={e => setTexto(e.target.value)} />
          </label>
          <p className="muted small" style={{ textTransform: 'none' }}>
            El membrete del proyecto, la firma de la socia y el código de verificación se agregan solos al PDF.
            Si cambias el plazo aquí, corrígelo también en el texto.
          </p>
          {err && <p className="error">{err}</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-primary" disabled={busy || texto.trim().length < 20} onClick={crear}>{busy ? 'Creando…' : '✍ Crear y mandar a firmar'}</button>
            <button className="btn-ghost" onClick={onCerrar}>Cancelar</button>
          </div>
        </>)}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Una carta: la hoja, sus pasos y lo que se puede hacer ahora
// ------------------------------------------------------------------
function DetalleCarta({ c, proyecto, profile, esFact, onCerrar, onCambio }) {
  const trabaja = c.acceso === 'trabajar'
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(c.cuerpo)
  const [panel, setPanel] = useState(null)     // 'papel' | 'wsp' | 'resultado'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const firmada = !['por_firmar', 'anulada'].includes(c.estado)
  const viva = ['firmada', 'entregada'].includes(c.estado)

  const pasos = [
    ['Creada', true],
    ['Firmada', firmada],
    ['Impresa', c.impresiones > 0],
    ['Entregada', !!(c.papel_at || c.wsp_at)],
    ['Resultado', c.estado === 'cerrada'],
  ]
  const ahora = pasos.findIndex(p => !p[1])

  async function rpc(fn, args, ok) {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) { setErr(error.message); return false }
    await onCambio(ok)
    return true
  }

  async function guardarTexto() {
    if (await rpc('carta_editar', { p_id: c.id, p_asunto: c.asunto, p_cuerpo: texto, p_plazo: c.plazo_dias }, '✅ Texto de la carta N° ' + c.numero + ' guardado.')) setEditando(false)
  }

  async function anular() {
    const m = await pedir('¿Por qué se anula la carta N° ' + c.numero + '?', { tipo: 'largo', obligatorio: true, titulo: 'Anular carta', aceptar: 'Anular', peligro: true })
    if (m === null) return
    await rpc('carta_anular', { p_id: c.id, p_motivo: m }, '✅ Carta N° ' + c.numero + ' anulada.')
  }

  // el PDF se abre en otra pestaña para imprimirlo o guardarlo
  async function imprimir() {
    const w = window.open('', '_blank')
    setBusy(true); setErr('')
    try {
      const doc = await cartaPdf(c, proyecto)
      const url = URL.createObjectURL(doc.output('blob'))
      if (w) w.location.href = url
      else { const a = document.createElement('a'); a.href = url; a.download = nombrePdf(c); a.click() }
      setTimeout(() => URL.revokeObjectURL(url), 120000)
      if (firmada) await supabase.rpc('carta_impresa', { p_id: c.id })
      await onCambio(null)
    } catch (e) { if (w) w.close(); setErr('No se pudo armar el PDF: ' + e.message) }
    setBusy(false)
  }

  return (
    <div className="modal-bg" onClick={onCerrar}>
      <div className="glass modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 820, width: '96%', maxHeight: '94vh', overflowY: 'auto' }}>
        <div className="modal-head">
          <b>📨 CARTA N° {c.numero} · LOTE {c.lote}</b>
          <button className="btn-ghost" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        <p style={{ textTransform: 'none', margin: '0 0 4px' }}>
          <b>{c.cliente}</b> · {c.proyecto} · {c.tipo}<br />
          <span className="muted small">{c.cuotas_vencidas} cuota{c.cuotas_vencidas === 1 ? '' : 's'} vencida{c.cuotas_vencidas === 1 ? '' : 's'} · {soles(c.deuda)} al crearla · creada por {c.creado_nombre || '—'} el {fechaHora(c.creado_at)}</span>
          {!esFact && <> · <Link className="small" to={`/lotes/${c.lot_id}`}>ver la ficha del lote</Link></>}
        </p>

        {c.estado === 'anulada'
          ? <p className="warn" style={{ textTransform: 'none' }}>✖ Anulada el {fechaHora(c.anulada_at)}: {c.anulada_motivo}</p>
          : <div className="carta-pasos">{pasos.map(([t, ok], i) => <span key={t} className={ok ? 'hecho' : i === ahora ? 'ahora' : ''}>{ok ? '✔ ' : ''}{t}</span>)}</div>}

        {/* ---- la hoja ---- */}
        {editando
          ? <textarea className="carta-texto" value={texto} onChange={e => setTexto(e.target.value)} autoFocus />
          : (
            <div className="carta-hoja">
              {c.cuerpo}
              <div className="carta-firma">
                {c.firma_url ? <img src={c.firma_url} alt="Firma" crossOrigin="anonymous" /> : <div style={{ height: 64 }} />}
                <div className="raya" />
                <b>{c.firmado_nombre || 'Pendiente de la firma de la socia'}</b>
                {c.firmado_dni && <div>DNI {c.firmado_dni}</div>}
              </div>
              <div className="carta-pie">{c.codigo
                ? <>Firmado en el sistema por {c.firmado_nombre} el {fechaHora(c.firmado_at)} · código de verificación <b>{c.codigo}</b></>
                : 'BORRADOR — sin firma: no se puede imprimir ni entregar'}</div>
            </div>
          )}

        {/* ---- lo que ya pasó ---- */}
        <div className="small" style={{ textTransform: 'none', marginTop: 10, lineHeight: 1.7 }}>
          {c.impresiones > 0 && <div>🖨 Impresa {c.impresiones} vez{c.impresiones === 1 ? '' : 'es'} (última: {fechaHora(c.impresa_at)})</div>}
          {c.papel_at && <div>📄 Entregada en papel el <b>{fechaHora(c.papel_at)}</b> · la recibió <b>{c.papel_recibio}</b>
            {c.papel_cargo_url && <> · <a href={c.papel_cargo_url} target="_blank" rel="noreferrer">ver el cargo ↗</a></>}</div>}
          {c.wsp_at && <div>💬 Enviada por WhatsApp al {c.wsp_a} el {fechaHora(c.wsp_at)} ·{' '}
            {c.wsp_estado === 'enviado' ? <b className="ok">entregada</b> : c.wsp_estado === 'fallido' ? <b className="error">falló{c.wsp_error ? ': ' + c.wsp_error : ''}</b> : <span className="warn">saliendo…</span>}
            {c.pdf_url && <> · <a href={c.pdf_url} target="_blank" rel="noreferrer">PDF enviado ↗</a></>}</div>}
          {c.plazo_vence && c.estado === 'entregada' && <div>⏰ Plazo hasta el <b>{fechaLarga(c.plazo_vence)}</b>{c.plazo_vence < hoyPe() ? <b className="error"> · VENCIDO</b> : ''}</div>}
          {c.estado === 'cerrada' && RESULTADOS[c.resultado] && (
            <div>{RESULTADOS[c.resultado].i} <b>{RESULTADOS[c.resultado].t}</b>
              {c.resultado === 'acuerdo' && <> · pagará <b>{soles(c.acuerdo_monto)}</b> hasta el <b>{fechaPe(c.acuerdo_fecha)}</b></>}
              {c.resultado_nota && <> · {c.resultado_nota}</>}
              <span className="muted"> · {c.resultado_nombre || ''} {fechaHora(c.resultado_at)}</span></div>
          )}
        </div>

        {err && <p className="error" style={{ textTransform: 'none' }}>{err}</p>}

        {/* ---- por firmar ---- */}
        {c.estado === 'por_firmar' && (<>
          {c.puedo_firmar && !editando && (
            <FirmarCarta c={c} profile={profile}
              onHecho={t => onCambio(t)} />
          )}
          {!c.puedo_firmar && <p className="hint" style={{ textTransform: 'none' }}>✍ Esperando la firma de la socia del proyecto. Ya le llegó el aviso por WhatsApp y Telegram.</p>}
          {trabaja && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {editando
                ? <>
                    <button className="btn-primary" disabled={busy} onClick={guardarTexto}>{busy ? 'Guardando…' : 'Guardar el texto'}</button>
                    <button className="btn-ghost" onClick={() => { setEditando(false); setTexto(c.cuerpo) }}>Cancelar</button>
                  </>
                : <button className="btn-ghost" onClick={() => setEditando(true)}>✏ Corregir el texto</button>}
              <button className="btn-ghost" style={{ color: '#ff8e7a' }} onClick={anular}>Anular</button>
            </div>
          )}
        </>)}

        {/* ---- firmada: imprimir, entregar y resultado ---- */}
        {firmada && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn-primary" disabled={busy} onClick={imprimir}>🖨 Imprimir / PDF</button>
            {viva && trabaja && <>
              <button className={`btn-ghost ${panel === 'papel' ? 'on' : ''}`} onClick={() => setPanel(panel === 'papel' ? null : 'papel')}>📄 Entregada en papel</button>
              <button className={`btn-ghost ${panel === 'wsp' ? 'on' : ''}`} onClick={() => setPanel(panel === 'wsp' ? null : 'wsp')}>💬 Enviar por WhatsApp</button>
            </>}
            {viva && (trabaja || c.puedo_firmar) && (
              <button className={`btn-ghost ${panel === 'resultado' ? 'on' : ''}`} onClick={() => setPanel(panel === 'resultado' ? null : 'resultado')}>🏁 Anotar resultado</button>
            )}
            {viva && trabaja && c.estado === 'firmada' && <button className="btn-ghost" style={{ color: '#ff8e7a' }} onClick={anular}>Anular</button>}
          </div>
        )}
        {panel === 'papel' && viva && <EntregaPapel c={c} busy={busy} rpc={rpc} onListo={() => setPanel(null)} />}
        {panel === 'wsp' && viva && <EnviarWsp c={c} proyecto={proyecto} onCambio={onCambio} onListo={() => setPanel(null)} />}
        {panel === 'resultado' && viva && <Resultado c={c} busy={busy} rpc={rpc} onListo={() => setPanel(null)} />}
      </div>
    </div>
  )
}

function EntregaPapel({ c, busy, rpc, onListo }) {
  const [recibio, setRecibio] = useState('')
  const [fecha, setFecha] = useState(hoyPe())
  const [foto, setFoto] = useState(null)
  const [subiendo, setSubiendo] = useState(false)
  async function guardar() {
    let url = null
    if (foto) {
      setSubiendo(true)
      try { url = await upload(`cobranza/cargos/carta-${c.numero}`, foto) } catch (e) { setSubiendo(false); avisar('No se pudo subir la foto del cargo: ' + e.message, { tono: 'error' }); return }
      setSubiendo(false)
    } else if (!(await confirmar('No subiste la foto del cargo (la copia firmada por quien la recibió).\n\n¿Registrar la entrega sin foto?', { aceptar: 'Sí, sin foto' }))) return
    if (await rpc('carta_entrega_papel', { p_id: c.id, p_recibio: recibio, p_cargo_url: url, p_fecha: fecha },
      '✅ Carta N° ' + c.numero + ' entregada en papel. Desde hoy corren sus ' + c.plazo_dias + ' días de plazo.')) onListo()
  }
  return (
    <div className="glass" style={{ padding: 12, marginTop: 10 }}>
      <b>📄 Entrega en papel</b>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
        <label style={{ flex: '1 1 240px' }}>¿Quién la recibió?
          <input value={recibio} onChange={e => setRecibio(e.target.value)} placeholder="El titular, su esposa María…, nadie: bajo la puerta" style={{ textTransform: 'none' }} />
        </label>
        <label style={{ width: 160 }}>Fecha
          <input type="date" value={fecha} max={hoyPe()} onChange={e => setFecha(e.target.value)} />
        </label>
      </div>
      <label style={{ marginTop: 6 }}>Foto del cargo (la copia con la firma de quien la recibió)
        <input type="file" accept="image/*,.pdf" onChange={e => setFoto(e.target.files[0] || null)} />
      </label>
      <button className="btn-primary" style={{ marginTop: 8 }} disabled={busy || subiendo || recibio.trim().length < 3} onClick={guardar}>
        {subiendo ? 'Subiendo la foto…' : busy ? 'Guardando…' : 'Registrar la entrega'}</button>
    </div>
  )
}

function EnviarWsp({ c, proyecto, onCambio, onListo }) {
  const tels = c.telefonos || []
  const [tel, setTel] = useState(tels[0] || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [manual, setManual] = useState(null)   // enlace wa.me si el proyecto no tiene WhatsApp
  async function enviar() {
    setBusy(true); setErr(''); setManual(null)
    try {
      const url = await subirPdf(c, proyecto)
      const { error } = await supabase.rpc('carta_enviar_wsp', { p_id: c.id, p_telefono: tel, p_pdf_url: url })
      if (error) {
        setErr(error.message)
        if (/Abrir WhatsApp/i.test(error.message)) {
          let d = String(tel).replace(/\D/g, ''); if (d.length === 9) d = '51' + d
          const texto = `Buen día, ${c.cliente}. Le hacemos llegar la carta N° ${c.numero} sobre su lote ${c.lote} de ${c.proyecto}: ${url}`
          setManual(`https://wa.me/${d}?text=${encodeURIComponent(texto)}`)
        }
      } else { await onCambio('✅ Carta N° ' + c.numero + ' saliendo por WhatsApp al ' + tel + ' con el PDF firmado.'); onListo() }
    } catch (e) { setErr('No se pudo preparar el PDF: ' + e.message) }
    setBusy(false)
  }
  return (
    <div className="glass" style={{ padding: 12, marginTop: 10 }}>
      <b>💬 Enviar el PDF firmado por WhatsApp</b>
      <p className="muted small" style={{ textTransform: 'none', margin: '4px 0' }}>Sale por el WhatsApp del proyecto, con un mensaje corto y la carta adjunta. Cuenta como entregada (el plazo empieza hoy si no se entregó antes en papel).</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        {tels.length > 1 && (
          <label>Número del cliente
            <select value={tels.includes(tel) ? tel : ''} onChange={e => setTel(e.target.value)}>
              {tels.map(t => <option key={t} value={t}>{t}</option>)}
              <option value="">otro…</option>
            </select>
          </label>
        )}
        <label style={{ flex: '1 1 180px' }}>Celular
          <input value={tel} onChange={e => setTel(e.target.value)} inputMode="tel" placeholder="9 dígitos" />
        </label>
        <button className="btn-primary" disabled={busy || String(tel).replace(/\D/g, '').length < 9} onClick={enviar}>{busy ? 'Preparando…' : 'Enviar'}</button>
      </div>
      {err && <p className="error" style={{ textTransform: 'none' }}>{err}</p>}
      {manual && <p><a className="btn-ghost btn-link" href={manual} target="_blank" rel="noreferrer">Abrir WhatsApp</a> <span className="muted small" style={{ textTransform: 'none' }}>(sale de tu WhatsApp con el enlace al PDF; después registra la entrega en papel o pide que se conecte el número del proyecto)</span></p>}
    </div>
  )
}

function Resultado({ c, busy, rpc, onListo }) {
  const [r, setR] = useState('')
  const [nota, setNota] = useState('')
  const [fecha, setFecha] = useState('')
  const [monto, setMonto] = useState('')
  async function guardar() {
    const def = RESULTADOS[r]
    if (r === 'expropiar' && !(await confirmar('Se anota la decisión de EXPROPIAR y el caso se cierra.\n\nLa expropiación en sí (el lote, la venta y el acta) se hace después en la ficha del lote, como siempre: solo el superusuario.', { aceptar: 'Anotar', peligro: true }))) return
    if (await rpc('carta_resultado', { p_id: c.id, p_resultado: r, p_nota: nota, p_acuerdo_fecha: r === 'acuerdo' ? fecha : null, p_acuerdo_monto: r === 'acuerdo' ? Number(monto) : null },
      '✅ Carta N° ' + c.numero + ': ' + def.t + (def.cierra ? '. Caso cerrado.' : r === 'acuerdo' ? '. Cambia el cronograma en la ficha del lote.' : '.'))) onListo()
  }
  return (
    <div className="glass" style={{ padding: 12, marginTop: 10 }}>
      <b>🏁 Resultado</b>
      <div className="chips" style={{ marginTop: 6 }}>
        {Object.entries(RESULTADOS).map(([k, v]) => (
          <button key={k} className={`chip ${r === k ? 'on' : ''}`} onClick={() => setR(k)}>{v.i} {v.t}</button>
        ))}
      </div>
      {r === 'acuerdo' && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ width: 170 }}>Pagará hasta el
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </label>
          <label style={{ width: 170 }}>Monto que se compromete
            <input type="number" min="0" step="0.01" value={monto} onChange={e => setMonto(e.target.value)} />
          </label>
        </div>
      )}
      {r && (
        <label style={{ marginTop: 6 }}>Nota{['otro', 'expropiar', 'acuerdo'].includes(r) ? ' (obligatoria)' : ''}
          <textarea rows="2" value={nota} onChange={e => setNota(e.target.value)} style={{ textTransform: 'none' }}
            placeholder={r === 'acuerdo' ? 'Ej: paga 2 cuotas el 30/10 y el resto en noviembre; se reprograma el cronograma' : ''} />
        </label>
      )}
      {r === 'acuerdo' && <p className="muted small" style={{ textTransform: 'none' }}>El cronograma se cambia en la ficha del lote (pestaña Cuotas). El caso queda abierto para seguir el acuerdo.</p>}
      {r === 'escalar' && <p className="muted small" style={{ textTransform: 'none' }}>El caso sigue abierto: crea la carta siguiente desde "Por notificar".</p>}
      <button className="btn-primary" style={{ marginTop: 8 }} disabled={busy || !r} onClick={guardar}>{busy ? 'Guardando…' : 'Guardar el resultado'}</button>
    </div>
  )
}

// ------------------------------------------------------------------
// Plantillas: una por tipo de carta y por proyecto (o general)
// ------------------------------------------------------------------
function Plantillas({ pid, projects }) {
  const [lista, setLista] = useState(null)
  const [ed, setEd] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useMsg(null)
  const cargar = () => supabase.rpc('carta_plantillas_listar', { p_project: pid }).then(({ data, error }) => {
    if (error) setErr(error.message)
    setLista(data || [])
  })
  useEffect(() => { cargar() }, [pid])

  async function guardar() {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('carta_plantilla_guardar', {
      p_id: ed.id || null, p_project: ed.project_id || null, p_nombre: ed.nombre, p_asunto: ed.asunto || '',
      p_cuerpo: ed.cuerpo, p_plazo: Number(ed.plazo_dias) || 7, p_activa: ed.activa !== false,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setMsg({ ok: true, t: '✅ Plantilla "' + ed.nombre + '" guardada.' })
    setEd(null); cargar()
  }

  if (ed) return (
    <div className="glass" style={{ padding: 14 }}>
      <b>{ed.id ? 'Editar plantilla' : 'Nueva plantilla'}</b>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
        <label style={{ flex: '1 1 260px' }}>Nombre (tipo de carta)
          <input value={ed.nombre} onChange={e => setEd({ ...ed, nombre: e.target.value })} style={{ textTransform: 'none' }} placeholder="Carta de requerimiento de pago" />
        </label>
        <label style={{ flex: '1 1 200px' }}>Proyecto
          <select value={ed.project_id || ''} onChange={e => setEd({ ...ed, project_id: e.target.value || null })}>
            <option value="">Todos los proyectos</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label style={{ width: 120 }}>Plazo (días)
          <input type="number" min="1" max="90" value={ed.plazo_dias} onChange={e => setEd({ ...ed, plazo_dias: e.target.value })} />
        </label>
        <label style={{ width: 120, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={ed.activa !== false} onChange={e => setEd({ ...ed, activa: e.target.checked })} style={{ width: 'auto' }} /> Activa
        </label>
      </div>
      <label>Resumen (se ve en la lista de cartas)
        <input value={ed.asunto || ''} onChange={e => setEd({ ...ed, asunto: e.target.value })} style={{ textTransform: 'none' }} />
      </label>
      <label>Texto de la carta
        <textarea className="carta-texto" value={ed.cuerpo} onChange={e => setEd({ ...ed, cuerpo: e.target.value })} />
      </label>
      <details style={{ margin: '6px 0' }}>
        <summary className="small">Datos que se llenan solos (escríbelos entre llaves)</summary>
        <table className="small" style={{ textTransform: 'none' }}><tbody>
          {VARIABLES.map(([k, t]) => <tr key={k}><td><code>{'{' + k + '}'}</code></td><td className="muted">{t}</td></tr>)}
        </tbody></table>
      </details>
      {err && <p className="error" style={{ textTransform: 'none' }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-primary" disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : 'Guardar'}</button>
        <button className="btn-ghost" onClick={() => { setEd(null); setErr('') }}>Cancelar</button>
      </div>
    </div>
  )

  return (<>
    {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
    {err && <p className="error" style={{ textTransform: 'none' }}>{err}</p>}
    <p className="muted small" style={{ textTransform: 'none' }}>
      Cada tipo de carta es una plantilla. La del proyecto se usa primero; la general sirve para los proyectos que no tienen la suya.
    </p>
    <button className="btn-primary" style={{ marginBottom: 10 }}
      onClick={() => setEd({ nombre: '', project_id: pid || null, asunto: '', cuerpo: (lista || [])[0]?.cuerpo || '', plazo_dias: 7, activa: true })}>+ Nueva plantilla</button>
    {lista === null && <p className="muted">Cargando…</p>}
    {!!lista?.length && (
      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Nombre</th><th>Proyecto</th><th>Plazo</th><th>Estado</th><th>Cambiada</th><th></th></tr></thead>
          <tbody>{lista.map(t => (
            <tr key={t.id}>
              <td style={{ textTransform: 'none' }}><b>{t.nombre}</b>{t.asunto && <div className="muted small">{t.asunto}</div>}</td>
              <td className="small">{t.proyecto || 'Todos'}</td>
              <td>{t.plazo_dias} días</td>
              <td>{t.activa ? <span className="st-chip st-ok">activa</span> : <span className="st-chip st-na">inactiva</span>}</td>
              <td className="small">{fechaHora(t.actualizado_at)}</td>
              <td><button className="btn-ghost" onClick={() => setEd({ ...t })}>Editar</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    )}
  </>)
}
