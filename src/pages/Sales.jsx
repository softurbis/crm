import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProject, ProjectPicker } from '../context/ProjectContext'

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const EST = {
  en_proceso: { lbl: 'EN PROCESO', color: '#7ba7f7' },
  pagado: { lbl: 'PAGADO 100%', color: '#4bb96a' },
  expropiado: { lbl: 'EXPROPIADO', color: '#b58ad9' },
  anulado: { lbl: 'ANULADO', color: '#c94f4f' },
}

export default function Sales() {
  const { pidOp } = useProject()
  const [searchParams] = useSearchParams()
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [est, setEst] = useState('todos')

  useEffect(() => {
    const e = searchParams.get('estado')
    if (e) setEst(e)
  }, [searchParams])

  async function load() {
    if (!pidOp) return
    const { data } = await supabase.from('sales')
      .select('id, total_sale_price, initial_amount_paid, financed_amount, installments_count, monthly_amount, sale_date, status, client:clients!sales_client_id_fkey(full_name, doc_number), lot:lots!inner(mz, lt, project_id, associated_to), installments(amount, amount_paid, status)')
      .eq('lot.project_id', pidOp)
      .order('sale_date', { ascending: false })
    setRows(data || [])
  }
  useEffect(() => { load() }, [pidOp])

  const calc = r => {
    const cuotasPag = (r.installments || []).filter(i => i.status === 'pagado').length
    const pagadoCuotas = (r.installments || []).reduce((s, i) => s + Number(i.amount_paid), 0)
    const cobrado = pagadoCuotas + Number(r.initial_amount_paid)
    const saldo = Number(r.total_sale_price) - cobrado
    return { cuotasPag, cobrado, saldo }
  }

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter(r => {
      if (est !== 'todos' && r.status !== est) return false
      if (!t) return true
      return (r.client?.full_name || '').toLowerCase().includes(t) ||
        `${r.lot?.mz}-${r.lot?.lt}`.toLowerCase().includes(t) ||
        (r.client?.doc_number || '').toLowerCase().includes(t)
    })
  }, [rows, q, est])

  const tot = filtradas.reduce((s, r) => { const c = calc(r); return { precio: s.precio + Number(r.total_sale_price), cobrado: s.cobrado + c.cobrado, saldo: s.saldo + c.saldo } }, { precio: 0, cobrado: 0, saldo: 0 })

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Ventas</h1>
        <ProjectPicker />
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Buscar por cliente, DNI o lote..." value={q} onChange={e => setQ(e.target.value)} />
        <select value={est} onChange={e => setEst(e.target.value)}>
          <option value="todos">TODOS LOS ESTADOS</option>
          <option value="en_proceso">EN PROCESO</option>
          <option value="pagado">PAGADOS (100%)</option>
          <option value="expropiado">EXPROPIADOS</option>
          <option value="anulado">ANULADOS</option>
        </select>
      </div>

      <p className="hint">
        {filtradas.length} ventas | PRECIO: <b>{soles(tot.precio)}</b> | COBRADO: <b style={{ color: '#4bb96a' }}>{soles(tot.cobrado)}</b> | SALDO: <b>{soles(tot.saldo)}</b>
      </p>

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Lote</th><th>Cliente</th><th>Fecha</th><th>Precio</th><th>Cobrado</th><th>Saldo</th><th>Cuotas</th><th>Estado</th></tr></thead>
          <tbody>
            {filtradas.slice(0, 400).map(r => {
              const c = calc(r)
              const e = EST[r.status] || { lbl: (r.status || '').toUpperCase(), color: '#9daab6' }
              const conjunta = (r.lot?.associated_to || '').startsWith('VENTA CONJUNTA')
              return (
                <tr key={r.id} style={r.status === 'pagado' ? { background: 'rgba(75,185,106,.08)' } : undefined}>
                  <td><b>{conjunta ? r.lot.associated_to.split(' (')[0].replace('VENTA CONJUNTA ', '') : `${r.lot?.mz}-${r.lot?.lt}`}</b></td>
                  <td>{r.client?.full_name || '-'}</td>
                  <td>{r.sale_date}</td>
                  <td>{soles(r.total_sale_price)}</td>
                  <td style={{ color: '#4bb96a' }}>{soles(c.cobrado)}</td>
                  <td>{soles(c.saldo)}</td>
                  <td>{c.cuotasPag} / {r.installments_count}</td>
                  <td><span style={{ color: e.color, fontWeight: 700 }}>{e.lbl}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtradas.length > 400 && <p className="muted small">Mostrando 400 de {filtradas.length} — usa el buscador o el filtro.</p>}
      </div>
    </>
  )
}
