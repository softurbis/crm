import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const FLOW = {
  espera_nombre:   { t: 'ESPERANDO NOMBRE',  c: '#e0b34c' },
  espera_proyecto: { t: 'ELIGIENDO PROYECTO', c: '#7ec8e3' },
  completado:      { t: 'CALIFICADO',         c: '#7fbf7f' },
}
const TIPOS = [
  { v: 'desactivado', t: 'ADMINISTRATIVO (el bot nunca responde)', c: '#e07b7b' },
  { v: 'bot',         t: 'BOT (flujo de leads)',                c: '#8C9B7A' },
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
  const [flags, setFlags] = useState({ bot_activo: true, cobranza_activa: true })
  const [verNums, setVerNums] = useState(false)
  const [nums, setNums] = useState([])
  const [nvo, setNvo] = useState({ phone: '', tipo: 'desactivado', note: '' })
  const selRef = useRef(null)
  const endRef = useRef(null)

  const cargarFlags = async () => {
    const { data } = await supabase.from('bot_settings').select('key, value')
    if (data) {
      const f = { ...flags }
      data.forEach(r => { f[r.key] = r.value !== '0' })
      setFlags(f)
    }
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

  const cargarConvs = async () => {
    const { data } = await supabase.from('whatsapp_conversations')
      .select('*, leads(full_name, status), clients(full_name)')
      .order('last_message_at', { ascending: false, nullsFirst: false }).limit(300)
    setConvs(data || [])
  }
  const cargarMsgs = async c => {
    if (!c) return
    const [ins, outs] = await Promise.all([
      supabase.from('whatsapp_messages').select('body, created_at, direction').eq('conversation_id', c.id).limit(500),
      supabase.from('scheduled_messages').select('body, sent_at, scheduled_for, status, tipo').eq('recipient_phone', c.phone).in('status', ['enviado', 'fallido', 'pendiente']).limit(500),
    ])
    const a = (ins.data || []).map(m => ({ body: m.body, at: m.created_at, dir: m.direction || 'in' }))
    const b = (outs.data || []).map(m => ({ body: m.body, at: m.sent_at || m.scheduled_for, dir: 'out', tipo: m.tipo, fallo: m.status === 'fallido', pend: m.status === 'pendiente' }))
    setMsgs([...a, ...b].filter(x => x.body).sort((x, y) => new Date(x.at) - new Date(y.at)))
  }

  useEffect(() => { cargarConvs(); cargarFlags(); cargarNums() }, [])
  useEffect(() => { selRef.current = sel; cargarMsgs(sel) }, [sel])
  useEffect(() => {
    const t = setInterval(() => { cargarConvs(); if (selRef.current) cargarMsgs(selRef.current) }, 8000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs.length])

  if (!['admin', 'superuser'].includes(role)) return <div className="glass" style={{ padding: 24 }}>Solo administración puede ver las conversaciones del bot.</div>

  const lista = convs.filter(c => {
    if (!busca) return true
    const q = busca.toLowerCase()
    return (c.phone || '').includes(q) || (c.leads?.full_name || '').toLowerCase().includes(q) || (c.clients?.full_name || '').toLowerCase().includes(q)
  })
  const nombreDe = c => c.clients?.full_name || c.leads?.full_name || 'SIN NOMBRE'
  const tipoDe = phone => nums.find(n => phone && (phone.endsWith(n.phone.slice(-9)) || n.phone.endsWith(String(phone).slice(-9))))
  const Toggle = ({ on, onClick, labelOn, labelOff }) => (
    <button className="btn-ghost" onClick={onClick}
      style={{ borderColor: on ? 'rgba(127,191,127,.6)' : 'rgba(224,123,123,.7)', color: on ? '#7fbf7f' : '#e07b7b', fontWeight: 700 }}>
      {on ? labelOn : labelOff}
    </button>
  )

  return (
    <div>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1>WhatsApp del bot</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Toggle on={flags.bot_activo} onClick={() => setFlag('bot_activo', !flags.bot_activo)} labelOn="🤖 BOT: ACTIVO" labelOff="🤖 BOT: APAGADO" />
          <Toggle on={flags.cobranza_activa} onClick={() => setFlag('cobranza_activa', !flags.cobranza_activa)} labelOn="💵 COBRANZA: ACTIVA" labelOff="💵 COBRANZA: APAGADA" />
          <button className="btn-ghost" onClick={() => setVerNums(!verNums)}>📇 NÚMEROS ({nums.length})</button>
        </div>
      </div>

      {!flags.bot_activo && <div className="glass" style={{ padding: '8px 14px', marginBottom: 10, border: '1px solid rgba(224,123,123,.6)', color: '#e07b7b' }}>⚠️ BOT APAGADO: no responde a nadie ni envía cobranzas. Vuelve a activarlo cuando quieras.</div>}
      {flags.bot_activo && !flags.cobranza_activa && <div className="glass" style={{ padding: '8px 14px', marginBottom: 10, border: '1px solid rgba(224,179,76,.5)', color: '#e0b34c' }}>La cobranza automática está APAGADA. El filtro de leads sigue funcionando.</div>}

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

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 340px) 1fr', gap: 14, alignItems: 'start' }}>
        <div className="glass" style={{ padding: 10, maxHeight: '70vh', overflowY: 'auto' }}>
          <input placeholder="Buscar teléfono o nombre…" value={busca} onChange={e => setBusca(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          {lista.length === 0 && <p className="muted" style={{ padding: 8 }}>Aún no hay conversaciones. Cuando alguien le escriba al bot, aparecerá aquí.</p>}
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

        <div className="glass" style={{ padding: 14, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
          {!sel && <p className="muted" style={{ padding: 20 }}>Elige una conversación de la lista para ver los mensajes.</p>}
          {sel && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid rgba(255,255,255,.08)', paddingBottom: 10, marginBottom: 10 }}>
                <div>
                  <b>{nombreDe(sel)}</b> <span className="muted">· +{sel.phone}</span>
                  {sel.leads?.status && <span className="muted small"> · LEAD: {String(sel.leads.status).toUpperCase()}</span>}
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
                  <div key={i} style={{ alignSelf: m.dir === 'out' ? 'flex-end' : 'flex-start', maxWidth: '78%', background: m.dir === 'out' ? 'rgba(59,74,50,.9)' : 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.08)', borderRadius: m.dir === 'out' ? '12px 12px 2px 12px' : '12px 12px 12px 2px', padding: '8px 12px' }}>
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
