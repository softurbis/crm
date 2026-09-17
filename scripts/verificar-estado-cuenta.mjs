import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { crearEstadoCuentaPdf, resumenCuenta } from '../src/lib/estadoCuentaPdf.js'

const venta = { id: 'demo', status: 'en_proceso', sale_date: '2026-01-10', total_sale_price: 30000,
  initial_amount_paid: 5000, financed_amount: 24000, lot: { mz: 'A', lt: '12', project_id: 'demo' },
  installments: Array.from({ length: 48 }, (_, i) => ({ installment_number: i + 1,
    due_date: `${2026 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-15`,
    amount: 500, amount_paid: i < 5 ? 500 : i === 5 ? 200 : 0, status: 'pendiente' })) }
const pagos = [
  { sale_id: 'demo', date: '2026-01-01', amount: 1000, income_type: 'separacion', operation_number: 'DEMO-001' },
  { sale_id: 'demo', date: '2026-01-10', amount: 5000, income_type: 'inicial', operation_number: 'DEMO-002' },
  ...Array.from({ length: 6 }, (_, i) => ({ sale_id: 'demo', date: `2026-${String(i + 1).padStart(2, '0')}-15`, amount: i < 5 ? 500 : 200, income_type: 'cuota', operation_number: `DEMO-${i + 3}`, installment: { installment_number: i + 1 } })),
]
const r = resumenCuenta(venta, pagos, '2026-09-17')
assert.equal(r.pagado, 870000)
assert.equal(r.saldo, 2130000)
assert.equal(r.vencido, 180000)
assert.equal(r.vencidas.length, 4)
assert.equal(r.proxima.installment_number, 10)
assert.equal(venta.installments[0].status, 'pendiente')
assert.equal(resumenCuenta(venta, pagos, '2026-06-15').rows[5].estado, 'Parcial')
assert.equal(resumenCuenta({ ...venta, financed_amount: null }, [], '2026-09-17').separacion, 0)
assert.equal(resumenCuenta({ ...venta, total_sale_price: 8000 }, pagos, '2026-09-17').saldo, -70000)
const doc = crearEstadoCuentaPdf({ cliente: { full_name: 'CLIENTE DE EJEMPLO - DATOS FICTICIOS', doc_type: 'DNI', doc_number: '00000000' },
  ventas: [venta], pagos, proyectos: [{ id: 'demo', name: 'Proyecto de demostración' }], corte: '2026-09-17' })
assert.ok(doc.getNumberOfPages() >= 2)
mkdirSync('output/pdf', { recursive: true })
doc.save('output/pdf/estado-cuenta-ejemplo.pdf')
console.log(`Cálculos verificados; ejemplo generado (${doc.getNumberOfPages()} páginas).`)
