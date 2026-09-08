import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMsg } from '../lib/saveFx'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'

// ============================================================
// CAMPAÑAS — crear, configurar, medir y cerrar desde el panel
// ------------------------------------------------------------
// Una campaña junta tres cosas que antes vivian sueltas (o no vivian):
//  1. ATRIBUCION: el anuncio manda a WhatsApp con un texto prellenado que
//     lleva una frase clave; el bot la reconoce en el primer mensaje y etiqueta
//     al lead con la campaña. Antes todo entraba como "whatsapp" a secas.
//  2. SEGUIMIENTO AUTOMATICO: a los leads que se quedan en "nuevo" sin que
//     nadie los trabaje, el bot les escribe en los dias que aqui se configuran
//     (dia 1-2 refuerzo, dia 4-5 reactivacion, dia 8-10 cierre). Un mensaje por
//     ventana, una sola pregunta, y si responden pasan al tablero de Telegram.
//  3. RESULTADOS: leads, contactados, negociacion, respuestas al seguimiento
//     y costo por lead, sumados en Postgres (sql/72).
// ============================================================

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const hoyStr = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10)
const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)

// Secuencia por defecto: la metodologia de seguimiento de Urbis (una pregunta
// por mensaje, sin presion). {nombre} y {proyecto} se rellenan al enviar.
const SECUENCIA_BASE = [
  { dia: 1, texto: 'Hola {nombre} 👋, te escribo de {proyecto}. Ayer te compartí la información básica. ¿Hay algo puntual del proyecto que te gustaría que te explique primero?' },
  { dia: 4, texto: '{nombre}, ¿sigues interesado en el lote o prefieres que te contacte más adelante? Cualquiera de las dos está bien 🙂' },
  { dia: 8, texto: 'Te dejo este número por si más adelante te animas, {nombre}. Si quieres, dime en qué mes te escribo. ¡Gracias por tu tiempo! 🌳' },
]

const ESTADOS = {
  borrador: { t: 'BORRADOR', cls: 'muted' },
  activa:   { t: 'ACTIVA',   cls: 'ok' },
  pausada:  { t: 'PAUSADA',  cls: 'warn' },
  cerrada:  { t: 'CERRADA',  cls: 'muted' },
}

const vacia = (proyName) => ({
  name: '', keyword: '', wa_text: '', status: 'borrador',
  starts_at: hoyStr(), ends_at: '', budget: '', attend_from: '08:00', attend_to: '20:00',
  sequence: SECUENCIA_BASE.map(s => ({ ...s })), notes: '',
  _proyName: proyName,
})

export default function Campanas() {
  const { profile, role } = useAuth()
  const { pidOp, projects } = useProject()
  const [lista, setLista] = useState([])
  const [res, setRes] = useState({})          // id -> resultados
  const [edit, setEdit] = useState(null)      // campaña en edicion (objeto) o null
  const [msg, setMsg] = useMsg(null)
  const [busy, setBusy] = useState(false)
  const [telefono, setTelefono] = useState('')
  const [sinTabla, setSinTabla] = useState(false)
  const puedeEditar = ['admin', 'superuser'].includes(role)
  const proyecto = useMemo(() => (projects || []).find(p => p.id === pidOp), [projects, pidOp])

  async function load() {
    if (!pidOp) return
    const [{ data, error }, { data: ses }] = await Promise.all([
      supabase.from('campaigns').select('*').eq('project_id', pidOp).order('created_at', { ascending: false }),
      supabase.from('wa_sessions').select('phone').eq('project_id', pidOp).eq('activo', true).limit(1),
    ])
    if (error) { setSinTabla(true); setLista([]); return }
    setSinTabla(false)
    setLista(data || [])
    setTelefono(ses?.[0]?.phone || '')
    // resultados de cada campaña, sumados en Postgres
    const r = {}
    await Promise.all((data || []).map(async c => {
      const { data: x } = await supabase.rpc('campana_resultados', { cid: c.id })
      if (x) r[c.id] = x
    }))
    setRes(r)
  }
  useEffect(() => { load() }, [pidOp])

  // ---- editor ----
  function nueva() {
    setEdit(vacia(proyecto?.name || ''))
  }
  function abrir(c) {
    setEdit({ ...c, budget: c.budget ?? '', ends_at: c.ends_at || '', sequence: Array.isArray(c.sequence) && c.sequence.length ? c.sequence : SECUENCIA_BASE.map(s => ({ ...s })) })
  }
  const set = (k, v) => setEdit(e => ({ ...e, [k]: v }))
  const setSeq = (i, k, v) => setEdit(e => ({ ...e, sequence: e.sequence.map((s, j) => j === i ? { ...s, [k]: v } : s) }))

  // el texto prellenado del anuncio tiene que llevar la frase clave: es lo que
  // el bot busca para saber de que campaña viene el lead
  function proponerTexto(nombre, kw) {
    return `Hola, vi el anuncio de ${proyecto?.name || 'su proyecto'} y quiero información (${kw})`
  }

  async function guardar(e) {
    e?.preventDefault?.()
    const c = edit
    if (!c.name.trim()) { setMsg({ ok: false, t: 'PONLE UN NOMBRE A LA CAMPAÑA' }); return }
    const kw = (c.keyword || slug(c.name)).trim()
    if (!kw) { setMsg({ ok: false, t: 'FALTA LA FRASE CLAVE DE ATRIBUCIÓN' }); return }
    const waText = (c.wa_text || '').trim() || proponerTexto(c.name, kw)
    if (!waText.toLowerCase().includes(kw.toLowerCase())) {
      setMsg({ ok: false, t: 'EL TEXTO DEL ANUNCIO TIENE QUE CONTENER LA FRASE CLAVE "' + kw + '" — es lo que el bot reconoce.' }); return
    }
    const seq = (c.sequence || []).filter(s => String(s.texto || '').trim()).map(s => ({ dia: Math.max(1, Number(s.dia) || 1), texto: String(s.texto).trim() }))
      .sort((a, b) => a.dia - b.dia)
    setBusy(true)
    const fila = {
      project_id: pidOp, name: c.name.trim(), keyword: kw, wa_text: waText, status: c.status || 'borrador',
      starts_at: c.starts_at || null, ends_at: c.ends_at || null, budget: c.budget === '' ? null : Number(c.budget),
      attend_from: c.attend_from || '08:00', attend_to: c.attend_to || '20:00', sequence: seq, notes: c.notes || null,
      created_by: profile?.id || null,
    }
    const q = c.id ? supabase.from('campaigns').update(fila).eq('id', c.id) : supabase.from('campaigns').insert(fila)
    const { error } = await q
    setBusy(false)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setMsg({ ok: true, t: c.id ? 'CAMPAÑA GUARDADA' : 'CAMPAÑA CREADA (en borrador — actívala cuando lances el anuncio)' })
    setEdit(null); load()
  }

  async function cambiarEstado(c, status) {
    const avisos = {
      activa: '¿Activar "' + c.name + '"?\n\nDesde ahora el bot etiqueta los leads que traigan la frase clave y les hace seguimiento automático a los que se enfríen.',
      pausada: '¿Pausar "' + c.name + '"?\n\nSe detiene el seguimiento automático. Los leads ya etiquetados no se pierden.',
      cerrada: '¿CERRAR "' + c.name + '"?\n\nSe detiene el seguimiento y queda como histórico con sus resultados. No se puede volver a activar.',
    }
    if (!confirm(avisos[status] || '¿Cambiar estado?')) return
    const cambios = { status, ...(status === 'cerrada' ? { closed_at: new Date().toISOString() } : {}) }
    const { error } = await supabase.from('campaigns').update(cambios).eq('id', c.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    await supabase.from('activity_log').insert({
      user_id: profile?.id, user_email: profile?.email, action: 'UPDATE', entity_type: 'campaigns', entity_id: c.id,
      details: { cambio: 'campaña_' + status, nombre: c.name, resultados: res[c.id] || null, project_id: pidOp },
    })
    setMsg({ ok: true, t: 'CAMPAÑA ' + ESTADOS[status].t })
    load()
  }

  const linkWa = c => telefono
    ? 'https://wa.me/' + telefono + '?text=' + encodeURIComponent(c.wa_text || '')
    : ''
  async function copiar(txt, que) {
    try { await navigator.clipboard.writeText(txt); setMsg({ ok: true, t: que + ' COPIADO' }) }
    catch { prompt('Copia esto:', txt) }
  }

  if (!pidOp) return <div className="toolbar"><h1>Campañas</h1><ProjectPicker /></div>

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>📣 Campañas</h1>
        <ProjectPicker />
        {puedeEditar && !edit && <button className="btn-primary" onClick={nueva}>+ Nueva campaña</button>}
      </div>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
      {sinTabla && <p className="error">Falta correr <b>sql/72_campanas.sql</b> en la base para habilitar las campañas.</p>}
      {!telefono && !sinTabla && <p className="hint"><span className="bad">⚠ Este proyecto no tiene número de WhatsApp vinculado</span> — el enlace del anuncio necesita uno (Proyectos → VINCULAR).</p>}

      {/* ---------- EDITOR ---------- */}
      {edit && (
        <form className="glass form-card" style={{ maxWidth: 'none' }} onSubmit={guardar}>
          <p><b>{edit.id ? 'EDITAR CAMPAÑA' : 'NUEVA CAMPAÑA'} — {proyecto?.name}</b></p>
          <div className="grid2">
            <label>Nombre de la campaña
              <input value={edit.name} onChange={e => { const v = e.target.value; setEdit(x => ({ ...x, name: v, keyword: x.id ? x.keyword : slug(v) })) }} placeholder="Ej: Meta septiembre — lotes desde S/500" required style={{ textTransform: 'none' }} />
            </label>
            <label>Frase clave de atribución
              <input value={edit.keyword} onChange={e => set('keyword', slug(e.target.value))} placeholder="meta-septiembre" style={{ textTransform: 'none', fontFamily: 'monospace' }} />
              <span className="muted small">Va dentro del texto del anuncio. El bot la busca en el primer mensaje para etiquetar al lead.</span>
            </label>
          </div>
          <label>Texto prellenado del anuncio (lo que el cliente manda al tocar el anuncio)
            <textarea rows="2" value={edit.wa_text} placeholder={proponerTexto(edit.name, edit.keyword || 'clave')}
              onChange={e => set('wa_text', e.target.value)} style={{ textTransform: 'none' }} />
            <span className="muted small">Si lo dejas vacío se usa: <i>{proponerTexto(edit.name, edit.keyword || 'clave')}</i></span>
          </label>
          <div className="grid2">
            <label>Empieza<input type="date" value={edit.starts_at || ''} onChange={e => set('starts_at', e.target.value)} /></label>
            <label>Termina (opcional)<input type="date" value={edit.ends_at || ''} onChange={e => set('ends_at', e.target.value)} /></label>
            <label>Presupuesto de pauta (opcional, S/)<input type="number" step="0.01" min="0" value={edit.budget} onChange={e => set('budget', e.target.value)} placeholder="para calcular costo por lead" /></label>
            <label>Horario para escribir seguimientos
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="time" value={edit.attend_from} onChange={e => set('attend_from', e.target.value)} /> a
                <input type="time" value={edit.attend_to} onChange={e => set('attend_to', e.target.value)} />
              </span>
            </label>
          </div>

          <p style={{ margin: '12px 0 4px' }}><b>SEGUIMIENTO AUTOMÁTICO</b> <span className="muted small">— para los leads que se quedan en "nuevo" sin respuesta. Un mensaje por ventana, una sola pregunta. Si el lead contesta, se detiene y pasa al tablero de Telegram. Puedes usar {'{nombre}'} y {'{proyecto}'}.</span></p>
          {edit.sequence.map((s, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr auto', gap: 8, alignItems: 'start', marginBottom: 6 }}>
              <label>Día<input type="number" min="1" max="60" value={s.dia} onChange={e => setSeq(i, 'dia', e.target.value)} /></label>
              <label>Mensaje<textarea rows="2" value={s.texto} onChange={e => setSeq(i, 'texto', e.target.value)} style={{ textTransform: 'none' }} /></label>
              <button type="button" className="link-btn" title="Quitar" style={{ marginTop: 22 }} onClick={() => setEdit(x => ({ ...x, sequence: x.sequence.filter((_, j) => j !== i) }))}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn-ghost" onClick={() => setEdit(x => ({ ...x, sequence: [...x.sequence, { dia: (x.sequence.at(-1)?.dia || 0) + 4, texto: '' }] }))}>+ mensaje</button>
            <button type="button" className="btn-ghost" onClick={() => set('sequence', SECUENCIA_BASE.map(s => ({ ...s })))}>Restaurar secuencia base</button>
          </div>

          <label style={{ marginTop: 10 }}>Notas internas (dónde va la pauta, público, oferta…)
            <textarea rows="2" value={edit.notes || ''} onChange={e => set('notes', e.target.value)} style={{ textTransform: 'none' }} />
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="btn-ghost" onClick={() => setEdit(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {/* ---------- LISTA ---------- */}
      {!edit && lista.length === 0 && !sinTabla && (
        <div className="glass form-card">
          <p><b>Todavía no hay campañas en {proyecto?.name}.</b></p>
          <p className="muted small" style={{ textTransform: 'none' }}>Una campaña te da tres cosas: saber qué anuncio trajo a cada lead, seguimiento automático a los que se enfrían, y resultados para decidir si repetir o cortar.</p>
          {puedeEditar && <button className="btn-primary" onClick={nueva}>Crear la primera</button>}
        </div>
      )}

      {!edit && lista.map(c => {
        const r = res[c.id] || {}
        const leads = Number(r.leads || 0)
        const pctNeg = leads ? Math.round(100 * Number(r.negociacion || 0) / leads) : 0
        const cpl = c.budget && leads ? Number(c.budget) / leads : null
        const est = ESTADOS[c.status] || ESTADOS.borrador
        return (
          <div key={c.id} className="glass form-card" style={{ maxWidth: 'none', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, flex: 1 }}>{c.name} <span className={est.cls} style={{ fontSize: 12, marginLeft: 6 }}>● {est.t}</span></h3>
              <span className="muted small">{c.starts_at || '—'}{c.ends_at ? ' → ' + c.ends_at : ''}{c.closed_at ? ' · cerrada ' + c.closed_at.slice(0, 10) : ''}</span>
              {puedeEditar && c.status !== 'cerrada' && <>
                <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => abrir(c)}>✎ Configurar</button>
                {c.status !== 'activa' && <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => cambiarEstado(c, 'activa')}>▶ Activar</button>}
                {c.status === 'activa' && <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => cambiarEstado(c, 'pausada')}>⏸ Pausar</button>}
                <button className="btn-ghost" style={{ fontSize: 12, color: '#ff8e7a', borderColor: 'rgba(255,142,122,.5)' }} onClick={() => cambiarEstado(c, 'cerrada')}>■ Cerrar</button>
              </>}
            </div>

            {/* resultados */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, margin: '10px 0' }}>
              {[
                ['LEADS', leads],
                ['SIN TRABAJAR', r.nuevos ?? 0],
                ['CONTACTADOS', r.contactados ?? 0],
                ['NEGOCIACIÓN', (r.negociacion ?? 0) + (leads ? ' (' + pctNeg + '%)' : '')],
                ['CON SEGUIMIENTO', r.con_seguimiento ?? 0],
                ['RESPONDIERON AL SEG.', r.respondieron_seg ?? 0],
                ['PERDIDOS', r.perdidos ?? 0],
                ['COSTO POR LEAD', cpl != null ? soles(cpl) : (c.budget ? '—' : 'sin presupuesto')],
              ].map(([l, v]) => (
                <div key={l} style={{ background: 'rgba(255,255,255,.04)', borderRadius: 8, padding: '6px 10px' }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{v}</div>
                  <div className="muted" style={{ fontSize: 10, letterSpacing: '.05em' }}>{l}</div>
                </div>
              ))}
            </div>

            {/* el enlace para el anuncio */}
            {c.status !== 'cerrada' && (
              <div style={{ background: 'rgba(80,160,120,.07)', borderRadius: 8, padding: '8px 10px' }}>
                <p style={{ margin: '0 0 4px', fontSize: 12 }}><b>ENLACE PARA EL ANUNCIO</b> <span className="muted">— frase clave: <code>{c.keyword}</code></span></p>
                <p className="muted small" style={{ textTransform: 'none', margin: '0 0 6px' }}>Texto que manda el cliente: <i>{c.wa_text}</i></p>
                {telefono
                  ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <code style={{ fontSize: 11, wordBreak: 'break-all', flex: 1, minWidth: 240 }}>{linkWa(c)}</code>
                      <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => copiar(linkWa(c), 'ENLACE')}>Copiar enlace</button>
                      <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => copiar(c.wa_text || '', 'TEXTO')}>Copiar texto</button>
                    </div>
                  : <p className="bad small">Vincula un número de WhatsApp al proyecto para generar el enlace.</p>}
                <p className="muted small" style={{ textTransform: 'none', margin: '6px 0 0' }}>
                  En Meta: objetivo <b>Mensajes → WhatsApp</b>, y en <b>Mensaje de bienvenida</b> pega el texto (o usa el enlace como destino). Cuando el cliente lo manda, el bot lo etiqueta a esta campaña.
                </p>
              </div>
            )}
            {c.notes && <p className="muted small" style={{ textTransform: 'none', marginTop: 6 }}>📝 {c.notes}</p>}
            {c.status === 'activa' && !!(c.sequence || []).length && (
              <p className="muted small" style={{ textTransform: 'none', marginTop: 6 }}>🔁 Seguimiento automático: {(c.sequence || []).map(s => 'día ' + s.dia).join(' · ')} · de {c.attend_from} a {c.attend_to}</p>
            )}
          </div>
        )
      })}
    </>
  )
}
