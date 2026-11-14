import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { TIPOS, MEDIOS, DOCS, LEYENDAS, PLAZO_DIAS, bonito, soles, fechaHoraPe, descargarHoja } from '../lib/libroReclamaciones'
import '../styles/libro.css'

// LIBRO DE RECLAMACIONES VIRTUAL — urbisgroupinmobiliaria.com/libro-de-reclamaciones (sql/230)
// Obligatorio para quien vende a consumidores (Ley 29571 y su reglamento, DS 011-2011-PCM
// modificado por DS 101-2022-PCM). Pedido del dueño, 14 nov 2026:
//   · el cliente elige el PROYECTO y la hoja sale a nombre de SU empresa (razón social, RUC y
//     domicilio fiscal del facturador) + "Atención: Jr. Augusto B. Leguía 482";
//   · el número es correlativo por RUC y año y lo pone la base al enviar (libro_reclamar);
//   · el cliente ve su hoja al instante en /libro-de-reclamaciones/<clave> y la descarga en PDF
//     (por ahora no se manda correo);
//   · al dueño le llega un Telegram (agente/avisos_reclamos.js) y se responde desde el panel (/reclamos).
// Aquí no hay sesión: la página no lee la tabla, solo pub_libro_empresas y las dos funciones públicas.

const VACIO = {
  slug: '', nombre: '', doc_tipo: 'DNI', doc_numero: '', domicilio: '', telefono: '', correo: '',
  menor_de_edad: false, apoderado_nombre: '', apoderado_doc: '',
  bien_tipo: 'producto', bien_descripcion: '', monto: '',
  tipo: '', detalle: '', pedido: '', respuesta_medio: '', acepta_datos: false,
}
const BORRADOR = 'libro-reclamaciones-borrador'
const leerBorrador = () => { try { return JSON.parse(localStorage.getItem(BORRADOR) || 'null') } catch { return null } }
const guardarBorrador = f => { try { localStorage.setItem(BORRADOR, JSON.stringify(f)) } catch { /* sin almacenamiento: no pasa nada */ } }
const borrarBorrador = () => { try { localStorage.removeItem(BORRADOR) } catch { /* idem */ } }

const ORDEN = { 'praderas-de-pucallpa': 1, 'praderas-de-cashibo': 2, 'brisas-de-cashibo': 3, 'encanto-de-campo-verde': 4, 'triunfo-de-neshuya': 5 }

function IcoLibro({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z" />
      <path d="M12 6v13.5" />
    </svg>
  )
}

// lo mismo que revisa la base (libro_reclamar), para avisar antes de enviar
function revisar(f) {
  const dig = s => String(s || '').replace(/\D/g, '')
  const doc = String(f.doc_numero || '').replace(/[^A-Za-z0-9]/g, '')
  if (!f.slug) return ['slug', 'Elige el proyecto sobre el que es tu reclamo.']
  if (f.nombre.trim().length < 5) return ['nombre', 'Escribe tu nombre completo.']
  if (f.doc_tipo === 'DNI' && !/^\d{8}$/.test(doc)) return ['doc_numero', 'El DNI tiene 8 números.']
  if (f.doc_tipo !== 'DNI' && !/^[A-Za-z0-9]{6,15}$/.test(doc)) return ['doc_numero', 'Revisa el número de tu documento.']
  if (f.domicilio.trim().length < 5) return ['domicilio', 'Escribe tu domicilio.']
  if (dig(f.telefono).length < 7 || dig(f.telefono).length > 15) return ['telefono', 'Escribe un teléfono o celular válido.']
  if (f.correo.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.correo.trim())) return ['correo', 'Revisa tu correo electrónico.']
  if (f.menor_de_edad && f.apoderado_nombre.trim().length < 5) return ['apoderado_nombre', 'Escribe el nombre de tu padre, madre o apoderado.']
  if (f.bien_descripcion.trim().length < 3) return ['bien_descripcion', 'Escribe qué contrataste (por ejemplo, el lote).']
  if (String(f.monto).trim() && !/^\d{1,10}(\.\d{1,2})?$/.test(String(f.monto).replace(/,/g, '').trim())) return ['monto', 'Revisa el monto: solo números.']
  if (!f.tipo) return ['tipo', 'Elige si es un reclamo o una queja.']
  if (f.detalle.trim().length < 10) return ['detalle', 'Cuéntanos con más detalle qué pasó.']
  if (f.pedido.trim().length < 3) return ['pedido', 'Escribe qué pides que hagamos.']
  if (!f.respuesta_medio) return ['respuesta_medio', 'Elige cómo quieres recibir la respuesta.']
  if (f.respuesta_medio === 'correo' && !f.correo.trim()) return ['correo', 'Para responderte por correo, escribe tu correo electrónico.']
  if (!f.acepta_datos) return ['acepta_datos', 'Marca la casilla para que podamos usar tus datos al atender tu reclamo.']
  return null
}

export default function LibroReclamaciones() {
  const { token } = useParams()
  useEffect(() => { document.title = 'Libro de Reclamaciones · Urbis Group · Century' }, [])
  return (
    <div className="lr">
      <header className="lr-cab">
        <div className="lr-wrap">
          <Link to="/" className="lr-volver">← Inicio</Link>
          <div className="lr-titulo">
            <span className="lr-ico"><IcoLibro size={30} /></span>
            <div>
              <h1>Libro de Reclamaciones</h1>
              <p>Conforme al Código de Protección y Defensa del Consumidor (Ley 29571)</p>
            </div>
          </div>
        </div>
      </header>
      <main className="lr-wrap">
        {token ? <VerHoja token={token} /> : <Formulario />}
      </main>
      <footer className="lr-pie lr-wrap">
        <p>Urbis Group · Century Proyectos Inmobiliarios. Cada proyecto pertenece a su propia empresa.</p>
        <p><Link to="/">Inicio</Link> · <a href="/privacidad">Política de privacidad</a></p>
      </footer>
    </div>
  )
}

function Formulario() {
  const nav = useNavigate()
  const [qs] = useSearchParams()
  const [empresas, setEmpresas] = useState(null)
  const [f, setF] = useState(() => ({ ...VACIO, ...(leerBorrador() || {}), acepta_datos: false }))
  const [err, setErr] = useState(null)        // [campo, mensaje]
  const [enviando, setEnviando] = useState(false)
  const [trampa, setTrampa] = useState('')    // campo escondido: los robots lo llenan, las personas no

  useEffect(() => {
    supabase.from('pub_libro_empresas').select('*').then(({ data }) => {
      const lista = (data || []).map(e => ({ ...e, proyecto: bonito(e.nombre) }))
        .sort((a, b) => (ORDEN[a.slug] ?? 99) - (ORDEN[b.slug] ?? 99) || a.proyecto.localeCompare(b.proyecto))
      setEmpresas(lista)
      const pedido = qs.get('p')
      if (pedido && lista.some(e => e.slug === pedido)) setF(x => ({ ...x, slug: pedido }))
    })
  }, [qs])
  useEffect(() => { const { acepta_datos, ...resto } = f; guardarBorrador(resto) }, [f])

  const emp = useMemo(() => (empresas || []).find(e => e.slug === f.slug), [empresas, f.slug])
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); if (err?.[0] === k) setErr(null) }
  const campo = k => ({ value: f[k], onChange: e => set(k, e.target.value), 'aria-invalid': err?.[0] === k || undefined, id: 'lr-' + k })
  const errDe = k => err?.[0] === k && <p className="lr-err" role="alert">{err[1]}</p>

  async function enviar(e) {
    e.preventDefault()
    if (enviando) return
    const malo = revisar(f)
    if (malo) {
      setErr(malo)
      requestAnimationFrame(() => document.getElementById('lr-' + malo[0])?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
      return
    }
    if (trampa) { setErr(['enviar', 'No se pudo enviar. Inténtalo de nuevo.']); return }
    setEnviando(true); setErr(null)
    const { data, error } = await supabase.rpc('libro_reclamar', {
      p: { ...f, monto: String(f.monto || '').replace(/,/g, '').trim(), doc_numero: f.doc_numero.trim() },
    })
    setEnviando(false)
    if (error || !data?.token) {
      // P0001 = los avisos de libro_reclamar (ya vienen en español para el cliente)
      setErr(['enviar', error?.code === 'P0001' && error.message ? error.message : 'No se pudo enviar tu hoja. Revisa tu conexión e inténtalo de nuevo.'])
      return
    }
    borrarBorrador()
    try { sessionStorage.setItem('libro-recien-' + data.token, '1') } catch { /* nada */ }
    nav('/libro-de-reclamaciones/' + data.token, { replace: true })
  }

  return (
    <form className="lr-form" onSubmit={enviar} noValidate>
      <p className="lr-intro">
        Llena esta hoja si tienes un reclamo o una queja sobre alguno de nuestros proyectos. Al enviarla verás tu
        hoja con su número y podrás descargarla. Te responderemos en un plazo no mayor a <b>{PLAZO_DIAS} días hábiles</b>.
      </p>

      <section className="lr-sec">
        <h2><span>1</span> ¿Sobre qué proyecto es?</h2>
        {empresas === null && <p className="lr-suave">Cargando proyectos…</p>}
        {empresas?.length === 0 && <p className="lr-err">No se pudieron cargar los proyectos. Recarga la página.</p>}
        <div className="lr-proys" id="lr-slug">
          {(empresas || []).map(e => (
            <label key={e.slug} className={'lr-proy' + (f.slug === e.slug ? ' lr-on' : '')}>
              <input type="radio" name="proyecto" value={e.slug} checked={f.slug === e.slug} onChange={() => set('slug', e.slug)} />
              <b>{e.proyecto}</b>
              <small>{e.razon_social}</small>
            </label>
          ))}
        </div>
        {errDe('slug')}
        {emp && (
          <div className="lr-prov">
            <div><span>Proveedor</span><b>{emp.razon_social}</b></div>
            <div><span>RUC</span><b>{emp.ruc}</b></div>
            {emp.direccion && <div><span>Domicilio fiscal</span>{emp.direccion}</div>}
            <div><span>Atención al público</span>{emp.atencion}</div>
          </div>
        )}
      </section>

      <section className="lr-sec">
        <h2><span>2</span> Tus datos</h2>
        <label className="lr-lab" htmlFor="lr-nombre">Nombre completo</label>
        <input {...campo('nombre')} autoComplete="name" maxLength={200} />
        {errDe('nombre')}
        <div className="lr-dos">
          <div>
            <label className="lr-lab" htmlFor="lr-doc_tipo">Documento</label>
            <select {...campo('doc_tipo')}>{Object.entries(DOCS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
          </div>
          <div>
            <label className="lr-lab" htmlFor="lr-doc_numero">Número</label>
            <input {...campo('doc_numero')} inputMode={f.doc_tipo === 'DNI' ? 'numeric' : 'text'} maxLength={15} />
          </div>
        </div>
        {errDe('doc_numero')}
        <label className="lr-lab" htmlFor="lr-domicilio">Domicilio</label>
        <input {...campo('domicilio')} autoComplete="street-address" maxLength={300} placeholder="Dirección, distrito, provincia" />
        {errDe('domicilio')}
        <div className="lr-dos">
          <div>
            <label className="lr-lab" htmlFor="lr-telefono">Celular o teléfono</label>
            <input {...campo('telefono')} type="tel" inputMode="tel" autoComplete="tel" maxLength={20} />
          </div>
          <div>
            <label className="lr-lab" htmlFor="lr-correo">Correo electrónico {f.respuesta_medio !== 'correo' && <i>(opcional)</i>}</label>
            <input {...campo('correo')} type="email" inputMode="email" autoComplete="email" maxLength={150} />
          </div>
        </div>
        {errDe('telefono')}{errDe('correo')}
        <label className="lr-check">
          <input type="checkbox" checked={f.menor_de_edad} onChange={e => set('menor_de_edad', e.target.checked)} />
          Soy menor de edad
        </label>
        {f.menor_de_edad && (
          <div className="lr-dos">
            <div>
              <label className="lr-lab" htmlFor="lr-apoderado_nombre">Nombre del padre, madre o apoderado</label>
              <input {...campo('apoderado_nombre')} maxLength={200} />
            </div>
            <div>
              <label className="lr-lab" htmlFor="lr-apoderado_doc">Su DNI <i>(opcional)</i></label>
              <input {...campo('apoderado_doc')} inputMode="numeric" maxLength={15} />
            </div>
          </div>
        )}
        {errDe('apoderado_nombre')}
      </section>

      <section className="lr-sec">
        <h2><span>3</span> Lo que contrataste</h2>
        <div className="lr-seg" role="radiogroup" aria-label="Producto o servicio">
          {[['producto', 'Producto (lote)'], ['servicio', 'Servicio']].map(([k, t]) => (
            <label key={k} className={f.bien_tipo === k ? 'lr-on' : ''}>
              <input type="radio" name="bien_tipo" checked={f.bien_tipo === k} onChange={() => set('bien_tipo', k)} />{t}
            </label>
          ))}
        </div>
        <label className="lr-lab" htmlFor="lr-bien_descripcion">Descripción</label>
        <input {...campo('bien_descripcion')} maxLength={500} placeholder="Ej.: Lote Mz. K Lt. 8, contrato de compraventa" />
        {errDe('bien_descripcion')}
        <label className="lr-lab" htmlFor="lr-monto">Monto reclamado <i>(opcional)</i></label>
        <div className="lr-soles"><span>S/</span><input {...campo('monto')} inputMode="decimal" maxLength={14} placeholder="0.00" /></div>
        {errDe('monto')}
      </section>

      <section className="lr-sec">
        <h2><span>4</span> Tu reclamo o queja</h2>
        <div className="lr-tipos" id="lr-tipo" role="radiogroup" aria-label="Tipo">
          {Object.entries(TIPOS).map(([k, x]) => (
            <label key={k} className={'lr-tipo' + (f.tipo === k ? ' lr-on' : '')}>
              <input type="radio" name="tipo" checked={f.tipo === k} onChange={() => set('tipo', k)} />
              <b>{x.t}</b><small>{x.d}</small>
            </label>
          ))}
        </div>
        {errDe('tipo')}
        <label className="lr-lab" htmlFor="lr-detalle">Detalle: ¿qué pasó?</label>
        <textarea {...campo('detalle')} rows={6} maxLength={4000} />
        <div className="lr-cuenta">{f.detalle.length} / 4000</div>
        {errDe('detalle')}
        <label className="lr-lab" htmlFor="lr-pedido">Pedido: ¿qué solución esperas?</label>
        <textarea {...campo('pedido')} rows={3} maxLength={2000} />
        {errDe('pedido')}
      </section>

      <section className="lr-sec">
        <h2><span>5</span> ¿Cómo quieres recibir la respuesta?</h2>
        <div className="lr-seg lr-seg3" id="lr-respuesta_medio" role="radiogroup" aria-label="Medio de respuesta">
          {Object.entries(MEDIOS).map(([k, t]) => (
            <label key={k} className={f.respuesta_medio === k ? 'lr-on' : ''}>
              <input type="radio" name="respuesta_medio" checked={f.respuesta_medio === k} onChange={() => set('respuesta_medio', k)} />{t}
            </label>
          ))}
        </div>
        {errDe('respuesta_medio')}
      </section>

      <label className="lr-check lr-acepta" id="lr-acepta_datos">
        <input type="checkbox" checked={f.acepta_datos} onChange={e => set('acepta_datos', e.target.checked)} />
        <span>Acepto que usen mis datos solo para atender este reclamo, conforme a la <a href="/privacidad" target="_blank" rel="noreferrer">política de privacidad</a>.</span>
      </label>
      {errDe('acepta_datos')}

      <input className="lr-trampa" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trampa} onChange={e => setTrampa(e.target.value)} name="web" />

      <ul className="lr-leyendas">{LEYENDAS.map(l => <li key={l}>{l}</li>)}</ul>

      {errDe('enviar')}
      <button type="submit" className="lr-enviar" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar hoja de reclamación'}</button>
      <p className="lr-suave lr-centro">La fecha y el número de tu hoja se asignan al enviarla.</p>
    </form>
  )
}

function VerHoja({ token }) {
  const [h, setH] = useState(undefined)       // undefined = cargando · null = no existe
  const [copiado, setCopiado] = useState(false)
  const [bajando, setBajando] = useState(false)
  const recien = useMemo(() => { try { return sessionStorage.getItem('libro-recien-' + token) === '1' } catch { return false } }, [token])

  useEffect(() => {
    supabase.rpc('libro_hoja', { p_token: token }).then(({ data, error }) => setH(error ? null : (data || null)))
  }, [token])
  useEffect(() => { if (h?.numero) document.title = 'Hoja de reclamación N° ' + h.numero }, [h])

  if (h === undefined) return <p className="lr-suave lr-centro lr-espera">Cargando tu hoja…</p>
  if (h === null) return (
    <div className="lr-centro lr-espera">
      <h2>Esta hoja no existe</h2>
      <p className="lr-suave">Revisa que el enlace esté completo. Si quieres registrar un reclamo, <Link to="/libro-de-reclamaciones">llena una hoja nueva</Link>.</p>
    </div>
  )

  const enlace = window.location.origin + '/libro-de-reclamaciones/' + token
  const copiar = async () => {
    try { await navigator.clipboard.writeText(enlace); setCopiado(true); setTimeout(() => setCopiado(false), 2500) } catch { window.prompt('Copia tu enlace:', enlace) }
  }
  const bajar = async () => { setBajando(true); try { await descargarHoja(h) } finally { setBajando(false) } }
  const wa = 'https://wa.me/?text=' + encodeURIComponent('Mi hoja de reclamación N° ' + h.numero + ' (' + h.empresa.razon_social + '): ' + enlace)
  const c = h.consumidor || {}, b = h.bien || {}

  return (
    <>
      {recien && (
        <div className="lr-ok" role="status">
          <b>✓ Tu hoja fue registrada con el N° {h.numero}</b>
          <span>Guárdala: descárgala en PDF o copia el enlace. Por aquí mismo verás nuestra respuesta, en un plazo no mayor a {PLAZO_DIAS} días hábiles.</span>
        </div>
      )}
      <div className="lr-acciones">
        <button type="button" className="lr-btn lr-btn-am" onClick={bajar} disabled={bajando}>{bajando ? 'Preparando…' : '⬇ Descargar PDF'}</button>
        <button type="button" className="lr-btn" onClick={copiar}>{copiado ? '✓ Enlace copiado' : 'Copiar enlace'}</button>
        <a className="lr-btn" href={wa} target="_blank" rel="noreferrer">Enviar a mi WhatsApp</a>
      </div>

      <article className="lr-hoja">
        <div className="lr-hoja-cab">
          <div>
            <small>Hoja de reclamación</small>
            <b>N° {h.numero}</b>
          </div>
          <div className="lr-der"><small>Fecha</small><b>{fechaHoraPe(h.fecha)}</b></div>
        </div>
        <dl className="lr-datos">
          <div><dt>Proveedor</dt><dd>{h.empresa.razon_social}</dd></div>
          <div><dt>RUC</dt><dd>{h.empresa.ruc}</dd></div>
          {h.empresa.direccion && <div className="lr-ancho"><dt>Domicilio fiscal</dt><dd>{h.empresa.direccion}</dd></div>}
          <div className="lr-ancho"><dt>Atención al público</dt><dd>{h.empresa.atencion}</dd></div>
          <div className="lr-ancho"><dt>Proyecto</dt><dd>{h.proyecto}</dd></div>
        </dl>

        <h3>1. Identificación del consumidor</h3>
        <dl className="lr-datos">
          <div className="lr-ancho"><dt>Nombre</dt><dd>{c.nombre}</dd></div>
          <div><dt>{DOCS[c.doc_tipo] || 'Documento'}</dt><dd>{c.doc_numero}</dd></div>
          <div><dt>Teléfono</dt><dd>{c.telefono}</dd></div>
          <div className="lr-ancho"><dt>Domicilio</dt><dd>{c.domicilio}</dd></div>
          <div className="lr-ancho"><dt>Correo</dt><dd>{c.correo || '—'}</dd></div>
          {c.menor_de_edad && <div className="lr-ancho"><dt>Padre, madre o apoderado</dt><dd>{c.apoderado_nombre}{c.apoderado_doc ? ' · ' + c.apoderado_doc : ''}</dd></div>}
        </dl>

        <h3>2. Bien contratado</h3>
        <dl className="lr-datos">
          <div><dt>Tipo</dt><dd>{b.tipo === 'servicio' ? 'Servicio' : 'Producto'}</dd></div>
          <div><dt>Monto reclamado</dt><dd>{soles(b.monto) || '—'}</dd></div>
          <div className="lr-ancho"><dt>Descripción</dt><dd>{b.descripcion}</dd></div>
        </dl>

        <h3>3. Detalle y pedido</h3>
        <dl className="lr-datos">
          <div className="lr-ancho"><dt>Tipo</dt><dd><b>{TIPOS[h.tipo]?.t}</b></dd></div>
          <div className="lr-ancho"><dt>Detalle</dt><dd className="lr-texto">{h.detalle}</dd></div>
          <div className="lr-ancho"><dt>Pedido</dt><dd className="lr-texto">{h.pedido}</dd></div>
          <div className="lr-ancho"><dt>Respuesta por</dt><dd>{MEDIOS[h.respuesta_medio]}</dd></div>
        </dl>

        <h3>4. Respuesta del proveedor</h3>
        {h.respuesta ? (
          <dl className="lr-datos">
            <div className="lr-ancho"><dt>Fecha</dt><dd>{fechaHoraPe(h.respuesta_at)}</dd></div>
            <div className="lr-ancho"><dt>Respuesta</dt><dd className="lr-texto">{h.respuesta}</dd></div>
          </dl>
        ) : (
          <p className="lr-pend">Pendiente. Te responderemos en un plazo no mayor a {PLAZO_DIAS} días hábiles.</p>
        )}
        <ul className="lr-leyendas">{LEYENDAS.map(l => <li key={l}>{l}</li>)}</ul>
      </article>
      <p className="lr-centro"><Link to="/libro-de-reclamaciones">Llenar otra hoja</Link></p>
    </>
  )
}
