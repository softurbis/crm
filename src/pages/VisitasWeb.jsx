import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { hoyPe } from '../lib/cobros'
import { fechaPe } from '../lib/lotes'
import { linkPublico } from '../lib/sitios'
import '../styles/visitas-web.css'

// VISITAS DE LA WEB (sql/231, 15 nov 2026): cuánta gente entra a la portada, a cada
// landing y a los recorridos, de dónde viene y cuántos terminan escribiendo. La web
// cuenta sola (sitio-publico/contador.js); aquí todo llega sumado de web_resumen().
// EFICIENCIA = visitas en las que la persona tocó WhatsApp, envió el formulario o
// llamó, entre todas las visitas.

// los dos colores del gráfico, validados para daltonismo sobre el fondo del panel
const C_VISITA = '#4a87c9'    // visitas sin contacto
const C_CONTACTO = '#d4793a'  // visitas que terminaron en contacto

const FUENTE = {
  facebook: 'Facebook', instagram: 'Instagram', google: 'Google', tiktok: 'TikTok', youtube: 'YouTube',
  whatsapp: 'WhatsApp', directo: 'Directo', panel: 'Desde el panel (personal)', 'otra web': 'Otras webs',
  'otros buscadores': 'Otros buscadores',
}
const FUENTE_NOTA = {
  directo: 'link escrito, guardado o compartido por WhatsApp',
  panel: 'abierto desde el CRM',
}
const DISPOSITIVO = { celular: '📱 Celular', computadora: '💻 Computadora', tablet: '📲 Tablet', otro: 'Otro' }

const num = n => Number(n || 0).toLocaleString('es-PE')
const pct = (a, b) => (b ? (100 * a / b) : 0)
const pctTxt = (a, b) => b ? pct(a, b).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' %' : '—'
const sumarDias = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const diaCorto = f => f.slice(8, 10) + '/' + f.slice(5, 7)
const DIAS_SEM = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const diaSem = f => DIAS_SEM[new Date(f + 'T12:00:00Z').getUTCDay()]

function rangos(hoy) {
  const ini = hoy.slice(0, 8) + '01'
  const finPasado = sumarDias(ini, -1)
  return [
    { id: 'hoy', txt: 'Hoy', desde: hoy, hasta: hoy, ant: 'ayer' },
    { id: '7', txt: '7 días', desde: sumarDias(hoy, -6), hasta: hoy, ant: 'los 7 días anteriores' },
    { id: '30', txt: '30 días', desde: sumarDias(hoy, -29), hasta: hoy, ant: 'los 30 días anteriores' },
    { id: 'mes', txt: 'Este mes', desde: ini, hasta: hoy, ant: 'el periodo anterior' },
    { id: 'pasado', txt: 'Mes pasado', desde: finPasado.slice(0, 8) + '01', hasta: finPasado, ant: 'el mes anterior' },
  ]
}

function nombrePagina(p) {
  const n = p.nombre || p.proyecto || ''
  if (p.seccion === 'portada') return { t: 'Portada', s: 'la página de inicio con todos los proyectos', ruta: '/' }
  if (p.seccion === 'landing') return { t: n, s: 'landing', ruta: '/p/' + p.proyecto }
  if (p.seccion === 'recorrido') return p.sub === 'fotos'
    ? { t: n, s: 'fotos 360° del dron', ruta: '/recorrido/' + p.proyecto + '/fotos/' }
    : { t: n, s: 'recorrido 3D', ruta: '/recorrido/' + p.proyecto + '/' }
  if (p.seccion === 'propiedades') return { t: 'Propiedades', s: 'corretaje: la lista', ruta: '/propiedades' }
  // la página de una propiedad de terceros (sql/232): el "proyecto" es su código
  if (p.seccion === 'propiedad') return { t: 'Propiedad ' + String(p.proyecto || '').toUpperCase(), s: 'corretaje', ruta: '/propiedades/' + p.proyecto }
  if (p.seccion === 'libro') return { t: 'Libro de reclamaciones', s: '', ruta: '/libro-de-reclamaciones' }
  return { t: 'Otras páginas', s: '', ruta: null }
}

// el ancho real de la caja (el gráfico se dibuja a su medida, sin estirar letras)
function useAncho() {
  const ref = useRef(null)
  const [ancho, setAncho] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setAncho(Math.round(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, ancho]
}

// marcas limpias del eje: 0, 5, 10… (1-2-5 por potencia de 10)
function escala(max) {
  if (max <= 0) return { tope: 4, marcas: [0, 1, 2, 3, 4] }
  const crudo = max / 4
  const p = 10 ** Math.floor(Math.log10(crudo))
  const paso = [1, 2, 5, 10].map(m => m * p).find(s => s >= crudo) || 10 * p
  const pasoE = Math.max(1, paso)
  const tope = Math.ceil(max / pasoE) * pasoE
  const marcas = []
  for (let v = 0; v <= tope + 1e-9; v += pasoE) marcas.push(v)
  return { tope, marcas }
}

// columna con la punta redondeada (4px) y la base recta
function columna(x, y, w, h, r = 4) {
  if (h <= 0) return ''
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`
}

// GRÁFICO DE COLUMNAS. series = [{ clave, color, nombre }] apiladas de abajo hacia arriba.
function Columnas({ datos, series, etiqueta, tooltip, alto = 220, cadaCuanto }) {
  const [ref, ancho] = useAncho()
  const [sobre, setSobre] = useState(null)
  const izq = 34, der = 6, arriba = 10, abajo = 24
  const n = datos.length
  const total = d => series.reduce((s, x) => s + (d[x.clave] || 0), 0)
  const { tope, marcas } = escala(Math.max(0, ...datos.map(total)))
  const W = Math.max(ancho, 200), H = alto
  const plotW = W - izq - der, plotH = H - arriba - abajo
  const banda = n ? plotW / n : plotW
  const bw = Math.max(2, Math.min(24, banda * 0.72))
  const y = v => arriba + plotH - (v / tope) * plotH
  const salto = cadaCuanto || Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 46))))

  return (
    <div className="vw-chart" ref={ref} onMouseLeave={() => setSobre(null)}>
      {ancho > 0 && (
        <svg width={W} height={H} role="img" aria-label={etiqueta}>
          {marcas.map(m => (
            <g key={m}>
              <line x1={izq} x2={W - der} y1={y(m)} y2={y(m)} className="vw-grid" />
              <text x={izq - 6} y={y(m)} dy="0.32em" textAnchor="end" className="vw-eje">{num(m)}</text>
            </g>
          ))}
          {datos.map((d, i) => {
            const x = izq + i * banda + (banda - bw) / 2
            let base = arriba + plotH
            const visibles = series.filter(s => (d[s.clave] || 0) > 0)
            return (
              <g key={i} opacity={sobre == null || sobre === i ? 1 : 0.55}>
                {visibles.map((s, k) => {
                  const h = ((d[s.clave] || 0) / tope) * plotH
                  const ultima = k === visibles.length - 1
                  // 2px de fondo entre segmentos apilados
                  const hh = Math.max(1, h - (ultima ? 0 : 2))
                  const top = base - h
                  const path = ultima ? columna(x, top, bw, hh) : `M${x},${top + 2} h${bw} v${hh} h${-bw} Z`
                  base -= h
                  return <path key={s.clave} d={path} fill={s.color} />
                })}
                {(i % salto === 0) && <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="vw-eje">{d._x}</text>}
              </g>
            )
          })}
          {/* zonas para el mouse/dedo: toda la franja de cada columna */}
          {datos.map((d, i) => (
            <rect key={'h' + i} x={izq + i * banda} y={arriba} width={banda} height={plotH} fill="transparent"
              onMouseEnter={() => setSobre(i)} onClick={() => setSobre(sobre === i ? null : i)} />
          ))}
        </svg>
      )}
      {sobre != null && datos[sobre] && (
        <div className="vw-tip" style={{
          left: Math.min(Math.max(izq + sobre * banda + banda / 2, 90), W - 90),
        }}>
          {tooltip(datos[sobre])}
        </div>
      )}
    </div>
  )
}

function Delta({ ahora, antes, txtAnt }) {
  if (antes == null) return null
  if (!antes && !ahora) return <span className="vw-delta muted">sin datos antes</span>
  if (!antes) return <span className="vw-delta ok">▲ nuevo vs {txtAnt}</span>
  const d = pct(ahora - antes, antes)
  const cls = d > 0.5 ? 'ok' : d < -0.5 ? 'bad' : 'muted'
  return <span className={'vw-delta ' + cls}>{d > 0.5 ? '▲' : d < -0.5 ? '▼' : '='} {Math.abs(d).toLocaleString('es-PE', { maximumFractionDigits: 0 })} % vs {txtAnt}</span>
}

export default function VisitasWeb() {
  const hoy = hoyPe()
  const R = useMemo(() => rangos(hoy), [hoy])
  const [desde, setDesde] = useState(R[2].desde)
  const [hasta, setHasta] = useState(R[2].hasta)
  const [res, setRes] = useState(null)
  const [falta, setFalta] = useState(false)
  const [err, setErr] = useState('')
  const [vuelta, setVuelta] = useState(0)

  useEffect(() => {
    let vivo = true
    setErr('')
    supabase.rpc('web_resumen', { p_desde: desde, p_hasta: hasta }).then(r => {
      if (!vivo) return
      if (r.error) {
        if (/web_resumen|does not exist|schema cache|PGRST202/i.test(r.error.message + ' ' + (r.error.code || ''))) setFalta(true)
        else setErr(r.error.message)
        setRes(x => x || {}); return
      }
      setFalta(false); setRes(r.data || {})
    })
    return () => { vivo = false }
  }, [desde, hasta, vuelta])

  // "personas ahora en la web" se refresca solo cada minuto
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') setVuelta(v => v + 1) }, 60000)
    return () => clearInterval(t)
  }, [])

  const elegido = R.find(r => r.desde === desde && r.hasta === hasta)
  const txtAnt = elegido?.ant || 'el periodo anterior'
  const t = res?.total || {}
  const a = res?.anterior || null

  const dias = useMemo(() => (res?.dias || []).map(d => ({
    ...d, _x: diaCorto(d.dia), sinContacto: Math.max(0, d.visitas - d.contactos),
  })), [res])
  const horas = useMemo(() => (res?.horas || []).map(h => ({ ...h, _x: String(h.hora) })), [res])
  const maxFuente = Math.max(1, ...(res?.fuentes || []).map(f => f.visitas))

  if (falta) return (
    <>
      <h1>Visitas de la web</h1>
      <p className="hint">Falta correr <b>sql/231_contador_visitas_web.sql</b> en la base. Apenas esté, la web empieza a contar
        y aquí se ven las visitas de la portada, de cada landing y de los recorridos.</p>
    </>
  )

  const sinDatos = res && !t.vistas && !t.visitas

  return (
    <div className="vw">
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Visitas de la web</h1>
        <label className="small">Desde <input type="date" value={desde} max={hasta} onChange={e => e.target.value && setDesde(e.target.value)} /></label>
        <label className="small">Hasta <input type="date" value={hasta} min={desde} max={hoy} onChange={e => e.target.value && setHasta(e.target.value)} /></label>
      </div>
      <div className="chips">
        {R.map(r => (
          <button key={r.id} className={'chip' + (elegido?.id === r.id ? ' on' : '')} onClick={() => { setDesde(r.desde); setHasta(r.hasta) }}>{r.txt}</button>
        ))}
        {res && <span className="vw-ahora"><i className={res.ahora ? 'vw-pulso' : ''} />{res.ahora ? <><b>{num(res.ahora)}</b> {res.ahora === 1 ? 'persona' : 'personas'} en la web ahora</> : 'Nadie en la web en este momento'}</span>}
      </div>
      {err && <p className="error">{err}</p>}
      {!res && <p className="muted">Cargando…</p>}

      {res && (
        <>
          {/* la cifra principal y la cuenta de la eficiencia */}
          <div className="glass vw-hero">
            <div>
              <span className="vw-lbl">Visitas</span>
              <b className="vw-num">{num(t.visitas)}</b>
              <Delta ahora={t.visitas} antes={a?.visitas} txtAnt={txtAnt} />
            </div>
            <div className="vw-flecha">→</div>
            <div>
              <span className="vw-lbl">Contactos</span>
              <b className="vw-num vw-num-2"><i style={{ background: C_CONTACTO }} />{num(t.contactos)}</b>
              <Delta ahora={t.contactos} antes={a?.contactos} txtAnt={txtAnt} />
            </div>
            <div className="vw-flecha">=</div>
            <div>
              <span className="vw-lbl">Eficiencia</span>
              <b className="vw-num vw-num-2">{pctTxt(t.contactos, t.visitas)}</b>
              <span className="vw-delta muted">{a?.visitas ? 'antes: ' + pctTxt(a.contactos, a.visitas) : 'de las visitas terminan en contacto'}</span>
            </div>
          </div>

          <div className="cards vw-cards">
            <div className="glass card"><span className="vw-lbl">Personas distintas</span><div className="kpi">{num(t.visitantes)}</div>
              <span className="muted small">{num(t.nuevos)} vinieron por primera vez</span></div>
            <div className="glass card"><span className="vw-lbl">Páginas vistas</span><div className="kpi">{num(t.vistas)}</div>
              <span className="muted small">{t.visitas ? (t.vistas / t.visitas).toLocaleString('es-PE', { maximumFractionDigits: 1 }) : '0'} por visita</span></div>
            <div className="glass card"><span className="vw-lbl">Tocaron WhatsApp</span><div className="kpi">{num(t.whatsapp)}</div>
              <span className="muted small">{num(t.formulario)} formulario{t.formulario === 1 ? '' : 's'} · {num(t.llamada)} llamada{t.llamada === 1 ? '' : 's'}</span></div>
            <div className="glass card"><span className="vw-lbl">Se interesaron</span><div className="kpi">{num(t.con_interes)}</div>
              <span className="muted small">{num(t.plano)} lotes tocados · {num(t.recorrido)} recorridos · {num(t.mapa)} “cómo llegar”</span></div>
          </div>

          {sinDatos && (
            <p className="hint" style={{ marginTop: '1rem' }}>
              {res.primer_evento
                ? 'No hubo visitas en estas fechas.'
                : 'Todavía no hay visitas registradas: el contador empieza a sumar desde que se publica. Abre la web en tu celular para ver la primera.'}
            </p>
          )}

          {!sinDatos && (
            <>
              <h3>Visitas por día</h3>
              <div className="glass vw-caja">
                <div className="vw-leyenda">
                  <span><i style={{ background: C_CONTACTO }} />Terminaron en contacto</span>
                  <span><i style={{ background: C_VISITA }} />Solo miraron</span>
                </div>
                <Columnas datos={dias} etiqueta="Visitas por día"
                  series={[{ clave: 'contactos', color: C_CONTACTO }, { clave: 'sinContacto', color: C_VISITA }]}
                  tooltip={d => (
                    <>
                      <b>{diaSem(d.dia)} {fechaPe(d.dia)}</b>
                      <span>{num(d.visitas)} visita{d.visitas === 1 ? '' : 's'} · {num(d.visitantes)} persona{d.visitantes === 1 ? '' : 's'}</span>
                      <span><i style={{ background: C_CONTACTO }} />{num(d.contactos)} contacto{d.contactos === 1 ? '' : 's'} ({pctTxt(d.contactos, d.visitas)})</span>
                      <span className="muted">{num(d.vistas)} páginas vistas</span>
                    </>
                  )} />
              </div>

              <h3>Por página</h3>
              <div className="glass table-wrap">
                <table>
                  <thead><tr>
                    <th>Página</th><th className="vw-n">Visitas</th><th className="vw-n">Personas</th>
                    <th className="vw-n">WhatsApp</th><th className="vw-n">Formulario</th><th className="vw-n">Llamadas</th>
                    <th className="vw-n">Lotes tocados</th><th className="vw-n">Recorrido</th><th className="vw-n">Eficiencia</th>
                  </tr></thead>
                  <tbody>
                    {(res.paginas || []).map((p, i) => {
                      const np = nombrePagina(p)
                      return (
                        <tr key={i}>
                          <td>
                            {np.ruta ? <a href={linkPublico(np.ruta)} target="_blank" rel="noreferrer"><b>{np.t}</b></a> : <b>{np.t}</b>}
                            {np.s && <div className="muted small">{np.s}</div>}
                          </td>
                          <td className="vw-n"><b>{num(p.visitas)}</b></td>
                          <td className="vw-n">{num(p.visitantes)}</td>
                          <td className="vw-n">{p.whatsapp ? num(p.whatsapp) : <span className="muted">—</span>}</td>
                          <td className="vw-n">{p.formulario ? num(p.formulario) : <span className="muted">—</span>}</td>
                          <td className="vw-n">{p.llamada ? num(p.llamada) : <span className="muted">—</span>}</td>
                          <td className="vw-n">{p.plano ? num(p.plano) : <span className="muted">—</span>}</td>
                          <td className="vw-n">{p.recorrido ? num(p.recorrido) : <span className="muted">—</span>}</td>
                          <td className="vw-n"><b>{p.visitas ? pctTxt(p.contactos, p.visitas) : '—'}</b></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="muted small vw-nota">El recorrido abierto dentro del landing se cuenta en la columna “Recorrido” del landing; la fila propia del recorrido es de quien lo abrió por su link directo.</p>

              <div className="vw-dos">
                <div>
                  <h3>De dónde vienen</h3>
                  <div className="glass table-wrap">
                    <table>
                      <thead><tr><th>Origen</th><th>Visitas</th><th className="vw-n">Contactos</th><th className="vw-n">Eficiencia</th></tr></thead>
                      <tbody>
                        {(res.fuentes || []).map(f => (
                          <tr key={f.fuente}>
                            <td><b>{FUENTE[f.fuente] || f.fuente}</b>{FUENTE_NOTA[f.fuente] && <div className="muted small">{FUENTE_NOTA[f.fuente]}</div>}</td>
                            <td className="vw-barra-td">
                              <span className="vw-barra"><i style={{ width: Math.max(2, 100 * f.visitas / maxFuente) + '%', background: C_VISITA }} /></span>
                              <b>{num(f.visitas)}</b>
                            </td>
                            <td className="vw-n">{num(f.contactos)}</td>
                            <td className="vw-n"><b>{pctTxt(f.contactos, f.visitas)}</b></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <h3>Desde qué equipo</h3>
                  <div className="glass table-wrap">
                    <table>
                      <thead><tr><th>Equipo</th><th className="vw-n">Visitas</th><th className="vw-n">%</th><th className="vw-n">Eficiencia</th></tr></thead>
                      <tbody>
                        {(res.dispositivos || []).map(f => (
                          <tr key={f.dispositivo}>
                            <td><b>{DISPOSITIVO[f.dispositivo] || f.dispositivo}</b></td>
                            <td className="vw-n">{num(f.visitas)}</td>
                            <td className="vw-n">{pctTxt(f.visitas, t.visitas)}</td>
                            <td className="vw-n">{pctTxt(f.contactos, f.visitas)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {!!(res.campanas || []).length && (
                <>
                  <h3>Campañas (links con utm_campaign)</h3>
                  <div className="glass table-wrap">
                    <table>
                      <thead><tr><th>Campaña</th><th className="vw-n">Visitas</th><th className="vw-n">Contactos</th><th className="vw-n">Eficiencia</th></tr></thead>
                      <tbody>
                        {res.campanas.map(c => (
                          <tr key={c.campana}>
                            <td><b>{c.campana}</b></td><td className="vw-n">{num(c.visitas)}</td>
                            <td className="vw-n">{num(c.contactos)}</td><td className="vw-n"><b>{pctTxt(c.contactos, c.visitas)}</b></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <h3>A qué hora entran <span className="muted small">(hora de Perú)</span></h3>
              <div className="glass vw-caja">
                <Columnas datos={horas} etiqueta="Visitas por hora del día" alto={170} cadaCuanto={3}
                  series={[{ clave: 'visitas', color: C_VISITA }]}
                  tooltip={h => <><b>{h.hora}:00 a {h.hora}:59</b><span>{num(h.visitas)} visita{h.visitas === 1 ? '' : 's'}</span></>} />
              </div>
            </>
          )}

          <div className="glass vw-como">
            <b>Cómo se cuenta</b>
            <ul>
              <li><b>Visita</b>: una persona que entra y recorre la web; si vuelve después de 30 minutos, es otra visita. <b>Personas</b>: equipos distintos (el mismo celular cuenta una vez).</li>
              <li><b>Contacto</b>: en esa visita tocó un botón de WhatsApp, envió el formulario o tocó un teléfono. <b>Eficiencia</b> = contactos ÷ visitas.</li>
              <li>El origen sale solo cuando llegan desde Facebook, Instagram, Google o TikTok. Los links que se mandan por WhatsApp suelen salir como “Directo”.
                Para separar un anuncio de otro, agrégale al link <code>?utm_campaign=nombre</code> (por ejemplo <code>…/p/praderas-de-cashibo?utm_campaign=promo-noviembre</code>).</li>
              <li>No se guarda la IP ni ningún dato de la persona. Lo que abre el equipo desde la vista previa del panel no se cuenta.</li>
            </ul>
            <p className="small" style={{ margin: '.6rem 0 0' }}>
              Para que tus propias visitas no inflen los números, abre este link <b>una vez en cada celular o computadora del equipo</b>:{' '}
              <a href={linkPublico('/?nocontar=1')} target="_blank" rel="noreferrer">No contar este equipo ↗</a>
            </p>
          </div>
        </>
      )}
    </div>
  )
}
