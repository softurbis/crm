// Efecto global de "guardado". La idea: cada vez que una acción termina bien
// (un Guardar, una edición, etc.) salta una animación de aviso JUSTO donde el
// usuario hizo su último clic — o sea, sobre el propio botón — para que sepa
// al toque que quedó grabado. Es el mismo aviso en TODA la app, sin tener que
// tocar cada botón: basta con que la página use el hook useMsg (más abajo) en
// lugar de useState para su mensaje de feedback.
//
// Extra "cara loca" (SOLO superusuario): un switch guardado en el navegador
// cambia el ✓ por la foto que el superusuario suba. La foto vive únicamente en
// localStorage de ESA máquina; nunca se sube al repo ni al servidor.
import { useCallback, useState } from 'react'

const KEY_ON = 'urbis.saveFace.on'    // '1' si el switch está activo
const KEY_IMG = 'urbis.saveFace.img'  // dataURL de la cara

// --- último punto de clic (para dibujar la animación "ahí mismo") ------------
let lastX = typeof window !== 'undefined' ? window.innerWidth / 2 : 0
let lastY = typeof window !== 'undefined' ? window.innerHeight / 2 : 0
if (typeof window !== 'undefined') {
  const track = e => {
    const t = (e.touches && e.touches[0]) || e
    if (t && typeof t.clientX === 'number' && (t.clientX || t.clientY)) {
      lastX = t.clientX; lastY = t.clientY
    }
  }
  window.addEventListener('pointerdown', track, true)
  window.addEventListener('click', track, true)
}

// --- switch / foto (localStorage) --------------------------------------------
export const faceOn = () => { try { return localStorage.getItem(KEY_ON) === '1' && !!localStorage.getItem(KEY_IMG) } catch { return false } }
export const faceImg = () => { try { return localStorage.getItem(KEY_IMG) || '' } catch { return '' } }
export const setFaceOn = v => { try { localStorage.setItem(KEY_ON, v ? '1' : '0') } catch {} }
export const setFaceImg = dataUrl => {
  try { if (dataUrl) localStorage.setItem(KEY_IMG, dataUrl); else localStorage.removeItem(KEY_IMG) } catch {}
}

// --- pub/sub -----------------------------------------------------------------
const subs = new Set()
export const onSaveFx = fn => { subs.add(fn); return () => subs.delete(fn) }

// Dispara la animación. `face` va con la foto si el switch está activo; el
// overlay decide si la usa (solo la muestra en sesión de superusuario).
export function savedFx() {
  const face = faceOn() ? faceImg() : ''
  subs.forEach(fn => { try { fn({ x: lastX, y: lastY, face }) } catch {} })
}

// ¿este valor de `msg` significa éxito? Cubre las dos convenciones de la app:
// objeto { ok: true, ... }  y  string que arranca con "✅".
export function esExito(v) {
  if (!v) return false
  if (typeof v === 'object') return v.ok === true
  if (typeof v === 'string') return v.trim().startsWith('✅')
  return false
}

// Drop-in de useState para el estado de feedback: idéntico, pero cuando el
// mensaje que se setea es de éxito, dispara la animación global de guardado.
export function useMsg(initial = null) {
  const [msg, set] = useState(initial)
  const setMsg = useCallback(v => {
    if (typeof v !== 'function' && esExito(v)) savedFx()
    set(v)
  }, [])
  return [msg, setMsg]
}
