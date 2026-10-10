// Planilla (sql/131): los periodos de pago y las cuentas de un periodo.
// Semanal = de lunes a domingo · quincenal = del 1 al 15 y del 16 a fin de mes ·
// mensual = el mes calendario. La base solo guarda los cierres; el periodo abierto
// se calcula aquí, con la misma regla siempre.

export const PERIODICIDAD = { semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual' }
export const SUELDO_POR = { semanal: 'por semana', quincenal: 'por quincena', mensual: 'por mes' }
// días que vale el sueldo del periodo: una falta descuenta sueldo / días (se puede cambiar)
const DIAS = { semanal: 7, quincenal: 15, mensual: 30 }

// lo que suma o resta cada movimiento
export const TIPOS = {
  adelanto:  { label: 'Adelanto',  icon: '💸', signo: -1, voucher: true },
  descuento: { label: 'Descuento', icon: '➖', signo: -1 },
  tardanza:  { label: 'Tardanza',  icon: '⏰', signo: -1 },
  falta:     { label: 'Falta',     icon: '🚫', signo: -1 },
  bono:      { label: 'Bono',      icon: '🎁', signo: 1, voucher: true },
}
export const ORDEN_TIPOS = ['adelanto', 'descuento', 'tardanza', 'falta', 'bono']

const r2 = n => Math.round(Number(n || 0) * 100) / 100
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre']

// fechas como texto AAAA-MM-DD, siempre en UTC: así no las mueve la zona horaria
const aFecha = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const aTexto = d => d.toISOString().slice(0, 10)
const sumarDias = (s, n) => { const d = aFecha(s); d.setUTCDate(d.getUTCDate() + n); return aTexto(d) }
const finDeMes = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
const dm = s => s.slice(8, 10) + '/' + s.slice(5, 7)

// el periodo (de qué día a qué día) en el que cae una fecha
export function periodoDe(fecha, periodicidad) {
  const d = aFecha(fecha)
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), dia = d.getUTCDate()
  if (periodicidad === 'semanal') {
    const desde = sumarDias(fecha, -((d.getUTCDay() + 6) % 7))   // el lunes de esa semana
    return { desde, hasta: sumarDias(desde, 6) }
  }
  if (periodicidad === 'quincenal') {
    return dia <= 15
      ? { desde: aTexto(new Date(Date.UTC(y, m, 1))), hasta: aTexto(new Date(Date.UTC(y, m, 15))) }
      : { desde: aTexto(new Date(Date.UTC(y, m, 16))), hasta: aTexto(new Date(Date.UTC(y, m, finDeMes(y, m)))) }
  }
  return { desde: aTexto(new Date(Date.UTC(y, m, 1))), hasta: aTexto(new Date(Date.UTC(y, m, finDeMes(y, m)))) }
}
export const periodoAnterior = (p, periodicidad) => periodoDe(sumarDias(p.desde, -1), periodicidad)
export const periodoSiguiente = (p, periodicidad) => periodoDe(sumarDias(p.hasta, 1), periodicidad)

// "Semana del 06/10 al 12/10/2026" · "1ª quincena de octubre 2026" · "Octubre 2026"
export function nombrePeriodo(p, periodicidad) {
  const y = p.desde.slice(0, 4), mes = MESES[Number(p.desde.slice(5, 7)) - 1]
  if (periodicidad === 'semanal') return `Semana del ${dm(p.desde)} al ${dm(p.hasta)}/${p.hasta.slice(0, 4)}`
  if (periodicidad === 'quincenal') return `${p.desde.slice(8, 10) === '01' ? '1ª' : '2ª'} quincena de ${mes} ${y}`
  return mes.charAt(0).toUpperCase() + mes.slice(1) + ' ' + y
}

// lo que se descuenta por una tardanza si no se pone otro monto
export const tardanzaPorDefecto = (t, cfg) => r2(t?.descuento_tardanza ?? cfg?.descuento_tardanza ?? 0)
// lo que se descuenta por una falta si no se pone otro monto: un día de sueldo
export const faltaPorDefecto = t => r2(Number(t?.sueldo || 0) / (DIAS[t?.periodicidad] || 30))

// las cuentas de un periodo con sus movimientos (los anulados no cuentan)
export function cuentas(sueldo, movs) {
  const c = { sueldo: r2(sueldo), bonos: 0, adelantos: 0, descuentos: 0, tardanzas: 0, n_tardanzas: 0, faltas: 0, n_faltas: 0 }
  for (const m of movs || []) {
    if (m.anulado_at) continue
    const v = Number(m.monto || 0)
    if (m.tipo === 'bono') c.bonos += v
    else if (m.tipo === 'adelanto') c.adelantos += v
    else if (m.tipo === 'descuento') c.descuentos += v
    else if (m.tipo === 'tardanza') { c.tardanzas += v; c.n_tardanzas++ }
    else if (m.tipo === 'falta') { c.faltas += v; c.n_faltas++ }
  }
  for (const k of ['bonos', 'adelantos', 'descuentos', 'tardanzas', 'faltas']) c[k] = r2(c[k])
  c.neto = r2(c.sueldo + c.bonos - c.adelantos - c.descuentos - c.tardanzas - c.faltas)
  return c
}

// a qué proyecto(s) se carga: [{ project_id, porcentaje }] → monto por proyecto
export function repartoPorProyecto(monto, proyectos) {
  const lista = (proyectos || []).filter(p => p.project_id && Number(p.porcentaje) > 0)
  if (!lista.length) return [{ project_id: null, monto: r2(monto) }]
  const total = lista.reduce((s, p) => s + Number(p.porcentaje), 0)
  return lista.map(p => ({ project_id: p.project_id, monto: r2(monto * Number(p.porcentaje) / total) }))
}
