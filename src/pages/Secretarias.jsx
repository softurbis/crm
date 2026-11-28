import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { savedFx } from '../lib/saveFx'
import { avisar, confirmar, pedirDatos } from '../lib/dialogos'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import { useEsCelular } from '../lib/useEsCelular'

const DIAS = [[1, 'L'], [2, 'M'], [3, 'X'], [4, 'J'], [5, 'V'], [6, 'S'], [7, 'D']]
// 28 nov 2026 (sql/246): EN PROCESO (con avance "4 de 6") y PAUSADA (motivo + fecha para retomarla)
const EST = {
  pendiente: { t: 'PENDIENTE', c: '#e0b34c', i: '⏳' },
  en_proceso: { t: 'EN PROCESO', c: '#7ba7f7', i: '◐' },
  hecha: { t: 'HECHA', c: '#6fdd9b', i: '✅' },
  pausada: { t: 'PAUSADA', c: '#b8a1d9', i: '⏸' },
  no_hecha: { t: 'NO HECHA', c: '#ff8e7a', i: '❌' },
  sin_respuesta: { t: 'SIN RESPUESTA', c: '#9daab6', i: '😶' },
}
const MOTIVOS_DEF = ['Lluvia', 'Espera de un tercero', 'Falta de dinero', 'Salud', 'Reprogramada', 'Descartada']
const ICONO_NOTA = { nota: '📝', resultado: '🏁', estado: '🔄', arrastre: '↪', sistema: '⚙' }
const ddmm = f => f ? String(f).slice(8, 10) + '/' + String(f).slice(5, 7) : ''
const horaLima = ts => new Date(ts).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
// 3 arrastres o 3 días hábiles (lun-sáb) sin novedad = se resalta (A3). Se cuenta desde la
// última novedad o desde que la tarea VENCE (fecha_original), lo que sea más reciente: una
// tarea creada hace una semana para hoy no está estancada.
const diasSinNovedad = (t, hoy) => {
  const nov = t.ultima_novedad_at ? new Date(t.ultima_novedad_at).toLocaleDateString('en-CA', { timeZone: 'America/Lima' }) : null
  const vence = t.fecha_original || t.date
  const desde = [nov, vence].filter(Boolean).sort().pop()
  if (!desde) return 0
  const d = new Date(desde + 'T12:00:00'), fin = new Date(hoy + 'T12:00:00')
  let n = 0; while (d < fin) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0) n++ }
  return n
}
const CATS = { gerencia: { t: 'GERENCIA', c: '#e7c15a' }, administrativa: { t: 'ADMINISTRATIVA', c: '#7ba7f7' }, extra: { t: 'EXTRA', c: '#6fdd9b' } }
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']

export default function Secretarias() {
  // esJefe = administrador, superusuario y operador (arman rutinas y marcan por todos).
  // Registrar, pausar o quitar personas y vincularlas a un usuario sigue siendo del superusuario.
  const { role, profile, esJefe } = useAuth()
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
  const [accesos, setAccesos] = useState([])
  const [editT, setEditT] = useState(null)     // edición en línea (título/hora/nota) — aplica solo a ese día
  const [scope, setScope] = useState(null)      // diálogo: borrar solo este día o toda la rutina
  const [reasig, setReasig] = useState(null)    // reasignar tarea a otra persona
  const [motivos, setMotivos] = useState(MOTIVOS_DEF)
  const [notas, setNotas] = useState({})        // task_id -> historial (tarea_notas)
  const [verHist, setVerHist] = useState(null)  // id de la tarea con el historial abierto
  const [notaTxt, setNotaTxt] = useState({})    // task_id -> nota que se está escribiendo
  // entrega 1.2 (28 nov 2026, sql/247): vistas, bandeja sin fecha, sin acuse, proyecto y área
  const { projects = [] } = useProject() || {}
  const [vista, setVista] = useState('calendario')   // calendario · midia · semana · bandeja · sinacuse
  const [bandeja, setBandeja] = useState([])
  const [sinAcuseL, setSinAcuseL] = useState([])
  const [areas, setAreas] = useState(['Administración', 'Ventas', 'Cobranza', 'Obras', 'Legal', 'Marketing', 'Contabilidad'])
  const [fProy, setFProy] = useState('')
  const [fArea, setFArea] = useState('')
  // entrega 1.3 (sql/249): evidencia, revisión por muestreo, dependencias y recursos
  const [adjuntos, setAdjuntos] = useState({})   // task_id -> [tarea_adjuntos]
  const [recursos, setRecursos] = useState([])
  const [muestra, setMuestra] = useState(null)   // tareas hechas sin revisar (muestreo de gerencia)
  const [subiendo, setSubiendo] = useState(null)
  const celular = useEsCelular()   // en celular el título va solo en su línea y los botones debajo

  // registro propio: la persona del equipo vinculada a este usuario del sistema
  const mia = secs.find(s => s.user_id && profile?.id && s.user_id === profile.id)
  // visibilidad: superusuario ve todo; si el usuario tiene accesos configurados, solo esos (+ el suyo);
  // sin configuracion: ve las secretarias (gerencia solo superusuario o el propio gerente)
  const misAccesos = accesos.filter(a => profile?.id && a.user_id === profile.id).map(a => a.secretary_id)
  const esVisible = s => {
    if (role === 'superuser') return true
    if (profile?.id && s.user_id === profile.id) return true
    if (misAccesos.length) return misAccesos.includes(s.id)
    return s.tipo !== 'gerencia'
  }
  const secsV = secs.filter(esVisible)

  const cargar = async () => {
    // el mes y una semana a cada lado (la vista de semana puede cruzar de mes)
    const corrida = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
    const fin = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate()
    const d1 = corrida(mes + '-01', -7)
    const d2 = corrida(mes + '-' + String(fin).padStart(2, '0'), 7)
    const ABIERTAS = ['pendiente', 'en_proceso', 'no_hecha', 'sin_respuesta', 'pausada']
    supabase.from('secretary_tasks').select('*').is('date', null).in('status', ABIERTAS).neq('cancelada', true).order('created_at').then(({ data }) => setBandeja(data || []))
    supabase.from('secretary_tasks').select('*').is('acuse_at', null).in('status', ['pendiente', 'en_proceso']).neq('cancelada', true).order('created_at').then(({ data }) => setSinAcuseL(data || []))
    supabase.from('bot_settings').select('value').eq('key', 'tarea_areas').maybeSingle().then(({ data }) => { try { const a = JSON.parse(data?.value || '[]'); if (Array.isArray(a) && a.length) setAreas(a.map(String)) } catch { /* lista por defecto */ } })
    const [a, b, c, u, sa, mo] = await Promise.all([
      supabase.from('secretaries').select('*').order('created_at'),
      supabase.from('secretary_routines').select('*').order('created_at'),
      supabase.from('secretary_tasks').select('*').gte('date', d1).lte('date', d2).order('time', { nullsFirst: true }),
      supabase.from('profiles').select('id, full_name, role').order('full_name'),
      supabase.from('seguimiento_access').select('*'),
      supabase.from('bot_settings').select('value').eq('key', 'tarea_motivos').maybeSingle(),
    ])
    setSecs(a.data || []); setRutinas(b.data || []); setTareas(c.data || []); setUsuarios(u.data || []); setAccesos(sa.data || [])
    try { const m = JSON.parse(mo.data?.value || '[]'); if (Array.isArray(m) && m.length) setMotivos(m.map(String)) } catch { /* lista por defecto */ }
  }
  // historial y evidencia de lo que está en pantalla (día elegido, hoy, sin fecha, sin acuse)
  const idsDia = [...new Set([...tareas.filter(t => t.date === diaSel || t.date === hoyISO()), ...bandeja, ...sinAcuseL, ...(muestra || [])].map(t => t.id))].join(',')
  useEffect(() => {
    if (!idsDia) { setNotas({}); setAdjuntos({}); return }
    const ids = idsDia.split(',')
    supabase.from('tarea_notas').select('*').in('task_id', ids).order('created_at').then(({ data }) => {
      const m = {}; for (const n of (data || [])) (m[n.task_id] = m[n.task_id] || []).push(n); setNotas(m)
    })
    supabase.from('tarea_adjuntos').select('*').in('task_id', ids).order('created_at').then(({ data }) => {
      const m = {}; for (const a of (data || [])) (m[a.task_id] = m[a.task_id] || []).push(a); setAdjuntos(m)
    })
  }, [idsDia, tareas])
  useEffect(() => { supabase.from('recursos').select('*').order('nombre').then(({ data }) => setRecursos(data || [])) }, [])
  useEffect(() => { cargar() }, [mes])
  useEffect(() => { const t = setInterval(() => { if (!document.hidden) cargar() }, 15000); return () => clearInterval(t) }, [mes])

  if (!['admin', 'superuser', 'operador', 'secretary', 'manager'].includes(role)) return <div className="glass" style={{ padding: 24 }}>Sin acceso.</div>

  const puedeMarcar = t => esJefe || (mia && t.secretary_id === mia.id)
  const filtroSec = t => (secSel === 'todas' ? secsV.some(s => s.id === t.secretary_id) : t.secretary_id === secSel)
    && (!fProy || t.project_id === fProy) && (!fArea || t.area === fArea)   // A12: filtros por proyecto y área
  const rutinasDe = dow => rutinas.filter(r => r.active && (r.days || []).includes(dow) && (secSel === 'todas' || r.secretary_id === secSel) && secsV.find(s => s.id === r.secretary_id && s.active))

  const agregarSec = async () => {
    const limpio = nva.phone.replace(/\D/g, '')
    if (!nva.full_name.trim() || limpio.length < 9) { await avisar('Nombre y número válido (mín. 9 dígitos)', { tono: 'error' }); return }
    const { error } = await supabase.from('secretaries').insert({ full_name: nva.full_name.trim().toUpperCase(), phone: limpio, tipo: nva.tipo })
    if (error) { await avisar('ERROR: ' + error.message); return }
    await supabase.from('whatsapp_numbers').upsert({ phone: limpio, tipo: nva.tipo === 'gerencia' ? 'gerencia' : 'secretaria', note: nva.full_name.trim().toUpperCase() + ' (' + nva.tipo.toUpperCase() + ')' })
    setNva({ full_name: '', phone: '', tipo: 'secretaria' }); savedFx(); cargar()
  }
  const toggleActiva = async s => { await supabase.from('secretaries').update({ active: !s.active }).eq('id', s.id); cargar() }
  const toggleSeguimiento = async s => { await supabase.from('secretaries').update({ seguimiento: s.seguimiento === false }).eq('id', s.id); cargar() }
  // GERENCIA (27 nov 2026): el bot de Telegram le da comandos de gerencia (comisiones, gastos,
  // resumen completo) y su agenda no la ve el resto del equipo. Solo se toca whatsapp_numbers
  // si la fila la creó esta pantalla (secretaria/gerencia): no pisa un número marcado de otra forma.
  const toggleGerencia = async s => {
    const tipo = s.tipo === 'gerencia' ? 'secretaria' : 'gerencia'
    if (!await confirmar(tipo === 'gerencia'
      ? `¿Marcar a ${s.full_name} como GERENCIA?\n\nEn el bot de Telegram verá comisiones, gastos y el resumen completo, y el resto del equipo deja de ver su agenda.`
      : `¿Quitarle GERENCIA a ${s.full_name}?\n\nEn el bot verá solo lo operativo y su agenda vuelve a ser visible para el equipo.`, { aceptar: 'Sí, cambiar' })) return
    const { error } = await supabase.from('secretaries').update({ tipo }).eq('id', s.id)
    if (error) { await avisar('ERROR: ' + error.message); return }
    await supabase.from('whatsapp_numbers').update({ tipo, note: s.full_name + ' (' + tipo.toUpperCase() + ')' }).eq('phone', s.phone).in('tipo', ['secretaria', 'gerencia'])
    savedFx(); cargar()
  }
  const vincularUsuario = async (s, uid) => { await supabase.from('secretaries').update({ user_id: uid || null }).eq('id', s.id); cargar() }
  const quitarSec = async s => {
    if (!await confirmar(`¿Quitar a ${s.full_name}? Se borran sus rutinas y su historial.`, { peligro: true, aceptar: 'Sí, quitar' })) return
    await supabase.from('whatsapp_numbers').delete().eq('phone', s.phone)
    await supabase.from('secretaries').delete().eq('id', s.id); cargar()
  }
  const agregarRutina = async sid => {
    if (!nr.title.trim() || !nr.days.length) { await avisar('Título y al menos un día', { tono: 'error' }); return }
    await supabase.from('secretary_routines').insert({ secretary_id: sid, title: nr.title.trim().toUpperCase(), slot: nr.slot, days: nr.days, category: nr.category })
    setNr({ title: '', slot: 'manana', days: [1, 2, 3, 4, 5, 6], category: 'administrativa' }); savedFx(); cargar()
  }
  const quitarRutina = async r => { await supabase.from('secretary_routines').delete().eq('id', r.id); cargar() }
  const crearTarea = async () => {
    if (!extra?.title?.trim() || !extra.sid) return
    if (extra.visibilidad === 'personas' && !(extra.para || []).length) { await avisar('Elige al menos una persona que pueda ver la tarea (o cambia la privacidad).', { tono: 'error' }); return }
    const slot = extra.time ? (extra.time < '13:00' ? 'manana' : 'tarde') : extra.slot || 'manana'
    if (!(await choqueRecurso({ recurso_id: extra.recurso_id, date: extra.sinFecha ? null : diaSel, time: extra.time, duracion_min: extra.duracion }))) return
    // 1.2: sin fecha (bandeja), proyecto, área, duración y privacidad. Si es para otra persona,
    // el agente le avisa por Telegram y le pide el acuse (sql/247). 1.3: recurso y dependencia.
    const { error } = await supabase.from('secretary_tasks').insert({
      recurso_id: extra.recurso_id || null, depende_de: extra.depende_de || null,
      secretary_id: extra.sid, title: extra.title.trim().toUpperCase(), date: extra.sinFecha ? null : diaSel, time: extra.sinFecha ? null : (extra.time || null), slot,
      category: extra.category || 'administrativa', project_id: extra.project_id || null, area: extra.area || null,
      duracion_min: Number(extra.duracion) > 0 ? Math.min(1440, Math.round(Number(extra.duracion))) : null,
      visibilidad: extra.visibilidad || 'equipo', visible_para: extra.visibilidad === 'personas' ? (extra.para || []) : [],
    })
    if (error) { await avisar('ERROR: ' + error.message); return }
    setExtra(null); savedFx(); cargar()
  }
  // A10 (1.3): evidencia (foto, PDF, audio) — al R2, como el resto de archivos del panel
  const subirEvidencia = async (t, file) => {
    if (!file) return
    if (file.size > 25e6) { await avisar('El archivo pesa más de 25 MB.', { tono: 'error' }); return }
    setSubiendo(t.id)
    try {
      const { subirRuta } = await import('../lib/archivos')
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
      const url = await subirRuta('tareas/' + t.id + '/' + Date.now() + '.' + ext, file)
      const tipo = /^image\//.test(file.type) ? 'foto' : /pdf/.test(file.type) ? 'pdf' : /^audio\//.test(file.type) ? 'audio' : /^video\//.test(file.type) ? 'video' : 'otro'
      const { error } = await supabase.from('tarea_adjuntos').insert({ task_id: t.id, url, nombre: file.name, tipo, via: 'panel' })
      if (error) throw new Error(error.message)
      savedFx(); cargar()
    } catch (e) { await avisar('No se subió: ' + (e.message || e), { tono: 'error' }) }
    finally { setSubiendo(null) }
  }
  // A10: gerencia revisa POR MUESTREO lo que se marcó hecho (no una por una)
  const cargarMuestra = async () => {
    const desde = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data } = await supabase.from('secretary_tasks').select('*').eq('status', 'hecha').is('revision', null).neq('category', 'extra').gte('answered_at', desde).limit(300)
    const lista = [...(data || [])]
    for (let i = lista.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [lista[i], lista[j]] = [lista[j], lista[i]] }
    setMuestra(lista.slice(0, 6))
  }
  const revisar = async (t, revision) => {
    const r = revision === 'sin_prueba'
      ? await pedirDatos({ titulo: '✖ SIN PRUEBA', mensaje: t.title + '\n\nQueda la constancia del incumplimiento en la tarea.', aceptar: 'Dejar constancia', peligro: true, campos: [{ clave: 'nota', etiqueta: '¿Qué faltaba?', tipo: 'largo' }] })
      : {}
    if (!r) return
    const { error } = await supabase.from('secretary_tasks').update({ revision, revisada_at: new Date().toISOString(), revisada_por: profile?.full_name || role }).eq('id', t.id)
    if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return }
    await nota(t, revision === 'ok' ? 'Revisada por gerencia: con prueba ✔' : 'Revisada por gerencia: SIN PRUEBA ✖ (incumplimiento)' + (r.nota ? ' — ' + r.nota : ''), 'sistema')
    setMuestra(m => (m || []).filter(x => x.id !== t.id)); savedFx(); cargar()
  }
  // A8 (1.3): recursos compartidos (motokar, camioneta…). Se editan como una lista separada por comas.
  const editarRecursos = async () => {
    const r = await pedirDatos({ titulo: '🚚 RECURSOS COMPARTIDOS', mensaje: 'Lo que una tarea puede reservar en su horario. Escribe la lista separada por comas; lo que quites deja de ofrecerse (no se borra de las tareas que ya lo tienen).', aceptar: 'Guardar',
      campos: [{ clave: 'lista', etiqueta: 'Recursos', tipo: 'largo', valor: recursos.filter(x => x.activo).map(x => x.nombre).join(', ') }] })
    if (!r) return
    const nuevos = [...new Set(String(r.lista || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean))]
    for (const x of recursos) if (x.activo !== nuevos.includes(x.nombre)) await supabase.from('recursos').update({ activo: nuevos.includes(x.nombre) }).eq('id', x.id)
    const faltan = nuevos.filter(n => !recursos.some(x => x.nombre === n))
    if (faltan.length) { const { error } = await supabase.from('recursos').insert(faltan.map(nombre => ({ nombre }))); if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return } }
    const { data } = await supabase.from('recursos').select('*').order('nombre'); setRecursos(data || []); savedFx()
  }
  // ¿el recurso ya está reservado en ese horario? (misma fecha, horas que se cruzan; 60 min si no dice duración)
  const choqueRecurso = async ({ id, recurso_id, date, time, duracion_min }) => {
    if (!recurso_id || !date || !time) return true
    const aMin = h => { const [a, b] = String(h).slice(0, 5).split(':').map(Number); return a * 60 + b }
    const ini = aMin(time), fin = ini + (Number(duracion_min) || 60)
    const { data } = await supabase.from('secretary_tasks').select('id, title, time, duracion_min, secretary_id').eq('recurso_id', recurso_id).eq('date', date).not('time', 'is', null).neq('cancelada', true).neq('status', 'hecha')
    const cruce = (data || []).filter(x => x.id !== id).find(x => { const a = aMin(x.time), b = a + (x.duracion_min || 60); return a < fin && ini < b })
    if (!cruce) return true
    const rn = recursos.find(x => x.id === recurso_id)?.nombre || 'El recurso'
    const a = aMin(cruce.time), b = a + (cruce.duracion_min || 60), hh = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
    return confirmar(`⚠️ ${rn} ya está reservado de ${hh(a)} a ${hh(b)} para "${cruce.title}" (${(secs.find(s => s.id === cruce.secretary_id)?.full_name || '').split(' ')[0]}).\n\n¿Guardar igual?`, { aceptar: 'Guardar igual', cancelar: 'Cambiar la hora' })
  }
  // A6: el responsable confirma desde el panel que la recibió (si no usa Telegram)
  const recibir = async t => {
    const r = await pedirDatos({ titulo: '📥 RECIBIDA', mensaje: t.title, aceptar: 'Confirmar', campos: [
      { clave: 'fecha', etiqueta: '¿Para cuándo la entregas?', tipo: 'fecha', obligatorio: true, valor: t.date && t.date >= hoy ? t.date : hoy }] })
    if (!r) return
    if (r.fecha < hoy) { await avisar('La fecha no puede ser pasada.', { tono: 'error' }); return }
    const mover = !t.date || r.fecha > t.date
    const { error } = await supabase.from('secretary_tasks').update({ acuse_at: new Date().toISOString(), compromiso_fecha: r.fecha, ...(mover ? { date: r.fecha, ask_index: null, asked_at: null } : {}) }).eq('id', t.id)
    if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return }
    await nota(t, 'Recibida · la entrega el ' + ddmm(r.fecha), 'sistema')
    savedFx(); cargar()
  }
  // A6: ausencia (viaje): el agente pasa sus tareas abiertas al reemplazo y al volver se las devuelve
  const ausencia = async s => {
    if (s.reemplazo_id) {
      if (!await confirmar(`¿Terminar la ausencia de ${s.full_name}? Lo que no se cerró vuelve a su nombre en unos minutos.`, { aceptar: 'Sí, terminar' })) return
      const ayer = new Date(hoy + 'T12:00:00'); ayer.setDate(ayer.getDate() - 1)
      await supabase.from('secretaries').update({ ausente_hasta: ayer.toLocaleDateString('en-CA') }).eq('id', s.id)
      savedFx(); cargar(); return
    }
    const r = await pedirDatos({ titulo: '✈ AUSENCIA', mensaje: s.full_name + ': mientras esté fuera, sus tareas abiertas pasan al reemplazo (con aviso por Telegram) y al volver regresan solas.', aceptar: 'Guardar', campos: [
      { clave: 'desde', etiqueta: 'Desde', tipo: 'fecha', obligatorio: true, valor: hoy },
      { clave: 'hasta', etiqueta: 'Hasta (incluido)', tipo: 'fecha', obligatorio: true },
      { clave: 'reemplazo', etiqueta: 'La reemplaza', tipo: 'opcion', obligatorio: true, opciones: secs.filter(x => x.active && x.id !== s.id).map(x => ({ valor: x.id, etiqueta: x.full_name })) }] })
    if (!r) return
    if (r.hasta < r.desde) { await avisar('"Hasta" no puede ser antes de "desde".', { tono: 'error' }); return }
    const { error } = await supabase.from('secretaries').update({ ausente_desde: r.desde, ausente_hasta: r.hasta, reemplazo_id: r.reemplazo }).eq('id', s.id)
    if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return }
    savedFx(); cargar()
  }
  // VISTA DE CIERRE (28 nov 2026, A1/A2/A5): el estado se cambia con su dato (motivo y fecha
  // al pausar, avance al poner en proceso) y cada nota queda en el historial con autor y hora.
  const nota = async (t, texto, tipo = 'nota') => {
    const x = String(texto || '').trim()
    if (!x) return true
    const { error } = await supabase.from('tarea_notas').insert({ task_id: t.id, tipo, texto: x, via: 'panel' })
    if (error) { await avisar('No se guardó la nota: ' + error.message, { tono: 'error' }); return false }
    return true
  }
  const cambiarEstado = async (t, status) => {
    if (status === t.status) return
    const firma = 'MARCADO EN EL PANEL POR ' + (profile?.full_name || role).toUpperCase()
    let upd = { status, motivo: null, reanudar_el: null, answered_at: new Date().toISOString(), answer: firma }
    let txt = ''
    if (status === 'pendiente') upd = { status, motivo: null, reanudar_el: null, answered_at: null, answer: null }
    if (status === 'en_proceso') {
      const r = await pedirDatos({ titulo: '◐ EN PROCESO', mensaje: t.title, aceptar: 'Guardar', campos: [
        { clave: 'h', etiqueta: 'Cuánto va (opcional)', tipo: 'numero', valor: t.avance_hecho ?? '' },
        { clave: 'tot', etiqueta: 'De cuánto (opcional)', tipo: 'numero', valor: t.avance_total ?? '' },
        { clave: 'nota', etiqueta: 'Nota (opcional)', tipo: 'largo' }] })
      if (!r) return
      const h = r.h === '' || r.h == null ? null : Number(r.h), tot = r.tot === '' || r.tot == null ? null : Number(r.tot)
      upd = { ...upd, avance_hecho: tot ? Math.min(h ?? 0, tot) : null, avance_total: tot || null }
      txt = r.nota
    }
    if (status === 'pausada') {
      const r = await pedirDatos({ titulo: '⏸ PAUSAR', mensaje: t.title, aceptar: 'Pausar', campos: [
        { clave: 'motivo', etiqueta: 'Motivo', tipo: 'opcion', obligatorio: true, opciones: motivos.map(m => ({ valor: m, etiqueta: m })) },
        { clave: 'fecha', etiqueta: 'Retomarla el (vacío = sin fecha)', tipo: 'fecha' },
        { clave: 'nota', etiqueta: 'Nota (opcional)', tipo: 'largo' }] })
      if (!r) return
      if (r.fecha && r.fecha < hoy) { await avisar('La fecha para retomarla no puede ser pasada.', { tono: 'error' }); return }
      upd = { ...upd, motivo: r.motivo, reanudar_el: r.fecha || null }
      txt = r.nota
    }
    if (status === 'no_hecha') {
      const r = await pedirDatos({ titulo: '❌ NO HECHA', mensaje: t.title, aceptar: 'Guardar', campos: [{ clave: 'nota', etiqueta: '¿Qué pasó? (opcional)', tipo: 'largo' }] })
      if (!r) return
      txt = r.nota
    }
    const { error } = await supabase.from('secretary_tasks').update(upd).eq('id', t.id)
    if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return }
    await nota(t, txt)
    savedFx(); cargar()
  }
  const guardarNotaRapida = async t => {
    if (await nota(t, notaTxt[t.id])) { setNotaTxt(n => ({ ...n, [t.id]: '' })); cargar() }
  }
  // A5: la tarea siguiente enlazada, con la misma persona y proyecto; solo pide fecha y texto
  const seguimiento = async t => {
    const r = await pedirDatos({ titulo: '➕ SEGUIMIENTO', mensaje: 'Nace de: ' + t.title, aceptar: 'Crear', campos: [
      { clave: 'texto', etiqueta: '¿Qué hay que hacer?', obligatorio: true, placeholder: 'Ej: llamar al cliente para su separación' },
      { clave: 'fecha', etiqueta: 'Fecha', tipo: 'fecha', obligatorio: true, valor: hoy },
      { clave: 'hora', etiqueta: 'Hora (opcional, HH:MM)', placeholder: '10:00' }] })
    if (!r) return
    const hora = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(r.hora || '').trim()) ? r.hora.trim() : null
    if (r.fecha < hoy) { await avisar('La fecha no puede ser pasada.', { tono: 'error' }); return }
    const { error } = await supabase.from('secretary_tasks').insert({
      secretary_id: t.secretary_id, title: String(r.texto).trim().toUpperCase().slice(0, 200), date: r.fecha, time: hora,
      slot: hora ? (hora < '13:00' ? 'manana' : 'tarde') : (t.slot || 'manana'), category: t.category === 'extra' ? 'administrativa' : (t.category || 'administrativa'),
      project_id: t.project_id || null, sigue_de: t.id,
    })
    if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return }
    await nota(t, 'Seguimiento creado para el ' + ddmm(r.fecha) + (hora ? ' ' + hora : '') + ': ' + String(r.texto).trim(), 'sistema')
    savedFx(); cargar()
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
  // convierte una rutina proyectada de un día en una tarea real (para poder editarla/saltarla ese día)
  const materializar = async (r, date) => {
    const { data: ex } = await supabase.from('secretary_tasks').select('*').eq('routine_id', r.id).eq('date', date).limit(1)
    if (ex && ex[0]) return ex[0]
    const { data } = await supabase.from('secretary_tasks').insert({ secretary_id: r.secretary_id, routine_id: r.id, title: r.title, date, slot: r.slot, category: r.category || 'administrativa' }).select().single()
    return data
  }
  // guardar edición de título/hora/nota — SOLO para ese día (si es rutina proyectada, la materializa)
  const guardarEdit = async () => {
    let id = editT.id
    if (!id && editT.routine) { const t = await materializar(editT.routine, editT.date); id = t?.id }
    if (!id) return
    const upd = { title: (editT.title || '').toUpperCase().trim(), time: editT.time || null }
    if (editT.time) upd.slot = editT.time < '13:00' ? 'manana' : 'tarde'
    if (editT.id) {   // 1.2: proyecto, área, duración y privacidad (no aplica a una rutina proyectada)
      if (editT.visibilidad === 'personas' && !(editT.para || []).length) { await avisar('Elige al menos una persona que pueda ver la tarea (o cambia la privacidad).', { tono: 'error' }); return }
      const orig = tareas.find(x => x.id === editT.id) || bandeja.find(x => x.id === editT.id) || {}
      if (!(await choqueRecurso({ id: editT.id, recurso_id: editT.recurso_id, date: orig.date, time: editT.time, duracion_min: editT.duracion }))) return
      Object.assign(upd, {
        recurso_id: editT.recurso_id || null, depende_de: editT.depende_de || null,
        project_id: editT.project_id || null, area: editT.area || null,
        duracion_min: Number(editT.duracion) > 0 ? Math.min(1440, Math.round(Number(editT.duracion))) : null,
        visibilidad: editT.visibilidad || 'equipo', visible_para: editT.visibilidad === 'personas' ? (editT.para || []) : [],
      })
    }
    const { error } = await supabase.from('secretary_tasks').update(upd).eq('id', id)
    if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return }
    // la nota ya no se pisa: si cambió, entra al historial (y queda como la última)
    const antes = (tareas.find(x => x.id === id)?.note || '').trim(), ahora = (editT.note || '').trim()
    if (ahora && ahora !== antes) await nota({ id }, ahora)
    setEditT(null); cargar()
  }
  const reasignar = async (t, sid) => { if (sid) await supabase.from('secretary_tasks').update({ secretary_id: sid }).eq('id', t.id); setReasig(null); cargar() }
  const restaurar = async t => { await supabase.from('secretary_tasks').update({ cancelada: false }).eq('id', t.id); cargar() }
  // borrar: si es de rutina, pregunta el alcance (este día / toda la rutina); si no, borra directo
  const aplicarScope = async modo => {
    const { task, routine, date } = scope
    if (modo === 'dia') {
      const t = task || (routine ? await materializar(routine, date) : null)
      if (t) await supabase.from('secretary_tasks').update({ cancelada: true }).eq('id', t.id)   // saltar ese día
    } else if (modo === 'rutina' && routine) {
      await supabase.from('secretary_routines').delete().eq('id', routine.id)                     // borra la plantilla (todos los días)
    }
    setScope(null); cargar()
  }
  // proyección de rutinas para el día seleccionado (las que aún no tienen tarea real)
  const itemsDia = sid => {
    const reales = delDia.filter(t => t.secretary_id === sid)
    const conRutina = new Set(reales.filter(t => t.routine_id).map(t => t.routine_id))
    const proyectadas = (diaSel >= hoy && !fProy && !fArea ? rutinasDe(dowSel) : []).filter(r => r.secretary_id === sid && !conRutina.has(r.id))
      .map(r => ({ id: 'proj-' + r.id, proyectada: true, routine: r, title: r.title, slot: r.slot, category: r.category, status: 'pendiente' }))
    return [...reales, ...proyectadas]
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
  // el % cuenta solo lo que ya debía estar cerrado: días pasados y, de hoy, lo ya contestado.
  // Antes sumaba las saltadas (🚫) y lo de hoy que todavía no tocaba, y el % salía bajo.
  const kpi = sid => {
    const ts = tareas.filter(t => t.secretary_id === sid && !t.cancelada && (t.date < hoy || (t.date === hoy && t.status !== 'pendiente')))
    const base = ts.filter(t => t.category !== 'extra')
    const hechas = base.filter(t => t.status === 'hecha').length
    const extras = ts.filter(t => t.category === 'extra').length
    return { pct: base.length ? Math.round(hechas / base.length * 100) : null, hechas, total: base.length, extras }
  }
  const delDia = tareas.filter(t => t.date === diaSel && filtroSec(t))
  const dowSel = (() => { const d = new Date(diaSel + 'T12:00:00'); const x = d.getDay(); return x === 0 ? 7 : x })()

  // ¿quién la ve? (A11) — chips para elegir personas cuando es privada
  const chipsPersonas = (para, cambiar) => (
    <div className="u-d-f u-g-4 u-fwr">
      {secs.filter(s => s.active).map(s => {
        const on = (para || []).includes(s.id)
        return <button key={s.id} type="button" className={`chip ${on ? 'on' : ''}`} style={{ fontSize: 10, padding: '1px 8px' }}
          onClick={() => cambiar(on ? para.filter(x => x !== s.id) : [...(para || []), s.id])}>{s.full_name.split(' ')[0]}</button>
      })}
    </div>
  )
  const VIS = { equipo: '👥 TODO EL EQUIPO', gerencia: '🔒 SOLO GERENCIA', personas: '🔒 PERSONAS ELEGIDAS' }

  // A8: "no empieza hasta terminar…" — las tareas abiertas de esa persona que están a la vista
  const selectDepende = (sid, propia, valor, cambiar) => {
    const ops = [...tareas, ...bandeja].filter((x, i, a) => a.findIndex(y => y.id === x.id) === i)
      .filter(x => x.secretary_id === sid && x.id !== propia && !['hecha'].includes(x.status) && !x.cancelada)
    if (!ops.length && !valor) return null
    return (
      <select className="u-fs-11" value={valor || ''} onChange={e => cambiar(e.target.value || null)} title="No empieza hasta que la otra tarea esté hecha: el bot no la pregunta antes" style={{ maxWidth: 260 }}>
        <option value="">⛓ SIN DEPENDENCIA</option>
        {ops.map(x => <option key={x.id} value={x.id}>⛓ DESPUÉS DE: {(x.date ? ddmm(x.date) + ' ' : '') + String(x.title).slice(0, 50)}</option>)}
      </select>
    )
  }
  // "+ PROGRAMAR": se usa en el calendario y en la bandeja sin fecha
  const formExtra = extra && (esJefe || mia) && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, padding: 8, border: '1px dashed rgba(156,203,134,.4)', borderRadius: 8 }}>
      {esJefe ? (
        <select value={extra.sid || ''} onChange={e => setExtra({ ...extra, sid: e.target.value })}>
          {secsV.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
      ) : <b className="u-fs-12">PARA: {mia?.full_name}</b>}
      <input autoFocus placeholder="¿Qué necesitas que haga?" value={extra.title} onChange={e => setExtra({ ...extra, title: e.target.value })} />
      <div className="u-d-f u-g-6 u-fwr u-ai-c">
        <label className="u-d-f u-g-4 u-ai-c u-fs-11" style={{ flexDirection: 'row', cursor: 'pointer' }} title="Para lo que espera un dato antes de tener fecha">
          <input type="checkbox" checked={!!extra.sinFecha} onChange={e => setExtra({ ...extra, sinFecha: e.target.checked })} /> SIN FECHA
        </label>
        {!extra.sinFecha && <span className="muted u-fs-11">para el {ddmm(diaSel)}</span>}
        {!extra.sinFecha && <input type="time" value={extra.time} onChange={e => setExtra({ ...extra, time: e.target.value })} title="Hora exacta (opcional)" />}
        <select value={extra.category} onChange={e => setExtra({ ...extra, category: e.target.value })}>
          <option value="administrativa">ADMINISTRATIVA</option><option value="gerencia">GERENCIA</option>
        </select>
        {!extra.time && !extra.sinFecha && (
          <select value={extra.slot} onChange={e => setExtra({ ...extra, slot: e.target.value })}>
            <option value="manana">🌅 EN LA MAÑANA</option><option value="tarde">🌇 EN LA TARDE</option>
          </select>
        )}
      </div>
      <div className="u-d-f u-g-6 u-fwr u-ai-c">
        {projects.length > 0 && <select value={extra.project_id || ''} onChange={e => setExtra({ ...extra, project_id: e.target.value })}>
          <option value="">SIN PROYECTO</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>}
        <select value={extra.area || ''} onChange={e => setExtra({ ...extra, area: e.target.value })}>
          <option value="">SIN ÁREA</option>{areas.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="number" min="1" max="1440" placeholder="min" title="Duración estimada en minutos (opcional)" value={extra.duracion || ''} onChange={e => setExtra({ ...extra, duracion: e.target.value })} style={{ width: 70 }} />
        <select value={extra.visibilidad || 'equipo'} onChange={e => setExtra({ ...extra, visibilidad: e.target.value })} title="Quién puede ver esta tarea (el superusuario ve todo)">
          {Object.entries(VIS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {extra.visibilidad === 'personas' && chipsPersonas(extra.para, para => setExtra({ ...extra, para }))}
      <div className="u-d-f u-g-6 u-fwr u-ai-c">
        {recursos.some(r => r.activo) && <select value={extra.recurso_id || ''} onChange={e => setExtra({ ...extra, recurso_id: e.target.value })} title="Reserva un recurso compartido en el horario de la tarea">
          <option value="">🚚 SIN RECURSO</option>{recursos.filter(r => r.activo).map(r => <option key={r.id} value={r.id}>🚚 {r.nombre}</option>)}
        </select>}
        {selectDepende(extra.sid, null, extra.depende_de, v => setExtra({ ...extra, depende_de: v }))}
      </div>
      <div className="u-d-f u-g-6">
        <button className="btn" onClick={crearTarea}>CREAR</button>
        <button className="btn-ghost" onClick={() => setExtra(null)}>✕</button>
      </div>
    </div>
  )

  // una tarea en pantalla: la usan el día del calendario, Mi Día, la bandeja y lo sin acuse
  const renderTarea = t => {
      const proj = t.proyectada
      const e = EST[t.status] || EST.pendiente
      const cat = CATS[t.category || 'administrativa']
      const editable = esJefe || (mia && (t.secretary_id === mia.id || t.routine?.secretary_id === mia.id))
      const esRutina = proj || !!t.routine_id
      const enEdicion = editT && (editT.id === t.id || (proj && editT.routine?.id === t.routine?.id))
      if (t.cancelada) return (
        <div key={t.id} style={{ padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.06)', opacity: .55 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span>🚫</span><span style={{ flex: 1, fontSize: 13, textDecoration: 'line-through' }}>{t.title}</span>
            <span className="muted u-fs-9">SALTADA ESTE DÍA</span>
            {editable && <button className="btn-ghost u-p-1-7 u-fs-11" title="Restaurar" onClick={() => restaurar(t)}>↻</button>}
          </div>
        </div>
      )
      const ojo = !proj && !['hecha', 'pausada'].includes(t.status) && ((t.arrastres || 0) >= 3 || diasSinNovedad(t, hoy) >= 3)
      const hist = notas[t.id] || []
      return (
        <div key={t.id} style={{ padding: '5px 0 5px ' + (ojo ? '6px' : '0'), borderBottom: '1px solid rgba(255,255,255,.06)', borderLeft: ojo ? '3px solid #e0b34c' : undefined, opacity: proj ? .85 : 1 }}>
          {enEdicion ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '2px 0 6px' }}>
              <input value={editT.title} onChange={ev => setEditT({ ...editT, title: ev.target.value })} placeholder="Actividad" />
              <div className="u-d-f u-g-6 u-ai-c u-fwr">
                <input type="time" value={editT.time} onChange={ev => setEditT({ ...editT, time: ev.target.value })} title="Hora exacta (opcional)" />
                <input value={editT.note} onChange={ev => setEditT({ ...editT, note: ev.target.value })} placeholder="nota / observación" style={{ flex: 1, minWidth: 120, textTransform: 'none' }} />
                <button className="btn u-fs-11" onClick={guardarEdit}>GUARDAR</button>
                <button className="btn-ghost u-fs-11" onClick={() => setEditT(null)}>✕</button>
              </div>
              {editT.id && (
                <div className="u-d-f u-g-6 u-ai-c u-fwr">
                  {projects.length > 0 && <select className="u-fs-11" value={editT.project_id || ''} onChange={ev => setEditT({ ...editT, project_id: ev.target.value })}>
                    <option value="">SIN PROYECTO</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>}
                  <select className="u-fs-11" value={editT.area || ''} onChange={ev => setEditT({ ...editT, area: ev.target.value })}>
                    <option value="">SIN ÁREA</option>{areas.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <input className="u-fs-11" type="number" min="1" max="1440" placeholder="min" title="Duración estimada (minutos)" value={editT.duracion || ''} onChange={ev => setEditT({ ...editT, duracion: ev.target.value })} style={{ width: 64 }} />
                  <select className="u-fs-11" value={editT.visibilidad || 'equipo'} onChange={ev => setEditT({ ...editT, visibilidad: ev.target.value })} title="Quién puede ver esta tarea (el superusuario ve todo)">
                    {Object.entries(VIS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              )}
              {editT.id && editT.visibilidad === 'personas' && chipsPersonas(editT.para, para => setEditT({ ...editT, para }))}
              {editT.id && (
                <div className="u-d-f u-g-6 u-ai-c u-fwr">
                  {recursos.some(r => r.activo || r.id === editT.recurso_id) && <select className="u-fs-11" value={editT.recurso_id || ''} onChange={ev => setEditT({ ...editT, recurso_id: ev.target.value })}>
                    <option value="">🚚 SIN RECURSO</option>{recursos.filter(r => r.activo || r.id === editT.recurso_id).map(r => <option key={r.id} value={r.id}>🚚 {r.nombre}</option>)}
                  </select>}
                  {selectDepende(t.secretary_id, t.id, editT.depende_de, v => setEditT({ ...editT, depende_de: v }))}
                </div>
              )}
              {esRutina && <span className="muted u-fs-9">Aplica SOLO a este día. Para cambiar toda la rutina usa ⚙ RUTINA arriba.</span>}
            </div>
          ) : (<>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', rowGap: 4 }}>
              <span title={proj ? 'Proyectada' : e.t}>{proj ? '📌' : e.i}</span>
              <span style={{ flex: celular ? '1 1 calc(100% - 30px)' : '1 1 240px', minWidth: 0, fontSize: 13, textDecoration: t.status === 'hecha' ? 'line-through' : 'none', opacity: t.status === 'hecha' ? .75 : 1 }}>
                {t.ask_index ? <b style={{ color: '#9ccb86' }}>{t.ask_index}. </b> : null}{t.title}
              </span>
              {editable && !proj && t.status !== 'hecha' && <button className="btn-ghost u-p-1-7 u-fs-11" title="Marcar hecha" onClick={() => cambiarEstado(t, 'hecha')}>✓</button>}
              {editable && !proj && (
                <select className="u-fs-11" value={t.status} title="Estado de la tarea" onChange={ev => cambiarEstado(t, ev.target.value)}
                  style={{ padding: '1px 4px', maxWidth: 120, color: e.c, borderColor: e.c + '66' }}>
                  {['pendiente', 'en_proceso', 'hecha', 'pausada', 'no_hecha'].map(s => <option key={s} value={s}>{EST[s].i} {EST[s].t}</option>)}
                  {t.status === 'sin_respuesta' && <option value="sin_respuesta">{EST.sin_respuesta.i} {EST.sin_respuesta.t}</option>}
                </select>
              )}
              {editable && !proj && <button className="btn-ghost u-p-1-7 u-fs-11" title="Seguimiento: crear la tarea siguiente enlazada a esta" onClick={() => seguimiento(t)}>➕</button>}
              {!proj && !t.acuse_at && ['pendiente', 'en_proceso'].includes(t.status) && (esJefe || (mia && t.secretary_id === mia.id)) && (
                <button className="btn-ghost u-p-1-7 u-fs-11" style={{ borderColor: '#e0b34c88', color: '#e0b34c' }} title="Confirmar que la recibiste y para cuándo la entregas" onClick={() => recibir(t)}>📥 RECIBIDA</button>
              )}
              {editable && <button className="btn-ghost u-p-1-7 u-fs-11" title="Editar (este día)" onClick={() => setEditT(proj ? { routine: t.routine, date: diaSel, title: t.title, time: '', note: '' } : { id: t.id, title: t.title, time: t.time ? String(t.time).slice(0, 5) : '', note: t.note || '', project_id: t.project_id || '', area: t.area || '', duracion: t.duracion_min || '', visibilidad: t.visibilidad || 'equipo', para: t.visible_para || [], recurso_id: t.recurso_id || '', depende_de: t.depende_de || null })}>✎</button>}
              {editable && !proj && (
                <label className="btn-ghost u-p-1-7 u-fs-11" style={{ cursor: 'pointer', flexDirection: 'row' }} title="Adjuntar evidencia (foto, PDF, audio)">
                  {subiendo === t.id ? '⏳' : '📎'}
                  <input type="file" accept="image/*,application/pdf,audio/*,video/*" style={{ display: 'none' }} onChange={ev => { subirEvidencia(t, ev.target.files?.[0]); ev.target.value = '' }} />
                </label>
              )}
              {editable && !proj && <button className="btn-ghost u-p-1-7 u-fs-11" title="Mover de fecha" onClick={() => setMover({ id: t.id, date: t.date, time: t.time ? String(t.time).slice(0, 5) : '' })}>📅</button>}
              {editable && !proj && <button className="btn-ghost u-p-1-7 u-fs-11" title="Reasignar" onClick={() => setReasig(t)}>👤</button>}
              {editable && <button className="btn-ghost u-p-1-7 u-fs-11" title="Eliminar" onClick={() => esRutina ? setScope({ action: 'delete', task: proj ? null : t, routine: proj ? t.routine : rutinas.find(r => r.id === t.routine_id), date: diaSel }) : quitarTarea(t)}>✕</button>}
            </div>
            <div style={{ display: 'flex', gap: 6, marginLeft: 26, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: cat.c, border: `1px solid ${cat.c}55`, borderRadius: 8, padding: '0 6px' }}>{cat.t}</span>
              <span className="muted u-fs-10">{t.time ? '🕐 ' + String(t.time).slice(0, 5) : (t.slot === 'manana' ? '🌅 EN LA MAÑANA' : '🌇 EN LA TARDE')}{esRutina ? ' · RUTINA' + (proj ? ' (proyectada)' : '') : ''}</span>
              {t.status === 'en_proceso' && t.avance_total && <span className="u-fs-10" style={{ color: EST.en_proceso.c }}>◐ {t.avance_hecho ?? 0} de {t.avance_total}</span>}
              {t.status === 'pausada' && <span className="u-fs-10" style={{ color: EST.pausada.c }}>⏸ {t.motivo || 'sin motivo'} · {t.reanudar_el ? 'vuelve el ' + ddmm(t.reanudar_el) : 'sin fecha'}</span>}
              {t.arrastres > 0 && <span className="u-fs-10" style={{ color: ojo ? '#e0b34c' : 'var(--muted)' }} title={'Programada originalmente para el ' + ddmm(t.fecha_original)}>↪ ARRASTRADA ×{t.arrastres}</span>}
              {ojo && <span className="u-fs-10" style={{ color: '#e0b34c', fontWeight: 700 }}>⚠️ {(t.arrastres || 0) >= 3 ? 'SE ARRASTRA HACE DÍAS' : 'SIN NOVEDAD HACE 3+ DÍAS'}</span>}
              {t.sigue_de && <span className="muted u-fs-10" title="Nació como seguimiento de otra tarea">🔗 SEGUIMIENTO</span>}
              {/* 1.2: privacidad, proyecto, área, duración, quién la asignó y su acuse */}
              {t.visibilidad && t.visibilidad !== 'equipo' && <span className="u-fs-10" style={{ color: '#e7c15a' }} title={t.visibilidad === 'personas' ? 'Solo la ven: ' + (t.visible_para || []).map(id => secs.find(s => s.id === id)?.full_name.split(' ')[0]).filter(Boolean).join(', ') + ', quien la creó y el responsable' : 'Solo gerencia'}>{VIS[t.visibilidad]}</span>}
              {t.project_id && <span className="muted u-fs-10">🏘 {projects.find(p => p.id === t.project_id)?.name || 'PROYECTO'}</span>}
              {t.area && <span className="muted u-fs-10">🏷 {t.area.toUpperCase()}</span>}
              {t.duracion_min && <span className="muted u-fs-10">⏱ {t.duracion_min >= 60 ? Math.floor(t.duracion_min / 60) + ' h' + (t.duracion_min % 60 ? ' ' + (t.duracion_min % 60) + ' min' : '') : t.duracion_min + ' min'}</span>}
              {!proj && t.creada_por_sec && t.creada_por_sec !== t.secretary_id && <span className="muted u-fs-10">📌 DE {(t.creada_por_nombre || '').split(' ')[0] || 'GERENCIA'}</span>}
              {!proj && t.reasignada_de && <span className="u-fs-10" style={{ color: '#7ba7f7' }}>✈ REEMPLAZA A {(secs.find(s => s.id === t.reasignada_de)?.full_name || '').split(' ')[0]}</span>}
              {!proj && !t.acuse_at && ['pendiente', 'en_proceso'].includes(t.status) && <span className="u-fs-10" style={{ color: '#e0b34c', fontWeight: 700 }}>📭 SIN ACUSE</span>}
              {!proj && t.acuse_at && t.compromiso_fecha && <span className="muted u-fs-10">✅ RECIBIDA · ENTREGA {ddmm(t.compromiso_fecha)}</span>}
              {/* 1.3: recurso, dependencia y revisión de gerencia */}
              {t.recurso_id && <span className="u-fs-10" style={{ color: '#56c7d6' }}>🚚 {recursos.find(r => r.id === t.recurso_id)?.nombre || 'RECURSO'}</span>}
              {t.depende_de && (() => {
                const d = [...tareas, ...bandeja].find(x => x.id === t.depende_de)
                const bloq = !d || d.status !== 'hecha'
                return <span className="u-fs-10" style={{ color: bloq && t.status !== 'hecha' ? '#ff8e7a' : 'var(--muted)' }} title={d ? 'Espera a: ' + d.title : 'Espera a otra tarea'}>⛓ {bloq && t.status !== 'hecha' ? 'BLOQUEADA · ' : ''}DESPUÉS DE {d ? String(d.title).slice(0, 30) : 'OTRA TAREA'}</span>
              })()}
              {t.revision === 'ok' && <span className="u-fs-10" style={{ color: '#6fdd9b' }} title={'Revisada por ' + (t.revisada_por || '')}>🔍 REVISADA ✔</span>}
              {t.revision === 'sin_prueba' && <span className="u-fs-10" style={{ color: '#ff8e7a', fontWeight: 700 }} title={'Revisada por ' + (t.revisada_por || '')}>🔍 SIN PRUEBA ✖</span>}
              {t.resultado && <span className="u-fs-10 u-tt-n" style={{ color: '#6fdd9b' }}>🏁 {t.resultado}</span>}
            </div>
            {/* A2: la última nota completa + su historial; una línea para escribir otra */}
            {!proj && (t.note || hist.length > 0 || editable || (adjuntos[t.id] || []).length > 0) && (
              <div style={{ marginLeft: 26, marginTop: 3 }}>
                {t.note && <div className="muted u-fs-11 u-tt-n" style={{ whiteSpace: 'pre-wrap' }}>📝 {t.note}</div>}
                {/* A10: la evidencia (fotos en miniatura; PDF y audios como enlace) */}
                {(adjuntos[t.id] || []).length > 0 && (
                  <div className="u-d-f u-g-6 u-fwr u-ai-c u-mt-4">
                    {(adjuntos[t.id] || []).map(a => a.tipo === 'foto'
                      ? <a key={a.id} href={a.url} target="_blank" rel="noreferrer" title={(a.autor_nombre || '') + ' · ' + horaLima(a.created_at) + (a.via === 'telegram' ? ' (por Telegram)' : '')}>
                          <img src={a.url} alt="evidencia" style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 6, border: '1px solid rgba(255,255,255,.15)' }} />
                        </a>
                      : <a key={a.id} className="u-fs-10" href={a.url} target="_blank" rel="noreferrer" title={(a.autor_nombre || '') + ' · ' + horaLima(a.created_at)}>
                          {a.tipo === 'pdf' ? '📄' : a.tipo === 'audio' ? '🎙' : a.tipo === 'video' ? '🎬' : '📎'} {String(a.nombre || a.tipo).slice(0, 24)}
                        </a>)}
                  </div>
                )}
                <div className="u-d-f u-g-6 u-ai-c u-mt-4">
                  {editable && <input className="u-f1 u-fs-11 u-tt-n" style={{ padding: '2px 6px', minWidth: 120 }} placeholder="Escribe una nota y Enter…" value={notaTxt[t.id] || ''}
                    onChange={ev => setNotaTxt(n => ({ ...n, [t.id]: ev.target.value }))} onKeyDown={ev => { if (ev.key === 'Enter') guardarNotaRapida(t) }} />}
                  {hist.length > 0 && <button className="btn-ghost u-p-1-7 u-fs-10" title="Historial de la tarea" onClick={() => setVerHist(verHist === t.id ? null : t.id)}>🕘 {hist.length}</button>}
                </div>
                {verHist === t.id && (
                  <div style={{ margin: '4px 0 2px', padding: '4px 8px', borderLeft: '2px solid rgba(255,255,255,.12)' }}>
                    {hist.map(n => (
                      <div key={n.id} className="u-fs-10 u-tt-n" style={{ padding: '1px 0' }}>
                        <span className="muted">{horaLima(n.created_at)} · {n.autor_nombre || (n.via === 'sistema' ? 'sistema' : '—')}{n.via === 'ia' ? ' (por Telegram)' : ''}</span>{' '}
                        {ICONO_NOTA[n.tipo] || '📝'} {n.tipo === 'estado' ? (EST[n.estado_antes]?.t || n.estado_antes) + ' → ' + (EST[n.estado_despues]?.t || n.estado_despues) + (n.texto ? ' · ' + n.texto : '') : n.texto}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {mover?.id === t.id && (
              <div style={{ display: 'flex', gap: 6, margin: '6px 0 2px 26px', alignItems: 'center' }}>
                <input type="date" value={mover.date} onChange={ev => setMover({ ...mover, date: ev.target.value })} />
                <input type="time" value={mover.time} onChange={ev => setMover({ ...mover, time: ev.target.value })} />
                <button className="btn u-fs-11" onClick={guardarMover}>MOVER</button>
                <button className="btn-ghost u-fs-11" onClick={() => setMover(null)}>✕</button>
              </div>
            )}
            {reasig?.id === t.id && (
              <div style={{ display: 'flex', gap: 6, margin: '6px 0 2px 26px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="muted u-fs-11">Reasignar a:</span>
                {secsV.filter(x => x.active && x.id !== t.secretary_id).map(x => <button key={x.id} className="btn-ghost u-fs-11" onClick={() => reasignar(t, x.id)}>{x.full_name.split(' ')[0]}</button>)}
                <button className="btn-ghost u-fs-11" onClick={() => setReasig(null)}>✕</button>
              </div>
            )}
          </>)}
        </div>
      )
  }

  // A7 (1.2): MI DÍA por hora, SEMANA, SIN FECHA (bandeja) y SIN ACUSE (A6)
  const nombreDe = id => (secs.find(s => s.id === id)?.full_name || '').split(' ')[0]
  const grupoHora = t => t.time ? 0 : t.slot === 'tarde' ? 2 : 1
  const ordenHora = (a, b) => grupoHora(a) - grupoHora(b) || String(a.time || '').localeCompare(String(b.time || '')) || String(a.title).localeCompare(String(b.title))
  const GRUPOS = ['🕐 CON HORA', '🌅 EN LA MAÑANA (sin hora)', '🌇 EN LA TARDE (sin hora)']
  const lista = (arr, vacio) => !arr.length ? <p className="muted u-fs-12">{vacio}</p> : arr.map(t => (
    <div key={t.id}>{secSel === 'todas' && <span className="muted u-fs-10">{nombreDe(t.secretary_id)}</span>}{renderTarea(t)}</div>
  ))
  const lunes = (() => { const d = new Date(diaSel + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d })()
  const diasSemana = Array.from({ length: 7 }, (_, i) => { const d = new Date(lunes); d.setDate(d.getDate() + i); return d.toLocaleDateString('en-CA') })
  const vistasNuevas = vista === 'calendario' ? null : (
    <div className="glass u-p-12">
      {vista === 'midia' && (() => {
        const deHoy = tareas.filter(t => t.date === hoy && !t.cancelada && filtroSec(t) && (secSel !== 'todas' || !mia || esJefe || t.secretary_id === mia.id)).sort(ordenHora)
        return <>
          <div className="u-d-f u-ai-c u-g-8 u-mb-8">
            <b className="u-f1">☀️ {secSel !== 'todas' ? 'EL DÍA DE ' + nombreDe(secSel).toUpperCase() : mia && !esJefe ? 'MI DÍA' : 'EL DÍA DEL EQUIPO'} · {new Date(hoy + 'T12:00:00').toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}</b>
            <span className="muted u-fs-11">{deHoy.filter(t => t.status === 'hecha').length}/{deHoy.length} hechas{deHoy.some(t => t.duracion_min) ? ' · ⏱ ' + Math.round(deHoy.filter(t => t.status !== 'hecha').reduce((s, t) => s + (t.duracion_min || 0), 0) / 6) / 10 + ' h por hacer' : ''}</span>
          </div>
          {!deHoy.length && <p className="muted u-fs-12">Nada para hoy. 🎉</p>}
          {[0, 1, 2].map(g => { const arr = deHoy.filter(t => grupoHora(t) === g); return arr.length ? <div key={g} className="u-mb-10"><b className="u-fs-11 muted">{GRUPOS[g]}</b>{lista(arr, '')}</div> : null })}
        </>
      })()}
      {vista === 'semana' && <>
        <div className="u-d-f u-ai-c u-g-8 u-mb-8">
          <button className="btn-ghost" onClick={() => { const d = new Date(lunes); d.setDate(d.getDate() - 7); setDiaSel(d.toLocaleDateString('en-CA')) }}>‹</button>
          <b className="u-f1 u-ta-c">SEMANA DEL {ddmm(diasSemana[0])} AL {ddmm(diasSemana[6])}</b>
          <button className="btn-ghost" onClick={() => { const d = new Date(lunes); d.setDate(d.getDate() + 7); setDiaSel(d.toLocaleDateString('en-CA')) }}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          {diasSemana.map(iso => {
            const arr = tareas.filter(t => t.date === iso && !t.cancelada && filtroSec(t)).sort(ordenHora)
            return (
              <div key={iso} style={{ border: iso === hoy ? '1.5px solid rgba(156,203,134,.6)' : '1px solid rgba(255,255,255,.08)', borderRadius: 8, padding: 6, minHeight: 90 }}>
                <button className="btn-ghost u-w-100 u-fs-11" style={{ marginBottom: 4 }} title="Abrir este día" onClick={() => { setDiaSel(iso); setVista('calendario') }}>
                  {new Date(iso + 'T12:00:00').toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric' }).toUpperCase()} · {arr.length}
                </button>
                {arr.map(t => (
                  <div key={t.id} className="u-fs-10" style={{ padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,.05)', opacity: t.status === 'hecha' ? .6 : 1 }} title={t.title}>
                    {(EST[t.status] || EST.pendiente).i} {t.time ? String(t.time).slice(0, 5) + ' ' : ''}{secSel === 'todas' ? <b>{nombreDe(t.secretary_id)}: </b> : null}{String(t.title).slice(0, 60)}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </>}
      {vista === 'bandeja' && <>
        <div className="u-d-f u-ai-c u-g-8 u-mb-8">
          <b className="u-f1">📥 SIN FECHA — lo que espera un dato antes de agendarse</b>
          {(esJefe || mia) && <button className="btn-ghost u-fs-12" onClick={() => setExtra({ sid: esJefe ? (secSel !== 'todas' ? secSel : (mia?.id || secs[0]?.id || null)) : mia.id, title: '', time: '', category: 'administrativa', slot: 'manana', sinFecha: true })}>+ SIN FECHA</button>}
        </div>
        {formExtra}
        <p className="muted u-fs-10 u-mb-8">Para agendar una, usa 📅 y elige el día. El bot no las pregunta en el pase de lista hasta que tengan fecha.</p>
        {lista(bandeja.filter(filtroSec), 'No hay tareas sin fecha.')}
      </>}
      {vista === 'revisar' && <>
        <div className="u-d-f u-ai-c u-g-8 u-mb-8">
          <b className="u-f1">🔍 REVISIÓN POR MUESTREO — tareas hechas en los últimos 7 días, al azar</b>
          <button className="btn-ghost u-fs-12" onClick={cargarMuestra}>🎲 OTRA MUESTRA</button>
        </div>
        <p className="muted u-fs-10 u-mb-8">Mira la evidencia (📎 fotos, PDF, audios) o el reporte del responsable (📝 nota). ✔ si alcanza como prueba; ✖ si falta: queda la constancia del incumplimiento en la tarea.</p>
        {muestra === null ? <p className="muted u-fs-12">Cargando…</p> : !muestra.length ? <p className="muted u-fs-12">No queda nada por revisar de esta semana. ✅</p> : muestra.map(t => (
          <div key={t.id} className="u-mb-8" style={{ borderBottom: '1px dashed rgba(255,255,255,.1)', paddingBottom: 6 }}>
            <span className="muted u-fs-10">{nombreDe(t.secretary_id)} · {t.date ? ddmm(t.date) : 'sin fecha'} · {(adjuntos[t.id] || []).length ? (adjuntos[t.id] || []).length + ' archivo(s)' : 'SIN ARCHIVOS'}{t.note ? ' · con nota' : ''}</span>
            {renderTarea(t)}
            <div className="u-d-f u-g-6 u-mt-4" style={{ marginLeft: 26 }}>
              <button className="btn u-fs-11" onClick={() => revisar(t, 'ok')}>✔ CON PRUEBA</button>
              <button className="btn-ghost bad u-fs-11" onClick={() => revisar(t, 'sin_prueba')}>✖ SIN PRUEBA</button>
            </div>
          </div>
        ))}
      </>}
      {vista === 'sinacuse' && <>
        <b className="u-d-b u-mb-8">📭 ASIGNADAS QUE NADIE CONFIRMÓ — el responsable todavía no tocó "Recibido"</b>
        <p className="muted u-fs-10 u-mb-8">El aviso le llega por Telegram con botones. Quien no usa Telegram la confirma aquí con 📥 RECIBIDA. Para reasignarla usa 👤.</p>
        {lista(sinAcuseL.filter(t => filtroSec(t) && t.creada_por_sec !== t.secretary_id), 'Todo lo asignado fue recibido. ✅')}
      </>}
    </div>
  )

  return (
    <div>
      <div className="page-head u-d-f u-jc-sb u-ai-c u-fwr u-g-10">
        <h1>Tareas del equipo</h1>
        <div className="u-d-f u-g-6 u-ai-c">
          <button className="btn-ghost" onClick={() => cambiarMes(-1)}>‹</button>
          <b style={{ minWidth: 150, textAlign: 'center' }}>{MESES[mnum - 1]} {anio}</b>
          <button className="btn-ghost" onClick={() => cambiarMes(1)}>›</button>
          {/* B6 (28 nov 2026): las tareas del mes con los filtros puestos (persona, proyecto, área), a Excel */}
          <button className="btn-ghost" title="Bajar a Excel las tareas del mes con los filtros puestos" onClick={async () => {
            const { descargarLista } = await import('../lib/excelLista')
            const nomSec = id => secs.find(s => s.id === id)?.full_name || ''
            const filas = tareas.filter(t => !t.cancelada && filtroSec(t)).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time || '').localeCompare(String(b.time || '')))
            await descargarLista({
              hoja: 'Tareas ' + mes, tituloLibro: 'Tareas del equipo — ' + MESES[mnum - 1] + ' ' + anio, filas,
              columnas: [
                { t: 'Fecha', w: 11, f: 'fecha', v: t => t.date }, { t: 'Hora', w: 7, v: t => t.time ? String(t.time).slice(0, 5) : '' },
                { t: 'Persona', w: 24, v: t => nomSec(t.secretary_id) }, { t: 'Tarea', w: 46, v: t => t.title },
                { t: 'Estado', w: 14, v: t => (EST[t.status]?.t || t.status || '').replace(/^[^\p{L}]+/u, '').toUpperCase() },
                { t: 'Tipo', w: 13, v: t => (t.category || '').toUpperCase() }, { t: 'Proyecto', w: 24, v: t => projects.find(p => p.id === t.project_id)?.name },
                { t: 'Área', w: 14, v: t => t.area }, { t: 'Arrastrada', w: 9, f: 'num', v: t => t.arrastres || null },
                { t: 'Motivo / resultado', w: 36, v: t => [t.motivo, t.resultado, t.note].filter(Boolean).join(' · ') },
                { t: 'Asignada por', w: 20, v: t => t.creada_por_nombre },
              ],
            })
          }}>📥 Excel</button>
        </div>
      </div>

      {mia && <p className="muted u-fs-12 u-mb-8">Estás vinculado como <b style={{ color: '#e8a0c8' }}>{mia.full_name}</b> — puedes gestionar tus propias actividades: marcar, programar, rutina y mover.</p>}

      <div className="u-d-f u-g-6 u-fwr u-mb-10 u-ai-c">
        <button className={`chip ${secSel === 'todas' ? 'on' : ''}`} onClick={() => setSecSel('todas')}>TODOS</button>
        {secsV.map(s => {
          const k = kpi(s.id)
          return (
            <button key={s.id} className={`chip ${secSel === s.id ? 'on' : ''}`} onClick={() => setSecSel(s.id)} style={{ opacity: s.active ? 1 : .5 }}>
              {s.tipo === 'gerencia' ? '👔 ' : ''}{s.full_name.split(' ')[0]}{k.pct !== null ? ` · ${k.pct}%` : ''}{k.extras ? ` · +${k.extras}💪` : ''}{s.seguimiento === false ? ' · 🔕' : ''}
              {s.reemplazo_id && s.ausente_desde <= hoy && (!s.ausente_hasta || s.ausente_hasta >= hoy) ? ' · ✈' : ''}
            </button>
          )
        })}
      </div>

      {/* 1.2: vistas + filtros por proyecto y área */}
      <div className="u-d-f u-g-6 u-fwr u-mb-10 u-ai-c">
        {[['calendario', '📅 CALENDARIO'], ['midia', '☀️ MI DÍA'], ['semana', '🗓 SEMANA'], ['bandeja', '📥 SIN FECHA · ' + bandeja.filter(filtroSec).length], ['sinacuse', '📭 SIN ACUSE · ' + sinAcuseL.filter(t => filtroSec(t) && t.creada_por_sec !== t.secretary_id).length]].map(([v, l]) => (
          <button key={v} className={`chip ${vista === v ? 'on' : ''}`} onClick={() => setVista(v)}>{l}</button>
        ))}
        {(esJefe || mia?.tipo === 'gerencia') && <button className={`chip ${vista === 'revisar' ? 'on' : ''}`} title="Revisar por muestreo lo que se marcó hecho" onClick={() => { setVista('revisar'); cargarMuestra() }}>🔍 REVISAR</button>}
        {esJefe && <button className="chip" title="Motokar, camioneta, maquinaria…" onClick={editarRecursos}>🚚 RECURSOS</button>}
        <span className="u-f1" />
        {projects.length > 0 && <select className="u-fs-12" value={fProy} onChange={e => setFProy(e.target.value)} title="Filtrar por proyecto">
          <option value="">TODOS LOS PROYECTOS</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>}
        <select className="u-fs-12" value={fArea} onChange={e => setFArea(e.target.value)} title="Filtrar por área">
          <option value="">TODAS LAS ÁREAS</option>{areas.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {(esJefe || mia) && (
        <div className="glass u-p-12 u-mb-12 u-d-f u-g-8 u-fwr u-ai-c">
          {role === 'superuser' && <>
          <b className="u-fs-13">REGISTRAR</b>
          <select value={nva.tipo} onChange={e => setNva({ ...nva, tipo: e.target.value })}>
            <option value="secretaria">SECRETARIA</option><option value="gerencia">GERENCIA</option>
          </select>
          <input placeholder="Nombre completo" value={nva.full_name} onChange={e => setNva({ ...nva, full_name: e.target.value })} style={{ width: 200 }} />
          <input placeholder="WhatsApp (519XXXXXXXX)" value={nva.phone} onChange={e => setNva({ ...nva, phone: e.target.value })} style={{ width: 170 }} />
          <button className="btn" onClick={agregarSec}>AGREGAR</button>
          </>}
          <span className="muted u-fs-11">{secsV.filter(s => s.active).length} en seguimiento</span>
          {!esJefe && mia && <button className="btn-ghost u-fs-12" onClick={() => setAbierta(abierta === mia.id ? null : mia.id)}>&#9881; MI RUTINA</button>}
          {esJefe && secSel !== 'todas' && (() => { const s = secs.find(x => x.id === secSel); return s && (
            <span className="u-d-f u-g-6 u-fwr u-ai-c">
              <button className="btn-ghost u-fs-12" onClick={() => setAbierta(abierta === s.id ? null : s.id)}>⚙ RUTINA</button>
              {role === 'superuser' && <button className="btn-ghost u-fs-12" title="Si está apagado, el bot no le pasa lista por Telegram" onClick={() => toggleSeguimiento(s)}>{s.seguimiento === false ? '🔕 BOT: NO' : '📡 BOT: SÍ'}</button>}
              {role === 'superuser' && <button className="btn-ghost u-fs-12" title="Gerencia: en el bot ve comisiones, gastos y el resumen completo; su agenda no la ve el resto del equipo" onClick={() => toggleGerencia(s)}>{s.tipo === 'gerencia' ? '👔 GERENCIA: SÍ' : '👔 GERENCIA: NO'}</button>}
              <button className="btn-ghost u-fs-12" title="Viaje o ausencia: sus tareas pasan a un reemplazo y vuelven solas" onClick={() => ausencia(s)}>{s.reemplazo_id ? '✈ TERMINAR AUSENCIA (hasta ' + ddmm(s.ausente_hasta) + ')' : '✈ AUSENCIA'}</button>
              {role === 'superuser' && <button className="btn-ghost u-fs-12" onClick={() => toggleActiva(s)}>{s.active ? 'PAUSAR' : 'ACTIVAR'}</button>}
              {role === 'superuser' && <button className="btn-ghost u-fs-12" onClick={() => quitarSec(s)}>QUITAR</button>}
              {role === 'superuser' && <select className="u-fs-12" value={s.user_id || ''} title="Usuario del sistema vinculado: podrá ver y marcar sus propias actividades"
                onChange={e => vincularUsuario(s, e.target.value)}>
                <option value="">SIN USUARIO DEL SISTEMA</option>
                {usuarios.map(u => <option key={u.id} value={u.id}>👤 {u.full_name} ({u.role})</option>)}
              </select>}
            </span>
          ) })()}
        </div>
      )}

      {abierta && (esJefe || (mia && abierta === mia.id)) && (() => { const s = secs.find(x => x.id === abierta); if (!s) return null; const rs = rutinas.filter(r => r.secretary_id === s.id); return (
        <div className="glass u-p-12 u-mb-12">
          <b className="u-fs-13">RUTINA FIJA — {s.full_name}</b> <span className="muted u-fs-11">(se repite cada semana, todo el mes)</span>
          <p className="muted" style={{ fontSize: 10, margin: '2px 0 6px' }}>🌅 <b>Mañana</b> / 🌇 <b>Tarde</b> = cuándo el bot pasa lista por Telegram: el pase de la mañana pregunta lo de la mañana; desde la 1 p. m. pregunta todo lo que siga abierto. Si pones una <b>hora exacta</b> (al editar el día), el bot avisa a esa hora.</p>
          {rs.length === 0 && <p className="muted u-fs-12">Sin rutina aún.</p>}
          {rs.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: CATS[r.category || 'administrativa'].c }} />
              <span className="u-f1">{r.title}</span>
              <span className="muted">{CATS[r.category || 'administrativa'].t} · {r.slot === 'manana' ? 'MAÑANA' : 'TARDE'} · {(r.days || []).map(d => DIAS.find(x => x[0] === d)?.[1]).join('')}</span>
              <button className="btn-ghost u-p-1-7 u-fs-11" onClick={() => quitarRutina(r)}>✕</button>
            </div>
          ))}
          <div className="u-d-f u-g-6 u-fwr u-mt-8 u-ai-c">
            <input placeholder="Nueva actividad de rutina" value={nr.title} onChange={e => setNr({ ...nr, title: e.target.value })} style={{ flex: 1, minWidth: 150 }} />
            <select value={nr.category} onChange={e => setNr({ ...nr, category: e.target.value })}>
              <option value="administrativa">ADMINISTRATIVA</option><option value="gerencia">GERENCIA</option>
            </select>
            <select value={nr.slot} onChange={e => setNr({ ...nr, slot: e.target.value })}>
              <option value="manana">🌅 EN LA MAÑANA</option><option value="tarde">🌇 EN LA TARDE</option>
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

      {vista === 'calendario' && (
      <div className="dos-paneles" style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.4fr) minmax(280px, 1fr)', gap: 14, alignItems: 'start' }}>
        <div className="glass u-p-12">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
            {['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'].map(d => <div key={d} className="muted u-fs-10 u-ta-c u-fw-7">{d}</div>)}
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
          <p className="muted u-fs-10 u-mt-8">Número = actividades del día (verde: todo cumplido · ámbar: en curso · rojo: hay incumplidas). Los días futuros suman la rutina proyectada.</p>
        </div>

        <div className="glass u-p-12">
          <div className="u-d-f u-ai-c u-g-8 u-mb-8">
            <b className="u-f1">{new Date(diaSel + 'T12:00:00').toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}</b>
            {(esJefe || mia) && <button className="btn-ghost u-fs-12" onClick={() => setExtra({ sid: esJefe ? (secSel !== 'todas' ? secSel : (secs[0]?.id || null)) : mia.id, title: '', time: '', category: 'administrativa', slot: 'manana' })}>+ PROGRAMAR</button>}
          </div>

          {formExtra}

          {!secsV.filter(s => secSel === 'todas' || s.id === secSel).some(s => itemsDia(s.id).length) && <p className="muted u-fs-12">Sin actividades este día.</p>}
          {secsV.filter(s => secSel === 'todas' || s.id === secSel).map(s => {
            const items = itemsDia(s.id)
            if (!items.length) return null
            return (
              <div className="u-mb-10" key={s.id}>
                {secSel === 'todas' && <b style={{ fontSize: 12, color: s.tipo === 'gerencia' ? '#e7c15a' : '#e8a0c8' }}>{s.tipo === 'gerencia' ? '👔 ' : ''}{s.full_name}</b>}
                {items.map(t => renderTarea(t))}
              </div>
            )
          })}
        </div>
      </div>
      )}
      {vistasNuevas}

      {scope && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setScope(null)}>
          <div className="glass" style={{ padding: 20, maxWidth: 340, width: '90%' }} onClick={e => e.stopPropagation()}>
            <b>¿Eliminar esta actividad de rutina?</b>
            <p className="muted" style={{ fontSize: 12, margin: '8px 0 14px' }}>Elige el alcance:</p>
            <button className="btn u-w-100 u-mb-8" onClick={() => aplicarScope('dia')}>Solo este día (saltarla)</button>
            <button className="btn-ghost bad u-w-100 u-mb-8" onClick={() => aplicarScope('rutina')}>Toda la rutina (borrar plantilla)</button>
            <button className="btn-ghost u-w-100" onClick={() => setScope(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {secs.length === 0 && <div className="glass" style={{ padding: 24, marginTop: 10 }}>Registra a tu primera secretaria arriba para empezar. 🙌</div>}
    </div>
  )
}
