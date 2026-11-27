// ============================================================
// EL PANEL DENTRO DE LA APP DE ESCRITORIO (Urbis Control para Windows, escritorio/)
// ------------------------------------------------------------
// La app abre este mismo panel con WebView2. Desde la v1.2 el panel le avisa lo que
// está pendiente (gastos por firmar o pagar, cartas, reclamos, prospectos) y la app lo
// muestra como aviso de Windows aunque esté minimizada; al hacerle clic, la app le
// pide al panel ir a esa pantalla. En el navegador nada de esto existe y no hace nada.
// ============================================================

// ¿estamos dentro de la app? (window.chrome.webview solo existe en WebView2)
export const enApp = () => typeof window !== 'undefined' && typeof window.chrome?.webview?.postMessage === 'function'

// un aviso para Windows: { titulo, texto, ir: { a: '/gastos', proyecto } }
export function avisarApp(aviso) {
  if (!enApp()) return false
  try { window.chrome.webview.postMessage({ tipo: 'aviso', ...aviso }); return true } catch { return false }
}

// lo que la app le pide al panel (por ahora: { tipo: 'ir', a, proyecto } al tocar un aviso)
export function escucharApp(alMensaje) {
  if (!enApp()) return () => {}
  const h = e => {
    let m = e.data
    try { if (typeof m === 'string') m = JSON.parse(m) } catch { return }
    if (m && typeof m === 'object') alMensaje(m)
  }
  window.chrome.webview.addEventListener('message', h)
  return () => window.chrome.webview.removeEventListener('message', h)
}

// Qué avisar: lo que SUBIÓ desde la última vez. `pendientes` = [{ clave, n, titulo, texto, ir }]
// y `avisados` = Map clave → cuántos había la última vez (se actualiza aquí). Lo que bajó o
// desapareció se recuerda con su número nuevo: si después vuelve a subir, se avisa otra vez.
// Si hay varios nuevos a la vez, va UN solo aviso con todo (Windows muestra uno por vez).
export function avisosNuevos(pendientes, avisados) {
  const nuevos = []
  const claves = new Set()
  for (const p of pendientes) {
    claves.add(p.clave)
    if (p.n > (avisados.get(p.clave) || 0)) nuevos.push(p)
    avisados.set(p.clave, p.n)
  }
  for (const k of [...avisados.keys()]) if (!claves.has(k)) avisados.set(k, 0)
  if (nuevos.length <= 1) return nuevos
  return [{
    titulo: `🔔 Tienes ${nuevos.length} pendientes`,
    texto: nuevos.map(p => p.texto).join('\n'),
    ir: nuevos[0].ir,
  }]
}
