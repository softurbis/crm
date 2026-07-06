import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const FLOW = {
  espera_nombre:   { t: 'ESPERANDO NOMBRE',  c: '#e0b34c' },
  espera_proyecto: { t: 'ELIGIENDO PROYECTO', c: '#7ec8e3' },
  completado:      { t: 'CALIFICADO',         c: '#7fbf7f' },
}
const TIPOS = [
  { v: 'desactivado', t: 'ADMINISTRATIVO (el bot nunca responde)', c: '#e07b7b' },
  { v: 'bot',         t: 'BOT (flujo de leads)',                c: '#9ccb86' },
  { v: 'cliente',     t: 'CLIENTE (solo cobranza)',             c: '#b8a1d9' },
  { v: 'secretaria',  t: 'SECRETARIA (seguimiento, prox.)',     c: '#7ec8e3' },
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
    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
      <input value={txt} onChange={e => setTxt(e.target.value)} placeholder="Escribe y el bot lo envía desde el número de Urbis…"
        style={{ flex: 1, textTransform: 'none' }} onKeyDown={e => { if (e.key === 'Enter') enviarMsg() }} />
      <button className="btn" disabled={mandando} onClick={enviarMsg}>{mandando ? '...' : 'ENVIAR'}</button>
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
  const [adminPhone, setAdminPhone] = useState('')
  const [waEstado, setWaEstado] = useState('')
  const [qrImg, setQrImg] = useState('')
  const [verBrains, setVerBrains] = useState(false)
  const [brains, setBrains] = useState([])
  const [proys, setProys] = useState([])
  const [brainSel, setBrainSel] = useState('ventas')
  const [brainTxt, setBrainTxt] = useState('')
  const [brainMsg, setBrainMsg] = useState('')
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
        else if (!['hora_corte_manana', 'hora_corte_tarde', 'hora_resumen_sec', 'hora_feedback_sec', 'sec_resumen_fecha', 'wa_relink'].includes(r.key)) f[r.key] = r.value !== '0'
      })
      setFlags(f)
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

  const BRAIN_DEFS = [
    { k: 'ventas', t: '🧠 VENTAS — calificador de leads (system prompt)' },
    { k: 'cobranza', t: '💵 COBRANZA — plantillas de mensajes' },
    { k: 'secretaria', t: '🗓️ SECRETARIA — seguimiento (próximamente)' },
  ]
  const cargarBrains = async () => {
    const [{ data: b }, { data: p }] = await Promise.all([
      supabase.from('bot_brains').select('*'),
      supabase.from('projects').select('id, name, bot_knowledge').order('name'),
    ])
    setBrains(b || []); setProys(p || [])
    return { b: b || [], p: p || [] }
  }
  const textoDe = k => k.startsWith('p:')
    ? (proys.find(x => x.id === k.slice(2))?.bot_knowledge || '')
    : (brains.find(x => x.key === k)?.content || '')
  const elegirBrain = k => { setBrainSel(k); setBrainTxt(textoDe(k)); setBrainMsg('') }
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
    if (filtro === 'silenciados') return !!nums.find(n => c.phone && n.tipo === 'desactivado' && (c.phone.endsWith(n.phone.slice(-9)) || n.phone.endsWith(String(c.phone).slice(-9))))
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
          <Toggle on={flags.cobranza_activa} onClick={() => setFlag('cobranza_activa', !flags.cobranza_activa)} icon="💵" label="COBRANZA" />
          <Toggle on={flags.ia_activa} onClick={() => setFlag('ia_activa', !flags.ia_activa)} icon="🧠" label="IA" />
          <Toggle on={flags.seguimiento_activo !== false} onClick={() => setFlag('seguimiento_activo', flags.seguimiento_activo === false)} icon="🗓️" label="SEGUIMIENTO" />
          <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 20, border: `1px solid ${waEstado === 'conectado' ? 'rgba(111,221,155,.6)' : 'rgba(224,179,76,.6)'}`, color: waEstado === 'conectado' ? '#6fdd9b' : '#e0b34c' }}>
            {waEstado === 'conectado' ? '📱 CONECTADO' : waEstado === 'esperando_qr' ? '📱 ESPERANDO QR...' : '📱 —'}
          </span>
          {role === 'superuser' && <button className="btn-ghost" onClick={pedirRelink} title="Desvincular y escanear QR con otro celular">🔄 VINCULAR NÚMERO</button>}
          {role === 'superuser' && <button className="btn-ghost" onClick={cambiarAdmin} title="Número que recibe avisos, reportes y resúmenes">👑 ADMIN{adminPhone ? ': +' + adminPhone : ''}</button>}
          <button className="btn-ghost" onClick={() => setVerNums(!verNums)}>📇 NÚMEROS ({nums.length})</button>
          {role === 'superuser' && <button className="btn-ghost" onClick={async () => { const v = !verBrains; setVerBrains(v); if (v) { const { b } = await cargarBrains(); setBrainSel('ventas'); setBrainTxt(b.find(x => x.key === 'ventas')?.content || ''); setBrainMsg('') } }}>🧠 CEREBROS</button>}
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
            Aquí editas el comportamiento del bot directamente. Si un cerebro está VACÍO, el bot usa su versión por defecto.
            Los cambios rigen en máximo 1 minuto, sin reiniciar nada.
          </p>
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
          {brainSel === 'cobranza' && (
            <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>
              Formato: secciones <b>## A5</b> (5 días antes), <b>## A3</b>, <b>## A0</b> (vence hoy), <b>## INSISTENCIA</b>, <b>## B</b> (2 vencidas), <b>## C</b> (3+ vencidas).
              Tokens: {'{nombre} {lote} {proyecto} {cuota} {monto} {fecha} {dias} {nvencidas} {deuda}'}. Sección ausente = plantilla por defecto.
            </p>
          )}
          {brainSel === 'secretaria' && (
            <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>Este cerebro aún no está conectado al agente — puedes dejarlo listo y se activará con el módulo de seguimiento.</p>
          )}
          <textarea value={brainTxt} onChange={e => setBrainTxt(e.target.value)}
            placeholder="Vacío = el bot usa su cerebro por defecto. Pega aquí el MD o súbelo con el botón."
            style={{ width: '100%', minHeight: '48vh', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12.5, lineHeight: 1.5, textTransform: 'none' }} />
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            {brainTxt.length.toLocaleString()} caracteres
            {!brainSel.startsWith('p:') && brains.find(b => b.key === brainSel)?.updated_at ? ' · Última actualización: ' + new Date(brains.find(b => b.key === brainSel).updated_at).toLocaleString('es-PE') : ''}
          </p>
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
            return (
              <div key={n.phone} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                <b style={{ width: 140 }}>+{n.phone}</b>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, border: `1px solid ${t?.c}`, color: t?.c }}>{n.tipo.toUpperCase()}</span>
                <span className="muted" style={{ flex: 1, fontSize: 12 }}>{n.note}</span>
                <button className="btn-ghost" onClick={() => borrarNum(n.phone)}>QUITAR</button>
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
                    {tn && tn.tipo === 'desactivado' && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, border: '1px solid #e07b7b', color: '#e07b7b' }}>ADMINISTRATIVO</span>}
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid rgba(255,255,255,.08)', paddingBottom: 10, marginBottom: 10 }}>
                <div>
                  <b>{nombreDe(sel)}</b>
                  {sel.lead_id && (
                    <button className="btn-ghost" title="Editar nombre" style={{ padding: '0 6px', fontSize: 12 }} onClick={async () => {
                      const nuevo = prompt('Nombre del lead:', nombreDe(sel))
                      if (!nuevo || !nuevo.trim()) return
                      await supabase.from('leads').update({ full_name: nuevo.trim().toUpperCase() }).eq('id', sel.lead_id)
                      cargarConvs(); setSel(x => ({ ...x, leads: { ...(x.leads || {}), full_name: nuevo.trim().toUpperCase() } }))
                    }}>✎</button>
                  )}
                  <span className="muted"> · +{sel.phone}</span>
                  {sel.lead_id && (
                    <span className="muted small"> · LEAD:{' '}
                      <select value={sel.leads?.status || 'nuevo'} style={{ fontSize: 11, padding: '1px 4px' }} onChange={async e => {
                        const st = e.target.value
                        await supabase.from('leads').update({ status: st }).eq('id', sel.lead_id)
                        cargarConvs(); setSel(x => ({ ...x, leads: { ...(x.leads || {}), status: st } }))
                      }}>
                        {['nuevo', 'contactado', 'interesado', 'visita_agendada', 'negociacion', 'ganado', 'perdido'].map(o => <option key={o} value={o}>{o.toUpperCase()}</option>)}
                      </select>
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select value={tipoDe(sel.phone)?.tipo || 'bot'}
                    onChange={e => { const v = e.target.value; if (v === 'bot') { const n = tipoDe(sel.phone); if (n) borrarNum(n.phone) } else guardarNum(sel.phone, v, 'CLASIFICADO DESDE EL CHAT') }}>
                    <option value="bot">NUEVO LEAD (BOT)</option>
                    <option value="cliente">CLIENTE (COBRANZA)</option>
                    <option value="desactivado">ADMINISTRATIVO (SIN RESPUESTA)</option>
                    <option value="secretaria">SECRETARIA (SEGUIMIENTO)</option>
                  </select>
                  <a className="btn-ghost" href={`https://wa.me/${sel.phone}`} target="_blank" rel="noreferrer">Abrir en WhatsApp</a>
                </div>
              </div>
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
