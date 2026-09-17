import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useProject } from '../context/ProjectContext'

// Se consulta de nuevo al descargar: no se exporta una ficha desactualizada.
export default function EstadoCuentaDownload({ cliente, saleId }) {
  const { projects } = useProject()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function descargar() {
    setBusy(true); setError('')
    try {
      const allowed = projects.map(p => p.id)
      if (!allowed.length) throw new Error('No tienes proyectos disponibles.')
      let query = supabase.from('sales').select('id, total_sale_price, initial_amount_paid, financed_amount, status, sale_date, lot:lots!inner(mz,lt,project_id,associated_to)')
        .in('lot.project_id', allowed).order('sale_date')
      query = saleId ? query.eq('id', saleId) : query.eq('client_id', cliente.id)
      const { data: ventas, error: e } = await query
      if (e) throw e
      if (!ventas?.length) throw new Error('No hay ventas disponibles para exportar.')
      // Paginar evita truncar cronogramas o historiales extensos por el límite del servidor.
      async function todos(table, select, id) {
        const result = []
        for (let from = 0; ; from += 500) {
          const { data, error } = await supabase.from(table).select(select).eq('sale_id', id).order('id').range(from, from + 499)
          if (error) throw error
          result.push(...data)
          if (data.length < 500) return result
        }
      }
      const pagos = []
      for (const venta of ventas) {
        const [cuotas, movimientos] = await Promise.all([
          todos('installments', 'id, installment_number, due_date, amount, amount_paid, status', venta.id),
          todos('daily_income', 'id, sale_id, date, amount, income_type, operation_number, installment:installments(installment_number)', venta.id),
        ])
        venta.installments = cuotas; pagos.push(...movimientos)
      }
      const { descargarEstadoCuenta } = await import('../lib/estadoCuentaPdf')
      descargarEstadoCuenta({ cliente, ventas, pagos, proyectos: projects })
    } catch (err) { setError('No se pudo generar el PDF: ' + err.message) }
    finally { setBusy(false) }
  }
  return <span className="no-print">
    <button className="btn-primary" disabled={busy} onClick={descargar}>{busy ? 'Generando PDF…' : 'Descargar estado de cuenta PDF'}</button>
    {error && <span role="alert" style={{ display: 'block', color: '#cf5454', fontSize: 13 }}>{error}</span>}
  </span>
}
