import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { srcsetDe, medianaDe } from '../lib/imagenesWeb'
import { cotizar } from '../lib/plano'
import '../styles/portada.css'

// PORTADA de urbisgroupinmobiliaria.com (pedido de Cesar, 13 nov 2026): "nuestros proyectos
// con su link al landing, algo chévere, una página atractiva, fácil de ver".
// Diseño elegido: "A con la ruta de C" — foto de dron a pantalla completa y los proyectos
// colgados de la Carretera Federico Basadre (Km 0 → 64), cada uno con su tarjeta y su link
// a /p/<slug>. Marca: Urbis Group y Century juntas; cada tarjeta lleva la marca de SU
// proyecto (ver memoria proyectos-independientes).
//
// Todo lo que cambia sale EN VIVO de lo que ya es público:
//   · pub_landing (solo landings activas): foto, logo, "desde", inicial, lotes libres
//   · pub_landing_lotes(slug): los lotes libres para "¿Cuánto puedes pagar al mes?",
//     con la misma cuenta del landing y del contrato (lib/plano.js → cotizar)
//   · pub_propiedades: cuántas propiedades de terceros hay (sección hacia /propiedades)
// Un landing nuevo que se active aparece solo (al final si no está en RUTA).

const R2 = 'https://pub-04e0a91c024a4012960f304ed7528b55.r2.dev/corretaje/proyectos/'
// la primera foto de la portada va fija: así se pinta sin esperar a la base
const PORTADA_FIJA = (() => {
  const b = R2 + '84fab987-937b-5444-8ce1-fdc02f7088d7/landing/1789489862619-fhz0sl-'
  return { s: b + '640.webp', m: b + '1280.webp', l: b + '1920.webp', url: b + '2560.webp', titulo: 'Atardecer en la laguna Cashibococha', proyecto: 'Las Praderas de Cashibo' }
})()

// dónde está cada uno sobre la Carretera Federico Basadre, saliendo de Pucallpa
const RUTA = {
  'praderas-de-pucallpa': { km: 10, orden: 1, lugar: 'Km 10 · Av. Central Sur, Callería' },
  'praderas-de-cashibo': { km: 10, orden: 2, lugar: 'Km 10 · Cashibococha, Yarinacocha' },
  'brisas-de-cashibo': { km: 10, orden: 3, lugar: 'Km 10 · Cashibococha, Yarinacocha' },
  'encanto-de-campo-verde': { km: 31, orden: 4, lugar: 'Km 31 · Campo Verde' },
  'triunfo-de-neshuya': { km: 64, orden: 5, lugar: 'Km 64 · Neshuya, Padre Abad' },
}
const TRAMOS = {
  10: ['Km 10', 'Desvío a Cashibococha y a la Av. Central Sur'],
  31: ['Km 31', 'Campo Verde'],
  64: ['Km 64', 'Neshuya'],
}
// redes de cada proyecto (sus páginas, revisadas el 13 nov 2026)
const REDES = {
  'praderas-de-cashibo': { fb: 'laspraderasdecashibo', ig: 'laspraderasdecashibo' },
  'brisas-de-cashibo': { fb: 'lasbrisasdecashibo', ig: 'lasbrisasdecashibo' },
  'encanto-de-campo-verde': { fb: 'elencantodecampoverde', ig: 'elencantodecampoverde' },
  'triunfo-de-neshuya': { fb: 'eltriunfodeneshuya', ig: 'eltriunfodeneshuya' },
  'praderas-de-pucallpa': { fb: 'Lotizacion.LasPraderas' },
}
const OFICINA = 'Jr. Augusto B. Leguía 482, Callería, Pucallpa'
const MAPS_OFICINA = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Jr. Augusto B. Leguía 482, Pucallpa, Ucayali')
// horario de la oficina (Cesar, 13 nov): lun–vie 9–1 y 3–6 · sáb 9–1. En minutos del día, hora de Lima.
const HORARIO = { 1: [[540, 780], [900, 1080]], 2: [[540, 780], [900, 1080]], 3: [[540, 780], [900, 1080]], 4: [[540, 780], [900, 1080]], 5: [[540, 780], [900, 1080]], 6: [[540, 780]] }

const MINUS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'en'])
const bonito = s => String(s || '').toLowerCase().split(/\s+/).filter(Boolean)
  .map((w, i) => (i > 0 && MINUS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
// "desde" hacia ARRIBA, como en el landing: nunca anunciar menos de lo que cuesta
const soles = n => 'S/ ' + Math.ceil(Number(n)).toLocaleString('es-PE')
const telWa = w => { const d = String(w || '').replace(/\D/g, ''); return d.length === 9 ? '51' + d : d }
const linkWa = (p, nombre) => p.whatsapp ? `https://wa.me/${telWa(p.whatsapp)}?text=${encodeURIComponent(`Hola, vi su página web y quiero información de ${nombre}`)}` : null
const esCentury = p => /century/i.test(p.marca || '')
const NUMEROS = ['', 'Un', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve', 'Diez']
const sinMovimiento = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const ir = id => document.getElementById(id)?.scrollIntoView({ behavior: sinMovimiento() ? 'auto' : 'smooth', block: 'start' })

// la foto de la galería que corresponde a la portada (para tener sus 4 anchos)
const fotoDe = p => {
  const gal = (Array.isArray(p.galeria) ? p.galeria : []).filter(g => g?.url)
  return gal.find(g => g.url === p.portada_url) || (p.portada_url ? { url: p.portada_url } : gal[0]) || null
}

function abiertoAhora() {
  try {
    const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date()).map(x => [x.type, x.value]))
    const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.weekday)
    const min = Number(partes.hour) * 60 + Number(partes.minute)
    return (HORARIO[dia] || []).some(([a, b]) => min >= a && min < b)
  } catch { return null }
}

export default function Portada() {
  const [proys, setProys] = useState(null)        // null = cargando
  const [lotes, setLotes] = useState({})          // slug → pub_landing_lotes (o false)
  const [nProps, setNProps] = useState(0)
  const [hoja, setHoja] = useState(false)         // "¿Qué proyecto te interesa?"
  const [solida, setSolida] = useState(false)     // barra de arriba con fondo
  const [fab, setFab] = useState(false)           // botón flotante de WhatsApp
  const calcRef = useRef(null)

  useEffect(() => {
    let vivo = true
    supabase.from('pub_landing')
      .select('slug, nombre, marca, logo_url, portada_url, galeria, precio_desde, inicial_min, cuotas_max, disponibles, vendidos, tiene_plano, visor_url, tour_url, whatsapp')
      .then(({ data, error }) => {
        if (!vivo) return
        const lista = (error ? [] : data || []).map(p => ({ ...p, nombreBonito: bonito(p.nombre), ruta: RUTA[p.slug] || null, foto: fotoDe(p) }))
          .sort((a, b) => (a.ruta?.orden ?? 99) - (b.ruta?.orden ?? 99) || a.nombreBonito.localeCompare(b.nombreBonito))
        setProys(lista)
      })
    supabase.from('pub_propiedades').select('id', { count: 'exact', head: true })
      .then(({ count }) => { if (vivo) setNProps(count || 0) })
    return () => { vivo = false }
  }, [])

  // los lotes de cada proyecto se piden recién cuando la calculadora se acerca a la pantalla
  useEffect(() => {
    if (!proys?.length || !calcRef.current) return
    let vivo = true
    const pedir = () => proys.forEach(p => supabase.rpc('pub_landing_lotes', { p_slug: p.slug }).then(({ data, error }) => {
      if (vivo) setLotes(x => ({ ...x, [p.slug]: !error && data && Array.isArray(data.lotes) ? data : false }))
    }))
    if (!('IntersectionObserver' in window)) { pedir(); return () => { vivo = false } }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); pedir() } }, { rootMargin: '700px 0px' })
    io.observe(calcRef.current)
    return () => { vivo = false; io.disconnect() }
  }, [proys])

  // pestaña, descripción y fondo mientras la portada está abierta
  useEffect(() => {
    const antes = { title: document.title, bg: document.body.style.background }
    document.title = 'Urbis Group · Century | Lotes en Ucayali con financiamiento directo'
    document.body.style.background = '#0c1f15'
    return () => { document.title = antes.title; document.body.style.background = antes.bg }
  }, [])

  useEffect(() => {
    const mirar = () => {
      setSolida(window.scrollY > 40)
      setFab(window.scrollY > window.innerHeight * 0.75)
    }
    mirar()
    window.addEventListener('scroll', mirar, { passive: true })
    return () => window.removeEventListener('scroll', mirar)
  }, [])

  const lista = proys || []
  const vendidos = lista.reduce((a, p) => a + (p.vendidos || 0), 0)
  const libres = lista.reduce((a, p) => a + (p.disponibles || 0), 0)
  const inis = lista.map(p => Number(p.inicial_min)).filter(n => n > 0)
  const iniMin = inis.length ? Math.min(...inis) : null
  const cuotasMax = Math.max(48, ...lista.map(p => Number(p.cuotas_max) || 0))
  const abrirHoja = () => setHoja(true)

  return (
    <div className="pt">
      <header className={'pt-nav' + (solida ? ' pt-solida' : '')}><div className="pt-wrap">
        <Marcas />
        <nav aria-label="Secciones">
          <a href="#proyectos" onClick={e => { e.preventDefault(); ir('proyectos') }}>Proyectos</a>
          <a href="#cuota" onClick={e => { e.preventDefault(); ir('cuota') }}>Tu cuota</a>
          <Link to="/propiedades">Propiedades</Link>
          <a href="#visitanos" onClick={e => { e.preventDefault(); ir('visitanos') }}>Contacto</a>
        </nav>
        <button type="button" className="pt-btn pt-btn-wa pt-btn-sm" onClick={abrirHoja}><IcoWa /> WhatsApp</button>
      </div></header>

      <section className="pt-hero">
        <FotosHeroe lista={lista} />
        <div className="pt-wrap pt-hero-in">
          <div className="pt-kicker">Lotes en Ucayali</div>
          <h1 className="pt-serif">Tu terreno propio, cerca de todo</h1>
          <p>
            {lista.length ? `${NUMEROS[lista.length] || lista.length} proyecto${lista.length > 1 ? 's' : ''} sobre la Carretera Federico Basadre. ` : 'Proyectos sobre la Carretera Federico Basadre. '}
            {iniMin ? `Inicial desde ${soles(iniMin)} y hasta ${cuotasMax} cuotas sin intereses.` : `Financiamiento directo, hasta ${cuotasMax} cuotas sin intereses.`}
          </p>
          <div className="pt-ctas">
            <button type="button" className="pt-btn pt-btn-am" onClick={() => ir('proyectos')}>Ver proyectos <IcoAbajo /></button>
            <button type="button" className="pt-btn pt-btn-wa" onClick={abrirHoja}><IcoWa /> WhatsApp</button>
          </div>
        </div>
      </section>

      {lista.length > 0 && (
        <div className="pt-cifras" aria-label="Cifras de hoy">
          <div><b>{vendidos.toLocaleString('es-PE')}</b><small>lotes ya vendidos</small></div>
          <div><b>{libres.toLocaleString('es-PE')}</b><small>lotes libres hoy</small></div>
          <div><b>{lista.length}</b><small>proyecto{lista.length > 1 ? 's' : ''} en Ucayali</small></div>
        </div>
      )}

      <section className="pt-sec" id="proyectos" style={{ scrollMarginTop: 60 }}><div className="pt-wrap">
        <div className="pt-aparece">
          <div className="pt-eyebrow">Nuestros proyectos</div>
          <h2 className="pt-serif">Elige dónde empezar</h2>
          <p className="pt-lead">Todos sobre la Carretera Federico Basadre, saliendo de Pucallpa. Precios y lotes libres al día de hoy.</p>
        </div>
        <Ruta proys={proys} />
      </div></section>

      <section className="pt-sec" id="cuota" ref={calcRef} style={{ paddingTop: 8, scrollMarginTop: 70 }}><div className="pt-wrap">
        <Calculadora proys={lista} lotes={lotes} />
      </div></section>

      <section className="pt-sec" style={{ paddingTop: 16 }}><div className="pt-wrap">
        <div className="pt-aparece">
          <div className="pt-eyebrow">Así de fácil</div>
          <h2 className="pt-serif">Compra tu lote en 4 pasos</h2>
        </div>
        <div className="pt-pasos">
          {[
            ['Elige tu lote', 'Entra al proyecto y toca el plano interactivo: cada lote con su medida, su precio y su cuota.'],
            ['Visita el terreno', 'Te llevamos a conocerlo. Si estás lejos, recórrelo en fotos 360° desde tu celular.'],
            ['Sepáralo', 'Con tu pago de separación el lote queda reservado para ti mientras preparamos el contrato.'],
            ['Firma y paga en cuotas', `Contrato con tu cronograma: inicial y hasta ${cuotasMax} cuotas sin intereses, sin bancos.`],
          ].map(([t, d], i) => (
            <div key={t} className="pt-paso pt-aparece"><b>{i + 1}</b><h4>{t}</h4><p>{d}</p></div>
          ))}
        </div>
      </div></section>

      {nProps > 0 && (
        <section className="pt-sec" style={{ paddingTop: 8 }}><div className="pt-wrap">
          <div className="pt-terceros pt-aparece">
            <div>
              <div className="pt-eyebrow">Propiedades de terceros</div>
              <h3>¿Buscas una casa, un local o un terreno ya listo?</h3>
              <p className="pt-lead">También vendemos inmuebles de terceros en Pucallpa: {nProps === 1 ? 'hay 1 propiedad disponible' : `hay ${nProps} propiedades disponibles`} hoy.</p>
            </div>
            <Link className="pt-btn pt-btn-am" to="/propiedades">Ver propiedades →</Link>
          </div>
        </div></section>
      )}

      <section className="pt-sec" id="visitanos" style={{ paddingTop: 8, scrollMarginTop: 60 }}><div className="pt-wrap">
        <div className="pt-aparece">
          <div className="pt-eyebrow">Visítanos</div>
          <h2 className="pt-serif">Conversemos en persona</h2>
          <p className="pt-lead">Te mostramos los planos, los documentos de cada proyecto y te llevamos a conocer el terreno.</p>
        </div>
        <div className="pt-visita">
          <div className="pt-aparece">
            <h4>Oficina</h4>
            <p>{OFICINA}</p>
            <p className="pt-suave">Por el colegio Bautista</p>
            <a className="pt-btn pt-btn-gh pt-btn-sm" href={MAPS_OFICINA} target="_blank" rel="noreferrer"><IcoPin /> Cómo llegar</a>
          </div>
          <div className="pt-aparece">
            <h4>Horario</h4>
            <p>Lunes a viernes<br /><span className="pt-suave">9:00 a. m. – 1:00 p. m. · 3:00 – 6:00 p. m.</span></p>
            <p style={{ marginTop: 8 }}>Sábados<br /><span className="pt-suave">9:00 a. m. – 1:00 p. m.</span></p>
            <Abierto />
          </div>
          <div className="pt-aparece">
            <h4>WhatsApp</h4>
            <p>Cada proyecto tiene su asesor. Elige el tuyo y escríbele directo.</p>
            <button type="button" className="pt-btn pt-btn-wa pt-btn-sm" onClick={abrirHoja}><IcoWa /> ¿Qué proyecto te interesa?</button>
          </div>
        </div>
      </div></section>

      <footer className="pt-pie"><div className="pt-wrap">
        <div className="pt-pie-t">Síguenos</div>
        <div className="pt-redes">
          {lista.filter(p => REDES[p.slug]).map(p => (
            <div key={p.slug} className="pt-red">
              <span>{p.nombreBonito}</span>
              <div>
                {REDES[p.slug].fb && <a href={'https://www.facebook.com/' + REDES[p.slug].fb} target="_blank" rel="noreferrer" aria-label={'Facebook de ' + p.nombreBonito}><IcoFb /></a>}
                {REDES[p.slug].ig && <a href={'https://www.instagram.com/' + REDES[p.slug].ig + '/'} target="_blank" rel="noreferrer" aria-label={'Instagram de ' + p.nombreBonito}><IcoIg /></a>}
              </div>
            </div>
          ))}
        </div>
        <div className="pt-pie-fin">
          <span>© {new Date().getFullYear()} Urbis Group · Century Proyectos Inmobiliarios. Cada proyecto pertenece a su propia empresa.</span>
          <span><Link to="/propiedades">Propiedades</Link> · <a href="/privacidad">Política de privacidad</a></span>
        </div>
      </div></footer>

      <button type="button" className={'pt-fab' + (fab && !hoja ? ' pt-on' : '')} onClick={abrirHoja} aria-hidden={!fab} tabIndex={fab ? 0 : -1}>
        <IcoWa size={22} /> ¿Qué proyecto te interesa?
      </button>
      {hoja && <HojaWa proys={lista} onClose={() => setHoja(false)} />}
    </div>
  )
}

function Marcas() {
  return (
    <Link to="/" className="pt-marcas" aria-label="Urbis Group y Century Proyectos Inmobiliarios — inicio">
      <span className="pt-urbis"><LogoUrbis /><span>URBIS<small>GROUP</small></span></span>
      <span className="pt-sep" />
      <span className="pt-cent">CENTURY<small>PROYECTOS INMOB.</small></span>
    </Link>
  )
}

// Fotos de la portada: la primera fija (se pinta de inmediato) y después la portada de cada
// proyecto, cada 7 s con fundido y zoom lento. Dos <img> a la vez como máximo.
function FotosHeroe({ lista }) {
  const fotos = useMemo(() => {
    const vistas = new Set([PORTADA_FIJA.url])
    const resto = lista.map(p => p.foto && { ...p.foto, proyecto: p.nombreBonito }).filter(f => f?.url && !vistas.has(f.url) && vistas.add(f.url))
    return [PORTADA_FIJA, ...resto]
  }, [lista])
  const [i, setI] = useState(0)
  const [cambio, setCambio] = useState(false)
  const n = fotos.length

  useEffect(() => {
    if (n < 2 || sinMovimiento()) return
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      setCambio(true); setI(x => (x + 1) % n)
    }, 7000)
    return () => clearInterval(t)
  }, [n])
  // la siguiente se baja antes, así el cambio no parpadea
  useEffect(() => {
    if (n < 2) return
    const g = fotos[(i + 1) % n], im = new Image()
    const ss = srcsetDe(g); if (ss) { im.srcset = ss; im.sizes = '100vw' }
    im.src = medianaDe(g)
  }, [i, n, fotos])

  const cur = fotos[i] || PORTADA_FIJA
  const visibles = cambio && n > 1 ? [fotos[(i - 1 + n) % n], cur] : [cur]
  return (<>
    {visibles.map((g, k) => (
      <img key={g.url} className={'pt-hero-img' + (cambio && k === visibles.length - 1 ? ' pt-entra' : '')}
        src={medianaDe(g)} srcSet={srcsetDe(g)} sizes="100vw" alt="" fetchPriority={cambio ? undefined : 'high'} />
    ))}
    <span className="pt-hero-cap">{cur.titulo ? cur.titulo + ' · ' : ''}{cur.proyecto}</span>
  </>)
}

// LA RUTA: Km 0 (Pucallpa) y una parada por kilómetro con las tarjetas de sus proyectos
function Ruta({ proys }) {
  const tramos = useMemo(() => {
    if (!proys) return null
    const por = new Map()
    proys.forEach(p => { const k = p.ruta?.km ?? 'mas'; if (!por.has(k)) por.set(k, []); por.get(k).push(p) })
    return [...por.entries()].sort(([a], [b]) => (a === 'mas' ? 999 : a) - (b === 'mas' ? 999 : b))
  }, [proys])

  return (
    <div className="pt-ruta">
      <div className="pt-via" aria-hidden="true" />
      <div className="pt-tramo">
        <div className="pt-hito pt-hito-0" aria-hidden="true"><span><small>KM</small>0</span></div>
        <div className="pt-tramo-t"><b>Sales de Pucallpa</b><span>Nuestra oficina: {OFICINA}</span></div>
      </div>
      {tramos === null && (
        <div className="pt-tramo">
          <div className="pt-hito" aria-hidden="true"><span><small>KM</small>10</span></div>
          <div className="pt-tramo-t"><b>Cargando proyectos…</b></div>
          <div className="pt-paradas">{[0, 1, 2].map(k => <div key={k} className="pt-card-vacia" />)}</div>
        </div>
      )}
      {tramos?.length === 0 && (
        <div className="pt-tramo"><div className="pt-tramo-t"><b>Muy pronto</b><span>Estamos publicando nuestros proyectos. Escríbenos por WhatsApp.</span></div></div>
      )}
      {tramos?.map(([km, ps]) => {
        const [t, sub] = TRAMOS[km] || (km === 'mas' ? ['Más proyectos', ''] : ['Km ' + km, ''])
        return (
          <div key={km} className="pt-tramo">
            <div className="pt-hito" aria-hidden="true">{km === 'mas' ? <span>+</span> : <span><small>KM</small>{km}</span>}</div>
            <div className="pt-tramo-t"><b>{t}</b>{sub && <span>{sub}</span>}</div>
            <div className={'pt-paradas' + (ps.length === 1 ? ' pt-una' : '')}>{ps.map(p => <Tarjeta key={p.slug} p={p} ancha={ps.length === 1} />)}</div>
          </div>
        )
      })}
      <p className="pt-ruta-nota">Distancias aproximadas por la Carretera Federico Basadre desde Pucallpa.</p>
    </div>
  )
}

function Tarjeta({ p, ancha }) {
  const f = p.foto
  const pocos = p.disponibles > 0 && p.disponibles <= 10
  const chips = [p.tour_url && 'Fotos 360°', p.visor_url && 'Recorrido 3D', p.tiene_plano && 'Plano interactivo'].filter(Boolean)
  return (
    <Link className="pt-card pt-aparece" to={'/p/' + p.slug} aria-label={`${p.nombreBonito}: ver el proyecto`}>
      {f && <img src={medianaDe(f)} srcSet={srcsetDe(f)} sizes={ancha ? '(max-width: 719px) calc(100vw - 98px), 1050px' : '(max-width: 719px) calc(100vw - 98px), (max-width: 1099px) 45vw, 350px'} alt="" loading="lazy" decoding="async" />}
      <div className="pt-card-top">
        {p.logo_url ? <span className="pt-logo"><img src={p.logo_url} alt={p.nombreBonito} loading="lazy" /></span> : <span />}
        {p.disponibles > 0 && <span className="pt-libres"><i />{pocos ? `Últimos ${p.disponibles}` : `${p.disponibles} libres`}</span>}
      </div>
      <div className="pt-card-in">
        {esCentury(p) && <span className="pt-empresa">CENTURY</span>}
        <div className="pt-lugar">{p.ruta?.lugar || 'Ucayali'}</div>
        <h3>{p.nombreBonito}</h3>
        {p.precio_desde != null && <div className="pt-precio">Desde <b>{soles(p.precio_desde)}</b></div>}
        {p.inicial_min ? <div className="pt-ini">Inicial desde {soles(p.inicial_min)} · hasta {p.cuotas_max || 48} cuotas</div> : null}
        {chips.length > 0 && <div className="pt-chips">{chips.map(c => <span key={c} className="pt-chip">{c}</span>)}</div>}
        <span className="pt-ir">Ver el proyecto <IcoFlecha /></span>
      </div>
    </Link>
  )
}

// ¿CUÁNTO PUEDES PAGAR AL MES? Con los lotes libres de verdad (misma cuenta del contrato):
// cuántos de cada proyecto quedan en esa cuota. Mientras llegan, el lote más barato.
const MIN = 200, MAX = 1000
function Calculadora({ proys, lotes }) {
  const [monto, setMonto] = useState(400)
  const filas = useMemo(() => proys.map(p => {
    const d = lotes[p.slug]
    const meses = Number(d?.config?.cuotas) || Number(p.cuotas_max) || 48
    if (d && d.lotes) {
      const cuotas = d.lotes.filter(l => l.estado === 'disponible' && Number(l.total_price) > 0)
        .map(l => cotizar(l.total_price, l.inicial, meses).cuota)
      if (!cuotas.length) return { p, meses, minimo: null, caben: 0, exacto: true }
      return { p, meses, minimo: Math.min(...cuotas), caben: cuotas.filter(c => c <= monto).length, exacto: true }
    }
    if (p.precio_desde == null) return { p, meses, minimo: null, caben: 0 }
    const minimo = cotizar(p.precio_desde, p.inicial_min || 0, meses).cuota
    return { p, meses, minimo, caben: minimo <= monto ? null : 0 }
  }).filter(f => f.minimo != null).sort((a, b) => a.minimo - b.minimo), [proys, lotes, monto])

  const alcanzan = filas.filter(f => f.minimo <= monto).length
  const pct = ((monto - MIN) / (MAX - MIN)) * 100
  return (
    <div className="pt-calc pt-aparece">
      <div>
        <div className="pt-eyebrow">Tu cuota</div>
        <h2 className="pt-serif">¿Cuánto puedes pagar al mes?</h2>
        <p className="pt-lead">Mueve la barra y mira qué proyectos te alcanzan, sin intereses y con la inicial de cada lote.</p>
        <div className="pt-monto" aria-live="polite">{soles(monto)}<small>al mes</small></div>
        <input className="pt-rango" type="range" min={MIN} max={MAX} step={10} value={monto} onChange={e => setMonto(Number(e.target.value))}
          style={{ '--pt-p': pct + '%' }} aria-label="Cuánto puedes pagar al mes, en soles" />
        <div className="pt-rango-ext"><span>{soles(MIN)}</span><span>{soles(MAX)}</span></div>
        {filas.length > 0 && <p className="pt-calc-nota" style={{ marginTop: 12 }}><b>{alcanzan === 0 ? 'Todavía ningún proyecto' : `Te alcanzan ${alcanzan} de ${filas.length} proyectos`}</b>{alcanzan === 0 ? ': sube un poco la cuota o pregunta por más inicial.' : '.'}</p>}
      </div>
      <div>
        <div className="pt-alc">
          {filas.map(({ p, minimo, caben, meses, exacto }) => {
            const ok = minimo <= monto
            return (
              <Link key={p.slug} to={'/p/' + p.slug} className={ok ? '' : 'pt-no'}>
                <span className="pt-alc-ico" aria-hidden="true">{ok ? '✓' : '·'}</span>
                <span className="pt-alc-txt">
                  <b>{p.nombreBonito}</b>
                  <small>{ok
                    ? (exacto ? `${caben} lote${caben === 1 ? '' : 's'} te alcanza${caben === 1 ? '' : 'n'}` : `Te alcanza en ${meses} cuotas`)
                    : `Necesitas desde ${soles(minimo)} al mes`}</small>
                </span>
                <span className="pt-alc-cuota">desde<b>{soles(minimo)}</b></span>
              </Link>
            )
          })}
          {!filas.length && <p className="pt-calc-nota">Cargando los lotes libres…</p>}
        </div>
        <p className="pt-calc-nota">Cuotas mensuales sin intereses en el plazo máximo de cada proyecto ({[...new Set(filas.map(f => f.meses))].join(' / ') || 48} meses), en soles enteros. Tu asesor confirma el lote y las condiciones vigentes.</p>
      </div>
    </div>
  )
}

function Abierto() {
  const [ab, setAb] = useState(abiertoAhora)
  useEffect(() => { const t = setInterval(() => setAb(abiertoAhora()), 60000); return () => clearInterval(t) }, [])
  if (ab === null) return null
  return <span className={'pt-abierto' + (ab ? '' : ' pt-cerrado')}><i />{ab ? 'Abierto ahora' : 'Cerrado ahora'}</span>
}

// "¿Qué proyecto te interesa?": cada proyecto a su propio WhatsApp
function HojaWa({ proys, onClose }) {
  useEffect(() => {
    const tecla = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', tecla)
    const ov = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', tecla); document.body.style.overflow = ov }
  }, [onClose])
  const con = proys.filter(p => p.whatsapp)
  return (<>
    <div className="pt-hoja-fondo" onClick={onClose} />
    <div className="pt-hoja" role="dialog" aria-modal="true" aria-label="¿Qué proyecto te interesa?">
      <div className="pt-hoja-asa" />
      <div className="pt-hoja-cab">
        <h3>¿Qué proyecto te interesa?</h3>
        <button type="button" className="pt-hoja-x" onClick={onClose} aria-label="Cerrar">×</button>
      </div>
      <p>Te atiende el asesor de ese proyecto por WhatsApp.</p>
      <div className="pt-hoja-lista">
        {con.map(p => (
          <a key={p.slug} href={linkWa(p, p.nombreBonito)} target="_blank" rel="noreferrer" onClick={onClose}>
            <span className="pt-hoja-logo">{p.logo_url && <img src={p.logo_url} alt="" />}</span>
            <div><b>{p.nombreBonito}</b><small>{p.ruta?.lugar || 'Ucayali'}{esCentury(p) ? ' · Century' : ''}</small></div>
            <span className="pt-hoja-wa"><IcoWa /></span>
          </a>
        ))}
        {!con.length && <p style={{ fontSize: 14 }}>Cargando…</p>}
      </div>
    </div>
  </>)
}

const LogoUrbis = () => (
  <svg width="30" height="30" viewBox="0 0 100 100" aria-hidden="true">
    <polygon points="50,4 63,17 50,30 37,17" fill="#b9c7a5" />
    <polygon points="33,14 47,26 47,64 33,52" fill="#b9c7a5" />
    <polygon points="67,14 53,26 53,64 67,52" fill="#7f9a6c" />
    <polygon points="8,50 30,50 44,64 22,64" fill="#b9c7a5" />
    <polygon points="92,50 70,50 56,64 78,64" fill="#7f9a6c" />
  </svg>
)
const IcoWa = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3a.5.5 0 0 0 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .2-1.2c-.1-.2-.3-.2-.5-.3Z" />
  </svg>
)
const IcoAbajo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
)
const IcoFlecha = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)
const IcoPin = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" /><circle cx="12" cy="10" r="2.5" /></svg>
)
const IcoFb = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21h3.1Z" /></svg>
)
const IcoIg = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" /></svg>
)
