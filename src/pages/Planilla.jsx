import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { upload } from '../lib/archivos'
import { useMsg, savedFx } from '../lib/saveFx'
import { avisar, confirmar, pedirDatos } from '../lib/dialogos'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import { hoyPe } from '../lib/cobros'
import { fechaPe } from '../lib/lotes'
import {
  PERIODICIDAD, SUELDO_POR, TIPOS, ORDEN_TIPOS, periodoDe, periodoAnterior, periodoSiguiente, nombrePeriodo,
  tardanzaPorDefecto, faltaPorDefecto, cuentas, repartoPorProyecto,
} from '../lib/planilla'

// PLANILLA (sql/131, 9 oct 2026): una sola para todo Urbis. Por cada trabajador se
// anotan adelantos, descuentos, tardanzas, faltas y bonos; al cerrar el periodo
// (semana, quincena o mes, según el trabajador) queda lo que se le paga.
// Va APARTE de Gastos: no crea gastos, solo calcula (decisión del dueño).
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const r2 = n => Math.round(Number(n || 0) * 100) / 100
const VACIO_T = { nombre: '', dni: '', cargo: '', celular: '', periodicidad: 'mensual', sueldo: '', fecha_ingreso: '', descuento_tardanza: '', proyectos: [], activo: true, notas: '' }

export default function Planilla() {
  const { profile, esSuper } = useAuth()
  const { projects } = useProject()
  const [msg, setMsg] = useMsg(null)
  const [cfg, setCfg] = useState(null)
  const [trab, setTrab] = useState([])
  const [movs, setMovs] = useState([])           // movimientos abiertos (sin cierre) de todos
  const [pers, setPers] = useState([])           // los cierres
  const [faltaBase, setFaltaBase] = useState(false)
  const [tab, setTab] = useState('trabajadores')
  const [q, setQ] = useState('')
  const [verInactivos, setVerInactivos] = useState(false)
  const [ficha, setFicha] = useState(null)       // id del trabajador abierto
  const [formT, setFormT] = useState(null)       // trabajador que se crea o edita
  const [mesCierres, setMesCierres] = useState(() => hoyPe().slice(0, 7))
  const hoy = hoyPe()
  const nombreProy = id => projects.find(p => p.id === id)?.name || 'Sin proyecto'

  async function cargar() {
    const [c, t, m, p] = await Promise.all([
      supabase.from('planilla_config').select('*').maybeSingle(),
      supabase.from('planilla_trabajadores').select('*').order('nombre'),
      supabase.from('planilla_movimientos').select('*').is('periodo_id', null).order('fecha').order('created_at'),
      supabase.from('planilla_periodos').select('*').order('desde', { ascending: false }),
    ])
    if (t.error) { setFaltaBase(/planilla_/.test(t.error.message) || t.error.code === '42P01' || t.error.code === 'PGRST205'); if (!/planilla_/.test(t.error.message)) setMsg({ ok: false, t: t.error.message }); return }
    setCfg(c.data || { descuento_tardanza: 0 }); setTrab(t.data || []); setMovs(m.data || []); setPers(p.data || [])
  }
  useEffect(() => { cargar() }, [])

  // por trabajador: su periodo de hoy, sus cuentas y si quedó uno anterior sin cerrar
  const filas = useMemo(() => trab
    .filter(t => verInactivos || t.activo)
    .filter(t => !q.trim() || [t.nombre, t.cargo, t.dni].join(' ').toLowerCase().includes(q.trim().toLowerCase()))
    .map(t => {
      const p = periodoDe(hoy, t.periodicidad)
      const delPeriodo = movs.filter(m => m.trabajador_id === t.id && m.fecha >= p.desde && m.fecha <= p.hasta)
      const ant = periodoAnterior(p, t.periodicidad)
      const cerrados = pers.filter(x => x.trabajador_id === t.id)
      const antCerrado = cerrados.some(x => x.desde <= ant.hasta && x.hasta >= ant.desde)
      // se avisa si ese periodo tiene movimientos, o si ya se le venían cerrando periodos
      // (al que se carga hoy no se le piden los meses de antes que nunca se llevaron aquí)
      const ingreso = t.fecha_ingreso || t.created_at?.slice(0, 10) || ''
      const trabajabaAntes = movs.some(m => m.trabajador_id === t.id && m.fecha >= ant.desde && m.fecha <= ant.hasta) ||
        (cerrados.length > 0 && ingreso <= ant.hasta)
      const pendientes = movs.filter(m => m.trabajador_id === t.id && m.fecha < p.desde && !m.anulado_at).length
      // si el periodo de hoy ya se cerró, manda el cierre (sus movimientos ya no están entre los abiertos)
      const cierreHoy = cerrados.find(x => x.desde <= p.hasta && x.hasta >= p.desde) || null
      const c = cierreHoy
        ? Object.fromEntries(['sueldo', 'bonos', 'adelantos', 'descuentos', 'tardanzas', 'n_tardanzas', 'faltas', 'n_faltas', 'neto'].map(k => [k, Number(cierreHoy[k] || 0)]))
        : cuentas(t.sueldo, delPeriodo)
      return { t, p, c, cierreHoy, sinCerrar: !antCerrado && trabajabaAntes ? ant : null, pendientes }
    }), [trab, movs, pers, q, verInactivos, hoy])

  // lo que falta pagar de los periodos de hoy: los ya pagados no cuentan
  const totalHoy = filas.filter(f => f.t.activo && f.cierreHoy?.estado !== 'pagado').reduce((s, f) => s + f.c.neto, 0)

  async function editarConfig() {
    const datos = await pedirDatos({
      titulo: 'Descuento por tardanza',
      mensaje: 'Monto fijo que se descuenta por cada tardanza. Al anotar una tardanza se puede poner otro monto, y cada trabajador puede tener el suyo en su ficha.',
      campos: [{ clave: 'monto', etiqueta: 'Monto por tardanza (S/)', tipo: 'monto', valor: String(cfg?.descuento_tardanza ?? 0), obligatorio: true }],
    })
    if (datos === null) return
    const v = r2(String(datos.monto).replace(',', '.'))
    if (!(v >= 0)) { await avisar('Monto inválido.'); return }
    const { error } = await supabase.from('planilla_config').update({ descuento_tardanza: v, updated_at: new Date().toISOString(), updated_by: profile?.id || null }).eq('id', 1)
    if (error) { setMsg({ ok: false, t: error.message }); return }
    setMsg({ ok: true, t: 'DESCUENTO POR TARDANZA: ' + soles(v) }); savedFx(); cargar()
  }

  if (faltaBase) return (
    <>
      <div className="toolbar"><h1 style={{ margin: 0, flex: 1 }}>Planilla</h1></div>
      <p className="hint">Falta correr <b>sql/131_planilla.sql</b> en el servidor: la planilla todavía no tiene sus tablas.</p>
    </>
  )

  const cierresMes = pers.filter(x => x.hasta.slice(0, 7) === mesCierres)
  const nombreT = id => trab.find(t => t.id === id)?.nombre || '-'
  const porProyecto = (() => {
    const m = new Map()
    for (const x of cierresMes) for (const r of repartoPorProyecto(x.neto, x.proyectos)) m.set(r.project_id, r2((m.get(r.project_id) || 0) + r.monto))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  })()
  const meses = [...new Set([hoy.slice(0, 7), ...pers.map(x => x.hasta.slice(0, 7))])].sort().reverse()

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Planilla</h1>
        <button className="btn-ghost" onClick={editarConfig} title="Monto fijo por cada tardanza">⏰ Tardanza: {soles(cfg?.descuento_tardanza)}</button>
        <button className="btn-primary" onClick={() => setFormT({ ...VACIO_T })}>+ Trabajador</button>
      </div>
      <p className="muted small" style={{ margin: '-.4rem 0 .8rem' }}>
        Adelantos, descuentos, tardanzas, faltas y bonos de cada trabajador. Al cerrar su periodo queda lo que se le paga.
        La planilla va aparte de Gastos: no crea gastos.
      </p>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      <div className="chips">
        <button className={`chip ${tab === 'trabajadores' ? 'on' : ''}`} onClick={() => setTab('trabajadores')}>👷 Trabajadores ({trab.filter(t => t.activo).length})</button>
        <button className={`chip ${tab === 'cierres' ? 'on' : ''}`} onClick={() => setTab('cierres')}>📒 Cierres ({pers.length})</button>
      </div>

      {tab === 'trabajadores' && (<>
        <div className="toolbar">
          <input className="search" placeholder="Buscar por nombre, cargo o DNI…" value={q} onChange={e => setQ(e.target.value)} />
          <label className="muted small" style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={verInactivos} onChange={e => setVerInactivos(e.target.checked)} /> ver los que ya no trabajan
          </label>
        </div>
        {!trab.length && <p className="muted">Todavía no hay trabajadores. Empieza con <b>+ Trabajador</b>.</p>}
        {!!filas.length && (
          <div className="glass table-wrap">
            <table>
              <thead><tr><th>Trabajador</th><th>Pago</th><th>Periodo de hoy</th><th>Movimientos del periodo</th><th style={{ textAlign: 'right' }}>A pagar</th></tr></thead>
              <tbody>
                {filas.map(({ t, p, c, cierreHoy, sinCerrar, pendientes }) => (
                  <tr key={t.id} style={t.activo ? {} : { opacity: .5 }}>
                    <td><button className="link-btn" onClick={() => setFicha(t.id)}><b>{t.nombre}</b></button>
                      <div className="muted small">{t.cargo || '—'}{!t.activo ? ' · ya no trabaja' : ''}</div>
                      {sinCerrar && <div className="warn small">⚠ falta cerrar: {nombrePeriodo(sinCerrar, t.periodicidad)}</div>}
                      {!sinCerrar && pendientes > 0 && <div className="warn small">⚠ {pendientes} movimiento(s) de periodos anteriores sin cerrar</div>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{PERIODICIDAD[t.periodicidad]}<div className="muted small">{soles(t.sueldo)} {SUELDO_POR[t.periodicidad]}</div></td>
                    <td className="small">{nombrePeriodo(p, t.periodicidad)}</td>
                    <td className="small planilla-movs">
                      {c.bonos > 0 && <span>🎁 +{soles(c.bonos)}</span>}
                      {c.adelantos > 0 && <span>💸 −{soles(c.adelantos)}</span>}
                      {c.descuentos > 0 && <span>➖ −{soles(c.descuentos)}</span>}
                      {c.n_tardanzas > 0 && <span>⏰ −{soles(c.tardanzas)} ({c.n_tardanzas})</span>}
                      {c.n_faltas > 0 && <span>🚫 −{soles(c.faltas)} ({c.n_faltas})</span>}
                      {!(c.bonos || c.adelantos || c.descuentos || c.n_tardanzas || c.n_faltas) && <span className="muted">—</span>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><b className={c.neto < 0 ? 'bad' : ''}>{soles(c.neto)}</b>
                      {cierreHoy && <div>{cierreHoy.estado === 'pagado'
                        ? <span className="st-chip st-ok">PAGADO</span>
                        : <span className="st-chip st-per">CERRADO</span>}</div>}</td>
                  </tr>
                ))}
                <tr className="fl-fila-total"><td colSpan="4">FALTA PAGAR DE LOS PERIODOS DE HOY (activos)</td><td style={{ textAlign: 'right' }}>{soles(totalHoy)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </>)}

      {tab === 'cierres' && (<>
        <div className="toolbar">
          <select value={mesCierres} onChange={e => setMesCierres(e.target.value)}>
            {meses.map(m => <option key={m} value={m}>{m.slice(5, 7)}/{m.slice(0, 4)}</option>)}
          </select>
          <span className="muted small">Periodos que terminan en ese mes.</span>
        </div>
        {!cierresMes.length && <p className="muted">No hay periodos cerrados en ese mes.</p>}
        {!!cierresMes.length && (
          <div className="glass table-wrap">
            <table>
              <thead><tr><th>Trabajador</th><th>Periodo</th><th style={{ textAlign: 'right' }}>Sueldo</th><th style={{ textAlign: 'right' }}>Bonos</th><th style={{ textAlign: 'right' }}>Adelantos</th><th style={{ textAlign: 'right' }}>Desc.</th><th style={{ textAlign: 'right' }}>Tardanzas</th><th style={{ textAlign: 'right' }}>Faltas</th><th style={{ textAlign: 'right' }}>Pagado / a pagar</th><th>Estado</th></tr></thead>
              <tbody>
                {cierresMes.map(x => (
                  <tr key={x.id}>
                    <td><button className="link-btn" onClick={() => setFicha(x.trabajador_id)}>{nombreT(x.trabajador_id)}</button></td>
                    <td className="small">{nombrePeriodo(x, x.periodicidad)}</td>
                    <td style={{ textAlign: 'right' }}>{soles(x.sueldo)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(x.bonos) ? '+' + soles(x.bonos) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{Number(x.adelantos) ? '−' + soles(x.adelantos) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{Number(x.descuentos) ? '−' + soles(x.descuentos) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{x.n_tardanzas ? <>−{soles(x.tardanzas)} <span className="muted small">({x.n_tardanzas})</span></> : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{x.n_faltas ? <>−{soles(x.faltas)} <span className="muted small">({x.n_faltas})</span></> : '—'}</td>
                    <td style={{ textAlign: 'right' }}><b>{soles(x.neto)}</b></td>
                    <td>{x.estado === 'pagado'
                      ? <span className="st-chip st-ok">PAGADO {x.pagado_el ? fechaPe(x.pagado_el) : ''}</span>
                      : <span className="st-chip st-per">POR PAGAR</span>}</td>
                  </tr>
                ))}
                <tr className="fl-fila-total"><td colSpan="8">TOTAL DEL MES</td><td style={{ textAlign: 'right' }}>{soles(cierresMes.reduce((s, x) => s + Number(x.neto), 0))}</td><td /></tr>
              </tbody>
            </table>
          </div>
        )}
        {porProyecto.length > 0 && (
          <div className="glass form-card" style={{ maxWidth: 520 }}>
            <p style={{ margin: '0 0 .4rem' }}><b>Por proyecto</b> <span className="muted small">(según el reparto de cada trabajador)</span></p>
            {porProyecto.map(([pid, monto]) => (
              <div key={pid || 'x'} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{pid ? nombreProy(pid) : 'Sin proyecto asignado'}</span><b>{soles(monto)}</b></div>
            ))}
          </div>
        )}
      </>)}

      {ficha && (
        <FichaTrabajador key={ficha} t={trab.find(t => t.id === ficha)} cfg={cfg} pers={pers.filter(x => x.trabajador_id === ficha)}
          esSuper={esSuper} nombreProy={nombreProy}
          onEditar={t => { setFicha(null); setFormT({ ...VACIO_T, ...t, sueldo: String(t.sueldo), descuento_tardanza: t.descuento_tardanza ?? '', fecha_ingreso: t.fecha_ingreso || '', proyectos: t.proyectos || [] }) }}
          onClose={() => setFicha(null)} onCambio={cargar} />
      )}
      {formT && <FormTrabajador inicial={formT} projects={projects} onClose={() => setFormT(null)}
        onListo={(t, nuevo) => { setFormT(null); setMsg({ ok: true, t: (nuevo ? 'TRABAJADOR AGREGADO: ' : 'DATOS GUARDADOS: ') + t.nombre }); savedFx(); cargar() }} />}
    </>
  )
}

// ---- ficha de un trabajador: sus periodos, uno por uno, con sus movimientos ----
function FichaTrabajador({ t, cfg, pers, esSuper, nombreProy, onEditar, onClose, onCambio }) {
  const hoy = hoyPe()
  const [p, setP] = useState(() => periodoDe(hoy, t.periodicidad))
  const [movs, setMovs] = useState(null)
  const [msg, setMsg] = useMsg(null)
  const [nuevo, setNuevo] = useState(null)       // tipo del movimiento que se anota
  const [busy, setBusy] = useState(false)
  const cierre = pers.find(x => x.desde <= p.hasta && x.hasta >= p.desde) || null

  async function cargarMovs() {
    const { data, error } = await supabase.from('planilla_movimientos').select('*').eq('trabajador_id', t.id)
      .gte('fecha', p.desde).lte('fecha', p.hasta).order('fecha').order('created_at')
    if (error) { setMsg({ ok: false, t: error.message }); return }
    setMovs(data || [])
  }
  useEffect(() => { cargarMovs() }, [p.desde, t.id])
  const c = cuentas(cierre ? cierre.sueldo : t.sueldo, movs || [])
  const terminado = p.hasta < hoy

  async function anular(m) {
    const datos = await pedirDatos({ titulo: 'Anular ' + TIPOS[m.tipo].label.toLowerCase(), mensaje: TIPOS[m.tipo].label + ' del ' + fechaPe(m.fecha) + ' por ' + soles(m.monto) + '. Queda a la vista, tachado, pero ya no cuenta.',
      campos: [{ clave: 'motivo', etiqueta: 'Motivo', tipo: 'largo', obligatorio: true }] })
    if (datos === null) return
    const { error } = await supabase.from('planilla_movimientos').update({ anulado_at: new Date().toISOString(), anulado_motivo: String(datos.motivo).trim().toUpperCase() }).eq('id', m.id)
    if (error) { setMsg({ ok: false, t: error.message }); return }
    setMsg({ ok: true, t: 'ANULADO' }); cargarMovs(); onCambio()
  }
  async function cerrar() {
    const txt = 'Cerrar ' + nombrePeriodo(p, t.periodicidad) + ' de ' + t.nombre + '?\n\n' +
      'Sueldo ' + soles(c.sueldo) + (c.bonos ? ' + bonos ' + soles(c.bonos) : '') + (c.adelantos ? ' − adelantos ' + soles(c.adelantos) : '') +
      (c.descuentos ? ' − descuentos ' + soles(c.descuentos) : '') + (c.tardanzas ? ' − tardanzas ' + soles(c.tardanzas) : '') + (c.faltas ? ' − faltas ' + soles(c.faltas) : '') +
      '\n= A PAGAR ' + soles(c.neto) + '\n\nDespués de cerrar ya no se agregan ni cambian movimientos de este periodo (se puede reabrir mientras no esté pagado).' +
      (terminado ? '' : '\n\nOjo: el periodo todavía no terminó.')
    if (!await confirmar(txt, { aceptar: 'Sí, cerrar' })) return
    setBusy(true)
    const { error } = await supabase.rpc('planilla_cerrar', { p_trabajador: t.id, p_desde: p.desde, p_hasta: p.hasta, p_nota: null })
    setBusy(false)
    if (error) { setMsg({ ok: false, t: error.message }); return }
    setMsg({ ok: true, t: 'PERIODO CERRADO: A PAGAR ' + soles(c.neto) }); savedFx(); onCambio(); cargarMovs()
  }
  async function pagado(file) {
    const datos = await pedirDatos({ titulo: 'Marcar como pagado', mensaje: nombrePeriodo(p, t.periodicidad) + ' · ' + soles(cierre.neto),
      campos: [{ clave: 'fecha', etiqueta: 'Fecha de pago', tipo: 'fecha', valor: hoy, obligatorio: true }] })
    if (datos === null) return
    setBusy(true)
    try {
      const url = file ? await upload('planilla/' + t.id, file) : null
      const { error } = await supabase.rpc('planilla_pagado', { p_periodo: cierre.id, p_fecha: datos.fecha, p_voucher: url })
      if (error) throw error
      setMsg({ ok: true, t: 'MARCADO COMO PAGADO' }); savedFx(); onCambio()
    } catch (e) { setMsg({ ok: false, t: e.message || String(e) }) }
    setBusy(false)
  }
  async function reabrir() {
    if (!await confirmar('¿Reabrir ' + nombrePeriodo(p, t.periodicidad) + '?\n\nEl cierre se borra y sus movimientos vuelven a poder editarse. Queda en la bitácora.', { aceptar: 'Sí, reabrir' })) return
    const { error } = await supabase.rpc('planilla_reabrir', { p_periodo: cierre.id })
    if (error) { setMsg({ ok: false, t: error.message }); return }
    setMsg({ ok: true, t: 'PERIODO REABIERTO' }); onCambio(); cargarMovs()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="glass modal planilla-ficha" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{t.nombre}</h2>
          <button className="btn-ghost" onClick={onClose}>&#10005;</button>
        </div>
        <p className="muted" style={{ marginTop: '-.6rem' }}>
          {t.cargo || 'Sin cargo'} · {PERIODICIDAD[t.periodicidad]}: {soles(t.sueldo)} {SUELDO_POR[t.periodicidad]}
          {t.dni ? ' · DNI ' + t.dni : ''}{(t.proyectos || []).length ? ' · ' + t.proyectos.map(x => nombreProy(x.project_id) + (Number(x.porcentaje) !== 100 ? ' ' + x.porcentaje + '%' : '')).join(', ') : ''}
          {' · '}<button className="link-btn" onClick={() => onEditar(t)}>✎ editar datos</button>
        </p>
        {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

        <div className="planilla-nav">
          <button className="btn-ghost" onClick={() => setP(periodoAnterior(p, t.periodicidad))}>◀</button>
          <b style={{ flex: 1, textAlign: 'center' }}>{nombrePeriodo(p, t.periodicidad)}
            <span className="muted small"> · {fechaPe(p.desde)} al {fechaPe(p.hasta)}</span></b>
          <button className="btn-ghost" onClick={() => setP(periodoSiguiente(p, t.periodicidad))}>▶</button>
        </div>
        <p style={{ margin: '.3rem 0 .6rem', textAlign: 'center' }}>
          {cierre
            ? (cierre.estado === 'pagado'
              ? <span className="st-chip st-ok">PAGADO {cierre.pagado_el ? fechaPe(cierre.pagado_el) : ''}</span>
              : <span className="st-chip st-per">CERRADO · POR PAGAR</span>)
            : <span className="st-chip">{p.desde > hoy ? 'TODAVÍA NO EMPIEZA' : terminado ? 'TERMINÓ · FALTA CERRAR' : 'EN CURSO'}</span>}
          {cierre?.pago_voucher_url && <> <a href={cierre.pago_voucher_url} target="_blank" rel="noreferrer">voucher del pago</a></>}
        </p>

        {!cierre && t.activo && (
          <div className="planilla-botones">
            {ORDEN_TIPOS.map(k => <button key={k} className="btn-ghost" onClick={() => setNuevo(k)}>{TIPOS[k].icon} + {TIPOS[k].label}</button>)}
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Qué</th><th>Detalle</th><th style={{ textAlign: 'right' }}>Monto</th><th /></tr></thead>
            <tbody>
              {movs === null && <tr><td colSpan="5" className="muted">Cargando…</td></tr>}
              {movs?.length === 0 && <tr><td colSpan="5" className="muted">Sin movimientos en este periodo.</td></tr>}
              {(movs || []).map(m => (
                <tr key={m.id} style={m.anulado_at ? { opacity: .5, textDecoration: 'line-through' } : {}}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fechaPe(m.fecha)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{TIPOS[m.tipo].icon} {TIPOS[m.tipo].label}</td>
                  <td className="small" style={{ textTransform: 'none' }}>
                    {[m.tipo === 'tardanza' && m.minutos ? m.minutos + ' min' : '', m.motivo || ''].filter(Boolean).join(' · ')}
                    {m.voucher_url && <> <a href={m.voucher_url} target="_blank" rel="noreferrer">voucher</a></>}
                    {m.anulado_at && <div className="muted">ANULADO: {m.anulado_motivo}</div>}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{TIPOS[m.tipo].signo > 0 ? '+' : '−'}{soles(m.monto)}</td>
                  <td>{!cierre && !m.anulado_at && <button className="link-btn bad" style={{ textDecoration: 'none' }} onClick={() => anular(m)}>anular</button>}</td>
                </tr>
              ))}
              <tr><td colSpan="3">Sueldo del periodo</td><td style={{ textAlign: 'right' }}>{soles(c.sueldo)}</td><td /></tr>
              <tr className="fl-fila-total"><td colSpan="3">A PAGAR</td><td style={{ textAlign: 'right' }}>{soles(cierre ? cierre.neto : c.neto)}</td><td /></tr>
            </tbody>
          </table>
        </div>

        <div className="acc-row" style={{ marginTop: '.8rem', flexWrap: 'wrap' }}>
          {!cierre && <button className="btn-primary" disabled={busy || p.desde > hoy} onClick={cerrar}>🔒 Cerrar este periodo</button>}
          {cierre?.estado === 'cerrado' && <>
            <button className="btn-primary" disabled={busy} onClick={() => pagado(null)}>✅ Marcar pagado</button>
            <label className="upload-btn">✅ Marcar pagado con voucher
              <input type="file" accept="image/*,.pdf" hidden onChange={e => e.target.files[0] && pagado(e.target.files[0])} />
            </label>
          </>}
          {cierre && (cierre.estado === 'cerrado' || esSuper) && <button className="btn-ghost" onClick={reabrir}>↺ Reabrir</button>}
          {cierre && <button className="btn-ghost" onClick={() => imprimirBoleta(t, cierre, movs || [])}>🖨 Boleta de pago</button>}
        </div>
      </div>
      {nuevo && <FormMovimiento t={t} cfg={cfg} tipo={nuevo} p={p}
        onClose={() => setNuevo(null)} onListo={texto => { setNuevo(null); setMsg({ ok: true, t: texto }); savedFx(); cargarMovs(); onCambio() }} />}
    </div>
  )
}

// ---- anotar un adelanto, descuento, tardanza, falta o bono ----
function FormMovimiento({ t, cfg, tipo: tipo0, p, onClose, onListo }) {
  const hoy = hoyPe()
  const fecha0 = hoy >= p.desde && hoy <= p.hasta ? hoy : p.hasta
  const montoDe = k => k === 'tardanza' ? tardanzaPorDefecto(t, cfg) : k === 'falta' ? faltaPorDefecto(t) : ''
  const [f, setF] = useState({ tipo: tipo0, fecha: fecha0, monto: String(montoDe(tipo0) || ''), minutos: '', motivo: '', file: null })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const cambiarTipo = k => setF(x => ({ ...x, tipo: k, monto: String(montoDe(k) || '') }))

  async function guardar(e) {
    e.preventDefault(); setErr(null)
    const monto = r2(String(f.monto).replace(',', '.'))
    if (!(monto >= 0) || String(f.monto).trim() === '') { setErr('Escribe el monto.'); return }
    if (monto === 0 && f.tipo !== 'tardanza') { setErr('El monto tiene que ser mayor a cero.'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha)) { setErr('Revisa la fecha.'); return }
    if (f.fecha < p.desde || f.fecha > p.hasta) { setErr('La fecha tiene que estar dentro del periodo (' + fechaPe(p.desde) + ' al ' + fechaPe(p.hasta) + ').'); return }
    if (['descuento', 'bono'].includes(f.tipo) && f.motivo.trim().length < 3) { setErr('Escribe el motivo.'); return }
    setBusy(true)
    try {
      const url = f.file ? await upload('planilla/' + t.id, f.file) : null
      const { error } = await supabase.from('planilla_movimientos').insert({
        trabajador_id: t.id, tipo: f.tipo, fecha: f.fecha, monto,
        minutos: f.tipo === 'tardanza' && Number(f.minutos) > 0 ? Math.round(Number(f.minutos)) : null,
        motivo: f.motivo.trim().toUpperCase() || null, voucher_url: url,
      })
      if (error) throw error
      onListo(TIPOS[f.tipo].label.toUpperCase() + ' ANOTADO: ' + soles(monto))
    } catch (x) { setErr(x.message || String(x)) }
    setBusy(false)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="glass modal" onClick={e => e.stopPropagation()} onSubmit={guardar}>
        <div className="modal-head">
          <h2>{TIPOS[f.tipo].icon} {TIPOS[f.tipo].label} · {t.nombre}</h2>
          <button type="button" className="btn-ghost" onClick={onClose}>&#10005;</button>
        </div>
        <div className="form-grid">
          <label>Qué es
            <select value={f.tipo} onChange={e => cambiarTipo(e.target.value)}>
              {ORDEN_TIPOS.map(k => <option key={k} value={k}>{TIPOS[k].label}</option>)}
            </select>
          </label>
          <label>Fecha <input type="date" value={f.fecha} min={p.desde} max={p.hasta} onChange={e => set('fecha', e.target.value)} /></label>
          <label>Monto S/ <input type="number" step="0.01" min="0" value={f.monto} onChange={e => set('monto', e.target.value)} autoFocus /></label>
          {f.tipo === 'tardanza' && <label>Minutos tarde <span className="muted small">(opcional)</span><input type="number" min="0" value={f.minutos} onChange={e => set('minutos', e.target.value)} /></label>}
          <label className="span2">Motivo {['descuento', 'bono'].includes(f.tipo) ? '' : <span className="muted small">(opcional)</span>}
            <input value={f.motivo} onChange={e => set('motivo', e.target.value)} placeholder={{ adelanto: 'ej: adelanto por YAPE', descuento: 'ej: uniforme', tardanza: 'ej: llegó 9:40', falta: 'ej: no vino', bono: 'ej: meta de ventas' }[f.tipo]} />
          </label>
          {TIPOS[f.tipo].voucher && <label className="span2">Voucher o constancia <span className="muted small">(opcional)</span>
            <input type="file" accept="image/*,.pdf" onChange={e => set('file', e.target.files[0] || null)} /></label>}
        </div>
        {f.tipo === 'tardanza' && <p className="muted small">El monto fijo por tardanza es {soles(tardanzaPorDefecto(t, cfg))}; si esta vez es otro, cámbialo.</p>}
        {f.tipo === 'falta' && <p className="muted small">Viene con un día de sueldo ({soles(faltaPorDefecto(t))}); si es otro monto, cámbialo.</p>}
        {err && <p className="error">{err}</p>}
        <div className="acc-row"><button className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button></div>
      </form>
    </div>
  )
}

// ---- alta o edición de un trabajador ----
function FormTrabajador({ inicial, projects, onClose, onListo }) {
  const [f, setF] = useState(inicial)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const pctDe = id => f.proyectos.find(x => x.project_id === id)?.porcentaje
  const tocarProy = (id, on) => setF(x => {
    const resto = x.proyectos.filter(y => y.project_id !== id)
    if (!on) return { ...x, proyectos: resto }
    const lista = [...resto, { project_id: id, porcentaje: 0 }]
    const parte = Math.floor(100 / lista.length)   // reparte en partes iguales; se puede corregir
    return { ...x, proyectos: lista.map((y, i) => ({ ...y, porcentaje: i === lista.length - 1 ? 100 - parte * (lista.length - 1) : parte })) }
  })
  const setPct = (id, v) => setF(x => ({ ...x, proyectos: x.proyectos.map(y => y.project_id === id ? { ...y, porcentaje: v } : y) }))

  async function guardar(e) {
    e.preventDefault(); setErr(null)
    const sueldo = r2(String(f.sueldo).replace(',', '.'))
    if (f.nombre.trim().length < 3) { setErr('Escribe el nombre completo.'); return }
    if (!(sueldo > 0)) { setErr('Escribe el sueldo ' + SUELDO_POR[f.periodicidad] + '.'); return }
    const proyectos = f.proyectos.map(x => ({ project_id: x.project_id, porcentaje: Number(x.porcentaje) || 0 })).filter(x => x.porcentaje > 0)
    if (proyectos.length && proyectos.reduce((s, x) => s + x.porcentaje, 0) !== 100) { setErr('Los porcentajes de los proyectos tienen que sumar 100.'); return }
    const dt = String(f.descuento_tardanza).trim() === '' ? null : r2(String(f.descuento_tardanza).replace(',', '.'))
    const fila = {
      nombre: f.nombre.trim().toUpperCase(), dni: f.dni.trim() || null, cargo: f.cargo.trim().toUpperCase() || null,
      celular: f.celular.trim() || null, periodicidad: f.periodicidad, sueldo, descuento_tardanza: dt,
      fecha_ingreso: f.fecha_ingreso || null, proyectos, activo: !!f.activo, notas: f.notas.trim() || null,
    }
    setBusy(true)
    const r = f.id
      ? await supabase.from('planilla_trabajadores').update({ ...fila, updated_at: new Date().toISOString() }).eq('id', f.id).select().single()
      : await supabase.from('planilla_trabajadores').insert(fila).select().single()
    setBusy(false)
    if (r.error) { setErr(r.error.message); return }
    onListo(r.data, !f.id)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="glass modal" onClick={e => e.stopPropagation()} onSubmit={guardar} style={{ maxWidth: 620 }}>
        <div className="modal-head">
          <h2>{f.id ? 'Datos de ' + inicial.nombre : 'Trabajador nuevo'}</h2>
          <button type="button" className="btn-ghost" onClick={onClose}>&#10005;</button>
        </div>
        <div className="form-grid">
          <label className="span2">Nombre completo <input value={f.nombre} onChange={e => set('nombre', e.target.value)} autoFocus /></label>
          <label>DNI <input value={f.dni} onChange={e => set('dni', e.target.value)} inputMode="numeric" /></label>
          <label>Celular <input value={f.celular} onChange={e => set('celular', e.target.value)} inputMode="tel" /></label>
          <label>Cargo <input value={f.cargo} onChange={e => set('cargo', e.target.value)} placeholder="ej: secretaria" /></label>
          <label>Ingresó el <input type="date" value={f.fecha_ingreso} onChange={e => set('fecha_ingreso', e.target.value)} /></label>
          <label>Se le paga
            <select value={f.periodicidad} onChange={e => set('periodicidad', e.target.value)}>
              {Object.entries(PERIODICIDAD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label>Sueldo {SUELDO_POR[f.periodicidad]} (S/) <input type="number" step="0.01" min="0" value={f.sueldo} onChange={e => set('sueldo', e.target.value)} /></label>
          <label className="span2">Descuento por tardanza solo para él/ella (S/) <span className="muted small">(vacío = el monto fijo de la planilla)</span>
            <input type="number" step="0.01" min="0" value={f.descuento_tardanza} onChange={e => set('descuento_tardanza', e.target.value)} /></label>
        </div>
        <p style={{ margin: '.6rem 0 .3rem' }}><b>¿Para qué proyecto trabaja?</b> <span className="muted small">(solo para el resumen por proyecto; si son varios, el porcentaje de cada uno)</span></p>
        <div className="planilla-proys">
          {projects.map(pr => {
            const pct = pctDe(pr.id)
            return (
              <label key={pr.id} className="planilla-proy">
                <input type="checkbox" checked={pct !== undefined} onChange={e => tocarProy(pr.id, e.target.checked)} />
                <span style={{ flex: 1 }}>{pr.name}</span>
                {pct !== undefined && <><input type="number" min="0" max="100" value={pct} onChange={e => setPct(pr.id, e.target.value)} style={{ width: 70 }} /> %</>}
              </label>
            )
          })}
        </div>
        <label style={{ display: 'block', marginTop: '.6rem' }}>Notas <input value={f.notas} onChange={e => set('notas', e.target.value)} /></label>
        {f.id && <label className="muted small" style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: '.5rem' }}>
          <input type="checkbox" checked={!f.activo} onChange={e => set('activo', !e.target.checked)} /> ya no trabaja (sale de la lista; su historia se queda)</label>}
        {err && <p className="error">{err}</p>}
        <div className="acc-row"><button className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button></div>
      </form>
    </div>
  )
}

// ---- boleta de pago para imprimir o guardar en PDF ----
function imprimirBoleta(t, x, movs) {
  const e = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
  const fila = (a, b, neg) => `<tr><td>${e(a)}</td><td class="m">${neg ? '− ' : ''}${e(soles(b))}</td></tr>`
  const detalle = movs.filter(m => !m.anulado_at).map(m =>
    `<tr><td>${e(fechaPe(m.fecha))}</td><td>${e(TIPOS[m.tipo].label)}${m.tipo === 'tardanza' && m.minutos ? ' (' + m.minutos + ' min)' : ''}</td><td>${e(m.motivo || '')}</td><td class="m">${TIPOS[m.tipo].signo > 0 ? '+' : '−'} ${e(soles(m.monto))}</td></tr>`).join('')
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Boleta de pago - ${e(t.nombre)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:13px}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:18px 0 6px}
table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left}.m{text-align:right;white-space:nowrap}
.tot td{font-weight:bold;border-top:2px solid #111;font-size:15px}.firmas{display:flex;gap:60px;margin-top:70px}.firmas div{flex:1;border-top:1px solid #111;text-align:center;padding-top:6px}
.muted{color:#666}@media print{button{display:none}}</style></head><body>
<button onclick="print()" style="float:right;padding:8px 14px">Imprimir / guardar PDF</button>
<h1>BOLETA DE PAGO</h1><div class="muted">URBIS GROUP · ${e(nombrePeriodo(x, x.periodicidad))} (${e(fechaPe(x.desde))} al ${e(fechaPe(x.hasta))})</div>
<h2>Trabajador</h2><div><b>${e(t.nombre)}</b>${t.dni ? ' · DNI ' + e(t.dni) : ''}${t.cargo ? ' · ' + e(t.cargo) : ''}</div>
<h2>Resumen</h2><table>${fila('Sueldo del periodo', x.sueldo)}${Number(x.bonos) ? fila('Bonos', x.bonos) : ''}${Number(x.adelantos) ? fila('Adelantos', x.adelantos, 1) : ''}${Number(x.descuentos) ? fila('Descuentos', x.descuentos, 1) : ''}${x.n_tardanzas ? fila('Tardanzas (' + x.n_tardanzas + ')', x.tardanzas, 1) : ''}${x.n_faltas ? fila('Faltas (' + x.n_faltas + ')', x.faltas, 1) : ''}
<tr class="tot"><td>NETO A PAGAR</td><td class="m">${e(soles(x.neto))}</td></tr></table>
${detalle ? `<h2>Detalle</h2><table><tr><th>Fecha</th><th>Qué</th><th>Motivo</th><th class="m">Monto</th></tr>${detalle}</table>` : ''}
${x.estado === 'pagado' ? `<p>Pagado el ${e(fechaPe(x.pagado_el))}.</p>` : ''}
<div class="firmas"><div>Trabajador<br><span class="muted">${e(t.nombre)}</span></div><div>Empleador</div></div></body></html>`
  const w = window.open('', '_blank')
  if (!w) { avisar('El navegador bloqueó la ventana: permite las ventanas emergentes para este sitio.'); return }
  w.document.write(html); w.document.close()
}
