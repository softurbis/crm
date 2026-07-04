import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const FLOW = {
  espera_nombre:   { t: 'ESPERANDO NOMBRE',  c: '#e0b34c' },
  espera_proyecto: { t: 'ELIGIENDO PROYECTO', c: '#7ec8e3' },
  completado:      { t: 'CALIFICADO',         c: '#7fbf7f' },
}
const fh = iso => iso ? new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

export default function Whatsapp() {
  const { role } = useAuth()
  const [convs, setConvs] = useState([])
  const [sel, setSel] = useState(null)
  const [msgs, setMsgs] = useState([])
  const [busca, setBusca] = useState('')
  const selRef = useRef(null)
  const endRef = useRef(null)

  const cargarConvs = async () => {
    const { data } = await supabase.from('whatsapp_conversations')
      .select('*, leads(full_name, lead_status), clients(full_name)')
      .order('last_message_at', { ascending: false, nullsFirst: false }).limit(300)
    setConvs(data || [])
  }

  const cargarMsgs = async c => {
    if (!c) return
    const [ins, outs] = await Promise.all([
      supabase.from('whatsapp_messages').select('body, created_at, direction, delivery_status').eq('conversation_id', c.id).limit(500),
      supabase.from('scheduled_messages').select('body, sent_at, scheduled_for, status, tipo').eq('recipient_phone', c.phone).in('status', ['enviado', 'fallido']).limit(500),
    ])
    const a = (ins.data || []).map(m => ({ body: m.body, at: m.created_at, dir: m.direction || 'in' }))
    const b = (outs.data || []).map(m => ({ body: m.body, at: m.sent_at || m.scheduled_for, dir: 'out', tipo: m.tipo, fallo: m.status === 'fallido' }))
    setMsgs([...a, ...b].filter(x => x.body).sort((x, y) => new Date(x.at) - new Date(y.at)))
  }

  useEffect(() => { cargarConvs() }, [])
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

  return (
    <div>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1>WhatsApp del bot</h1>
        <span className="muted small">Se actualiza solo cada 8 segundos</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 340px) 1fr', gap: 14, alignItems: 'start' }}>

        <div className="glass" style={{ padding: 10, maxHeight: '74vh', overflowY: 'auto' }}>
          <input placeholder="Buscar teléfono o nombre…" value={busca} onChange={e => setBusca(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }} />
          {lista.length === 0 && <p className="muted" style={{ padding: 8 }}>Aún no hay conversaciones. Cuando alguien le escriba al bot, aparecerá aquí.</p>}
          {lista.map(c => {
            const f = FLOW[c.flow_state]
            return (
              <div key={c.id} onClick={() => setSel(c)}
                style={{ padding: '10px 10px', borderRadius: 10, cursor: 'pointer', marginBottom: 4, background: sel?.id === c.id ? 'rgba(140,155,122,.18)' : 'transparent', border: '1px solid ' + (sel?.id === c.id ? 'rgba(140,155,122,.5)' : 'transparent') }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <b style={{ fontSize: 13 }}>{nombreDe(c)}</b>
                  <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fh(c.last_message_at)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginTop: 3 }}>
                  <span className="muted" style={{ fontSize: 12 }}>+{c.phone}</span>
                  {f && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, border: `1px solid ${f.c}`, color: f.c }}>{f.t}</span>}
                  {c.clients && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, border: '1px solid #b8a1d9', color: '#b8a1d9' }}>CLIENTE</span>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="glass" style={{ padding: 14, maxHeight: '74vh', display: 'flex', flexDirection: 'column' }}>
          {!sel && <p className="muted" style={{ padding: 20 }}>Elige una conversación de la lista para ver los mensajes.</p>}
          {sel && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid rgba(255,255,255,.08)', paddingBottom: 10, marginBottom: 10 }}>
                <div>
                  <b>{nombreDe(sel)}</b> <span className="muted">· +{sel.phone}</span>
                  {sel.leads?.lead_status && <span className="muted small"> · LEAD: {String(sel.leads.lead_status).toUpperCase()}</span>}
                </div>
                <a className="btn" href={`https://wa.me/${sel.phone}`} target="_blank" rel="noreferrer">Responder en WhatsApp</a>
              </div>
              <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 6 }}>
                {msgs.length === 0 && <p className="muted">Sin mensajes guardados todavía.</p>}
                {msgs.map((m, i) => (
                  <div key={i} style={{ alignSelf: m.dir === 'out' ? 'flex-end' : 'flex-start', maxWidth: '78%', background: m.dir === 'out' ? 'rgba(59,74,50,.9)' : 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.08)', borderRadius: m.dir === 'out' ? '12px 12px 2px 12px' : '12px 12px 12px 2px', padding: '8px 12px' }}>
                    <div style={{ whiteSpace: 'pre-wrap', textTransform: 'none', fontSize: 13, lineHeight: 1.45 }}>{m.body}</div>
                    <div className="muted" style={{ fontSize: 10, marginTop: 4, textAlign: 'right' }}>
                      {m.dir === 'out' ? (m.fallo ? '⚠️ FALLÓ · ' : '🤖 BOT · ') : ''}{m.tipo && m.dir === 'out' ? m.tipo.toUpperCase() + ' · ' : ''}{fh(m.at)}
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
