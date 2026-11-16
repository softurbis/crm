import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { contar } from '../lib/contador'
import { Marcas, IcoWa, IcoLibro } from './Portada'
import TarjetaPropiedad, { IcoCasa, IcoPin } from '../components/TarjetaPropiedad'
import {
  TIPO, ESTADO, precioTxt, refDe, esUuid, tituloDe, lugarDe, nombrePropio, oracion, areaTxt,
  linkWaPropiedad, ordenar,
} from '../lib/propiedades'
import '../styles/portada.css'
import '../styles/propiedades.css'

// PROPIEDADES DE TERCEROS (corretaje) en urbisgroupinmobiliaria.com — rehecha el 16 nov 2026
// ("la página de corretaje arregla, que ya empezaremos a usar; ponlo dentro de la web"):
//   /propiedades         → la lista, con el diseño de la portada (antes: estilo viejo y una
//                          pestaña de proyectos que ya vive en la portada)
//   /propiedades/<ref>   → la página de CADA propiedad, para compartir por WhatsApp y redes
// Lee solo la vista pública pub_propiedades (sql/232). El formulario inserta en
// corr_consultas (anon solo puede insertar) y llega al panel: Corretaje → Consultas.
// 'vender' = el dueño de un inmueble que quiere que lo vendamos.

export default function Publico() {
  const { ref } = useParams()
  return ref ? <Ficha refProp={String(ref).toLowerCase()} /> : <Lista />
}

// ---------------------------------------------------------------------------------------
// barra de arriba y pie, iguales a los de la portada
function Marco({ children, enLista }) {
  return (
    <div className="pt pp">
      <header className="pt-nav pt-solida"><div className="pt-wrap">
        <Marcas />
        <nav aria-label="Secciones">
          <Link to="/">Inicio</Link>
          <Link to="/#proyectos">Proyectos</Link>
          <Link to="/propiedades" className="pp-activo">Propiedades</Link>
          <Link to="/#visitanos">Contacto</Link>
        </nav>
        {enLista
          ? <Link className="pt-btn pt-btn-gh pt-btn-sm" to="/#proyectos">Proyectos</Link>
          : <Link className="pt-btn pt-btn-gh pt-btn-sm" to="/propiedades">Todas</Link>}
      </div></header>
      {children}
      <footer className="pt-pie"><div className="pt-wrap">
        <Link to="/libro-de-reclamaciones" className="pt-libro">
          <span className="pt-libro-ico"><IcoLibro /></span>
          <span><b>Libro de Reclamaciones</b><small>Registra aquí tu reclamo o queja</small></span>
        </Link>
        <div className="pt-pie-fin">
          <span>© {new Date().getFullYear()} Urbis Group · Century Proyectos Inmobiliarios. Las propiedades de esta sección son de terceros: Urbis Group las vende como corredor.</span>
          <span><Link to="/">Inicio</Link> · <Link to="/libro-de-reclamaciones">Libro de Reclamaciones</Link> · <a href="/privacidad">Política de privacidad</a></span>
        </div>
      </div></footer>
    </div>
  )
}

const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const ORDEN_TIPOS = Object.keys(TIPO)

// ---------------------------------------------------------------------------------------
// LA LISTA
function Lista() {
  const [props, setProps] = useState(null)       // null = cargando
  const [tipo, setTipo] = useState('')
  const [distrito, setDistrito] = useState('')
  const [q, setQ] = useState('')
  const [vendidas, setVendidas] = useState(false)
  // /propiedades?vender=1 (botón de la portada) abre de una vez el formulario para vender
  const [qs] = useSearchParams()
  const [vender, setVender] = useState(qs.get('vender') === '1')

  useEffect(() => {
    document.title = 'Propiedades en venta en Ucayali · Urbis Group'
    let vivo = true
    supabase.from('pub_propiedades').select('*').then(({ data, error }) => { if (vivo) setProps(error ? [] : ordenar(data || [])) })
    return () => { vivo = false }
  }, [])

  const todas = props || []
  const activas = todas.filter(p => p.estado !== 'vendido')
  const tipos = ORDEN_TIPOS.filter(t => todas.some(p => p.tipo === t))
  const distritos = [...new Set(todas.map(p => nombrePropio(p.distrito)).filter(Boolean))].sort()
  const hayVendidas = todas.length > activas.length
  const filtradas = todas.filter(p =>
    (vendidas || p.estado !== 'vendido') && (!tipo || p.tipo === tipo) && (!distrito || nombrePropio(p.distrito) === distrito) &&
    (!q || sinTildes([p.titulo, p.zona, p.distrito, p.codigo, TIPO[p.tipo]].join(' ')).includes(sinTildes(q))))
  const conFiltros = todas.length >= 4

  return (
    <Marco enLista>
      <section className="pp-hero"><div className="pt-wrap">
        <div className="pt-eyebrow">Propiedades en venta</div>
        <h1 className="pt-serif">Casas, terrenos y locales en Ucayali</h1>
        <p className="pt-lead">Inmuebles de terceros que vendemos en Pucallpa y alrededores. Mira las fotos, elige y escríbenos: coordinamos tu visita.</p>
        {props && activas.length > 0 && (
          <div className="pp-hero-cifra"><b>{activas.length}</b> {activas.length === 1 ? 'propiedad disponible' : 'propiedades disponibles'} hoy</div>
        )}
      </div></section>

      <section className="pp-claro"><div className="pt-wrap">
        {conFiltros && (
          <div className="pp-filtros">
            <div className="pp-chips" role="group" aria-label="Tipo de inmueble">
              <button type="button" className={'pp-chip' + (!tipo ? ' pp-on' : '')} onClick={() => setTipo('')}>Todas</button>
              {tipos.map(t => <button key={t} type="button" className={'pp-chip' + (tipo === t ? ' pp-on' : '')} onClick={() => setTipo(t)}>{TIPO[t]}</button>)}
            </div>
            {distritos.length > 1 && (
              <select value={distrito} onChange={e => setDistrito(e.target.value)} aria-label="Distrito">
                <option value="">Todos los distritos</option>
                {distritos.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por zona, código o palabra…" aria-label="Buscar" />
            {hayVendidas && <label><input type="checkbox" checked={vendidas} onChange={e => setVendidas(e.target.checked)} /> Ver también las vendidas</label>}
          </div>
        )}

        {props === null && <p className="pp-cuenta">Cargando propiedades…</p>}
        {props && !filtradas.length && (
          <div className="pp-vacio">
            <IcoCasa size={46} />
            <b>{todas.length ? 'No hay propiedades con esos filtros' : 'Pronto publicaremos nuevas propiedades'}</b>
            <span>{todas.length ? 'Prueba con otro tipo o distrito.' : 'Mientras tanto, mira nuestros proyectos de lotes con financiamiento directo.'}</span>
          </div>
        )}
        {filtradas.length > 0 && conFiltros && (tipo || distrito || q) && <p className="pp-cuenta">{filtradas.length} de {todas.length} propiedades</p>}
        {filtradas.length > 0 && <div className={'pp-grid' + (filtradas.length === 1 ? ' pp-grid-1' : '')}>{filtradas.map(p => <TarjetaPropiedad key={p.id} p={p} />)}</div>}

        <div className="pp-bandas">
          <div className="pp-banda pp-banda-vender">
            <div className="pt-eyebrow">¿Tienes un inmueble?</div>
            <h3>Te ayudamos a venderlo</h3>
            <p>Casa, terreno, local o departamento en Ucayali: déjanos tus datos y te llamamos para conocerlo.</p>
            <button type="button" className="pt-btn pt-btn-am" onClick={() => setVender(true)}>Quiero vender mi propiedad</button>
          </div>
          <div className="pp-banda pp-banda-proy">
            <div className="pt-eyebrow" style={{ color: '#14211a' }}>¿Prefieres un lote propio?</div>
            <h3>Lotes con financiamiento directo</h3>
            <p>Nuestros proyectos sobre la Carretera Federico Basadre, con cuotas sin intereses y sin bancos.</p>
            <Link className="pt-btn pp-btn-osc" to="/#proyectos">Ver proyectos →</Link>
          </div>
        </div>
      </div></section>

      {vender && (
        <Modal onClose={() => setVender(false)}>
          <Formulario tipo="vender" titulo="Quiero vender mi propiedad"
            texto="Cuéntanos qué tienes y dónde. Te llamamos para conocerlo y explicarte cómo trabajamos."
            placeholder="Ej.: casa de 2 pisos en Yarinacocha, 160 m², con título" />
        </Modal>
      )}
    </Marco>
  )
}

// ---------------------------------------------------------------------------------------
// LA PÁGINA DE UNA PROPIEDAD
function Ficha({ refProp }) {
  const [p, setP] = useState(undefined)          // undefined = cargando · null = no está publicada
  const [otras, setOtras] = useState([])
  const [i, setI] = useState(0)
  const [visor, setVisor] = useState(false)
  const [toast, setToast] = useState('')
  const formRef = useRef(null)

  useEffect(() => {
    let vivo = true
    setP(undefined); setI(0)
    // el link lleva el código en minúsculas (o el id); ilike lo encuentra con o sin sql/232
    const base = supabase.from('pub_propiedades').select('*')
    ;(esUuid(refProp) ? base.eq('id', refProp) : base.ilike('codigo', refProp)).limit(1)
      .then(({ data, error }) => { if (vivo) setP(!error && data?.[0] ? data[0] : null) })
    supabase.from('pub_propiedades').select('*').then(({ data }) => {
      if (vivo) setOtras(ordenar((data || []).filter(x => refDe(x) !== refProp && x.id !== refProp && x.estado !== 'vendido')).slice(0, 3))
    })
    return () => { vivo = false }
  }, [refProp])

  useEffect(() => {
    if (p) document.title = `${tituloDe(p)} · ${precioTxt(p.precio, p.moneda)} · Urbis Group`
    else if (p === null) document.title = 'Propiedad no disponible · Urbis Group'
  }, [p])

  const fotos = p?.fotos || []
  const n = fotos.length
  const mover = d => setI(x => (x + d + n) % n)
  const linkWa = p ? linkWaPropiedad(p) : null
  const datos = useMemo(() => p ? fichaDatos(p) : [], [p])

  const compartir = async () => {
    const url = location.origin + '/propiedades/' + refDe(p)
    const info = { title: tituloDe(p), text: `${tituloDe(p)} · ${precioTxt(p.precio, p.moneda)}`, url }
    if (navigator.share) { try { await navigator.share(info); return } catch (e) { if (e?.name === 'AbortError') return } }
    try { await navigator.clipboard.writeText(url); avisar('Link copiado: pégalo donde quieras') } catch { window.prompt('Copia este link:', url) }
  }
  const avisar = t => { setToast(t); setTimeout(() => setToast(''), 2600) }
  const irForm = () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  if (p === undefined) return <Marco><section className="pp-claro pp-ficha-sec" style={{ minHeight: '70vh' }}><div className="pt-wrap"><p className="pp-cuenta">Cargando…</p></div></section></Marco>
  if (p === null) return (
    <Marco>
      <section className="pp-claro pp-ficha-sec" style={{ minHeight: '70vh' }}><div className="pt-wrap">
        <div className="pp-vacio" style={{ marginTop: 20 }}>
          <IcoCasa size={46} />
          <b>Esta propiedad ya no está publicada</b>
          <span>Puede que se haya vendido. Mira las que están disponibles hoy.</span>
          <Link className="pt-btn pp-btn-osc" to="/propiedades" style={{ marginTop: 8 }}>Ver propiedades →</Link>
        </div>
      </div></section>
    </Marco>
  )

  const lugar = lugarDe(p)
  const region = [p.provincia, p.departamento].filter(Boolean).map(nombrePropio).join(', ')

  return (
    <Marco>
      <section className="pp-claro pp-ficha-sec"><div className="pt-wrap">
        <Link to="/propiedades" className="pp-volver">← Todas las propiedades</Link>

        <div className="pp-ficha">
          <div className="pp-gal">
            <div className="pp-gal-main">
              {n > 0
                ? <button type="button" className="pp-gal-img" onClick={() => setVisor(true)} aria-label="Ver la foto en grande">
                    <img src={fotos[i]} alt={`${tituloDe(p)} — foto ${i + 1} de ${n}`} />
                  </button>
                : <div className="pp-sinfoto"><IcoCasa size={60} /></div>}
              <span className={'pp-estado pp-e-' + (p.estado || 'disponible')}>{ESTADO[p.estado] || 'Disponible'}</span>
              {n > 1 && <>
                <button type="button" className="pp-flecha pp-izq" onClick={() => mover(-1)} aria-label="Foto anterior"><Flecha izq /></button>
                <button type="button" className="pp-flecha pp-der" onClick={() => mover(1)} aria-label="Foto siguiente"><Flecha /></button>
                <span className="pp-gal-n">{i + 1} / {n}</span>
              </>}
            </div>
            {n > 1 && (
              <div className="pp-tiras">
                {fotos.map((f, k) => (
                  <button key={f} type="button" className={'pp-tira' + (k === i ? ' pp-on' : '')} onClick={() => setI(k)} aria-label={`Foto ${k + 1}`}>
                    <img src={f} alt="" loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <aside className="pp-resumen">
            <span className={'pp-estado pp-e-' + (p.estado || 'disponible')}>{ESTADO[p.estado] || 'Disponible'}</span>
            <div className="pp-precio">{precioTxt(p.precio, p.moneda)}</div>
            {p.cuota_ref && <div className="pp-cuota">{oracion(p.cuota_ref)}</div>}
            <h1>{tituloDe(p)}</h1>
            {lugar && <p className="pp-lugar"><IcoPin size={17} /> <span>{lugar}{region ? <><br />{region}</> : null}</span></p>}
            {p.codigo && <span className="pp-codigo">Código {p.codigo}</span>}
            <div className="pp-acciones">
              {linkWa && p.estado !== 'vendido' && <a className="pt-btn pt-btn-wa" href={linkWa} target="_blank" rel="noreferrer"><IcoWa /> Escribir por WhatsApp</a>}
              {p.estado !== 'vendido' && <button type="button" className={'pt-btn ' + (linkWa ? 'pp-btn-linea' : 'pp-btn-osc')} onClick={irForm}>Quiero que me llamen</button>}
              <button type="button" className="pt-btn pp-btn-linea" onClick={compartir}><IcoCompartir /> Compartir</button>
            </div>
          </aside>
        </div>

        <div className="pp-cuerpo">
          <div>
            {datos.length > 0 && (
              <section className="pp-bloque">
                <h2>Características</h2>
                <dl className="pp-datos">{datos.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
              </section>
            )}
            {p.descripcion && <section className="pp-bloque"><h2>Descripción</h2><p className="pp-texto">{oracion(p.descripcion)}</p></section>}
            {p.condiciones && <section className="pp-bloque"><h2>Condiciones</h2><p className="pp-texto">{oracion(p.condiciones)}</p></section>}
            {(lugar || region || p.referencias) && (
              <section className="pp-bloque pp-ubic">
                <h2>Ubicación</h2>
                {lugar && <p><b>{lugar}</b></p>}
                {region && <p>{region}</p>}
                {p.referencias && <p className="pp-ref">Referencia: {oracion(p.referencias)}</p>}
              </section>
            )}
          </div>
          <div ref={formRef} id="contacto" className="pp-bloque">
            {p.estado === 'vendido'
              ? <div className="pp-form"><h3>Esta propiedad ya se vendió</h3><p>Mira las otras que tenemos disponibles.</p><Link className="pt-btn pp-btn-osc" to="/propiedades">Ver propiedades →</Link></div>
              : <Formulario tipo="propiedad" p={p} titulo="¿Te interesa? Te llamamos"
                  texto="Déjanos tu nombre y tu celular, y un asesor te contacta para resolver tus dudas y coordinar la visita."
                  placeholder="Ej.: ¿se puede visitar este sábado?" linkWa={linkWa} />}
          </div>
        </div>

        {otras.length > 0 && (
          <section className="pp-otras">
            <h2 className="pt-serif">Otras propiedades</h2>
            <div className="pp-grid">{otras.map(x => <TarjetaPropiedad key={x.id} p={x} />)}</div>
          </section>
        )}
      </div></section>

      {p.estado !== 'vendido' && (
        <div className={'pp-mbar' + (linkWa ? '' : ' pp-mbar-1')}>
          {linkWa && <a className="pt-btn pt-btn-wa" href={linkWa} target="_blank" rel="noreferrer"><IcoWa /> WhatsApp</a>}
          <button type="button" className="pt-btn pp-btn-osc" onClick={irForm}>Que me llamen</button>
        </div>
      )}
      {visor && n > 0 && <Visor fotos={fotos} i={i} onNav={setI} onClose={() => setVisor(false)} titulo={tituloDe(p)} />}
      {toast && <div className="pp-toast" role="status">{toast}</div>}
    </Marco>
  )
}

// lo que va en "Características": solo lo que está lleno
function fichaDatos(p) {
  const d = [['Tipo', TIPO[p.tipo] || 'Propiedad']]
  const a = areaTxt(p); if (a) d.push(['Área', a])
  if (p.frente) d.push(['Frente', Number(p.frente).toLocaleString('es-PE') + ' m'])
  if (p.fondo) d.push(['Fondo', Number(p.fondo).toLocaleString('es-PE') + ' m'])
  if (p.dormitorios) d.push(['Dormitorios', p.dormitorios])
  if (p.banos) d.push(['Baños', p.banos])
  const extra = p.caracteristicas
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    for (const [k, v] of Object.entries(extra)) if (v != null && String(v).trim() !== '') d.push([oracion(k), oracion(String(v))])
  }
  return d
}

// ---------------------------------------------------------------------------------------
// FORMULARIO → corr_consultas (Corretaje → Consultas en el panel)
function Formulario({ tipo, p, titulo, texto, placeholder, linkWa }) {
  const [f, setF] = useState({ nombre: '', telefono: '', mensaje: '', empresa: '' })
  const [estado, setEstado] = useState('')     // '' | 'enviando' | 'ok' | 'error:<texto>'
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); if (estado.startsWith('error')) setEstado('') }

  const enviar = async e => {
    e.preventDefault()
    if (f.empresa) { setEstado('ok'); return }                                  // campo trampa: solo lo llenan los robots
    if (!f.nombre.trim()) { setEstado('error:Escribe tu nombre.'); return }
    if (f.telefono.replace(/\D/g, '').length < 9) { setEstado('error:Escribe un celular válido (9 dígitos).'); return }
    if (tipo === 'vender' && !f.mensaje.trim()) { setEstado('error:Cuéntanos qué inmueble quieres vender y dónde está.'); return }
    setEstado('enviando')
    const fila = { tipo, origen: 'web', nombre: f.nombre.trim(), telefono: f.telefono.trim(), mensaje: f.mensaje.trim() || null }
    if (p) fila.propiedad_id = p.id
    const { error } = await supabase.from('corr_consultas').insert(fila)
    if (!error) contar('formulario', tipo === 'vender' ? 'vender' : refDe(p))
    setEstado(error ? 'error:No se pudo enviar. Inténtalo otra vez' + (linkWa ? ' o escríbenos por WhatsApp.' : '.') : 'ok')
  }

  if (estado === 'ok') return (
    <div className="pp-form pp-form-ok">
      <i>✓</i>
      <h3>¡Listo, {f.nombre.trim().split(/\s+/)[0] || 'gracias'}!</h3>
      <p>Recibimos tus datos. Un asesor de Urbis Group te llamará pronto.</p>
      {linkWa && <a className="pt-btn pt-btn-wa" href={linkWa} target="_blank" rel="noreferrer"><IcoWa /> Adelantar por WhatsApp</a>}
    </div>
  )
  return (
    <form className="pp-form" onSubmit={enviar} noValidate>
      <h3>{titulo}</h3>
      {texto && <p>{texto}</p>}
      <label>Nombre<input value={f.nombre} onChange={e => set('nombre', e.target.value)} autoComplete="name" /></label>
      <label>Celular / WhatsApp<input value={f.telefono} onChange={e => set('telefono', e.target.value)} autoComplete="tel" inputMode="tel" placeholder="987 654 321" /></label>
      <label>{tipo === 'vender' ? '¿Qué quieres vender?' : 'Mensaje (opcional)'}<textarea value={f.mensaje} onChange={e => set('mensaje', e.target.value)} placeholder={placeholder} /></label>
      <label className="pp-trampa" aria-hidden="true">Empresa<input tabIndex={-1} autoComplete="off" value={f.empresa} onChange={e => set('empresa', e.target.value)} /></label>
      {estado.startsWith('error:') && <p className="pp-form-err" role="alert">{estado.slice(6)}</p>}
      <button type="submit" className="pt-btn pt-btn-am" disabled={estado === 'enviando'}>{estado === 'enviando' ? 'Enviando…' : 'Enviar'}</button>
    </form>
  )
}

function Modal({ children, onClose }) {
  useEffect(() => {
    const tecla = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', tecla)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', tecla); document.body.style.overflow = antes }
  }, [onClose])
  return (
    <div className="pp-modal-fondo" onClick={onClose}>
      <div className="pp-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <button type="button" className="pp-x" onClick={onClose} aria-label="Cerrar">×</button>
        {children}
      </div>
    </div>
  )
}

// las fotos a pantalla completa: flechas, teclado y deslizar con el dedo
function Visor({ fotos, i, onNav, onClose, titulo }) {
  const n = fotos.length
  const toque = useRef(null)
  useEffect(() => {
    const tecla = e => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') onNav((i + 1) % n)
      if (e.key === 'ArrowLeft') onNav((i - 1 + n) % n)
    }
    window.addEventListener('keydown', tecla)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', tecla); document.body.style.overflow = antes }
  }, [i, n, onNav, onClose])
  return (
    <div className="pp-visor" role="dialog" aria-modal="true" aria-label={'Fotos de ' + titulo} onClick={onClose}
      onTouchStart={e => { toque.current = e.touches[0].clientX }}
      onTouchEnd={e => {
        const dx = e.changedTouches[0].clientX - (toque.current ?? 0)
        if (Math.abs(dx) > 45 && n > 1) onNav(dx < 0 ? (i + 1) % n : (i - 1 + n) % n)
      }}>
      <img src={fotos[i]} alt={`${titulo} — foto ${i + 1} de ${n}`} onClick={e => e.stopPropagation()} />
      <button type="button" className="pp-x" onClick={onClose} aria-label="Cerrar">×</button>
      {n > 1 && <>
        <button type="button" className="pp-flecha pp-izq" onClick={e => { e.stopPropagation(); onNav((i - 1 + n) % n) }} aria-label="Foto anterior"><Flecha izq /></button>
        <button type="button" className="pp-flecha pp-der" onClick={e => { e.stopPropagation(); onNav((i + 1) % n) }} aria-label="Foto siguiente"><Flecha /></button>
        <div className="pp-visor-n">{i + 1} / {n}</div>
      </>}
    </div>
  )
}

const Flecha = ({ izq }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={izq ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
  </svg>
)
const IcoCompartir = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
  </svg>
)
