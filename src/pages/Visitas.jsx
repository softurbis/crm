import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']
const EST = {
  programada: { t: 'PROGRAMADA', c: '#7ba7f7', i: '📅' },
  realizada: { t: 'REALIZADA', c: '#6fdd9b', i: '✅' },
  cancelada: { t: 'CANCELADA', c: '#9daab6', i: '🚫' },
  no_asistio: { t: 'NO ASISTIÓ', c: '#ff8e7a', i: '😶' },
}
// resultados al CERRAR una visita (el bot avisa al admin de cada cierre)
const RESULTADOS = [
  { v: 'pago_inicial', t: '💰 Pagó inicial', c: '#6fdd9b' },
  { v: 'separacion', t: '🔖 Dio separación', c: '#b8a1d9' },
  { v: 'interesado', t: '🤔 Interesado / lo pensará', c: '#e0b34c' },
  { v: 'recontacto', t: '📅 Recontactar en fecha', c: '#7ba7f7', pideFecha: true },
  { v: 'no_interesado', t: '❌ No interesado', c: '#e07b7b' },
  { v: 'no_vino', t: '😶 No vino / sin respuesta', c: '#9daab6' },
]
const RES_LBL = Object.fromEntries(RESULTADOS.map(r => [r.v, r.t]))
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
const lunesDe = iso => { const d = new Date(iso + 'T12:00:00'); const off = (d.getDay() + 6) % 7; return addDias(iso, -off) }

export default function Visitas() {
  const { role, profile } = useAuth()
  const [visitas, setVisitas] = useState([])
  const [proys, setProys] = useState([])
  const [equipo, setEquipo] = useState([])
  const [semana, setSemana] = useState(lunesDe(hoyISO()))
  const [mes, setMes] = useState(hoyISO().slice(0, 7))
  const [vista, setVista] = useState('mes')   // 'mes' | 'semana'
  const [form, setForm] = useState(null)
  const [cerrar, setCerrar] = useState(null)  // visita que se está cerrando (modal de resultado)
  const [cfg, setCfg] = useState({ activo: true, diasAntes: 1, diasHora: '09:00', horasAntes: 3, recCliente: true, recAsesor: true })
  const [verCfg, setVerCfg] = useState(false)
  const [cfgMsg, setCfgMsg] = useState('')
  const hoy = hoyISO()
  const esJefe = ['admin', 'superuser'].includes(role)

  const cargarCfg = async () => {
    const { data } = await supabase.from('bot_settings').select('key, value').like('key', 'vis_%')
    const kv = Object.fromEntries((data || []).map(r => [r.key, r.value]))
    setCfg({
      activo: kv.vis_activo !== '0',
      diasAntes: parseInt(kv.vis_dias_antes ?? '1') || 0,
      diasHora: (kv.vis_dias_hora || '09:00').slice(0, 5),
      horasAntes: parseInt(kv.vis_horas_antes ?? '3') || 0,
      recCliente: kv.vis_recordar_cliente !== '0',
      recAsesor: kv.vis_recordar_asesor !== '0',
    })
  }
  const guardarCfg = async () => {
    setCfgMsg('GUARDANDO…')
    const now = new Date().toISOString()
    const rows = [
      { key: 'vis_activo', value: cfg.activo ? '1' : '0', updated_at: now },
      { key: 'vis_dias_antes', value: String(Math.max(0, cfg.diasAntes | 0)), updated_at: now },
      { key: 'vis_dias_hora', value: String(cfg.diasHora).slice(0, 5), updated_at: now },
      { key: 'vis_horas_antes', value: String(Math.max(0, cfg.horasAntes | 0)), updated_at: now },
      { key: 'vis_recordar_cliente', value: cfg.recCliente ? '1' : '0', updated_at: now },
      { key: 'vis_recordar_asesor', value: cfg.recAsesor ? '1' : '0', updated_at: now },
    ]
    const { error } = await supabase.from('bot_settings').upsert(rows)
    setCfgMsg(error ? 'ERROR: ' + error.message : '✅ GUARDADO — el bot lo aplica en máx. 1 minuto')
  }

  const cargar = async () => {
    const md = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate()
    const d1 = [addDias(mes + '-01', -10), addDias(semana, -10)].sort()[0]
    const d2 = [addDias(mes + '-' + String(md).padStart(2, '0'), 10), addDias(semana, 17)].sort().reverse()[0]
    const [v, p, s] = await Promise.all([
      supabase.from('visits').select('*, project:projects(name)').gte('date', d1).lte('date', d2).order('date').order('time'),
      supabase.from('projects').select('id, name').order('name'),
      supabase.from('secretaries').select('id, full_name, phone').eq('active', true),
    ])
    setVisitas(v.data || []); setProys(p.data || []); setEquipo(s.data || [])
  }
  useEffect(() => { cargar() }, [semana, mes])
  useEffect(() => { cargarCfg() }, [])
  useEffect(() => { const t = setInterval(cargar, 20000); return () => clearInterval(t) }, [semana, mes])

  if (!['admin', 'superuser', 'secretary', 'manager'].includes(role)) return <div className="glass" style={{ padding: 24 }}>Sin acceso.</div>
  const puedeCrear = role !== 'manager'

  const guardar = async () => {
    const cp = String(form.client_phone || '').replace(/\D/g, '')
    const ep = String(form.encargado_phone || '').replace(/\D/g, '')
    if (!form.client_name?.trim() || cp.length < 9 || !form.date || !form.time || !form.meeting_point?.trim() || ep.length < 9) {
      alert('Completa: cliente, celular (9+ dígitos), encargado y su celular, fecha, hora y punto de encuentro.'); return
    }
    const payload = {
      project_id: form.project_id || null,
      client_name: form.client_name.trim().toUpperCase(), client_phone: cp.length === 9 ? '51' + cp : cp,
      encargado_name: (form.encargado_name || '').trim().toUpperCase() || null, encargado_phone: ep.length === 9 ? '51' + ep : ep,
      date: form.date, time: form.time, meeting_point: form.meeting_point.trim().toUpperCase(),
      notes: (form.notes || '').trim() || null,
    }
    const { error } = form.id
      ? await supabase.from('visits').update({ ...payload, reminded_at: null }).eq('id', form.id)
      : await supabase.from('visits').insert({ ...payload, created_by: profile?.id })
    if (error) { alert('ERROR: ' + error.message); return }
    setForm(null); cargar()
  }
  const setEstado = async (v, status) => { await supabase.from('visits').update({ status }).eq('id', v.id); cargar() }
  const borrar = async v => { if (confirm('¿Eliminar la visita de ' + v.client_name + '?')) { await supabase.from('visits').delete().eq('id', v.id); cargar() } }

  // CERRAR una visita con su resultado (el bot avisa al admin). recontacto = agenda otra entrada.
  const cerrarVisita = async (v, res) => {
    const meta = RESULTADOS.find(r => r.v === res)
    const nota = prompt('📝 Nota / detalle del resultado (opcional):\n\n' + meta.t, v.resultado_note || '')
    if (nota === null) return
    let recontactoDate = null
    if (meta.pideFecha) {
      const def = addDias(hoy, 3)
      const f = prompt('📅 ¿Para qué fecha recontactar al cliente? (AAAA-MM-DD)\n\nEse día el bot le recuerda al asesor que debe llamar.', def)
      if (f === null) return
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.trim())) { alert('Fecha inválida. Usa el formato AAAA-MM-DD (ej. ' + def + ').'); return }
      recontactoDate = f.trim()
      // agendar el recontacto en el calendario (tipo 'recontacto')
      const { error: eR } = await supabase.from('visits').insert({
        project_id: v.project_id || null, client_name: v.client_name, client_phone: v.client_phone,
        encargado_name: v.encargado_name, encargado_phone: v.encargado_phone,
        date: recontactoDate, time: '10:00', meeting_point: 'RECONTACTO (LLAMADA)',
        tipo: 'recontacto', notes: (nota.trim() || 'Recontactar al cliente'), status: 'programada', created_by: profile?.id,
      })
      if (eR) { alert('No se pudo agendar el recontacto: ' + eR.message); return }
    }
    const { error } = await supabase.from('visits').update({
      status: res === 'no_vino' ? 'no_asistio' : 'realizada',
      resultado: res, resultado_note: nota.trim() || null,
      recontacto_date: recontactoDate, closed_at: new Date().toISOString(), admin_avisado_at: null,
    }).eq('id', v.id)
    if (error) { alert('ERROR: ' + error.message); return }
    setCerrar(null); cargar()
  }

  // reenviar el recordatorio (resetea las marcas para que el bot lo vuelva a mandar)
  const reenviarRecordatorio = async v => {
    if (!confirm('¿Reenviar el recordatorio de esta visita?\n\nEl bot lo volverá a mandar al cliente y al asesor en el próximo ciclo (máx. 1 min).')) return
    await supabase.from('visits').update({ reminded_at: null, reminded_dia_at: null, reminded_hora_at: null }).eq('id', v.id)
    cargar()
  }
  const elegirEncargado = id => {
    const s = equipo.find(x => x.id === id)
    if (s) setForm(f => ({ ...f, encargado_name: s.full_name, encargado_phone: s.phone }))
  }

  const diasSemana = Array.from({ length: 7 }, (_, i) => addDias(semana, i))
  const delDia = iso => visitas.filter(v => v.date === iso)

  // mini mes
  const anio = Number(mes.slice(0, 4)), mnum = Number(mes.slice(5, 7))
  const nDias = new Date(anio, mnum, 0).getDate()
  const dow1 = (new Date(anio, mnum - 1, 1).getDay() + 6) % 7
  const celdas = [...Array(dow1).fill(null), ...Array.from({ length: nDias }, (_, i) => i + 1)]
  const cambiarMes = p => { const d = new Date(anio, mnum - 1 + p, 1); setMes(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')) }
  const irHoy = () => { setSemana(lunesDe(hoy)); setMes(hoy.slice(0, 7)) }
  const fmtCorta = iso => new Date(iso + 'T12:00:00').toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric' })

  // resumen
  const prog = arr => arr.filter(v => v.status === 'programada')
  const finSem = addDias(semana, 6)
  const visSem = visitas.filter(v => v.date >= semana && v.date <= finSem)
  const mesIni = mes + '-01', mesFin = mes + '-' + String(nDias).padStart(2, '0')
  const visMes = visitas.filter(v => v.date >= mesIni && v.date <= mesFin)
  const proxima = prog(visitas).filter(v => v.date >= hoy).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0]
  const porProy = {}; prog(visMes).forEach(v => { const k = v.project?.name || 'Sin proyecto'; porProy[k] = (porProy[k] || 0) + 1 })
  const porEnc = {}; prog(visMes).forEach(v => { const k = v.encargado_name || '—'; porEnc[k] = (porEnc[k] || 0) + 1 })

  const Card = v => {
    const e = EST[v.status] || EST.programada
    const esRec = v.tipo === 'recontacto'
    const yaRec = v.reminded_at || v.reminded_dia_at || v.reminded_hora_at
    return (
      <div key={v.id} className="glass" style={{ padding: '8px 10px', borderLeft: `3px solid ${esRec ? '#7ba7f7' : e.c}`, marginBottom: 6 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <b style={{ fontSize: 12, flex: 1 }}>{esRec ? '📞 RECONTACTO' : '🕐 ' + String(v.time).slice(0, 5)} · {v.client_name}</b>
          <span title={e.t}>{e.i}</span>
        </div>
        <p className="muted" style={{ fontSize: 10, margin: '2px 0' }}>{v.project?.name || 'SIN PROYECTO'}{!esRec && ' · 📍 ' + v.meeting_point}</p>
        <p className="muted" style={{ fontSize: 10, margin: '2px 0' }}>👤 {v.encargado_name || 'ENCARGADO'} · +{v.encargado_phone} · CLIENTE +{v.client_phone}{yaRec ? ' · 🔔 RECORDADO' : ''}</p>
        {v.notes && <p className="muted" style={{ fontSize: 10, margin: '2px 0', textTransform: 'none' }}>📝 {v.notes}</p>}
        {v.resultado && <p style={{ fontSize: 10, margin: '2px 0', color: (RESULTADOS.find(r => r.v === v.resultado)?.c) || '#9daab6', fontWeight: 700 }}>
          {RES_LBL[v.resultado] || v.resultado}{v.resultado_note ? <span className="muted" style={{ fontWeight: 400, textTransform: 'none' }}> · {v.resultado_note}</span> : ''}
          {v.recontacto_date && <span className="muted" style={{ fontWeight: 400 }}> · 📅 {v.recontacto_date}</span>}
        </p>}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
          {v.status === 'programada' && <>
            {puedeCrear && !esRec && <button className="btn-ghost" style={{ fontSize: 10, padding: '1px 7px', borderColor: 'rgba(126,167,247,.5)' }} onClick={() => setCerrar(v)}>🏁 CERRAR</button>}
            {puedeCrear && esRec && <button className="btn-ghost" style={{ fontSize: 10, padding: '1px 7px' }} onClick={() => setEstado(v, 'realizada')}>✅ HECHO</button>}
            {puedeCrear && <button className="btn-ghost" style={{ fontSize: 10, padding: '1px 7px' }} title="Editar / reprogramar" onClick={() => setForm({ ...v, time: String(v.time).slice(0, 5) })}>✎</button>}
            {puedeCrear && !esRec && yaRec && <button className="btn-ghost" style={{ fontSize: 10, padding: '1px 7px' }} title="Reenviar recordatorio" onClick={() => reenviarRecordatorio(v)}>🔁</button>}
            <button className="btn-ghost" style={{ fontSize: 10, padding: '1px 7px' }} onClick={() => setEstado(v, 'cancelada')}>🚫</button>
          </>}
          {esJefe && <button className="btn-ghost" style={{ fontSize: 10, padding: '1px 7px' }} onClick={() => borrar(v)}>✕</button>}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1>Visitas</h1>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className={`chip ${vista === 'mes' ? 'on' : ''}`} onClick={() => setVista('mes')}>🗓️ MES</button>
          <button className={`chip ${vista === 'semana' ? 'on' : ''}`} onClick={() => setVista('semana')}>📅 SEMANA</button>
          <span style={{ width: 8 }} />
          {vista === 'mes' ? (<>
            <button className="btn-ghost" onClick={() => cambiarMes(-1)}>‹</button>
            <b style={{ minWidth: 130, textAlign: 'center' }}>{MESES[mnum - 1]} {anio}</b>
            <button className="btn-ghost" onClick={() => cambiarMes(1)}>›</button>
          </>) : (<>
            <button className="btn-ghost" onClick={() => setSemana(addDias(semana, -7))}>‹ SEM</button>
            <button className="btn-ghost" onClick={() => setSemana(addDias(semana, 7))}>SEM ›</button>
          </>)}
          <button className="btn-ghost" onClick={irHoy}>HOY</button>
          {esJefe && <button className="btn-ghost" onClick={() => setVerCfg(!verCfg)} title="Configurar recordatorios de visita">🔔 RECORDATORIOS</button>}
          {puedeCrear && <button className="btn" onClick={() => setForm({ date: hoy, time: '10:00' })}>+ PROGRAMAR VISITA</button>}
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        El bot recuerda cada visita al cliente y al asesor según la configuración de 🔔 RECORDATORIOS
        {cfg.activo ? <> (hoy: {cfg.diasAntes > 0 ? cfg.diasAntes + ' día(s) antes' : '—'}{cfg.horasAntes > 0 ? ' + ' + cfg.horasAntes + ' h antes' : ''}).</> : <> — <b className="bad">recordatorios APAGADOS</b>.</>}
      </p>

      {verCfg && esJefe && (
        <div className="glass" style={{ padding: 14, marginBottom: 12, border: '1px solid rgba(126,167,247,.4)' }}>
          <b style={{ color: '#7ba7f7' }}>🔔 RECORDATORIOS DE VISITA</b>
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 10px' }}>El bot recuerda cada visita al cliente y/o al asesor. Configura cuánto antes. (Los recontactos se avisan al asesor el día que toca.)</p>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={cfg.activo} onChange={e => setCfg(c => ({ ...c, activo: e.target.checked }))} /> <b>Recordatorios activos</b>
            </label>
            <span style={{ opacity: cfg.activo ? 1 : .4, display: 'flex', gap: 6, alignItems: 'center' }}>
              📅 <input type="number" min="0" max="30" value={cfg.diasAntes} onChange={e => setCfg(c => ({ ...c, diasAntes: e.target.value | 0 }))} style={{ width: 50 }} /> día(s) antes, a las
              <input type="time" value={cfg.diasHora} onChange={e => setCfg(c => ({ ...c, diasHora: e.target.value }))} style={{ fontSize: 12, padding: '3px 6px' }} />
            </span>
            <span style={{ opacity: cfg.activo ? 1 : .4, display: 'flex', gap: 6, alignItems: 'center' }}>
              ⏰ <input type="number" min="0" max="48" value={cfg.horasAntes} onChange={e => setCfg(c => ({ ...c, horasAntes: e.target.value | 0 }))} style={{ width: 50 }} /> hora(s) antes de la visita
            </span>
            <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={cfg.recCliente} onChange={e => setCfg(c => ({ ...c, recCliente: e.target.checked }))} /> al cliente</label>
              <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={cfg.recAsesor} onChange={e => setCfg(c => ({ ...c, recAsesor: e.target.checked }))} /> al asesor</label>
            </span>
          </div>
          <p className="muted" style={{ fontSize: 10, margin: '8px 0 0' }}>0 = ese recordatorio no se manda. Ej: 1 día antes + 3 horas antes = dos avisos por visita.</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <button className="btn" onClick={guardarCfg}>💾 GUARDAR</button>
            {cfgMsg && <span style={{ fontSize: 12 }}>{cfgMsg}</span>}
          </div>
        </div>
      )}

      {cerrar && (
        <div className="modal-bg" onClick={() => setCerrar(null)}>
          <div className="glass" style={{ padding: 18, maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <b>🏁 CERRAR VISITA — {cerrar.client_name}</b>
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 12px' }}>¿Cómo resultó la visita? Se registra y el bot avisa al admin. En "recontactar" se agenda la llamada en el calendario.</p>
            <div style={{ display: 'grid', gap: 6 }}>
              {RESULTADOS.map(r => (
                <button key={r.v} className="btn-ghost" style={{ textAlign: 'left', borderColor: r.c + '77', color: r.c, padding: '8px 12px', fontSize: 13 }}
                  onClick={() => cerrarVisita(cerrar, r.v)}>{r.t}</button>
              ))}
            </div>
            <div style={{ marginTop: 12 }}><button className="btn-ghost" onClick={() => setCerrar(null)}>CANCELAR</button></div>
          </div>
        </div>
      )}

      <div className="glass" style={{ padding: '9px 14px', marginBottom: 12, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
        <span>📅 <b style={{ color: '#7ba7f7' }}>{prog(visSem).length}</b> esta semana</span>
        <span>🗓️ <b style={{ color: '#7ba7f7' }}>{prog(visMes).length}</b> del mes · ✅ {visMes.filter(v => v.status === 'realizada').length} realizadas</span>
        {proxima && <span>⏭️ Próxima: <b>{fmtCorta(proxima.date)} {String(proxima.time).slice(0, 5)}</b> · {proxima.client_name}{proxima.encargado_name ? ' · 👤 ' + proxima.encargado_name.split(' ')[0] : ''}</span>}
        {Object.keys(porProy).length > 0 && <span style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>🏗️ {Object.entries(porProy).map(([k, n]) => <span key={k} className="muted" style={{ fontSize: 11 }}>{k.split(' ').slice(-1)[0]}:{n}</span>)}</span>}
        {Object.keys(porEnc).length > 0 && <span style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>👤 {Object.entries(porEnc).map(([k, n]) => <span key={k} className="muted" style={{ fontSize: 11 }}>{k.split(' ')[0]}:{n}</span>)}</span>}
      </div>

      {form && (
        <div className="glass" style={{ padding: 14, marginBottom: 14 }}>
          <b>{form.id ? 'EDITAR VISITA' : 'NUEVA VISITA'}</b>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <label>Proyecto
              <select value={form.project_id || ''} onChange={e => setForm({ ...form, project_id: e.target.value })}>
                <option value="">— ELEGIR —</option>
                {proys.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>Cliente <input value={form.client_name || ''} onChange={e => setForm({ ...form, client_name: e.target.value })} /></label>
            <label>Celular del cliente <input value={form.client_phone || ''} onChange={e => setForm({ ...form, client_phone: e.target.value })} placeholder="9XXXXXXXX" /></label>
            <label>Encargado (del equipo)
              <select value="" onChange={e => elegirEncargado(e.target.value)}>
                <option value="">— ELEGIR DEL EQUIPO —</option>
                {equipo.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </label>
            <label>Nombre encargado <input value={form.encargado_name || ''} onChange={e => setForm({ ...form, encargado_name: e.target.value })} /></label>
            <label>Celular encargado <input value={form.encargado_phone || ''} onChange={e => setForm({ ...form, encargado_phone: e.target.value })} placeholder="9XXXXXXXX" /></label>
            <label>Fecha <input type="date" value={form.date || ''} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
            <label>Hora <input type="time" value={form.time || ''} onChange={e => setForm({ ...form, time: e.target.value })} /></label>
            <label className="span2">Punto de encuentro <input value={form.meeting_point || ''} onChange={e => setForm({ ...form, meeting_point: e.target.value })} placeholder="EJ. INGRESO DEL PROYECTO KM 10 / OFICINA URBIS" /></label>
            <label className="span2">Notas <input value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn-primary" style={{ padding: '.5rem 1.2rem' }} onClick={guardar}>GUARDAR</button>
            <button className="btn-ghost" onClick={() => setForm(null)}>CANCELAR</button>
          </div>
        </div>
      )}

      {/* VISTA SEMANA (detalle) */}
      {vista === 'semana' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 16, alignItems: 'start' }}>
          {diasSemana.map(iso => {
            const d = new Date(iso + 'T12:00:00')
            const vs = delDia(iso)
            return (
              <div key={iso} className="glass" style={{ padding: 8, minHeight: 150, border: iso === hoy ? '1.5px solid rgba(156,203,134,.6)' : undefined }}>
                <div style={{ textAlign: 'center', marginBottom: 6 }}>
                  <div className="muted" style={{ fontSize: 10, fontWeight: 700 }}>{d.toLocaleDateString('es-PE', { weekday: 'short' }).toUpperCase()}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: iso === hoy ? '#9ccb86' : undefined }}>{d.getDate()}</div>
                </div>
                {vs.map(Card)}
                {puedeCrear && <button className="btn-ghost" style={{ width: '100%', fontSize: 10, padding: '3px 0' }} onClick={() => setForm({ date: iso, time: '10:00' })}>+ VISITA</button>}
              </div>
            )
          })}
        </div>
      )}

      {/* VISTA MES GRANDE (con las visitas dentro de cada día) */}
      {vista === 'mes' && (
        <div className="glass" style={{ padding: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 5 }}>
            {['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'].map(d => <div key={d} className="muted" style={{ fontSize: 11, textAlign: 'center', fontWeight: 700 }}>{d}</div>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {celdas.map((n, i) => {
              if (!n) return <div key={i} />
              const iso = mes + '-' + String(n).padStart(2, '0')
              const vs = visitas.filter(v => v.date === iso).sort((a, b) => String(a.time).localeCompare(String(b.time)))
              return (
                <div key={i} style={{ minHeight: 116, borderRadius: 8, padding: 5, border: iso === hoy ? '1.5px solid rgba(156,203,134,.6)' : '1px solid rgba(255,255,255,.07)', background: iso === hoy ? 'rgba(156,203,134,.06)' : 'rgba(255,255,255,.02)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: iso === hoy ? 800 : 600, color: iso === hoy ? '#9ccb86' : undefined }}>{n}</span>
                    {puedeCrear && <button className="btn-ghost" style={{ padding: '0 6px', fontSize: 12, lineHeight: 1.3 }} title="Nueva visita" onClick={() => setForm({ date: iso, time: '10:00' })}>+</button>}
                  </div>
                  {vs.slice(0, 4).map(v => {
                    const e = EST[v.status] || EST.programada
                    return (
                      <button key={v.id} title={`${String(v.time).slice(0, 5)} · ${v.client_name} · ${v.project?.name || 'sin proyecto'} · ${v.encargado_name || ''} · ${e.t}`}
                        onClick={() => (v.status === 'programada' && puedeCrear) ? setForm({ ...v, time: String(v.time).slice(0, 5) }) : setVista('semana') || setSemana(lunesDe(iso))}
                        style={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', background: e.c + '22', color: 'inherit', border: 'none', borderLeft: `2px solid ${e.c}`, borderRadius: 4, padding: '1px 5px', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.i} {String(v.time).slice(0, 5)} {(v.client_name || '').split(' ')[0]}
                      </button>
                    )
                  })}
                  {vs.length > 4 && <button className="btn-ghost" style={{ fontSize: 9, padding: '0 4px' }} onClick={() => { setSemana(lunesDe(iso)); setVista('semana') }}>+{vs.length - 4} más</button>}
                </div>
              )
            })}
          </div>
          <p className="muted" style={{ fontSize: 10, marginTop: 8 }}>Clic en el <b>+</b> para agregar · clic en una visita para editarla · <b>{prog(visMes).length}</b> programadas este mes.</p>
        </div>
      )}
    </div>
  )
}
