import { useEffect, useRef, useState } from 'react'
import { onDialogo, cerrarDialogo } from '../lib/dialogos'

// Anfitrión de los diálogos del panel (lib/dialogos.js): avisos, confirmaciones y
// pedidos de datos que antes eran alert / confirm / prompt del navegador.
// Montado UNA sola vez en main.jsx, por fuera de las rutas: cubre el panel, el
// login y las páginas públicas, y queda por encima de cualquier otro modal.
export default function Dialogos() {
  const [d, setD] = useState(null)
  useEffect(() => onDialogo(setD), [])
  // la key reinicia los campos cuando entra el siguiente de la cola
  return d ? <Dialogo key={d.id} d={d} /> : null
}

// valor con el que arranca un campo
function inicial(c) {
  const v = c.valor == null ? '' : String(c.valor)
  // el calendario solo entiende AAAA-MM-DD: de una fecha con hora se queda con el día
  if (c.tipo === 'fecha') return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : ''
  // una lista sin valor inicial muestra su primera opción: esa es la que vale
  if (c.tipo === 'opcion' && !v) return String(c.opciones?.[0]?.valor ?? '')
  return v
}

function Dialogo({ d }) {
  const [vals, setVals] = useState(() => Object.fromEntries(d.campos.map(c => [c.clave, inicial(c)])))
  const [err, setErr] = useState('')
  const caja = useRef(null)
  const soloAviso = d.clase === 'aviso'
  // Recién abierto no cuentan los clics ni el Enter: el segundo clic de un DOBLE CLIC
  // cae sobre el diálogo y lo cerraría solo — o, peor, lo aceptaría sin haberlo leído.
  const nacio = useRef(Date.now())
  const muyPronto = () => Date.now() - nacio.current < 400

  const cancelar = () => { if (!muyPronto()) cerrarDialogo(d.id, null) }
  function aceptar(e) {
    e?.preventDefault()
    if (muyPronto()) return
    const falta = d.campos.find(c => c.obligatorio && !String(vals[c.clave] || '').trim())
    if (falta) {
      setErr(falta.tipo === 'fecha' ? 'Elige la fecha' + (falta.etiqueta ? ': ' + falta.etiqueta : '') + '.' : 'Falta completar' + (falta.etiqueta ? ': ' + falta.etiqueta : ' este dato') + '.')
      caja.current?.querySelector('[data-campo="' + falta.clave + '"]')?.focus()
      return
    }
    cerrarDialogo(d.id, vals)
  }

  // El foco entra al primer campo (o al botón de aceptar si no hay campos) y al
  // cerrar vuelve a donde estaba. Escape cancela aunque el foco se haya ido a otro lado.
  useEffect(() => {
    const antes = document.activeElement
    const primero = caja.current?.querySelector('[data-campo]') || caja.current?.querySelector('button[type="submit"]')
    primero?.focus()
    // como en el prompt de antes: el valor inicial queda seleccionado y escribir lo reemplaza
    if (primero?.tagName === 'TEXTAREA' || (primero?.tagName === 'INPUT' && primero.type === 'text')) primero.select()
    const tecla = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarDialogo(d.id, null); return }
      if (e.key !== 'Tab' || !caja.current) return
      // el tabulador da la vuelta dentro del diálogo: no se escapa al modal de atrás
      const foco = [...caja.current.querySelectorAll('input, select, textarea, button')]
      if (!foco.length) return
      const i = foco.indexOf(document.activeElement)
      const sig = e.shiftKey ? (i <= 0 ? foco.length - 1 : i - 1) : (i === foco.length - 1 || i < 0 ? 0 : i + 1)
      e.preventDefault(); foco[sig].focus()
    }
    window.addEventListener('keydown', tecla, true)
    return () => {
      window.removeEventListener('keydown', tecla, true)
      if (antes && document.contains(antes)) antes.focus?.()
    }
  }, [d.id])

  const campo = c => {
    const comun = {
      'data-campo': c.clave, value: vals[c.clave], 'aria-label': c.etiqueta ? undefined : d.mensaje,
      onChange: e => { setErr(''); setVals(v => ({ ...v, [c.clave]: e.target.value })) },
      placeholder: c.placeholder || undefined,
    }
    if (c.tipo === 'largo') return <textarea rows={3} {...comun} />
    if (c.tipo === 'fecha') return <input type="date" {...comun} />
    if (c.tipo === 'opcion') return (
      <select {...comun}>
        {(c.opciones || []).map(op => <option key={op.valor} value={op.valor}>{op.etiqueta}</option>)}
      </select>
    )
    if (c.tipo === 'monto' || c.tipo === 'numero') return <input type="text" inputMode="decimal" autoComplete="off" {...comun} />
    return <input type="text" autoComplete="off" {...comun} />
  }

  return (
    // clic afuera cancela (en un aviso, lo cierra). Con mousedown y no con click:
    // seleccionar el texto de un campo y soltar el mouse afuera no debe cerrar nada.
    <div className="modal-bg dlg-bg" onMouseDown={e => { if (e.target === e.currentTarget) cancelar() }}>
      {/* es un <form>: Enter acepta desde cualquier campo, salvo en el textarea */}
      <form ref={caja} className={'glass modal dlg' + (d.tono ? ' dlg-' + d.tono : '')} onSubmit={aceptar} noValidate
        role={soloAviso ? 'alertdialog' : 'dialog'} aria-modal="true" aria-label={d.titulo || d.mensaje.slice(0, 80)}>
        {d.titulo && (
          <div className="modal-head">
            <b className="dlg-titulo">{d.titulo}</b>
          </div>
        )}
        {d.mensaje && <p className="dlg-msg">{d.mensaje}</p>}
        {d.campos.map(c => (
          <label key={c.clave} className="dlg-campo">
            {c.etiqueta && <span>{c.etiqueta}{c.obligatorio ? ' *' : ''}</span>}
            {campo(c)}
            {c.ayuda && <small className="muted">{c.ayuda}</small>}
          </label>
        ))}
        {err && <p className="error">{err}</p>}
        <div className="acc-row dlg-botones">
          <button type="submit" className={'btn-primary' + (d.peligro ? ' dlg-peligro' : '')}>{d.aceptar}</button>
          {!soloAviso && <button type="button" className="btn-ghost" onClick={cancelar}>{d.cancelar}</button>}
        </div>
      </form>
    </div>
  )
}
