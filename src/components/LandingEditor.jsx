import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { subirFotoWeb, subirLogoWeb } from '../lib/imagenesWeb'
import { subirRuta } from '../lib/archivos'
import { linkPublico, linkPanel } from '../lib/sitios'

// Editor de la LANDING pública de un proyecto (Corretaje → Proyectos → Landing).
// Guarda en corr_proyectos_pub (sql/78); la página vive en /p/<slug> y la
// dibuja pages/Landing.jsx. Mientras la landing esté apagada, el admin con
// sesión la ve como vista previa desde el panel (con dominio propio la web
// pública es otro sitio y no tiene sesión: ver lib/sitios.js).

export const slugify = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/^(las?|el|los)\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
// mientras se escribe se deja el guion final (si no, no se puede tipear "praderas-de")
const limpiarSlug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-')
// link para compartir: la web pública (hoy este mismo sitio; con dominio propio, otro)
export const linkLanding = slug => linkPublico('p/' + slug)
// el borrador solo se ve con sesión, y la sesión vive en el panel: la vista previa se abre aquí
export const linkVistaPrevia = slug => linkPanel('p/' + slug)
// si pegan el código <iframe …> entero, nos quedamos con el src
const srcDeIframe = v => (String(v).match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i) || [, String(v)])[1].trim()

const TEXTOS = ['marca', 'titular', 'subtitulo', 'descripcion', 'color', 'logo_url', 'foto_url', 'pdf_url', 'precio_desde_txt',
  'inicial_desde', 'cuotas_txt', 'ubicacion_txt', 'maps_url', 'video_url', 'legal_txt', 'wa_texto', 'visor_url', 'tour_url']
const EN_PARALELO = 2       // fotos convirtiéndose a la vez: rápido sin ahogar la memoria de la PC

export default function LandingEditor({ pr, setPub, avisar }) {
  const l = pr.pub
  const set = (k, v) => setPub({ [k]: v })
  const galeria = Array.isArray(l.galeria) ? l.galeria : []
  const beneficios = Array.isArray(l.beneficios) ? l.beneficios : []
  const faq = Array.isArray(l.faq) ? l.faq : []
  const carpeta = 'corretaje/proyectos/' + pr.id + '/landing'
  const [subiendo, setSubiendo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [campanas, setCampanas] = useState([])
  const [telSesion, setTelSesion] = useState('')

  useEffect(() => {
    supabase.from('campaigns').select('id, name, wa_text, status').eq('project_id', pr.id)
      .then(({ data }) => setCampanas((data || []).filter(c => c.wa_text)))
    supabase.from('wa_sessions').select('phone').eq('project_id', pr.id).maybeSingle()
      .then(({ data }) => setTelSesion(String(data?.phone || '').split('@')[0].split(':')[0]))
  }, [pr.id])

  const slug = slugify(l.slug || '')
  const link = slug ? linkLanding(slug) : ''

  const guardar = async () => {
    const final = slug || slugify(pr.name)
    setGuardando(true)
    const fila = { project_id: pr.id, slug: final, landing_activa: !!l.landing_activa, mostrar_stock: l.mostrar_stock !== false, updated_at: new Date().toISOString() }
    TEXTOS.forEach(k => { fila[k] = String(l[k] ?? '').trim() || null })
    fila.whatsapp = String(l.whatsapp || '').replace(/\D/g, '') || null
    fila.galeria = galeria
    fila.beneficios = beneficios.map(b => ({ titulo: String(b.titulo || '').trim(), texto: String(b.texto || '').trim() })).filter(b => b.titulo || b.texto)
    fila.faq = faq.map(q => ({ p: String(q.p || '').trim(), r: String(q.r || '').trim() })).filter(q => q.p && q.r)
    const { error } = await supabase.from('corr_proyectos_pub').upsert(fila)
    setGuardando(false)
    if (error) { avisar('ERROR: ' + (/slug/.test(error.message) ? 'ese link ya lo usa otro proyecto' : error.message)); return }
    setPub({ slug: final, beneficios: fila.beneficios, faq: fila.faq })
    avisar(fila.landing_activa ? '✅ Landing guardada y PÚBLICA' : '✅ Landing guardada como borrador')
  }

  // el interruptor se guarda al toque: marcar la casilla y no darle a Guardar
  // dejaba la landing en borrador aunque el panel dijera "activa"
  const activar = async on => {
    const final = slug || slugify(pr.name)
    set('landing_activa', on)
    const { error } = await supabase.from('corr_proyectos_pub').upsert({ project_id: pr.id, landing_activa: on, slug: final, updated_at: new Date().toISOString() })
    if (error) { set('landing_activa', !on); avisar('ERROR: ' + error.message); return }
    set('slug', final)
    avisar(on ? '🟢 Landing PÚBLICA: cualquiera con el link ya la ve' : '⚪ Landing en borrador: solo se ve con sesión')
  }

  // las fotos se guardan al toque (como el PDF y la portada): subir y olvidar
  // guardar dejaba archivos en R2 que ninguna página usaba
  const guardarGaleria = async nueva => {
    set('galeria', nueva)
    const { error } = await supabase.from('corr_proyectos_pub').upsert({ project_id: pr.id, galeria: nueva })
    if (error) avisar('ERROR: ' + error.message)
  }
  // cada foto se convierte en el navegador a 3 tamaños WebP (lib/imagenesWeb.js)
  // y viajan esos archivos livianos, no la foto original de 10 MB
  const subirFotos = async e => {
    const files = [...(e.target.files || [])]; e.target.value = ''
    if (!files.length) return
    const listas = new Array(files.length)
    let siguiente = 0, hechas = 0
    setSubiendo(`Preparando ${files.length} foto${files.length === 1 ? '' : 's'}…`)
    const trabajador = async () => {
      while (siguiente < files.length) {
        const i = siguiente++
        try { listas[i] = { ...(await subirFotoWeb(files[i], carpeta)), titulo: '' } }
        catch (err) { avisar('ERROR al subir ' + files[i].name + ': ' + err.message) }
        setSubiendo(`Subidas ${++hechas} de ${files.length}…`)
      }
    }
    await Promise.all(Array.from({ length: Math.min(EN_PARALELO, files.length) }, trabajador))
    setSubiendo('')
    const nuevas = listas.filter(Boolean)
    if (nuevas.length) { await guardarGaleria([...galeria, ...nuevas]); avisar(`✅ ${nuevas.length} foto${nuevas.length === 1 ? '' : 's'} agregada${nuevas.length === 1 ? '' : 's'}`) }
  }
  const subirLogo = async e => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setSubiendo('Subiendo logo…')
    try {
      const url = await subirLogoWeb(file, carpeta)
      set('logo_url', url)
      await supabase.from('corr_proyectos_pub').upsert({ project_id: pr.id, logo_url: url })
    } catch (err) { avisar('ERROR al subir el logo: ' + err.message) }
    setSubiendo('')
  }
  // el visor 3D es un .html de una sola pieza (Three.js adentro): se sube tal cual a R2 y se sirve como página
  const subirVisor = async e => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    if (!/\.html?$/i.test(file.name)) { avisar('ERROR: el visor tiene que ser un archivo .html'); return }
    setSubiendo('Subiendo visor…')
    try {
      const url = await subirRuta(`${carpeta}/visor-${Date.now()}.html`, new File([file], file.name, { type: 'text/html' }), { comprimir: false, abrirWord: false })
      set('visor_url', url)
      await supabase.from('corr_proyectos_pub').upsert({ project_id: pr.id, visor_url: url })
      avisar('✅ Visor subido: ya sale en la landing')
    } catch (err) { avisar('ERROR al subir el visor: ' + err.message) }
    setSubiendo('')
  }
  const mover = (i, d) => { const g = [...galeria]; [g[i], g[i + d]] = [g[i + d], g[i]]; guardarGaleria(g) }
  const quitar = i => { if (confirm('¿Quitar esta foto de la landing?')) guardarGaleria(galeria.filter((_, j) => j !== i)) }
  const setBen = (i, k, v) => set('beneficios', beneficios.map((b, j) => (j === i ? { ...b, [k]: v } : b)))
  const setFaq = (i, k, v) => set('faq', faq.map((q, j) => (j === i ? { ...q, [k]: v } : q)))

  const copiar = async () => {
    try { await navigator.clipboard.writeText(link); avisar('✅ Link copiado') }
    catch { window.prompt('Copia el link:', link) }
  }

  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }
  const bloque = { display: 'grid', gap: 10, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.08)' }
  const titulo = t => <b style={{ fontSize: 13, letterSpacing: '.04em' }}>{t}</b>
  const campo = (k, etiqueta, ph, props = {}) => (
    <label>{etiqueta}<input value={l[k] || ''} placeholder={ph} onChange={e => set(k, e.target.value)} {...props} /></label>
  )
  const area = (k, etiqueta, ph, filas = 3) => (
    <label>{etiqueta}<textarea rows={filas} value={l[k] || ''} placeholder={ph} onChange={e => set(k, e.target.value)} /></label>
  )

  return (
    <div className="sin-mayus" style={{ marginTop: 10, padding: 14, borderRadius: 12, background: 'rgba(0,0,0,.2)', display: 'grid', gap: 12 }}>
      {/* estado + link */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'inherit', fontWeight: 700 }}>
          <input type="checkbox" checked={!!l.landing_activa} onChange={e => activar(e.target.checked)} /> Página pública activa
        </label>
        <span className="muted" style={{ fontSize: 12 }}>
          {l.landing_activa ? '🟢 Cualquiera con el link la ve.' : '⚪ Borrador: el link solo muestra una vista previa a quien tiene sesión.'} Se guarda al marcar.
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: 12 }}>{linkLanding('')}</span>
        <input value={l.slug || ''} placeholder={slugify(pr.name)} onChange={e => set('slug', limpiarSlug(e.target.value))} style={{ width: 230 }} />
        {link && <button type="button" className="btn-ghost" onClick={copiar}>🔗 Copiar link</button>}
        {link && <a className="btn-ghost" href={l.landing_activa ? link : linkVistaPrevia(slug)} target="_blank" rel="noreferrer">👁️ Abrir</a>}
        <button type="button" className="btn" onClick={guardar} disabled={guardando} style={{ marginLeft: 'auto' }}>{guardando ? 'Guardando…' : '💾 Guardar landing'}</button>
      </div>

      {/* portada */}
      <div style={bloque}>
        {titulo('PORTADA')}
        <div style={grid}>
          {campo('titular', 'Frase grande', 'Tu refugio frente a la laguna')}
          {campo('marca', 'Quién firma', 'Urbis Group')}
        </div>
        {area('subtitulo', 'Bajada (una o dos líneas)', 'Lotes a aproximadamente 1 km de la laguna…', 2)}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>Color de marca
            <input type="color" value={l.color || pr.color || '#0f6b4f'} onChange={e => set('color', e.target.value)} style={{ width: 44, height: 30, padding: 2 }} />
          </label>
          <label className="btn-ghost" style={{ cursor: 'pointer', flexDirection: 'row' }}>🏷️ Logo (PNG sin fondo)<input type="file" accept="image/*" onChange={subirLogo} style={{ display: 'none' }} /></label>
          {(l.logo_url || pr.logo_url) && <img src={l.logo_url || pr.logo_url} alt="" style={{ height: 34, background: '#2a3a31', borderRadius: 6, padding: 3 }} />}
          <span className="muted">La portada es la foto marcada con ★ en la galería (o la de 🖼️ Foto de portada).</span>
        </div>
      </div>

      {/* proyecto */}
      <div style={bloque}>
        {titulo('EL PROYECTO')}
        {area('descripcion', 'Descripción', 'Qué es, dónde está y para quién es', 3)}
        <span className="muted" style={{ fontSize: 12 }}>Razones para elegirlo (hasta 6 tarjetas):</span>
        {beneficios.map((b, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) minmax(200px, 2fr) auto', gap: 6 }}>
            <input value={b.titulo || ''} placeholder="Título" onChange={e => setBen(i, 'titulo', e.target.value)} />
            <input value={b.texto || ''} placeholder="Texto corto" onChange={e => setBen(i, 'texto', e.target.value)} />
            <button type="button" className="btn-ghost" onClick={() => set('beneficios', beneficios.filter((_, j) => j !== i))} title="Quitar">✕</button>
          </div>
        ))}
        {beneficios.length < 6 && <button type="button" className="btn-ghost" style={{ justifySelf: 'start' }} onClick={() => set('beneficios', [...beneficios, { titulo: '', texto: '' }])}>➕ Agregar razón</button>}
      </div>

      {/* galería */}
      <div style={bloque}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {titulo(`GALERÍA (${galeria.length})`)}
          <label className="btn-ghost" style={{ cursor: 'pointer', flexDirection: 'row' }}>📷 Subir fotos<input type="file" accept="image/*" multiple onChange={subirFotos} style={{ display: 'none' }} /></label>
          {subiendo && <span style={{ fontSize: 12 }}>{subiendo}</span>}
          <span className="muted" style={{ fontSize: 12 }}>Sube la foto original en alta: se convierte sola a 4 tamaños para web y la página abre rápido en celular. Se guarda al instante.</span>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          Las primeras fotos rotan en la portada (planos y mapas no entran). La foto cuya descripción diga <b>ruta</b>, <b>acceso</b> o <b>cómo llegar</b> se usa en la sección "Cómo llegar".
        </div>
        {galeria.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
            {galeria.map((g, i) => (
              <div key={g.url + i} style={{ background: 'rgba(255,255,255,.05)', borderRadius: 8, overflow: 'hidden', border: l.foto_url === g.url ? '2px solid #ffc644' : '2px solid transparent' }}>
                <div style={{ position: 'relative' }}>
                  <img src={g.s || g.url} alt="" loading="lazy" style={{ width: '100%', height: 96, objectFit: 'cover', display: 'block' }} />
                  <span style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 11, padding: '1px 6px', borderRadius: 10 }}>{l.foto_url === g.url ? '★ portada' : i + 1}</span>
                </div>
                <input value={g.titulo || ''} placeholder="Descripción (opcional)" onChange={e => set('galeria', galeria.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)))}
                  style={{ width: '100%', fontSize: 12, padding: '4px 6px', borderRadius: 0 }} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <button type="button" className="btn-ghost" disabled={i === 0} onClick={() => mover(i, -1)} title="Mover antes">←</button>
                  <button type="button" className="btn-ghost" onClick={() => set('foto_url', g.url)} title="Usar de portada (luego Guardar)">★</button>
                  <button type="button" className="btn-ghost" onClick={() => quitar(i)} title="Quitar">✕</button>
                  <button type="button" className="btn-ghost" disabled={i === galeria.length - 1} onClick={() => mover(i, 1)} title="Mover después">→</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* precios */}
      <div style={bloque}>
        {titulo('CÓMO PAGAS')}
        <div style={grid}>
          {campo('inicial_desde', 'Inicial desde', 'S/ 500')}
          {campo('cuotas_txt', 'Cuotas', '48 cuotas sin intereses')}
          {campo('precio_desde_txt', 'Precio desde (si lo dejas vacío sale el menor de tus lotes)', '20100')}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>Si escribes un precio, ese manda (20100 se muestra como S/ 20,100). Si lo dejas vacío, la página muestra el menor precio de tus lotes disponibles. Los contadores siempre van en vivo.</span>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
          <input type="checkbox" checked={l.mostrar_stock !== false} onChange={e => set('mostrar_stock', e.target.checked)} /> Mostrar lotes disponibles y vendidos
        </label>
      </div>

      {/* contacto */}
      <div style={bloque}>
        {titulo('WHATSAPP')}
        <div style={grid}>
          {campo('whatsapp', 'Número que recibe', telSesion ? `Vacío = el vinculado (${telSesion})` : '51 9XX XXX XXX', { inputMode: 'tel' })}
          {campo('wa_texto', 'Mensaje que llega escrito', `Hola, vi la página de ${pr.name} y quiero información`)}
        </div>
        {!l.whatsapp && !telSesion && <span style={{ fontSize: 12, color: '#f0a0a0' }}>⚠ Sin número la página solo muestra el formulario.</span>}
        {campanas.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
            <select value="" onChange={e => { const c = campanas.find(x => x.id === e.target.value); if (c) set('wa_texto', c.wa_text) }} style={{ maxWidth: 320 }}>
              <option value="">Usar el mensaje de una campaña…</option>
              {campanas.map(c => <option key={c.id} value={c.id}>{c.name} · {c.status}</option>)}
            </select>
            <span className="muted">Con el mensaje de una campaña ACTIVA, el bot etiqueta esos leads con esa campaña.</span>
          </div>
        )}
      </div>

      {/* ubicación y respaldo */}
      <div style={bloque}>
        {titulo('UBICACIÓN, VIDEO Y RESPALDO')}
        {area('ubicacion_txt', 'Cómo llegar', 'Km 10 de la Carretera Federico Basadre…', 2)}
        <div style={grid}>
          {campo('maps_url', 'Link de Google Maps', 'https://maps.app.goo.gl/…')}
          {campo('video_url', 'Video (YouTube u otro link)', 'https://youtu.be/…')}
        </div>
        {area('legal_txt', 'Respaldo legal (sin número de partida)', 'Predio inscrito en SUNARP…', 3)}
      </div>

      {/* chat de dudas */}
      <div style={bloque}>
        {titulo(`CHAT "¿TIENES DUDAS?" (${faq.length} de 6 preguntas)`)}
        <span className="muted" style={{ fontSize: 12 }}>Burbuja abajo a la izquierda que aparece al bajar. El cliente toca una pregunta y ve la respuesta al instante; si tiene otra duda, lo manda al WhatsApp. Sin preguntas, la burbuja no sale.</span>
        {faq.map((q, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(240px, 2fr) auto', gap: 6, alignItems: 'start' }}>
            <input value={q.p || ''} placeholder="Pregunta (ej. ¿Cuánto cuesta un lote?)" onChange={e => setFaq(i, 'p', e.target.value)} />
            <textarea rows={2} value={q.r || ''} placeholder="Respuesta corta y clara" onChange={e => setFaq(i, 'r', e.target.value)} />
            <button type="button" className="btn-ghost" onClick={() => set('faq', faq.filter((_, j) => j !== i))} title="Quitar">✕</button>
          </div>
        ))}
        {faq.length < 6 && <button type="button" className="btn-ghost" style={{ justifySelf: 'start' }} onClick={() => set('faq', [...faq, { p: '', r: '' }])}>➕ Agregar pregunta</button>}
      </div>

      {/* recorrido virtual */}
      <div style={bloque}>
        {titulo('RECORRIDO VIRTUAL: TOUR 360° Y VISOR 3D')}
        <label>Tour 360° (pega el link de inserción o el código completo del &lt;iframe&gt; que te da Panoraven: se queda solo con el link)
          <input value={l.tour_url || ''} placeholder="https://panoraven.com/es/embed/…" onChange={e => set('tour_url', srcDeIframe(e.target.value))} />
        </label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="btn-ghost" style={{ cursor: 'pointer', flexDirection: 'row' }}>🧊 Subir visor (archivo .html)<input type="file" accept=".html,.htm,text/html" onChange={subirVisor} style={{ display: 'none' }} /></label>
          <span className="muted" style={{ fontSize: 12 }}>o pega un link:</span>
          <input value={l.visor_url || ''} placeholder="https://…" onChange={e => set('visor_url', e.target.value)} style={{ flex: '1 1 260px' }} />
          {l.visor_url && <a className="btn-ghost" href={l.visor_url} target="_blank" rel="noreferrer">👁️ Abrir</a>}
          {l.visor_url && <button type="button" className="btn-ghost" onClick={() => set('visor_url', '')} title="Quitar de la landing (luego Guardar)">✕</button>}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>Salen en la sección "Recorrido virtual" (si hay los dos, con pestañas 360° / 3D). El tour se abre dentro de la página; el visor 3D dentro en PC y en pestaña aparte en celular.</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : '💾 Guardar landing'}</button>
      </div>
    </div>
  )
}
