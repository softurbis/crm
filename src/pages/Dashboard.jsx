import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const MESES_L = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']
const mesLbl = ym => { const [y, m] = ym.split('-'); return MESES_L[Number(m) - 1] + ' ' + y }
const estadoDe = o => { const x = (o || '').toUpperCase(); return x.includes('EXPROP') ? 'EXPROPIADO' : x.includes('PERDIDA') ? 'PERDIDA' : 'ACEPTADO' }

export default function Dashboard() {
  const { role } = useAuth()
  const { projects, pid } = useProject()
  const [raw, setRaw] = useState(null)
  const [fmes, setFmes] = useState('todos')
  const conGeneral = role !== 'secretary'

  useEffect(() => {
    async function load() {
      const ids = pid === 'general' ? projects.map(p => p.id) : [pid]
      if (!ids.length) return
      const [lots, income, expenses, salesR, venc, seps] = await Promise.all([
        supabase.from('lots').select('project_id, status, total_price').in('project_id', ids),
        supabase.from('daily_income').select('project_id, amount, income_type, date, observation').in('project_id', ids),
        supabase.from('expenses').select('project_id, amount, issue_date, reception_date, status').in('project_id', ids),
        supabase.from('sales').select('id, sale_date, total_sale_price, status, lot:lots!inner(project_id)'),
        supabase.from('installments').select('amount, amount_paid, sales!inner(status, lot:lots!inner(project_id))').eq('status', 'vencido'),
        supabase.from('separations').select('amount, date, status, lot:lots!inner(project_id)'),
      ])
      setRaw({
        ids,
        lots: lots.data || [],
        income: income.data || [],
        expenses: expenses.data || [],
        sales: (salesR.data || []).filter(s => ids.includes(s.lot?.project_id)),
        venc: (venc.data || []).filter(v => v.sales?.status === 'en_proceso' && ids.includes(v.sales?.lot?.project_id)),
        seps: (seps.data || []).filter(x => ids.includes(x.lot?.project_id)),
      })
    }
    load()
  }, [pid, projects])

  const D = useMemo(() => {
    if (!raw) return null
    const { lots, income, expenses, sales, venc, seps } = raw
    const acept = income.filter(i => estadoDe(i.observation) === 'ACEPTADO')
    const perd = income.filter(i => estadoDe(i.observation) === 'PERDIDA')
    const expr = income.filter(i => estadoDe(i.observation) === 'EXPROPIADO')
    const nLotes = lots.length
    const nv = lots.filter(l => l.status === 'vendido').length
    const nd = lots.filter(l => l.status === 'disponible').length
    const ns = lots.filter(l => l.status === 'separado').length
    const ventasActivas = sales.filter(s => s.status === 'en_proceso')
    const ventasExpr = sales.filter(s => s.status === 'expropiado')
    const valorVentasActivas = ventasActivas.reduce((s, v) => s + Number(v.total_sale_price), 0)
    const recaudadoActivo = acept.reduce((s, i) => s + Number(i.amount), 0)
    const carteraDisp = lots.filter(l => l.status === 'disponible').reduce((s, l) => s + Number(l.total_price || 0), 0)
    const deudaVencida = venc.reduce((s, v) => s + Number(v.amount) - Number(v.amount_paid), 0)
    const gastosReales = expenses.filter(g => g.status !== 'solicitado')
    const gastosT = gastosReales.reduce((s, g) => s + Number(g.amount), 0)

    // series mensuales
    const meses = {}
    const M = ym => (meses[ym] = meses[ym] || { rec: 0, pagos: 0, ventasN: 0, ventasS: 0, gastos: 0, seps: 0 })
    for (const i of acept) { const ym = (i.date || '').slice(0, 7); if (ym) { M(ym).rec += Number(i.amount); M(ym).pagos++ } }
    for (const v of sales) { const ym = (v.sale_date || '').slice(0, 7); if (ym) { M(ym).ventasN++; M(ym).ventasS += Number(v.total_sale_price) } }
    for (const g of gastosReales) { const ym = (g.issue_date || g.reception_date || '').slice(0, 7); if (ym) M(ym).gastos += Number(g.amount) }
    for (const x of seps) { const ym = (x.date || '').slice(0, 7); if (ym) M(ym).seps++ }
    const mesesOrden = Object.keys(meses).sort().reverse()

    return {
      recaudado: recaudadoActivo, gastosT,
      perdidasS: perd.reduce((s, i) => s + Number(i.amount), 0), perdidasN: perd.length,
      exprS: expr.reduce((s, i) => s + Number(i.amount), 0), exprN: ventasExpr.length,
      nLotes, nv, nd, ns,
      pctVendido: nLotes ? (nv / nLotes * 100) : 0,
      ventasActivasN: ventasActivas.length, valorVentasActivas,
      pctCobrado: valorVentasActivas ? Math.min(100, recaudadoActivo / valorVentasActivas * 100) : 0,
      carteraDisp, vencN: venc.length, deudaVencida,
      meses, mesesOrden,
    }
  }, [raw])

  if (!D) return <p className="muted">Cargando indicadores...</p>

  const cards = [
    { label: 'RECAUDADO (ACEPTADO)', value: soles(D.recaudado), sub: `${D.pctCobrado.toFixed(1)}% del valor de ventas activas (${soles(D.valorVentasActivas)})` },
    { label: 'GASTOS', value: soles(D.gastosT), sub: `BALANCE: ${soles(D.recaudado - D.gastosT)}` },
    { label: 'LOTES VENDIDOS', value: `${D.nv} (${D.pctVendido.toFixed(1)}%)`, sub: `de ${D.nLotes} lotes | ${D.ns} separados` },
    { label: 'POR VENDER', value: D.nd, sub: `cartera disponible: ${soles(D.carteraDisp)}` },
    { label: 'CUOTAS VENCIDAS', value: D.vencN, sub: `deuda vencida: ${soles(D.deudaVencida)}`, bad: D.vencN > 0 },
    { label: 'VENTAS ACTIVAS', value: D.ventasActivasN, sub: 'en proceso de pago' },
    { label: 'EXPROPIADOS', value: D.exprN, sub: `pagos asociados: ${soles(D.exprS)}`, purple: true },
    { label: 'PERDIDAS', value: D.perdidasN, sub: `separaciones perdidas: ${soles(D.perdidasS)}`, bad: D.perdidasN > 0 },
  ]

  const m = fmes !== 'todos' ? D.meses[fmes] : null

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Dashboard {pid === 'general' ? '- GENERAL' : ''}</h1>
        <select value={fmes} onChange={e => setFmes(e.target.value)}>
          <option value="todos">RESUMEN: TODO EL TIEMPO</option>
          {D.mesesOrden.map(ym => <option key={ym} value={ym}>{mesLbl(ym)}</option>)}
        </select>
        <ProjectPicker withGeneral={conGeneral}
          generalLabel={role === 'admin' ? 'GENERAL (todos los proyectos)' : 'TOTAL (mis proyectos)'} />
      </div>

      <div className="cards cards-big">
        {cards.map(c => (
          <div className="glass card" key={c.label}>
            <p className="muted">{c.label}</p>
            <p className="kpi kpi-big" style={c.bad ? { color: 'var(--error)' } : c.purple ? { color: '#b58ad9' } : {}}>{c.value}</p>
            {c.sub && <p className="muted small">{c.sub}</p>}
          </div>
        ))}
      </div>

      {m && (
        <div className="glass form-card mes-box">
          <h2 className="sub" style={{ margin: 0 }}>RESUMEN DE {mesLbl(fmes)}</h2>
          <div className="cards">
            <div className="glass card"><p className="muted">RECAUDADO EN EL MES</p><p className="kpi">{soles(m.rec)}</p><p className="muted small">{m.pagos} pagos registrados</p></div>
            <div className="glass card"><p className="muted">VENTAS NUEVAS</p><p className="kpi">{m.ventasN}</p><p className="muted small">por {soles(m.ventasS)}</p></div>
            <div className="glass card"><p className="muted">SEPARACIONES</p><p className="kpi">{m.seps}</p></div>
            <div className="glass card"><p className="muted">GASTOS DEL MES</p><p className="kpi">{soles(m.gastos)}</p></div>
            <div className="glass card"><p className="muted">BALANCE DEL MES</p><p className="kpi">{soles(m.rec - m.gastos)}</p></div>
          </div>
        </div>
      )}

      <h2 className="sub">Resumen mensual</h2>
      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Mes</th><th>Recaudado</th><th>Pagos</th><th>Ventas nuevas</th><th>Valor vendido</th><th>Separaciones</th><th>Gastos</th><th>Balance</th></tr></thead>
          <tbody>
            {D.mesesOrden.map(ym => {
              const x = D.meses[ym]
              return (
                <tr key={ym} className={ym === fmes ? 'row-sel' : ''} onClick={() => setFmes(ym === fmes ? 'todos' : ym)} style={{ cursor: 'pointer' }}>
                  <td><b>{mesLbl(ym)}</b></td>
                  <td>{soles(x.rec)}</td>
                  <td>{x.pagos}</td>
                  <td>{x.ventasN}</td>
                  <td>{soles(x.ventasS)}</td>
                  <td>{x.seps}</td>
                  <td>{soles(x.gastos)}</td>
                  <td className={x.rec - x.gastos >= 0 ? 'ok' : 'bad'}>{soles(x.rec - x.gastos)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="muted small">Clic en un mes para ver su resumen arriba.</p>
      </div>
    </>
  )
}
