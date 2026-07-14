import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Panel del Agente de Marketing. El "cerebro" (instrucciones + fichas) vive en Supabase,
// editable por el superusuario; el worker Python del droplet responde el chat.
export default function Marketing() {
  const { role } = useAuth()
  const esSuper = role === 'superuser'
  const [tab, setTab] = useState('chat')          // 'chat' | 'config'

  // ---- estado del chat ----
  const [proyectos, setProyectos] = useState([])
  const [sigla, setSigla] = useState('')
  const [convId, setConvId] = useState(null)
  const [msgs, setMsgs] = useState([])
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  const finRef = useRef(null)

  useEffect(() => {
    supabase.from('mkt_proyectos').select('sigla, nombre, activo, orden').order('orden')
      .then(({ data }) => setProyectos((data || []).filter(p => p.activo !== false)))
  }, [])

  // polling de los mensajes de la conversación activa
  useEffect(() => {
    if (!convId) { setMsgs([]); setPensando(false); return }
    let stop = false
    const cargar = () => supabase.from('mkt_mensajes').select('*')
      .eq('conversacion_id', convId).order('created_at')
      .then(({ data }) => {
        if (stop) return
        const arr = data || []
        setMsgs(arr)
        setPensando(arr.some(m => m.role === 'user' && m.estado === 'pendiente'))
      })
    cargar()
    const t = setInterval(cargar, 2500)
    return () => { stop = true; clearInterval(t) }
  }, [convId])

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, pensando])

  const proyNombre = proyectos.find(p => p.sigla === sigla)?.nombre

  const nuevaConv = () => { setConvId(null); setMsgs([]); setPensando(false) }

  const asegurarConv = async () => {
    if (convId) return convId
    const { data, error } = await supabase.from('mkt_conversaciones')
      .insert({ sigla: sigla || null }).select('id').single()
    if (error) { alert('No pude crear la conversación: ' + error.message); return null }
    setConvId(data.id)
    return data.id
  }

  const enviar = async (contenido, meta = null) => {
    const t = (contenido ?? texto).trim()
    if (!t) return
    if (!sigla) { alert('Elige primero un proyecto arriba (para no mezclar).'); return }
    const cid = await asegurarConv()
    if (!cid) return
    setTexto('')
    const { error } = await supabase.from('mkt_mensajes')
      .insert({ conversacion_id: cid, role: 'user', content: t, estado: 'pendiente', meta })
    if (error) { alert('No se envió: ' + error.message); return }
    setPensando(true)
  }

  const cmdParrilla = async () => {
    const mes = window.prompt('¿De qué mes armamos la parrilla? (ej: julio)')
    if (!mes) return
    await enviar(`Parrilla de ${mes} para ${proyNombre || sigla}`, { comando: 'parrilla', mes })
  }
  const cmdPrompt = () => enviar('Dame el prompt de imagen (para pegar en GPT) de la última pieza.', { comando: 'prompt' })
  const onKey = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }
  const copiar = txt => { navigator.clipboard?.writeText(txt || '').then(() => {}, () => {}) }

  return (
    <div className="page">
      <div className="page-head" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>🎨 Agente de Marketing</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className={tab === 'chat' ? 'btn' : 'btn-ghost'} onClick={() => setTab('chat')}>💬 Chat</button>
          {esSuper && <button className={tab === 'config' ? 'btn' : 'btn-ghost'} onClick={() => setTab('config')}>⚙️ Configuración</button>}
        </div>
      </div>

      {tab === 'chat' && (
        <div className="glass" style={{ padding: 14, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 150px)' }}>
          {/* nota de estado / pendientes del panel */}
          <details style={{ marginBottom: 10, fontSize: 12.5, background: 'rgba(232,193,90,.08)', border: '1px solid rgba(232,193,90,.35)', borderRadius: 8, padding: '8px 12px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#e8c15a' }}>ℹ️ Estado y pendientes de este panel</summary>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
              <li><b>El chat responde solo cuando el “motor” (worker) esté conectado en el servidor.</b> Si escribes y no contesta, es que aún falta prenderlo en el droplet.</li>
              <li>La pestaña <b>Configuración</b> ya funciona: se llena sola la primera vez que el worker arranca (sube tus instrucciones y fichas actuales). También puedes editarla a mano.</li>
              <li><b>Fase 1 (actual):</b> chat de texto + parrilla + prompt para GPT.</li>
              <li><b>Fase 2 (pendiente):</b> descargar la parrilla en Excel y el documento por semana en Word.</li>
              <li><b>Fase 3 (pendiente):</b> generar las imágenes con IA (gpt-image-1), con confirmación de costo.</li>
              <li><b>Candado anti-cruce:</b> elige el proyecto arriba antes de pedir nada; el agente queda bloqueado a ese proyecto.</li>
            </ul>
          </details>
          {/* selector de proyecto (candado) */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,.1)' }}>
            <span style={{ fontSize: 13 }}>🔒 Proyecto activo:</span>
            <select value={sigla} onChange={e => { setSigla(e.target.value); nuevaConv() }} style={{ fontSize: 13, minWidth: 220 }}>
              <option value="">— elige un proyecto —</option>
              {proyectos.map(p => <option key={p.sigla} value={p.sigla}>{p.sigla} · {p.nombre}</option>)}
            </select>
            {!sigla && <span className="muted" style={{ fontSize: 12, color: '#e7c15a' }}>Elige uno para que no se crucen los datos.</span>}
            <span style={{ marginLeft: 'auto' }} />
            <button className="btn-ghost" onClick={cmdParrilla} disabled={!sigla} title="Arma la parrilla del mes">🗓️ Parrilla</button>
            <button className="btn-ghost" onClick={cmdPrompt} disabled={!sigla || !msgs.length} title="Extrae el prompt de imagen de la última pieza">🖼️ Prompt para GPT</button>
            <button className="btn-ghost" onClick={nuevaConv} title="Empezar de cero">✚ Nueva</button>
          </div>

          {/* chat */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 4px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!msgs.length && (
              <div className="muted" style={{ fontSize: 13, textAlign: 'center', margin: 'auto', maxWidth: 460 }}>
                {sigla
                  ? `Listo para trabajar *${proyNombre}*. Pídeme una pieza (ej. "diséñame un flyer de precios") o usa los botones de arriba.`
                  : 'Elige un proyecto arriba y pídeme lo que necesites: parrilla, un post, un guion o un copy.'}
              </div>
            )}
            {msgs.map(m => {
              const mine = m.role === 'user'
              const info = m.role === 'info'
              return (
                <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                  <div style={{
                    padding: '10px 13px', borderRadius: 12, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                    background: mine ? 'var(--accent-strong, #4a7)' : info ? 'rgba(232,193,90,.14)' : 'rgba(255,255,255,.06)',
                    border: info ? '1px solid rgba(232,193,90,.4)' : '1px solid rgba(255,255,255,.08)',
                    fontFamily: (info && m.meta?.tipo === 'prompt') ? 'monospace' : undefined,
                  }}>
                    {!mine && <div style={{ fontSize: 10, fontWeight: 700, opacity: .6, marginBottom: 4, textTransform: 'uppercase' }}>{info ? (m.meta?.tipo === 'prompt' ? '🖼️ Prompt de imagen' : 'Sistema') : 'Agente'}</div>}
                    {m.content}
                    {m.meta?.aviso_cruce && <div style={{ marginTop: 6, fontSize: 12, color: '#f0a0a0' }}>⚠️ {m.meta.aviso_cruce}</div>}
                  </div>
                  {!mine && (
                    <button className="btn-ghost" style={{ fontSize: 11, marginTop: 3 }} onClick={() => copiar(m.content)}>⧉ Copiar</button>
                  )}
                </div>
              )
            })}
            {pensando && <div className="muted" style={{ fontSize: 13, fontStyle: 'italic' }}>El agente está pensando…</div>}
            <div ref={finRef} />
          </div>

          {/* entrada */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', paddingTop: 10, borderTop: '1px solid rgba(255,255,255,.1)' }}>
            <textarea value={texto} onChange={e => setTexto(e.target.value)} onKeyDown={onKey}
              placeholder={sigla ? 'Escribe tu pedido… (ej: diséñame un flyer de precios)' : 'Elige un proyecto arriba para empezar'}
              disabled={!sigla} rows={1}
              style={{ flex: 1, resize: 'none', minHeight: 42, maxHeight: 140, textTransform: 'none', fontSize: 14 }} />
            <button className="btn" onClick={() => enviar()} disabled={!sigla || pensando}>Enviar ▸</button>
          </div>
        </div>
      )}

      {tab === 'config' && esSuper && <ConfigCerebro proyectos={proyectos} />}
    </div>
  )
}

// -------- Configuración del cerebro (solo superusuario): instrucciones maestras + ficha por proyecto --------
function ConfigCerebro({ proyectos }) {
  const [sel, setSel] = useState('instrucciones')   // 'instrucciones' | sigla
  const [texto, setTexto] = useState('')
  const [cargando, setCargando] = useState(false)
  const [msg, setMsg] = useState('')

  const cargar = async (clave) => {
    setCargando(true); setMsg('')
    if (clave === 'instrucciones') {
      const { data } = await supabase.from('mkt_brains').select('content').eq('key', 'instrucciones').maybeSingle()
      setTexto(data?.content || '')
    } else {
      const { data } = await supabase.from('mkt_proyectos').select('ficha').eq('sigla', clave).maybeSingle()
      setTexto(data?.ficha || '')
    }
    setCargando(false)
  }

  useEffect(() => { cargar(sel) }, [sel])

  const guardar = async () => {
    setMsg('Guardando…')
    let error
    if (sel === 'instrucciones') {
      ({ error } = await supabase.from('mkt_brains').update({ content: texto, updated_at: new Date().toISOString() }).eq('key', 'instrucciones'))
    } else {
      ({ error } = await supabase.from('mkt_proyectos').update({ ficha: texto, updated_at: new Date().toISOString() }).eq('sigla', sel))
    }
    setMsg(error ? 'ERROR: ' + error.message : '✅ Guardado — el agente lo usa en ≤1 min')
  }

  return (
    <div className="glass" style={{ padding: 14 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Edita el <b>cerebro</b> del agente. Se guarda en la base y el worker lo toma en menos de 1 minuto, sin reiniciar nada.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <label style={{ fontSize: 13 }}>Editando:</label>
        <select value={sel} onChange={e => setSel(e.target.value)} style={{ fontSize: 13, minWidth: 260 }}>
          <option value="instrucciones">🧠 Instrucciones maestras (cerebro general)</option>
          {proyectos.map(p => <option key={p.sigla} value={p.sigla}>📄 Ficha · {p.sigla} · {p.nombre}</option>)}
        </select>
        <span style={{ marginLeft: 'auto' }} />
        <button className="btn" onClick={guardar} disabled={cargando}>💾 Guardar</button>
        {msg && <span style={{ fontSize: 12 }}>{msg}</span>}
      </div>
      <textarea value={texto} onChange={e => setTexto(e.target.value)} disabled={cargando}
        placeholder={cargando ? 'Cargando…' : 'Contenido…'}
        style={{ width: '100%', minHeight: 'calc(100vh - 280px)', textTransform: 'none', fontSize: 13, fontFamily: 'monospace', lineHeight: 1.5 }} />
    </div>
  )
}
