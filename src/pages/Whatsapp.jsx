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

// mime → tipo de media que entiende el agente
const tipoDeArchivo = f => f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : 'document'
const MEDIA_ICON = { image: '🖼️', video: '🎬', audio: '🎙️', document: '📄', sticker: '🩵' }
// color del proyecto (#rrggbb) → rgba con transparencia; null si no hay color válido
const rgbaDe = (hex, a) => {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6 || isNaN(parseInt(h, 16))) return null
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
// etiquetas de estado del chat: lista por defecto + paleta para las que se creen en el panel
const TAGS_DEF = [{ n: 'CALIFICADO', c: '#7fbf7f' }, { n: 'TIBIO', c: '#e0b34c' }, { n: 'FRIO', c: '#7ec8e3' }, { n: 'CLIENTE', c: '#b8a1d9' }]
const TAG_PALETA = ['#e8975a', '#6fd0c9', '#e07b7b', '#9ccb86', '#c58ae0', '#7ba7f7', '#e6a4d0', '#e7c15a']
const cap = s => s ? s[0] + s.slice(1).toLowerCase() : ''

function ReplyBox({ conv, userId, onSent, quicks = [], vars = {}, esAdmin, onQuicks }) {
  const [txt, setTxt] = useState('')
  const [mandando, setMandando] = useState(false)
  const [adj, setAdj] = useState(null)          // { file, tipo } pendiente de enviar
  const [editQ, setEditQ] = useState(false)     // modo borrar respuestas rápidas
  // {nombre} y {proyecto} se reemplazan con los datos del chat
  const aplicarVars = q => String(q).split('{nombre}').join(vars.nombre || '').split('{proyecto}').join(vars.proyecto || '').replace(/ {2,}/g, ' ').trim()
  const agregarQuick = () => {
    const q = prompt('Texto de la respuesta rápida (puedes usar {nombre} y {proyecto}):')
    if (q && q.trim() && onQuicks) onQuicks([...quicks, q.trim()])
  }
  const elegirArchivo = e => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    const tipo = tipoDeArchivo(f)
    const lim = (tipo === 'video' || tipo === 'document') ? 95 : 30    // el tope real lo pone Supabase Storage
    if (f.size > lim * 1024 * 1024) {
      alert('Máximo ' + lim + ' MB para este tipo de archivo.\n\nTip: comprime el video (WhatsApp igual lo comprime) o compártelo como link de Drive/YouTube en el mensaje.')
      return
    }
    setAdj({ file: f, tipo })
  }
  const enviarMsg = async () => {
    const body = txt.trim()
    if (!body && !adj) return
    setMandando(true)
    let media = {}
    if (adj) {
      const ext = (adj.file.name.split('.').pop() || 'bin').toLowerCase()
      const ruta = 'wa-chat/panel/' + conv.id + '/' + Date.now() + '.' + ext
      const { error } = await supabase.storage.from('urbis-files').upload(ruta, adj.file, { contentType: adj.file.type || undefined, upsert: true })
      if (error) {
        const esLimite = /exceed|too large|payload|maximum/i.test(String(error.message))
        alert('No se pudo subir el archivo: ' + error.message + (esLimite ? '\n\n⚠️ Es el límite de Supabase Storage. Súbelo en: Supabase → Project Settings → Storage → "Upload file size limit" (el plan Free permite hasta 50 MB).' : ''))
        setMandando(false); return
      }
      media = { media_url: supabase.storage.from('urbis-files').getPublicUrl(ruta).data.publicUrl, media_type: adj.tipo, media_name: adj.file.name }
    }
    const { error } = await supabase.from('scheduled_messages').insert({
      recipient_phone: conv.phone, body: body || null, tipo: 'manual_panel', status: 'pendiente',
      scheduled_for: new Date().toISOString(), conversation_id: conv.id,
      session_id: conv.session_id || null, sender_id: userId || null, ...media,
    })
    if (error) alert('No se pudo enviar: ' + error.message)
    setTxt(''); setAdj(null); setMandando(false); onSent && onSent()
  }
  return (
    <div>
      {(quicks.length > 0 || esAdmin) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0 4px', alignItems: 'center' }}>
          {quicks.map((q, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <button className="btn-ghost" title={aplicarVars(q)} onClick={() => setTxt(aplicarVars(q))}
                style={{ fontSize: 11, textTransform: 'none', padding: '3px 11px', borderRadius: 16 }}>⚡ {q.slice(0, 36)}{q.length > 36 ? '…' : ''}</button>
              {editQ && <button className="btn-ghost" style={{ padding: '1px 6px' }} onClick={() => onQuicks && onQuicks(quicks.filter((_, j) => j !== i))}>✕</button>}
            </span>
          ))}
          {esAdmin && <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px', borderRadius: 16 }} title="Crear respuesta rápida" onClick={agregarQuick}>➕</button>}
          {esAdmin && quicks.length > 0 && <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px', borderRadius: 16 }} title="Quitar respuestas rápidas" onClick={() => setEditQ(!editQ)}>{editQ ? '✔ LISTO' : '✎'}</button>}
        </div>
      )}
      {adj && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '4px 8px', border: '1px dashed rgba(255,255,255,.25)', borderRadius: 8, marginBottom: 4 }}>
          {MEDIA_ICON[adj.tipo]} <span style={{ textTransform: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{adj.file.name}</span>
          <span className="muted">{(adj.file.size / 1024 / 1024).toFixed(1)} MB</span>
          <button className="btn-ghost" onClick={() => setAdj(null)}>✕</button>
        </div>
      )}
      <div className="wa-reply">
        <label className="wa-btn" title="Adjuntar imagen, video, audio o documento" style={{ cursor: 'pointer' }}>
          📎<input type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={elegirArchivo} style={{ display: 'none' }} />
        </label>
        <input value={txt} onChange={e => setTxt(e.target.value)} placeholder={adj ? 'Texto que acompaña al archivo (opcional)…' : 'Escribe y sale por el número de este chat… (el bot se calla al responder tú)'}
          onKeyDown={e => { if (e.key === 'Enter') enviarMsg() }} />
        <button className="wa-btn wa-solid" disabled={mandando} onClick={enviarMsg}>{mandando ? '…' : '➤ ENVIAR'}</button>
      </div>
    </div>
  )
}

export default function Whatsapp() {
  const { role, profile } = useAuth()
  const esAdminW = ['admin', 'superuser'].includes(role)      // gestiona bot, números y cerebros
  const puedeEscribir = ['admin', 'superuser', 'secretary', 'asesor'].includes(role)
  const [convs, setConvs] = useState([])
  const [sel, setSel] = useState(null)
  const [msgs, setMsgs] = useState([])
  const [busca, setBusca] = useState('')
  const [vista, setVista] = useState('lista')
  const [filtro, setFiltro] = useState('todos')
  const [filtroProy, setFiltroProy] = useState('')            // '' = todos los proyectos
  const [filtroTag, setFiltroTag] = useState('')              // '' = todas las etiquetas
  const [sesiones, setSesiones] = useState([])                // wa_sessions (números vinculados)
  const [verSes, setVerSes] = useState(false)                 // gestor de números por proyecto
  const [usuarios, setUsuarios] = useState([])                // para asignar chats
  const [reenvio, setReenvio] = useState(null)                // mensaje elegido para reenviar
  const [tags, setTags] = useState(TAGS_DEF)                  // etiquetas de estado (configurables)
  const [quicks, setQuicks] = useState([])                    // respuestas rápidas (burbujas)
  // etiquetas y respuestas rápidas viven en bot_brains (chat_tags / quick_replies)
  const cargarExtras = async () => {
    const { data } = await supabase.from('bot_brains').select('key, content').in('key', ['chat_tags', 'quick_replies'])
    for (const r of (data || [])) {
      if (r.key === 'chat_tags') { const o = parseArr(r.content).filter(t => t && t.n); if (o.length) setTags(o) }
      if (r.key === 'quick_replies') setQuicks(parseArr(r.content).filter(x => typeof x === 'string' && x.trim()))
    }
  }
  const guardarTags = async next => { setTags(next); await supabase.from('bot_brains').upsert({ key: 'chat_tags', content: JSON.stringify(next), updated_at: new Date().toISOString() }) }
  const guardarQuicks = async next => { setQuicks(next); await supabase.from('bot_brains').upsert({ key: 'quick_replies', content: JSON.stringify(next), updated_at: new Date().toISOString() }) }
  const crearTag = async () => {
    const n = prompt('Nombre de la etiqueta nueva (ej. SEPARÓ, NO CONTESTA, VISITÓ):')
    if (!n || !n.trim()) return null
    const nombre = n.trim().toUpperCase()
    if (!tags.some(t => t.n === nombre)) await guardarTags([...tags, { n: nombre, c: TAG_PALETA[tags.length % TAG_PALETA.length] }])
    return nombre
  }
  const setTagChat = async (c, tag) => {
    await supabase.from('whatsapp_conversations').update({ tag: tag || null }).eq('id', c.id)
    cargarConvs(); setSel(x => x && x.id === c.id ? { ...x, tag: tag || null } : x)
  }
  const colorTag = n => tags.find(t => t.n === n)?.c || '#9daab6'
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
  const [projFlow, setProjFlow] = useState({ reask_min: 0, max_reasks: 1, reask_text: '', reask_unit: 'min', pausa_seg: 3, media_lib: [], bombardeo: [], steps: [] })
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
        reask_min: fl?.reask_min ?? 0, max_reasks: fl?.max_reasks ?? 1, reask_text: fl?.reask_text || '', reask_unit: fl?.reask_unit || 'min', pausa_seg: fl?.pausa_seg ?? 3,
        media_lib: Array.isArray(fl?.media_lib) ? fl.media_lib : [], bombardeo: Array.isArray(fl?.bombardeo) ? fl.bombardeo : [],
        steps: Array.isArray(fl?.steps) ? fl.steps.map(s => ({ id: s.id || nuevoPasoId(), tipo: s.tipo === 'pregunta' ? 'pregunta' : 'mensaje', texto: s.texto || '', media: s.media || [], pasar_asesor: !!s.pasar_asesor, reask_min: s.reask_min ?? '', reask_unit: s.reask_unit || '', reask_veces: s.reask_veces ?? '', reask_text: s.reask_text || '', sin_respuesta: s.sin_respuesta || 'siguiente', sin_respuesta_texto: s.sin_respuesta_texto || '', opciones: (s.opciones || []).map(o => ({ label: o.label || '', claves: o.claves || '', ir_a: o.ir_a || '', pasar_asesor: !!o.pasar_asesor })) })) : [],
      })
    }
  }
  // ---- constructor de flujo por proyecto ----
  const flowSet = (i, patch) => setProjFlow(f => ({ ...f, steps: f.steps.map((s, j) => j === i ? { ...s, ...patch } : s) }))
  const flowAdd = () => setProjFlow(f => ({ ...f, steps: [...f.steps, { id: nuevoPasoId(), tipo: 'mensaje', texto: '', media: [], pasar_asesor: false, opciones: [] }] }))
  const flowDel = i => setProjFlow(f => ({ ...f, steps: f.steps.filter((_, j) => j !== i) }))
  const flowMove = (i, d) => setProjFlow(f => { const a = [...f.steps]; const j = i + d; if (j < 0 || j >= a.length) return f;[a[i], a[j]] = [a[j], a[i]]; return { ...f, steps: a } })
  const flowMedia = (i, key) => setProjFlow(f => ({ ...f, steps: f.steps.map((s, j) => j === i ? { ...s, media: (s.media || []).includes(key) ? s.media.filter(m => m !== key) : [...(s.media || []), key] } : s) }))
  const flowMediaMove = (i, mi, d) => setProjFlow(f => ({ ...f, steps: f.steps.map((s, j) => { if (j !== i) return s; const a = [...(s.media || [])]; const k = mi + d; if (k < 0 || k >= a.length) return s;[a[mi], a[k]] = [a[k], a[mi]]; return { ...s, media: a } }) }))
  const optSet = (i, oi, patch) => setProjFlow(f => ({ ...f, steps: f.steps.map((s, j) => j === i ? { ...s, opciones: (s.opciones || []).map((o, k) => k === oi ? { ...o, ...patch } : o) } : s) }))
  const optAdd = i => setProjFlow(f => ({ ...f, steps: f.steps.map((s, j) => j === i ? { ...s, opciones: [...(s.opciones || []), { label: '', claves: '', ir_a: '', pasar_asesor: false }] } : s) }))
  const optDel = (i, oi) => setProjFlow(f => ({ ...f, steps: f.steps.map((s, j) => j === i ? { ...s, opciones: (s.opciones || []).filter((_, k) => k !== oi) } : s) }))
  // ---- biblioteca de material del flujo (subir imágenes/videos + links con descripción) ----
  const libAdd = it => setProjFlow(f => ({ ...f, media_lib: [...(f.media_lib || []), it] }))
  const libSet = (id, patch) => setProjFlow(f => ({ ...f, media_lib: f.media_lib.map(x => x.id === id ? { ...x, ...patch } : x) }))
  const libMove = (id, d) => setProjFlow(f => { const a = [...(f.media_lib || [])]; const i = a.findIndex(x => x.id === id); const j = i + d; if (i < 0 || j < 0 || j >= a.length) return f;[a[i], a[j]] = [a[j], a[i]]; return { ...f, media_lib: a } })
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
      reask_min: Math.max(0, parseInt(projFlow.reask_min) || 0), reask_unit: projFlow.reask_unit === 'seg' ? 'seg' : 'min', max_reasks: Number(projFlow.max_reasks) || 0, reask_text: (projFlow.reask_text || '').trim(), pausa_seg: Math.max(0, Number(projFlow.pausa_seg) || 0),
      media_lib: (projFlow.media_lib || []).filter(m => (m.url || '').trim()).map(m => ({ id: m.id, tipo: m.tipo, url: (m.url || '').trim(), desc: (m.desc || '').trim() })),
      bombardeo: projFlow.bombardeo || [],
      steps: (projFlow.steps || []).map(s => ({
        id: s.id, tipo: s.tipo === 'pregunta' ? 'pregunta' : 'mensaje', texto: (s.texto || '').trim(), media: s.media || [], pasar_asesor: !!s.pasar_asesor,
        ...(s.tipo === 'pregunta' && String(s.reask_min).trim() !== '' ? { reask_min: Math.max(0, parseInt(s.reask_min) || 0) } : {}),
        ...(s.tipo === 'pregunta' && (s.reask_unit === 'seg' || s.reask_unit === 'min') ? { reask_unit: s.reask_unit } : {}),
        ...(s.tipo === 'pregunta' && (s.reask_text || '').trim() ? { reask_text: (s.reask_text || '').trim() } : {}),
        ...(s.tipo === 'pregunta' ? { sin_respuesta: ['mensaje', 'asesor'].includes(s.sin_respuesta) ? s.sin_respuesta : 'siguiente' } : {}),
        ...(s.tipo === 'pregunta' && s.sin_respuesta === 'mensaje' && (s.sin_respuesta_texto || '').trim() ? { sin_respuesta_texto: (s.sin_respuesta_texto || '').trim() } : {}),
        opciones: s.tipo === 'pregunta' ? (s.opciones || []).map(o => ({ label: (o.label || '').trim(), claves: (o.claves || '').trim(), ir_a: o.ir_a || '', pasar_asesor: !!o.pasar_asesor })).filter(o => o.label) : [],
      })).filter(s => s.texto || (s.media && s.media.length) || (s.opciones && s.opciones.length)),
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
      .select('*, leads(full_name, status), clients(full_name), projects(name, color)')
      .order('last_message_at', { ascending: false, nullsFirst: false }).limit(300)
    setConvs(data || [])
  }
  // sesiones (números vinculados). Si la tabla aún no existe (sql/30 sin correr), queda vacío
  // y el estado del bot se muestra con bot_settings como antes.
  const cargarSesiones = async () => {
    const { data, error } = await supabase.from('wa_sessions').select('*').order('is_corporate', { ascending: false }).order('created_at')
    if (error) return
    setSesiones(data || [])
    const qrs = {}
    for (const s of (data || [])) {
      if (s.estado === 'esperando_qr' && s.qr) { try { qrs[s.id] = await QRCode.toDataURL(s.qr, { width: 240, margin: 1 }) } catch {} }
    }
    setQrsSes(qrs)
  }
  const [qrsSes, setQrsSes] = useState({})
  const [proysAll, setProysAll] = useState([])
  const cargarProysAll = async () => {
    const { data } = await supabase.from('projects').select('id, name, color').order('name')
    setProysAll(data || [])
  }
  const sesionViva = s => s.latido && (Date.now() - new Date(s.latido).getTime()) < 120000
  const crearSesion = async () => {
    const label = prompt('Nombre del número (ej. CASHIBO, PUCALLPA):')
    if (!label || !label.trim()) return
    const { error } = await supabase.from('wa_sessions').insert({ label: label.trim().toUpperCase() })
    if (error) { alert('ERROR: ' + error.message); return }
    alert('Número creado. En ~30 segundos aparecerá su QR aquí para escanear con el celular nuevo.\n\nDespués asígnale su proyecto en la lista.')
    cargarSesiones()
  }
  const setSesCampo = async (id, campos) => {
    const { error } = await supabase.from('wa_sessions').update(campos).eq('id', id)
    if (error) alert('ERROR: ' + error.message)
    cargarSesiones()
  }
  const marcarCorporativa = async id => {
    if (!confirm('¿Hacer de este número el CORPORATIVO?\n\nPor el corporativo salen: seguimiento de secretarias, comandos de gerencia y avisos internos.')) return
    await supabase.from('wa_sessions').update({ is_corporate: false }).neq('id', id)
    await setSesCampo(id, { is_corporate: true })
  }
  const relinkSesion = async s => {
    if (!confirm(`¿VINCULAR OTRO CELULAR al número "${s.label}"?\n\nSe cierra su WhatsApp actual y en ~30 segundos aparece un QR nuevo para escanear.`)) return
    await setSesCampo(s.id, { relink: true })
  }
  const restartSesion = async s => { await setSesCampo(s.id, { restart: true }); alert('Reinicio de "' + s.label + '" solicitado (tarda ~30-60 seg; no pide QR).') }
  const borrarSesion = async s => {
    if (s.is_corporate) { alert('El número corporativo no se elimina (primero marca otro como corporativo).'); return }
    if (!confirm(`¿ELIMINAR el número "${s.label}"?\n\nSus chats quedan en el historial pero ese WhatsApp deja de atenderse desde el panel.`)) return
    await supabase.from('wa_sessions').delete().eq('id', s.id)
    cargarSesiones()
  }
  const cargarUsuarios = async () => {
    if (!esAdminW) return
    const { data } = await supabase.from('profiles').select('id, full_name, role, active').order('full_name')
    setUsuarios((data || []).filter(u => u.active !== false))
  }
  const cargarMsgs = async c => {
    if (!c) return
    const lid = String(c.wa_jid || '').split('@')[0].replace(/\D/g, '')
    const dests = lid && lid !== c.phone ? [c.phone, lid] : [c.phone]
    // salientes: los de ESTA conversación + los históricos sin conversación (por teléfono)
    const orSched = `conversation_id.eq.${c.id},and(conversation_id.is.null,recipient_phone.in.(${dests.join(',')}))`
    const [ins, outs] = await Promise.all([
      supabase.from('whatsapp_messages').select('body, created_at, direction, media_url, media_type, media_name, delivery_status').eq('conversation_id', c.id).limit(500),
      supabase.from('scheduled_messages').select('body, sent_at, scheduled_for, status, tipo, media_url, media_type, media_name, sender_id').or(orSched).in('status', ['enviado', 'fallido', 'pendiente']).limit(500),
    ])
    const a = (ins.data || []).map(m => ({ body: m.body, at: m.created_at, dir: m.direction || 'in', media_url: m.media_url, media_type: m.media_type, media_name: m.media_name, cel: m.delivery_status === 'celular' }))
    const b = (outs.data || []).map(m => ({ body: m.body, at: m.sent_at || m.scheduled_for, dir: 'out', tipo: m.tipo, fallo: m.status === 'fallido', pend: m.status === 'pendiente', media_url: m.media_url, media_type: m.media_type, media_name: m.media_name, sender_id: m.sender_id }))
    setMsgs([...a, ...b].filter(x => x.body || x.media_url).sort((x, y) => new Date(x.at) - new Date(y.at)))
  }

  // deps [role]: el perfil llega asíncrono; cuando el rol aparece se recargan las
  // partes de admin (flags/números/usuarios) y se recrea el intervalo sin capturas viejas.
  useEffect(() => { cargarConvs(); cargarSesiones(); cargarProysAll(); cargarExtras(); if (esAdminW) { cargarFlags(); cargarNums(); cargarUsuarios() } }, [role])
  useEffect(() => { selRef.current = sel; cargarMsgs(sel) }, [sel])
  useEffect(() => {
    const t = setInterval(() => { cargarConvs(); cargarSesiones(); if (esAdminW) cargarFlags(); if (selRef.current) cargarMsgs(selRef.current) }, 8000)
    return () => clearInterval(t)
  }, [role])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs.length])

  if (!['admin', 'superuser', 'secretary', 'manager', 'asesor'].includes(role)) return <div className="glass" style={{ padding: 24 }}>Sin acceso al chat de WhatsApp.</div>

  const lista = convs.filter(c => {
    if (filtroProy && c.project_id !== filtroProy) return false
    if (filtroTag && c.tag !== filtroTag) return false
    if (busca) {
      const q = busca.toLowerCase()
      if (!((c.phone || '').includes(q) || (c.leads?.full_name || '').toLowerCase().includes(q) || (c.clients?.full_name || '').toLowerCase().includes(q))) return false
    }
    if (filtro === 'calificados') return c.flow_state === 'completado'
    if (filtro === 'flujo') return ['espera_nombre', 'espera_proyecto', 'flow'].includes(c.flow_state)
    if (filtro === 'clientes') return !!c.clients
    if (filtro === 'humanos') return c.flow_state === 'humano' || c.modo === 'humano'
    if (filtro === 'mios') return c.assigned_to === profile?.id
    if (filtro === 'silenciados') return !!nums.find(n => c.phone && ['desactivado', 'silencio'].includes(n.tipo) && (c.phone.endsWith(n.phone.slice(-9)) || n.phone.endsWith(String(c.phone).slice(-9))))
    return true
  })
  // proyectos presentes en la bandeja (para el filtro por color)
  const proysBandeja = (() => {
    const m = new Map()
    convs.forEach(c => { if (c.project_id && c.projects) m.set(c.project_id, c.projects) })
    return [...m.entries()]
  })()
  const nombreUsuario = id => usuarios.find(u => u.id === id)?.full_name?.split(' ')[0] || '¿?'
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
        <h1>WhatsApp</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {esAdminW && (<>
          <Toggle on={flags.bot_activo} onClick={() => setFlag('bot_activo', !flags.bot_activo)} icon="🤖" label="BOT" />
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 10px 4px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,.1)', opacity: flags.bot_activo ? 1 : 0.45 }}>
            <span className="muted" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.5px' }}>AGENTES</span>
            <Toggle on={flags.ia_activa} onClick={() => setFlag('ia_activa', !flags.ia_activa)} icon="🤖" label="LEADS" />
            <Toggle on={flags.cobranza_activa} onClick={() => setFlag('cobranza_activa', !flags.cobranza_activa)} icon="💵" label="COBRANZA" />
            <Toggle on={flags.seguimiento_activo !== false} onClick={() => setFlag('seguimiento_activo', flags.seguimiento_activo === false)} icon="🗓️" label="SEGUIMIENTO" />
          </span>
          </>)}
          {sesiones.length > 0 ? sesiones.map(s => {
            const [txt, col] = s.estado === 'esperando_qr' ? ['📱 QR…', '#e0b34c']
              : sesionViva(s) ? ['🟢', '#6fdd9b']
              : s.latido ? ['🔴', '#e07b7b'] : ['📱', '#e0b34c']
            return <span key={s.id} onClick={() => esAdminW && setVerSes(true)}
              title={(s.is_corporate ? 'CORPORATIVO · ' : '') + (s.phone ? '+' + s.phone + ' · ' : '') + (s.latido ? 'último latido ' + new Date(s.latido).toLocaleTimeString('es-PE') : 'sin latido aún')}
              style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, border: `1px solid ${col}99`, color: col, cursor: esAdminW ? 'pointer' : 'default' }}>
              {txt} {s.label || 'PRINCIPAL'}{s.is_corporate ? ' ★' : ''}</span>
          }) : (() => {
            const fresco = waLatido && (Date.now() - new Date(waLatido).getTime()) < 120000
            const [txt, col] = waEstado === 'esperando_qr' ? ['📱 ESPERANDO QR...', '#e0b34c']
              : fresco ? ['🟢 BOT EN LÍNEA', '#6fdd9b']
              : waLatido ? ['🔴 BOT SIN RESPONDER', '#e07b7b']
              : waEstado === 'conectado' ? ['📱 CONECTADO', '#6fdd9b'] : ['📱 —', '#e0b34c']
            return <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 20, border: `1px solid ${col}99`, color: col }}>{txt}</span>
          })()}
          {esAdminW && <button className="btn-ghost" onClick={() => setVerSes(!verSes)} title="Números de WhatsApp por proyecto: vincular, reiniciar, asignar proyecto">📱 MIS NÚMEROS ({sesiones.length || 1})</button>}
          {esAdminW && <button className="btn-ghost" onClick={reiniciarBot} title="Si el bot dejó de responder, reinícialo desde aquí (no pide QR)">🔁 REINICIAR</button>}
          {role === 'superuser' && sesiones.length === 0 && <button className="btn-ghost" onClick={pedirRelink} title="Desvincular y escanear QR con otro celular">🔄 VINCULAR NÚMERO</button>}
          {role === 'superuser' && <button className="btn-ghost" onClick={cambiarAdmin} title="Número que recibe avisos, reportes y resúmenes">👑 ADMIN{adminPhone ? ': +' + adminPhone : ''}</button>}
          {esAdminW && <button className="btn-ghost" onClick={() => setVerNums(!verNums)}>📇 DIRECTORIO ({nums.length})</button>}
          {esAdminW && <button className="btn-ghost" onClick={async () => { const v = !verBrains; setVerBrains(v); if (v) { const { b, p } = await cargarBrains(); elegirBrain('cobranza', b, p) } }}>🧠 CEREBROS</button>}
        </div>
      </div>

      {/* QR pendientes: uno por cada número esperando vinculación */}
      {sesiones.filter(s => s.estado === 'esperando_qr' && qrsSes[s.id]).map(s => (
        <div key={s.id} className="glass" style={{ padding: 18, marginBottom: 12, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', border: '1px solid rgba(224,179,76,.5)' }}>
          <img src={qrsSes[s.id]} alt={'QR ' + s.label} style={{ width: 220, height: 220, borderRadius: 10, background: '#fff', padding: 8 }} />
          <div style={{ maxWidth: 420 }}>
            <b>📱 ESCANEA ESTE QR CON EL CELULAR DE «{s.label || 'PRINCIPAL'}»</b>
            <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              En ese celular: WhatsApp → Dispositivos vinculados → Vincular dispositivo → apunta a este código.
              El QR se renueva solo cada ~30 segundos. Cuando conecte, este recuadro desaparece y arriba se pone 🟢.
            </p>
          </div>
        </div>
      ))}
      {sesiones.length === 0 && qrImg && (
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

      {/* Gestor de números por proyecto (wa_sessions) */}
      {verSes && esAdminW && (
        <div className="glass" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <b>📱 NÚMEROS DE WHATSAPP (uno por proyecto)</b>
            <button className="btn" onClick={crearSesion}>➕ AGREGAR NÚMERO</button>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>
            Cada proyecto atiende desde su propio número (chip propio). El <b>★ CORPORATIVO</b> además lleva el seguimiento
            de secretarias, gerencia y avisos internos. Al agregar un número, su QR aparece arriba en ~30 segundos.
          </p>
          {sesiones.length === 0 && <p className="muted">Aún no hay números registrados (¿ya se corrió sql/30 y se redesplegó el agente?).</p>}
          {sesiones.map(s => (
            <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.06)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14 }}>{s.estado === 'esperando_qr' ? '📱' : sesionViva(s) ? '🟢' : '🔴'}</span>
              <input value={s.label || ''} onChange={e => setSesiones(a => a.map(x => x.id === s.id ? { ...x, label: e.target.value } : x))}
                onBlur={e => setSesCampo(s.id, { label: e.target.value.trim().toUpperCase() })} style={{ width: 130, fontWeight: 700 }} />
              <span className="muted" style={{ fontSize: 12, width: 110 }}>{s.phone ? '+' + s.phone : '(sin vincular)'}</span>
              <select value={s.project_id || ''} onChange={e => setSesCampo(s.id, { project_id: e.target.value || null })} style={{ fontSize: 11, maxWidth: 190 }}
                title="Proyecto que atiende este número: sus leads y su cobranza salen por aquí">
                <option value="">— sin proyecto —</option>
                {proysAll.map(p => <option key={p.id} value={p.id} disabled={sesiones.some(x => x.id !== s.id && x.project_id === p.id)}>{p.name}</option>)}
              </select>
              {s.is_corporate
                ? <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, border: '1px solid #e7c15a', color: '#e7c15a' }}>★ CORPORATIVO</span>
                : <button className="btn-ghost" style={{ fontSize: 10 }} onClick={() => marcarCorporativa(s.id)} title="Hacer de este el número de seguimiento/gerencia/avisos">☆ hacer corporativo</button>}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="btn-ghost" onClick={() => relinkSesion(s)} title="Escanear QR con otro celular">🔄 VINCULAR</button>
                <button className="btn-ghost" onClick={() => restartSesion(s)} title="Reiniciar solo este número (no pide QR)">🔁</button>
                {!s.is_corporate && <button className="btn-ghost" onClick={() => borrarSesion(s)} title="Eliminar este número">✕</button>}
              </span>
            </div>
          ))}
        </div>
      )}

      {esAdminW && !flags.bot_activo && <div className="glass" style={{ padding: '8px 14px', marginBottom: 10, border: '1px solid rgba(224,123,123,.6)', color: '#e07b7b' }}>⚠️ BOT APAGADO: no responde a nadie ni envía cobranzas. Vuelve a activarlo cuando quieras.</div>}
      {esAdminW && flags.bot_activo && !flags.cobranza_activa && <div className="glass" style={{ padding: '8px 14px', marginBottom: 10, border: '1px solid rgba(224,179,76,.5)', color: '#e0b34c' }}>La cobranza automática está APAGADA. El filtro de leads sigue funcionando.</div>}

      {verBrains && (
        <div className="glass" style={{ padding: 14, marginBottom: 14 }}>
          <b>🧠 CEREBROS DEL BOT</b>
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>
            El cerebro del bot dividido por áreas. Toca un nodo del mapa para editarlo. Si un cerebro está VACÍO,
            el bot usa su versión por defecto. Los cambios rigen en máximo 1 minuto, sin reiniciar nada.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 520px) 1fr', gap: 16, alignItems: 'start' }}>
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
              <p className="muted" style={{ fontSize: 11, margin: '3px 0 8px' }}>Lo único fijo es que el bot <b>reconoce el proyecto</b> por el mensaje del cliente (y si no lo identifica, le pregunta cuál). De ahí en adelante corre <b>SOLO estos pasos, tal cual</b>: mensajes con material adjunto y preguntas cerradas que responden por <b>número o palabra clave</b>, con ramas (ir a otro paso) y disparadores de <b>pasar al asesor</b>. <b>El 1er paso es tu bienvenida</b> (no hay nada predeterminado: ni nombre, ni preguntas por defecto). Vacío = el bot solo registra el lead y avisa al asesor. Usa <b>{'{proyecto}'}</b> y <b>{'{nombre}'}</b> en cualquier texto y se reemplazan solos.</p>

              <div style={{ border: '1px solid rgba(232,151,90,.4)', borderRadius: 8, padding: 10, marginBottom: 10, background: 'rgba(232,151,90,.06)' }}>
                <b style={{ fontSize: 12, color: '#e8975a' }}>📎 Material del flujo (se sube aquí, no del proyecto)</b>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0 8px' }}>
                  <label className="btn-ghost" style={{ cursor: 'pointer' }}>🖼️ Subir imágenes<input type="file" accept="image/*" multiple onChange={e => subirMedia(e, 'imagen')} style={{ display: 'none' }} /></label>
                  <label className="btn-ghost" style={{ cursor: 'pointer' }}>🎬 Subir videos<input type="file" accept="video/*" multiple onChange={e => subirMedia(e, 'video')} style={{ display: 'none' }} /></label>
                  <label className="btn-ghost" style={{ cursor: 'pointer' }}>📄 Subir PDF<input type="file" accept="application/pdf,.pdf" multiple onChange={e => subirMedia(e, 'pdf')} style={{ display: 'none' }} /></label>
                  <button className="btn-ghost" onClick={() => libAdd({ id: nuevoPasoId(), tipo: 'link', url: '', desc: '' })}>🔗 Agregar link</button>
                  {subiendo && <span style={{ fontSize: 11 }}>subiendo…</span>}
                </div>
                {(projFlow.media_lib || []).length === 0 && <p className="muted" style={{ fontSize: 11 }}>Aún no hay material. Sube imágenes/videos o agrega links.</p>}
                {(projFlow.media_lib || []).map((m, mli) => (
                  <div key={m.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5, flexWrap: 'wrap', padding: '4px 6px', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6 }}>
                    <b style={{ fontSize: 10, opacity: .6, width: 16 }}>{mli + 1}.</b>
                    <button className="btn-ghost" onClick={() => libMove(m.id, -1)} title="Subir">▲</button>
                    <button className="btn-ghost" onClick={() => libMove(m.id, 1)} title="Bajar">▼</button>
                    <span style={{ fontSize: 11 }}>{m.tipo === 'video' ? '🎬' : m.tipo === 'pdf' ? '📄' : m.tipo === 'link' ? '🔗' : '🖼️'}</span>
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
                <label title="Si el lead no responde una pregunta, tras este tiempo el bot pasa al siguiente paso">⏭️ Si no responde, pasar al siguiente a los</label>
                <input type="number" min="0" value={projFlow.reask_min} onChange={e => setProjFlow(f => ({ ...f, reask_min: e.target.value }))} style={{ width: 54 }} />
                <select value={projFlow.reask_unit || 'min'} onChange={e => setProjFlow(f => ({ ...f, reask_unit: e.target.value }))} style={{ fontSize: 12 }}>
                  <option value="seg">segundos</option>
                  <option value="min">minutos</option>
                </select>
                <span className="muted" style={{ fontSize: 9 }}>(default; 0 = espera indefinida. Ajustable por pregunta.)</span>
                <span style={{ width: 8 }} />
                <label title="Tiempo que 'escribe' entre cada mensaje/imagen del flujo">⏱️ Pausa entre mensajes</label>
                <input type="number" min="0" max="30" value={projFlow.pausa_seg} onChange={e => setProjFlow(f => ({ ...f, pausa_seg: e.target.value }))} style={{ width: 44 }} /> seg
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
                  <div style={{ margin: '6px 0' }}>
                    <span className="muted" style={{ fontSize: 11 }}>📎 Material a enviar (en este orden, después del texto):</span>
                    {(projFlow.media_lib || []).length === 0 && <span className="muted" style={{ fontSize: 10 }}> (sube material arriba)</span>}
                    {(s.media || []).map((mid, mi) => {
                      const m = (projFlow.media_lib || []).find(x => x.id === mid)
                      if (!m) return null
                      const ic = m.tipo === 'video' ? '🎬' : m.tipo === 'pdf' ? '📄' : m.tipo === 'link' ? '🔗' : '🖼️'
                      return (
                        <div key={mid} style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 3, fontSize: 11 }}>
                          <b style={{ width: 16 }}>{mi + 1}.</b> <span>{ic}</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'none' }}>{m.desc ? m.desc.slice(0, 30) : '(sin descripción)'}</span>
                          <button className="btn-ghost" onClick={() => flowMediaMove(i, mi, -1)} title="Subir">▲</button>
                          <button className="btn-ghost" onClick={() => flowMediaMove(i, mi, 1)} title="Bajar">▼</button>
                          <button className="btn-ghost" onClick={() => flowMedia(i, mid)} title="Quitar">✕</button>
                        </div>
                      )
                    })}
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                      {(projFlow.media_lib || []).filter(m => !(s.media || []).includes(m.id)).map(m => {
                        const ic = m.tipo === 'video' ? '🎬' : m.tipo === 'pdf' ? '📄' : m.tipo === 'link' ? '🔗' : '🖼️'
                        return <button key={m.id} className="btn-ghost" style={{ fontSize: 10, textTransform: 'none' }} onClick={() => flowMedia(i, m.id)}>+ {ic} {m.desc ? m.desc.slice(0, 14) : 'material'}</button>
                      })}
                    </div>
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
                        ⏭️ Si no responde en
                        <input type="number" min="0" value={s.reask_min} placeholder={String(projFlow.reask_min || 0)} onChange={e => flowSet(i, { reask_min: e.target.value })} style={{ width: 50 }} />
                        <select value={s.reask_unit || ''} onChange={e => flowSet(i, { reask_unit: e.target.value })} style={{ fontSize: 11 }}>
                          <option value="">(unidad global)</option>
                          <option value="seg">segundos</option>
                          <option value="min">minutos</option>
                        </select>
                        →
                        <select value={s.sin_respuesta || 'siguiente'} onChange={e => flowSet(i, { sin_respuesta: e.target.value })} style={{ fontSize: 11 }}>
                          <option value="siguiente">pasar al siguiente paso</option>
                          <option value="mensaje">enviar un mensaje y seguir</option>
                          <option value="asesor">pasar al asesor</option>
                        </select>
                        {s.sin_respuesta === 'mensaje' && <input value={s.sin_respuesta_texto} placeholder="mensaje antes de seguir" onChange={e => flowSet(i, { sin_respuesta_texto: e.target.value })} style={{ flex: '1 1 180px', textTransform: 'none' }} />}
                        <span className="muted" style={{ fontSize: 9 }}>vacío/0 = espera indefinida</span>
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
          {proysBandeja.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
              <button className="btn-ghost" onClick={() => setFiltroProy('')}
                style={{ fontSize: 10, padding: '3px 8px', borderColor: !filtroProy ? 'rgba(140,155,122,.9)' : 'rgba(255,255,255,.15)' }}>TODOS LOS PROYECTOS</button>
              {proysBandeja.map(([pid, p]) => (
                <button key={pid} className="btn-ghost" onClick={() => setFiltroProy(filtroProy === pid ? '' : pid)}
                  style={{ fontSize: 10, padding: '3px 8px', borderColor: filtroProy === pid ? (p.color || '#8c9b7a') : 'rgba(255,255,255,.15)', color: p.color || undefined }}>
                  ● {(p.name || '').split(' ').slice(-1)[0]}</button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {[['todos', 'TODOS'], ['mios', '⭐ MÍOS'], ['calificados', 'CALIFICADOS'], ['flujo', 'EN FLUJO'], ['clientes', 'CLIENTES'], ['humanos', '👤 EN HUMANO'], ['silenciados', 'SILENCIADOS']].map(([v, t]) => (
              <button key={v} className="btn-ghost" onClick={() => setFiltro(v)}
                style={{ fontSize: 10, padding: '3px 8px', borderColor: filtro === v ? 'rgba(140,155,122,.9)' : 'rgba(255,255,255,.15)', color: filtro === v ? '#c9d4bc' : undefined }}>{t}</button>
            ))}
            <select value={filtroTag} onChange={e => setFiltroTag(e.target.value)} title="Filtrar por etiqueta de estado"
              style={{ fontSize: 10, padding: '2px 6px', color: filtroTag ? colorTag(filtroTag) : undefined }}>
              <option value="">🏷️ TODAS</option>
              {tags.map(t => <option key={t.n} value={t.n}>{t.n}</option>)}
            </select>
            <button className="btn-ghost" title="Cambiar vista" onClick={() => setVista(vista === 'lista' ? 'cuadros' : 'lista')}
              style={{ fontSize: 10, padding: '3px 8px', marginLeft: 'auto' }}>{vista === 'lista' ? '⊞ CUADROS' : '☰ LISTA'}</button>
          </div>
          <input placeholder="Buscar teléfono o nombre…" value={busca} onChange={e => setBusca(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          {lista.length === 0 && <p className="muted" style={{ padding: 8 }}>Aún no hay conversaciones. Cuando alguien le escriba al bot, aparecerá aquí.</p>}
          <div style={vista === 'cuadros' ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 } : {}}>
          {lista.map(c => {
            const f = FLOW[c.flow_state]
            const tn = tipoDe(c.phone)
            const colProy = c.projects?.color || null
            return (
              <div key={c.id} onClick={() => setSel(c)}
                style={{ padding: 10, borderRadius: 10, cursor: 'pointer', marginBottom: 4, borderLeft: colProy ? `3px solid ${colProy}` : undefined, background: sel?.id === c.id ? 'rgba(140,155,122,.18)' : 'transparent', border: '1px solid ' + (sel?.id === c.id ? 'rgba(140,155,122,.5)' : 'transparent') }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <b style={{ fontSize: 13 }}>{nombreDe(c)}</b>
                  <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fh(c.last_message_at)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                  <span className="muted" style={{ fontSize: 12 }}>+{c.phone}</span>
                  <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {c.projects && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, border: `1px solid ${colProy || '#6fd0c9'}`, color: colProy || '#6fd0c9' }}>{(c.projects.name || '').split(' ').slice(-1)[0].toUpperCase()}</span>}
                    {c.tag && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, border: `1px solid ${colorTag(c.tag)}`, color: colorTag(c.tag) }}>🏷️ {c.tag}</span>}
                    {c.modo === 'humano' && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, border: '1px solid #e8975a', color: '#e8975a' }}>👤 EN HUMANO</span>}
                    {c.assigned_to && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, border: '1px solid #7ec8e3', color: '#7ec8e3' }} title="Chat asignado">⭐ {c.assigned_to === profile?.id ? 'MÍO' : nombreUsuario(c.assigned_to)}</span>}
                    {tn && tn.tipo !== 'bot' && (() => { const tt = TIPOS.find(x => x.v === tn.tipo); return <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, border: `1px solid ${tt?.c || '#888'}`, color: tt?.c || '#888' }}>{tt?.s || tn.tipo.toUpperCase()}</span> })()}
                    {f && c.modo !== 'humano' && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, border: `1px solid ${f.c}`, color: f.c }}>{f.t}</span>}
                    {c.clients && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, border: '1px solid #b8a1d9', color: '#b8a1d9' }}>CLIENTE</span>}
                  </span>
                </div>
              </div>
            )
          })}
          </div>
        </div>

        <div className="glass" style={{ padding: 14, maxHeight: '70vh', display: 'flex', flexDirection: 'column', borderTop: sel?.projects?.color ? `3px solid ${sel.projects.color}` : undefined, boxShadow: rgbaDe(sel?.projects?.color, .12) ? `inset 0 0 60px ${rgbaDe(sel.projects.color, .07)}` : undefined }}>
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
                          {!esAdminW && sel.projects && <span className="wa-badge" style={{ color: sel.projects.color || '#6fd0c9', borderColor: sel.projects.color || '#6fd0c9' }}>📁 {sel.projects.name}</span>}
                          {esAdminW && (
                            <select className="wa-sel" value={sel.project_id || ''} title="Proyecto del chat: etiqueta, color y por qué número sale la atención"
                              style={{ fontSize: 11, color: sel.projects?.color || undefined }}
                              onChange={async e => {
                                const v = e.target.value || null
                                await supabase.from('whatsapp_conversations').update({ project_id: v }).eq('id', sel.id)
                                const p = proysAll.find(x => x.id === v)
                                cargarConvs(); setSel(x => ({ ...x, project_id: v, projects: p ? { name: p.name, color: p.color } : null }))
                              }}>
                              <option value="">📁 SIN PROYECTO</option>
                              {proysAll.map(p => <option key={p.id} value={p.id}>📁 {p.name}</option>)}
                            </select>
                          )}
                          <select className="wa-sel" value={sel.tag && tags.some(t => t.n === sel.tag) ? sel.tag : (sel.tag || '')} title="Etiqueta de estado del chat"
                            style={{ fontSize: 11, color: sel.tag ? colorTag(sel.tag) : undefined }}
                            onChange={async e => {
                              let v = e.target.value
                              if (v === '__nueva') { v = await crearTag(); if (!v) return }
                              if (v === '__quitar') { const n = prompt('Nombre EXACTO de la etiqueta a eliminar de la lista:'); if (n && n.trim()) await guardarTags(tags.filter(t => t.n !== n.trim().toUpperCase())); return }
                              await setTagChat(sel, v)
                            }}>
                            <option value="">🏷️ SIN ETIQUETA</option>
                            {tags.map(t => <option key={t.n} value={t.n}>🏷️ {t.n}</option>)}
                            {sel.tag && !tags.some(t => t.n === sel.tag) && <option value={sel.tag}>🏷️ {sel.tag}</option>}
                            {esAdminW && <option value="__nueva">➕ CREAR ETIQUETA…</option>}
                            {esAdminW && tags.length > 0 && <option value="__quitar">🗑 ELIMINAR DE LA LISTA…</option>}
                          </select>
                          {sel.lead_id && ['admin', 'superuser', 'secretary'].includes(role) && (
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
                          {mostrarLead && ['admin', 'superuser', 'secretary'].includes(role) && (
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
                      {sel.modo === 'humano' ? (
                        <button className="wa-btn" style={{ borderColor: '#e8975a', color: '#e8975a' }}
                          title={'Lo atiende una persona' + (sel.humano_desde ? ' desde ' + fh(sel.humano_desde) : '') + '. Clic para que el bot retome este chat.'}
                          onClick={async () => {
                            if (!confirm('¿DEVOLVER ESTE CHAT AL BOT?\n\nEl bot volverá a responder automáticamente aquí.')) return
                            await supabase.from('whatsapp_conversations').update({ modo: 'bot', humano_por: null, humano_desde: null }).eq('id', sel.id)
                            cargarConvs(); setSel(x => ({ ...x, modo: 'bot' }))
                          }}>👤 EN HUMANO · 🤖 devolver al bot</button>
                      ) : (
                        <span className="wa-badge" title="El bot atiende este chat. Se calla solo cuando alguien responde desde el panel." style={{ color: '#9ccb86', borderColor: '#9ccb86' }}>🤖 BOT ATIENDE</span>
                      )}
                      {esAdminW && (
                        <select className="wa-sel" value={sel.assigned_to || ''} title="Asignar este chat a un usuario (le aparece en su bandeja)"
                          onChange={async e => {
                            const v = e.target.value || null
                            await supabase.from('whatsapp_conversations').update({ assigned_to: v }).eq('id', sel.id)
                            cargarConvs(); setSel(x => ({ ...x, assigned_to: v }))
                          }}>
                          <option value="">⭐ SIN ASIGNAR</option>
                          {usuarios.map(u => <option key={u.id} value={u.id}>⭐ {u.full_name}{u.role === 'asesor' ? ' (ASESOR)' : ''}</option>)}
                        </select>
                      )}
                      {esAdminW && (
                        <select className="wa-sel" value={tnSel?.tipo || 'bot'}
                          onChange={e => { const v = e.target.value; if (v === 'bot') { const n = tipoDe(sel.phone); if (n) borrarNum(n.phone) } else guardarNum(sel.phone, v, 'CLASIFICADO DESDE EL CHAT') }}>
                          <option value="bot">🟢 NUEVO LEAD (BOT)</option>
                          <option value="cliente">💵 CLIENTE (COBRANZA)</option>
                          <option value="desactivado">🚫 ADMINISTRATIVO (SIN RESPUESTA)</option>
                          <option value="secretaria">🗓️ SECRETARIA (SEGUIMIENTO)</option>
                          <option value="gerencia">👑 GERENCIA (SEGUIMIENTO)</option>
                          <option value="silencio">🔇 SILENCIO TOTAL</option>
                        </select>
                      )}
                      <a className="wa-btn" href={`https://wa.me/${sel.phone}`} target="_blank" rel="noreferrer">💬 WhatsApp</a>
                    </div>
                  </div>
                )
              })()}
              <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 6 }}>
                {msgs.length === 0 && <p className="muted">Sin mensajes guardados todavía.</p>}
                {msgs.map((m, i) => (
                  <div key={i} className="wa-burbuja" style={{ alignSelf: m.dir === 'out' ? 'flex-end' : 'flex-start',  maxWidth: '78%', background: m.dir === 'out' ? (rgbaDe(sel.projects?.color, .28) || 'rgba(59,74,50,.9)') : 'rgba(255,255,255,.07)', border: '1px solid ' + (m.dir === 'out' ? (rgbaDe(sel.projects?.color, .4) || 'rgba(255,255,255,.08)') : 'rgba(255,255,255,.08)'), borderRadius: m.dir === 'out' ? '12px 12px 2px 12px' : '12px 12px 12px 2px', padding: '8px 12px', position: 'relative' }}>
                    {m.media_url && (
                      m.media_type === 'image' || m.media_type === 'sticker'
                        ? <a href={m.media_url} target="_blank" rel="noreferrer"><img src={m.media_url} alt="" style={{ maxWidth: 260, maxHeight: 260, borderRadius: 8, display: 'block', marginBottom: m.body ? 6 : 0 }} /></a>
                        : m.media_type === 'video'
                          ? <video src={m.media_url} controls style={{ maxWidth: 280, borderRadius: 8, display: 'block', marginBottom: m.body ? 6 : 0 }} />
                          : m.media_type === 'audio'
                            ? <audio src={m.media_url} controls style={{ maxWidth: 260, display: 'block', marginBottom: m.body ? 6 : 0 }} />
                            : <a href={m.media_url} target="_blank" rel="noreferrer" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#7ec8e3', marginBottom: m.body ? 6 : 0, textTransform: 'none' }}>📄 {m.media_name || 'DOCUMENTO'}</a>
                    )}
                    {m.body && <div style={{ whiteSpace: 'pre-wrap', textTransform: 'none', fontSize: 13, lineHeight: 1.45 }}>{m.body}</div>}
                    <div className="muted" style={{ fontSize: 10, marginTop: 4, textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                      {puedeEscribir && (m.body || m.media_url) && (
                        <button className="btn-ghost" title="Reenviar a otro chat" style={{ fontSize: 10, padding: '0 5px' }}
                          onClick={() => setReenvio({ body: m.body || '', media_url: m.media_url || null, media_type: m.media_type || null, media_name: m.media_name || null, destino: '' })}>↪</button>
                      )}
                      <span>
                        {m.dir === 'out' ? (m.fallo ? '⚠️ FALLÓ · ' : m.pend ? '⏳ ENVIANDO · ' : m.cel ? '📲 CELULAR · ' : (m.tipo === 'manual_panel' ? '👤 ' + (m.sender_id ? nombreUsuario(m.sender_id) : 'PANEL') + ' · ' : '🤖 BOT · ')) : ''}
                        {m.tipo && m.dir === 'out' && m.tipo !== 'manual_panel' ? m.tipo.toUpperCase() + ' · ' : ''}{fh(m.at)}
                      </span>
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              {reenvio && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 8px', border: '1px solid rgba(126,200,227,.5)', borderRadius: 8, margin: '6px 0', fontSize: 12 }}>
                  <b style={{ color: '#7ec8e3' }}>↪ REENVIAR</b>
                  <span style={{ textTransform: 'none', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {reenvio.media_url ? (MEDIA_ICON[reenvio.media_type] || '📎') + ' ' : ''}{reenvio.body || reenvio.media_name || 'archivo'}
                  </span>
                  <span>a:</span>
                  <select value={reenvio.destino} onChange={e => setReenvio(r => ({ ...r, destino: e.target.value }))} style={{ fontSize: 11, maxWidth: 220 }}>
                    <option value="">— elige un chat —</option>
                    {convs.filter(c => c.id !== sel.id).slice(0, 150).map(c => <option key={c.id} value={c.id}>{nombreDe(c)} · +{c.phone}{c.projects ? ' · ' + (c.projects.name || '').split(' ').slice(-1)[0] : ''}</option>)}
                  </select>
                  <button className="wa-btn wa-solid" disabled={!reenvio.destino} onClick={async () => {
                    const dest = convs.find(c => c.id === reenvio.destino)
                    if (!dest) return
                    const { error } = await supabase.from('scheduled_messages').insert({
                      recipient_phone: dest.phone, body: reenvio.body || null, tipo: 'manual_panel', status: 'pendiente',
                      scheduled_for: new Date().toISOString(), conversation_id: dest.id, session_id: dest.session_id || null,
                      sender_id: profile?.id || null, media_url: reenvio.media_url, media_type: reenvio.media_type, media_name: reenvio.media_name,
                    })
                    if (error) alert('No se pudo reenviar: ' + error.message)
                    else alert('✅ Reenviado a ' + nombreDe(dest) + ' (sale en segundos).')
                    setReenvio(null)
                  }}>ENVIAR</button>
                  <button className="btn-ghost" onClick={() => setReenvio(null)}>✕</button>
                </div>
              )}
              {puedeEscribir
                ? <ReplyBox conv={sel} userId={profile?.id} onSent={() => cargarMsgs(selRef.current)}
                    quicks={quicks} esAdmin={esAdminW} onQuicks={guardarQuicks}
                    vars={{ nombre: (() => { const n = nombreDe(sel); return n === 'SIN NOMBRE' ? '' : cap(n.trim().split(' ')[0]) })(), proyecto: sel.projects?.name || '' }} />
                : <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>Gerencia: solo lectura.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
