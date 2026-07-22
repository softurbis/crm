import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Panel del Agente de Marketing. El "cerebro" (instrucciones + fichas) vive en Supabase,
// editable por el superusuario; el worker Python del droplet responde el chat.
export default function Marketing() {
  const { role } = useAuth()
  const esSuper = role === 'superuser'
  const puedeMotor = role === 'superuser' || role === 'admin'   // ven el estado del motor (RLS lo permite)
  const [sp] = useSearchParams()
  const tParam = sp.get('t')                       // desde el menú lateral: chat | produccion | config
  const [tab, setTab] = useState(tParam === 'produccion' ? 'motor' : tParam === 'config' ? 'config' : 'chat')  // 'chat' | 'config' | 'motor'
  // si el menú cambia ?t= estando ya en la página, sincroniza la pestaña
  useEffect(() => {
    if (tParam === 'produccion') setTab('motor')
    else if (tParam === 'config') setTab('config')
    else if (tParam === 'chat') setTab('chat')
  }, [tParam])

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
          {puedeMotor && <button className={tab === 'motor' ? 'btn' : 'btn-ghost'} onClick={() => setTab('motor')}>🏭 Producción</button>}
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

      {tab === 'motor' && puedeMotor && <ProduccionMotor />}

      {tab === 'config' && esSuper && <ConfigPanel />}
    </div>
  )
}

// ============================================================================
// Configuración del agente y proyectos (solo superusuario).
// General: encender/apagar, modelos, tope de gasto, instrucciones maestras.
// Por proyecto: nombre, activo, autonomía, WhatsApp, público, tono, color, ficha.
// Todo se guarda en Supabase; el motor lo usa cuando esté encendido (Proceso B).
// ============================================================================
const AUTONOMIAS = [
  { v: 'manual', t: '🔴 Manual — el agente propone, tú apruebas todo' },
  { v: 'semi',   t: '🟡 Semiautomático — avanza en pasos seguros, tú apruebas lo importante' },
  { v: 'auto',   t: '🟢 Automático — trabaja solo (siempre con filtro humano antes de publicar)' },
]
const _lbl = { display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 2 }
function Ayuda({ children }) {
  return <p className="muted" style={{ fontSize: 11.5, margin: '2px 0 8px', lineHeight: 1.5 }}>{children}</p>
}

function ConfigPanel() {
  const [proys, setProys] = useState([])
  const [cfg, setCfg] = useState({})
  const [inst, setInst] = useState('')
  const [sel, setSel] = useState('general')   // 'general' | sigla
  const [proy, setProy] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [msg, setMsg] = useState('')

  const cargarBase = async () => {
    const [p, c] = await Promise.all([
      supabase.from('mkt_proyectos').select('*').order('orden'),
      supabase.from('mkt_config').select('*'),
    ])
    setProys(p.data || [])
    const o = {}; (c.data || []).forEach(r => { o[r.key] = r.value })
    setCfg(o)
    setCargando(false)
  }
  useEffect(() => { cargarBase() }, [])

  useEffect(() => {
    setMsg('')
    if (sel === 'general') {
      setProy(null)
      supabase.from('mkt_brains').select('content').eq('key', 'instrucciones').maybeSingle()
        .then(({ data }) => setInst(data?.content || ''))
    } else {
      const p = proys.find(x => x.sigla === sel)
      setProy(p ? { ...p } : null)
    }
  }, [sel, proys])

  const setC = (k, v) => setCfg(o => ({ ...o, [k]: v }))
  const setP = (k, v) => setProy(o => ({ ...o, [k]: v }))

  const guardarGeneral = async () => {
    setMsg('Guardando…')
    const rows = ['agente_activo', 'modelo_texto', 'modelo_imagen', 'tope_gasto_usd']
      .map(k => ({ key: k, value: String(cfg[k] ?? ''), updated_at: new Date().toISOString() }))
    const { error: e1 } = await supabase.from('mkt_config').upsert(rows)
    const { error: e2 } = await supabase.from('mkt_brains')
      .update({ content: inst, updated_at: new Date().toISOString() }).eq('key', 'instrucciones')
    setMsg((e1 || e2) ? 'ERROR: ' + (e1 || e2).message : '✅ Guardado')
  }

  const guardarProy = async () => {
    setMsg('Guardando…')
    const { sigla, nombre, activo, autonomia, whatsapp, publico, tono, color, ficha } = proy
    const { error } = await supabase.from('mkt_proyectos').update({
      nombre, activo, autonomia, whatsapp, publico, tono, color, ficha,
      updated_at: new Date().toISOString(),
    }).eq('sigla', sigla)
    if (!error) await cargarBase()
    setMsg(error ? 'ERROR: ' + error.message : '✅ Guardado — el agente lo usará cuando esté encendido')
  }

  if (cargando) return <div className="glass muted" style={{ padding: 14 }}>Cargando configuración…</div>

  return (
    <div className="glass" style={{ padding: 14 }}>
      <details style={{ marginBottom: 12, fontSize: 12.5, background: 'rgba(232,193,90,.08)', border: '1px solid rgba(232,193,90,.35)', borderRadius: 8, padding: '8px 12px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#e8c15a' }}>ℹ️ Cómo funciona esta configuración</summary>
        <p style={{ margin: '8px 0 0', lineHeight: 1.6 }}>
          Todo lo que cambies aquí se guarda al instante en la base. El agente lo usa <b>cuando esté encendido</b> (el motor de producción, que se activa con el crédito de OpenAI). Elige arriba si configuras el <b>agente en general</b> o un <b>proyecto</b> específico.
        </p>
      </details>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,.1)' }}>
        <label style={{ fontSize: 13 }}>Configurando:</label>
        <select value={sel} onChange={e => setSel(e.target.value)} style={{ fontSize: 13, minWidth: 280 }}>
          <option value="general">⚙️ Agente (general)</option>
          {proys.map(p => <option key={p.sigla} value={p.sigla}>📁 {p.sigla} · {p.nombre}</option>)}
        </select>
        <span style={{ marginLeft: 'auto' }} />
        {msg && <span style={{ fontSize: 12 }}>{msg}</span>}
      </div>

      {sel === 'general' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={_lbl}>Estado del agente</label>
            <Ayuda>Interruptor general. Si lo apagas, el agente no produce en ningún proyecto — útil para pausar todo sin tocar el servidor.</Ayuda>
            <select value={cfg.agente_activo ?? 'true'} onChange={e => setC('agente_activo', e.target.value)} style={{ fontSize: 13 }}>
              <option value="true">🟢 Encendido</option>
              <option value="false">🔴 Apagado</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={_lbl}>Modelo de texto</label>
              <Ayuda>Motor de escritura (briefs, copy, estrategia). Por defecto: gpt-5.</Ayuda>
              <input value={cfg.modelo_texto ?? ''} onChange={e => setC('modelo_texto', e.target.value)} style={{ width: '100%', textTransform: 'none' }} />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={_lbl}>Modelo de imagen</label>
              <Ayuda>Motor visual. Por defecto: gpt-image-1.</Ayuda>
              <input value={cfg.modelo_imagen ?? ''} onChange={e => setC('modelo_imagen', e.target.value)} style={{ width: '100%', textTransform: 'none' }} />
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <label style={_lbl}>Tope de gasto (US$/mes)</label>
              <Ayuda>Freno de costo de OpenAI. Vacío = sin tope.</Ayuda>
              <input type="number" min="0" value={cfg.tope_gasto_usd ?? ''} onChange={e => setC('tope_gasto_usd', e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>

          <div>
            <label style={_lbl}>🧠 Instrucciones maestras</label>
            <Ayuda>El cerebro general del agente, con herencia a todos los proyectos. Lo que escribas aquí guía TODO su trabajo (estrategia, estilo, reglas de marca, honestidad).</Ayuda>
            <textarea value={inst} onChange={e => setInst(e.target.value)}
              style={{ width: '100%', minHeight: 280, fontFamily: 'monospace', fontSize: 13, textTransform: 'none', lineHeight: 1.5 }} />
          </div>

          <button className="btn" onClick={guardarGeneral} style={{ alignSelf: 'flex-start' }}>💾 Guardar configuración general</button>
        </div>
      ) : proy ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px' }}>
              <label style={_lbl}>Nombre del proyecto</label>
              <input value={proy.nombre ?? ''} onChange={e => setP('nombre', e.target.value)} style={{ width: '100%', textTransform: 'none' }} />
            </div>
            <div style={{ flex: '0 1 140px' }}>
              <label style={_lbl}>Activo</label>
              <Ayuda>Sale del selector del chat si lo apagas.</Ayuda>
              <select value={String(proy.activo)} onChange={e => setP('activo', e.target.value === 'true')} style={{ width: '100%' }}>
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            </div>
          </div>

          <div>
            <label style={_lbl}>Autonomía</label>
            <Ayuda>Cuánto decide solo el agente en este proyecto. Siempre hay filtro humano final antes de publicar.</Ayuda>
            <select value={proy.autonomia ?? 'manual'} onChange={e => setP('autonomia', e.target.value)} style={{ width: '100%', maxWidth: 520 }}>
              {AUTONOMIAS.map(a => <option key={a.v} value={a.v}>{a.t}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px' }}>
              <label style={_lbl}>WhatsApp</label>
              <Ayuda>Número al que el agente dirige los llamados a la acción de este proyecto.</Ayuda>
              <input value={proy.whatsapp ?? ''} onChange={e => setP('whatsapp', e.target.value)} placeholder="+51 9..." style={{ width: '100%', textTransform: 'none' }} />
            </div>
            <div style={{ flex: '0 1 180px' }}>
              <label style={_lbl}>Color de marca</label>
              <Ayuda>Color principal (hex).</Ayuda>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input value={proy.color ?? ''} onChange={e => setP('color', e.target.value)} placeholder="#2e7d32" style={{ flex: 1, textTransform: 'none' }} />
                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(proy.color || '') ? proy.color : '#2e7d32'}
                  onChange={e => setP('color', e.target.value)} style={{ width: 34, height: 30, padding: 0, border: 'none', background: 'none' }} />
              </div>
            </div>
          </div>

          <div>
            <label style={_lbl}>Público objetivo</label>
            <Ayuda>A quién le habla este proyecto (edad, ciudad, intereses). El agente ajusta el mensaje a esto.</Ayuda>
            <textarea value={proy.publico ?? ''} onChange={e => setP('publico', e.target.value)}
              style={{ width: '100%', minHeight: 60, textTransform: 'none', fontSize: 13 }} />
          </div>

          <div>
            <label style={_lbl}>Tono / voz de marca</label>
            <Ayuda>Cómo debe sonar (cercano, formal, aspiracional…). Poner ejemplos ayuda mucho.</Ayuda>
            <textarea value={proy.tono ?? ''} onChange={e => setP('tono', e.target.value)}
              style={{ width: '100%', minHeight: 60, textTransform: 'none', fontSize: 13 }} />
          </div>

          <div>
            <label style={_lbl}>📄 Ficha del proyecto</label>
            <Ayuda>Todos los datos del proyecto (ubicación, precios, atributos, reglas). Es la fuente de verdad del agente para este proyecto.</Ayuda>
            <textarea value={proy.ficha ?? ''} onChange={e => setP('ficha', e.target.value)}
              style={{ width: '100%', minHeight: 220, fontFamily: 'monospace', fontSize: 13, textTransform: 'none', lineHeight: 1.5 }} />
          </div>

          <button className="btn" onClick={guardarProy} style={{ alignSelf: 'flex-start' }}>💾 Guardar proyecto</button>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 13 }}>Proyecto no encontrado.</div>
      )}
    </div>
  )
}

// ============================================================================
// Producción: vista de SOLO LECTURA del motor (tablas mkt_wf_* en Supabase).
// La autoridad sigue siendo el motor (SQLite); esto es el espejo/respaldo web.
// ============================================================================
const _colorEstado = (s) => {
  const v = String(s || '').toLowerCase()
  if (['approved', 'succeeded', 'finalized', 'completed'].includes(v)) return '#4ea87a'
  if (['failed', 'cancelled', 'blocked', 'rejected'].includes(v)) return '#d98a8a'
  if (['correction_requested', 'retry_wait', 'changes_requested', 'reconcile_required', 'paused'].includes(v)) return '#e0a35a'
  if (['leased', 'generating', 'in_production', 'in_review', 'finalizing', 'awaiting_approval'].includes(v)) return '#5a9fe0'
  return '#9aa0a6'
}
const _fmtFecha = (seg) => {
  if (!seg) return '—'
  const ms = Number(seg) > 1e12 ? Number(seg) : Number(seg) * 1000
  try { return new Date(ms).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }
  catch { return String(seg) }
}
function Estado({ v }) {
  const c = _colorEstado(v)
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: c, background: c + '22', border: `1px solid ${c}55`, whiteSpace: 'nowrap' }}>{v || '—'}</span>
  )
}
const _th = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,.14)', color: '#9aa0a6', fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11, textTransform: 'uppercase', letterSpacing: .3 }
const _td = { padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,.06)', verticalAlign: 'top', fontSize: 12.5 }

function ProduccionMotor() {
  const [camps, setCamps] = useState([])
  const [campId, setCampId] = useState('')
  const [datos, setDatos] = useState({ pieces: [], ops: [], apps: [], evs: [], imgs: [] })
  const [verImg, setVerImg] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [err, setErr] = useState('')

  const cargarCamps = () => {
    setErr('')
    supabase.from('mkt_wf_campaigns').select('*').order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setErr(error.message); return }
        setCamps(data || [])
        setCampId(prev => prev || (data?.[0]?.campaign_id ?? ''))
      })
  }
  useEffect(() => { cargarCamps() }, [])

  const cargarCamp = async (id) => {
    if (!id) { setDatos({ pieces: [], ops: [], apps: [], evs: [], imgs: [] }); return }
    setCargando(true); setErr('')
    const [p, o, a, e] = await Promise.all([
      supabase.from('mkt_wf_pieces').select('*').eq('campaign_id', id).order('queue_order'),
      supabase.from('mkt_wf_operations').select('*').eq('campaign_id', id).order('queue_seq'),
      supabase.from('mkt_wf_approvals').select('*').eq('campaign_id', id).order('created_at', { ascending: false }),
      supabase.from('mkt_wf_events').select('*').eq('campaign_id', id).order('created_at', { ascending: false }).limit(30),
    ])
    const fallo = [p, o, a, e].find(r => r.error)
    if (fallo) setErr(fallo.error.message)
    // imágenes: tolerante si la tabla aún no existe (sql/41 sin correr)
    let imgs = []
    try {
      const ri = await supabase.from('mkt_wf_imagenes').select('*').eq('campaign_id', id)
        .order('piece_id').order('es_final', { ascending: false }).order('etapa')
      if (!ri.error) imgs = ri.data || []
    } catch { /* tabla no creada aún */ }
    setDatos({ pieces: p.data || [], ops: o.data || [], apps: a.data || [], evs: e.data || [], imgs })
    setCargando(false)
  }
  useEffect(() => { cargarCamp(campId) }, [campId])

  const camp = camps.find(c => c.campaign_id === campId)
  const { pieces, ops, apps, evs, imgs } = datos
  const refrescar = () => { cargarCamps(); cargarCamp(campId) }

  return (
    <div className="glass" style={{ padding: 14 }}>
      <details style={{ marginBottom: 12, fontSize: 12.5, background: 'rgba(90,159,224,.08)', border: '1px solid rgba(90,159,224,.35)', borderRadius: 8, padding: '8px 12px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#5a9fe0' }}>ℹ️ Qué es esta vista</summary>
        <p style={{ margin: '8px 0 0', lineHeight: 1.6 }}>
          Ventana de <b>solo lectura</b> al motor de producción: campañas, piezas, la cola de operaciones y el historial de aprobaciones/eventos.
          La autoridad sigue en el motor; aquí ves el <b>espejo</b> en Supabase. Para refrescar tras un cambio del motor, se vuelve a sincronizar y se recarga aquí.
        </p>
      </details>

      {/* selector de campaña */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,.1)' }}>
        <span style={{ fontSize: 13 }}>📦 Campaña:</span>
        <select value={campId} onChange={e => setCampId(e.target.value)} style={{ fontSize: 13, minWidth: 300 }}>
          {!camps.length && <option value="">— sin campañas —</option>}
          {camps.map(c => <option key={c.campaign_id} value={c.campaign_id}>{c.project_name} · {c.name}</option>)}
        </select>
        {camp && <Estado v={camp.status} />}
        <span style={{ marginLeft: 'auto' }} />
        <button className="btn-ghost" onClick={refrescar} title="Recargar desde Supabase">↻ Refrescar</button>
      </div>

      {err && <div style={{ margin: '10px 0', color: '#f0a0a0', fontSize: 12.5 }}>⚠️ {err}</div>}
      {cargando && <div className="muted" style={{ margin: '10px 0', fontSize: 13, fontStyle: 'italic' }}>Cargando…</div>}

      {!camps.length && !cargando && (
        <div className="muted" style={{ fontSize: 13, textAlign: 'center', margin: '30px auto', maxWidth: 460 }}>
          Aún no hay campañas cargadas en el espejo. Cuando el motor suba una campaña, aparecerá aquí.
        </div>
      )}

      {camp && (
        <>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12.5, padding: '10px 0', color: '#c8ccd0' }}>
            <span><b>Proyecto:</b> {camp.project_name} <span className="muted">({camp.project_id})</span></span>
            <span><b>Periodo:</b> {camp.period}</span>
            <span><b>Revisión:</b> {camp.revision}</span>
            <span><b>Sellada:</b> {camp.sealed ? 'sí' : 'no'}</span>
            <span><b>Creada:</b> {_fmtFecha(camp.created_at)}</span>
          </div>

          {/* GALERÍA DE DISEÑOS */}
          {imgs && imgs.length > 0 && (() => {
            const porPieza = {}
            imgs.forEach(im => { const k = im.piece_id || '—'; (porPieza[k] ||= []).push(im) })
            return (
              <>
                <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>🎨 Diseños ({imgs.length}) <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>· clic para ampliar</span></h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {Object.entries(porPieza).map(([pid, arr]) => (
                    <div key={pid}>
                      <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{pid}</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {arr.map(im => (
                          <button key={im.id} onClick={() => setVerImg(im)} title={`${im.etapa} ${im.version}`}
                            style={{ padding: 0, border: 'none', background: 'none', cursor: 'zoom-in' }}>
                            <img src={im.url} alt={im.version} loading="lazy"
                              style={{ width: 92, height: 115, objectFit: 'cover', borderRadius: 6, display: 'block',
                                border: im.es_final ? '2px solid #4ea87a' : '1px solid rgba(255,255,255,.15)' }} />
                            <div style={{ fontSize: 10, textAlign: 'center', marginTop: 2, color: im.es_final ? '#4ea87a' : '#9aa0a6' }}>
                              {im.es_final ? '⭐ ' : ''}{im.version}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )
          })()}

          {/* PIEZAS */}
          <h3 style={{ margin: '18px 0 6px', fontSize: 14 }}>📋 Piezas ({pieces.length})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={_th}>#</th><th style={_th}>ID</th><th style={_th}>Título</th><th style={_th}>Estado</th><th style={_th}>Ruta</th><th style={_th}>Canva</th><th style={_th}>Correcc.</th></tr></thead>
              <tbody>
                {pieces.map(p => (
                  <tr key={p.piece_id}>
                    <td style={_td}>{p.queue_order}</td>
                    <td style={{ ..._td, fontWeight: 700 }}>{p.piece_id}</td>
                    <td style={_td}>{p.title}</td>
                    <td style={_td}><Estado v={p.status} /></td>
                    <td style={_td}>{p.route}</td>
                    <td style={_td}>{p.requires_canva ? 'sí' : 'no'}</td>
                    <td style={_td}>{p.correction_round}</td>
                  </tr>
                ))}
                {!pieces.length && <tr><td style={_td} colSpan={7}><span className="muted">Sin piezas.</span></td></tr>}
              </tbody>
            </table>
          </div>

          {/* COLA */}
          <h3 style={{ margin: '18px 0 6px', fontSize: 14 }}>⚙️ Cola de operaciones ({ops.length})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={_th}>Seq</th><th style={_th}>Tipo</th><th style={_th}>Pieza</th><th style={_th}>Estado</th><th style={_th}>Aprob.</th><th style={_th}>Intentos</th><th style={_th}>Actualizado</th></tr></thead>
              <tbody>
                {ops.map(o => (
                  <tr key={o.operation_id}>
                    <td style={_td}>{o.queue_seq}</td>
                    <td style={{ ..._td, fontFamily: 'monospace', fontSize: 11.5 }}>{o.kind}</td>
                    <td style={_td}>{o.piece_id || '—'}</td>
                    <td style={_td}><Estado v={o.status} /></td>
                    <td style={_td}>{o.requires_approval ? '✔' : ''}</td>
                    <td style={_td}>{o.attempt_count}/{o.max_attempts}</td>
                    <td style={{ ..._td, whiteSpace: 'nowrap' }}>{_fmtFecha(o.updated_at)}</td>
                  </tr>
                ))}
                {!ops.length && <tr><td style={_td} colSpan={7}><span className="muted">Sin operaciones.</span></td></tr>}
              </tbody>
            </table>
          </div>

          {/* HISTORIAL: aprobaciones + eventos */}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 18 }}>
            <div style={{ flex: '1 1 340px', minWidth: 0 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>✅ Aprobaciones ({apps.length})</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={_th}>Fecha</th><th style={_th}>Ámbito</th><th style={_th}>Decisión</th><th style={_th}>Pieza</th><th style={_th}>Por</th></tr></thead>
                  <tbody>
                    {apps.map(a => (
                      <tr key={a.approval_id}>
                        <td style={{ ..._td, whiteSpace: 'nowrap' }}>{_fmtFecha(a.created_at)}</td>
                        <td style={_td}>{a.scope}</td>
                        <td style={_td}><Estado v={a.decision} /></td>
                        <td style={_td}>{a.piece_id || '—'}</td>
                        <td style={_td}>{a.actor_id}</td>
                      </tr>
                    ))}
                    {!apps.length && <tr><td style={_td} colSpan={5}><span className="muted">Sin aprobaciones.</span></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ flex: '1 1 340px', minWidth: 0 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>📜 Historial ({evs.length})</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={_th}>Fecha</th><th style={_th}>Evento</th><th style={_th}>Pieza</th><th style={_th}>Por</th></tr></thead>
                  <tbody>
                    {evs.map(e => (
                      <tr key={e.event_seq}>
                        <td style={{ ..._td, whiteSpace: 'nowrap' }}>{_fmtFecha(e.created_at)}</td>
                        <td style={{ ..._td, fontFamily: 'monospace', fontSize: 11.5 }}>{e.event_type}</td>
                        <td style={_td}>{e.piece_id || '—'}</td>
                        <td style={_td}>{e.actor_id}</td>
                      </tr>
                    ))}
                    {!evs.length && <tr><td style={_td} colSpan={4}><span className="muted">Sin eventos.</span></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {verImg && (
        <div onClick={() => setVerImg(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out' }}>
          <img src={verImg.url} alt={verImg.version} style={{ maxWidth: '92vw', maxHeight: '84vh', objectFit: 'contain', borderRadius: 8 }} />
          <div style={{ color: '#fff', marginTop: 10, fontSize: 13 }}>
            {verImg.piece_id} · {verImg.etapa} · {verImg.version}{verImg.es_final ? ' · ⭐ FINAL' : ''}
          </div>
        </div>
      )}
    </div>
  )
}
