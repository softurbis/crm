// Mapa radial del "cerebro" del bot (estilo constelación).
// Nodo central = el bot; cada rama = un cerebro editable. Gira lento y cada
// nodo es clicable para abrir su editor. Los % indican cuánto contenido tiene.
export default function BrainMap({ nodes, selected, onSelect, titulo = 'Cerebro de Urbis' }) {
  const CX = 200, CY = 205, R = 132
  const N = nodes.length || 1
  const listo = Math.round(nodes.reduce((s, n) => s + n.nivel, 0) / N * 100)
  const puntos = nodes.map((n, i) => {
    const ang = (i / N) * Math.PI * 2 - Math.PI / 2
    return { ...n, x: CX + R * Math.cos(ang), y: CY + R * Math.sin(ang), ang }
  })
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 460, margin: '0 auto' }}>
      <style>{`
        @keyframes bm-pulse { 0%,100%{opacity:.35} 50%{opacity:.9} }
        .bm-node { cursor: pointer; }
        .bm-node:hover .bm-ring { stroke-width: 3.5; }
        .bm-glow { animation: bm-pulse 3.2s ease-in-out infinite; }
      `}</style>
      <div style={{ position: 'absolute', top: 10, left: 12, zIndex: 2, pointerEvents: 'none' }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>🧠 {titulo}</div>
        <div className="muted" style={{ fontSize: 11 }}><b style={{ color: 'var(--accent-strong)' }}>{listo}% listo</b> · gira · toca un nodo para editar</div>
      </div>
      <svg viewBox="0 0 400 415" style={{ width: '100%', display: 'block' }}>
        <defs>
          <radialGradient id="bm-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#bfe3a6" />
            <stop offset="100%" stopColor="#9ccb86" />
          </radialGradient>
        </defs>
        <g>
          <animateTransform attributeName="transform" type="rotate" from={`0 ${CX} ${CY}`} to={`360 ${CX} ${CY}`} dur="150s" repeatCount="indefinite" />
          {/* conectores */}
          {puntos.map(p => (
            <line key={'l' + p.key} x1={CX} y1={CY} x2={p.x} y2={p.y}
              stroke={p.color} strokeOpacity={p.selected ? 0.85 : 0.28} strokeWidth={p.selected ? 2 : 1.2} />
          ))}
          {/* nodos */}
          {puntos.map(p => {
            const rr = 20 + p.nivel * 8
            const dots = Math.max(3, Math.min(8, 3 + Math.round(p.nivel * 6)))
            return (
              <g key={p.key} className="bm-node" onClick={() => onSelect(p.key)}>
                {/* dotitos decorativos que salen hacia afuera */}
                {Array.from({ length: dots }).map((_, d) => {
                  const spread = 0.9
                  const a = p.ang + (d - (dots - 1) / 2) * (spread / dots)
                  const dr = rr + 10 + (d % 3) * 7
                  return <circle key={d} cx={p.x + dr * Math.cos(a)} cy={p.y + dr * Math.sin(a)} r={2.1} fill={p.color} opacity={0.5} />
                })}
                <circle className="bm-ring" cx={p.x} cy={p.y} r={rr} fill={p.color} fillOpacity={0.14}
                  stroke={p.color} strokeOpacity={p.selected ? 1 : 0.7} strokeWidth={p.selected ? 3 : 1.6} />
                {/* relleno interno segun nivel */}
                <circle cx={p.x} cy={p.y} r={Math.max(3, (rr - 6) * p.nivel)} fill={p.color} fillOpacity={0.6} />
                {/* etiqueta: contra-gira para quedar derecha */}
                <g>
                  <animateTransform attributeName="transform" type="rotate" from={`0 ${p.x} ${p.y}`} to={`-360 ${p.x} ${p.y}`} dur="150s" repeatCount="indefinite" />
                  <text x={p.x} y={p.y + rr + 13} textAnchor="middle" fontSize="11" fontWeight="700"
                    fill={p.selected ? p.color : '#eef3ea'} style={{ letterSpacing: '.3px' }}>{p.label}</text>
                  {p.badge != null && (
                    <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="12" fontWeight="800" fill="#0d1512">{p.badge}</text>
                  )}
                </g>
              </g>
            )
          })}
        </g>
        {/* nucleo (no gira) */}
        <circle className="bm-glow" cx={CX} cy={CY} r={40} fill="url(#bm-core)" opacity={0.25} />
        <circle cx={CX} cy={CY} r={30} fill="url(#bm-core)" />
        <text x={CX} y={CY - 2} textAnchor="middle" fontSize="15">🤖</text>
        <text x={CX} y={CY + 15} textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#0d1512">URBIS</text>
      </svg>
    </div>
  )
}
