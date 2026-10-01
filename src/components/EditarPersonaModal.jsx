import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { subirRuta } from '../lib/archivos'
import FormPersona from './FormPersona'
import { guardarPersona, buscarPorDocumento, esPendiente, digitos, celularValido } from '../lib/cobros'

// Editar los datos de una persona SIN salir de donde se está. En la ficha del lote
// "editar datos" llevaba a la pantalla Clientes y no había camino de regreso
// (revisión del 1 oct 2026). Usa el mismo formulario del cobro: lee el DNI con IA,
// avisa qué falta para el contrato y guarda todo en mayúsculas.
export default function EditarPersonaModal({ persona: inicial, titulo, onCerrar, onGuardado }) {
  const [p, setP] = useState({ ...inicial })
  const [archivo, setArchivo] = useState(null)
  const [leyendo, setLeyendo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function guardar() {
    setErr('')
    if (!String(p.full_name || '').trim()) { setErr('Falta el nombre completo.'); return }
    setBusy(true)
    try {
      if (esPendiente(p)) {
        // Todavía sin documento (viene de una separación): se guarda lo demás y la
        // ficha sigue "pendiente de DNI" hasta que se escriba el número.
        const payload = {}
        for (const k of ['full_name', 'address', 'district', 'province', 'department', 'civil_status', 'nationality'])
          if (String(p[k] || '').trim()) payload[k] = String(p[k]).trim().toUpperCase()
        if (p.phone) Object.assign(payload, { phone: digitos(p.phone), phone_valid: celularValido(p.phone) })
        if (p.phone2) Object.assign(payload, { phone2: digitos(p.phone2), phone2_valid: celularValido(p.phone2) })
        if (archivo) {
          const ext = (archivo.name.split('.').pop() || 'jpg').toLowerCase()
          payload.dni_url = await subirRuta(`dni/${inicial.id}-completo-${Date.now()}.${ext}`, archivo)
        }
        const { error } = await supabase.from('clients').update(payload).eq('id', inicial.id)
        if (error) throw new Error(error.message)
      } else {
        // Si ese documento ya es de OTRA ficha, aquí no se mezclan: eso se resuelve a
        // propósito con "Cambiar titular". guardarPersona escribiría en la otra ficha.
        const tipo = p.doc_type && p.doc_type !== 'PEND' ? p.doc_type : 'DNI'
        const otra = await buscarPorDocumento(tipo, p.doc_number)
        if (otra && otra.id !== inicial.id) {
          throw new Error('Ese documento ya está registrado a nombre de ' + otra.full_name + ' (otra ficha). No se guardó nada: si es la misma persona, usa "Cambiar titular" para pasar la venta a esa ficha.')
        }
        await guardarPersona({ ...p, id: inicial.id }, archivo)
      }
      onGuardado?.()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div className="modal-bg" onClick={busy ? undefined : onCerrar}>
      <div className="glass modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720, width: '96%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-head">
          <b style={{ flex: 1 }}>&#9998; {titulo || 'Editar datos'} — {inicial.full_name}</b>
          <button className="btn-ghost" onClick={onCerrar} disabled={busy} aria-label="Cerrar">&#10005;</button>
        </div>
        <FormPersona persona={p} setPersona={setP} archivo={archivo} setArchivo={setArchivo} onLeyendo={setLeyendo} />
        {err && <p className="error" style={{ marginTop: 10, textTransform: 'none' }}>{err}</p>}
        <div className="acc-row" style={{ marginTop: 12 }}>
          <button className="btn-primary" onClick={guardar} disabled={busy || leyendo}>
            {busy ? 'Guardando…' : leyendo ? 'Leyendo el DNI…' : 'Guardar datos'}
          </button>
          <button type="button" className="btn-ghost" onClick={onCerrar} disabled={busy}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
