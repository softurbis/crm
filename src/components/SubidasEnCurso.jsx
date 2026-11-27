import { useEffect, useRef, useState } from 'react'
import '../styles/subidas.css'

// SUBIDAS EN CURSO (26 nov 2026): una tarjetita en la esquina por cada archivo que se
// está subiendo (vouchers, RH, contratos, fotos…), con el porcentaje y cuánto falta.
// Los avisos los manda lib/archivos.js con el evento 'urbis-subida'. Las subidas
// rápidas (menos de medio segundo) no se muestran: serían un parpadeo.
const APARECE_MS = 500
const LISTO_MS = 1800
const ERROR_MS = 8000

const mb = b => (b / 1048576).toLocaleString('es-PE', { maximumFractionDigits: 1, minimumFractionDigits: b < 10485760 ? 1 : 0 }) + ' MB'
const segundos = s => s < 1 ? 'un momento' : s < 60 ? Math.ceil(s) + ' s' : Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s'

export default function SubidasEnCurso() {
  const [lista, setLista] = useState([])          // [{ id, nombre, estado, cargado, total, inicio, ... }]
  const [, setTic] = useState(0)                  // para que aparezcan a los 500 ms aunque no lleguen avisos
  const quitar = useRef(new Map())

  useEffect(() => {
    const alAviso = ev => {
      const d = ev.detail || {}
      setLista(prev => {
        const ahora = Date.now()
        const i = prev.findIndex(x => x.id === d.id)
        const antes = i >= 0 ? prev[i] : { id: d.id, inicio: ahora }
        const nuevo = { ...antes, ...d, actualizado: ahora }
        // la velocidad se mide desde que empezó a subir este intento
        if (d.estado === 'subiendo' && (antes.estado !== 'subiendo' || antes.intento !== d.intento)) nuevo.inicioSubida = ahora
        const sig = i >= 0 ? prev.map((x, k) => (k === i ? nuevo : x)) : [...prev, nuevo]
        return sig
      })
      // terminadas: se quedan un ratito y se van solas
      if (d.estado === 'listo' || d.estado === 'error') {
        clearTimeout(quitar.current.get(d.id))
        quitar.current.set(d.id, setTimeout(() => setLista(prev => prev.filter(x => x.id !== d.id)), d.estado === 'listo' ? LISTO_MS : ERROR_MS))
      }
    }
    window.addEventListener('urbis-subida', alAviso)
    const t = setInterval(() => setTic(n => n + 1), 250)
    const timers = quitar.current
    return () => { window.removeEventListener('urbis-subida', alAviso); clearInterval(t); timers.forEach(clearTimeout) }
  }, [])

  // mientras algo sube, cerrar la pestaña o recargar pregunta antes (se perdería la subida)
  const activas = lista.filter(x => x.estado !== 'listo' && x.estado !== 'error')
  useEffect(() => {
    if (!activas.length) return
    const avisar = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [activas.length])

  const ahora = Date.now()
  // las que terminaron rápido nunca se mostraron: tampoco se muestra su "listo"
  const visibles = lista.filter(x => (x.mostrada = x.mostrada || (x.estado !== 'listo' && ahora - x.inicio >= APARECE_MS)))
  if (!visibles.length) return null

  return (
    <div className="subidas" role="status" aria-live="polite">
      {visibles.map(x => {
        const pct = x.total ? Math.min(100, Math.round(100 * (x.cargado || 0) / x.total)) : null
        let detalle = ''
        if (x.estado === 'preparando') detalle = 'Preparando el archivo…'
        else if (x.estado === 'reintentando') detalle = 'Se cortó la conexión. Reintentando' + (x.intento ? ' (' + x.intento + ' de 3)' : '') + '…'
        else if (x.estado === 'respaldo') detalle = 'Subiendo por el servidor de respaldo…'
        else if (x.estado === 'listo') detalle = 'Subido'
        else if (x.estado === 'error') detalle = 'No se pudo subir: ' + (x.mensaje || 'error desconocido')
        else if (x.estado === 'subiendo' && x.total) {
          const seg = (ahora - (x.inicioSubida || x.inicio)) / 1000
          const vel = seg > 0.4 ? (x.cargado || 0) / seg : 0
          const falta = vel > 0 ? (x.total - (x.cargado || 0)) / vel : null
          detalle = pct + '% · ' + mb(x.cargado || 0) + ' de ' + mb(x.total)
            + (pct >= 100 ? ' · terminando…' : falta != null ? ' · quedan ~' + segundos(falta) : '')
        }
        const indeterminada = x.estado === 'preparando' || x.estado === 'respaldo' || x.estado === 'reintentando' || (x.estado === 'subiendo' && pct >= 100)
        return (
          <div key={x.id} className={'subida ' + x.estado}>
            <span className="subida-ico" aria-hidden="true">{x.estado === 'listo' ? '✓' : x.estado === 'error' ? '!' : '⬆'}</span>
            <div className="subida-txt">
              <b title={x.nombre}>{x.nombre}</b>
              <small>{detalle}</small>
              {x.estado !== 'listo' && x.estado !== 'error' && (
                <div className={'subida-barra' + (indeterminada ? ' ind' : '')}>
                  <i style={indeterminada ? undefined : { width: (pct || 0) + '%' }} />
                </div>
              )}
            </div>
            {x.estado === 'error' && (
              <button type="button" className="subida-cerrar" aria-label="Cerrar" onClick={() => setLista(p => p.filter(y => y.id !== x.id))}>✕</button>
            )}
          </div>
        )
      })}
    </div>
  )
}
