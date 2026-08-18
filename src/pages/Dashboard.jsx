import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'
import { Reloj, BarrasMes, Rosca, BarrasH, Chispa, Lineas, corto } from '../components/Graficos'

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const MESES_L = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']
const mesLbl = ym => { const [y, m] = ym.split('-'); return MESES_L[Number(m) - 1] + ' ' + y }
const estadoDe = o => { const x = (o || '').toUpperCase(); return x.includes('EXPROP') ? 'EXPROPIADO' : x.includes('PERDIDA') ? 'PERDIDA' : 'ACEPTADO' }

// Supabase entrega COMO MAXIMO 1000 filas por consulta, y no avisa: devuelve mil
// y se queda tan tranquila. Pucallpa tiene 2,271 pagos, asi que el dashboard
// estaba mostrando menos de la mitad de lo cobrado con cara de dato exacto.
// `hacer()` tiene que devolver una consulta NUEVA cada vez (con su .order(), que
// sin orden explicito las paginas se pisan y se saltan filas).
async function todas(hacer) {
  const out = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await hacer().range(desde, desde + 999)
    if (error || !data || !data.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

export default function Dashboard() {
  const { role } = useAuth()
  const { projects, pid } = useProject()
  const navigate = useNavigate()
  const [raw, setRaw] = useState(null)
  const [fmes, setFmes] = useState('todos')
  const [verDetalle, setVerDetalle] = useState(false)
  const [tic, setTic] = useState(0)          // sube con cada cambio en la base: dispara la recarga
  const conGeneral = role !== 'secretary'

  useEffect(() => {
    async function load() {
      const ids = pid === 'general' ? projects.map(p => p.id) : [pid]
      if (!ids.length) return
      const COLS_GASTOS = 'id, project_id, amount, issue_date, reception_date, status, type, recipient, description'
      let gastos = await todas(() => supabase.from('expenses').select(COLS_GASTOS).in('project_id', ids).order('id'))
      if (!gastos.length) gastos = await todas(() => supabase.from('expenses').select(COLS_GASTOS.replace(', status', '')).in('project_id', ids).order('id'))

      const hoy = new Date().toISOString().slice(0, 10)
      const ym = hoy.slice(0, 7)
      const en180 = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10)

      // Las sumas del cronograma y de la caja las hace Postgres (sql/65): eso baja
      // la pantalla de 2.11 MB a ~30 KB. Si las funciones no estan creadas, se cae
      // al camino de antes y todo sigue igual, solo que pesado.
      const [aggCuotas, aggPagos] = await Promise.all([
        supabase.rpc('dash_cuotas', { proyectos: ids }).then(r => (r.error ? null : r.data), () => null),
        supabase.rpc('dash_pagos', { proyectos: ids }).then(r => (r.error ? null : r.data), () => null),
      ])
      const liviano = !!(aggCuotas && aggPagos)

      const [lots, income, salesR, venc, seps, delMes, proximas, crono, leads] = await Promise.all([
        // los lotes ELIMINADOS no existen en el terreno: no suman al total del proyecto
        // (sus pagos si siguen contando, porque salen de daily_income)
        todas(() => supabase.from('lots').select('id, project_id, status, total_price').in('project_id', ids).neq('status', 'eliminado').order('id')),
        liviano ? [] : todas(() => supabase.from('daily_income').select('id, project_id, amount, date, observation').in('project_id', ids).order('id')),
        todas(() => supabase.from('sales').select('id, sale_date, total_sale_price, status, lot:lots!inner(project_id)').in('lot.project_id', ids).order('id')),
        // con cliente, lote y fecha: sirve para el top de deudores y la antigüedad
        todas(() => supabase.from('installments').select('id, amount, amount_paid, due_date, sales!inner(status, client:clients!sales_client_id_fkey(full_name), lot:lots!inner(project_id, mz, lt))').eq('status', 'vencido').eq('sales.status', 'en_proceso').in('sales.lot.project_id', ids).order('id')),
        todas(() => supabase.from('separations').select('id, amount, date, lot:lots!inner(project_id)').in('lot.project_id', ids).order('id')),
        // cuotas que VENCEN este mes: contra esto se mide la cobranza del mes
        liviano ? [] : todas(() => supabase.from('installments').select('id, amount, amount_paid, sales!inner(status, lot:lots!inner(project_id))').gte('due_date', ym + '-01').lte('due_date', ym + '-31').eq('sales.status', 'en_proceso').in('sales.lot.project_id', ids).order('id')),
        // lo que viene: 6 meses hacia adelante, para planificar la caja
        liviano ? [] : todas(() => supabase.from('installments').select('id, amount, amount_paid, due_date, sales!inner(status, lot:lots!inner(project_id))').gt('due_date', hoy).lte('due_date', en180).neq('status', 'pagado').eq('sales.status', 'en_proceso').in('sales.lot.project_id', ids).order('id')),
        // cronograma COMPLETO: para la curva de "lo que debió entrar" contra lo real
        liviano ? [] : todas(() => supabase.from('installments').select('id, amount, amount_paid, due_date, sales!inner(status, lot:lots!inner(project_id))').eq('sales.status', 'en_proceso').in('sales.lot.project_id', ids).order('id')),
        todas(() => supabase.from('leads').select('id, status, project_id').in('project_id', ids).order('id')),
      ])
      const mio = v => ids.includes(v.sales?.lot?.project_id) && v.sales?.status === 'en_proceso'
      setRaw({
        ids, hoy,
        lots, income, expenses: gastos,
        sales: salesR.filter(s => ids.includes(s.lot?.project_id)),
        venc: venc.filter(mio),
        seps: seps.filter(x => ids.includes(x.lot?.project_id)),
        cuotasMes: delMes.filter(mio),
        proximas: proximas.filter(mio),
        crono: crono.filter(mio),
        agg: liviano ? { cuotas: aggCuotas, pagos: aggPagos } : null,
        _t: Date.now(),
        leads: leads.filter(l => !l.project_id || ids.includes(l.project_id)),
      })
    }
    load()
  }, [pid, projects, tic])

  // EN VIVO: cuando entra un pago, se registra una venta o cambia un lote, el
  // panel se recarga solo. Se espera 4 segundos y se junta todo lo que haya
  // pasado en ese rato: una cobranza puede insertar varias filas seguidas y no
  // tiene sentido recargar cinco veces.
  useEffect(() => {
    let t = null
    const patear = () => { clearTimeout(t); t = setTimeout(() => setTic(x => x + 1), 4000) }
    const ch = supabase.channel('dash-vivo')
    for (const tabla of ['daily_income', 'sales', 'lots', 'installments', 'separations', 'expenses']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, patear)
    }
    ch.subscribe()
    return () => { clearTimeout(t); supabase.removeChannel(ch) }
  }, [])

  const D = useMemo(() => {
    if (!raw) return null
    const { lots, income, expenses, sales, venc, seps } = raw
    const acept = income.filter(i => estadoDe(i.observation) === 'ACEPTADO')
    const perd = income.filter(i => estadoDe(i.observation) === 'PERDIDA')
    const expr = income.filter(i => estadoDe(i.observation) === 'EXPROPIADO')
    const nLotes = lots.length
    const nv = lots.filter(l => l.status === 'vendido' || l.status === 'entregado').length
    const nEntregados = lots.filter(l => l.status === 'entregado').length
    const nd = lots.filter(l => l.status === 'disponible').length
    const ns = lots.filter(l => l.status === 'separado').length
    const ventasActivas = sales.filter(s => s.status === 'en_proceso')
    const ventasExpr = sales.filter(s => s.status === 'expropiado')
    const ventasPagadas = sales.filter(s => s.status === 'pagado')
    const valorVentasActivas = ventasActivas.reduce((s, v) => s + Number(v.total_sale_price), 0)
    const A = raw.agg   // sumas hechas en Postgres (sql/65); null = camino viejo
    const recaudadoActivo = A ? Number(A.pagos.totales.aceptado || 0) : acept.reduce((s, i) => s + Number(i.amount), 0)
    const carteraDisp = lots.filter(l => l.status === 'disponible').reduce((s, l) => s + Number(l.total_price || 0), 0)
    const deudaVencida = venc.reduce((s, v) => s + Number(v.amount) - Number(v.amount_paid), 0)
    const gastosReales = expenses.filter(g => g.status !== 'solicitado')
    const gastosT = gastosReales.reduce((s, g) => s + Number(g.amount), 0)

    // series mensuales
    const meses = {}
    const M = ym => (meses[ym] = meses[ym] || { rec: 0, pagos: 0, ventasN: 0, ventasS: 0, gastos: 0, seps: 0 })
    if (A) for (const x of (A.pagos.por_mes || [])) { M(x.ym).rec += Number(x.rec); M(x.ym).pagos += Number(x.n) }
    else for (const i of acept) { const ym = (i.date || '').slice(0, 7); if (ym) { M(ym).rec += Number(i.amount); M(ym).pagos++ } }
    for (const v of sales) { const ym = (v.sale_date || '').slice(0, 7); if (ym) { M(ym).ventasN++; M(ym).ventasS += Number(v.total_sale_price) } }
    for (const g of gastosReales) { const ym = (g.issue_date || g.reception_date || '').slice(0, 7); if (ym) M(ym).gastos += Number(g.amount) }
    for (const x of seps) { const ym = (x.date || '').slice(0, 7); if (ym) M(ym).seps++ }
    const mesesOrden = Object.keys(meses).sort().reverse()

    return {
      recaudado: recaudadoActivo, gastosT,
      perdidasS: A ? Number(A.pagos.totales.perdida_s || 0) : perd.reduce((s, i) => s + Number(i.amount), 0),
      perdidasN: A ? Number(A.pagos.totales.perdida_n || 0) : perd.length,
      exprS: A ? Number(A.pagos.totales.exprop_s || 0) : expr.reduce((s, i) => s + Number(i.amount), 0),
      exprN: ventasExpr.length,
      nLotes, nv, nd, ns,
      pctVendido: nLotes ? (nv / nLotes * 100) : 0,
      ventasActivasN: ventasActivas.length, valorVentasActivas,
      pagadasN: ventasPagadas.length, pagadasS: ventasPagadas.reduce((s, v) => s + Number(v.total_sale_price), 0),
      pctCobrado: valorVentasActivas ? Math.min(100, recaudadoActivo / valorVentasActivas * 100) : 0,
      carteraDisp, vencN: venc.length, deudaVencida,
      meses, mesesOrden,
    }
  }, [raw])

  // El desglosado de un mes necesita nombres de cliente, lote y numero de cuota:
  // esos JOIN pesaban en CADA carga del dashboard aunque no se abriera ningun mes.
  // Ahora se piden solo cuando se elige uno, y solo de ese mes.
  const [det, setDet] = useState(null)
  useEffect(() => {
    if (fmes === 'todos' || !raw) { setDet(null); return }
    let vivo = true
    const desde = fmes + '-01', hasta = fmes + '-31'
    ;(async () => {
      const [pagos, ventas, seps] = await Promise.all([
        todas(() => supabase.from('daily_income')
          .select('id, amount, income_type, date, observation, operation_number, lot:lots(mz,lt), client:clients(full_name), installment:installments(installment_number), sale:sales(status)')
          .in('project_id', raw.ids).gte('date', desde).lte('date', hasta).order('id')),
        todas(() => supabase.from('sales')
          .select('id, sale_date, total_sale_price, status, client:clients!sales_client_id_fkey(full_name), lot:lots!inner(project_id, mz, lt)')
          .in('lot.project_id', raw.ids).gte('sale_date', desde).lte('sale_date', hasta).order('id')),
        todas(() => supabase.from('separations')
          .select('id, amount, date, client:clients(full_name), lot:lots!inner(project_id, mz, lt)')
          .in('lot.project_id', raw.ids).gte('date', desde).lte('date', hasta).order('id')),
      ])
      if (!vivo) return
      const enMes = f => (f || '').slice(0, 7) === fmes
      setDet({
        pagos: pagos.sort((a, b) => (a.date < b.date ? -1 : 1)),
        ventas, seps,
        gastos: raw.expenses.filter(g => g.status !== 'solicitado' && enMes(g.issue_date || g.reception_date)),
      })
    })()
    return () => { vivo = false }
  }, [raw, fmes])

  // ---- serie de los ultimos 12 meses, en orden (D.mesesOrden viene al reves) ----
  const serie = useMemo(() => {
    if (!D) return []
    return [...D.mesesOrden].reverse().slice(-12).map(ym => ({
      ym, lbl: MESES_L[Number(ym.split('-')[1]) - 1].slice(0, 3) + " '" + ym.slice(2, 4), ...D.meses[ym],
    }))
  }, [D])

  // ---- composicion de los lotes, para la rosca ----
  const compo = useMemo(() => {
    if (!raw) return []
    const c = {}
    for (const l of raw.lots) c[l.status] = (c[l.status] || 0) + 1
    const COL = { disponible: '#4caf72', separado: '#e0913f', vendido: '#4f83c2', entregado: '#3fb6a8', invadido: '#c94f4f', expropiado: '#9a6bc9' }
    return Object.entries(c).map(([k, v]) => ({ label: k.toUpperCase(), valor: v, color: COL[k] || '#6d6f74' }))
  }, [raw])

  // ---- COMPARATIVOS: lo que de verdad se decide mirando ----
  const comp = useMemo(() => {
    if (!raw) return null
    const nom = id => projects.find(p => p.id === id)?.name || '—'
    const P = {}
    const b = id => (P[id] ||= { cobrado: 0, mora: 0, disp: 0, vend: 0, lotes: 0 })
    for (const l of raw.lots) {
      const x = b(l.project_id); x.lotes++
      if (l.status === 'disponible') x.disp++
      if (['vendido', 'entregado'].includes(l.status)) x.vend++
    }
    if (A) for (const x of (A.pagos.por_proyecto || [])) b(x.project_id).cobrado += Number(x.cobrado || 0)
    else for (const i of raw.income) if (estadoDe(i.observation) === 'ACEPTADO') b(i.project_id).cobrado += Number(i.amount)
    for (const v of raw.venc) b(v.sales?.lot?.project_id).mora += Number(v.amount) - Number(v.amount_paid)
    const porProy = Object.entries(P).map(([id, x]) => ({ id, nombre: nom(id), ...x }))

    // cobranza del mes: lo que VENCÍA contra lo que entró. El indicador que dice
    // si la cobranza va bien, mucho mejor que "cuánto entró" a secas.
    const A = raw.agg
    const esperado = A ? Number(A.cuotas.mes_actual?.esperado || 0) : (raw.cuotasMes || []).reduce((s, q) => s + Number(q.amount), 0)
    const cobradoMes = A ? Number(A.cuotas.mes_actual?.cobrado || 0) : (raw.cuotasMes || []).reduce((s, q) => s + Number(q.amount_paid), 0)

    // quién debe más (cliente + lote juntos: el mismo cliente puede tener varios)
    const deudas = {}
    for (const v of raw.venc) {
      const lote = (v.sales?.lot?.mz || '?') + '-' + (v.sales?.lot?.lt || '?')
      const k = (v.sales?.client?.full_name || '—') + ' · ' + lote
      const d = (deudas[k] ||= { monto: 0, lote, n: 0 })
      d.monto += Number(v.amount) - Number(v.amount_paid); d.n++
    }
    const top = Object.entries(deudas).sort((a, z) => z[1].monto - a[1].monto).slice(0, 6)

    // ANTIGUEDAD DE LA MORA: no toda la deuda vale igual. 30 dias es un olvido y
    // se cobra con una llamada; mas de 90 ya es negociacion o expropiacion.
    const hoyD = new Date(raw.hoy + 'T00:00:00')
    const tramos = [
      { label: '1 a 30 días', valor: 0, color: '#e0c14c', n: 0, items: [] },
      { label: '31 a 60 días', valor: 0, color: '#e0913f', n: 0, items: [] },
      { label: '61 a 90 días', valor: 0, color: '#d9754f', n: 0, items: [] },
      { label: 'Más de 90 días', valor: 0, color: '#d9534f', n: 0, items: [] },
    ]
    for (const v of raw.venc) {
      const saldo = Number(v.amount) - Number(v.amount_paid)
      if (saldo <= 0.05) continue
      const dias = Math.floor((hoyD - new Date(v.due_date + 'T00:00:00')) / 86400000)
      const i = dias <= 30 ? 0 : dias <= 60 ? 1 : dias <= 90 ? 2 : 3
      tramos[i].valor += saldo; tramos[i].n++
      tramos[i].items.push({
        quien: v.sales?.client?.full_name || '—',
        lote: (v.sales?.lot?.mz || '?') + '-' + (v.sales?.lot?.lt || '?'),
        monto: saldo, dias, vence: v.due_date,
      })
    }
    tramos.forEach(t => { t.valor = Math.round(t.valor) })

    // CALENDARIO: lo que viene, mes por mes. Para saber si la caja alcanza.
    const futuro = {}
    if (A) for (const x of (A.cuotas.proximas || [])) futuro[x.ym] = Number(x.monto || 0)
    else for (const q of (raw.proximas || [])) {
      const ymq = String(q.due_date).slice(0, 7)
      futuro[ymq] = (futuro[ymq] || 0) + (Number(q.amount) - Number(q.amount_paid))
    }
    const calendario = Object.entries(futuro).sort().map(([ymq, v]) => ({
      label: MESES_L[Number(ymq.split('-')[1]) - 1] + " '" + ymq.slice(2, 4),
      valor: Math.round(v), color: '#7ec8e3',
    }))

    // RITMO Y HORIZONTE, PROYECTO POR PROYECTO
    // Dos preguntas distintas: cuando se termina de VENDER (depende del ritmo de
    // ventas) y cuando se termina de COBRAR (depende de la cobranza mensual). Y
    // para lo segundo el cronograma ya tiene una respuesta firmada: la fecha de
    // la ultima cuota. Comparar esa fecha con la que sale del ritmo real es el
    // dato que dice si el proyecto va atrasado.
    const hoyMs = new Date(raw.hoy + 'T00:00:00').getTime()
    const mesesAtras = (f, n) => f && (hoyMs - new Date(f + 'T00:00:00').getTime()) <= n * 30.44 * 86400000
    const R = {}
    const rb = id => (R[id] ||= { vend6: 0, vendTot: 0, primera: null, disp: 0, saldo: 0, cobr6: 0, ultimaCuota: null })
    for (const l of raw.lots) if (l.status === 'disponible') rb(l.project_id).disp++
    for (const v of raw.sales) {
      const x = rb(v.lot?.project_id)
      x.vendTot++
      if (mesesAtras(v.sale_date, 6)) x.vend6++
      if (v.sale_date && (!x.primera || v.sale_date < x.primera)) x.primera = v.sale_date
    }
    if (A) {
      for (const x of (A.pagos.por_proyecto || [])) rb(x.project_id).cobr6 += Number(x.cobrado6 || 0)
      for (const x of (A.cuotas.por_proyecto || [])) {
        const r = rb(x.project_id)
        r.saldo = Number(x.saldo || 0)
        r.ultimaCuota = x.ultima_cuota || null
      }
    } else {
      for (const i of raw.income) if (estadoDe(i.observation) === 'ACEPTADO' && mesesAtras(i.date, 6)) rb(i.project_id).cobr6 += Number(i.amount)
      for (const q of (raw.crono || [])) {
        const x = rb(q.sales?.lot?.project_id)
        const falta = Number(q.amount) - Number(q.amount_paid)
        if (falta > 0.05) x.saldo += falta
        if (q.due_date && (!x.ultimaCuota || q.due_date > x.ultimaCuota)) x.ultimaCuota = q.due_date
      }
    }
    const enMeses = n => { const d = new Date(); d.setMonth(d.getMonth() + n); return MESES_L[d.getMonth()].slice(0, 3).toLowerCase() + ' ' + d.getFullYear() }
    const fechaCorta = f => { if (!f) return '—'; const [y, m] = f.split('-'); return MESES_L[Number(m) - 1].slice(0, 3).toLowerCase() + ' ' + y }
    const ritmos = Object.entries(R).map(([id, x]) => {
      const mesesVivo = x.primera ? Math.max(1, Math.round((hoyMs - new Date(x.primera + 'T00:00:00').getTime()) / (30.44 * 86400000))) : 1
      const ritmo = x.vend6 / 6
      const historico = x.vendTot / mesesVivo
      const cobrMes = x.cobr6 / 6
      const mesesVender = ritmo > 0 ? Math.ceil(x.disp / ritmo) : null
      const mesesCobrar = cobrMes > 0 ? Math.ceil(x.saldo / cobrMes) : null
      // referencia: el ritmo que haria falta para vender todo en 24 meses
      const optimo = x.disp / 24
      return {
        id, nombre: nom(id), ...x, ritmo, historico, cobrMes, optimo,
        mesesVender, mesesCobrar,
        finVender: mesesVender ? enMeses(mesesVender) : null,
        finCobrar: mesesCobrar ? enMeses(mesesCobrar) : null,
        finCronograma: fechaCorta(x.ultimaCuota),
        atrasoMeses: (mesesCobrar && x.ultimaCuota)
          ? Math.round((new Date(new Date().setMonth(new Date().getMonth() + mesesCobrar)) - new Date(x.ultimaCuota + 'T00:00:00')) / (30.44 * 86400000))
          : null,
      }
    }).filter(x => x.disp > 0 || x.saldo > 0).sort((a, z) => z.ritmo - a.ritmo)
    const ritmoProm = ritmos.length ? ritmos.reduce((s2, x) => s2 + x.ritmo, 0) / ritmos.length : 0

    // ACUMULADO: lo que el cronograma decia que ya deberia estar cobrado, contra
    // lo que de verdad entro. La distancia entre las dos lineas ES la mora, y se
    // ve si se abre o se cierra con el tiempo.
    const porMes = {}
    if (A) for (const x of (A.cuotas.por_mes || [])) porMes[x.ym] = { debio: Number(x.debio || 0), real: Number(x.real || 0) }
    else for (const q of (raw.crono || [])) {
      const k = String(q.due_date || '').slice(0, 7)
      if (!k) continue
      const b2 = (porMes[k] ||= { debio: 0, real: 0 })
      b2.debio += Number(q.amount)
      b2.real += Number(q.amount_paid)
    }
    const ymHoy = raw.hoy.slice(0, 7)
    const mesesCurva = Object.keys(porMes).filter(k => k <= ymHoy).sort().slice(-14)
    let accD = 0, accR = 0
    const curva = mesesCurva.map(k => {
      accD += porMes[k].debio; accR += porMes[k].real
      return { k, debio: Math.round(accD), real: Math.round(accR) }
    })

    // EMBUDO DE LEADS: donde se caen. El % es contra el paso anterior.
    const ORDEN = [['nuevo', 'Escribieron'], ['contactado', 'Contactados'], ['interesado', 'Interesados'],
                   ['visita_agendada', 'Visita agendada'], ['negociacion', 'En negociación'], ['ganado', 'Ganados']]
    const porEstado = {}
    for (const l of (raw.leads || [])) porEstado[l.status] = (porEstado[l.status] || 0) + 1
    const totLeads = (raw.leads || []).length
    const embudo = ORDEN.map(([k, lbl], i) => ({
      label: lbl, valor: porEstado[k] || 0,
      color: ['#7ec8e3', '#6aa9d6', '#5b8fc9', '#4f83c2', '#4bb96a', '#3fa85e'][i],
    }))

    // RITMO DE VENTA: a este paso, cuando se acaba el proyecto
    const ult6 = Object.keys(P).length ? null : null
    const ventasUlt6 = raw.sales.filter(v => {
      const d = new Date(v.sale_date + 'T00:00:00')
      return !isNaN(d) && (new Date(raw.hoy + 'T00:00:00') - d) <= 183 * 86400000
    }).length
    const ritmo = ventasUlt6 / 6
    const disponiblesTot = raw.lots.filter(l => l.status === 'disponible').length
    const mesesRestantes = ritmo > 0 ? Math.round(disponiblesTot / ritmo) : null

    const gastosPorTipo = {}
    for (const g of raw.expenses.filter(x => x.status !== 'solicitado')) {
      const k = (g.type || 'OTRO').toUpperCase()
      gastosPorTipo[k] = (gastosPorTipo[k] || 0) + Number(g.amount || 0)
    }
    const COL = ['#4f83c2', '#e0913f', '#9a6bc9', '#3fb6a8', '#c94f4f', '#6d6f74', '#4caf72']
    return {
      porProy, esperado, cobradoMes, top, tramos, calendario, curva, embudo, totLeads, ritmo, mesesRestantes, disponiblesTot, ventasUlt6, ritmos, ritmoProm,
      pctCobranza: esperado ? (cobradoMes / esperado * 100) : 0,
      gastosTipo: Object.entries(gastosPorTipo).sort((a, z) => z[1] - a[1])
        .map(([k, v], i) => ({ label: k, valor: Math.round(v), color: COL[i % COL.length] })),
    }
  }, [raw, projects])

  // ---- LIMITES DEL SISTEMA (solo superusuario, sql/64) ----
  // Nace del susto del 14 de agosto: Supabase avisó "Grace period is over" y
  // hubo que ir a buscar a su panel cuál línea estaba al tope. Ahora se ve acá.
  const [tramoSel, setTramoSel] = useState(null)
  const [limites, setLimites] = useState(null)
  useEffect(() => {
    if (role !== 'superuser') return
    supabase.rpc('limites_sistema').then(({ data, error }) => {
      setLimites(error ? { error: error.message } : data)
    })
  }, [role])

  if (!D) return <p className="muted">Cargando indicadores...</p>

  const cards = [
    { label: 'COBRADO (ACEPTADO)', value: soles(D.recaudado), sub: `${D.pctCobrado.toFixed(1)}% del valor de ventas activas (${soles(D.valorVentasActivas)})`, to: '/pagos', chispa: serie.map(x => x.rec), chispaColor: '#4bb96a' },
    { label: 'GASTOS', value: soles(D.gastosT), sub: `BALANCE: ${soles(D.recaudado - D.gastosT)}`, to: '/gastos', chispa: serie.map(x => x.gastos), chispaColor: '#d9754f' },
    { label: 'LOTES VENDIDOS', value: `${D.nv} (${D.pctVendido.toFixed(1)}%)`, sub: `de ${D.nLotes} lotes | ${D.ns} separados`, to: '/lotes?estado=vendido' },
    { label: 'POR VENDER', value: D.nd, sub: `cartera disponible: ${soles(D.carteraDisp)}`, to: '/lotes?estado=disponible' },
    { label: 'CUOTAS VENCIDAS', value: D.vencN, sub: `deuda vencida: ${soles(D.deudaVencida)}`, bad: D.vencN > 0, to: '/lotes?estado=vencidas' },
    { label: 'VENTAS ACTIVAS', value: D.ventasActivasN, sub: 'en proceso de pago', to: '/ventas?estado=en_proceso', chispa: serie.map(x => x.ventasN), chispaColor: '#4f83c2' },
    { label: 'PAGADOS (100%)', value: D.pagadasN, sub: `cancelados: ${soles(D.pagadasS)}`, green: true, to: '/ventas?estado=pagado' },
    { label: 'EXPROPIADOS', value: D.exprN, sub: `pagos asociados: ${soles(D.exprS)}`, purple: true, to: '/ventas?estado=expropiado' },
    { label: 'PERDIDAS', value: D.perdidasN, sub: `separaciones perdidas: ${soles(D.perdidasS)}`, bad: D.perdidasN > 0, to: '/lotes' },
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

      {/* ---- LO PRIMERO QUE SE VE: a que ritmo se vende y cuando se acaba ---- */}
      {comp && (
        <div className="glass form-card" style={{ marginBottom: '1rem', borderLeft: '3px solid var(--accent-strong)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 8 }}>
            <h2 className="sub" style={{ margin: 0 }}>RITMO Y HORIZONTE</h2>
            <span className="muted small" style={{ textTransform: 'none' }}>
              últimos 6 meses · <b style={{ color: '#4bb96a' }}>● en vivo</b>
              {raw?._t ? ' · actualizado ' + new Date(raw._t).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
          </div>
          <div className="cards" style={{ gap: '.7rem' }}>
            <div className="glass card">
              <p className="muted">SE VENDEN</p>
              <p className="kpi kpi-big" style={{ color: '#4f83c2' }}>{comp.ritmo.toFixed(1)}</p>
              <p className="muted small" style={{ textTransform: 'none' }}>lotes por mes · {comp.ventasUlt6} en 6 meses</p>
            </div>
            <div className="glass card">
              <p className="muted">QUEDAN POR VENDER</p>
              <p className="kpi kpi-big">{comp.disponiblesTot}</p>
              <p className="muted small" style={{ textTransform: 'none' }}>lotes disponibles</p>
            </div>
            <div className="glass card">
              <p className="muted">SE TERMINAN DE VENDER</p>
              <p className="kpi kpi-big" style={{ color: comp.mesesRestantes && comp.mesesRestantes > 60 ? '#e0913f' : '#4bb96a' }}>
                {comp.mesesRestantes ?? '—'}<span style={{ fontSize: '1rem', fontWeight: 400 }}> meses</span>
              </p>
              <p className="muted small" style={{ textTransform: 'none' }}>
                {comp.mesesRestantes ? 'a este ritmo, hasta ' + (() => { const d = new Date(); d.setMonth(d.getMonth() + comp.mesesRestantes); return MESES_L[d.getMonth()].toLowerCase() + ' ' + d.getFullYear() })() : 'sin ventas recientes'}
              </p>
            </div>
            {(() => {
              const saldo = comp.ritmos.reduce((a, r) => a + r.saldo, 0)
              const porMes = comp.ritmos.reduce((a, r) => a + r.cobrMes, 0)
              const meses = porMes > 0 ? Math.ceil(saldo / porMes) : null
              return (
                <>
                  <div className="glass card">
                    <p className="muted">FALTA COBRAR</p>
                    <p className="kpi kpi-big" style={{ color: '#e0913f' }}>{corto(saldo)}</p>
                    <p className="muted small" style={{ textTransform: 'none' }}>entran {soles(porMes)} por mes</p>
                  </div>
                  <div className="glass card">
                    <p className="muted">SE TERMINA DE COBRAR</p>
                    <p className="kpi kpi-big" style={{ color: meses && meses > 48 ? '#e0913f' : '#4bb96a' }}>
                      {meses ?? '—'}<span style={{ fontSize: '1rem', fontWeight: 400 }}> meses</span>
                    </p>
                    <p className="muted small" style={{ textTransform: 'none' }}>
                      {meses ? 'a este ritmo, hasta ' + (() => { const d = new Date(); d.setMonth(d.getMonth() + meses); return MESES_L[d.getMonth()].toLowerCase() + ' ' + d.getFullYear() })() : '—'}
                    </p>
                  </div>
                </>
              )
            })()}
          </div>
          {comp.ritmos.length > 1 && (
            <p className="muted small" style={{ margin: '8px 0 0', textTransform: 'none' }}>
              Ojo: son <b>{comp.ritmos.length} proyectos</b> con ritmos muy distintos
              ({comp.ritmos.map(r => r.nombre.replace(/^LAS PRADERAS DE |^EL TRIUNFO DE /i, '') + ' ' + r.ritmo.toFixed(1)).join(' · ')} por mes).
              El detalle de cada uno está más abajo, en <b>RITMO Y HORIZONTE POR PROYECTO</b>.
            </p>
          )}
        </div>
      )}

      <div className="cards cards-big">
        {cards.map(c => (
          <div className="glass card" key={c.label} onClick={() => c.to && navigate(c.to)}
            style={c.to ? { cursor: 'pointer' } : undefined} title={c.to ? 'Ver detalle' : undefined}>
            <p className="muted">{c.label}</p>
            <p className="kpi kpi-big" style={c.bad ? { color: 'var(--error)' } : c.purple ? { color: '#b58ad9' } : c.green ? { color: '#4bb96a' } : {}}>{c.value}</p>
            {c.sub && <p className="muted small">{c.sub}</p>}
            {c.chispa?.length > 1 && <Chispa datos={c.chispa} color={c.chispaColor} />}
          </div>
        ))}
      </div>

      {/* ---- GRAFICOS: la foto de un vistazo ---- */}
      <div className="graf-2">
        <div className="glass form-card">
          <h2 className="sub">PLATA POR MES — ÚLTIMOS {serie.length} MESES</h2>
          <BarrasMes meses={serie} alto={300} onMes={ym => { setFmes(ym); setVerDetalle(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
        </div>
        <div className="glass form-card">
          <h2 className="sub">EN QUÉ ESTÁN LOS LOTES</h2>
          <Rosca partes={compo} centro={String(D.nLotes)} titulo="lotes" />
          <div style={{ borderTop: '1px solid rgba(255,255,255,.1)', marginTop: 10, paddingTop: 8 }}>
            <p className="muted small" style={{ margin: '0 0 5px' }}>EMBUDO</p>
            <BarrasH formato={n => String(n)} filas={[
              { label: 'Disponibles', valor: D.nd, color: '#4caf72' },
              { label: 'Separados', valor: D.ns, color: '#e0913f' },
              { label: 'Vendidos', valor: D.nv, color: '#4f83c2' },
              { label: 'Pagados 100%', valor: D.pagadasN, color: '#3fb6a8' },
            ]} />
          </div>
        </div>
      </div>

      {/* ---- COBRANZA DEL MES: lo que vencia contra lo que entro ---- */}
      {comp && comp.esperado > 0 && (
        <div className="graf-2">
          <div className="glass form-card">
            <h2 className="sub">COBRANZA DE ESTE MES</h2>
            <BarrasH filas={[
              { label: 'Vencía este mes', valor: Math.round(comp.esperado), color: '#7ec8e3' },
              { label: 'Cobrado', valor: Math.round(comp.cobradoMes), color: comp.pctCobranza >= 70 ? '#4bb96a' : comp.pctCobranza >= 40 ? '#e0a13f' : '#d9534f' },
              { label: 'Falta cobrar', valor: Math.round(Math.max(0, comp.esperado - comp.cobradoMes)), color: '#d9754f' },
            ]} />
            <p className={comp.pctCobranza >= 70 ? 'ok' : 'bad'} style={{ margin: '6px 0 0', fontSize: 13, textTransform: 'none' }}>
              <b>{comp.pctCobranza.toFixed(0)}%</b> de lo que vencía este mes ya está cobrado
            </p>
          </div>
          <div className="glass form-card">
            <h2 className="sub">QUIÉN DEBE MÁS</h2>
            {comp.top.length
              ? <>
                  <BarrasH
                    filas={comp.top.map(([k, v]) => ({ label: k, valor: Math.round(v.monto), color: '#d9534f', lote: v.lote, n: v.n }))}
                    onFila={f => navigate('/lotes?lote=' + encodeURIComponent(f.lote))} />
                  <p className="muted small" style={{ margin: '4px 0 0', textTransform: 'none' }}>Clic en cualquiera para abrir la ficha de su lote.</p>
                </>
              : <p className="ok small">Nadie tiene cuotas vencidas. ✅</p>}
          </div>
        </div>
      )}

      {/* ---- LO QUE DEBIO ENTRAR CONTRA LO QUE ENTRO ---- */}
      {comp?.curva?.length > 1 && (
        <div className="glass form-card" style={{ marginBottom: '1rem' }}>
          <h2 className="sub">LO QUE DEBIÓ ENTRAR CONTRA LO QUE ENTRÓ</h2>
          <Lineas
            etiquetas={comp.curva.map(c => MESES_L[Number(c.k.split('-')[1]) - 1].slice(0, 3) + " '" + c.k.slice(2, 4))}
            series={[
              { label: 'Debió entrar', color: '#7ec8e3', datos: comp.curva.map(c => c.debio), punteada: true },
              { label: 'Entró de verdad', color: '#4bb96a', datos: comp.curva.map(c => c.real) },
            ]}
            brecha alto={260}
          />
          {(() => {
            const u = comp.curva[comp.curva.length - 1]
            const brecha = u.debio - u.real
            const pct = u.debio ? (u.real / u.debio * 100) : 0
            return (
              <p className={pct >= 85 ? 'ok' : 'bad'} style={{ margin: '6px 0 0', fontSize: 13, textTransform: 'none' }}>
                Según los cronogramas ya debían estar cobrados <b>{soles(u.debio)}</b> y entraron <b>{soles(u.real)}</b>:
                se cobró el <b>{pct.toFixed(0)}%</b>{brecha > 0 ? <> — faltan <b>{soles(brecha)}</b>, que es la mora acumulada de toda la historia.</> : '.'}
              </p>
            )
          })()}
        </div>
      )}

      {/* ---- ANTIGUEDAD DE LA MORA + LO QUE VIENE ---- */}
      {comp && (comp.tramos.some(t => t.valor > 0) || comp.calendario.length > 0) && (
        <div className="graf-2">
          <div className="glass form-card">
            <h2 className="sub">ANTIGÜEDAD DE LA MORA</h2>
            {comp.tramos.some(t => t.valor > 0) ? (
              <>
                <BarrasH filas={comp.tramos.filter(t => t.valor > 0)}
                  onFila={f => setTramoSel(tramoSel === f.label ? null : f.label)} />
                {(() => {
                  const t = comp.tramos.find(x => x.label === tramoSel)
                  if (!t) return <p className="muted small" style={{ margin: '4px 0 0', textTransform: 'none' }}>Clic en un tramo para ver quiénes son.</p>
                  return (
                    <div style={{ marginTop: 8, border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, padding: '6px 8px' }}>
                      <p className="muted small" style={{ margin: '0 0 4px' }}>
                        {t.label.toUpperCase()} — {t.n} cuota(s) · {soles(t.valor)}
                      </p>
                      <div className="table-wrap" style={{ maxHeight: 210, overflowY: 'auto' }}>
                        <table>
                          <thead><tr><th>CLIENTE</th><th>LOTE</th><th>VENCIÓ</th><th>DÍAS</th><th>MONTO</th></tr></thead>
                          <tbody>
                            {t.items.slice().sort((a, z) => z.monto - a.monto).map((x, i) => (
                              <tr key={i} style={{ cursor: 'pointer' }} onClick={() => navigate('/lotes?lote=' + encodeURIComponent(x.lote))}
                                title="Abrir la ficha del lote">
                                <td>{x.quien}</td><td><b>{x.lote}</b></td>
                                <td>{String(x.vence).split('-').reverse().join('/')}</td>
                                <td className={x.dias > 90 ? 'bad' : ''}>{x.dias}</td>
                                <td>{soles(x.monto)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })()}
                <p className="muted small" style={{ margin: '6px 0 0', textTransform: 'none' }}>
                  Lo de <b>1 a 30 días</b> casi siempre se cobra con una llamada. Lo de <b>más de 90</b> ya es
                  negociación o resolución de contrato — mientras más abajo esté la plata, más difícil vuelve.
                </p>
                {comp.tramos[3].valor > 0 && (
                  <p className="bad small" style={{ margin: '4px 0 0', textTransform: 'none' }}>
                    ⚠️ {soles(comp.tramos[3].valor)} llevan más de 90 días vencidos, en {comp.tramos[3].n} cuotas.
                  </p>
                )}
              </>
            ) : <p className="ok small">Sin cuotas vencidas. ✅</p>}
          </div>
          <div className="glass form-card">
            <h2 className="sub">PROGRAMADO POR COBRAR — PRÓXIMOS 6 MESES</h2>
            {comp.calendario.length ? (
              <>
                <BarrasH filas={comp.calendario} />
                <p className="muted small" style={{ margin: '6px 0 0', textTransform: 'none' }}>
                  Cuotas que <b>aún no vencen</b>. Es la plata que debería entrar si todos pagan a tiempo:
                  sirve para saber si la caja alcanza y a quién hay que recordarle antes de la fecha.
                </p>
              </>
            ) : <p className="muted small">No hay cuotas por vencer en los próximos 6 meses.</p>}
          </div>
        </div>
      )}

      {/* ---- COMPARATIVO ENTRE PROYECTOS (solo tiene sentido viendo varios) ---- */}
      {comp && comp.porProy.length > 1 && (
        <div className="graf-3">
          <div className="glass form-card">
            <h2 className="sub">COBRADO POR PROYECTO</h2>
            <BarrasH filas={comp.porProy.slice().sort((a, z) => z.cobrado - a.cobrado)
              .map(p => ({ label: p.nombre, valor: Math.round(p.cobrado), color: '#4bb96a' }))} />
          </div>
          <div className="glass form-card">
            <h2 className="sub">MORA POR PROYECTO</h2>
            <BarrasH filas={comp.porProy.slice().sort((a, z) => z.mora - a.mora)
              .map(p => ({ label: p.nombre, valor: Math.round(p.mora), color: '#d9534f' }))} />
          </div>
          <div className="glass form-card">
            <h2 className="sub">LOTES POR VENDER</h2>
            <BarrasH formato={n => n + ' lotes'} filas={comp.porProy.slice().sort((a, z) => z.disp - a.disp)
              .map(p => ({ label: p.nombre, valor: p.disp, color: '#4caf72' }))} />
          </div>
        </div>
      )}

      {/* ---- VENTAS NUEVAS POR MES + EN QUE SE GASTA ---- */}
      <div className="graf-2">
        <div className="glass form-card">
          <h2 className="sub">VENTAS NUEVAS POR MES</h2>
          <BarrasH formato={n => n + (n === 1 ? ' venta' : ' ventas')}
            filas={serie.slice(-6).reverse().map(x => ({ label: x.lbl, valor: x.ventasN, color: '#4f83c2' }))} />
        </div>
        <div className="glass form-card">
          <h2 className="sub">EN QUÉ SE GASTA</h2>
          {comp?.gastosTipo?.length
            ? <Rosca partes={comp.gastosTipo} centro={corto(D.gastosT)} titulo="gastado" formato={soles} />
            : <p className="muted small">Sin gastos registrados.</p>}
        </div>
      </div>

      {serie.length > 1 && (() => {
        // comparacion simple contra el mes anterior: lo que uno mira primero
        const [ant, act] = [serie[serie.length - 2], serie[serie.length - 1]]
        const dif = act.rec - ant.rec
        const pct = ant.rec ? (dif / ant.rec * 100) : 0
        return (
          <div className="glass form-card">
            <h2 className="sub" style={{ margin: '0 0 6px' }}>CÓMO VA {act.lbl} CONTRA {ant.lbl}</h2>
            <BarrasH filas={[
              { label: 'Cobrado ' + ant.lbl, valor: ant.rec, color: '#4bb96a99' },
              { label: 'Cobrado ' + act.lbl, valor: act.rec, color: '#4bb96a' },
              { label: 'Gastos ' + act.lbl, valor: act.gastos, color: '#d9754f' },
            ]} />
            <p className={dif >= 0 ? 'ok small' : 'bad small'} style={{ margin: '4px 0 0', textTransform: 'none' }}>
              {dif >= 0 ? '▲' : '▼'} {soles(Math.abs(dif))} {dif >= 0 ? 'más' : 'menos'} que el mes pasado
              {ant.rec ? ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(0) + '%)' : ''} · {act.pagos} pagos este mes
            </p>
          </div>
        )
      })()}

      {m && (
        <div className="glass form-card mes-box">
          <h2 className="sub" style={{ margin: 0 }}>RESUMEN DE {mesLbl(fmes)}</h2>
          <div className="cards">
            <div className="glass card"><p className="muted">COBRADO EN EL MES</p><p className="kpi">{soles(m.rec)}</p><p className="muted small">{m.pagos} pagos registrados</p></div>
            <div className="glass card"><p className="muted">VENTAS NUEVAS</p><p className="kpi">{m.ventasN}</p><p className="muted small">por {soles(m.ventasS)}</p></div>
            <div className="glass card"><p className="muted">SEPARACIONES</p><p className="kpi">{m.seps}</p></div>
            <div className="glass card"><p className="muted">GASTOS DEL MES</p><p className="kpi">{soles(m.gastos)}</p></div>
            <div className="glass card"><p className="muted">BALANCE DEL MES</p><p className="kpi">{soles(m.rec - m.gastos)}</p></div>
          </div>
          <div><button className="btn-ghost" onClick={() => setVerDetalle(!verDetalle)}>{verDetalle ? 'Ocultar desglosado' : 'Ver desglosado del mes'}</button></div>

          {verDetalle && det && (<>
            <h3 className="sub">PAGOS DEL MES ({det.pagos.length})</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Fecha</th><th>Lote</th><th>Cliente</th><th>Concepto</th><th>N Op.</th><th>Monto</th><th>Estado</th></tr></thead>
                <tbody>
                  {det.pagos.map((x, i) => (
                    <tr key={i}>
                      <td>{x.date}</td>
                      <td>{x.lot ? `${x.lot.mz}-${x.lot.lt}` : '-'}</td>
                      <td>{x.client?.full_name || '-'}</td>
                      <td>{x.income_type === 'cuota' && x.installment ? `CUOTA N ${x.installment.installment_number}` : x.income_type}</td>
                      <td>{x.operation_number}</td>
                      <td>{soles(x.amount)}</td>
                      <td>{x.sale?.status === 'pagado' ? <span style={{ color: '#4bb96a', fontWeight: 700 }}>PAGADO 100%</span>
                        : x.sale?.status === 'expropiado' ? <span style={{ color: '#b58ad9' }}>EXPROPIADO</span>
                        : <span className="muted">{(x.sale?.status || 'en proceso').toUpperCase()}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {det.ventas.length > 0 && (<>
              <h3 className="sub">VENTAS NUEVAS DEL MES ({det.ventas.length})</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Fecha</th><th>Lote</th><th>Cliente</th><th>Precio</th><th>Estado</th></tr></thead>
                  <tbody>
                    {det.ventas.map((x, i) => (
                      <tr key={i}><td>{x.sale_date}</td><td>{x.lot?.mz}-{x.lot?.lt}</td><td>{x.client?.full_name || '-'}</td><td>{soles(x.total_sale_price)}</td><td>{x.status}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>)}

            {det.seps.length > 0 && (<>
              <h3 className="sub">SEPARACIONES DEL MES ({det.seps.length})</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Fecha</th><th>Lote</th><th>Cliente</th><th>Monto</th><th>Estado</th></tr></thead>
                  <tbody>
                    {det.seps.map((x, i) => (
                      <tr key={i}><td>{x.date}</td><td>{x.lot?.mz}-{x.lot?.lt}</td><td>{x.client?.full_name || '-'}</td><td>{soles(x.amount)}</td><td>{x.status}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>)}

            {det.gastos.length > 0 && (<>
              <h3 className="sub">GASTOS DEL MES ({det.gastos.length})</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Fecha</th><th>Tipo</th><th>Receptor</th><th>Descripcion</th><th>Monto</th></tr></thead>
                  <tbody>
                    {det.gastos.map((x, i) => (
                      <tr key={i}><td>{x.issue_date || x.reception_date}</td><td>{x.type}</td><td>{x.recipient || '-'}</td><td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.description || '-'}</td><td>{soles(x.amount)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>)}
          </>)}
        </div>
      )}

      <h2 className="sub">Resumen mensual</h2>
      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Mes</th><th>Cobrado</th><th>Pagos</th><th>Ventas nuevas</th><th>Precio total vendido</th><th>Separaciones</th><th>Gastos</th><th>Balance</th></tr></thead>
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

      {/* ---- EMBUDO DE LEADS + RITMO DE VENTA ---- */}
      <div className="graf-2">
        <div className="glass form-card">
          <h2 className="sub">EMBUDO DE LEADS</h2>
          {comp?.totLeads ? (
            <>
              <BarrasH formato={n => n + (n === 1 ? ' lead' : ' leads')} filas={comp.embudo.filter(e => e.valor > 0)} />
              {(() => {
                const g = comp.embudo.find(e => e.label === 'Ganados')?.valor || 0
                const v = comp.embudo.find(e => e.label === 'Visita agendada')?.valor || 0
                return (
                  <p className="muted small" style={{ margin: '6px 0 0', textTransform: 'none' }}>
                    De <b>{comp.totLeads}</b> leads, <b>{v}</b> llegaron a agendar visita
                    ({(v / comp.totLeads * 100).toFixed(0)}%) y <b>{g}</b> terminaron en venta
                    ({(g / comp.totLeads * 100).toFixed(0)}%).
                    Donde el escalón cae más fuerte, ahí se está perdiendo la plata.
                  </p>
                )
              })()}
            </>
          ) : <p className="muted small">Todavía no hay leads registrados.</p>}
        </div>
        <div className="glass form-card">
          <h2 className="sub">RITMO DE VENTA</h2>
          {comp?.ritmo > 0 ? (
            <>
              <p className="kpi" style={{ margin: 0 }}>{comp.ritmo.toFixed(1)} <span style={{ fontSize: '.9rem', fontWeight: 400 }}>lotes por mes</span></p>
              <p className="muted small" style={{ margin: '2px 0 8px', textTransform: 'none' }}>
                promedio de los últimos 6 meses ({comp.ventasUlt6} ventas) · quedan <b>{comp.disponiblesTot}</b> lotes
              </p>
              <p className={comp.mesesRestantes && comp.mesesRestantes < 12 ? 'warn' : 'ok'} style={{ margin: 0, fontSize: 13, textTransform: 'none' }}>
                A este ritmo quedan <b>{comp.mesesRestantes} meses</b> de inventario.
              </p>
            </>
          ) : <p className="muted small">Sin ventas en los últimos 6 meses: no se puede estimar el ritmo.</p>}
        </div>
      </div>

      {/* ---- RITMO Y HORIZONTE, PROYECTO POR PROYECTO ---- */}
      {comp?.ritmos?.length > 0 && (
        <div className="glass form-card" style={{ marginBottom: '1rem' }}>
          <h2 className="sub">RITMO Y HORIZONTE POR PROYECTO</h2>
          <p className="muted small" style={{ margin: '0 0 8px', textTransform: 'none' }}>
            Son dos preguntas distintas: cuándo se termina de <b>vender</b> (depende del ritmo de ventas) y
            cuándo se termina de <b>cobrar</b> (depende de cuánto entra por mes). El <b>cronograma</b> ya tiene
            una respuesta firmada para lo segundo: la fecha de la última cuota. Si la fecha real cae después,
            ese proyecto va atrasado.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>PROYECTO</th><th>RITMO 6M</th><th>HISTÓRICO</th><th>ÓPTIMO*</th>
                  <th>LOTES</th><th>TERMINA DE VENDER</th>
                  <th>POR COBRAR</th><th>ENTRA POR MES</th><th>TERMINA DE COBRAR</th><th>CRONOGRAMA</th>
                </tr>
              </thead>
              <tbody>
                {comp.ritmos.map(r => (
                  <tr key={r.id}>
                    <td><b>{r.nombre}</b></td>
                    <td className={r.ritmo >= r.optimo ? 'ok' : 'bad'}><b>{r.ritmo.toFixed(1)}</b>/mes</td>
                    <td className="muted">{r.historico.toFixed(1)}/mes</td>
                    <td className="muted">{r.optimo.toFixed(1)}/mes</td>
                    <td>{r.disp}</td>
                    <td>{r.finVender ? <>{r.finVender} <span className="muted">({r.mesesVender} m)</span></> : <span className="muted">sin ritmo</span>}</td>
                    <td>{soles(r.saldo)}</td>
                    <td>{soles(r.cobrMes)}</td>
                    <td>{r.finCobrar ? <>{r.finCobrar} <span className="muted">({r.mesesCobrar} m)</span></> : <span className="muted">—</span>}</td>
                    <td className={r.atrasoMeses > 3 ? 'bad' : r.atrasoMeses != null ? 'ok' : ''}>
                      {r.finCronograma}
                      {r.atrasoMeses != null && r.atrasoMeses > 0 && <><br /><span className="small">+{r.atrasoMeses} m tarde</span></>}
                      {r.atrasoMeses != null && r.atrasoMeses <= 0 && <><br /><span className="small">al día</span></>}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid rgba(255,255,255,.18)' }}>
                  <td><b>PROMEDIO</b></td>
                  <td><b>{comp.ritmoProm.toFixed(1)}</b>/mes</td>
                  <td colSpan="8" className="muted small" style={{ textTransform: 'none' }}>
                    promedio simple entre proyectos activos
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ margin: '6px 0 0', textTransform: 'none' }}>
            * <b>Óptimo</b> = el ritmo que haría falta para vender todo el inventario en <b>24 meses</b>.
            Es una referencia de planificación, no una meta de la empresa: si tú manejas otro horizonte, dímelo y lo cambio.
          </p>
        </div>
      )}

      {/* ---- ESTE AÑO CONTRA EL PASADO ---- */}      {/* ---- ESTE AÑO CONTRA EL PASADO ---- */}
      {(() => {
        const anios = [...new Set(Object.keys(D.meses).map(k => k.slice(0, 4)))].sort().slice(-2)
        if (anios.length < 2) return null
        const COL = ['#6d7f8f', '#4bb96a']
        return (
          <div className="glass form-card" style={{ marginBottom: '1rem' }}>
            <h2 className="sub">ESTE AÑO CONTRA EL PASADO</h2>
            <Lineas
              etiquetas={MESES_L.map(m => m.slice(0, 3))}
              series={anios.map((a, i) => ({
                label: a, color: COL[i],
                datos: MESES_L.map((_, mi) => Math.round(D.meses[a + '-' + String(mi + 1).padStart(2, '0')]?.rec || 0)),
              }))}
              alto={250}
            />
            <p className="muted small" style={{ margin: '4px 0 0', textTransform: 'none' }}>
              Cobrado por mes. Los meses que aún no llegaron salen en cero.
            </p>
          </div>
        )
      })()}

      {/* ---- LIMITES DEL SISTEMA (solo superusuario) ---- */}
      {role === 'superuser' && limites && (
        <div className="glass form-card">
          <h2 className="sub" style={{ margin: '0 0 2px' }}>LÍMITES DEL SISTEMA</h2>
          {limites.error ? (
            <p className="warn small" style={{ textTransform: 'none' }}>
              No pude leerlos ({limites.error}). {/expolimites|does not exist|function/i.test(limites.error)
                ? <>Falta correr <b>sql/64_limites_sistema.sql</b> en Supabase.</> : null}
            </p>
          ) : (() => {
            const MB = b => Number(b || 0) / 1048576
            const filas = Object.entries(limites.filas || {}).sort((a, b) => b[1] - a[1])
            const pesadas = limites.tablas_pesadas || []
            return (
              <>
                <p className="muted small" style={{ margin: '0 0 8px', textTransform: 'none' }}>
                  Plan Free de Supabase. Cuando algo pasa del <b>75%</b> el reloj se pone ámbar, y del <b>90%</b> rojo.
                  El <b>egress</b> y los <b>usuarios activos</b> no se pueden leer desde acá (piden un token de administración
                  de la cuenta, que no puede vivir en el panel): esos se ven en Supabase → Settings → Usage.
                </p>
                <div className="cards" style={{ alignItems: 'flex-start' }}>
                  <Reloj titulo="BASE DE DATOS" usado={limites.db_bytes} limite={limites.db_limite}
                    detalle={MB(limites.db_bytes).toFixed(0) + ' MB de 500'} />
                  <Reloj titulo="ARCHIVOS EN SUPABASE" usado={limites.storage_bytes} limite={limites.storage_limite}
                    detalle={(limites.storage_archivos || 0) + ' archivos · el resto vive en R2'} />
                  <div className="glass card" style={{ flex: '1 1 240px' }}>
                    <p className="muted" style={{ margin: '0 0 5px' }}>FILAS POR TABLA</p>
                    <div style={{ fontSize: 12, columns: 2, columnGap: 14 }}>
                      {filas.map(([t, n]) => (
                        <div key={t} style={{ display: 'flex', justifyContent: 'space-between', breakInside: 'avoid' }}>
                          <span className="muted" style={{ textTransform: 'none' }}>{t}</span><b>{Number(n).toLocaleString('es-PE')}</b>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {pesadas.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <p className="muted small" style={{ margin: '0 0 5px' }}>LAS QUE MÁS PESAN</p>
                    <BarrasH filas={pesadas.map((x, i) => ({
                      label: x.tabla, valor: Number(x.bytes),
                      color: ['#4f83c2', '#4bb96a', '#e0913f', '#9a6bc9', '#3fb6a8', '#6d6f74'][i] || '#6d6f74',
                    }))} formato={b => (Number(b) / 1048576).toFixed(1) + ' MB'} />
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}
    </>
  )
}
