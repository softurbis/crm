import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import BrainMap from '../components/BrainMap'

const FLOW = {
  espera_nombre:   { t: 'ESPERANDO NOMBRE',  c: '#e0b34c' },
  espera_proyecto: { t: 'ELIGIENDO PROYECTO', c: '#7ec8e3' },
  completado:      { t: 'CALIFICADO',         c: '#7fbf7f' },
}
const TIPOS = [
  { v: 'desactivado', t: 'ADMINISTRATIVO (el bot no le responde; si recibe avisos internos)', s: 'ADMINISTRATIVO', c: '#e07b7b' },
  { v: 'bot',         t: 'BOT (flujo de leads)',                    s: 'BOT', c: '#9ccb86' },
  { v: 'cliente',     t: 'CLIENTE (solo cobranza)',                 s: 'CLIENTE', c: '#b8a1d9' },
  { v: 'secretaria',  t: 'SECRETARIA (seguimiento de actividades)', s: 'SECRETARIA', c: '#7ec8e3' },
  { v: 'gerencia',    t: 'GERENCIA (seguimiento de actividades)',   s: '\u{1F454} GERENCIA', c: '#e7c15a' },
  { v: 'silencio',    t: 'SILENCIO TOTAL (nunca responde ni escribe)', s: '\u{1F507} SILENCIO TOTAL', c: '#8b95a1' },
]
const fh = iso => iso ? new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
// material adjuntable en cada paso del flujo (clave que entiende el agente -> etiqueta)
const MEDIA_OPTS = [['foto1', 'Foto 1'], ['foto2', 'Foto 2'], ['foto3', 'Foto 3'], ['video', 'Video'], ['maps', 'Maps'], ['vista360', 'Tour 360°'], ['plano', 'Plano'], ['brochure', 'Brochure']]
const nuevoPasoId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now() + Math.random().toString(36).slice(2, 6))
// tarjetas por sección (cobranza / seguimiento) — se guardan como texto con "## TAG"
const COB_CARDS = [['A5', 'A · 5 días antes', '{nombre} {lote} {proyecto} {cuota} {monto} {fecha}'], ['A3', 'A · 3 días antes', '{nombre} {lote} {proyecto} {cuota} {monto} {fecha}'], ['A0', 'A · Vence hoy', '{nombre} {lote} {proyecto} {cuota} {monto} {fecha}'], ['INSISTENCIA', 'Insistencia (1 vencida)', '{nombre} {lote} {proyecto} {cuota} {monto} {fecha} {dias}'], ['B', '2 cuotas vencidas', '{nombre} {lote} {proyecto} {nvencidas} {deuda}'], ['C', '3+ cuotas vencidas', '{nombre} {lote} {proyecto} {nvencidas} {deuda}']]
const SEC_CARDS = [['SALUDO', 'Saludo matutino (buenos días + pendientes)', '{nombre} {lista}'], ['PREGUNTA', 'Pase de lista', '{nombre} {lista} {momento}'], ['RECORDATORIO', 'Recordatorio', '{nombre} {lista}'], ['CONFIRMACION', 'Confirmación', '{nombre} {resumen}'], ['PENDIENTE', 'Quedan pendientes', '{nombre}'], ['NO_ENTENDI', 'No entendí', '{nombre}'], ['RESUMEN', 'Resumen al admin', '{detalle}'], ['FEEDBACK', '¿Algo extra? (pregunta)', '{nombre}'], ['AVISO_HORA', 'Aviso por hora de tarea', '{nombre} {titulo} {hora}']]
const parseSecc = txt => { const o = {}; ('\n' + String(txt || '')).split(/\n##[ \t]*/).slice(1).forEach(p => { const nl = p.indexOf('\n'); if (nl < 0) { const tag = p.trim().split(/[\s(]+/)[0].toUpperCase(); if (tag) o[tag] = ''; return } const tag = p.slice(0, nl).trim().split(/[\s(]+/)[0].toUpperCase(); if (tag) o[tag] = p.slice(nl + 1).trim() }); return o }
const armarSecc = (obj, order) => order.filter(([k]) => (obj[k] || '').trim()).map(([k]) => '## ' + k + '\n' + (obj[k] || '').trim()).join('\n\n')
const parseArr = s => { try { const o = JSON.parse(String(s || '')); return Array.isArray(o) ? o : [] } catch { return [] } }
// consultas que puede mapear un comando de gerencia (reutilizan las plantillas gratis del bot)
// buckets de cobranza por nº de cuotas vencidas: [clave, título, etiqueta-días, ¿tiene "repetir"?]
const COB_BUCKETS = [['al_dia', '✅ Al día (0 vencidas)', 'días ANTES de vencer', false], ['v1', '🟡 1 cuota vencida', 'días después de vencer', true], ['v2', '🟠 2 cuotas vencidas', 'días después', true], ['v3', '🔴 3 cuotas vencidas', 'días después', true], ['v4', '⛔ 4 o más vencidas', 'días después', true]]
const CONSULTAS_GER = [['resumen', 'Resumen del día'], ['lotes', 'Lotes disponibles y precios'], ['comisiones', 'Comisiones por cobrar'], ['vencidas', 'Cuotas vencidas'], ['gastos', 'Gastos del año/mes'], ['visitas', 'Visitas programadas'], ['ventas', 'Ventas (en proceso/pagadas)'], ['ingresos', 'Ingresos del mes'], ['separaciones', 'Separaciones vigentes'], ['clientes', 'Total de clientes'], ['cartera', 'Cartera por cobrar (total)'], ['pipeline', 'Pipeline de leads'], ['pagos de hoy', 'Pagos de hoy'], ['entregados', 'Lotes entregados'], ['top asesor', 'Top asesor (comisiones)'], ['pendientes', 'Pendientes de secretarias (hoy)'], ['cumplimiento', 'Cumplimiento de secretarias (hoy)']]
// acciones de seguimiento configurables en gerencia (programar / reprogramar)
const ACCIONES_GER = [['crear_tarea', 'Crear/programar tarea'], ['reprogramar_tarea', 'Reprogramar tarea']]

function ReplyBox({ phone, onSent }) {
  const [txt, setTxt] = useState('')
  const [mandando, setMandando] = useState(false)
  const enviarMsg = async () => {
    const body = txt.trim()
    if (!body) return
    setMandando(true)
    await supabase.from('scheduled_messages').insert({ recipient_phone: phone, body, tipo: 'manual_panel', status: 'pendiente', scheduled_for: new Date().toISOString() })
    setTxt(''); setMandando(false); onSent && onSent()
  }
  return (
    <div className="wa-reply">
      <input value={txt} onChange={e => setTxt(e.target.value)} placeholder="Escribe y el bot lo envía desde el número de Urbis…"
        onKeyDown={e => { if (e.key === 'Enter') enviarMsg() }} />
      <button className="wa-btn wa-solid" disabled={mandando} onClick={enviarMsg}>{mandando ? '…' : '➤ ENVIAR'}</button>
    </div>
  )
}

export default function Whatsapp() {
  const { role } = useAuth()
  const [convs, setConvs] = useState([])
  const [sel, setSel] = useState(null)
  const [msgs, setMsgs] = useState([])
  const [busca, setBusca] = useState('')
  const [vista, setVista] = useState('lista')
  const [filtro, setFiltro] = useState('todos')
  const [flags, setFlags] = useState({ bot_activo: true, cobranza_activa: true, ia_activa: true, seguimiento_activo: true })
  const [verNums, setVerNums] = useState(false)
  const [nums, setNums] = useState([])
  const [nvo, setNvo] = useState({ phone: '', tipo: 'desactivado', note: '' })
  const [edNum, setEdNum] = useState(null)
  const [adminPhone, setAdminPhone] = useState('')
  const [waEstado, setWaEstado] = useState('')
  const [qrImg, setQrImg] = useState('')
  const [waLatido, setWaLatido] = useState('')
  const [verBrains, setVerBrains] = useState(false)
  const [brains, setBrains] = useState([])
  const [proys, setProys] = useState([])
  const [brainSel, setBrainSel] = useState('cobranza')
  const [brainTxt, setBrainTxt] = useState('')
  const [brainMsg, setBrainMsg] = useState('')
  const [ensenaTxt, setEnsenaTxt] = useState('')
  const [secCfg, setSecCfg] = useState({ checkins: ['11:00', '16:30'], recordatorio: true, avisoHora: true, feedback: true, feedbackHora: '17:30', saludoActivo: true, saludoHora: '07:30' })
  const [secMsg, setSecMsg] = useState('')
  const [projQ, setProjQ] = useState([])
  const [projNotify, setProjNotify] = useState('')
  const [projQMsg, setProjQMsg] = useState('')
  const [projFlow, setProjFlow] = useState({ reask_min: 5, max_reasks: 1, reask_text: '', bienvenida: '', pide_nombre: '', no_nombre: '', media_lib: [], bombardeo: [], steps: [] })
  const [subiendo, setSubiendo] = useState(false)
  const [cobCfg, setCobCfg] = useState({ al_dia: { avisos: [] }, v1: { avisos: [], repetir: { cada_dias: 3, mensaje: '' } }, v2: { avisos: [], repetir: { cada_dias: 3, mensaje: '' } }, v3: { avisos: [], repetir: { cada_dias: 3, mensaje: '' } }, v4: { avisos: [], repetir: { cada_dias: 3, mensaje: '' } } })
  const [cobFlow, setCobFlow] = useState([])         // reglas de respuesta de cobranza
  const [secCards, setSecCards] = useState({})       // tarjetas de seguimiento (por sección)
  const [gerCmds, setGerCmds] = useState([])         // comandos configurables de gerencia
  const [cfgMsg, setCfgMsg] = useState('')
  const selRef = useRef(null)
  const endRef = useRef(null)

  const cargarFlags = async () => {
    const { data } = await supabase.from('bot_settings').select('key, value')
    if (data) {
      const f = { ...flags }
      let qr = ''
      data.forEach(r => {
        if (r.key === 'admin_phone') setAdminPhone(r.value || '')
        else if (r.key === 'wa_estado') setWaEstado(r.value || '')
        else if (r.key === 'wa_qr') qr = r.value || ''
        else if (r.key === 'wa_latido') setWaLatido(r.value || '')
        else if (r.key.startsWith('sec_') || ['hora_corte_manana', 'hora_corte_tarde', 'hora_resumen_sec', 'hora_feedback_sec', 'wa_relink', 'wa_restart', 'hora_aviso_sep', 'sep_aviso_fecha'].includes(r.key)) { /* config, no es flag */ }
        else f[r.key] = r.value !== '0'
      })
      setFlags(f)
      const kv = Object.fromEntries(data.map(r => [r.key, r.value]))
      let cks = ['11:00', '16:30']
      try { const c = JSON.parse(kv.sec_checkins || '[]'); if (Array.isArray(c) && c.length) cks = c.map(x => String(x).slice(0, 5)) } catch {}
      setSecCfg({
        checkins: cks,
        recordatorio: kv.sec_recordatorio !== '0',
        avisoHora: kv.sec_aviso_hora !== '0',
        feedback: kv.sec_feedback !== '0',
        feedbackHora: (kv.hora_feedback_sec || '17:30').slice(0, 5),
        saludoActivo: kv.sec_saludo_activo !== '0',
        saludoHora: (kv.sec_saludo_hora || '07:30').slice(0, 5),
      })
      if (qr) QRCode.toDataURL(qr, { width: 260, margin: 1 }).then(setQrImg).catch(() => setQrImg(''))
      else setQrImg('')
    }
  }
  const pedirRelink = async () => {
    if (!confirm('¿VINCULAR OTRO NÚMERO?\n\nEsto desconecta el WhatsApp actual del bot y en ~30 segundos aparecerá aquí un código QR para escanear con el celular nuevo.\n\nEl bot dejará de responder hasta que escanees el QR.')) return
    await supabase.from('bot_settings').upsert({ key: 'wa_relink', value: '1', updated_at: new Date().toISOString() })
    setWaEstado('esperando_qr')
    alert('Pedido enviado. El QR aparecerá aquí en ~30 segundos (la sección se refresca sola).')
  }
  const reiniciarBot = async () => {
    if (!confirm('¿REINICIAR EL BOT?\n\nUsalo si dejo de responder. Tarda ~30-60 segundos en volver a EN LINEA y la sesion de WhatsApp NO se pierde (no hay que escanear QR).')) return
    await supabase.from('bot_settings').upsert({ key: 'wa_restart', value: '1', updated_at: new Date().toISOString() })
    alert('Reinicio solicitado. El bot lo detecta en maximo 15 segundos. Observa el chip de estado: pasara a SIN RESPONDER un momento y luego a EN LINEA.')
  }
  const cambiarAdmin = async () => {
    const v = prompt('NÚMERO ADMINISTRADOR (recibe avisos de leads, reportes de cobranza y resumen de secretarias).\n\nFormato: 51 + número (ej. 51924947651):', adminPhone || '51')
    if (v === null) return
    const d = String(v).replace(/\D/g, '')
    if (d.length < 11) { alert('Número inválido: debe incluir el 51 (ej. 51924947651)'); return }
    await supabase.from('bot_settings').upsert({ key: 'admin_phone', value: d, updated_at: new Date().toISOString() })
    setAdminPhone(d)
    alert('✅ ADMIN cambiado a +' + d + '. El bot lo aplica en máx. 1 minuto.')
  }
  const setFlag = async (k, val) => {
    await supabase.from('bot_settings').upsert({ key: k, value: val ? '1' : '0', updated_at: new Date().toISOString() })
    setFlags(p => ({ ...p, [k]: val }))
  }
  const cargarNums = async () => {
    const { data } = await supabase.from('whatsapp_numbers').select('*').order('created_at', { ascending: false })
    setNums(data || [])
  }
  const guardarNum = async (phone, tipo, note) => {
    const limpio = String(phone).replace(/\D/g, '')
    if (limpio.length < 9) { alert('NUMERO INVALIDO (minimo 9 digitos)'); return }
    await supabase.from('whatsapp_numbers').upsert({ phone: limpio, tipo, note: (note || '').toUpperCase() })
    setNvo({ phone: '', tipo: 'desactivado', note: '' })
    cargarNums()
  }
  const borrarNum = async phone => { await supabase.from('whatsapp_numbers').delete().eq('phone', phone); cargarNums() }

  // Cada cerebro: clave, título largo (editor), etiqueta corta y color (mapa radial),
  // y "meta" objetivo de longitud para calcular el % de completado del nodo.
  // El bot de LEADS es 100% flujo por proyecto (preguntas cerradas), sin IA: no hay cerebro de ventas.
  // Solo quedan las plantillas de cobranza/seguimiento y el Q&A de gerencia. Las preguntas de cada
  // proyecto se editan en su FICHA (nodos 📁).
  const BRAIN_DEFS = [
    { k: 'cobranza', t: '💵 COBRANZA — plantillas de mensajes', lbl: 'COBRANZA', color: '#e0b34c', meta: 600 },
    { k: 'secretaria', t: '🗓️ SECRETARIA — mensajes del seguimiento', lbl: 'SEGUIMIENTO', color: '#b8a1d9', meta: 600 },
    { k: 'gerencia', t: '🔐 GERENCIA — notas internas para el Q&A del equipo (opcional)', lbl: 'GERENCIA', color: '#6fd0c9', meta: 500 },
  ]
  const cargarBrains = async () => {
    const [{ data: b }, { data: p }] = await Promise.all([
      supabase.from('bot_brains').select('*'),
      supabase.from('projects').select('id, name, bot_knowledge, bot_questions, lead_notify_phone, bot_flow').order('name'),
    ])
    setBrains(b || []); setProys(p || [])
    return { b: b || [], p: p || [] }
  }
  const textoDe = k => k.startsWith('p:')
    ? (proys.find(x => x.id === k.slice(2))?.bot_knowledge || '')
    : (brains.find(x => x.key === k)?.content || '')
  // Nodos del mapa radial: cerebros base + una rama por cada proyecto (su ficha).
  const buildNodes = () => {
    const base = BRAIN_DEFS.map(d => {
      const len = (brains.find(x => x.key === d.k)?.content || '').trim().length
      const node = { key: d.k, label: d.lbl, color: d.color, nivel: Math.min(1, len / d.meta), selected: brainSel === d.k }
      if (d.k === 'aprendido') node.badge = (brains.find(x => x.key === 'aprendido')?.content || '').split('\n').filter(l => l.trim()).length || null
      return node
    })
    const fichas = proys.map(p => ({
      key: 'p:' + p.id,
      label: (p.name || '').split(' ').slice(0, 2).join(' ').toUpperCase().slice(0, 12),
      color: '#6fd0c9',
      nivel: Math.min(1, (p.bot_knowledge || '').trim().length / 1500),
      selected: brainSel === 'p:' + p.id,
    }))
    return [...base, ...fichas]
  }
  const elegirBrain = (k, freshB, freshP) => {
    const B = freshB || brains, P = freshP || proys
    setBrainSel(k); setBrainMsg(''); setProjQMsg(''); setCfgMsg('')
    if (!k.startsWith('p:')) {
      setBrainTxt(B.find(x => x.key === k)?.content || '')
      if (k === 'cobranza') { let cfg = null; try { cfg = JSON.parse(B.find(x => x.key === 'cobranza_cfg')?.content || '') } catch {}; const bk = (o, rep) => ({ avisos: Array.isArray(o?.avisos) ? o.avisos : [], ...(rep ? { repetir: o?.repetir || { cada_dias: 3, mensaje: '' } } : {}) }); setCobCfg({ al_dia: bk(cfg?.al_dia, false), v1: bk(cfg?.v1, true), v2: bk(cfg?.v2, true), v3: bk(cfg?.v3, true), v4: bk(cfg?.v4, true) }); setCobFlow(parseArr(B.find(x => x.key === 'cobranza_flow')?.content)) }
      else if (k === 'secretaria') setSecCards(parseSecc(B.find(x => x.key === 'secretaria')?.content || ''))
      else if (k === 'gerencia') setGerCmds(parseArr(B.find(x => x.key === 'gerencia_cmd')?.content))
    }
    if (k.startsWith('p:')) {
      const p = P.find(x => x.id === k.slice(2))
      setBrainTxt(p?.bot_knowledge || '')
      let q = []
      try { q = Array.isArray(p?.bot_questions) ? p.bot_questions : JSON.parse(p?.bot_questions || '[]') } catch {}
      setProjQ((q || []).filter(x => x && x.q).slice(0, 5))
      setProjNotify(p?.lead_notify_phone || '')
      let fl = null
      try { fl = typeof p?.bot_flow === 'string' ? JSON.parse(p.bot_flow) : p?.bot_flow } catch {}
      setProjFlow({
        reask_min: fl?.reask_min ?? 5, max_reasks: fl?.max_reasks ?? 1, reask_text: fl?.reask_text || '',
        bienvenida: fl?.bienvenida || '', pide_nombre: fl?.pide_nombre || '', no_nombre: fl?.no_nombre || '',
        media_lib: Array.isArray(fl?.media_lib) ? fl.media_lib : [], bombardeo: Array.isArray(fl?.bombardeo) ? fl.bombardeo : [],
        steps: Array.isArray(fl?.steps) ? fl.steps.map(s => ({ id: s.id || nuevoPasoId(), tipo: s.tipo === 'pregunta' ? 'pregunta' : 'mensaje', texto: s.texto || '', media: s.media || [], pasar_asesor: !!s.pasar_asesor, reask_min: s.reask_min ?? '', reask_veces: s.reask_veces ?? '', reask_text: s.reask_text || '', sin_respuesta: s.sin_respuesta || 'siguiente', sin_respuesta_texto: s.sin_respuesta_texto || '', opciones: (s.opciones || []).map(o => ({ label: o.label || '', claves: o.claves || '', ir_a: o.ir_a || '', pasar_asesor: !!o.pasar_asesor })) })) : [],
      })
    }
  }
  // ---- constructor de flujo por proyecto ----
  const flowSet = (i, patch) => setProjFlow(f => ({ ...f, steps: f.steps.map((s, j) => j === i ? { ...s, ...patch } : s) }))
  const flowAdd = () => setProjFlow(f => ({ ...f, steps: [...f.steps, { id: nuevoPasoId(), tipo: 'mensaje', texto: '', media: [], pasar_asesor: false, opciones: [] }] }))
  const flowDel = i => setProjFlow(f => ({ ...f, steps: f.steps.filter((_, j) => j !== i) }))
  const flowMove = (i, d) => setProjFlow(f => { const a = [...f.steps]; const j = i + d; if (j < 0 || j >= a.length) return f;[a[i], a[j]] = [a[j], a[i]]; return { ...f, steps: a } })
  const flowMedia = (i, key) => setProjFlow(f => ({ ...f, steps: f.steps.map((s, j) => j === i ? { ...s, media: (s.media || []).includes(key) ? s.media.filter(m => m !== key) : [...(s.media || []), key] } : s) }))
  const optSet = (i, oi, patch) => setProjFlow(f => ({ ...f, steps: f.steps.map((s, j) => j === i ? { ...s, opciones: (s.opciones || []).map((o, k) => k === oi ? { ...o, ...patch } : o) } : s) }))
  const optAdd = i => setProjFlow(f => ({ ...f, steps: f.steps.map((s, j) => j === i ? { ...s, opciones: [...(s.opciones || []), { label: '', claves: '', ir_a: '', pasar_asesor: false }] } : s) }))
  const optDel = (i, oi) => setProjFlow(f => ({ ...f, steps: f.steps.map((s, j) => j === i ? { ...s, opciones: (s.opciones || []).filter((_, k) => k !== oi) } : s) }))
  // ---- biblioteca de material del flujo (subir imágenes/videos + links con descripción) ----
  const libAdd = it => setProjFlow(f => ({ ...f, media_lib: [...(f.media_lib || []), it] }))
  const libSet = (id, patch) => setProjFlow(f => ({ ...f, media_lib: f.media_lib.map(x => x.id === id ? { ...x, ...patch } : x) }))
  const libDel = id => setProjFlow(f => ({ ...f, media_lib: (f.media_lib || []).filter(x => x.id !== id), bombardeo: (f.bombardeo || []).filter(b => b !== id), steps: f.steps.map(s => ({ ...s, media: (s.media || []).filter(m => m !== id) })) }))
  const bombToggle = id => setProjFlow(f => ({ ...f, bombardeo: (f.bombardeo || []).includes(id) ? f.bombardeo.filter(b => b !== id) : [...(f.bombardeo || []), id] }))
  const subirMedia = async (e, tipo) => {
    const files = Array.from(e.target.files || []); e.target.value = ''
    if (!files.length) return
    setSubiendo(true)
    for (const file of files) {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
      const path = 'bot-flow/' + brainSel.slice(2) + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.' + ext
      const { error } = await supabase.storage.from('urbis-files').upload(path, file, { upsert: true })
      if (error) { alert('No se pudo subir ' + file.name + ': ' + error.message); continue }
      const url = supabase.storage.from('urbis-files').getPublicUrl(path).data.publicUrl
      libAdd({ id: nuevoPasoId(), tipo, url, desc: '' })
    }
    setSubiendo(false)
  }
  const guardarFlujo = async () => {
    setProjQMsg('GUARDANDO...')
    const clean = {
      reask_min: Number(projFlow.reask_min) || 5, max_reasks: Number(projFlow.max_reasks) || 0, reask_text: (projFlow.reask_text || '').trim(),
      bienvenida: (projFlow.bienvenida || '').trim(), pide_nombre: (projFlow.pide_nombre || '').trim(), no_nombre: (projFlow.no_nombre || '').trim(),
      media_lib: (projFlow.media_lib || []).filter(m => (m.url || '').trim()).map(m => ({ id: m.id, tipo: m.tipo, url: (m.url || '').trim(), desc: (m.desc || '').trim() })),
      bombardeo: projFlow.bombardeo || [],
      steps: (projFlow.steps || []).map(s => ({
        id: s.id, tipo: s.tipo === 'pregunta' ? 'pregunta' : 'mensaje', texto: (s.texto || '').trim(), media: s.media || [], pasar_asesor: !!s.pasar_asesor,
        ...(s.tipo === 'pregunta' && String(s.reask_min).trim() !== '' ? { reask_min: Number(s.reask_min) || 5 } : {}),
        ...(s.tipo === 'pregunta' && String(s.reask_veces).trim() !== '' ? { reask_veces: Number(s.reask_veces) || 0 } : {}),
        ...(s.tipo === 'pregunta' && (s.reask_text || '').trim() ? { reask_text: (s.reask_text || '').trim() } : {}),
        ...(s.tipo === 'pregunta' ? { sin_respuesta: ['mensaje', 'asesor'].includes(s.sin_respuesta) ? s.sin_respuesta : 'siguiente' } : {}),
        ...(s.tipo === 'pregunta' && s.sin_respuesta === 'mensaje' && (s.sin_respuesta_texto || '').trim() ? { sin_respuesta_texto: (s.sin_respuesta_texto || '').trim() } : {}),
        opciones: s.tipo === 'pregunta' ? (s.opciones || []).map(o => ({ label: (o.label || '').trim(), claves: (o.claves || '').trim(), ir_a: o.ir_a || '', pasar_asesor: !!o.pasar_asesor })).filter(o => o.label) : [],
      })).filter(s => s.texto || (s.opciones && s.opciones.length)),
    }
    const notify = String(projNotify || '').replace(/\D/g, '') || null
    const { error } = await supabase.from('projects').update({ bot_flow: clean, lead_notify_phone: notify }).eq('id', brainSel.slice(2))
    setProjQMsg(error ? 'ERROR: ' + error.message : '✅ GUARDADO — el bot usa el flujo en máx. 1 minuto')
    if (!error) cargarBrains()
  }
  // ---- guardado de los paneles estructurados (cobranza / seguimiento / gerencia) ----
  const setSec = (tag, v) => setSecCards(c => ({ ...c, [tag]: v }))
  const cbAdd = b => setCobCfg(c => { const bk = c[b] || { avisos: [] }; return { ...c, [b]: { ...bk, avisos: [...(bk.avisos || []), { dias: b === 'al_dia' ? 3 : 1, mensaje: '' }] } } })
  const cbSet = (b, i, patch) => setCobCfg(c => { const bk = c[b] || { avisos: [] }; return { ...c, [b]: { ...bk, avisos: (bk.avisos || []).map((x, j) => j === i ? { ...x, ...patch } : x) } } })
  const cbDel = (b, i) => setCobCfg(c => { const bk = c[b] || { avisos: [] }; return { ...c, [b]: { ...bk, avisos: (bk.avisos || []).filter((_, j) => j !== i) } } })
  const cbRep = (b, patch) => setCobCfg(c => { const bk = c[b] || {}; return { ...c, [b]: { ...bk, repetir: { ...(bk.repetir || { cada_dias: 3, mensaje: '' }), ...patch } } } })
  const cfSet = (i, patch) => setCobFlow(a => a.map((x, j) => j === i ? { ...x, ...patch } : x))
  const cfAdd = () => setCobFlow(a => [...a, { claves: '', accion: 'responder', respuesta: '' }])
  const cfDel = i => setCobFlow(a => a.filter((_, j) => j !== i))
  const gcSet = (i, patch) => setGerCmds(a => a.map((x, j) => j === i ? { ...x, ...patch } : x))
  const gcAdd = () => setGerCmds(a => [...a, { claves: '', tipo: 'consulta', consulta: 'lotes', texto: '', accion: 'crear_tarea' }])
  const gcDel = i => setGerCmds(a => a.filter((_, j) => j !== i))
  const guardarCobranza = async () => {
    setCfgMsg('GUARDANDO...')
    const limpAv = arr => (arr || []).map(r => ({ dias: Number(r.dias) || 0, mensaje: (r.mensaje || '').trim() })).filter(r => r.mensaje)
    const bk = (b, rep) => { const o = { avisos: limpAv(cobCfg[b]?.avisos) }; if (rep) o.repetir = { cada_dias: Number(cobCfg[b]?.repetir?.cada_dias) || 3, mensaje: (cobCfg[b]?.repetir?.mensaje || '').trim() }; return o }
    const cfg = { al_dia: bk('al_dia', false), v1: bk('v1', true), v2: bk('v2', true), v3: bk('v3', true), v4: bk('v4', true) }
    const flow = cobFlow.map(r => ({ claves: (r.claves || '').trim(), accion: r.accion === 'asesor' ? 'asesor' : 'responder', respuesta: (r.respuesta || '').trim() })).filter(r => r.claves)
    const e1 = (await supabase.from('bot_brains').upsert({ key: 'cobranza_cfg', content: JSON.stringify(cfg), updated_at: new Date().toISOString() })).error
    const e2 = (await supabase.from('bot_brains').upsert({ key: 'cobranza_flow', content: JSON.stringify(flow), updated_at: new Date().toISOString() })).error
    setCfgMsg(e1 || e2 ? 'ERROR: ' + ((e1 || e2).message) : '✅ GUARDADO — el bot lo usa en máx. 1 minuto')
    if (!e1 && !e2) cargarBrains()
  }
  const guardarSeguimiento = async () => {
    setCfgMsg('GUARDANDO...')
    const { error } = await supabase.from('bot_brains').upsert({ key: 'secretaria', content: armarSecc(secCards, SEC_CARDS), updated_at: new Date().toISOString() })
    setCfgMsg(error ? 'ERROR: ' + error.message : '✅ GUARDADO — el bot lo usa en máx. 1 minuto')
    if (!error) cargarBrains()
  }
  const guardarGerCmds = async () => {
    setCfgMsg('GUARDANDO...')
    const cmds = gerCmds.map(c => ({ claves: (c.claves || '').trim(), tipo: ['texto', 'accion'].includes(c.tipo) ? c.tipo : 'consulta', consulta: c.consulta || 'lotes', texto: (c.texto || '').trim(), accion: c.accion || 'crear_tarea' })).filter(c => c.claves)
    const { error } = await supabase.from('bot_brains').upsert({ key: 'gerencia_cmd', content: JSON.stringify(cmds), updated_at: new Date().toISOString() })
    setCfgMsg(error ? 'ERROR: ' + error.message : '✅ GUARDADO — el bot lo usa en máx. 1 minuto')
    if (!error) cargarBrains()
  }
  // Preguntas cerradas del proyecto (flujo de ventas sin IA): máx 5, cada una con opciones.
  const guardarPreguntas = async () => {
    setProjQMsg('GUARDANDO...')
    const limpias = projQ
      .map(x => ({ q: (x.q || '').trim(), opciones: (x.opciones || []).map(o => (o || '').trim()).filter(Boolean) }))
      .filter(x => x.q)
      .slice(0, 5)
    const notify = String(projNotify || '').replace(/\D/g, '') || null
    const { error } = await supabase.from('projects').update({ bot_questions: limpias, lead_notify_phone: notify }).eq('id', brainSel.slice(2))
    setProjQMsg(error ? 'ERROR: ' + error.message : '✅ GUARDADO — el bot las usa en máx. 1 minuto')
    if (!error) cargarBrains()
  }
  const guardarBrain = async () => {
    setBrainMsg('GUARDANDO...')
    let error
    if (brainSel.startsWith('p:')) {
      ({ error } = await supabase.from('projects').update({ bot_knowledge: brainTxt }).eq('id', brainSel.slice(2)))
    } else {
      ({ error } = await supabase.from('bot_brains').upsert({ key: brainSel, content: brainTxt, updated_at: new Date().toISOString() }))
    }
    setBrainMsg(error ? 'ERROR: ' + error.message : '✅ GUARDADO — el bot lo usa en máx. 1 minuto')
    if (!error) cargarBrains()
  }
  // Enseñarle un dato: se agrega como línea al cerebro APRENDIDO (el bot lo usa en ~1 min).
  const ensenar = async () => {
    const dato = ensenaTxt.trim()
    if (!dato) return
    setBrainMsg('APRENDIENDO...')
    const actual = (brains.find(x => x.key === 'aprendido')?.content || '').trim()
    const fecha = new Date().toLocaleDateString('es-PE')
    const nuevo = (actual ? actual + '\n' : '') + '- ' + dato + '  (aprendido ' + fecha + ')'
    const { error } = await supabase.from('bot_brains').upsert({ key: 'aprendido', content: nuevo, updated_at: new Date().toISOString() })
    setEnsenaTxt('')
    setBrainMsg(error ? 'ERROR: ' + error.message : '✅ APRENDIDO — el bot lo usa en máx. 1 minuto')
    if (!error) { const { b } = await cargarBrains(); if (brainSel === 'aprendido') setBrainTxt(b.find(x => x.key === 'aprendido')?.content || nuevo) }
  }
  // guarda la configuración de pases de lista / avisos del seguimiento en bot_settings
  const guardarSecCfg = async () => {
    setSecMsg('GUARDANDO...')
    const now = new Date().toISOString()
    const rows = [
      { key: 'sec_checkins', value: JSON.stringify(secCfg.checkins.map(h => String(h).slice(0, 5))), updated_at: now },
      { key: 'sec_recordatorio', value: secCfg.recordatorio ? '1' : '0', updated_at: now },
      { key: 'sec_aviso_hora', value: secCfg.avisoHora ? '1' : '0', updated_at: now },
      { key: 'sec_feedback', value: secCfg.feedback ? '1' : '0', updated_at: now },
      { key: 'hora_feedback_sec', value: String(secCfg.feedbackHora).slice(0, 5), updated_at: now },
      { key: 'sec_saludo_activo', value: secCfg.saludoActivo ? '1' : '0', updated_at: now },
      { key: 'sec_saludo_hora', value: String(secCfg.saludoHora).slice(0, 5), updated_at: now },
    ]
    const { error } = await supabase.from('bot_settings').upsert(rows)
    setSecMsg(error ? 'ERROR: ' + error.message : '✅ GUARDADO — el bot lo aplica en máx. 1 minuto')
  }
  const setCheckinCount = n => setSecCfg(c => {
    const def = ['09:00', '13:00', '16:30', '18:00']
    const arr = [...c.checkins]
    while (arr.length < n) arr.push(def[arr.length] || '12:00')
    return { ...c, checkins: arr.slice(0, n) }
  })
  const subirMd = e => {
    const file = e.target.files?.[0]
    if (!file) return
    const r = new FileReader()
    r.onload = () => { setBrainTxt(String(r.result || '')); setBrainMsg('📄 ' + file.name + ' cargado — revisa y pulsa GUARDAR') }
    r.readAsText(file)
    e.target.value = ''
  }

  const cargarConvs = async () => {
    const { data } = await supabase.from('whatsapp_conversations')
      .select('*, leads(full_name, status), clients(full_name)')
      .order('last_message_at', { ascending: false, nullsFirst: false }).limit(300)
    setConvs(data || [])
  }
  const cargarMsgs = async c => {
    if (!c) return
    const lid = String(c.wa_jid || '').split('@')[0].replace(/\D/g, '')
    const dests = lid && lid !== c.phone ? [c.phone, lid] : [c.phone]
    const [ins, outs] = await Promise.all([
      supabase.from('whatsapp_messages').select('body, created_at, direction').eq('conversation_id', c.id).limit(500),
      supabase.from('scheduled_messages').select('body, sent_at, scheduled_for, status, tipo').in('recipient_phone', dests).in('status', ['enviado', 'fallido', 'pendiente']).limit(500),
    ])
    const a = (ins.data || []).map(m => ({ body: m.body, at: m.created_at, dir: m.direction || 'in' }))
    const b = (outs.data || []).map(m => ({ body: m.body, at: m.sent_at || m.scheduled_for, dir: 'out', tipo: m.tipo, fallo: m.status === 'fallido', pend: m.status === 'pendiente' }))
    setMsgs([...a, ...b].filter(x => x.body).sort((x, y) => new Date(x.at) - new Date(y.at)))
  }

  useEffect(() => { cargarConvs(); cargarFlags(); cargarNums() }, [])
  useEffect(() => { selRef.current = sel; cargarMsgs(sel) }, [sel])
  useEffect(() => {
    const t = setInterval(() => { cargarConvs(); cargarFlags(); if (selRef.current) cargarMsgs(selRef.current) }, 8000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs.length])

  if (!['admin', 'superuser'].includes(role)) return <div className="glass" style={{ padding: 24 }}>Solo administración puede ver las conversaciones del bot.</div>

  const lista = convs.filter(c => {
    if (busca) {
      const q = busca.toLowerCase()
      if (!((c.phone || '').includes(q) || (c.leads?.full_name || '').toLowerCase().includes(q) || (c.clients?.full_name || '').toLowerCase().includes(q))) return false
    }
    if (filtro === 'calificados') return c.flow_state === 'completado'
    if (filtro === 'flujo') return ['espera_nombre', 'espera_proyecto'].includes(c.flow_state)
    if (filtro === 'clientes') return !!c.clients
    if (filtro === 'humanos') return c.flow_state === 'humano'
    if (filtro === 'silenciados') return !!nums.find(n => c.phone && ['desactivado', 'silencio'].includes(n.tipo) && (c.phone.endsWith(n.phone.slice(-9)) || n.phone.endsWith(String(c.phone).slice(-9))))
    return true
  })
  const nombreDe = c => c.clients?.full_name || c.leads?.full_name || 'SIN NOMBRE'
  const tipoDe = phone => nums.find(n => phone && (phone.endsWith(n.phone.slice(-9)) || n.phone.endsWith(String(phone).slice(-9))))
  const Toggle = ({ on, onClick, icon, label }) => (
    <button className={`sw ${on ? 'on' : 'off'}`} onClick={onClick} title={label + (on ? ': activo — clic para apagar' : ': apagado — clic para encender')}>
      <span className="track"><span className="knob" /></span>
      {icon} {label} <span className="st">{on ? 'ON' : 'OFF'}</span>
    </button>
  )

  return (
    <div>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1>WhatsApp del bot</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Toggle on={flags.bot_activo} onClick={() => setFlag('bot_activo', !flags.bot_activo)} icon="🤖" label="BOT" />
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 10px 4px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,.1)', opacity: flags.bot_activo ? 1 : 0.45 }}>
            <span className="muted" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.5px' }}>AGENTES</span>
            <Toggle on={flags.ia_activa} onClick={() => setFlag('ia_activa', !flags.ia_activa)} icon="🤖" label="LEADS" />
            <Toggle on={flags.cobranza_activa} onClick={() => setFlag('cobranza_activa', !flags.cobranza_activa)} icon="💵" label="COBRANZA" />
            <Toggle on={flags.seguimiento_activo !== false} onClick={() => setFlag('seguimiento_activo', flags.seguimiento_activo === false)} icon="🗓️" label="SEGUIMIENTO" />
          </span>
          {(() => {
            const fresco = waLatido && (Date.now() - new Date(waLatido).getTime()) < 120000
            const [txt, col] = waEstado === 'esperando_qr' ? ['📱 ESPERANDO QR...', '#e0b34c']
              : fresco ? ['🟢 BOT EN LÍNEA', '#6fdd9b']
              : waLatido ? ['🔴 BOT SIN RESPONDER', '#e07b7b']
              : waEstado === 'conectado' ? ['📱 CONECTADO', '#6fdd9b'] : ['📱 —', '#e0b34c']
            return <span title={waLatido ? 'Último latido del agente: ' + new Date(waLatido).toLocaleTimeString('es-PE') + ' (se actualiza cada 30 seg.)' : 'Sin latido registrado aún'}
              style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 20, border: `1px solid ${col}99`, color: col }}>{txt}</span>
          })()}
          {['admin', 'superuser'].includes(role) && <button className="btn-ghost" onClick={reiniciarBot} title="Si el bot dejó de responder, reinícialo desde aquí (no pide QR)">🔁 REINICIAR BOT</button>}
          {role === 'superuser' && <button className="btn-ghost" onClick={pedirRelink} title="Desvincular y escanear QR con otro celular">🔄 VINCULAR NÚMERO</button>}
          {role === 'superuser' && <button className="btn-ghost" onClick={cambiarAdmin} title="Número que recibe avisos, reportes y resúmenes">👑 ADMIN{adminPhone ? ': +' + adminPhone : ''}</button>}
          <button className="btn-ghost" onClick={() => setVerNums(!verNums)}>📇 NÚMEROS ({nums.length})</button>
          {['admin', 'superuser'].includes(role) && <button className="btn-ghost" onClick={async () => { const v = !verBrains; setVerBrains(v); if (v) { const { b, p } = await cargarBrains(); elegirBrain('cobranza', b, p) } }}>🧠 CEREBROS</button>}
        </div>
      </div>

      {qrImg && (
        <div className="glass" style={{ padding: 18, marginBottom: 12, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', border: '1px solid rgba(224,179,76,.5)' }}>
          <img src={qrImg} alt="QR de WhatsApp" style={{ width: 220, height: 220, borderRadius: 10, background: '#fff', padding: 8 }} />
          <div style={{ maxWidth: 420 }}>
            <b>📱 ESCANEA ESTE QR CON EL CELULAR DEL BOT</b>
            <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              En el celular: WhatsApp → Dispositivos vinculados → Vincular dispositivo → apunta a este código.
              El QR se renueva solo cada ~30 segundos. Cuando conecte, este recuadro desaparece y arriba dirá CONECTADO.
            </p>
          </div>
        </div>
      )}

      {!flags.bot_activo && <div className="glass" style={{ padding: '8px 14px', marginBottom: 10, border: '1px solid rgba(224,123,123,.6)', color: '#e07b7b' }}>⚠️ BOT APAGADO: no responde a nadie ni envía cobranzas. Vuelve a activarlo cuando quieras.</div>}
      {flags.bot_activo && !flags.cobranza_activa && <div className="glass" style={{ padding: '8px 14px', marginBottom: 10, border: '1px solid rgba(224,179,76,.5)', color: '#e0b34c' }}>La cobranza automática está APAGADA. El filtro de leads sigue funcionando.</div>}

      {verBrains && (
        <div className="glass" style={{ padding: 14, marginBottom: 14 }}>
          <b>🧠 CEREBROS DEL BOT</b>
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>
            El cerebro del bot dividido por áreas. Toca un nodo del mapa para editarlo. Si un cerebro está VACÍO,
            el bot usa su versión por defecto. Los cambios rigen en máximo 1 minuto, sin reiniciar nada.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: brainSel.startsWith('p:') ? 'minmax(200px, 260px) 1fr' : 'minmax(260px, 380px) 1fr', gap: 16, alignItems: 'start' }}>
            <div className="glass" style={{ padding: 8, background: 'rgba(0,0,0,.18)' }}>
              <BrainMap nodes={buildNodes()} selected={brainSel} onSelect={elegirBrain} />
            </div>
            <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
            <select value={brainSel} onChange={e => elegirBrain(e.target.value)} style={{ maxWidth: 340 }}>
              {BRAIN_DEFS.map(b => <option key={b.k} value={b.k}>{b.t}</option>)}
              {proys.map(p => <option key={p.id} value={'p:' + p.id}>📁 FICHA: {p.name}</option>)}
            </select>
            {!['cobranza', 'secretaria'].includes(brainSel) && (<>
              <label className="btn-ghost" style={{ cursor: 'pointer' }}>
                📄 SUBIR .MD
                <input type="file" accept=".md,.txt" onChange={subirMd} style={{ display: 'none' }} />
              </label>
              <button className="btn" onClick={guardarBrain}>💾 GUARDAR{brainSel === 'gerencia' ? ' NOTAS' : ''}</button>
              {brainMsg && <span style={{ fontSize: 12 }}>{brainMsg}</span>}
            </>)}
          </div>
          {brainSel === 'aprendido' && (
            <div style={{ border: '1px solid rgba(232,151,90,.5)', borderRadius: 10, padding: 10, marginBottom: 10, background: 'rgba(232,151,90,.06)' }}>
              <b style={{ color: '#e8975a', fontSize: 13 }}>💡 ENSÉÑALE ALGO</b>
              <p className="muted" style={{ fontSize: 11, margin: '3px 0 8px' }}>Escribe un dato en una frase y el bot lo recordará (se agrega a la lista de abajo). Ej: "La oficina abre de 9am a 6pm" · "El plano de Cashibo ya está actualizado" · "No quedan lotes en la Mz A".</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={ensenaTxt} onChange={e => setEnsenaTxt(e.target.value)} placeholder="Enséñale un dato…" style={{ flex: 1, textTransform: 'none' }} onKeyDown={e => { if (e.key === 'Enter') ensenar() }} />
                <button className="btn" onClick={ensenar}>ENSEÑAR</button>
              </div>
              <p className="muted" style={{ fontSize: 10, marginTop: 6 }}>También por WhatsApp: desde el número ADMIN escríbele al bot <b>aprende: &lt;dato&gt;</b>.</p>
            </div>
          )}
          {brainSel === 'cobranza' && (
            <div>
              <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>Configura cada caso según cuántas cuotas debe el cliente. Variables: <span style={{ fontFamily: 'monospace' }}>{'{nombre} {lote} {proyecto} {cuota} {monto} {fecha} {dias} {nvencidas} {deuda}'}</span>.</p>

              {COB_BUCKETS.map(([b, titulo, etiq, rep]) => (
                <div key={b} style={{ border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, padding: 10, marginBottom: 8, background: 'rgba(0,0,0,.12)' }}>
                  <b style={{ fontSize: 12 }}>{titulo}</b>
                  {((cobCfg[b] || {}).avisos || []).map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 6, flexWrap: 'wrap' }}>
                      <input type="number" min="0" value={r.dias} onChange={e => cbSet(b, i, { dias: e.target.value })} style={{ width: 52 }} /><span style={{ fontSize: 10, paddingTop: 6 }}>{etiq}:</span>
                      <textarea value={r.mensaje} placeholder="Mensaje…" onChange={e => cbSet(b, i, { mensaje: e.target.value })} style={{ flex: '1 1 240px', minHeight: 38, textTransform: 'none', fontSize: 12 }} />
                      <button className="btn-ghost" onClick={() => cbDel(b, i)}>✕</button>
                    </div>
                  ))}
                  <button className="btn-ghost" style={{ marginTop: 6 }} onClick={() => cbAdd(b)}>+ Aviso</button>
                  {rep && (
                    <div style={{ borderTop: '1px dashed rgba(255,255,255,.15)', marginTop: 8, paddingTop: 8, fontSize: 12 }}>
                      🔁 Si sigue sin pagar, repetir cada <input type="number" min="1" value={(cobCfg[b] || {}).repetir?.cada_dias ?? 3} onChange={e => cbRep(b, { cada_dias: e.target.value })} style={{ width: 44 }} /> días:
                      <textarea value={(cobCfg[b] || {}).repetir?.mensaje || ''} placeholder="Mensaje de insistencia (opcional)…" onChange={e => cbRep(b, { mensaje: e.target.value })} style={{ width: '100%', minHeight: 36, textTransform: 'none', fontSize: 12, marginTop: 4 }} />
                    </div>
                  )}
                </div>
              ))}
              <div style={{ border: '1px solid rgba(126,200,227,.4)', borderRadius: 8, padding: 10, margin: '8px 0', background: 'rgba(126,200,227,.06)' }}>
                <b style={{ fontSize: 12, color: '#7ec8e3' }}>💬 Flujo: cuando el cliente responde</b>
                <p className="muted" style={{ fontSize: 10, margin: '2px 0 8px' }}>Regla por palabra clave: responde un texto o deriva al asesor. La primera que coincida gana.</p>
                {cobFlow.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 5, flexWrap: 'wrap' }}>
                    <input value={r.claves} placeholder="palabras clave: ya pagué, voucher" onChange={e => cfSet(i, { claves: e.target.value })} style={{ flex: '1 1 150px', textTransform: 'none' }} />
                    <select value={r.accion} onChange={e => cfSet(i, { accion: e.target.value })} style={{ fontSize: 11 }}>
                      <option value="responder">responder texto</option>
                      <option value="asesor">derivar al asesor</option>
                    </select>
                    <input value={r.respuesta} placeholder={r.accion === 'asesor' ? 'texto al derivar (opcional)' : 'respuesta del bot'} onChange={e => cfSet(i, { respuesta: e.target.value })} style={{ flex: '1 1 180px', textTransform: 'none' }} />
                    <button className="btn-ghost" onClick={() => cfDel(i)}>✕</button>
                  </div>
                ))}
                <button className="btn-ghost" onClick={cfAdd}>+ Regla</button>
              </div>
              <button className="btn" onClick={guardarCobranza}>💾 GUARDAR COBRANZA</button>
              {cfgMsg && <span style={{ fontSize: 12, marginLeft: 8 }}>{cfgMsg}</span>}
            </div>
          )}
          {brainSel === 'secretaria' && (
            <>
              <div style={{ border: '1px solid rgba(184,161,217,.5)', borderRadius: 10, padding: 12, marginBottom: 10, background: 'rgba(184,161,217,.06)' }}>
                <b style={{ color: '#b8a1d9', fontSize: 13 }}>🗓️ HORARIOS DEL SEGUIMIENTO</b>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '10px 0', fontSize: 12 }}>
                  <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={secCfg.saludoActivo} onChange={e => setSecCfg(c => ({ ...c, saludoActivo: e.target.checked }))} /> ☀️ Saludo matutino con los pendientes del día a las
                  </label>
                  <input type="time" value={secCfg.saludoHora} onChange={e => setSecCfg(c => ({ ...c, saludoHora: e.target.value }))} style={{ fontSize: 12, padding: '3px 6px' }} />
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '10px 0' }}>
                  <label style={{ fontSize: 12 }}>Pases de lista al día:{' '}
                    <select value={secCfg.checkins.length} onChange={e => setCheckinCount(Number(e.target.value))} style={{ fontSize: 12, padding: '4px 8px' }}>
                      {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  {secCfg.checkins.map((h, i) => (
                    <label key={i} style={{ fontSize: 12 }}>Hora {i + 1}:{' '}
                      <input type="time" value={h} onChange={e => setSecCfg(c => { const a = [...c.checkins]; a[i] = e.target.value; return { ...c, checkins: a } })} style={{ fontSize: 12, padding: '3px 6px' }} />
                    </label>
                  ))}
                </div>
                <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>A cada hora, el bot pasa lista de lo que sigue <b>pendiente</b> (re-pregunta lo no confirmado).</p>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
                  <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={secCfg.recordatorio} onChange={e => setSecCfg(c => ({ ...c, recordatorio: e.target.checked }))} /> Recordar si no responde (45 min)
                  </label>
                  <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={secCfg.avisoHora} onChange={e => setSecCfg(c => ({ ...c, avisoHora: e.target.checked }))} /> Aviso por hora exacta de una tarea
                  </label>
                  <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={secCfg.feedback} onChange={e => setSecCfg(c => ({ ...c, feedback: e.target.checked }))} /> Preguntar “¿algo extra?” al cerrar
                  </label>
                  {secCfg.feedback && (
                    <label style={{ fontSize: 12 }}>a las{' '}
                      <input type="time" value={secCfg.feedbackHora} onChange={e => setSecCfg(c => ({ ...c, feedbackHora: e.target.value }))} style={{ fontSize: 12, padding: '3px 6px' }} />
                    </label>
                  )}
                  <button className="btn" onClick={guardarSecCfg}>💾 GUARDAR HORARIOS</button>
                  {secMsg && <span style={{ fontSize: 12 }}>{secMsg}</span>}
                </div>
              </div>
              <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>Un cuadro por cada mensaje del seguimiento. Vacío = plantilla por defecto.</p>
              {SEC_CARDS.map(([tag, lbl, toks]) => (
                <div key={tag} style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 700 }}>{lbl}</label>
                  <div className="muted" style={{ fontSize: 10 }}>{toks}</div>
                  <textarea value={secCards[tag] || ''} onChange={e => setSec(tag, e.target.value)} style={{ width: '100%', minHeight: 42, textTransform: 'none', fontSize: 12.5, marginTop: 2 }} />
                </div>
              ))}
              <button className="btn" onClick={guardarSeguimiento}>💾 GUARDAR MENSAJES</button>
              {cfgMsg && <span style={{ fontSize: 12, marginLeft: 8 }}>{cfgMsg}</span>}
            </>
          )}
          {brainSel === 'gerencia' && (
            <div>
              <div style={{ border: '1px solid rgba(111,208,201,.4)', borderRadius: 8, padding: 10, marginBottom: 10, background: 'rgba(111,208,201,.06)' }}>
                <b style={{ fontSize: 12, color: '#6fd0c9' }}>🔑 Comandos por palabra clave</b>
                <p className="muted" style={{ fontSize: 10, margin: '2px 0 8px' }}>Gerencia escribe una palabra clave y el bot: <b>consulta</b> el sistema, responde un <b>texto fijo</b>, o ejecuta una <b>acción</b> (programar/reprogramar tareas). Las acciones van al inicio del mensaje: <i>{'<palabra> <secretaria> <fecha/hora> <descripción>'}</i>. Ej: <b>agenda</b> cami mañana 10am llevar contratos.</p>
                {gerCmds.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 5, flexWrap: 'wrap' }}>
                    <input value={c.claves} placeholder="palabras clave: agenda, asignar" onChange={e => gcSet(i, { claves: e.target.value })} style={{ flex: '1 1 140px', textTransform: 'none' }} />
                    <select value={c.tipo} onChange={e => gcSet(i, { tipo: e.target.value })} style={{ fontSize: 11 }}>
                      <option value="consulta">consulta al sistema</option>
                      <option value="texto">texto fijo</option>
                      <option value="accion">acción (tareas)</option>
                    </select>
                    {c.tipo === 'consulta'
                      ? <select value={c.consulta} onChange={e => gcSet(i, { consulta: e.target.value })} style={{ fontSize: 11 }}>{CONSULTAS_GER.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                      : c.tipo === 'accion'
                        ? <select value={c.accion} onChange={e => gcSet(i, { accion: e.target.value })} style={{ fontSize: 11 }}>{ACCIONES_GER.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                        : <input value={c.texto} placeholder="texto que responde" onChange={e => gcSet(i, { texto: e.target.value })} style={{ flex: '1 1 160px', textTransform: 'none' }} />}
                    <button className="btn-ghost" onClick={() => gcDel(i)}>✕</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn-ghost" onClick={gcAdd}>+ Comando</button>
                  <button className="btn" onClick={guardarGerCmds}>💾 GUARDAR COMANDOS</button>
                  {cfgMsg && <span style={{ fontSize: 12 }}>{cfgMsg}</span>}
                </div>
              </div>
              <p className="muted" style={{ fontSize: 11, margin: '0 0 4px' }}>
                Abajo, <b>notas internas</b> (opcional) para las preguntas libres con IA de gerencia — ej. "margen mínimo por lote S/ X".
              </p>
            </div>
          )}
          {brainSel.startsWith('p:') && (
            <div style={{ border: '1px solid rgba(156,203,134,.5)', borderRadius: 10, padding: 12, marginBottom: 10, background: 'rgba(156,203,134,.06)' }}>
              <b style={{ color: 'var(--accent-strong)', fontSize: 13 }}>🧩 FLUJO DEL BOT (sin IA)</b>
              <p className="muted" style={{ fontSize: 11, margin: '3px 0 8px' }}>Arma paso a paso lo que hace el bot tras el nombre y el “¿info por aquí?”: mensajes con material adjunto y preguntas que responden por <b>número o palabra clave</b>, con ramas (ir a otro paso) y disparadores de <b>pasar al asesor</b>. Vacío = usa el bombardeo por defecto.</p>

              <div style={{ border: '1px solid rgba(126,200,227,.4)', borderRadius: 8, padding: 10, marginBottom: 10, background: 'rgba(126,200,227,.06)' }}>
                <b style={{ fontSize: 12, color: '#7ec8e3' }}>⭐ Mensajes especiales del inicio</b>
                <p className="muted" style={{ fontSize: 10, margin: '2px 0 8px' }}>Usa <b>{'{proyecto}'}</b> y se reemplaza por el nombre del proyecto. Vacío = usa el texto por defecto.</p>
                <label style={{ fontSize: 11 }}>👋 Bienvenida</label>
                <textarea value={projFlow.bienvenida} placeholder="¡Hola! 👋 Gracias por escribir sobre {proyecto} 🌳" onChange={e => setProjFlow(f => ({ ...f, bienvenida: e.target.value }))} style={{ width: '100%', minHeight: 40, textTransform: 'none', fontSize: 12, margin: '3px 0 8px' }} />
                <label style={{ fontSize: 11 }}>🙋 Pedir el nombre (menciona que puede no darlo)</label>
                <textarea value={projFlow.pide_nombre} placeholder="Para atenderte mejor, ¿me dices tu *nombre*? _(o escribe *prefiero no decirlo*)_" onChange={e => setProjFlow(f => ({ ...f, pide_nombre: e.target.value }))} style={{ width: '100%', minHeight: 40, textTransform: 'none', fontSize: 12, margin: '3px 0 8px' }} />
                <label style={{ fontSize: 11 }}>🤐 Si NO quiere dar el nombre</label>
                <textarea value={projFlow.no_nombre} placeholder="¡Sin problema! Seguimos igual 😊" onChange={e => setProjFlow(f => ({ ...f, no_nombre: e.target.value }))} style={{ width: '100%', minHeight: 36, textTransform: 'none', fontSize: 12, margin: '3px 0 0' }} />
              </div>

              <div style={{ border: '1px solid rgba(232,151,90,.4)', borderRadius: 8, padding: 10, marginBottom: 10, background: 'rgba(232,151,90,.06)' }}>
                <b style={{ fontSize: 12, color: '#e8975a' }}>📎 Material del flujo (se sube aquí, no del proyecto)</b>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0 8px' }}>
                  <label className="btn-ghost" style={{ cursor: 'pointer' }}>🖼️ Subir imágenes<input type="file" accept="image/*" multiple onChange={e => subirMedia(e, 'imagen')} style={{ display: 'none' }} /></label>
                  <label className="btn-ghost" style={{ cursor: 'pointer' }}>🎬 Subir videos<input type="file" accept="video/*" multiple onChange={e => subirMedia(e, 'video')} style={{ display: 'none' }} /></label>
                  <button className="btn-ghost" onClick={() => libAdd({ id: nuevoPasoId(), tipo: 'link', url: '', desc: '' })}>🔗 Agregar link</button>
                  {subiendo && <span style={{ fontSize: 11 }}>subiendo…</span>}
                </div>
                {(projFlow.media_lib || []).length === 0 && <p className="muted" style={{ fontSize: 11 }}>Aún no hay material. Sube imágenes/videos o agrega links.</p>}
                {(projFlow.media_lib || []).map(m => (
                  <div key={m.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5, flexWrap: 'wrap', padding: '4px 6px', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6 }}>
                    <span style={{ fontSize: 11 }}>{m.tipo === 'video' ? '🎬' : m.tipo === 'link' ? '🔗' : '🖼️'}</span>
                    {m.tipo === 'link'
                      ? <input value={m.url} placeholder="https://…" onChange={e => libSet(m.id, { url: e.target.value })} style={{ flex: '1 1 160px', textTransform: 'none', fontSize: 11 }} />
                      : <a href={m.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: '#7ec8e3', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>ver archivo</a>}
                    <input value={m.desc} placeholder="descripción / texto que acompaña la imagen" onChange={e => libSet(m.id, { desc: e.target.value })} style={{ flex: '1 1 200px', textTransform: 'none', fontSize: 11 }} />
                    <button className="btn-ghost" onClick={() => libDel(m.id)}>✕</button>
                  </div>
                ))}
                <p className="muted" style={{ fontSize: 10, marginTop: 4 }}>Cada material se envía <b>uno por uno</b> con su descripción como texto. Adjunta los que quieras en cada paso del flujo (abajo).</p>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10, padding: '8px 10px', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, fontSize: 12 }}>
                <label>👤 Asesor (recibe el lead):</label>
                <input value={projNotify} placeholder="51 + número" onChange={e => setProjNotify(e.target.value)} style={{ width: 160 }} />
                <span style={{ width: 8 }} />
                <label>🔁 Si no responde, re-preguntar a los</label>
                <input type="number" min="1" value={projFlow.reask_min} onChange={e => setProjFlow(f => ({ ...f, reask_min: e.target.value }))} style={{ width: 54 }} /> min,
                <input type="number" min="0" value={projFlow.max_reasks} onChange={e => setProjFlow(f => ({ ...f, max_reasks: e.target.value }))} style={{ width: 44 }} /> vez(es)
                <input value={projFlow.reask_text} placeholder="Texto del recordatorio (opcional)" onChange={e => setProjFlow(f => ({ ...f, reask_text: e.target.value }))} style={{ flex: '1 1 180px', textTransform: 'none' }} />
              </div>

              {projFlow.steps.map((s, i) => (
                <div key={s.id} style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, padding: 10, marginBottom: 8, background: 'rgba(0,0,0,.12)' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 12 }}>Paso {i + 1}</b>
                    <select value={s.tipo} onChange={e => flowSet(i, { tipo: e.target.value })} style={{ fontSize: 12 }}>
                      <option value="mensaje">💬 Mensaje</option>
                      <option value="pregunta">❓ Pregunta</option>
                    </select>
                    <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer', color: s.pasar_asesor ? '#e0b34c' : undefined }}>
                      <input type="checkbox" checked={!!s.pasar_asesor} onChange={e => flowSet(i, { pasar_asesor: e.target.checked })} /> pasar al asesor tras este paso
                    </label>
                    <span style={{ marginLeft: 'auto' }} />
                    <button className="btn-ghost" onClick={() => flowMove(i, -1)} title="Subir">▲</button>
                    <button className="btn-ghost" onClick={() => flowMove(i, 1)} title="Bajar">▼</button>
                    <button className="btn-ghost" onClick={() => flowDel(i)} title="Quitar paso">✕</button>
                  </div>
                  <textarea value={s.texto} placeholder={s.tipo === 'pregunta' ? 'Texto de la pregunta (ej. ¿Para qué buscas el lote?)' : 'Texto del mensaje'} onChange={e => flowSet(i, { texto: e.target.value })} style={{ width: '100%', minHeight: 44, textTransform: 'none', fontSize: 12.5 }} />
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '6px 0' }}>
                    <span className="muted" style={{ fontSize: 11 }}>Adjuntar de la biblioteca:</span>
                    {(projFlow.media_lib || []).length === 0 && <span className="muted" style={{ fontSize: 10 }}>(sube material arriba)</span>}
                    {(projFlow.media_lib || []).map(m => (
                      <label key={m.id} style={{ fontSize: 11, display: 'flex', gap: 3, alignItems: 'center', cursor: 'pointer' }}>
                        <input type="checkbox" checked={(s.media || []).includes(m.id)} onChange={() => flowMedia(i, m.id)} /> {m.tipo === 'video' ? '🎬' : m.tipo === 'link' ? '🔗' : '🖼️'}{m.desc ? ' ' + m.desc.slice(0, 14) : ''}
                      </label>
                    ))}
                  </div>
                  {s.tipo === 'pregunta' && (
                    <div style={{ borderTop: '1px dashed rgba(255,255,255,.12)', paddingTop: 6, marginTop: 4 }}>
                      {(s.opciones || []).map((o, oi) => (
                        <div key={oi} style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 5, flexWrap: 'wrap' }}>
                          <input value={o.label} placeholder="Opción (ej. Inversión)" onChange={e => optSet(i, oi, { label: e.target.value })} style={{ flex: '1 1 120px', textTransform: 'none' }} />
                          <input value={o.claves} placeholder="palabras clave: invertir, negocio" onChange={e => optSet(i, oi, { claves: e.target.value })} style={{ flex: '1 1 150px', textTransform: 'none' }} />
                          <select value={o.ir_a} onChange={e => optSet(i, oi, { ir_a: e.target.value })} style={{ fontSize: 11 }}>
                            <option value="">→ siguiente paso</option>
                            {projFlow.steps.map((st, si) => si !== i ? <option key={st.id} value={st.id}>→ Paso {si + 1}</option> : null)}
                          </select>
                          <label style={{ fontSize: 11, display: 'flex', gap: 3, alignItems: 'center', cursor: 'pointer', color: o.pasar_asesor ? '#e0b34c' : undefined }}>
                            <input type="checkbox" checked={!!o.pasar_asesor} onChange={e => optSet(i, oi, { pasar_asesor: e.target.checked })} /> asesor
                          </label>
                          <button className="btn-ghost" onClick={() => optDel(i, oi)} title="Quitar opción">✕</button>
                        </div>
                      ))}
                      <button className="btn-ghost" onClick={() => optAdd(i)}>+ Opción</button>
                      <div style={{ marginTop: 8, fontSize: 11, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        🔁 Si no responde a esta pregunta, re-preguntar a los
                        <input type="number" min="1" value={s.reask_min} placeholder={String(projFlow.reask_min || 5)} onChange={e => flowSet(i, { reask_min: e.target.value })} style={{ width: 50 }} /> min,
                        <input type="number" min="0" value={s.reask_veces} placeholder={String(projFlow.max_reasks ?? 1)} onChange={e => flowSet(i, { reask_veces: e.target.value })} style={{ width: 44 }} /> vez(es)
                        <input value={s.reask_text} placeholder="texto del recordatorio (opcional)" onChange={e => flowSet(i, { reask_text: e.target.value })} style={{ flex: '1 1 160px', textTransform: 'none' }} />
                        <span className="muted" style={{ fontSize: 9 }}>vacío = usa el global de arriba</span>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 11, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        ➡️ Si aun así no responde:
                        <select value={s.sin_respuesta || 'siguiente'} onChange={e => flowSet(i, { sin_respuesta: e.target.value })} style={{ fontSize: 11 }}>
                          <option value="siguiente">pasar a la siguiente pregunta</option>
                          <option value="mensaje">enviar un mensaje y seguir</option>
                          <option value="asesor">pasar al asesor</option>
                        </select>
                        {s.sin_respuesta === 'mensaje' && <input value={s.sin_respuesta_texto} placeholder="mensaje predeterminado" onChange={e => flowSet(i, { sin_respuesta_texto: e.target.value })} style={{ flex: '1 1 180px', textTransform: 'none' }} />}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn-ghost" onClick={flowAdd}>+ Agregar paso</button>
                <button className="btn" onClick={guardarFlujo}>💾 GUARDAR FLUJO</button>
                {projQMsg && <span style={{ fontSize: 12 }}>{projQMsg}</span>}
              </div>
            </div>
          )}
          {brainSel.startsWith('p:') && <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>Abajo (opcional) la <b>info del proyecto</b> que el bot manda en el bombardeo por defecto (cuando el proyecto no tiene flujo armado).</p>}
          {!['cobranza', 'secretaria'].includes(brainSel) && (<>
          <textarea value={brainTxt} onChange={e => setBrainTxt(e.target.value)}
            placeholder="Vacío = el bot usa su cerebro por defecto. Pega aquí el MD o súbelo con el botón."
            style={{ width: '100%', minHeight: brainSel === 'gerencia' ? '20vh' : '48vh', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12.5, lineHeight: 1.5, textTransform: 'none' }} />
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            {brainTxt.length.toLocaleString()} caracteres
            {!brainSel.startsWith('p:') && brains.find(b => b.key === brainSel)?.updated_at ? ' · Última actualización: ' + new Date(brains.find(b => b.key === brainSel).updated_at).toLocaleString('es-PE') : ''}
          </p>
          </>)}
            </div>
          </div>
        </div>
      )}

      {verNums && (
        <div className="glass" style={{ padding: 14, marginBottom: 14 }}>
          <b>DIRECTORIO DE NÚMEROS</b>
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>Todo número que NO esté aquí se trata como BOT (flujo de leads). Los CLIENTES registrados en el sistema reciben cobranza automáticamente sin necesidad de agregarlos.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <input placeholder="Número (ej. 519XXXXXXXX)" value={nvo.phone} onChange={e => setNvo({ ...nvo, phone: e.target.value })} style={{ width: 180 }} />
            <select value={nvo.tipo} onChange={e => setNvo({ ...nvo, tipo: e.target.value })}>
              {TIPOS.map(t => <option key={t.v} value={t.v}>{t.t}</option>)}
            </select>
            <input placeholder="Nota (opcional)" value={nvo.note} onChange={e => setNvo({ ...nvo, note: e.target.value })} style={{ width: 200 }} />
            <button className="btn" onClick={() => guardarNum(nvo.phone, nvo.tipo, nvo.note)}>AGREGAR</button>
          </div>
          {nums.length === 0 && <p className="muted">Sin números registrados.</p>}
          {nums.map(n => {
            const t = TIPOS.find(x => x.v === n.tipo)
            const editando = edNum?.phone === n.phone
            return (
              <div key={n.phone} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.06)', flexWrap: 'wrap' }}>
                <b style={{ width: 140 }}>+{n.phone}</b>
                {editando ? (<>
                  <select value={edNum.tipo} onChange={e => setEdNum({ ...edNum, tipo: e.target.value })}>
                    {TIPOS.filter(x => x.v !== 'bot').map(x => <option key={x.v} value={x.v}>{x.t}</option>)}
                  </select>
                  <input value={edNum.note} placeholder="Nota" onChange={e => setEdNum({ ...edNum, note: e.target.value })} style={{ flex: 1, minWidth: 120 }} />
                  <button className="btn" onClick={async () => { await guardarNum(edNum.phone, edNum.tipo, edNum.note); setEdNum(null) }}>GUARDAR</button>
                  <button className="btn-ghost" onClick={() => setEdNum(null)}>&#10005;</button>
                </>) : (<>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, border: `1px solid ${t?.c || '#888'}`, color: t?.c || '#888' }}>{t?.s || n.tipo.toUpperCase()}</span>
                  <span className="muted" style={{ flex: 1, fontSize: 12 }}>{n.note}</span>
                  <button className="btn-ghost" onClick={() => setEdNum({ phone: n.phone, tipo: n.tipo, note: n.note || '' })}>EDITAR</button>
                  <button className="btn-ghost" onClick={() => borrarNum(n.phone)}>QUITAR</button>
                </>)}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: vista === 'cuadros' ? 'minmax(340px, 500px) 1fr' : 'minmax(240px, 340px) 1fr', gap: 14, alignItems: 'start' }}>
        <div className="glass" style={{ padding: 10, maxHeight: '70vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {[['todos', 'TODOS'], ['calificados', 'CALIFICADOS'], ['flujo', 'EN FLUJO'], ['clientes', 'CLIENTES'], ['humanos', 'CON ASESOR'], ['silenciados', 'SILENCIADOS']].map(([v, t]) => (
              <button key={v} className="btn-ghost" onClick={() => setFiltro(v)}
                style={{ fontSize: 10, padding: '3px 8px', borderColor: filtro === v ? 'rgba(140,155,122,.9)' : 'rgba(255,255,255,.15)', color: filtro === v ? '#c9d4bc' : undefined }}>{t}</button>
            ))}
            <button className="btn-ghost" title="Cambiar vista" onClick={() => setVista(vista === 'lista' ? 'cuadros' : 'lista')}
              style={{ fontSize: 10, padding: '3px 8px', marginLeft: 'auto' }}>{vista === 'lista' ? '⊞ CUADROS' : '☰ LISTA'}</button>
          </div>
          <input placeholder="Buscar teléfono o nombre…" value={busca} onChange={e => setBusca(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          {lista.length === 0 && <p className="muted" style={{ padding: 8 }}>Aún no hay conversaciones. Cuando alguien le escriba al bot, aparecerá aquí.</p>}
          <div style={vista === 'cuadros' ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 } : {}}>
          {lista.map(c => {
            const f = FLOW[c.flow_state]
            const tn = tipoDe(c.phone)
            return (
              <div key={c.id} onClick={() => setSel(c)}
                style={{ padding: 10, borderRadius: 10, cursor: 'pointer', marginBottom: 4, background: sel?.id === c.id ? 'rgba(140,155,122,.18)' : 'transparent', border: '1px solid ' + (sel?.id === c.id ? 'rgba(140,155,122,.5)' : 'transparent') }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <b style={{ fontSize: 13 }}>{nombreDe(c)}</b>
                  <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fh(c.last_message_at)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                  <span className="muted" style={{ fontSize: 12 }}>+{c.phone}</span>
                  <span style={{ display: 'flex', gap: 4 }}>
                    {tn && tn.tipo !== 'bot' && (() => { const tt = TIPOS.find(x => x.v === tn.tipo); return <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, border: `1px solid ${tt?.c || '#888'}`, color: tt?.c || '#888' }}>{tt?.s || tn.tipo.toUpperCase()}</span> })()}
                    {f && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, border: `1px solid ${f.c}`, color: f.c }}>{f.t}</span>}
                    {c.clients && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, border: '1px solid #b8a1d9', color: '#b8a1d9' }}>CLIENTE</span>}
                  </span>
                </div>
              </div>
            )
          })}
          </div>
        </div>

        <div className="glass" style={{ padding: 14, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
          {!sel && <p className="muted" style={{ padding: 20 }}>Elige una conversación de la lista para ver los mensajes.</p>}
          {sel && (
            <>
              {(() => {
                const tnSel = tipoDe(sel.phone)
                const esCliente = tnSel?.tipo === 'cliente' || !!sel.clients
                const esRegistrado = !!tnSel && tnSel.tipo !== 'bot'   // cliente/secretaria/gerencia/admin/silencio
                const mostrarLead = !!sel.lead_id && !esRegistrado
                const avColor = esCliente ? '#b8a1d9' : tnSel?.tipo === 'secretaria' || tnSel?.tipo === 'gerencia' ? '#7ec8e3' : '#9ccb86'
                const inicial = (nombreDe(sel).trim()[0] || '?').toUpperCase()
                return (
                  <div className="wa-head">
                    <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
                      <div className="wa-avatar" style={{ background: avColor }}>{inicial}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <b style={{ fontSize: 15 }}>{nombreDe(sel)}</b>
                          {sel.lead_id && (
                            <button className="btn-ghost" title="Editar nombre" style={{ padding: '0 6px', fontSize: 12, lineHeight: 1.4 }} onClick={async () => {
                              const nuevo = prompt('Nombre del lead:', nombreDe(sel))
                              if (!nuevo || !nuevo.trim()) return
                              await supabase.from('leads').update({ full_name: nuevo.trim().toUpperCase() }).eq('id', sel.lead_id)
                              cargarConvs(); setSel(x => ({ ...x, leads: { ...(x.leads || {}), full_name: nuevo.trim().toUpperCase() } }))
                            }}>✎</button>
                          )}
                          {esCliente && <span className="wa-badge" style={{ color: '#b8a1d9', borderColor: '#b8a1d9' }}>💵 CLIENTE · COBRANZA</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 3 }}>
                          <span className="muted" style={{ fontSize: 12 }}>+{sel.phone}</span>
                          {mostrarLead && (
                            <span className="muted" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>LEAD:
                              <select className="wa-sel" value={sel.leads?.status || 'nuevo'} style={{ fontSize: 11, padding: '3px 6px' }} onChange={async e => {
                                const st = e.target.value
                                await supabase.from('leads').update({ status: st }).eq('id', sel.lead_id)
                                cargarConvs(); setSel(x => ({ ...x, leads: { ...(x.leads || {}), status: st } }))
                              }}>
                                {['nuevo', 'contactado', 'interesado', 'visita_agendada', 'negociacion', 'ganado', 'perdido'].map(o => <option key={o} value={o}>{o.toUpperCase()}</option>)}
                              </select>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <select className="wa-sel" value={tnSel?.tipo || 'bot'}
                        onChange={e => { const v = e.target.value; if (v === 'bot') { const n = tipoDe(sel.phone); if (n) borrarNum(n.phone) } else guardarNum(sel.phone, v, 'CLASIFICADO DESDE EL CHAT') }}>
                        <option value="bot">🟢 NUEVO LEAD (BOT)</option>
                        <option value="cliente">💵 CLIENTE (COBRANZA)</option>
                        <option value="desactivado">🚫 ADMINISTRATIVO (SIN RESPUESTA)</option>
                        <option value="secretaria">🗓️ SECRETARIA (SEGUIMIENTO)</option>
                        <option value="gerencia">👑 GERENCIA (SEGUIMIENTO)</option>
                        <option value="silencio">🔇 SILENCIO TOTAL</option>
                      </select>
                      <a className="wa-btn" href={`https://wa.me/${sel.phone}`} target="_blank" rel="noreferrer">💬 WhatsApp</a>
                    </div>
                  </div>
                )
              })()}
              <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 6 }}>
                {msgs.length === 0 && <p className="muted">Sin mensajes guardados todavía.</p>}
                {msgs.map((m, i) => (
                  <div key={i} style={{ alignSelf: m.dir === 'out' ? 'flex-end' : 'flex-start',  maxWidth: '78%', background: m.dir === 'out' ? 'rgba(59,74,50,.9)' : 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.08)', borderRadius: m.dir === 'out' ? '12px 12px 2px 12px' : '12px 12px 12px 2px', padding: '8px 12px' }}>
                    <div style={{ whiteSpace: 'pre-wrap', textTransform: 'none', fontSize: 13, lineHeight: 1.45 }}>{m.body}</div>
                    <div className="muted" style={{ fontSize: 10, marginTop: 4, textAlign: 'right' }}>
                      {m.dir === 'out' ? (m.fallo ? '⚠️ FALLÓ · ' : m.pend ? '⏳ ENVIANDO · ' : '🤖 BOT · ') : ''}{m.tipo && m.dir === 'out' ? m.tipo.toUpperCase() + ' · ' : ''}{fh(m.at)}
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              <ReplyBox phone={sel.phone} onSent={() => cargarMsgs(selRef.current)} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
