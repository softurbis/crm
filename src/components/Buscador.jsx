import { useEffect, useMemo, useRef, useState } from 'react'

// Selector con busqueda. Reemplaza al <select> nativo cuando la lista es larga
// (260 lotes, 141 clientes): ahi el nativo obliga a scrollear a ciegas.
// Se escribe y filtra al toque; se maneja con teclado (flechas, Enter, Esc).
//
// opciones: [{ id, label, sub? }]
export default function Buscador({ opciones, valor, onChange, placeholder = 'Buscar…', disabled, required, autoFocus }) {
  const [abierto, setAbierto] = useState(false)
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const caja = useRef(null)
  const lista = useRef(null)

  const sel = useMemo(() => opciones.find(o => o.id === valor) || null, [opciones, valor])

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return opciones
    // todas las palabras deben aparecer: "juan per" encuentra "JUAN PEREZ"
    const partes = t.split(/\s+/)
    return opciones.filter(o => {
      const txt = (o.label + ' ' + (o.sub || '')).toLowerCase()
      return partes.every(p => txt.includes(p))
    })
  }, [opciones, q])

  useEffect(() => { setI(0) }, [q, abierto])

  useEffect(() => {
    if (!abierto) return
    const fuera = e => { if (caja.current && !caja.current.contains(e.target)) { setAbierto(false); setQ('') } }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  // mantener la opcion resaltada a la vista al moverse con las flechas
  useEffect(() => {
    const el = lista.current?.children[i]
    el?.scrollIntoView({ block: 'nearest' })
  }, [i])

  const elegir = o => { onChange(o.id); setAbierto(false); setQ('') }

  const tecla = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(true); setI(x => Math.min(filtradas.length - 1, x + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(0, x - 1)) }
    else if (e.key === 'Enter') { if (abierto && filtradas[i]) { e.preventDefault(); elegir(filtradas[i]) } }
    else if (e.key === 'Escape') { setAbierto(false); setQ('') }
  }

  return (
    <div className={`bsc ${disabled ? 'off' : ''}`} ref={caja}>
      <input
        className="bsc-in"
        value={abierto ? q : (sel?.label || '')}
        placeholder={sel ? sel.label : placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={() => !disabled && setAbierto(true)}
        onChange={e => { setQ(e.target.value); setAbierto(true) }}
        onKeyDown={tecla}
      />
      {sel && !abierto && !disabled && (
        <button type="button" className="bsc-x" title="Quitar" onClick={() => onChange('')}>&#10005;</button>
      )}
      <span className="bsc-caret">&#9662;</span>
      {/* input oculto: mantiene la validacion required del formulario */}
      {required && <input tabIndex={-1} required value={valor || ''} onChange={() => {}}
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }} />}

      {abierto && !disabled && (
        <div className="bsc-menu glass">
          <div className="bsc-cnt muted">{filtradas.length} de {opciones.length}</div>
          <div className="bsc-lista" ref={lista}>
            {filtradas.map((o, k) => (
              <button type="button" key={o.id}
                className={`bsc-op ${k === i ? 'foco' : ''} ${o.id === valor ? 'on' : ''}`}
                onMouseEnter={() => setI(k)} onClick={() => elegir(o)}>
                <span className="bsc-lbl">{o.label}</span>
                {o.sub && <span className="bsc-sub muted">{o.sub}</span>}
              </button>
            ))}
            {!filtradas.length && <p className="muted bsc-nada">Nada coincide con “{q}”.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
