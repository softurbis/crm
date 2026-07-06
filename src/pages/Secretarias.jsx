import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const DIAS = [[1, 'L'], [2, 'M'], [3, 'X'], [4, 'J'], [5, 'V'], [6, 'S'], [7, 'D']]
const EST = {
  pendiente: { t: 'PENDIENTE', c: '#e0b34c', i: '⏳' },
  hecha: { t: 'HECHA', c: '#6fdd9b', i: '✅' },
  no_hecha: { t: 'NO HECHA', c: '#ff8e7a', i: '❌' },
  sin_respuesta: { t: 'SIN RESPUESTA', c: '#9daab6', i: '😶' },
}
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })

export default function Secretarias() {
  const { role } = useAuth()
  const [secs, setSecs] = useState([])
  const [rutinas, setRutinas] = useState([])
  const [tareas, setTareas] = useState([])
  const [fecha, setFecha] = useState(hoyISO())
  const [nva, setNva] = useState({ full_name: '', phone: '' })
  const [abierta, setAbierta] = useState(null) // id secretaria con rutina desplegada
  const [nr, setNr] = useState({ title: '', slot: 'manana', days: [1, 2, 3, 4, 5, 6] })
  const [extra, setExtra] = useState({ sid: null, title: '', slot: 'manana' })

  const cargar = async () => {
    const [a, b, c] = await Promise.all([
      supabase.from('secretaries').select('*').order('created_at'),
      supabase.from('secretary_routines').select('*').order('created_at'),
      supabase.from('secretary_tasks').select('*').eq('date', fecha).order('ask_index', { nullsFirst: false }),
    ])
    setSecs(a.data || []); setRutinas(b.data || []); setTareas(c.data || [])
  }
  useEffect(() => { cargar() }, [fecha])
  useEffect(() => {
    const t = setInterval(cargar, 15000)
    return () => clearInterval(t)
  }, [fecha])

  if (!['admin', 'superuser', 'secretary'].includes(role)) return <div className="glass" style={{ padding: 24 }}>Sin acceso.</div>
  const puedeEditar = ['admin', 'superuser'].includes(role)

  const agregarSec = async () => {
    const limpio = nva.phone.replace(/\D/g, '')
    if (!nva.full_name.trim() || limpio.length < 9) { alert('Nombre y número válido (mín. 9 dígitos)'); return }
    if (secs.filter(s => s.active).length >= 4 && !confirm('Ya hay 4 secretarias activas. ¿Agregar otra igual?')) return
    const { error } = await supabase.from('secretaries').insert({ full_name: nva.full_name.trim().toUpperCase(), phone: limpio })
    if (error) { alert('ERROR: ' + error.message); return }
    // registrarla en el directorio del bot como tipo secretaria
    await supabase.from('whatsapp_numbers').upsert({ phone: limpio, tipo: 'secretaria', note: nva.full_name.trim().toUpperCase() })
    setNva({ full_name: '', phone: '' }); cargar()
  }
  const toggleActiva = async s => { await supabase.from('secretaries').update({ active: !s.active }).eq('id', s.id); cargar() }
  const quitarSec = async s => {
    if (!confirm(`¿Quitar a ${s.full_name}? Se borran sus rutinas y su historial de tareas.`)) return
    await supabase.from('whatsapp_numbers').delete().eq('phone', s.phone)
    await supabase.from('secretaries').delete().eq('id', s.id)
    cargar()
  }
  const agregarRutina = async sid => {
    if (!nr.title.trim() || !nr.days.length) { alert('Título y al menos un día'); return }
    const { error } = await supabase.from('secretary_routines').insert({ secretary_id: sid, title: nr.title.trim().toUpperCase(), slot: nr.slot, days: nr.days })
    if (error) { alert('ERROR: ' + error.message); return }
    setNr({ title: '', slot: 'manana', days: [1, 2, 3, 4, 5, 6] }); cargar()
  }
  const quitarRutina = async r => { await supabase.from('secretary_routines').delete().eq('id', r.id); cargar() }
  const agregarExtra = async () => {
    if (!extra.title.trim()) return
    const { error } = await supabase.from('secretary_tasks').insert({ secretary_id: extra.sid, title: extra.title.trim().toUpperCase(), date: fecha, slot: extra.slot })
    if (error) { alert('ERROR: ' + error.message); return }
    setExtra({ sid: null, title: '', slot: 'manana' }); cargar()
  }
  const marcar = async (t, status) => {
    await supabase.from('secretary_tasks').update({ status, answered_at: new Date().toISOString(), answer: 'MARCADO MANUAL DESDE EL PANEL' }).eq('id', t.id)
    cargar()
  }
  const quitarTarea = async t => { await supabase.from('secretary_tasks').delete().eq('id', t.id); cargar() }

  return (
    <div>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1>Secretarias</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          {fecha !== hoyISO() && <button className="btn-ghost" onClick={() => setFecha(hoyISO())}>HOY</button>}
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        El bot les pregunta por WhatsApp en 2 cortes (media mañana y tarde), reintenta a los 45 min y a las 6 pm te manda el resumen del día.
        Responden LISTO o los números de lo cumplido y el check se marca solo.
      </p>

      {puedeEditar && (
        <div className="glass" style={{ padding: 12, marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <b style={{ fontSize: 13 }}>REGISTRAR SECRETARIA</b>
          <input placeholder="Nombre completo" value={nva.full_name} onChange={e => setNva({ ...nva, full_name: e.target.value })} style={{ width: 220 }} />
          <input placeholder="WhatsApp (519XXXXXXXX)" value={nva.phone} onChange={e => setNva({ ...nva, phone: e.target.value })} style={{ width: 180 }} />
          <button className="btn" onClick={agregarSec}>AGREGAR</button>
          <span className="muted" style={{ fontSize: 11 }}>{secs.filter(s => s.active).length}/4 activas</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 14, alignItems: 'start' }}>
        {secs.map(s => {
          const ts = tareas.filter(t => t.secretary_id === s.id)
          const rs = rutinas.filter(r => r.secretary_id === s.id)
          const ok = ts.filter(t => t.status === 'hecha').length
          return (
            <div key={s.id} className="glass" style={{ padding: 14, opacity: s.active ? 1 : .55 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <b style={{ flex: 1 }}>{s.full_name}</b>
                <span className="muted" style={{ fontSize: 11 }}>+{s.phone}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1, height: 7, borderRadius: 5, background: 'rgba(255,255,255,.08)' }}>
                  <div style={{ width: (ts.length ? Math.round(ok / ts.length * 100) : 0) + '%', height: '100%', borderRadius: 5, background: '#6fdd9b', transition: 'width .3s' }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{ok}/{ts.length}</span>
              </div>

              {ts.length === 0 && <p className="muted" style={{ fontSize: 12 }}>Sin actividades para esta fecha.</p>}
              {ts.map(t => {
                const e = EST[t.status] || EST.pendiente
                return (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                    <span title={e.t}>{e.i}</span>
                    <span style={{ flex: 1, fontSize: 13, textDecoration: t.status === 'hecha' ? 'line-through' : 'none', opacity: t.status === 'hecha' ? .7 : 1 }}>
                      {t.ask_index ? <b style={{ color: '#9ccb86' }}>{t.ask_index}. </b> : null}{t.title}
                      <span className="muted" style={{ fontSize: 10 }}> · {t.slot === 'manana' ? 'MAÑANA' : 'TARDE'}{t.routine_id ? '' : ' · EXTRA'}</span>
                    </span>
                    {puedeEditar && t.status !== 'hecha' && <button className="btn-ghost" style={{ padding: '1px 7px', fontSize: 11 }} title="Marcar hecha" onClick={() => marcar(t, 'hecha')}>✓</button>}
                    {puedeEditar && t.status === 'hecha' && <button className="btn-ghost" style={{ padding: '1px 7px', fontSize: 11 }} title="Desmarcar" onClick={() => marcar(t, 'pendiente')}>↩</button>}
                    {puedeEditar && <button className="btn-ghost" style={{ padding: '1px 7px', fontSize: 11 }} title="Eliminar" onClick={() => quitarTarea(t)}>✕</button>}
                  </div>
                )
              })}

              {puedeEditar && (
                <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {extra.sid === s.id ? (
                    <>
                      <input autoFocus placeholder="Tarea extra de este día" value={extra.title} onChange={e => setExtra({ ...extra, title: e.target.value })} style={{ flex: 1, minWidth: 150 }} />
                      <select value={extra.slot} onChange={e => setExtra({ ...extra, slot: e.target.value })}>
                        <option value="manana">MAÑANA</option><option value="tarde">TARDE</option>
                      </select>
                      <button className="btn" onClick={agregarExtra}>OK</button>
                      <button className="btn-ghost" onClick={() => setExtra({ sid: null, title: '', slot: 'manana' })}>✕</button>
                    </>
                  ) : (
                    <>
                      <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setExtra({ sid: s.id, title: '', slot: 'manana' })}>+ EXTRA DEL DÍA</button>
                      <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setAbierta(abierta === s.id ? null : s.id)}>⚙ RUTINA ({rs.length})</button>
                      <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => toggleActiva(s)}>{s.active ? 'PAUSAR' : 'ACTIVAR'}</button>
                      <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => quitarSec(s)}>QUITAR</button>
                    </>
                  )}
                </div>
              )}

              {abierta === s.id && puedeEditar && (
                <div style={{ marginTop: 10, borderTop: '1px dashed rgba(255,255,255,.15)', paddingTop: 10 }}>
                  <b style={{ fontSize: 12 }}>RUTINA FIJA</b>
                  {rs.length === 0 && <p className="muted" style={{ fontSize: 12 }}>Sin rutina — agrega la primera actividad.</p>}
                  {rs.map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
                      <span style={{ flex: 1 }}>{r.title}</span>
                      <span className="muted">{r.slot === 'manana' ? 'MAÑANA' : 'TARDE'} · {(r.days || []).map(d => DIAS.find(x => x[0] === d)?.[1]).join('')}</span>
                      <button className="btn-ghost" style={{ padding: '1px 7px', fontSize: 11 }} onClick={() => quitarRutina(r)}>✕</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                    <input placeholder="Nueva actividad de rutina" value={nr.title} onChange={e => setNr({ ...nr, title: e.target.value })} style={{ flex: 1, minWidth: 150 }} />
                    <select value={nr.slot} onChange={e => setNr({ ...nr, slot: e.target.value })}>
                      <option value="manana">MAÑANA</option><option value="tarde">TARDE</option>
                    </select>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {DIAS.map(([n, l]) => (
                        <button key={n} className="btn-ghost" onClick={() => setNr({ ...nr, days: nr.days.includes(n) ? nr.days.filter(d => d !== n) : [...nr.days, n].sort() })}
                          style={{ padding: '2px 7px', fontSize: 11, borderColor: nr.days.includes(n) ? '#9ccb86' : 'rgba(255,255,255,.15)', color: nr.days.includes(n) ? '#9ccb86' : undefined }}>{l}</button>
                      ))}
                    </div>
                    <button className="btn" onClick={() => agregarRutina(s.id)}>AGREGAR</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {secs.length === 0 && <div className="glass" style={{ padding: 24, marginTop: 10 }}>Registra a tu primera secretaria arriba para empezar. 🙌</div>}
    </div>
  )
}
