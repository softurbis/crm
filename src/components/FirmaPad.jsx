import { useEffect, useRef, useState } from 'react'

// ============================================================
// RECUADRO PARA FIRMAR — con el dedo (celular) o el mouse
// ------------------------------------------------------------
// Devuelve un PNG con fondo TRANSPARENTE: la firma se imprime limpia sobre la
// constancia, sin un rectangulo blanco alrededor. El fondo blanco que se ve al
// firmar es solo CSS (no forma parte de la imagen).
// touch-action: none evita que la pagina se desplace mientras se firma en el
// celular — sin eso, cada trazo movia la pantalla y la firma salia cortada.
// ============================================================
export default function FirmaPad({ onGuardar, busy, alto = 180 }) {
  const cv = useRef(null)
  const dibujando = useRef(false)
  const ultimo = useRef(null)
  const [trazos, setTrazos] = useState(0)

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
        <button type="button" className="btn-primary" disabled={busy || trazos < 1} onClick={guardar}>
          {busy ? 'Guardando…' : 'Guardar mi firma'}
        </button>
        <button type="button" className="btn-ghost" disabled={busy || trazos < 1} onClick={limpiar}>
          Borrar y volver a firmar
        </button>
      </div>
    </div>
  )
}
