import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Perfiles que se pueden simular. El agente fuerza la clasificación del número.
const PERFILES = [
  { v: 'lead',       t: '🟢 Lead nuevo (ventas)',      d: 'Escribe por primera vez: nombre → preguntas cerradas → calificado. Verás también el aviso al admin.', c: '#9ccb86' },
  { v: 'cliente',    t: '💵 Cliente (cobranza)',        d: 'Emula a un cliente REAL: su cobranza según su deuda y su respuesta a “ya pagué”.', c: '#b8a1d9' },
  { v: 'secretaria', t: '🗓️ Secretaria (seguimiento)', d: 'Emula a una secretaria REAL: pase de lista con sus tareas de hoy y sus respuestas.', c: '#7ec8e3' },
  { v: 'gerencia',   t: '👑 Gerencia (Q&A)',            d: 'Comandos (lotes, comisiones, vencidas…) y preguntas libres con IA.', c: '#e7c15a' },
]
const fh = iso => iso ? new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : ''
const nuevoPhone = () => '9' + String(Date.now()).slice(-9)   // sintético para lead/gerencia

export default function TestBot() {
  const { role } = useAuth()
  const [perfil, setPerfil] = useState('lead')
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [clientes, setClientes] = useState([])
  const [clienteId, setClienteId] = useState('')
  const [secs, setSecs] = useState([])
  const [secId, setSecId] = useState('')
  const [sesion, setSesion] = useState(nuevoPhone())   // sesión sintética para lead/gerencia
  const [msgs, setMsgs] = useState([])
  const [echoes, setEchoes] = useState([])
  const [input, setInput] = useState('')
  const [pensando, setPensando] = useState(false)
  const [pendDesde, setPendDesde] = useState(0)
  const phoneRef = useRef('')
  const endRef = useRef(null)

  const cliente = clientes.find(c => c.id === clienteId)
  const sec = secs.find(s => s.id === secId)
  // teléfono activo según el perfil: sintético para lead/gerencia, REAL para cliente/secretaria
  const activePhone = perfil === 'cliente' ? (cliente?.phone || '').replace(/\D/g, '')
    : perfil === 'secretaria' ? (sec?.phone || '').replace(/\D/g, '')
    : sesion
  const emulateId = perfil === 'cliente' ? clienteId : perfil === 'secretaria' ? secId : null
  useEffect(() => { phoneRef.current = activePhone }, [activePhone])

  useEffect(() => {
    supabase.from('projects').select('id, name').order('name').then(({ data }) => { setProjects(data || []); if (data?.length) setProjectId(p => p || data[0].id) })
    supabase.from('clients').select('id, full_name, phone').order('full_name').then(({ data }) => setClientes((data || []).filter(c => (c.phone || '').replace(/\D/g, '').length >= 9)))
    supabase.from('secretaries').select('id, full_name, phone').eq('active', true).order('full_name').then(({ data }) => setSecs((data || []).filter(s => (s.phone || '').replace(/\D/g, '').length >= 9)))
  }, [])

  const nuevaConversacion = () => {
    if (perfil === 'lead' || perfil === 'gerencia') { const p = nuevoPhone(); setSesion(p); phoneRef.current = p }
    setMsgs([]); setEchoes([]); setPensando(false); setPendDesde(0)
  }

  const cargar = async () => {
    const ph = phoneRef.current
    if (!ph || ph.length < 9) { setMsgs([]); return }
    const { data: conv } = await supabase.from('whatsapp_conversations').select('id').eq('phone', ph).maybeSingle()
    const [ins, outs, pend] = await Promise.all([
      conv ? supabase.from('whatsapp_messages').select('body, created_at, direction').eq('conversation_id', conv.id).limit(400) : Promise.resolve({ data: [] }),
      supabase.from('scheduled_messages').select('body, sent_at, scheduled_for, tipo').eq('recipient_phone', ph).limit(400),
      supabase.from('bot_test_messages').select('id', { count: 'exact', head: true }).eq('session_phone', ph).eq('status', 'pendiente'),
    ])
    const a = (ins.data || []).map(m => ({ body: m.body, at: m.created_at, dir: m.direction === 'out' ? 'out' : 'in' }))
    const b = (outs.data || []).map(m => ({ body: m.body, at: m.sent_at || m.scheduled_for, dir: 'out', tipo: m.tipo }))
    const todos = [...a, ...b].filter(x => x.body).sort((x, y) => new Date(x.at) - new Date(y.at))
    setMsgs(todos)
    setEchoes(e => e.filter(x => !todos.some(m => m.dir === 'in' && m.body === x.body)))
    setPensando((pend.count || 0) > 0)
  }

  useEffect(() => { cargar() }, [activePhone])
  useEffect(() => { const t = setInterval(cargar, 2500); return () => clearInterval(t) }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs.length, echoes.length, pensando])

  const encolar = async (extra, echo) => {
    const ph = phoneRef.current
    if (!ph || ph.length < 9) { alert('Elige primero un ' + (perfil === 'cliente' ? 'cliente' : 'secretaria') + ' para emular.'); return }
    if (echo) setEchoes(e => [...e, { body: echo, at: new Date().toISOString() }])
    setPensando(true); setPendDesde(Date.now())
    await supabase.from('bot_test_messages').insert({ session_phone: ph, profile: perfil, project_id: perfil === 'lead' ? (projectId || null) : null, emulate_id: emulateId || null, text: '', ...extra })
  }
  const enviar = async () => { const text = input.trim(); if (!text) return; setInput(''); await encolar({ profile: perfil, text }, text) }
  const simularCobranza = () => encolar({ profile: 'cobranza_now', emulate_id: clienteId }, null)
  const pasarLista = () => encolar({ profile: 'pasar_lista_now', emulate_id: secId }, null)

  const purgar = async () => {
    if (!confirm('¿Borrar TODOS los datos de prueba (leads/conversaciones marcados como PRUEBA)?\n\nNo toca clientes ni secretarias reales. El agente lo ejecuta en ~3 s.')) return
    await supabase.from('bot_test_messages').insert({ session_phone: '0', profile: 'purge', text: '' })
    nuevaConversacion()
    alert('🧹 Purga solicitada.')
  }

  if (!['admin', 'superuser'].includes(role)) return <div className="glass" style={{ padding: 24 }}>Solo administración puede usar la consola de pruebas.</div>

  const pClr = PERFILES.find(p => p.v === perfil)?.c || '#c58ae0'
  const chat = [...msgs, ...echoes.map(e => ({ ...e, dir: 'in', echo: true }))].sort((x, y) => new Date(x.at) - new Date(y.at))
  const agenteMudo = pensando && pendDesde && (Date.now() - pendDesde > 12000)

  return (
    <div>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1>🧪 Probar Bot</h1>
        <button className="btn-ghost" onClick={purgar} title="Borra los leads/conversaciones marcados como prueba">🧹 BORRAR DATOS DE PRUEBA</button>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: -4, marginBottom: 12 }}>
        Chat virtual para pulir el bot sin usar WhatsApp real. El chat se conserva al cambiar de perfil; solo se limpia con <b>Nueva conversación</b> o <b>Borrar</b>.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(270px, 350px) 1fr', gap: 14, alignItems: 'start' }}>
        {/* Configuración */}
        <div className="glass" style={{ padding: 14 }}>
          <b style={{ fontSize: 13 }}>1 · Perfil a simular</b>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0 14px' }}>
            {PERFILES.map(p => (
              <button key={p.v} onClick={() => setPerfil(p.v)}
                style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', background: perfil === p.v ? p.c + '22' : 'transparent', border: '1px solid ' + (perfil === p.v ? p.c : 'rgba(255,255,255,.14)'), color: 'inherit' }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: perfil === p.v ? p.c : undefined }}>{p.t}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{p.d}</div>
              </button>
            ))}
          </div>

          {perfil === 'lead' && (<>
            <b style={{ fontSize: 13 }}>2 · Proyecto de contexto</b>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} style={{ width: '100%', margin: '8px 0 14px' }}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </>)}

          {perfil === 'cliente' && (<>
            <b style={{ fontSize: 13 }}>2 · Cliente a emular</b>
            <select value={clienteId} onChange={e => setClienteId(e.target.value)} style={{ width: '100%', margin: '8px 0 8px' }}>
              <option value="">— elige un cliente —</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
            <button className="btn" style={{ width: '100%', marginBottom: 14 }} disabled={!clienteId} onClick={simularCobranza}>▶️ SIMULAR ENVÍO DE COBRANZA</button>
          </>)}

          {perfil === 'secretaria' && (<>
            <b style={{ fontSize: 13 }}>2 · Secretaria a emular</b>
            <select value={secId} onChange={e => setSecId(e.target.value)} style={{ width: '100%', margin: '8px 0 8px' }}>
              <option value="">— elige una secretaria —</option>
              {secs.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            <button className="btn" style={{ width: '100%', marginBottom: 14 }} disabled={!secId} onClick={pasarLista}>▶️ PASAR LISTA AHORA</button>
          </>)}

          <button className="btn-ghost" style={{ width: '100%' }} onClick={nuevaConversacion}>🔄 NUEVA CONVERSACIÓN</button>
          {activePhone && activePhone.length >= 9 && <p className="muted" style={{ fontSize: 10, marginTop: 8 }}>Sesión: +{activePhone}{(perfil === 'cliente' || perfil === 'secretaria') ? ' (real)' : ' (prueba)'}</p>}
          <p className="muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
            Requiere el <b>agente desplegado</b> y los interruptores encendidos (VENTAS/COBRANZA/SEGUIMIENTO), igual que en real.
          </p>
        </div>

        {/* Chat */}
        <div className="glass" style={{ padding: 14, maxHeight: '72vh', display: 'flex', flexDirection: 'column' }}>
          <div className="wa-head" style={{ borderBottom: '1px solid rgba(255,255,255,.08)', paddingBottom: 8, marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div className="wa-avatar" style={{ background: pClr }}>{perfil[0].toUpperCase()}</div>
              <div>
                <b style={{ fontSize: 15 }}>{PERFILES.find(p => p.v === perfil)?.t}</b>
                <div className="muted" style={{ fontSize: 11 }}>{perfil === 'cliente' && cliente ? cliente.full_name : perfil === 'secretaria' && sec ? sec.full_name : 'chat de prueba'}</div>
              </div>
            </div>
          </div>

          {agenteMudo && <div className="glass" style={{ padding: '6px 12px', marginBottom: 8, border: '1px solid rgba(224,179,76,.6)', color: '#e0b34c', fontSize: 12 }}>⏳ El agente no respondió. Verifica que esté <b>desplegado</b> (pm2) y con los interruptores encendidos.</div>}

          <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 6 }}>
            {chat.length === 0 && <p className="muted" style={{ padding: 20 }}>{(perfil === 'cliente' && !clienteId) || (perfil === 'secretaria' && !secId) ? 'Elige a quién emular en el panel de la izquierda.' : 'Escribe abajo y observa la respuesta del bot.'}</p>}
            {chat.map((m, i) => (
              <div key={i} style={{ alignSelf: m.dir === 'out' ? 'flex-start' : 'flex-end', maxWidth: '80%', opacity: m.echo ? 0.55 : 1, background: m.dir === 'out' ? 'rgba(59,74,50,.9)' : 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.08)', borderRadius: m.dir === 'out' ? '12px 12px 12px 2px' : '12px 12px 2px 12px', padding: '8px 12px' }}>
                <div style={{ whiteSpace: 'pre-wrap', textTransform: 'none', fontSize: 13, lineHeight: 1.45 }}>{m.body}</div>
                <div className="muted" style={{ fontSize: 10, marginTop: 4, textAlign: 'right' }}>{m.dir === 'out' ? '🤖 BOT · ' : '🧑 TÚ · '}{m.echo ? 'enviando…' : fh(m.at)}</div>
              </div>
            ))}
            {pensando && !agenteMudo && <div style={{ alignSelf: 'flex-start', fontSize: 12, color: 'var(--muted)', padding: '4px 8px' }}>🤖 el bot está respondiendo…</div>}
            <div ref={endRef} />
          </div>

          <div className="wa-reply" style={{ marginTop: 8 }}>
            <input value={input} onChange={e => setInput(e.target.value)} placeholder={`Escribe como ${perfil}…`} style={{ textTransform: 'none' }}
              onKeyDown={e => { if (e.key === 'Enter') enviar() }} />
            <button className="wa-btn wa-solid" onClick={enviar}>➤ ENVIAR</button>
          </div>
        </div>
      </div>
    </div>
  )
}
