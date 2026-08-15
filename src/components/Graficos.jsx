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
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 })
const corto = n => {
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
export function BarrasMes({ meses, alto = 210 }) {
  if (!meses?.length) return <p className="muted small">Sin datos todavía.</p>
  const W = 760, H = alto, padL = 44, padB = 34, padT = 14
  const tope = Math.max(...meses.flatMap(m => [m.rec, m.gastos]), 1)
  const anchoCol = (W - padL - 10) / meses.length
  const bw = Math.min(20, anchoCol / 3.2)
  const y = v => padT + (H - padT - padB) * (1 - v / tope)
  const balance = meses.map((m, i) => [padL + anchoCol * i + anchoCol / 2, y(Math.max(0, m.rec - m.gastos))])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      {[0, .25, .5, .75, 1].map(f => (
        <g key={f}>
          <line x1={padL} x2={W - 6} y1={y(tope * f)} y2={y(tope * f)} stroke="currentColor" opacity=".12" />
          <text x={padL - 6} y={y(tope * f) + 3} textAnchor="end" fontSize="9" fill="currentColor" opacity=".5">{corto(tope * f)}</text>
        </g>
      ))}
      {meses.map((m, i) => {
        const x = padL + anchoCol * i + anchoCol / 2
        return (
          <g key={m.ym}>
            <rect x={x - bw - 2} y={y(m.rec)} width={bw} height={Math.max(1, y(0) - y(m.rec))} rx="2" fill="#4bb96a" />
            <rect x={x + 2} y={y(m.gastos)} width={bw} height={Math.max(1, y(0) - y(m.gastos))} rx="2" fill="#d9754f" />
            <text x={x} y={H - padB + 13} textAnchor="middle" fontSize="9" fill="currentColor" opacity=".6">{m.lbl}</text>
            <title>{m.lbl}: cobrado {soles(m.rec)} · gastos {soles(m.gastos)} · balance {soles(m.rec - m.gastos)}</title>
          </g>
        )
      })}
      <polyline points={balance.map(p => p.join(',')).join(' ')} fill="none" stroke="#7ec8e3" strokeWidth="1.8" opacity=".9" />
      {balance.map(([x, yy], i) => <circle key={i} cx={x} cy={yy} r="2.6" fill="#7ec8e3" />)}
      <g transform={`translate(${padL},${H - 6})`} fontSize="9" fill="currentColor">
        <rect x="0" y="-7" width="9" height="9" rx="2" fill="#4bb96a" /><text x="13" y="1" opacity=".7">cobrado</text>
        <rect x="70" y="-7" width="9" height="9" rx="2" fill="#d9754f" /><text x="83" y="1" opacity=".7">gastos</text>
        <line x1="135" y1="-3" x2="150" y2="-3" stroke="#7ec8e3" strokeWidth="1.8" /><text x="154" y="1" opacity=".7">balance</text>
      </g>
    </svg>
  )
}

// --------------------------------------------------------------- ROSCA (donut)
// Composicion: en qué estado están los lotes, o de dónde sale la plata.
export function Rosca({ partes, titulo, centro }) {
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
    return { ...p, d: `M${x0},${y0} A${R},${R} 0 ${grande} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${grande} 0 ${x3},${y3} Z` }
  })
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg viewBox="0 0 120 120" style={{ width: 128, height: 128, flex: '0 0 auto' }}>
        {arcos.map(a => <path key={a.label} d={a.d} fill={a.color}><title>{a.label}: {a.valor} ({(a.valor / tot * 100).toFixed(1)}%)</title></path>)}
        {centro && <text x="60" y="58" textAnchor="middle" fontSize="19" fontWeight="700" fill="currentColor">{centro}</text>}
        {titulo && <text x="60" y="72" textAnchor="middle" fontSize="9" fill="currentColor" opacity=".6">{titulo}</text>}
      </svg>
      <div style={{ flex: '1 1 130px', fontSize: 12 }}>
        {arcos.map(a => (
          <div key={a.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: a.color, flex: '0 0 auto' }} />
            <span style={{ flex: 1 }}>{a.label}</span>
            <b>{a.valor}</b>
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
  if (!filas?.length) return <p className="muted small">Sin datos todavía.</p>
  const tope = Math.max(...filas.map(f => f.valor), 1)
  return (
    <div style={{ fontSize: 12 }}>
      {filas.map(f => (
        <div key={f.label} style={{ marginBottom: 7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
            <span>{f.label}</span><b style={{ color: f.color }}>{formato(f.valor)}</b>
          </div>
          <div style={{ background: 'rgba(255,255,255,.09)', borderRadius: 4, height: 9 }}>
            <div style={{ width: (f.valor / tope * 100) + '%', background: f.color || '#4bb96a', height: '100%', borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  )
}
