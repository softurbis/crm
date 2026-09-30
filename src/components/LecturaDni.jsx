import { useEffect, useRef, useState } from 'react'
import { leerDni, avisosDni, ETIQUETAS_DNI } from '../lib/leerDni'

// Estado de la lectura del DNI con IA, para los dos formularios que piden el DNI
// (ficha del lote y Clientes). leer(archivos, aplicar): aplicar(L) pone lo leído
// en el formulario y devuelve { puestos, cambios } para mostrarlos. Si se elige
// otro archivo mientras se lee, la lectura vieja se descarta.
export function useLecturaDni() {
  const [estado, setEstado] = useState(null)   // { fase: subiendo|leyendo|listo|error, ... }
  const turno = useRef(0)
  const vivo = useRef(true)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])

  async function leer(archivos, aplicar) {
    const mio = ++turno.current
    const sigue = () => vivo.current && mio === turno.current
    setEstado({ fase: 'subiendo' })
    try {
      const L = await leerDni(archivos, fase => sigue() && setEstado({ fase }))
      if (!sigue()) return
      const r = (await aplicar(L)) || {}
      if (!sigue()) return
      setEstado({ fase: 'listo', puestos: r.puestos || [], cambios: r.cambios || [], avisos: avisosDni(L) })
    } catch (e) {
      if (sigue()) setEstado({ fase: 'error', error: e.message })
    }
  }
  const limpiar = () => { turno.current++; setEstado(null) }
  return { estado, leer, limpiar, leyendo: estado?.fase === 'subiendo' || estado?.fase === 'leyendo' }
}

export function AvisoLecturaDni({ estado }) {
  if (!estado) return null
  const caja = { margin: '6px 0 0', padding: '7px 10px', borderRadius: 8, textTransform: 'none', fontSize: 13 }
  if (estado.fase === 'subiendo' || estado.fase === 'leyendo') return (
    <p className="muted" style={{ ...caja, background: 'rgba(255,255,255,.05)' }}>
      &#128269; {estado.fase === 'subiendo' ? 'Subiendo el DNI…' : 'Leyendo el DNI con IA (unos segundos)…'} Los datos se llenan solos.
    </p>
  )
  if (estado.fase === 'error') return (
    <p className="warn" style={{ ...caja, background: 'rgba(224,178,63,.08)' }}>
      &#9888; No se pudo leer el DNI: {estado.error}. Llena los datos a mano.
    </p>
  )
  const { puestos, cambios, avisos } = estado
  const nada = !puestos.length && !cambios.length
  return (
    <div style={{ ...caja, background: 'rgba(120,200,120,.07)', border: '1px solid rgba(120,200,120,.25)' }}>
      <div className="ok">
        {nada
          ? '✓ DNI leído: los datos del formulario ya coinciden con el documento.'
          : `✓ DNI leído: se ${puestos.length + cambios.length === 1 ? 'llenó 1 dato' : 'llenaron ' + (puestos.length + cambios.length) + ' datos'}. Revísalos antes de guardar.`}
      </div>
      {cambios.map(c => (
        <div key={c.campo} className="small">
          &#9998; Se cambió <b>{ETIQUETAS_DNI[c.campo] || c.campo}</b>: antes decía «{c.antes}», el DNI dice «{c.ahora}».
        </div>
      ))}
      {avisos.map((a, i) => <div key={i} className="warn small">&#9888; {a}</div>)}
    </div>
  )
}
