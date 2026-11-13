// INGRESO CON CELULAR (12 nov 2026, pedido del dueño: "un ingreso más fácil" para los vendedores).
// El vendedor no tiene correo en el sistema: entra con su número de celular. Por dentro el
// servicio de ingreso solo sabe de correos, así que el celular se convierte en un correo
// interno que NO existe en ningún buzón (nunca se le envía nada). Nadie lo ve ni lo escribe.
const DOMINIO = 'vendedores.urbisgroupinmobiliaria.com'

// "987 654 321", "+51 987654321", "51987654321" → "987654321". Si no es un celular peruano, ''.
export function soloCelular(texto) {
  let d = String(texto || '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('51')) d = d.slice(2)
  return /^9\d{8}$/.test(d) ? d : ''
}

export const correoDeCelular = cel => soloCelular(cel) ? `${soloCelular(cel)}@${DOMINIO}` : ''

// lo que la persona escribe en "correo o celular" → el correo con el que se entra
export function aCorreo(texto) {
  const t = String(texto || '').trim().toLowerCase()
  if (t.includes('@')) return t
  return correoDeCelular(t) || t
}

// para mostrar: el correo interno de un vendedor se enseña como su celular
export function mostrarUsuario(correo) {
  const c = String(correo || '')
  return c.endsWith('@' + DOMINIO) ? c.split('@')[0].replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : c
}

export const esCorreoDeCelular = correo => String(correo || '').endsWith('@' + DOMINIO)
