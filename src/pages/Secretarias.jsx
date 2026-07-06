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
const CATS = { gerencia: { t: 'GERENCIA', c: '#e7c15a' }, administrativa: { t: 'ADMINISTRATIVA', c: '#7ba7f7' }, extra: { t: 'EXTRA', c: '#6fdd9b' } }
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']

export default function Secretarias() {
  const { role, profile } = useAuth()
  const [secs, setSecs] = useState([])
  const [rutinas, setRutinas] = useState([])
  const [tareas, setTareas] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [mes, setMes] = useState(hoyISO().slice(0, 7))
  const [diaSel, setDiaSel] = useState(hoyISO())
  const [secSel, setSecSel] = useState('todas')
  const [nva, setNva] = useState({ full_name: '', phone: '', tipo: 'secretaria' })
  const [abierta, setAbierta] = useState(null)
  const [nr, setNr] = useState({ title: '', slot: 'manana', days: [1, 2, 3, 4, 5, 6], category: 'administrativa' })
  const [extra, setExtra] = useState(null)
  const [mover, setMover] = useState(null)

  const esJefe = ['admin', 'superuser'].includes(role)
  // registro propio: la persona del equipo vinculada a este usuario del sistema
  const mia = secs.find(s => s.user_id && profile?.id && s.user_id === profile.id)
  // GERENCIA solo la ve el superusuario (o el propio gerente vinculado)
  const esVisible = s => role === 'superuser' || s.tipo !== 'gerencia' || (profile?.id && s.user_id === profile.id)
  const secsV = secs.filter(esVisible)

  const cargar = async () => {
    const d1 = mes + '-01'
    const fin = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate()
    const d2 = mes + '-' + String(fin).padStart(2, '0')
    const [a, b, c, u] = await Promise.all([
      supabase.from('secretaries').select('*').order('created_at'),
      supabase.from('secretary_routines').select('*').order('created_at'),
      supabase.from('secretary_tasks').select('*').gte('date', d1).lte('date', d2).order('time', { nullsFirst: true }),
      supabase.from('profiles').select('id, full_name, role').order('full_name'),
    ])
    setSecs(a.data || []); setRutinas(b.data || []); setTareas(c.data || []); setUsuarios(u.data || [])
  }
  useEffect(() => { cargar() }, [mes])
  useEffect(() => { const t = setInterval(cargar, 15000); return () => clearInterval(t) }, [mes])

  if (!['admin', 'superuser', 'secretary', 'manager'].includes(role)) return <div className="glass" style={{ padding: 24 }}>Sin acceso.</div>

  const puedeMarcar = t => esJefe || (mia && t.secretary_id === mia.id)
  const filtroSec = t => (secSel === 'todas' ? secsV.some(s => s.id === t.secretary_id) : t.secretary_id === secSel)
  const rutinasDe = dow => rutinas.filter(r => r.active && (r.days || []).includes(dow) && (secSel === 'todas' || r.secretary_id === secSel) && secsV.find(s => s.id === r.secretary_id && s.active))

  const agregarSec = async () => {
    const limpio = nva.phone.replace(/\D/g, '')
    if (!nva.full_name.trim() || limpio.length < 9) { alert('Nombre y número válido (mín. 9 dígitos)'); return }
    const { error } = await supabase.from('secretaries').insert({ full_name: nva.full_name.trim().toUpperCase(), phone: limpio, tipo: nva.tipo })
    if (error) { alert('ERROR: ' + error.message); return }
    await supabase.from('whatsapp_numbers').upsert({ phone: limpio, tipo: 'secretaria', note: nva.full_name.trim().toUpperCase() + ' (' + nva.tipo.toUpperCase() + ')' })
    setNva({ full_name: '', phone: '', tipo: 'secretaria' }); cargar()
  }
  const toggleActiva = async s => { await supabase.from('secretaries').update({ active: !s.active }).eq('id', s.id); cargar() }
  const toggleSeguimiento = async s => { await supabase.from('secretaries').update({ seguimiento: s.seguimiento === false }).eq('id', s.id); cargar() }
  const vincularUsuario = async (s, uid) => { await supabase.from('secretaries').update({ user_id: uid || null }).eq('id', s.id); cargar() }
  const quitarSec = async s => {
    if (!confirm(`¿Quitar a ${s.full_name}? Se borran sus rutinas y su historial.`)) return
    await supabase.from('whatsapp_numbers').delete().eq('phone', s.phone)
    await supabase.from('secretaries').delete().eq('id', s.id); cargar()
  }
  const agregarRutina = async sid => {
    if (!nr.title.trim() || !nr.days.length) { alert('Título y al menos un día'); return }
    await supabase.from('secretary_routines').insert({ secretary_id: sid, title: nr.title.trim().toUpperCase(), slot: nr.slot, days: nr.days, category: nr.category })
    setNr({ title: '', slot: 'manana', days: [1, 2, 3, 4, 5, 6], category: 'administrativa' }); cargar()
  }
  const quitarRutina = async r => { await supabase.from('secretary_routines').delete().eq('id', r.id); cargar() }
  const crearTarea = async () => {
    if (!extra?.title?.trim() || !extra.sid) return
    const slot = extra.time ? (extra.time < '13:00' ? 'manana' : 'tarde') : extra.slot || 'manana'
    const { error } = await supabase.from('secretary_tasks').insert({ secretary_id: extra.sid, title: extra.title.trim().toUpperCase(), date: diaSel, time: extra.time || null, slot, category: extra.category || 'administrativa' })
    if (error) { alert('ERROR: ' + error.message); return }
    setExtra(null); cargar()
  }
  const marcar = async (t, status) => {
    await supabase.from('secretary_tasks').update({ status, answered_at: new Date().toISOString(), answer: 'MARCADO EN EL PANEL POR ' + (profile?.full_name || role).toUpperCase() }).eq('id', t.id)
    cargar()
  }
  const quitarTarea = async t => { await supabase.from('secretary_tasks').delete().eq('id', t.id); cargar() }
  const guardarMover = async () => {
    if (!mover?.date) return
    const slot = mover.time ? (mover.time < '13:00' ? 'manana' : 'tarde') : undefined
    const upd = { date: mover.date, time: mover.time || null, status: 'pendiente', ask_index: null, asked_at: null, reminded_at: null, answered_at: null, notified_at: null }
    if (slot) upd.slot = slot
    await supabase.from('secretary_tasks').update(upd).eq('id', mover.id)
    setMover(null); cargar()
  }

  const anio = Number(mes.slice(0, 4)), mnum = Number(mes.slice(5, 7))
  const nDias = new Date(anio, mnum, 0).getDate()
  const dow1 = (new Date(anio, mnum - 1, 1).getDay() + 6) % 7
  const celdas = [...Array(dow1).fill(null), ...Array.from({ length: nDias }, (_, i) => i + 1)]
  const hoy = hoyISO()
  const cambiarMes = paso => {
    const d = new Date(anio, mnum - 1 + paso, 1)
    setMes(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'))
  }
  const kpi = sid => {
    const ts = tareas.filter(t => t.secretary_id === sid && t.date <= hoy)
    const base = ts.filter(t => t.category !== 'extra')
    const hechas = base.filter(t => t.status === 'hecha').length
    const extras = ts.filter(t => t.category === 'extra').length
    return { pct: base.length ? Math.round(hechas / base.length * 100) : null, hechas, total: base.length, extras }
  }
  const delDia = tareas.filter(t => t.date === diaSel && filtroSec(t))
  const dowSel = (() => { const d = new Date(diaSel + 'T12:00:00'); const x = d.getDay(); return x === 0 ? 7 : x })()

  return (
    <div>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1>Control de actividades</h1>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="btn-ghost" onClick={() => cambiarMes(-1)}>‹</button>
          <b style={{ minWidth: 150, textAlign: 'center' }}>{MESES[mnum - 1]} {anio}</b>
          <button className="btn-ghost" onClick={() => cambiarMes(1)}>›</button>
        </div>
      </div>

      {mia && <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Estás vinculado como <b style={{ color: '#e8a0c8' }}>{mia.full_name}</b> — puedes marcar tus propias actividades.</p>}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <button className={`chip ${secSel === 'todas' ? 'on' : ''}`} onClick={() => setSecSel('todas')}>TODOS</button>
        {secsV.map(s => {
          const k = kpi(s.id)
          return (
            <button key={s.id} className={`chip ${secSel === s.id ? 'on' : ''}`} onClick={() => setSecSel(s.id)} style={{ opacity: s.active ? 1 : .5 }}>
              {s.tipo === 'gerencia' ? '👔 ' : ''}{s.full_name.split(' ')[0]}{k.pct !== null ? ` · ${k.pct}%` : ''}{k.extras ? ` · +${k.extras}💪` : ''}{s.seguimiento === false ? ' · 🔕' : ''}
            </button>
          )
        })}
      </div>

      {esJefe && (
        <div className="glass" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <b style={{ fontSize: 13 }}>REGISTRAR</b>
          <select value={nva.tipo} onChange={e => setNva({ ...nva, tipo: e.target.value })}>
            <option value="secretaria">SECRETARIA</option><option value="gerencia">GERENCIA</option>
          </select>
          <input placeholder="Nombre completo" value={nva.full_name} onChange={e => setNva({ ...nva, full_name: e.target.value })} style={{ width: 200 }} />
          <input placeholder="WhatsApp (519XXXXXXXX)" value={nva.phone} onChange={e => setNva({ ...nva, phone: e.target.value })} style={{ width: 170 }} />
          <button className="btn" onClick={agregarSec}>AGREGAR</button>
          <span className="muted" style={{ fontSize: 11 }}>{secsV.filter(s => s.active).length} en seguimiento</span>
          {secSel !== 'todas' && (() => { const s = secs.find(x => x.id === secSel); return s && (
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setAbierta(abierta === s.id ? null : s.id)}>⚙ RUTINA</button>
              <button className="btn-ghost" style={{ fontSize: 12 }} title="Si está apagado, el bot no le escribe por WhatsApp" onClick={() => toggleSeguimiento(s)}>{s.seguimiento === false ? '🔕 BOT: NO' : '📡 BOT: SÍ'}</button>
              <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => toggleActiva(s)}>{s.active ? 'PAUSAR' : 'ACTIVAR'}</button>
              <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => quitarSec(s)}>QUITAR</button>
              <select value={s.user_id || ''} title="Usuario del sistema vinculado: podrá ver y marcar sus propias actividades"
                onChange={e => vincularUsuario(s, e.target.value)} style={{ fontSize: 12 }}>
                <option value="">SIN USUARIO DEL SISTEMA</option>
                {usuarios.map(u => <option key={u.id} value={u.id}>👤 {u.full_name} ({u.role})</option>)}
              </select>
            </span>
          ) })()}
        </div>
      )}

      {abierta && esJefe && (() => { const s = secs.find(x => x.id === abierta); if (!s) return null; const rs = rutinas.filter(r => r.secretary_id === s.id); return (
        <div className="glass" style={{ padding: 12, marginBottom: 12 }}>
          <b style={{ fontSize: 13 }}>RUTINA FIJA — {s.full_name}</b> <span className="muted" style={{ fontSize: 11 }}>(se repite cada semana, todo el mes)</span>
          {rs.length === 0 && <p className="muted" style={{ fontSize: 12 }}>Sin rutina aún.</p>}
          {rs.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: CATS[r.category || 'administrativa'].c }} />
              <span style={{ flex: 1 }}>{r.title}</span>
              <span className="muted">{CATS[r.category || 'administrativa'].t} · {r.slot === 'manana' ? 'MAÑANA' : 'TARDE'} · {(r.days || []).map(d => DIAS.find(x => x[0] === d)?.[1]).join('')}</span>
              <button className="btn-ghost" style={{ padding: '1px 7px', fontSize: 11 }} onClick={() => quitarRutina(r)}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
            <input placeholder="Nueva actividad de rutina" value={nr.title} onChange={e => setNr({ ...nr, title: e.target.value })} style={{ flex: 1, minWidth: 150 }} />
            <select value={nr.category} onChange={e => setNr({ ...nr, category: e.target.value })}>
              <option value="administrativa">ADMINISTRATIVA</option><option value="gerencia">GERENCIA</option>
            </select>
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
      ) })()}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.4fr) minmax(280px, 1fr)', gap: 14, alignItems: 'start' }}>
        <div className="glass" style={{ padding: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
            {['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'].map(d => <div key={d} className="muted" style={{ fontSize: 10, textAlign: 'center', fontWeight: 700 }}>{d}</div>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {celdas.map((n, i) => {
              if (!n) return <div key={i} />
              const iso = mes + '-' + String(n).padStart(2, '0')
              const dow = ((dow1 + n - 1) % 7) + 1
              const reales = tareas.filter(t => t.date === iso && filtroSec(t))
              const futuras = iso > hoy ? rutinasDe(dow).length : 0
              const total = reales.length + futuras
              const okAll = reales.length > 0 && reales.every(t => t.status === 'hecha') && !futuras
              const hayRojo = reales.some(t => ['no_hecha', 'sin_respuesta'].includes(t.status))
              return (
                <button key={i} onClick={() => setDiaSel(iso)}
                  style={{
                    minHeight: 58, borderRadius: 8, padding: 4, cursor: 'pointer', fontFamily: 'inherit',
                    border: iso === diaSel ? '2px solid #9ccb86' : iso === hoy ? '1.5px solid rgba(156,203,134,.5)' : '1px solid rgba(255,255,255,.08)',
                    background: iso === diaSel ? 'rgba(156,203,134,.12)' : 'rgba(255,255,255,.02)', color: 'inherit',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  }}>
                  <span style={{ fontSize: 12, fontWeight: iso === hoy ? 800 : 500, color: iso === hoy ? '#9ccb86' : undefined }}>{n}</span>
                  {total > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 800, padding: '1px 7px', borderRadius: 10,
                      background: okAll ? 'rgba(111,221,155,.25)' : hayRojo ? 'rgba(255,142,122,.25)' : 'rgba(224,179,76,.22)',
                      color: okAll ? '#6fdd9b' : hayRojo ? '#ff8e7a' : '#e0b34c',
                    }}>{total}</span>
                  )}
                  {futuras > 0 && <span className="muted" style={{ fontSize: 8 }}>{reales.length ? reales.length + '+' + futuras + ' rutina' : 'rutina'}</span>}
                </button>
              )
            })}
          </div>
          <p className="muted" style={{ fontSize: 10, marginTop: 8 }}>Número = actividades del día (verde: todo cumplido · ámbar: en curso · rojo: hay incumplidas). Los días futuros suman la rutina proyectada.</p>
        </div>

        <div className="glass" style={{ padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <b style={{ flex: 1 }}>{new Date(diaSel + 'T12:00:00').toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}</b>
            {esJefe && <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setExtra({ sid: secSel !== 'todas' ? secSel : (secs[0]?.id || null), title: '', time: '', category: 'administrativa', slot: 'manana' })}>+ PROGRAMAR</button>}
          </div>

          {extra && esJefe && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, padding: 8, border: '1px dashed rgba(156,203,134,.4)', borderRadius: 8 }}>
              <select value={extra.sid || ''} onChange={e => setExtra({ ...extra, sid: e.target.value })}>
                {secsV.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
              <input autoFocus placeholder="¿Qué necesitas que haga?" value={extra.title} onChange={e => setExtra({ ...extra, title: e.target.value })} />
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="time" value={extra.time} onChange={e => setExtra({ ...extra, time: e.target.value })} title="Hora exacta (opcional)" />
                <select value={extra.category} onChange={e => setExtra({ ...extra, category: e.target.value })}>
                  <option value="administrativa">ADMINISTRATIVA</option><option value="gerencia">GERENCIA</option>
                </select>
                {!extra.time && (
                  <select value={extra.slot} onChange={e => setExtra({ ...extra, slot: e.target.value })}>
                    <option value="manana">MAÑANA</option><option value="tarde">TARDE</option>
                  </select>
                )}
                <button className="btn" onClick={crearTarea}>CREAR</button>
                <button className="btn-ghost" onClick={() => setExtra(null)}>✕</button>
              </div>
            </div>
          )}

          {delDia.length === 0 && <p className="muted" style={{ fontSize: 12 }}>Sin actividades registradas este día.{diaSel > hoy && rutinasDe(dowSel).length > 0 ? ' La rutina se genera automáticamente ese día: ' + rutinasDe(dowSel).map(r => r.title).join(', ') + '.' : ''}</p>}
          {secsV.filter(s => secSel === 'todas' || s.id === secSel).map(s => {
            const ts = delDia.filter(t => t.secretary_id === s.id)
            if (!ts.length) return null
            return (
              <div key={s.id} style={{ marginBottom: 10 }}>
                {secSel === 'todas' && <b style={{ fontSize: 12, color: s.tipo === 'gerencia' ? '#e7c15a' : '#e8a0c8' }}>{s.tipo === 'gerencia' ? '👔 ' : ''}{s.full_name}</b>}
                {ts.map(t => {
                  const e = EST[t.status] || EST.pendiente
                  const cat = CATS[t.category || 'administrativa']
                  const editable = puedeMarcar(t)
                  return (
                    <div key={t.id} style={{ padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span title={e.t}>{e.i}</span>
                        <span style={{ flex: 1, fontSize: 13, textDecoration: t.status === 'hecha' ? 'line-through' : 'none', opacity: t.status === 'hecha' ? .75 : 1 }}>
                          {t.ask_index ? <b style={{ color: '#9ccb86' }}>{t.ask_index}. </b> : null}{t.title}
                        </span>
                        {editable && t.status !== 'hecha' && <button className="btn-ghost" style={{ padding: '1px 7px', fontSize: 11 }} title="Marcar hecha" onClick={() => marcar(t, 'hecha')}>✓</button>}
                        {editable && t.status === 'hecha' && <button className="btn-ghost" style={{ padding: '1px 7px', fontSize: 11 }} title="Desmarcar" onClick={() => marcar(t, 'pendiente')}>↩</button>}
                        {esJefe && <button className="btn-ghost" style={{ padding: '1px 7px', fontSize: 11 }} title="Mover de fecha" onClick={() => setMover({ id: t.id, date: t.date, time: t.time ? String(t.time).slice(0, 5) : '' })}>📅</button>}
                        {esJefe && <button className="btn-ghost" style={{ padding: '1px 7px', fontSize: 11 }} title="Eliminar" onClick={() => quitarTarea(t)}>✕</button>}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginLeft: 26, alignItems: 'center' }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: cat.c, border: `1px solid ${cat.c}55`, borderRadius: 8, padding: '0 6px' }}>{cat.t}</span>
                        <span className="muted" style={{ fontSize: 10 }}>{t.time ? '🕐 ' + String(t.time).slice(0, 5) : (t.slot === 'manana' ? 'MAÑANA' : 'TARDE')}{t.routine_id ? ' · RUTINA' : ''}</span>
                        {t.answer && <span className="muted" style={{ fontSize: 9, textTransform: 'none' }} title={t.answer}>· {String(t.answer).slice(0, 40)}</span>}
                      </div>
                      {mover?.id === t.id && (
                        <div style={{ display: 'flex', gap: 6, margin: '6px 0 2px 26px', alignItems: 'center' }}>
                          <input type="date" value={mover.date} onChange={e => setMover({ ...mover, date: e.target.value })} />
                          <input type="time" value={mover.time} onChange={e => setMover({ ...mover, time: e.target.value })} />
                          <button className="btn" style={{ fontSize: 11 }} onClick={guardarMover}>MOVER</button>
                          <button className="btn-ghost" style={{ fontSize: 11 }} onClick={() => setMover(null)}>✕</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      {secs.length === 0 && <div className="glass" style={{ padding: 24, marginTop: 10 }}>Registra a tu primera secretaria arriba para empezar. 🙌</div>}
    </div>
  )
}
