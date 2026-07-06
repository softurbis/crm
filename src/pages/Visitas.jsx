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
  const [form, setForm] = useState(null)
  const hoy = hoyISO()
  const esJefe = ['admin', 'superuser'].includes(role)

  const cargar = async () => {
    const d1 = addDias(semana, -35), d2 = addDias(semana, 70)
    const [v, p, s] = await Promise.all([
      supabase.from('visits').select('*, project:projects(name)').gte('date', d1).lte('date', d2).order('date').order('time'),
      supabase.from('projects').select('id, name').order('name'),
      supabase.from('secretaries').select('id, full_name, phone').eq('active', true),
    ])
    setVisitas(v.data || []); setProys(p.data || []); setEquipo(s.data || [])
  }
  useEffect(() => { cargar() }, [semana])
  useEffect(() => { const t = setInterval(cargar, 20000); return () => clearInterval(t) }, [semana])

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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="btn-ghost" onClick={() => setSemana(addDias(semana, -7))}>‹ SEMANA</button>
          <button className="btn-ghost" onClick={() => setSemana(lunesDe(hoy))}>HOY</button>
          <button className="btn-ghost" onClick={() => setSemana(addDias(semana, 7))}>SEMANA ›</button>
          {puedeCrear && <button className="btn" onClick={() => setForm({ date: hoy, time: '10:00' })}>+ PROGRAMAR VISITA</button>}
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>El bot recuerda cada visita 1 día antes: al encargado con todos los datos y al cliente con hora y punto de encuentro.</p>

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

      {/* SEMANA GRANDE */}
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

      {/* MES COMPLETO */}
      <div className="glass" style={{ padding: 12, maxWidth: 560 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <button className="btn-ghost" onClick={() => cambiarMes(-1)}>‹</button>
          <b style={{ flex: 1, textAlign: 'center' }}>{MESES[mnum - 1]} {anio}</b>
          <button className="btn-ghost" onClick={() => cambiarMes(1)}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
          {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => <div key={i} className="muted" style={{ fontSize: 10, textAlign: 'center', fontWeight: 700 }}>{d}</div>)}
          {celdas.map((n, i) => {
            if (!n) return <div key={i} />
            const iso = mes + '-' + String(n).padStart(2, '0')
            const cnt = visitas.filter(v => v.date === iso && v.status === 'programada').length
            return (
              <button key={i} onClick={() => setSemana(lunesDe(iso))}
                title={cnt ? cnt + ' visita(s) — clic para ver la semana' : 'Ir a esta semana'}
                style={{ minHeight: 40, borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', background: 'rgba(255,255,255,.02)', color: 'inherit', border: iso === hoy ? '1.5px solid rgba(156,203,134,.6)' : '1px solid rgba(255,255,255,.07)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, padding: 3 }}>
                <span style={{ fontSize: 11 }}>{n}</span>
                {cnt > 0 && <span style={{ fontSize: 9, fontWeight: 800, padding: '0 6px', borderRadius: 8, background: 'rgba(123,167,247,.25)', color: '#7ba7f7' }}>{cnt}</span>}
              </button>
            )
          })}
        </div>
        <p className="muted" style={{ fontSize: 10, marginTop: 6 }}>Clic en un día del mes para saltar a esa semana.</p>
      </div>
    </div>
  )
}
