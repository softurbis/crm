// Miniatura del usuario. Si no tiene foto, muestra sus iniciales sobre un color
// derivado del nombre (siempre el mismo para la misma persona), asi nunca sale un
// hueco vacio y se distinguen entre si de un vistazo.
const COLORES = ['#8fd16f', '#7bb6e0', '#e8b04f', '#c58ae0', '#6fd1c0', '#f2785c', '#e8a0c8', '#56c7d6']

export const iniciales = nombre => (nombre || '?')
  .trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || '?'

export const colorDeNombre = nombre => {
  let h = 0
  for (const c of (nombre || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLORES[h % COLORES.length]
}

export default function Avatar({ url, nombre, size = 30, title }) {
  const estilo = {
    width: size, height: size, borderRadius: '50%', flex: 'none',
    display: 'grid', placeItems: 'center', overflow: 'hidden',
    fontSize: Math.max(9, Math.round(size * 0.38)), fontWeight: 800,
    letterSpacing: '.02em', lineHeight: 1,
  }
  if (url) {
    return (
      <img src={url} alt={nombre || 'foto'} title={title || nombre}
        style={{ ...estilo, objectFit: 'cover', border: '1px solid rgba(255,255,255,.18)' }} />
    )
  }
  const c = colorDeNombre(nombre)
  return (
    <span title={title || nombre} style={{
      ...estilo,
      background: `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 55%, #0d150f))`,
      color: '#0d150f',
      border: '1px solid rgba(255,255,255,.18)',
    }}>{iniciales(nombre)}</span>
  )
}
