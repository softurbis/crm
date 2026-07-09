import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Perfiles que se pueden simular. El agente fuerza la clasificación del número
// (lead=bot de ventas, cliente=cobranza, secretaria/gerencia=seguimiento/Q&A).
const PERFILES = [
  { v: 'lead',       t: '🟢 Lead nuevo (ventas)',       d: 'Simula a alguien que escribe por primera vez: flujo de nombre → preguntas → calificado, con la IA de ventas.', c: '#9ccb86' },
  { v: 'cliente',    t: '💵 Cliente (cobranza)',         d: 'Simula a un cliente registrado (respuesta a “ya pagué”, avisos de cobranza).', c: '#b8a1d9' },
  { v: 'secretaria', t: '🗓️ Secretaria (seguimiento)',  d: 'Simula el control de actividades: LISTO, números, reprogramar. Necesita tareas asignadas para pasar lista.', c: '#7ec8e3' },
  { v: 'gerencia',   t: '👑 Gerencia (Q&A)',             d: 'Simula a gerencia: comandos gratis (lotes, comisiones, vencidas…) y preguntas libres con IA.', c: '#e7c15a' },
]
const fh = iso => iso ? new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : ''

export default function TestBot() {
  const { role } = useAuth()
  const [perfil, setPerfil] = useState('lead')
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [sesion, setSesion] = useState('')        // teléfono sintético de la sesión
  const [msgs, setMsgs] = useState([])
  const [echoes, setEchoes] = useState([])        // mensajes recién enviados (eco optimista)
  const [input, setInput] = useState('')
  const [pensando, setPensando] = useState(false)
  const sesionRef = useRef('')
  const endRef = useRef(null)

  useEffect(() => {
    supabase.from('projects').select('id, name').order('name').then(({ data }) => {
      setProjects(data || [])
      if (data && data.length && !projectId) setProjectId(data[0].id)
    })
  }, [])

  const nuevaSesion = () => {
    const ph = '9' + String(Date.now()).slice(-9)   // 10 dígitos, único por sesión
    setSesion(ph); sesionRef.current = ph
    setMsgs([]); setEchoes([]); setPensando(false)
  }

  const cargar = async () => {
    const ph = sesionRef.current
    if (!ph) return
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
    // limpiar ecos que ya llegaron como mensaje 'in'
    setEchoes(e => e.filter(x => !todos.some(m => m.dir === 'in' && m.body === x.body)))
    setPensando((pend.count || 0) > 0)
  }

  useEffect(() => {
    const t = setInterval(cargar, 2500)
    return () => clearInterval(t)
  }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs.length, echoes.length, pensando])

  const enviar = async () => {
    const text = input.trim()
    if (!text) return
    if (!sesion) { nuevaSesion(); await new Promise(r => setTimeout(r, 50)) }
    const ph = sesionRef.current
    setEchoes(e => [...e, { body: text, at: new Date().toISOString() }])
    setInput(''); setPensando(true)
    await supabase.from('bot_test_messages').insert({ session_phone: ph, profile: perfil, project_id: perfil === 'lead' || perfil === 'cliente' ? (projectId || null) : null, text })
  }

  const purgar = async () => {
    if (!confirm('¿Borrar TODOS los datos de prueba?\n\nElimina los leads, clientes y conversaciones marcados como PRUEBA (los reales no se tocan). El agente lo ejecuta en ~3 segundos.')) return
    await supabase.from('bot_test_messages').insert({ session_phone: '0', profile: 'purge', text: '' })
    setMsgs([]); setEchoes([]); setSesion(''); sesionRef.current = ''
    alert('🧹 Purga solicitada. Los datos de prueba se borran en unos segundos.')
  }

  if (!['admin', 'superuser'].includes(role)) return <div className="glass" style={{ padding: 24 }}>Solo administración puede usar la consola de pruebas.</div>

  const pClr = PERFILES.find(p => p.v === perfil)?.c || '#c58ae0'
  const chat = [...msgs, ...echoes.map(e => ({ ...e, dir: 'in', echo: true }))].sort((x, y) => new Date(x.at) - new Date(y.at))

  return (
    <div>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1>🧪 Probar Bot</h1>
        <button className="btn-ghost" onClick={purgar} title="Borra todos los leads/clientes/conversaciones marcados como prueba">🧹 BORRAR DATOS DE PRUEBA</button>
      </div>

      <p className="muted" style={{ fontSize: 13, marginTop: -4, marginBottom: 12 }}>
        Chat virtual para pulir el bot sin usar WhatsApp real. Elige un perfil, escribe como esa persona y ve cómo responde con tus cerebros y preguntas en vivo.
        Lo que genere queda marcado como <b style={{ color: pClr }}>PRUEBA</b> (color distinto en el Kanban) y se borra con el botón de arriba.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: 14, alignItems: 'start' }}>
        {/* Configuración */}
        <div className="glass" style={{ padding: 14 }}>
          <b style={{ fontSize: 13 }}>1 · Perfil a simular</b>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0 14px' }}>
            {PERFILES.map(p => (
              <button key={p.v} onClick={() => { setPerfil(p.v); nuevaSesion() }}
                style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', background: perfil === p.v ? p.c + '22' : 'transparent', border: '1px solid ' + (perfil === p.v ? p.c : 'rgba(255,255,255,.14)'), color: 'inherit' }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: perfil === p.v ? p.c : undefined }}>{p.t}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{p.d}</div>
              </button>
            ))}
          </div>

          {(perfil === 'lead' || perfil === 'cliente') && (
            <>
              <b style={{ fontSize: 13 }}>2 · Proyecto de contexto</b>
              <select value={projectId} onChange={e => { setProjectId(e.target.value); nuevaSesion() }} style={{ width: '100%', margin: '8px 0 14px' }}>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </>
          )}

          <button className="btn" style={{ width: '100%' }} onClick={nuevaSesion}>🔄 NUEVA CONVERSACIÓN</button>
          {sesion && <p className="muted" style={{ fontSize: 10, marginTop: 8 }}>Sesión de prueba: +{sesion}</p>}

          <p className="muted" style={{ fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>
            💡 Para <b>lead</b> escribe un “hola” y sigue el flujo. Para <b>gerencia</b> prueba <code>lotes</code>, <code>comisiones</code>, <code>vencidas</code> o una pregunta libre.
            Requiere el <b>agente desplegado</b> y los interruptores (VENTAS/COBRANZA/SEGUIMIENTO) encendidos, igual que en real.
          </p>
        </div>

        {/* Chat */}
        <div className="glass" style={{ padding: 14, maxHeight: '72vh', display: 'flex', flexDirection: 'column' }}>
          <div className="wa-head" style={{ borderBottom: '1px solid rgba(255,255,255,.08)', paddingBottom: 8, marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div className="wa-avatar" style={{ background: pClr }}>{perfil[0].toUpperCase()}</div>
              <div>
                <b style={{ fontSize: 15 }}>{PERFILES.find(p => p.v === perfil)?.t}</b>
                <div className="muted" style={{ fontSize: 11 }}>{sesion ? 'chat de prueba activo' : 'pulsa Nueva conversación o escribe para empezar'}</div>
              </div>
            </div>
          </div>

          <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 6 }}>
            {chat.length === 0 && <p className="muted" style={{ padding: 20 }}>Escribe abajo como {perfil === 'lead' ? 'un lead que recién escribe' : 'esa persona'} y observa la respuesta del bot.</p>}
            {chat.map((m, i) => (
              <div key={i} style={{ alignSelf: m.dir === 'out' ? 'flex-start' : 'flex-end', maxWidth: '80%', opacity: m.echo ? 0.55 : 1, background: m.dir === 'out' ? 'rgba(59,74,50,.9)' : 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.08)', borderRadius: m.dir === 'out' ? '12px 12px 12px 2px' : '12px 12px 2px 12px', padding: '8px 12px' }}>
                <div style={{ whiteSpace: 'pre-wrap', textTransform: 'none', fontSize: 13, lineHeight: 1.45 }}>{m.body}</div>
                <div className="muted" style={{ fontSize: 10, marginTop: 4, textAlign: 'right' }}>{m.dir === 'out' ? '🤖 BOT · ' : '🧑 TÚ · '}{m.echo ? 'enviando…' : fh(m.at)}</div>
              </div>
            ))}
            {pensando && <div style={{ alignSelf: 'flex-start', fontSize: 12, color: 'var(--muted)', padding: '4px 8px' }}>🤖 el bot está respondiendo…</div>}
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
