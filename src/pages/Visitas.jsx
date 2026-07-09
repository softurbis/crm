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
  const hoy = hoyISO()
  const esJefe = ['admin', 'superuser'].includes(role)

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
    return (
      <div key={v.id} className="glass" style={{ padding: '8px 10px', borderLeft: `3px solid ${e.c}`, marginBottom: 6 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <b style={{ fontSize: 12, flex: 1 }}>🕐 {String(v.time).slice(0, 5)} · {v.client_name}</b>
          <span title={e.t}>{e.i}</span>
        </div>
        <p className="muted" style={{ fontSize: 10, margin: '2px 0' }}>{v.project?.name || 'SIN PROYECTO'} · 📍 {v.meeting_point}</p>
        <p className="muted" style={{ fontSize: 10, margin: '2px 0' }}>👤 {v.encargado_name || 'ENCARGADO'} · +{v.encargado_phone} · CLIENTE +{v.client_phone}{v.reminded_at ? ' · 🔔 RECORDADO' : ''}</p>
        {v.notes && <p className="muted" style={{ fontSize: 10, margin: '2px 0', textTransform: 'none' }}>📝 {v.notes}</p>}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
          {v.status === 'programada' && <>
            <button className="btn-ghost" style={{ fontSize: 10, padding: '1px 7px' }} onClick={() => setEstado(v, 'realizada')}>✅ REALIZADA</button>
            <button className="btn-ghost" style={{ fontSize: 10, padding: '1px 7px' }} onClick={() => setEstado(v, 'no_asistio')}>😶 NO VINO</button>
            <button className="btn-ghost" style={{ fontSize: 10, padding: '1px 7px' }} onClick={() => setEstado(v, 'cancelada')}>🚫</button>
            {puedeCrear && <button className="btn-ghost" style={{ fontSize: 10, padding: '1px 7px' }} onClick={() => setForm({ ...v, time: String(v.time).slice(0, 5) })}>✎</button>}
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
          {puedeCrear && <button className="btn" onClick={() => setForm({ date: hoy, time: '10:00' })}>+ PROGRAMAR VISITA</button>}
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>El bot recuerda cada visita 1 día antes: al encargado con todos los datos y al cliente con hora y punto de encuentro.</p>

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
