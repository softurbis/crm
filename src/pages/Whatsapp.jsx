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
  const [brainSel, setBrainSel] = useState('ventas')
  const [brainTxt, setBrainTxt] = useState('')
  const [brainMsg, setBrainMsg] = useState('')
  const [ensenaTxt, setEnsenaTxt] = useState('')
  const [secCfg, setSecCfg] = useState({ checkins: ['11:00', '16:30'], recordatorio: true, avisoHora: true, feedback: true, feedbackHora: '17:30' })
  const [secMsg, setSecMsg] = useState('')
  const [projQ, setProjQ] = useState([])
  const [projNotify, setProjNotify] = useState('')
  const [projQMsg, setProjQMsg] = useState('')
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
  const BRAIN_DEFS = [
    { k: 'ventas', t: '🧠 VENTAS — cerebro principal (papel + flujo del calificador)', lbl: 'VENTAS', color: '#9ccb86', meta: 900 },
    { k: 'instrucciones', t: '📌 INSTRUCCIONES ESPECÍFICAS — se suman al de ventas', lbl: 'REGLAS', color: '#7ec8e3', meta: 500 },
    { k: 'prohibiciones', t: '🚫 NUNCA DECIR — prohibiciones absolutas', lbl: 'PROHIBIDO', color: '#e07b7b', meta: 400 },
    { k: 'aprendido', t: '💡 APRENDIDO — lo que le has enseñado (se suma a ventas)', lbl: 'APRENDIDO', color: '#e8975a', meta: 400 },
    { k: 'cobranza', t: '💵 COBRANZA — plantillas de mensajes', lbl: 'COBRANZA', color: '#e0b34c', meta: 600 },
    { k: 'secretaria', t: '🗓️ SECRETARIA — mensajes del seguimiento', lbl: 'SEGUIMIENTO', color: '#b8a1d9', meta: 600 },
    { k: 'gerencia', t: '🔐 GERENCIA — notas internas para el Q&A del equipo (opcional)', lbl: 'GERENCIA', color: '#6fd0c9', meta: 500 },
  ]
  const cargarBrains = async () => {
    const [{ data: b }, { data: p }] = await Promise.all([
      supabase.from('bot_brains').select('*'),
      supabase.from('projects').select('id, name, bot_knowledge, bot_questions, lead_notify_phone').order('name'),
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
  const elegirBrain = k => {
    setBrainSel(k); setBrainTxt(textoDe(k)); setBrainMsg(''); setProjQMsg('')
    if (k.startsWith('p:')) {
      const p = proys.find(x => x.id === k.slice(2))
      let q = []
      try { q = Array.isArray(p?.bot_questions) ? p.bot_questions : JSON.parse(p?.bot_questions || '[]') } catch {}
      setProjQ((q || []).filter(x => x && x.q).slice(0, 5))
      setProjNotify(p?.lead_notify_phone || '')
    }
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
            <Toggle on={flags.ia_activa} onClick={() => setFlag('ia_activa', !flags.ia_activa)} icon="🧠" label="VENTAS" />
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
          {['admin', 'superuser'].includes(role) && <button className="btn-ghost" onClick={async () => { const v = !verBrains; setVerBrains(v); if (v) { const { b } = await cargarBrains(); setBrainSel('ventas'); setBrainTxt(b.find(x => x.key === 'ventas')?.content || ''); setBrainMsg('') } }}>🧠 CEREBROS</button>}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 380px) 1fr', gap: 16, alignItems: 'start' }}>
            <div className="glass" style={{ padding: 8, background: 'rgba(0,0,0,.18)' }}>
              <BrainMap nodes={buildNodes()} selected={brainSel} onSelect={elegirBrain} />
            </div>
            <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
            <select value={brainSel} onChange={e => elegirBrain(e.target.value)} style={{ maxWidth: 340 }}>
              {BRAIN_DEFS.map(b => <option key={b.k} value={b.k}>{b.t}</option>)}
              {proys.map(p => <option key={p.id} value={'p:' + p.id}>📁 FICHA: {p.name}</option>)}
            </select>
            <label className="btn-ghost" style={{ cursor: 'pointer' }}>
              📄 SUBIR .MD
              <input type="file" accept=".md,.txt" onChange={subirMd} style={{ display: 'none' }} />
            </label>
            <button className="btn" onClick={guardarBrain}>💾 GUARDAR</button>
            {brainMsg && <span style={{ fontSize: 12 }}>{brainMsg}</span>}
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
            <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>
              Formato: secciones <b>## A5</b> (5 días antes), <b>## A3</b>, <b>## A0</b> (vence hoy), <b>## INSISTENCIA</b>, <b>## B</b> (2 vencidas), <b>## C</b> (3+ vencidas).
              Tokens: {'{nombre} {lote} {proyecto} {cuota} {monto} {fecha} {dias} {nvencidas} {deuda}'}. Sección ausente = plantilla por defecto.
            </p>
          )}
          {brainSel === 'secretaria' && (
            <>
              <div style={{ border: '1px solid rgba(184,161,217,.5)', borderRadius: 10, padding: 12, marginBottom: 10, background: 'rgba(184,161,217,.06)' }}>
                <b style={{ color: '#b8a1d9', fontSize: 13 }}>🗓️ HORARIOS DEL SEGUIMIENTO</b>
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
              <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>
                Abajo editas los <b>textos</b> que usa el bot con el equipo. Secciones: <b>## PREGUNTA</b>, <b>## RECORDATORIO</b>, <b>## CONFIRMACION</b>, <b>## PENDIENTE</b>, <b>## NO_ENTENDI</b>, <b>## RESUMEN</b>.
                Tokens: {'{nombre} {lista} {momento} {resumen} {detalle}'}. Sección ausente = plantilla por defecto.
              </p>
            </>
          )}
          {brainSel === 'instrucciones' && (
            <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>
              Ajustes finos que se SUMAN al cerebro de VENTAS sin reemplazarlo (el bot las cumple con prioridad). Escribe una por línea.
              Ej: "Si preguntan por El Triunfo de Neshuya, deriva al asesor de inmediato" · "Los domingos responde que la oficina abre el lunes" · "Siempre menciona que la visita guiada es gratis".
            </p>
          )}
          {brainSel === 'prohibiciones' && (
            <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>
              Lo que el bot NUNCA debe decir ni hacer, pase lo que pase (se suma a las prohibiciones de fábrica). Una por línea.
              Ej: "Nunca dar precios de la Mz A" · "Nunca prometer fecha de titulación" · "Nunca mencionar al dueño por su nombre".
            </p>
          )}
          {brainSel === 'gerencia' && (
            <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>
              🔐 Cuando <b>Victor o gerencia PREGUNTAN</b> por WhatsApp, el bot responde con <b>datos reales del sistema</b>:
              comisiones por cobrar, gastos por proyecto/mes, visitas pendientes, cuotas vencidas, disponibilidad y precios. <b>No hay que escribirlos aquí.</b>
              Este cerebro es <b>opcional</b>: solo para notas/políticas que NO están en el sistema (ej. "el margen mínimo por lote es S/ X"). Déjalo vacío si no hace falta.
            </p>
          )}
          {brainSel.startsWith('p:') && (
            <div style={{ border: '1px solid rgba(156,203,134,.5)', borderRadius: 10, padding: 12, marginBottom: 10, background: 'rgba(156,203,134,.06)' }}>
              <b style={{ color: 'var(--accent-strong)', fontSize: 13 }}>🧩 PREGUNTAS DEL CALIFICADOR (máx 5)</b>
              <p className="muted" style={{ fontSize: 11, margin: '3px 0 8px' }}>El bot de ventas (sin IA) le hace estas preguntas cerradas al lead de este proyecto, tras enviarle fotos/videos/info. Opciones separadas por coma. Vacío = usa las preguntas por defecto.</p>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10, padding: '8px 10px', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8 }}>
                <label style={{ fontSize: 12 }}>👤 Asesor asignado (recibe el lead calificado):</label>
                <input value={projNotify} placeholder="51 + número (ej. 51944538888)" onChange={e => setProjNotify(e.target.value)} style={{ width: 200 }} />
                <span className="muted" style={{ fontSize: 10 }}>Le llega igual que al admin: proyecto, cliente, preguntas y respuestas.</span>
              </div>
              {projQ.map((q, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, width: 16 }}>{i + 1}.</span>
                  <input value={q.q || ''} placeholder="Pregunta (ej. ¿Para qué lo buscas?)" onChange={e => setProjQ(a => a.map((x, j) => j === i ? { ...x, q: e.target.value } : x))} style={{ flex: '1 1 220px', textTransform: 'none' }} />
                  <input value={(q.opciones || []).join(', ')} placeholder="Opciones: Vivienda, Inversión, Negocio" onChange={e => setProjQ(a => a.map((x, j) => j === i ? { ...x, opciones: e.target.value.split(',').map(s => s.trim()) } : x))} style={{ flex: '1 1 220px', textTransform: 'none' }} />
                  <button className="btn-ghost" title="Quitar" onClick={() => setProjQ(a => a.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {projQ.length < 5 && <button className="btn-ghost" onClick={() => setProjQ(a => [...a, { q: '', opciones: [] }])}>+ Agregar pregunta</button>}
                <button className="btn" onClick={guardarPreguntas}>💾 GUARDAR PREGUNTAS</button>
                {projQMsg && <span style={{ fontSize: 12 }}>{projQMsg}</span>}
              </div>
            </div>
          )}
          {brainSel.startsWith('p:') && <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>Abajo va la <b>info del proyecto</b> (descripción, cómo llegar, ganchos) que el bot manda en el bombardeo.</p>}
          <textarea value={brainTxt} onChange={e => setBrainTxt(e.target.value)}
            placeholder="Vacío = el bot usa su cerebro por defecto. Pega aquí el MD o súbelo con el botón."
            style={{ width: '100%', minHeight: '48vh', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12.5, lineHeight: 1.5, textTransform: 'none' }} />
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            {brainTxt.length.toLocaleString()} caracteres
            {!brainSel.startsWith('p:') && brains.find(b => b.key === brainSel)?.updated_at ? ' · Última actualización: ' + new Date(brains.find(b => b.key === brainSel).updated_at).toLocaleString('es-PE') : ''}
          </p>
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
