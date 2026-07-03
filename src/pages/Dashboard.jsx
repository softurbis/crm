import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Dashboard() {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    async function load() {
      const [lots, clients, sales, income] = await Promise.all([
        supabase.from('lots').select('status', { count: 'exact' }),
        supabase.from('clients').select('id', { count: 'exact', head: true }),
        supabase.from('sales').select('id', { count: 'exact', head: true }).eq('status', 'en_proceso'),
        supabase.from('daily_income').select('amount'),
      ])
      const byStatus = {}
      for (const l of lots.data || []) byStatus[l.status] = (byStatus[l.status] || 0) + 1
      setStats({
        lotes: lots.count ?? 0,
        disponibles: byStatus.disponible || 0,
        vendidos: byStatus.vendido || 0,
        separados: byStatus.separado || 0,
        clientes: clients.count ?? 0,
        ventasActivas: sales.count ?? 0,
        recaudado: (income.data || []).reduce((s, r) => s + Number(r.amount), 0),
      })
    }
    load()
  }, [])

  if (!stats) return <p className="muted">Cargando indicadores…</p>

  const cards = [
    { label: 'Recaudado total', value: `S/ ${stats.recaudado.toLocaleString('es-PE', { minimumFractionDigits: 2 })}` },
    { label: 'Ventas activas', value: stats.ventasActivas },
    { label: 'Lotes disponibles', value: `${stats.disponibles} / ${stats.lotes}` },
    { label: 'Lotes vendidos', value: stats.vendidos },
    { label: 'Lotes separados', value: stats.separados },
    { label: 'Clientes', value: stats.clientes },
  ]

  return (
    <>
      <h1>Dashboard</h1>
      <div className="cards">
        {cards.map(c => (
          <div className="glass card" key={c.label}>
            <p className="muted">{c.label}</p>
            <p className="kpi">{c.value}</p>
          </div>
        ))}
      </div>
    </>
  )
}
