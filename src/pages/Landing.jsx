import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { srcsetDe } from '../lib/imagenesWeb'
import '../styles/landing.css'

// Landing PÚBLICA de un proyecto (sin login): /p/<slug>. Lee la vista segura
// pub_landing (solo landings activas; sql/78). Si la landing sigue apagada y
// quien entra tiene sesión, se arma el borrador desde las tablas como VISTA
// PREVIA. Todo el contenido se edita en Corretaje → Proyectos → Landing.
// Las fotos traen 3 anchos (lib/imagenesWeb.js): cada <img> declara cuánto
// ocupa en pantalla (sizes) y el navegador baja solo el archivo que le toca.

const MINUS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'en'])
// los nombres de proyecto viven en MAYÚSCULAS en la base
const bonito = s => String(s || '').toLowerCase().split(/\s+/).filter(Boolean)
  .map((w, i) => (i > 0 && MINUS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
// "desde" se redondea hacia ARRIBA: nunca anunciar menos de lo que cuesta de verdad
const soles = n => 'S/ ' + Math.ceil(Number(n)).toLocaleString('es-PE')
const telWa = w => { const d = String(w || '').replace(/\D/g, ''); return d.length === 9 ? '51' + d : d }
const idYoutube = u => (String(u || '').match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/) || [])[1]

async function cargarBorrador(slug) {
  const { data: ses } = await supabase.auth.getSession()
  if (!ses?.session) return null
  const { data: cp } = await supabase.from('corr_proyectos_pub')
    .select('*, projects(name, color, logo_url, photo_url)').eq('slug', slug).maybeSingle()
  if (!cp) return null
  const [{ data: lotes }, { data: ws }] = await Promise.all([
    supabase.from('lots').select('total_price, status').eq('project_id', cp.project_id),
    supabase.from('wa_sessions').select('phone').eq('project_id', cp.project_id).maybeSingle(),
  ])
  const ls = lotes || []
  const disp = ls.filter(l => l.status === 'disponible')
  const pr = cp.projects || {}
  return {
    ...cp, id: cp.project_id, nombre: pr.name, borrador: !cp.landing_activa,
    color: cp.color || pr.color, logo_url: cp.logo_url || pr.logo_url, portada_url: cp.foto_url || pr.photo_url,
    whatsapp: cp.whatsapp || String(ws?.phone || '').split('@')[0].split(':')[0],
    precio_desde: disp.length ? Math.min(...disp.map(l => Number(l.total_price))) : null,
    disponibles: disp.length,
    vendidos: ls.filter(l => ['vendido', 'entregado'].includes(l.status)).length,
    reservados: ls.filter(l => l.status === 'separado').length,
  }
}

export default function Landing() {
  const { slug: crudo } = useParams()
  const slug = String(crudo || '').toLowerCase()
  const [p, setP] = useState(undefined)      // undefined = cargando · null = no existe
  const [foto, setFoto] = useState(null)     // índice abierto en el visor

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data } = await supabase.from('pub_landing').select('*').eq('slug', slug).maybeSingle()
      const fila = data || await cargarBorrador(slug).catch(() => null)
      if (vivo) setP(fila || null)
    })()
    return () => { vivo = false }
  }, [slug])

  // pestaña del navegador y fondo mientras la landing está abierta
  useEffect(() => {
    if (!p) return
    const antes = { title: document.title, bg: document.body.style.background }
    document.title = bonito(p.nombre) + (p.marca ? ' · ' + p.marca : '')
    let meta = document.querySelector('meta[name="description"]')
    const creada = !meta
    if (creada) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta) }
    const descAntes = meta.content
    meta.content = p.subtitulo || p.descripcion || ''
    document.body.style.background = '#f6f7f4'
    return () => {
      document.title = antes.title; document.body.style.background = antes.bg
      if (creada) meta.remove(); else meta.content = descAntes
    }
  }, [p])

  if (p === undefined) return <div className="lp"><div className="lp-hero" /></div>
  if (p === null) return (
    <div className="lp lp-nada"><div className="lp-wrap">
      <h1>Esta página no está disponible</h1>
      <p>Puede que el enlace esté mal escrito o que el proyecto ya no esté publicado.</p>
      <Link className="lp-btn lp-btn-c" to="/propiedades">Ver proyectos y propiedades</Link>
    </div></div>
  )

  const nombre = bonito(p.nombre)
  const galeria = (Array.isArray(p.galeria) ? p.galeria : []).filter(g => g?.url)
  const portada = p.portada_url || galeria[0]?.url
  const fotoPortada = galeria.find(g => g.url === portada)
  const beneficios = (Array.isArray(p.beneficios) ? p.beneficios : []).filter(b => b?.titulo || b?.texto)
  const tel = telWa(p.whatsapp)
  const linkWa = tel ? `https://wa.me/${tel}?text=${encodeURIComponent(p.wa_texto || `Hola, vi la página de ${nombre} y quiero información`)}` : null
  const totalLotes = (p.disponibles || 0) + (p.vendidos || 0) + (p.reservados || 0)
  const conStock = p.mostrar_stock !== false && totalLotes > 0
  const ocupados = (p.vendidos || 0) + (p.reservados || 0)
  const desde = p.precio_desde != null ? soles(p.precio_desde) : (p.precio_desde_txt || null)
  const cuotas = p.cuotas_txt || p.cuota_desde
  const yt = idYoutube(p.video_url)
  const stats = [
    desde && ['Precio desde', desde],
    p.inicial_desde && ['Inicial desde', p.inicial_desde],
    conStock && ['Lotes disponibles', p.disponibles],
    conStock && p.vendidos > 0 && ['Lotes vendidos', p.vendidos],
  ].filter(Boolean)
  const ir = id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const aWa = (clase, texto, icono = true) => linkWa &&
    <a className={'lp-btn ' + clase} href={linkWa} target="_blank" rel="noreferrer">{icono && <IcoWa />}{texto}</a>

  return (
    <div className="lp" style={p.color ? { '--lp-c': p.color } : undefined}>
      {p.borrador && <div className="lp-draft">Vista previa · esta página todavía no es pública. Actívala en Corretaje → Proyectos.</div>}

      <nav className="lp-nav"><div className="lp-wrap">
        {p.logo_url ? <img className="lp-logo" src={p.logo_url} alt={nombre} /> : <span className="lp-logo-txt">{nombre}</span>}
        {aWa('lp-btn-wa lp-btn-sm', 'Escríbenos')}
      </div></nav>

      <header className="lp-hero">
        {portada && <img className="lp-hero-img" src={fotoPortada?.m || portada} srcSet={srcsetDe(fotoPortada)} sizes="100vw" alt="" fetchPriority="high" />}
        <div className="lp-wrap lp-hero-in">
          <div className="lp-kicker">{p.logo_url ? nombre : (p.marca || 'Proyecto inmobiliario')}</div>
          <h1>{p.titular || nombre}</h1>
          {p.subtitulo && <p>{p.subtitulo}</p>}
          <div className="lp-ctas">
            {aWa('lp-btn-wa', 'Quiero información')}
            <button type="button" className="lp-btn lp-btn-ghost" onClick={() => ir('contacto')}>Que me llamen</button>
            {p.pdf_url && <a className="lp-btn lp-btn-ghost" href={p.pdf_url} target="_blank" rel="noreferrer">Ver plano</a>}
          </div>
        </div>
      </header>

      {stats.length > 0 && (
        <div className="lp-wrap lp-strip"><div className="lp-strip-in">
          {stats.map(([t, v]) => <div key={t} className="lp-stat"><small>{t}</small><b>{v}</b></div>)}
        </div></div>
      )}

      {(p.descripcion || beneficios.length > 0) && (
        <section className="lp-sec"><div className="lp-wrap">
          <div className="lp-eyebrow">El proyecto</div>
          <h2>¿Por qué {nombre}?</h2>
          {p.descripcion && <p className="lp-lead">{p.descripcion}</p>}
          {beneficios.length > 0 && (
            <div className="lp-grid4">
              {beneficios.map((b, i) => (
                <div key={i} className="lp-card">
                  <div className="lp-card-n">{i + 1}</div>
                  {b.titulo && <h3>{b.titulo}</h3>}
                  {b.texto && <p>{b.texto}</p>}
                </div>
              ))}
            </div>
          )}
        </div></section>
      )}

      {galeria.length > 0 && (
        <section className="lp-sec lp-sec-alt"><div className="lp-wrap">
          <div className="lp-eyebrow">Galería</div>
          <h2>Conoce el lugar</h2>
          <div className="lp-gal">
            {galeria.slice(0, 5).map((g, i) => (
              <button key={g.url + i} type="button" onClick={() => setFoto(i)} aria-label={'Ver foto ' + (i + 1)}>
                <img src={g.m || g.url} srcSet={srcsetDe(g)} sizes={i === 0 ? '(max-width: 760px) 100vw, 560px' : '(max-width: 760px) 50vw, 280px'}
                  alt={g.titulo || nombre} loading="lazy" decoding="async" />
                {i === 4 && galeria.length > 5 && <span className="lp-gal-more">+{galeria.length - 5} fotos</span>}
              </button>
            ))}
          </div>
        </div></section>
      )}

      {(desde || p.inicial_desde || cuotas) && (
        <section className="lp-sec lp-band"><div className="lp-wrap">
          <div className="lp-eyebrow">Cómo pagas</div>
          <h2>Financiamiento directo, sin bancos</h2>
          <div className="lp-pay">
            {desde && <div><small>Precio desde</small><b>{desde}</b></div>}
            {p.inicial_desde && <div><small>Inicial desde</small><b>{p.inicial_desde}</b></div>}
            {cuotas && <div><small>Cuotas</small><b className="lp-pay-txt">{cuotas}</b></div>}
          </div>
          {conStock && ocupados > 0 && (
            <div className="lp-avance">
              <div className="lp-avance-t"><span>{ocupados} de {totalLotes} lotes ya vendidos o separados</span><span>{p.disponibles} disponibles</span></div>
              <div className="lp-bar"><i style={{ width: Math.round(ocupados / totalLotes * 100) + '%' }} /></div>
            </div>
          )}
          <div className="lp-ctas">
            {aWa('lp-btn-wa', 'Cotiza tu lote')}
            {p.pdf_url && <a className="lp-btn lp-btn-ghost" href={p.pdf_url} target="_blank" rel="noreferrer">Ver plano de lotes</a>}
          </div>
          <p className="lp-nota">Precios y disponibilidad sujetos a cambio. Tu asesor confirma el lote y las condiciones vigentes.</p>
        </div></section>
      )}

      {(p.ubicacion_txt || p.maps_url || p.video_url) && (
        <section className="lp-sec"><div className="lp-wrap lp-split">
          <div>
            <div className="lp-eyebrow">Ubicación</div>
            <h2>Cómo llegar</h2>
            {p.ubicacion_txt && <p className="lp-lead">{p.ubicacion_txt}</p>}
            <div className="lp-ctas">
              {p.maps_url && <a className="lp-btn lp-btn-c" href={p.maps_url} target="_blank" rel="noreferrer"><IcoPin /> Abrir en Google Maps</a>}
              {aWa('lp-btn-line', 'Agenda una visita', false)}
            </div>
          </div>
          {yt
            ? <iframe className="lp-video" src={'https://www.youtube-nocookie.com/embed/' + yt} title={'Video de ' + nombre}
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen loading="lazy" />
            : p.video_url
              ? <a className="lp-video-link" href={p.video_url} target="_blank" rel="noreferrer">▶ Ver el video del proyecto</a>
              : galeria[1] && <img className="lp-side-img" src={galeria[1].m || galeria[1].url} srcSet={srcsetDe(galeria[1])} sizes="(max-width: 860px) 100vw, 520px"
                  alt={galeria[1].titulo || nombre} loading="lazy" decoding="async" />}
        </div></section>
      )}

      {p.legal_txt && (
        <section className="lp-sec lp-sec-alt"><div className="lp-wrap">
          <div className="lp-trust">
            <div className="lp-trust-ico"><IcoEscudo /></div>
            <div>
              <div className="lp-eyebrow">Respaldo</div>
              <h3>Compra con información clara</h3>
              <p>{p.legal_txt}</p>
            </div>
          </div>
        </div></section>
      )}

      <section className="lp-sec" id="contacto"><div className="lp-wrap lp-split">
        <div>
          <div className="lp-eyebrow">Contacto</div>
          <h2>Te llamamos y resolvemos tus dudas</h2>
          <p className="lp-lead">Déjanos tu nombre y tu número. Un asesor te escribe para contarte precios, lotes disponibles y cómo visitar el proyecto.</p>
          {linkWa && <p className="lp-lead">¿Prefieres escribir tú? <a href={linkWa} target="_blank" rel="noreferrer">Háblanos por WhatsApp</a>.</p>}
        </div>
        <Formulario p={p} linkWa={linkWa} />
      </div></section>

      <footer className="lp-foot"><div className="lp-wrap lp-foot-in">
        <span>© {new Date().getFullYear()} {p.marca || nombre}</span>
        <Link to="/propiedades">Ver otros proyectos</Link>
      </div></footer>

      {linkWa && <a className="lp-fab" href={linkWa} target="_blank" rel="noreferrer" aria-label="Escribir por WhatsApp"><IcoWa size={30} /></a>}
      <div className={'lp-mbar' + (linkWa ? '' : ' lp-mbar-1')}>
        {aWa('lp-btn-wa', 'WhatsApp')}
        <button type="button" className="lp-btn lp-btn-c" onClick={() => ir('contacto')}>Que me llamen</button>
      </div>

      {foto != null && <Visor fotos={galeria} i={foto} nombre={nombre} onNav={setFoto} onClose={() => setFoto(null)} />}
    </div>
  )
}

function Formulario({ p, linkWa }) {
  const [f, setF] = useState({ nombre: '', telefono: '', mensaje: '', empresa: '' })
  const [estado, setEstado] = useState('')      // '' | 'enviando' | 'ok' | 'error:<texto>'
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); if (estado.startsWith('error')) setEstado('') }

  const enviar = async e => {
    e.preventDefault()
    if (f.empresa) { setEstado('ok'); return }                       // campo trampa: solo lo llenan los robots
    if (!f.nombre.trim()) { setEstado('error:Escribe tu nombre.'); return }
    if (f.telefono.replace(/\D/g, '').length < 9) { setEstado('error:Escribe un celular válido (9 dígitos).'); return }
    if (p.borrador) { setEstado('error:Vista previa: el formulario empieza a recibir datos cuando actives la página.'); return }
    setEstado('enviando')
    const { error } = await supabase.from('corr_consultas').insert({
      tipo: 'proyecto', project_id: p.id, origen: 'landing',
      nombre: f.nombre.trim(), telefono: f.telefono.trim(), mensaje: f.mensaje.trim() || null,
    })
    setEstado(error ? 'error:No se pudo enviar. Inténtalo otra vez o escríbenos por WhatsApp.' : 'ok')
  }

  if (estado === 'ok') return (
    <div className="lp-form lp-form-ok">
      <div className="lp-check"><IcoCheck /></div>
      <h3>¡Listo, {f.nombre.trim().split(/\s+/)[0] || 'gracias'}!</h3>
      <p>Recibimos tus datos. Un asesor te contactará muy pronto.</p>
      {linkWa && <a className="lp-btn lp-btn-wa" href={linkWa} target="_blank" rel="noreferrer"><IcoWa /> Adelantar por WhatsApp</a>}
    </div>
  )

  return (
    <form className="lp-form" onSubmit={enviar} noValidate>
      <label>Nombre<input value={f.nombre} onChange={e => set('nombre', e.target.value)} autoComplete="name" placeholder="Tu nombre" /></label>
      <label>Celular / WhatsApp<input value={f.telefono} onChange={e => set('telefono', e.target.value)} autoComplete="tel" inputMode="tel" placeholder="987 654 321" /></label>
      <label>Mensaje (opcional)<textarea value={f.mensaje} onChange={e => set('mensaje', e.target.value)} placeholder="Quiero saber precios y cómo visitar el proyecto" /></label>
      <label className="lp-hp" aria-hidden="true">Empresa<input tabIndex={-1} autoComplete="off" value={f.empresa} onChange={e => set('empresa', e.target.value)} /></label>
      {estado.startsWith('error:') && <p className="lp-err" role="alert">{estado.slice(6)}</p>}
      <button type="submit" className="lp-btn lp-btn-c" disabled={estado === 'enviando'}>{estado === 'enviando' ? 'Enviando…' : 'Quiero que me llamen'}</button>
    </form>
  )
}

function Visor({ fotos, i, nombre, onNav, onClose }) {
  const n = fotos.length
  const toque = useRef(null)
  const mover = d => onNav((i + d + n) % n)

  useEffect(() => {
    const tecla = e => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') onNav((i + 1) % n)
      if (e.key === 'ArrowLeft') onNav((i - 1 + n) % n)
    }
    window.addEventListener('keydown', tecla)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', tecla); document.body.style.overflow = overflow }
  }, [i, n, onNav, onClose])

  const g = fotos[i]
  return (
    <div className="lp-lb" role="dialog" aria-label={'Fotos de ' + nombre} onClick={onClose}
      onTouchStart={e => { toque.current = e.touches[0].clientX }}
      onTouchEnd={e => { const dx = e.changedTouches[0].clientX - (toque.current ?? e.changedTouches[0].clientX); if (Math.abs(dx) > 50 && n > 1) mover(dx < 0 ? 1 : -1) }}>
      <img src={g.url} srcSet={srcsetDe(g)} sizes="94vw" alt={g.titulo || nombre} onClick={e => e.stopPropagation()} />
      <button type="button" className="lp-lb-x" onClick={onClose} aria-label="Cerrar">×</button>
      {n > 1 && <>
        <button type="button" className="lp-lb-prev" onClick={e => { e.stopPropagation(); mover(-1) }} aria-label="Foto anterior">‹</button>
        <button type="button" className="lp-lb-next" onClick={e => { e.stopPropagation(); mover(1) }} aria-label="Foto siguiente">›</button>
      </>}
      <div className="lp-lb-cap">{g.titulo ? g.titulo + ' · ' : ''}{i + 1} / {n}</div>
    </div>
  )
}

const IcoWa = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3a.5.5 0 0 0 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .2-1.2c-.1-.2-.3-.2-.5-.3Z" />
  </svg>
)
const IcoPin = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" /><circle cx="12" cy="10" r="2.5" />
  </svg>
)
const IcoEscudo = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m8.8 12 2.2 2.2 4.3-4.4" />
  </svg>
)
const IcoCheck = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)
