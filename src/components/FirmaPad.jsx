import { useEffect, useRef, useState } from 'react'

// ============================================================
// RECUADRO PARA FIRMAR — dibujada (dedo/mouse) o SUBIDA como foto
// ------------------------------------------------------------
// Devuelve un PNG con fondo TRANSPARENTE: la firma se imprime limpia sobre la
// constancia, sin un rectangulo blanco alrededor. El fondo blanco que se ve al
// firmar es solo CSS (no forma parte de la imagen).
// Si se sube la FOTO de una firma en papel, se limpia sola: todo lo claro (el
// papel) se vuelve transparente, se recortan los margenes vacios y queda solo
// el trazo. Asi una foto del celular sirve igual que la dibujada a mano.
// touch-action: none evita que la pagina se desplace mientras se firma en el
// celular — sin eso, cada trazo movia la pantalla y la firma salia cortada.
// ============================================================

const CLARO = 195   // mas claro que esto es papel: se vuelve transparente

// Devuelve un canvas con la firma sobre fondo transparente y recortada, o null
// si la foto no tiene ningun trazo oscuro.
async function limpiarFoto(file) {
  const bitmap = await createImageBitmap(file)
  const escala = Math.min(1, 1600 / bitmap.width)
  const c = document.createElement('canvas')
  c.width = Math.round(bitmap.width * escala)
  c.height = Math.round(bitmap.height * escala)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, c.width, c.height)

  const img = ctx.getImageData(0, 0, c.width, c.height)
  const d = img.data
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    // cuanto mas oscuro el pixel, mas opaco queda el trazo (bordes suaves)
    const a = d[i + 3] === 0 || lum >= CLARO ? 0 : Math.min(255, Math.round((CLARO - lum) * 255 / CLARO))
    d[i] = d[i + 1] = d[i + 2] = 17
    d[i + 3] = a
    if (a > 40) {
      const x = p % c.width, y = (p / c.width) | 0
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  ctx.putImageData(img, 0, 0)
  if (x1 < 0) return null

  const m = 6   // un respiro alrededor del trazo
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m)
  x1 = Math.min(c.width - 1, x1 + m); y1 = Math.min(c.height - 1, y1 + m)
  const rec = document.createElement('canvas')
  rec.width = x1 - x0 + 1
  rec.height = y1 - y0 + 1
  rec.getContext('2d').drawImage(c, x0, y0, rec.width, rec.height, 0, 0, rec.width, rec.height)
  return rec
}

export default function FirmaPad({ onGuardar, busy, alto = 180 }) {
  const cv = useRef(null)
  const dibujando = useRef(false)
  const ultimo = useRef(null)
  const [trazos, setTrazos] = useState(0)
  const [error, setError] = useState('')
  const [leyendo, setLeyendo] = useState(false)

  useEffect(() => {
    const c = cv.current
    // el lienzo se dimensiona en pixeles REALES de la pantalla: en un celular
    // con densidad 3x, un canvas de 300 px dibujaria una firma borrosa
    const ajustar = () => {
      const r = c.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      c.width = Math.round(r.width * dpr)
      c.height = Math.round(r.height * dpr)
      const ctx = c.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineWidth = 2.4
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#111'
      setTrazos(0)   // redimensionar borra el lienzo: el contador tiene que saberlo
    }
    ajustar()
    window.addEventListener('resize', ajustar)
    return () => window.removeEventListener('resize', ajustar)
  }, [])

  const pos = e => {
    const r = cv.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const bajar = e => {
    e.preventDefault()
    cv.current.setPointerCapture?.(e.pointerId)
    dibujando.current = true
    ultimo.current = pos(e)
  }
  const mover = e => {
    if (!dibujando.current) return
    const p = pos(e)
    const ctx = cv.current.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(ultimo.current.x, ultimo.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ultimo.current = p
  }
  const subir = () => {
    if (dibujando.current) setTrazos(n => n + 1)
    dibujando.current = false
  }
  const limpiar = () => {
    const c = cv.current
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    setTrazos(0)
    setError('')
  }

  // Subir la FOTO de la firma en papel: se limpia y se muestra en el recuadro,
  // para revisarla antes de guardarla.
  const subirFoto = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(''); setLeyendo(true)
    try {
      const rec = await limpiarFoto(file)
      if (!rec) { setError('En esa foto no se encontró ningún trazo. Que la firma esté en papel blanco y con buena luz.'); setLeyendo(false); return }
      const c = cv.current
      const ctx = c.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      const w = c.width / dpr, h = c.height / dpr
      ctx.clearRect(0, 0, w, h)
      const k = Math.min(w / rec.width, h / rec.height) * 0.92
      ctx.drawImage(rec, (w - rec.width * k) / 2, (h - rec.height * k) / 2, rec.width * k, rec.height * k)
      setTrazos(1)
    } catch (err) {
      setError('No se pudo leer la imagen: ' + (err.message || err))
    }
    setLeyendo(false)
  }

  const guardar = () => {
    if (trazos < 1) return
    cv.current.toBlob(b => { if (b) onGuardar(new File([b], 'firma.png', { type: 'image/png' })) }, 'image/png')
  }

  return (
    <div>
      <canvas
        ref={cv}
        onPointerDown={bajar}
        onPointerMove={mover}
        onPointerUp={subir}
        onPointerCancel={subir}
        aria-label="Recuadro para dibujar la firma"
        style={{
          width: '100%', height: alto, display: 'block', background: '#fff',
          borderRadius: 8, border: '1px dashed rgba(0,0,0,.3)', touchAction: 'none', cursor: 'crosshair',
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn-primary" disabled={busy || leyendo || trazos < 1} onClick={guardar}>
          {busy ? 'Guardando…' : 'Guardar firma'}
        </button>
        <label className="btn-act" style={{ cursor: leyendo ? 'wait' : 'pointer' }}>
          {leyendo ? 'Limpiando la foto…' : '📷 Subir foto de la firma'}
          <input type="file" accept="image/*" hidden disabled={busy || leyendo} onChange={subirFoto} />
        </label>
        <button type="button" className="btn-ghost" disabled={busy || leyendo || trazos < 1} onClick={limpiar}>
          Borrar y empezar de nuevo
        </button>
      </div>
      <p className="muted small" style={{ textTransform: 'none', marginTop: 6 }}>
        La foto se limpia sola: el papel se vuelve transparente y queda solo el trazo. Revisa cómo quedó en el recuadro antes de guardar.
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
