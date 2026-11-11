import { useEffect, useMemo, useRef, useState } from 'react'
import { centroDe, ladoMenor } from '../lib/plano'

// EL PLANO REAL DEL PROYECTO (sql/181): el fondo de projects.plano (calles, parques,
// quebrada, rótulos) y cada lote con su forma de lots.poligono, todo en metros.
// Se acerca con la rueda, los botones o pellizcando en el celular, y se mueve
// arrastrando. Un toque (sin arrastrar) sobre un lote llama a onLote.
//
//   relleno(l)  color del lote          borde(l)   {color, ancho} o null
//   atenuado(l) lo pinta apagado (no pasa el filtro)
//   titulo(l)   texto al pasar el mouse
//   elegido     id del lote marcado
// Los colores del fondo van en el tema oscuro del panel; los lotes llevan el color
// que decide cada pantalla (estado en el mapa, precio en el panel del vendedor).
const FONDO = {
  calle: '#2b352f', via: '#252d28', parque: '#1f3b27', quebrada: '#2f73b3',
  educacion: '#3a3150', otros: '#4b2f3c',
  // Brisas: losa deportiva y sus canchas · Neshuya: franja de la línea de alta tensión
  deporte: '#353d39', cancha: '#2a5236', servidumbre: '#31452a',
}
// tema="claro" (el landing público): los tonos del plano impreso, sobre fondo blanco
const FONDO_CLARO = {
  calle: '#dde1da', via: '#cdd2ca', parque: '#cde6c1', quebrada: '#9dcbef',
  educacion: '#f0dbbd', otros: '#f3ccd2', deporte: '#e2e5de', cancha: '#bcdeb0', servidumbre: '#e0ebd3',
}

// enPagina (el landing): el plano vive en medio de una página que se recorre con el dedo.
// En el celular el dedo que sube o baja mueve la PÁGINA (touch-action pan-y; el plano se
// mueve de costado y se acerca con + / −) y en la PC la rueda acerca solo con Ctrl.
// pista: el texto de abajo mientras los números de los lotes todavía no se leen.
// encuadre="alto" (el landing en el celular): un plano alargado no entra entero en una
// pantalla angosta sin volverse una tira; la vista de entrada llena el ALTO del recuadro,
// arranca por la izquierda y el resto se recorre deslizando de costado.
export default function PlanoReal({ plano, lotes, relleno, borde, atenuado, titulo, onLote, elegido, alto = '72vh', tema = 'oscuro', enPagina = false, pista, encuadre = 'todo' }) {
  const claro = tema === 'claro'
  const colores = claro ? FONDO_CLARO : FONDO
  const W = Number(plano.ancho), H = Number(plano.alto)
  const caja = useRef(null)
  const svg = useRef(null)

  // píxeles por metro: con eso se decide si ya se leen los números de los lotes
  const [anchoPx, setAnchoPx] = useState(800)
  const [forma, setForma] = useState(0)          // ancho ÷ alto del recuadro, redondeado (solo para encuadre="alto")
  useEffect(() => {
    if (!caja.current) return
    const ro = new ResizeObserver(([e]) => {
      setAnchoPx(e.contentRect.width || 800)
      if (e.contentRect.height > 0) setForma(Math.round(e.contentRect.width / e.contentRect.height * 20) / 20)
    })
    ro.observe(caja.current)
    return () => ro.disconnect()
  }, [])

  // la vista de entrada encuadra los LOTES (no toda la avenida ni el borde del plano)
  const inicial = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const l of lotes || []) for (const [x, y] of (Array.isArray(l.poligono) ? l.poligono : [])) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
    }
    if (!(x1 > x0)) { x0 = 0; y0 = 0; x1 = W; y1 = H }
    const m = Math.max(x1 - x0, y1 - y0) * 0.04
    const todo = { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m }
    if (encuadre !== 'alto' || !forma) return todo
    const mh = (y1 - y0) * 0.06
    const h = y1 - y0 + 2 * mh, w = h * forma
    return w >= todo.w ? todo : { x: x0 - mh, y: y0 - mh, w, h }
  }, [W, H, lotes && lotes.length, encuadre, encuadre === 'alto' ? forma : 0])   // en el panel, cambiar el tamaño de la ventana no reinicia el zoom
  const [vb, setVb] = useState(inicial)
  const vbRef = useRef(vb)
  useEffect(() => { vbRef.current = vb }, [vb])
  useEffect(() => { setVb(inicial) }, [inicial])
  // lo más lejos que se puede alejar: todo el plano y un poco más
  const tope = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity
    for (const l of lotes || []) for (const [x] of (Array.isArray(l.poligono) ? l.poligono : [])) { x0 = Math.min(x0, x); x1 = Math.max(x1, x) }
    return Math.max(W, inicial.w, x1 > x0 ? x1 - x0 : 0) * 1.3
  }, [W, inicial, lotes && lotes.length])

  // de coordenadas de pantalla a metros del plano (respeta el "meet" del viewBox)
  const aPlano = (cx, cy) => {
    const el = svg.current
    const pt = el.createSVGPoint(); pt.x = cx; pt.y = cy
    const r = pt.matrixTransform(el.getScreenCTM().inverse())
    return [r.x, r.y]
  }
  const zoomEn = (f, cx, cy) => {
    const v = vbRef.current
    const [px, py] = cx == null ? [v.x + v.w / 2, v.y + v.h / 2] : aPlano(cx, cy)
    const w = Math.min(tope, Math.max(inicial.w / 40, v.w / f))
    const k = w / v.w
    setVb({ x: px - (px - v.x) * k, y: py - (py - v.y) * k, w, h: v.h * k })
  }

  // rueda del mouse: se registra a mano porque React la deja pasiva y no se puede
  // frenar el scroll de la página
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const rueda = e => {
      if (enPagina && !e.ctrlKey && !e.metaKey) return            // sin Ctrl, la rueda baja la página
      e.preventDefault(); zoomEn(e.deltaY < 0 ? 1.25 : 0.8, e.clientX, e.clientY)
    }
    el.addEventListener('wheel', rueda, { passive: false })
    return () => el.removeEventListener('wheel', rueda)
  })

  // arrastrar (un dedo o el mouse) y pellizcar (dos dedos)
  const punteros = useRef(new Map())
  const gesto = useRef(null)
  const abajo = e => {
    try { svg.current.setPointerCapture?.(e.pointerId) } catch { /* sin captura igual se puede tocar el lote */ }
    punteros.current.set(e.pointerId, [e.clientX, e.clientY])
    const ps = [...punteros.current.values()]
    gesto.current = {
      vb: { ...vbRef.current }, ps, movido: gesto.current?.movido && ps.length > 1,
      id: e.target?.dataset?.id || null, inicio: [e.clientX, e.clientY],
    }
  }
  const mueve = e => {
    if (!punteros.current.has(e.pointerId) || !gesto.current) return
    punteros.current.set(e.pointerId, [e.clientX, e.clientY])
    const g = gesto.current
    const ps = [...punteros.current.values()]
    const rect = svg.current.getBoundingClientRect()
    const escala = Math.max(g.vb.w / rect.width, g.vb.h / rect.height)
    if (ps.length === 1 && g.ps.length === 1) {
      const dx = ps[0][0] - g.ps[0][0], dy = ps[0][1] - g.ps[0][1]
      if (Math.hypot(dx, dy) > 6) g.movido = true
      if (g.movido) setVb({ ...g.vb, x: g.vb.x - dx * escala, y: g.vb.y - dy * escala })
    } else if (ps.length === 2 && g.ps.length === 2) {
      g.movido = true
      const d0 = Math.hypot(g.ps[0][0] - g.ps[1][0], g.ps[0][1] - g.ps[1][1])
      const d1 = Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1])
      if (d0 < 10) return
      const f = d1 / d0
      const w = Math.min(tope, Math.max(inicial.w / 40, g.vb.w / f))
      const k = w / g.vb.w
      // el punto medio de los dos dedos queda fijo
      const mx = (g.ps[0][0] + g.ps[1][0]) / 2 - rect.left, my = (g.ps[0][1] + g.ps[1][1]) / 2 - rect.top
      const px = g.vb.x + mx * escala, py = g.vb.y + my * escala
      setVb({ x: px - (px - g.vb.x) * k, y: py - (py - g.vb.y) * k, w, h: g.vb.h * k })
    }
  }
  const arriba = e => {
    const g = gesto.current
    punteros.current.delete(e.pointerId)
    if (g && !g.movido && punteros.current.size === 0 && g.id && onLote) {
      const l = lotes.find(x => String(x.id) === g.id)
      if (l) onLote(l)
    }
    if (punteros.current.size === 0) gesto.current = null
    else gesto.current = { vb: { ...vbRef.current }, ps: [...punteros.current.values()], movido: true }
  }
  // el navegador se quedó con el gesto (en el landing, el dedo que baja la página):
  // se suelta sin elegir el lote donde empezó
  const cancela = e => {
    punteros.current.delete(e.pointerId)
    gesto.current = punteros.current.size ? { vb: { ...vbRef.current }, ps: [...punteros.current.values()], movido: true } : null
  }

  const pxPorM = anchoPx / vb.w
  const verNumeros = pxPorM > 1.4

  // el fondo no cambia al mover el plano: se arma una sola vez
  // plano.giro: el landing muestra acostado un plano muy alto (LandingLotes, acostar); los trazos
  // del fondo se giran con esta transformación, el resto ya viene girado
  const fondo = useMemo(() => (
    <g transform={plano.giro || undefined}>
      {(plano.capas || []).filter(c => c.t !== 'limite').map((c, i) => (
        <path key={i} d={c.d} fill={colores[c.t] || colores.calle} fillRule="evenodd" />
      ))}
      {(plano.capas || []).filter(c => c.t === 'limite').map((c, i) => (
        <path key={'l' + i} d={c.d} fill="none" stroke={claro ? '#c42fbf' : '#6fae5a'} strokeWidth={claro ? 0.9 : 1.2} strokeDasharray={claro ? undefined : '6 3'} />
      ))}
    </g>
  ), [plano, claro])
  const rotulos = useMemo(() => (
    <g className="pr-rotulos">
      {(plano.rotulos || []).map((r, i) => (
        <text key={i} x={r.x} y={r.y} fontSize={r.tam || 2.4} textAnchor="middle" dominantBaseline="central"
          transform={r.ang ? `rotate(${r.ang} ${r.x} ${r.y})` : undefined}
          className={r.area ? 'pr-area' : 'pr-calle'}>{r.txt}</text>
      ))}
    </g>
  ), [plano])

  const conForma = useMemo(() => (lotes || []).filter(l => Array.isArray(l.poligono) && l.poligono.length >= 3), [lotes])
  const parcelas = conForma.map(l => {
    const b = borde?.(l)
    const sel = elegido && String(l.id) === String(elegido)
    return (
      <path key={l.id} data-id={l.id} className="pr-lote"
        d={'M' + l.poligono.map(p => p[0] + ' ' + p[1]).join('L') + 'Z'}
        fill={relleno(l)} fillOpacity={atenuado?.(l) ? 0.18 : 0.92}
        stroke={sel ? (claro ? '#0b1410' : '#ffffff') : b?.color || 'rgba(10,16,12,.85)'}
        strokeWidth={sel ? (claro ? 1.4 : 1.1) : b?.ancho || 0.35}>
        {titulo && <title>{titulo(l)}</title>}
      </path>
    )
  })
  const numeros = verNumeros && conForma.map(l => {
    const [x, y] = centroDe(l.poligono)
    const t = Math.min(3.6, Math.max(1.6, ladoMenor(l.poligono) * 0.36))
    return (
      <text key={l.id} x={x} y={y} fontSize={t} textAnchor="middle" dominantBaseline="central"
        className="pr-num" opacity={atenuado?.(l) ? 0.35 : 1}>{l.lt}</text>
    )
  })

  return (
    <div className={'pr-caja' + (claro ? ' pr-claro' : '')} ref={caja} style={{ height: alto }}>
      <svg ref={svg} className="pr-svg" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
        style={enPagina ? { touchAction: 'pan-y' } : undefined}
        onPointerDown={abajo} onPointerMove={mueve} onPointerUp={arriba} onPointerCancel={cancela}>
        {fondo}
        <g>{parcelas}</g>
        <g style={{ pointerEvents: 'none' }}>{numeros}</g>
        {rotulos}
        <g style={{ pointerEvents: 'none' }}>
          {(plano.manzanas || []).map(m => (
            <g key={m.mz}>
              <circle cx={m.x} cy={m.y} r={4.6} className="pr-mz" />
              <text x={m.x} y={m.y} fontSize={5.2} textAnchor="middle" dominantBaseline="central" className="pr-mz-t">{m.mz}</text>
            </g>
          ))}
        </g>
      </svg>
      <div className="pr-zoom">
        <button type="button" title="Acercar" onClick={() => zoomEn(1.5)}>+</button>
        <button type="button" title="Alejar" onClick={() => zoomEn(1 / 1.5)}>−</button>
        <button type="button" title="Ver todo el plano" onClick={() => setVb(inicial)}>⤢</button>
      </div>
      {!verNumeros && <span className="pr-pista">{pista || 'Acerca el plano para ver el número de cada lote'}</span>}
    </div>
  )
}
