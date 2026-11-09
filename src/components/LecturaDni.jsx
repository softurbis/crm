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
      setEstado({ fase: 'listo', lectura: L, puestos: r.puestos || [], cambios: r.cambios || [], avisos: avisosDni(L) })
    } catch (e) {
      if (sigue()) setEstado({ fase: 'error', error: e.message })
    }
  }
  const limpiar = () => { turno.current++; setEstado(null) }
  return { estado, leer, limpiar, leyendo: estado?.fase === 'subiendo' || estado?.fase === 'leyendo' }
}

const esPdf = f => f?.type === 'application/pdf' || /\.pdf$/i.test(f?.name || '')

// El DNI se sube en UN solo paso, en cualquier forma: una foto con las dos caras,
// un PDF, o las dos fotos (frente y reverso) elegidas juntas. Apenas se eligen,
// la IA las lee juntas y llena el formulario (aplicar). Si llegó una sola foto,
// se puede agregar la otra cara y se vuelve a leer todo. archivos: null o una
// lista de 1 o 2 File; si la IA ve que el primero es el reverso, los da vuelta
// para que se guarden con su nombre.
export function SubirDni({ archivos, setArchivos, dniIA, aplicar, obligatorio }) {
  const [aviso, setAviso] = useState('')
  const lista = [].concat(archivos || []).filter(Boolean)

  function leer(l, nota = '') {
    setAviso(nota)
    setArchivos(l.length ? l : null)
    if (!l.length) { dniIA.limpiar(); return }
    dniIA.leer(l, L => {
      if (l.length === 2 && L?.primer_archivo === 'reverso') setArchivos([l[1], l[0]])
      return aplicar(L)
    })
  }
  function elegir(e) {
    const fs = [...(e.target.files || [])]
    e.target.value = ''            // así se puede volver a elegir el mismo archivo
    if (!fs.length) return
    leer(fs.slice(0, 2), fs.length > 2 ? 'Elegiste ' + fs.length + ' archivos: se usan solo los 2 primeros (frente y reverso).' : '')
  }
  function agregar(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) leer([lista[0], f])
  }

  const L = dniIA.estado?.lectura
  const faltaCara = lista.length === 1 && !esPdf(lista[0]) && dniIA.estado?.fase === 'listo' && L?.es_documento && L.se_ve_frente !== L.se_ve_reverso
  const boton = { display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', margin: 0 }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="btn-act" style={{ ...boton, opacity: dniIA.leyendo ? .6 : 1 }}>
          &#129706; {lista.length ? 'Cambiar el DNI' : 'Subir el DNI'}
          <input type="file" accept="image/*,.pdf" multiple hidden disabled={dniIA.leyendo} onChange={elegir} />
        </label>
        {lista.length === 1 && !esPdf(lista[0]) && (
          <label className={faltaCara ? 'btn-act' : 'link-btn'} style={{ ...boton, opacity: dniIA.leyendo ? .6 : 1 }}>
            &#10133; {faltaCara ? (L.se_ve_frente ? 'Agregar el REVERSO' : 'Agregar el FRENTE') : 'agregar la otra cara (si son 2 fotos)'}
            <input type="file" accept="image/*" hidden disabled={dniIA.leyendo} onChange={agregar} />
          </label>
        )}
        {obligatorio && !lista.length && <b className="bad small">(obligatorio)</b>}
      </div>
      <span className="muted small" style={{ display: 'block', marginTop: 4, textTransform: 'none' }}>
        {lista.length
          ? lista.map((f, i) => (lista.length === 2 ? (i ? 'Reverso: ' : 'Frente: ') : '') + (f.name || 'DNI')).join(' · ')
          : 'Elige las 2 fotos juntas (frente y reverso), una foto con las dos caras o el PDF: la IA lee ambas caras sola y llena los datos.'}
      </span>
      {aviso && <span className="warn small" style={{ display: 'block' }}>&#9888; {aviso}</span>}
    </div>
  )
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
