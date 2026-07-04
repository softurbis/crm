export function letras(num) {
  const U = ['','UNO','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE','DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISEIS','DIECISIETE','DIECIOCHO','DIECINUEVE','VEINTE']
  const D = ['','','VEINTI','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA']
  const C = ['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS']
  function tres(n) {
    if (n === 0) return ''
    if (n === 100) return 'CIEN'
    let s = C[Math.floor(n / 100)]
    const r = n % 100
    if (r === 0) return s
    if (s) s += ' '
    if (r <= 20) return s + U[r]
    const d = Math.floor(r / 10), u = r % 10
    if (d === 2) return s + 'VEINTI' + (u ? U[u] : '')
    return s + D[d] + (u ? ' Y ' + U[u] : '')
  }
  const entero = Math.floor(num)
  const cent = Math.round((num - entero) * 100)
  let out = ''
  const millones = Math.floor(entero / 1000000)
  const miles = Math.floor((entero % 1000000) / 1000)
  const resto = entero % 1000
  if (millones) out += (millones === 1 ? 'UN MILLON' : tres(millones) + ' MILLONES') + ' '
  if (miles) out += (miles === 1 ? 'MIL' : tres(miles) + ' MIL') + ' '
  out += tres(resto)
  if (!out.trim()) out = 'CERO'
  return out.trim() + ' CON ' + String(cent).padStart(2, '0') + '/100'
}

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
export function fechaLetras(iso) {
  if (!iso) return '____________'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${String(d).padStart(2, '0')} de ${MESES[m - 1]} del ${y}`
}
