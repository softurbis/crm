import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import PlanoReal from './PlanoReal'
import { tienePlano, categoriasDe, categoriaDe, cotizar, soles, textoCuotasVenta, centroDe } from '../lib/plano'

// LOS LOTES EN EL LANDING (sql/195, pedido de Cesar el 11 nov 2026): el plano interactivo
// y la calculadora de cuotas. Los datos salen de pub_landing_lotes(slug): forma, área y
// estado de cada lote, y precio e inicial solo de los disponibles. Nada de clientes.
// La cuenta es la MISMA del panel del vendedor y del contrato (lib/plano.js → cotizar):
// cuotas en soles enteros y la última absorbe la diferencia, para que la web nunca diga
// una cifra distinta a la del asesor.

const nombreLote = l => l.mz + '-' + l.lt
const m2 = n => Number(n).toLocaleString('es-PE', { maximumFractionDigits: 2 })
const frenteA = t => String(t || '').replace(/^(LA|EL)\s+/i, '')
const PLAZOS = [12, 24, 36, 48, 60, 72]
const plazosHasta = max => [...new Set([...PLAZOS.filter(p => p < max), max])]
// los que no se pueden comprar van en gris (en tres tonos, para la leyenda)
const GRIS = { separado: '#cbd1ca', vendido: '#98a29b', no_disponible: '#bfc5be' }
const ESTADO = { separado: 'separado', vendido: 'vendido', no_disponible: 'no disponible' }
const linkWa = (tel, texto) => 'https://wa.me/' + tel + '?text=' + encodeURIComponent(texto)

// null = cargando · false = el proyecto no tiene lotes para mostrar (o falta el sql/195)
export function useLotesLanding(slug, activo) {
  const [datos, setDatos] = useState(null)
  useEffect(() => {
    if (!activo || !slug) return
    let vivo = true
    supabase.rpc('pub_landing_lotes', { p_slug: slug }).then(({ data, error }) => {
      if (!vivo) return
      setDatos(!error && data && Array.isArray(data.lotes) && data.lotes.length ? data : false)
    })
    return () => { vivo = false }
  }, [slug, activo])
  return datos
}

export const hayPlanoLanding = d => !!d && tienePlano(d.plano, d.lotes)
export const libresDe = d => (d ? d.lotes.filter(l => l.estado === 'disponible' && Number(l.total_price) > 0) : [])
  .sort((a, b) => Number(a.total_price) - Number(b.total_price) || a.mz.localeCompare(b.mz) || parseInt(a.lt) - parseInt(b.lt))

// ---------------------------------------------------------------------------
// PLANO INTERACTIVO: toca un lote y ves su precio, su inicial y su cuota
// ---------------------------------------------------------------------------
// Un plano mucho más alto que ancho (Brisas: una franja larga) se veía en el landing como una
// tira finita, en la PC y en el celular: se muestra ACOSTADO (girado 90°). Se giran los puntos
// de los lotes, los rótulos y las manzanas; el fondo (trazos SVG) gira con `plano.giro`. Los
// números de los lotes y las letras de las manzanas siguen derechos. Solo en el landing: el
// plano del panel no cambia.
function acostar(datos) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const l of datos.lotes) for (const [x, y] of (Array.isArray(l.poligono) ? l.poligono : [])) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  if (!(x1 > x0 && y1 > y0) || (x1 - x0) / (y1 - y0) >= 0.6) return datos
  const W = Number(datos.plano.ancho)
  const gira = ([x, y]) => [y, W - x]                 // lo de arriba queda a la izquierda
  const angulo = a => { let b = (Number(a) || 0) - 90; while (b <= -90) b += 180; while (b > 90) b -= 180; return b }
  return {
    ...datos,
    plano: {
      ...datos.plano, ancho: datos.plano.alto, alto: datos.plano.ancho, giro: `matrix(0 -1 1 0 0 ${W})`,
      rotulos: (datos.plano.rotulos || []).map(r => ({ ...r, x: r.y, y: W - r.x, ang: angulo(r.ang) })),
      manzanas: (datos.plano.manzanas || []).map(m => ({ ...m, x: m.y, y: W - m.x })),
    },
    lotes: datos.lotes.map(l => Array.isArray(l.poligono) ? { ...l, poligono: l.poligono.map(gira) } : l),
  }
}

export function PlanoLanding({ datos: crudos, nombre, tel, pdfUrl, onCalcular }) {
  const datos = useMemo(() => acostar(crudos), [crudos])
  const [sel, setSel] = useState(null)
  const cats = useMemo(() => categoriasDe(datos.plano, datos.lotes), [datos])
  const libres = useMemo(() => libresDe(datos), [datos])
  const meses = Number(datos.config?.cuotas) || 48
  const colorDe = l => l.estado === 'disponible' ? (categoriaDe(cats, l)?.color || '#6cc070') : GRIS[l.estado] || GRIS.no_disponible
  const tactil = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const angosta = typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches
  // en el celular la ficha va DEBAJO del plano (encima lo taparía casi entero): al tocar un
  // lote, la página se acomoda para que se vea
  const ficha = useRef(null)
  useEffect(() => {
    if (sel && angosta) ficha.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [sel, angosta])
  // el recuadro toma la forma de la lotización (sin franjas vacías arriba y abajo) y la ficha
  // del lote sale del lado contrario al lote tocado, para no taparlo
  const caja = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const l of datos.lotes) for (const [x, y] of (Array.isArray(l.poligono) ? l.poligono : [])) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
    }
    return x1 > x0 && y1 > y0 ? { ar: (x1 - x0) / (y1 - y0), medio: (x0 + x1) / 2 } : { ar: 16 / 9, medio: 0 }
  }, [datos])
  const fichaDer = sel && Array.isArray(sel.poligono) && centroDe(sel.poligono)[0] < caja.medio

  // la leyenda: cada color con su "desde" y cuántos quedan; después los que ya no se pueden comprar
  const leyenda = cats.map(c => {
    const del = libres.filter(l => categoriaDe(cats, l) === c)
    return { c, n: del.length, desde: del.length ? Math.min(...del.map(l => Number(l.total_price))) : null }
  }).filter(x => x.n > 0)
  const cuenta = e => datos.lotes.filter(l => l.estado === e).length
  const q = sel?.estado === 'disponible' ? cotizar(sel.total_price, sel.inicial, meses) : null
  const cat = sel ? categoriaDe(cats, sel) : null
  const med = sel?.medidas || {}

  return (
    <div className="lpl" data-reveal>
      <div className="lpl-leyenda">
        {leyenda.map(({ c, n, desde }) => (
          <span key={c.nombre} className="lpl-ley"><i style={{ background: c.color }} />
            <b>{c.nombre.charAt(0) + c.nombre.slice(1).toLowerCase()}</b> desde {soles(desde)} · {n} {n === 1 ? 'libre' : 'libres'}
          </span>
        ))}
        {cuenta('separado') > 0 && <span className="lpl-ley"><i style={{ background: GRIS.separado }} />Separados ({cuenta('separado')})</span>}
        {cuenta('vendido') > 0 && <span className="lpl-ley"><i style={{ background: GRIS.vendido }} />Vendidos ({cuenta('vendido')})</span>}
      </div>

      <div className="lpl-mapa" style={{ '--ar': Math.min(3, Math.max(0.8, caja.ar)).toFixed(3) }}>
        <PlanoReal plano={datos.plano} lotes={datos.lotes} tema="claro" enPagina alto={null} encuadre={angosta ? 'alto' : 'todo'}
          pista={angosta ? 'Desliza de costado · + para acercar' : tactil ? 'Acerca con el botón + para ver los números' : 'Acerca con + o con Ctrl + rueda para ver los números'}
          relleno={colorDe}
          titulo={l => 'Lote ' + nombreLote(l) + ' · ' + m2(l.area_m2) + ' m²' + (l.estado === 'disponible' ? ' · ' + soles(l.total_price) : ' · ' + ESTADO[l.estado])}
          onLote={setSel} elegido={sel?.id} />

        {sel ? (
          <div ref={ficha} className={'lpl-ficha' + (fichaDer ? ' lpl-der' : '')} role="dialog" aria-label={'Lote ' + nombreLote(sel)}>
            <button type="button" className="lpl-x" onClick={() => setSel(null)} aria-label="Cerrar">×</button>
            <div className="lpl-ficha-cab">
              <span className="lpl-num" style={{ '--cc': colorDe(sel) }}>{nombreLote(sel)}</span>
              <div>
                <b>Manzana {sel.mz} · Lote {sel.lt}</b>
                <small>
                  {m2(sel.area_m2)} m²
                  {med.frente && med.fondo ? ' · ' + med.frente.replace(' ml', '') + ' × ' + (med.derecha || med.fondo).replace(' ml', '') + ' m' : ''}
                  {sel.frente ? ' · frente a ' + frenteA(sel.frente).toLowerCase().replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase()) : ''}
                </small>
              </div>
            </div>
            {q ? (
              <>
                <div className="lpl-cifras">
                  <div><small>Precio</small><b>{soles(q.precio)}</b></div>
                  <div><small>Inicial</small><b>{soles(q.inicial)}</b></div>
                  <div><small>Cuota</small><b>{soles(q.cuota)}</b></div>
                </div>
                <p className="lpl-nota">{q.n} meses sin intereses: {textoCuotasVenta(q)}.{cat?.nombre ? ' Lote ' + cat.nombre.toLowerCase() + '.' : ''}</p>
                <div className="lpl-btns">
                  <button type="button" className="lp-btn lp-btn-c lp-btn-sm" onClick={() => onCalcular(sel)}>Calcular mis cuotas</button>
                  {tel && <a className="lp-btn lp-btn-wa lp-btn-sm" target="_blank" rel="noreferrer"
                    href={linkWa(tel, `Hola, me interesa el lote ${nombreLote(sel)} de ${nombre} (${m2(sel.area_m2)} m², ${soles(sel.total_price)}). ¿Sigue disponible?`)}>Lo quiero</a>}
                </div>
              </>
            ) : (
              <>
                <p className="lpl-nota">Este lote ya está <b>{ESTADO[sel.estado] || 'no disponible'}</b>. Los lotes en color todavía se pueden separar.</p>
                {libres[0] && <div className="lpl-btns">
                  <button type="button" className="lp-btn lp-btn-line lp-btn-sm" onClick={() => setSel(libres[0])}>Ver el más económico ({nombreLote(libres[0])})</button>
                </div>}
              </>
            )}
          </div>
        ) : (
          <div className="lpl-toca">Toca un lote para ver su precio y su cuota</div>
        )}
      </div>
      {pdfUrl && <a className="lp-visor-ext" href={pdfUrl} target="_blank" rel="noreferrer">Ver el plano completo ↗</a>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CALCULADORA DE CUOTAS: eliges el lote, la inicial y el plazo
// ---------------------------------------------------------------------------
export function Calculadora({ datos, nombre, tel, loteId, onLote, irContacto }) {
  const libres = useMemo(() => libresDe(datos), [datos])
  const max = Number(datos.config?.cuotas) || 48
  const plazos = plazosHasta(max)
  const [plazo, setPlazo] = useState(max)
  const lote = libres.find(l => l.id === loteId) || libres[0]
  const [iniTxt, setIniTxt] = useState('')            // '' = la inicial de lista del lote
  useEffect(() => { setIniTxt('') }, [lote?.id])
  // los lotes del selector, por manzana (el más económico ya viene elegido)
  const porMz = useMemo(() => {
    const m = new Map()
    for (const l of [...libres].sort((a, b) => a.mz.localeCompare(b.mz) || parseInt(a.lt) - parseInt(b.lt))) {
      if (!m.has(l.mz)) m.set(l.mz, [])
      m.get(l.mz).push(l)
    }
    return [...m]
  }, [libres])
  if (!lote) return null

  const iniMin = Number(lote.inicial) || 0
  const escrita = iniTxt === '' ? iniMin : Number(iniTxt) || 0
  const ini = Math.max(iniMin, escrita)
  const q = cotizar(lote.total_price, ini, plazo, datos.config?.descuento_contado)
  const texto = [
    `Hola, quiero separar un lote en ${nombre}.`,
    `Lote ${nombreLote(lote)} · ${m2(lote.area_m2)} m²`,
    `Precio: ${soles(q.precio)}`,
    `Inicial: ${soles(q.inicial)}`,
    q.n ? `${q.n} meses sin intereses: ${textoCuotasVenta(q)}` : 'Pago completo',
    '¿Me ayudan a separarlo?',
  ].join('\n')

  return (
    <div className="lpc" id="cuotas">
      <div className="lpc-form">
        <h3>Calcula tu cuota</h3>
        <label>Tu lote
          <select value={lote.id} onChange={e => onLote(e.target.value)}>
            {porMz.map(([mz, ls]) => (
              <optgroup key={mz} label={'Manzana ' + mz}>
                {ls.map(l => <option key={l.id} value={l.id}>{nombreLote(l)} · {m2(l.area_m2)} m² · {soles(l.total_price)}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {lote.id !== libres[0].id && <button type="button" className="lpc-link" onClick={() => onLote(libres[0].id)}>Ver el más económico ({nombreLote(libres[0])})</button>}
        <label>Inicial (S/)
          <input type="number" inputMode="numeric" min={iniMin} step="50" value={iniTxt === '' ? String(iniMin) : iniTxt}
            onChange={e => setIniTxt(e.target.value)} onBlur={() => { if (iniTxt !== '' && escrita < iniMin) setIniTxt('') }} />
        </label>
        <small className={'lpc-ayuda' + (escrita < iniMin ? ' lpc-mal' : '')}>
          {escrita < iniMin ? `La inicial mínima de este lote es ${soles(iniMin)}.` : `Mínimo ${soles(iniMin)}. Si das más, tu cuota baja.`}
        </small>
        <div className="lpc-plazos" role="group" aria-label="Plazo">
          <span>Plazo</span>
          {plazos.map(p => (
            <button key={p} type="button" className={'lpc-chip' + (plazo === p ? ' lpc-on' : '')} onClick={() => setPlazo(p)} aria-pressed={plazo === p}>{p} meses</button>
          ))}
        </div>
      </div>

      <div className="lpc-res" aria-live="polite">
        <small>Tu cuota mensual</small>
        <b className="lpc-cuota">{soles(q.cuota)}</b>
        <p className="lpc-txt">{q.n ? textoCuotasVenta(q) : 'Sin cuotas'} · sin intereses</p>
        <p className="lpc-sem">≈ {soles(q.semanal)} por semana · {soles(q.diaria)} por día</p>
        <dl className="lpc-dl">
          <div><dt>Precio del lote</dt><dd>{soles(q.precio)}</dd></div>
          <div><dt>Inicial</dt><dd>{soles(q.inicial)}</dd></div>
          <div><dt>Saldo en {q.n} meses</dt><dd>{soles(q.saldo)}</dd></div>
          {q.contado && <div><dt>Al contado ({q.dto}% menos)</dt><dd>{soles(q.contado)}</dd></div>}
        </dl>
        {tel
          ? <a className="lp-btn lp-btn-wa" href={linkWa(tel, texto)} target="_blank" rel="noreferrer">Separar este lote por WhatsApp</a>
          : <button type="button" className="lp-btn lp-btn-c" onClick={irContacto}>Quiero que me llamen</button>}
      </div>
    </div>
  )
}
