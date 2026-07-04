import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })

export default function Dashboard() {
  const { role } = useAuth()
  const { projects, pid } = useProject()
  const [data, setData] = useState(null)
  const conGeneral = role !== 'secretary'

  useEffect(() => {
    async function load() {
      const ids = pid === 'general' ? projects.map(p => p.id) : [pid]
      if (!ids.length) return
      const [lots, income, expenses, salesR, venc] = await Promise.all([
        supabase.from('lots').select('project_id, status').in('project_id', ids),
        supabase.from('daily_income').select('project_id, amount, income_type, date').in('project_id', ids),
        supabase.from('expenses').select('project_id, amount').in('project_id', ids),
        supabase.from('sales').select('status, lot:lots!inner(project_id)').eq('status', 'en_proceso'),
        supabase.from('installments').select('amount, amount_paid, sales!inner(status, lot:lots!inner(project_id))').eq('status', 'vencido'),
      ])
      const st = {}
      for (const p of projects) if (ids.includes(p.id)) st[p.id] = { name: p.name, lotes: {}, ingresos: 0, gastos: 0 }
      for (const x of lots.data || []) if (st[x.project_id]) st[x.project_id].lotes[x.status] = (st[x.project_id].lotes[x.status] || 0) + 1
      for (const x of income.data || []) if (st[x.project_id]) st[x.project_id].ingresos += Number(x.amount)
      for (const x of expenses.data || []) if (st[x.project_id]) st[x.project_id].gastos += Number(x.amount)
      const ventasActivas = (salesR.data || []).filter(s => ids.includes(s.lot?.project_id)).length
      const vencidas = (venc.data || []).filter(v => v.sales?.status === 'en_proceso' && ids.includes(v.sales?.lot?.project_id))
      const deudaVencida = vencidas.reduce((s, v) => s + Number(v.amount) - Number(v.amount_paid), 0)
      // mes actual
      const mes = new Date().toISOString().slice(0, 7)
      const recMes = (income.data || []).filter(i => (i.date || '').startsWith(mes)).reduce((s, i) => s + Number(i.amount), 0)
      setData({ st, ventasActivas, nVencidas: vencidas.length, deudaVencida, recMes })
    }
    load()
  }, [pid, projects])

  if (!data) return <p className="muted">Cargando indicadores...</p>

  const tot = Object.values(data.st).reduce((a, s) => ({
    ingresos: a.ingresos + s.ingresos, gastos: a.gastos + s.gastos,
    disp: a.disp + (s.lotes.disponible || 0), vend: a.vend + (s.lotes.vendido || 0),
    sep: a.sep + (s.lotes.separado || 0),
    total: a.total + Object.values(s.lotes).reduce((x, y) => x + y, 0),
  }), { ingresos: 0, gastos: 0, disp: 0, vend: 0, sep: 0, total: 0 })

  const cards = [
    { label: 'Recaudado', value: soles(tot.ingresos) },
    { label: 'Recaudo este mes', value: soles(data.recMes) },
    { label: 'Gastos', value: soles(tot.gastos) },
    { label: 'Balance', value: soles(tot.ingresos - tot.gastos) },
    { label: 'Ventas activas', value: data.ventasActivas },
    { label: 'Cuotas vencidas', value: `${data.nVencidas} (${soles(data.deudaVencida)})`, bad: data.nVencidas > 0 },
    { label: 'Lotes disponibles', value: `${tot.disp} / ${tot.total}` },
    { label: 'Lotes vendidos', value: tot.vend },
    { label: 'Lotes separados', value: tot.sep },
  ]

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Dashboard {pid === 'general' ? '- GENERAL' : ''}</h1>
        <ProjectPicker withGeneral={conGeneral}
          generalLabel={role === 'admin' ? 'GENERAL (todos los proyectos)' : 'TOTAL (mis proyectos)'} />
      </div>

      <div className="cards">
        {cards.map(c => (
          <div className="glass card" key={c.label}>
            <p className="muted">{c.label}</p>
            <p className="kpi" style={c.bad ? { color: 'var(--error)' } : {}}>{c.value}</p>
          </div>
        ))}
      </div>

      {pid === 'general' && Object.keys(data.st).length > 1 && (
        <>
          <h2 className="sub">Por proyecto</h2>
          <div className="cards">
            {Object.values(data.st).map(s => (
              <div className="glass card" key={s.name}>
                <p><b>{s.name}</b></p>
                <p className="muted small">Recaudado {soles(s.ingresos)} | Gastos {soles(s.gastos)}</p>
                <p className="small">
                  <span className="ok">{s.lotes.disponible || 0} disp</span> |{' '}
                  <span style={{ color: '#4f83c2' }}>{s.lotes.vendido || 0} vend</span> |{' '}
                  <span className="warn">{s.lotes.separado || 0} sep</span>
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
