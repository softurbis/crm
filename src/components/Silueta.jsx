import '../styles/silueta.css'

// SILUETAS DE CARGA (26 nov 2026, fase 3): mientras llegan los datos se ve la FORMA de lo
// que viene (el título, los filtros, las filas de la tabla) con un brillo que pasa, en vez
// de un "Cargando…" o de una tabla vacía que dice "0 gastos". La espera se siente más
// corta y nadie cree que se borró todo.

// una tabla: n filas de m columnas, de anchos variados para que parezca texto real
export function SiluetaTabla({ filas = 8, columnas = 6 }) {
  const anchos = [38, 72, 55, 64, 46, 80, 58, 50, 68, 42]
  return (
    <div className="glass table-wrap sil-tabla" aria-busy="true" aria-label="Cargando">
      <div className="sil-fila sil-cab">
        {Array.from({ length: columnas }, (_, c) => <span key={c} className="sil" style={{ width: (anchos[(c * 3) % anchos.length] - 12) + '%' }} />)}
      </div>
      {Array.from({ length: filas }, (_, f) => (
        <div key={f} className="sil-fila">
          {Array.from({ length: columnas }, (_, c) => <span key={c} className="sil" style={{ width: anchos[(f + c * 2) % anchos.length] + '%' }} />)}
        </div>
      ))}
    </div>
  )
}

// una pantalla entera (mientras se baja una pantalla nueva del panel): título, filtros y tabla
export function SiluetaPagina() {
  return (
    <div className="sil-pagina" aria-busy="true" aria-label="Cargando la pantalla">
      <span className="sil sil-titulo" />
      <div className="sil-chips">
        {[90, 120, 80, 110].map((w, i) => <span key={i} className="sil sil-chip" style={{ width: w }} />)}
      </div>
      <SiluetaTabla filas={7} columnas={6} />
    </div>
  )
}
