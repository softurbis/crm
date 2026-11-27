import { useEffect, useRef, useState } from 'react'
import { consultarDoc } from '../lib/consultaDoc'

// DNI OBLIGATORIO AL CREAR UN USUARIO (sql/242, pedido del dueño 27 nov 2026).
// Al completar los 8 dígitos consulta el nombre (lib/consultaDoc: RENIEC por el
// agente) y se lo pasa a onNombre para llenar "Nombre completo". Un carné de
// extranjería (9 a 12 dígitos) se acepta, pero el nombre se escribe a mano.
export const dniValido = v => /^[0-9]{8,12}$/.test(String(v || '').replace(/\D/g, ''))

export default function CampoDni({ valor, onCambio, onNombre, autoFocus }) {
  const [estado, setEstado] = useState(null)   // null | { t, ok }
  const ultimo = useRef('')
  useEffect(() => {
    const d = String(valor || '').replace(/\D/g, '')
    if (d.length !== 8) { setEstado(null); ultimo.current = ''; return }
    if (d === ultimo.current) return
    ultimo.current = d
    let vivo = true
    setEstado({ t: 'Buscando el nombre…', ok: true })
    consultarDoc(d, { vivo: () => vivo }).then(r => {
      if (!vivo) return
      if (r.ok && r.nombre) {
        const nombre = String(r.nombre).replace(/`/g, "'").trim().toUpperCase()
        onNombre?.(nombre)
        setEstado({ t: 'Nombre según ' + (r.fuente === 'cliente' ? 'su ficha de cliente' : 'RENIEC') + ': ' + nombre, ok: true })
      } else setEstado({ t: r.mensaje || 'No se encontró el nombre: escríbelo a mano.', ok: false })
    })
    return () => { vivo = false }
  }, [valor])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <label>DNI (obligatorio)
      <input inputMode="numeric" value={valor || ''} required autoFocus={autoFocus}
        placeholder="8 dígitos" pattern="[0-9 ]{8,14}" title="DNI de 8 dígitos (o carné de extranjería)"
        onChange={e => onCambio(e.target.value)} />
      {estado && <span className={'small u-tt-n ' + (estado.ok ? 'muted' : 'warn')}>{estado.t}</span>}
    </label>
  )
}
