// TODAS LAS FILAS, de a 1000 (26 nov 2026, fase 3)
// ------------------------------------------------------------
// El servidor (PostgREST) entrega como máximo 1000 filas por consulta y NO avisa: la
// lista queda cortada en silencio. Esto pide de a 1000 hasta que no quede nada.
//   · `armar` arma la consulta de nuevo en cada vuelta (con su .order(...): sin un orden
//     fijo y completo, las páginas se pisan y se saltan filas)
//   · devuelve lo mismo que supabase: { data, error }
export async function todasLasFilas(armar, paso = 1000) {
  const data = []
  for (let desde = 0; desde < 200000; desde += paso) {
    const { data: filas, error } = await armar().range(desde, desde + paso - 1)
    if (error) return { data: data.length ? data : null, error }
    data.push(...(filas || []))
    if (!filas || filas.length < paso) break
  }
  return { data, error: null }
}
