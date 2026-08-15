// ============================================================================
// GRAFICOS DEL PANEL — SVG a mano, sin librerias
// ----------------------------------------------------------------------------
// Se descarto meter una libreria de charts: pesan cientos de KB, y acá hacen
// falta tres formas nomás. Todo es SVG puro, hereda los colores del tema y
// escala solo con el ancho del contenedor.
//
// Regla de la casa: un grafico que no se puede leer de un vistazo es un adorno.
// Por eso los numeros importantes van SIEMPRE escritos, no solo dibujados.
// ============================================================================
import { useState } from 'react'

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 })
export const corto = n => {
  const v = Math.abs(Number(n) || 0)
  if (v >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M'
  if (v >= 1000) return Math.round(n / 1000) + 'k'
  return String(Math.round(n))
}

// ---------------------------------------------------------------- RELOJ (gauge)
// Para límites: cuánto se usó de lo que hay. El color avisa solo.
export function Reloj({ titulo, usado, limite, detalle, unidad = 'MB' }) {
  const pct = limite > 0 ? Math.min(100, (usado / limite) * 100) : 0
  const color = pct >= 90 ? '#d9534f' : pct >= 75 ? '#e0a13f' : '#4bb96a'
  const R = 42, C = 2 * Math.PI * R
  const val = n => (unidad === 'MB' ? (n / 1048576).toFixed(0) : n)
  return (
    <div className="glass card" style={{ textAlign: 'center', minWidth: 150 }}>
      <p className="muted" style={{ margin: '0 0 4px' }}>{titulo}</p>
      <svg viewBox="0 0 110 110" style={{ width: 108, height: 108 }}>
        <circle cx="55" cy="55" r={R} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="11" />
        <circle cx="55" cy="55" r={R} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round"
          strokeDasharray={`${C * pct / 100} ${C}`} transform="rotate(-90 55 55)" />
        <text x="55" y="52" textAnchor="middle" fill={color} fontSize="21" fontWeight="700">{pct.toFixed(0)}%</text>
        <text x="55" y="68" textAnchor="middle" fill="currentColor" opacity=".65" fontSize="10">
          {val(usado)} / {val(limite)} {unidad}
        </text>
      </svg>
      {detalle && <p className="muted small" style={{ margin: 0, textTransform: 'none' }}>{detalle}</p>}
    </div>
  )
}

// ------------------------------------------------- BARRAS POR MES (cobrado/gasto)
// Dos barras por mes y una linea de balance encima. Es el grafico que contesta
// "¿este mes entro mas de lo que salio?" sin tener que restar de cabeza.
export function BarrasMes({ meses, alto = 210, onMes }) {
  const [hover, setHover] = useState(null)
  if (!meses?.length) return <p className="muted small">Sin datos todavía.</p>
  const W = 760, H = alto, padL = 46, padB = 36, padT = 14
  const tope = Math.max(...meses.flatMap(m => [m.rec, m.gastos]), 1)
  const anchoCol = (W - padL - 10) / meses.length
  const bw = Math.min(22, anchoCol / 3.2)
  const y = v => padT + (H - padT - padB) * (1 - v / tope)
  const balance = meses.map((m, i) => [padL + anchoCol * i + anchoCol / 2, y(Math.max(0, m.rec - m.gastos))])
  const h = hover != null ? meses[hover] : null
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} onMouseLeave={() => setHover(null)}>
        {[0, .25, .5, .75, 1].map(f => (
          <g key={f}>
            <line x1={padL} x2={W - 6} y1={y(tope * f)} y2={y(tope * f)} stroke="currentColor" opacity=".12" />
            <text x={padL - 6} y={y(tope * f) + 3} textAnchor="end" fontSize="9.5" fill="currentColor" opacity=".55">{corto(tope * f)}</text>
          </g>
        ))}
        {meses.map((m, i) => {
          const x = padL + anchoCol * i + anchoCol / 2
          return (
            <g key={m.ym} onMouseEnter={() => setHover(i)} onClick={() => onMes && onMes(m.ym)}
               style={{ cursor: onMes ? 'pointer' : 'default' }}>
              {/* franja invisible: hace que el hover agarre en toda la columna, no solo en la barrita */}
              <rect x={x - anchoCol / 2} y={padT} width={anchoCol} height={H - padT - padB}
                fill={hover === i ? 'rgba(255,255,255,.07)' : 'transparent'} />
              <rect x={x - bw - 2} y={y(m.rec)} width={bw} height={Math.max(1, y(0) - y(m.rec))} rx="2"
                fill="#4bb96a" opacity={hover == null || hover === i ? 1 : .45} />
              <rect x={x + 2} y={y(m.gastos)} width={bw} height={Math.max(1, y(0) - y(m.gastos))} rx="2"
                fill="#d9754f" opacity={hover == null || hover === i ? 1 : .45} />
              <text x={x} y={H - padB + 14} textAnchor="middle" fontSize="9.5" fill="currentColor"
                opacity={hover === i ? 1 : .6} fontWeight={hover === i ? 700 : 400}>{m.lbl}</text>
            </g>
          )
        })}
        <polyline points={balance.map(p => p.join(',')).join(' ')} fill="none" stroke="#7ec8e3" strokeWidth="1.8" opacity=".9" />
        {balance.map(([x, yy], i) => <circle key={i} cx={x} cy={yy} r={hover === i ? 4 : 2.6} fill="#7ec8e3" />)}
        <g transform={`translate(${padL},${H - 6})`} fontSize="9.5" fill="currentColor">
          <rect x="0" y="-7" width="9" height="9" rx="2" fill="#4bb96a" /><text x="13" y="1" opacity=".7">cobrado</text>
          <rect x="72" y="-7" width="9" height="9" rx="2" fill="#d9754f" /><text x="85" y="1" opacity=".7">gastos</text>
          <line x1="140" y1="-3" x2="155" y2="-3" stroke="#7ec8e3" strokeWidth="1.8" /><text x="159" y="1" opacity=".7">balance</text>
          {onMes && <text x="235" y="1" opacity=".45">— clic en un mes para ver su detalle</text>}
        </g>
      </svg>
      {h && (
        <div style={{
          position: 'absolute', top: 6, right: 6, background: 'var(--panel-2, rgba(20,26,22,.97))',
          border: '1px solid rgba(255,255,255,.18)', borderRadius: 8, padding: '7px 10px',
          fontSize: 12, pointerEvents: 'none', minWidth: 168, boxShadow: '0 6px 18px rgba(0,0,0,.45)',
        }}>
          <b style={{ display: 'block', marginBottom: 3 }}>{h.lbl}</b>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ color: '#4bb96a' }}>cobrado</span><b>{soles(h.rec)}</b></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ color: '#d9754f' }}>gastos</span><b>{soles(h.gastos)}</b></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, borderTop: '1px solid rgba(255,255,255,.14)', marginTop: 3, paddingTop: 3 }}>
            <span style={{ color: '#7ec8e3' }}>balance</span>
            <b style={{ color: h.rec - h.gastos >= 0 ? '#4bb96a' : '#d9534f' }}>{soles(h.rec - h.gastos)}</b></div>
          <div className="muted" style={{ marginTop: 3, fontSize: 11 }}>{h.pagos} pagos · {h.ventasN} ventas nuevas</div>
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------------- ROSCA (donut)
// Composicion: en qué estado están los lotes, o de dónde sale la plata.
export function Rosca({ partes, titulo, centro, formato }) {
  const [hover, setHover] = useState(null)
  const lista = (partes || []).filter(p => Number(p?.valor) > 0)
  const tot = lista.reduce((s, p) => s + Number(p.valor), 0)
  if (!tot) return <p className="muted small">Sin datos todavía.</p>
  const R = 48, r = 30
  let ang = -Math.PI / 2
  const arcos = lista.map(p => {
    const a0 = ang, a1 = ang + (p.valor / tot) * 2 * Math.PI
    ang = a1
    const grande = a1 - a0 > Math.PI ? 1 : 0
    const P = (rad, a) => [60 + rad * Math.cos(a), 60 + rad * Math.sin(a)]
    const [x0, y0] = P(R, a0), [x1, y1] = P(R, a1), [x2, y2] = P(r, a1), [x3, y3] = P(r, a0)
    // hacia donde "sale" la porcion cuando se la señala
    const med = (a0 + a1) / 2
    return { ...p, dx: Math.cos(med) * 3.5, dy: Math.sin(med) * 3.5,
      d: `M${x0},${y0} A${R},${R} 0 ${grande} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${grande} 0 ${x3},${y3} Z` }
  })
  const h = hover != null ? arcos[hover] : null
  const fmt = v => (formato ? formato(v) : v)
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg viewBox="0 0 120 120" style={{ width: 132, height: 132, flex: '0 0 auto' }} onMouseLeave={() => setHover(null)}>
        {arcos.map((a, i) => (
          <path key={a.label} d={a.d} fill={a.color} onMouseEnter={() => setHover(i)}
            transform={hover === i ? `translate(${a.dx} ${a.dy})` : undefined}
            opacity={hover == null || hover === i ? 1 : .4}
            style={{ cursor: 'default', transition: 'opacity .12s' }} />
        ))}
        {h ? (
          <>
            <text x="60" y="56" textAnchor="middle" fontSize="15" fontWeight="700" fill={h.color}>{fmt(h.valor)}</text>
            <text x="60" y="68" textAnchor="middle" fontSize="8.5" fill="currentColor" opacity=".75">
              {String(h.label).slice(0, 16)} · {(h.valor / tot * 100).toFixed(0)}%
            </text>
          </>
        ) : (
          <>
            {centro && <text x="60" y="58" textAnchor="middle" fontSize="19" fontWeight="700" fill="currentColor">{centro}</text>}
            {titulo && <text x="60" y="72" textAnchor="middle" fontSize="9" fill="currentColor" opacity=".6">{titulo}</text>}
          </>
        )}
      </svg>
      <div style={{ flex: '1 1 130px', fontSize: 12 }}>
        {arcos.map((a, i) => (
          <div key={a.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, padding: '1px 4px',
              borderRadius: 5, background: hover === i ? 'rgba(255,255,255,.08)' : 'transparent' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: a.color, flex: '0 0 auto' }} />
            <span style={{ flex: 1 }}>{a.label}</span>
            <b>{fmt(a.valor)}</b>
            <span className="muted" style={{ width: 44, textAlign: 'right' }}>{(a.valor / tot * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------- BARRAS HORIZONTALES
// Comparar proyectos entre si (mora, cartera, lo que sea).
export function BarrasH({ filas, formato = soles }) {
  const [hover, setHover] = useState(null)
  if (!filas?.length) return <p className="muted small">Sin datos todavía.</p>
  const tope = Math.max(...filas.map(f => f.valor), 1)
  const total = filas.reduce((s, f) => s + Number(f.valor || 0), 0)
  return (
    <div style={{ fontSize: 12 }} onMouseLeave={() => setHover(null)}>
      {filas.map((f, i) => (
        <div key={f.label} onMouseEnter={() => setHover(i)}
          style={{ marginBottom: 7, padding: '2px 4px', borderRadius: 6, transition: 'background .12s',
            background: hover === i ? 'rgba(255,255,255,.07)' : 'transparent' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2, gap: 8 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}</span>
            <b style={{ color: f.color, flex: '0 0 auto' }}>
              {formato(f.valor)}
              {hover === i && total > 0 && (
                <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>
                  {(f.valor / total * 100).toFixed(0)}% del total
                </span>
              )}
            </b>
          </div>
          <div style={{ background: 'rgba(255,255,255,.09)', borderRadius: 4, height: hover === i ? 12 : 9, transition: 'height .12s' }}>
            <div style={{ width: (f.valor / tope * 100) + '%', background: f.color || '#4bb96a', height: '100%', borderRadius: 4,
              opacity: hover == null || hover === i ? 1 : .5, transition: 'opacity .12s' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------ CHISPA (sparkline)
// Una rayita de tendencia para meter DENTRO de una tarjeta KPI. No lleva ejes ni
// numeros: no es para leer cifras, es para ver la forma — si viene subiendo o
// cayendo. La cifra exacta ya esta escrita arriba, en la tarjeta.
export function Chispa({ datos, color = '#4bb96a', alto = 26 }) {
  const v = (datos || []).map(Number).filter(n => Number.isFinite(n))
  if (v.length < 2) return null
  const W = 100, H = alto, max = Math.max(...v), min = Math.min(...v)
  const rango = max - min || 1
  const px = i => (i / (v.length - 1)) * W
  const py = n => H - 2 - ((n - min) / rango) * (H - 4)
  const pts = v.map((n, i) => `${px(i)},${py(n)}`).join(' ')
  const ult = v[v.length - 1], ant = v[v.length - 2]
  const sube = ult >= ant
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: alto, marginTop: 4, display: 'block' }}>
      <polyline points={`0,${H} ${pts} ${W},${H}`} fill={color} opacity=".13" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <circle cx={W} cy={py(ult)} r="2.4" fill={sube ? color : '#d9534f'} />
    </svg>
  )
}

// ----------------------------------------------------------------- LINEAS
// Dos o mas series sobre el mismo eje: sirve para "lo que debio entrar contra lo
// que entro" y para "este año contra el pasado". Lo que importa no es cada punto
// sino la DISTANCIA entre las lineas, asi que la brecha se pinta.
export function Lineas({ series, etiquetas, alto = 240, brecha = false, formato = soles }) {
  const [hover, setHover] = useState(null)
  if (!series?.length || !etiquetas?.length) return <p className="muted small">Sin datos todavía.</p>
  const W = 760, H = alto, padL = 52, padB = 34, padT = 12
  const tope = Math.max(...series.flatMap(s => s.datos), 1)
  const x = i => padL + (etiquetas.length === 1 ? 0 : (i / (etiquetas.length - 1)) * (W - padL - 14))
  const y = v => padT + (H - padT - padB) * (1 - v / tope)
  const pts = s => s.datos.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} onMouseLeave={() => setHover(null)}>
        {[0, .25, .5, .75, 1].map(f => (
          <g key={f}>
            <line x1={padL} x2={W - 8} y1={y(tope * f)} y2={y(tope * f)} stroke="currentColor" opacity=".12" />
            <text x={padL - 6} y={y(tope * f) + 3} textAnchor="end" fontSize="9.5" fill="currentColor" opacity=".55">{corto(tope * f)}</text>
          </g>
        ))}
        {brecha && series.length >= 2 && (
          <polygon points={`${pts(series[0])} ${series[1].datos.map((v, i) => `${x(etiquetas.length - 1 - i)},${y(series[1].datos[etiquetas.length - 1 - i])}`).join(' ')}`}
            fill={series[0].color} opacity=".12" />
        )}
        {series.map(s => (
          <g key={s.label}>
            <polyline points={pts(s)} fill="none" stroke={s.color} strokeWidth="2.2"
              strokeDasharray={s.punteada ? '5 4' : undefined} />
            {s.datos.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4 : 2.4} fill={s.color} />)}
          </g>
        ))}
        {etiquetas.map((e, i) => (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <rect x={x(i) - (W - padL) / etiquetas.length / 2} y={padT} width={(W - padL) / etiquetas.length}
              height={H - padT - padB} fill={hover === i ? 'rgba(255,255,255,.06)' : 'transparent'} />
            <text x={x(i)} y={H - padB + 14} textAnchor="middle" fontSize="9.5" fill="currentColor"
              opacity={hover === i ? 1 : .6} fontWeight={hover === i ? 700 : 400}>{e}</text>
          </g>
        ))}
        <g transform={`translate(${padL},${H - 5})`} fontSize="9.5" fill="currentColor">
          {series.map((s, i) => (
            <g key={s.label} transform={`translate(${i * 132},0)`}>
              <line x1="0" y1="-3" x2="14" y2="-3" stroke={s.color} strokeWidth="2.2" strokeDasharray={s.punteada ? '5 4' : undefined} />
              <text x="18" y="1" opacity=".75">{s.label}</text>
            </g>
          ))}
        </g>
      </svg>
      {hover != null && (
        <div style={{
          position: 'absolute', top: 6, right: 6, background: 'var(--panel-2, rgba(20,26,22,.97))',
          border: '1px solid rgba(255,255,255,.18)', borderRadius: 8, padding: '7px 10px',
          fontSize: 12, pointerEvents: 'none', minWidth: 160, boxShadow: '0 6px 18px rgba(0,0,0,.45)',
        }}>
          <b style={{ display: 'block', marginBottom: 3 }}>{etiquetas[hover]}</b>
          {series.map(s => (
            <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: s.color }}>{s.label}</span><b>{formato(s.datos[hover])}</b>
            </div>
          ))}
          {series.length >= 2 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, borderTop: '1px solid rgba(255,255,255,.14)', marginTop: 3, paddingTop: 3 }}>
              <span className="muted">diferencia</span>
              <b style={{ color: series[1].datos[hover] >= series[0].datos[hover] ? '#4bb96a' : '#d9534f' }}>
                {formato(series[1].datos[hover] - series[0].datos[hover])}
              </b>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
