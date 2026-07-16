import { useEffect, useMemo, useState } from 'react'

/**
 * Paginacion en el navegador (NO recarga la pagina ni vuelve a consultar la base).
 * Los datos ya estan cargados: esto solo decide que trozo se dibuja.
 *
 * Uso:
 *   const pag = usePaginacion(filtradas, 50)
 *   ...
 *   {pag.pagina.map(fila => ...)}
 *   <Paginador {...pag} />
 */
export function usePaginacion(items, porPagina = 50) {
  const [n, setN] = useState(1)
  const total = items.length
  const paginas = Math.max(1, Math.ceil(total / porPagina))

  // si cambian los filtros y la pagina actual ya no existe, volver a la 1
  useEffect(() => { if (n > paginas) setN(1) }, [paginas, n])

  const pagina = useMemo(
    () => items.slice((n - 1) * porPagina, n * porPagina),
    [items, n, porPagina])

  const ir = destino => {
    setN(Math.min(paginas, Math.max(1, destino)))
    // al cambiar de pagina, la tabla vuelve al inicio (si no, quedas a media lista)
    document.querySelector('.table-wrap')?.scrollTo({ top: 0, behavior: 'smooth' })
  }
  return { pagina, n, paginas, total, porPagina, ir }
}

export default function Paginador({ n, paginas, total, porPagina, ir }) {
  if (!total) return null
  const desde = (n - 1) * porPagina + 1
  const hasta = Math.min(n * porPagina, total)

  // ventana de numeros alrededor de la pagina actual (para no dibujar 40 botones)
  const nums = []
  const ini = Math.max(1, Math.min(n - 2, paginas - 4))
  const fin = Math.min(paginas, ini + 4)
  for (let i = ini; i <= fin; i++) nums.push(i)

  return (
    <div className="paginador">
      <span className="muted small">
        Mostrando <b>{desde}–{hasta}</b> de <b>{total}</b>
      </span>
      {paginas > 1 && (
        <div className="pag-btns">
          <button className="btn-ghost" disabled={n === 1} onClick={() => ir(1)} title="Primera">&#171;</button>
          <button className="btn-ghost" disabled={n === 1} onClick={() => ir(n - 1)} title="Anterior">&#8249; Anterior</button>
          {ini > 1 && <span className="muted small">…</span>}
          {nums.map(i => (
            <button key={i} className={`btn-ghost pag-num ${i === n ? 'on' : ''}`} onClick={() => ir(i)}>{i}</button>
          ))}
          {fin < paginas && <span className="muted small">…</span>}
          <button className="btn-ghost" disabled={n === paginas} onClick={() => ir(n + 1)} title="Siguiente">Siguiente &#8250;</button>
          <button className="btn-ghost" disabled={n === paginas} onClick={() => ir(paginas)} title="Ultima">&#187;</button>
        </div>
      )}
    </div>
  )
}
