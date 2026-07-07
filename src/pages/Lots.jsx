import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'

const COLORS = {
  disponible: '#4caf72', separado: '#e0913f', vendido: '#4f83c2',
  entregado: '#3fb6a8', invadido: '#c94f4f', expropiado: '#9a6bc9',
}
const LBL = {
  disponible: 'Disponible', separado: 'Separado', vendido: 'Vendido',
  entregado: 'Entregado', invadido: 'Invadido', expropiado: 'Expropiado',
}

async function upload(path, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const full = `${path}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('urbis-files').upload(full, file, { upsert: true })
  if (error) throw new Error('Error al subir documento: ' + error.message)
  return supabase.storage.from('urbis-files').getPublicUrl(full).data.publicUrl
}

export default function Lots() {
  const { role, profile } = useAuth()
  const { pidOp } = useProject()
  const [lots, setLots] = useState([])
  const [clientes, setClientes] = useState([])
  const [coSel, setCoSel] = useState('')
  const [vencidos, setVencidos] = useState(new Set())
  const [expropiados, setExpropiados] = useState(new Map())
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState('todos')
  // si venimos del dashboard con ?estado=... aplica ese filtro al abrir
  useEffect(() => {
    const e = searchParams.get('estado')
    if (e) setFilter(e)
  }, [searchParams])
  const [vista, setVista] = useState('plano')
  const [sel, setSel] = useState(null)
  const [detail, setDetail] = useState(null)
  const [desg, setDesg] = useState(false)
  const [pagosDesg, setPagosDesg] = useState(null)
  const [simu, setSimu] = useState(null)
  const [historial, setHistorial] = useState([])

  // edicion normal (sin estado)
  const [edit, setEdit] = useState(false)
  const [ef, setEf] = useState({})
  const [emsg, setEmsg] = useState(null)

  // cambio de estado critico (solo admin)
  const [chg, setChg] = useState(false)
  const [chgTo, setChgTo] = useState('separado')
  const [chgReason, setChgReason] = useState('')
  const [chgFile, setChgFile] = useState(null)
  const [chgBusy, setChgBusy] = useState(false)

  // creacion masiva de lotes (admin)
  const [crear, setCrear] = useState(false)
  const [cf, setCf] = useState({ mz: '', desde: 1, hasta: 10, area: '', ppm2: '', inicial: 500 })
  const [cBusy, setCBusy] = useState(false)
  const [cMsg, setCMsg] = useState(null)

  async function loadLots() {
    if (!pidOp) return
    const { data } = await supabase.from('lots').select('*').eq('project_id', pidOp).order('mz').order('lt')
    setLots(data || [])
  }
  useEffect(() => {
    loadLots()
    supabase.from('clients').select('id, full_name, doc_number').order('full_name')
      .then(({ data }) => setClientes(data || []))
    supabase.from('installments').select('sales!inner(lot_id, status, lot:lots!inner(project_id))').eq('status', 'vencido')
      .then(({ data }) => setVencidos(new Set((data || []).filter(r => r.sales.status === 'en_proceso' && r.sales.lot?.project_id === pidOp).map(r => r.sales.lot_id))))
    // lotes con historial de EXPROPIACION (cuantas veces) — aparte del estado actual del lote
    supabase.from('sales').select('lot_id, lot:lots!inner(project_id)').eq('status', 'expropiado').eq('lot.project_id', pidOp)
      .then(({ data }) => { const m = new Map(); for (const r of (data || [])) m.set(r.lot_id, (m.get(r.lot_id) || 0) + 1); setExpropiados(m) })
  }, [pidOp])

  useEffect(() => {
    if (!sel) { setDetail(null); setHistorial([]); return }
    async function load() {
      // venta conjunta: si el lote es parte de un grupo, la venta vive en el lote principal
      let saleLotId = sel.id
      const mG = (sel.associated_to || '').match(/^VENTA CONJUNTA\s+([A-Z]+-\d+(?:\+[A-Z]+-\d+)+)/)
      const grupo = mG ? mG[1].split('+') : null
      if (grupo) {
        const [pmz, plt] = grupo[0].split('-')
        const prim = lots.find(x => x.mz === pmz && String(x.lt) === plt)
        if (prim) saleLotId = prim.id
      }
      const { data: sale } = await supabase.from('sales')
        .select('*, client:clients!sales_client_id_fkey(full_name, phone, phone_valid, doc_number), co_client:clients!sales_co_client_id_fkey(full_name), advisor:advisors(code)')
        .eq('lot_id', saleLotId).in('status', ['en_proceso', 'pagado'])
        .maybeSingle()
      let inst = []
      if (sale) {
        const { data } = await supabase.from('installments')
          .select('id, installment_number, due_date, amount, amount_paid, status')
          .eq('sale_id', sale.id).order('installment_number')
        inst = data || []
      }
      let sep = null
      if (sel.status === 'separado' || !sale) {
        const { data: sps } = await supabase.from('separations')
          .select('*, client:clients(full_name, phone), advisor:advisors(code)')
          .eq('lot_id', sel.id).eq('status', 'vigente')
          .order('created_at', { ascending: false }).limit(1)
        sep = (sps || [])[0] || null
      }
      // otros lotes del mismo cliente (para verlos desde cualquier lote)
      let hermanosLotes = []
      if (sale?.client_id) {
        const { data: os } = await supabase.from('sales')
          .select('lot:lots!inner(mz,lt,project_id)')
          .eq('client_id', sale.client_id).eq('lot.project_id', pidOp).in('status', ['en_proceso', 'pagado'])
        const enGrupo = new Set(grupo || [`${sel.mz}-${sel.lt}`])
        hermanosLotes = [...new Set((os || []).map(x => `${x.lot.mz}-${x.lot.lt}`))].filter(k => !enGrupo.has(k))
      }
      setDetail({ sale, inst, sep, grupo, hermanosLotes })
      const { data: hist } = await supabase.from('lot_status_changes')
        .select('new_status, previous_status, reason, document_url, changed_at')
        .eq('lot_id', sel.id).order('changed_at', { ascending: false }).limit(5)
      setHistorial(hist || [])
    }
    load()
  }, [sel])

  async function calcularSimulacro() {
    setSimu({ cargando: true })
    const soles = n => 'S/ ' + Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2 })
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
    const { data: ventas } = await supabase.from('sales')
      .select('id, auto_cobranza, client:clients!sales_client_id_fkey(full_name, phone), lot:lots!inner(mz, lt, project_id)')
      .eq('status', 'en_proceso').eq('lot.project_id', pidOp)
    const ids = (ventas || []).map(v => v.id)
    const { data: insts } = ids.length ? await supabase.from('installments')
      .select('sale_id, installment_number, due_date, amount, amount_paid, status')
      .in('sale_id', ids).order('installment_number') : { data: [] }
    const porVenta = {}
    for (const q of (insts || [])) (porVenta[q.sale_id] = porVenta[q.sale_id] || []).push(q)
    const dias = d => Math.floor((hoy - new Date(d + 'T00:00:00')) / 86400000)
    const envios = []; const humanos = []; let pausadas = 0; let sinAccion = 0
    for (const v of (ventas || [])) {
      const nombre = (v.client?.full_name || '').split(' ')[0]
      const lote = 'Mz ' + v.lot.mz + ' Lt ' + v.lot.lt
      if (v.auto_cobranza === false) { pausadas++; continue }
      const qs = porVenta[v.id] || []
      const vencidas = qs.filter(q => q.status !== 'pagado' && dias(q.due_date) > 0 && (Number(q.amount) - Number(q.amount_paid)) > 2)
      const deuda = vencidas.reduce((x, q) => x + Number(q.amount) - Number(q.amount_paid), 0)
      const nV = vencidas.length
      const base = { cliente: v.client?.full_name, tel: v.client?.phone, lote, nV, deuda }
      if (nV >= 3) {
        envios.push({ ...base, nivel: 'C', msj: '⚠️ *AVISO IMPORTANTE - URBIS GROUP* ⚠️\n\nSr(a). ' + nombre + ': su lote *' + lote + '* acumula *' + nV + ' cuotas vencidas* por *' + soles(deuda) + '*.\n\nConforme a su contrato, la acumulación de cuotas impagas es causal de resolución y puede derivar en la *pérdida/expropiación del lote* y de los montos pagados.\n\n*Es urgente que se comunique con nosotros HOY* para regularizar o llegar a un acuerdo por escrito. 📞' })
      } else if (nV === 2) {
        envios.push({ ...base, nivel: 'B', msj: 'Hola ' + nombre + ', le saludamos de *Urbis Group*.\n\nSu lote *' + lote + '* registra *2 cuotas vencidas* por un total de *' + soles(deuda) + '*.\n\nLe pedimos regularizar sus pagos para evitar mayores penalidades por mora. Si necesita una reprogramación, escríbanos y lo coordinamos. 🙏' })
      } else if (nV === 1) {
        const q = vencidas[0]; const dd = dias(q.due_date)
        if (dd >= 5) humanos.push({ ...base, dd, monto: Number(q.amount) - Number(q.amount_paid), vence: q.due_date })
        else if (dd === 2 || dd === 4) envios.push({ ...base, nivel: 'INSISTENCIA', msj: 'Hola ' + nombre + ', le saludamos de *Urbis Group*.\n\nSu cuota N° ' + q.installment_number + ' del lote *' + lote + '* por *' + soles(Number(q.amount) - Number(q.amount_paid)) + '* venció hace ' + dd + ' días.\n\nSi ya realizó el pago, envíenos el voucher por aquí; si tuvo un inconveniente, escríbanos para regularizar. 🙏' })
        else sinAccion++
      } else {
        const prox = qs.find(q => q.status !== 'pagado' && [-5, -3, 0].includes(dias(q.due_date)))
        if (prox) {
          const dp = -dias(prox.due_date); const falta = Number(prox.amount) - Number(prox.amount_paid)
          const cuerpo = dp === 0
            ? '*Hoy vence* su cuota N° ' + prox.installment_number + ' del lote *' + lote + '* por *' + soles(falta) + '*. Cuando pague, envíe la *foto de su voucher por este chat*. 📄✅'
            : 'Su cuota N° ' + prox.installment_number + ' del lote *' + lote + '* por *' + soles(falta) + '* vence en ' + dp + ' días, el *' + prox.due_date + '*. 🙌'
          envios.push({ ...base, nivel: dp === 0 ? 'A - HOY' : 'A - ' + dp + ' DÍAS', msj: 'Hola ' + nombre + ' 👋 le saludamos de *Urbis Group*.\n\n' + cuerpo })
        } else sinAccion++
      }
    }
    setSimu({ envios, humanos, pausadas, sinAccion, fecha: new Date().toLocaleString('es-PE') })
  }

  const byMz = useMemo(() => {
    const g = {}
    for (const l of lots) {
      if (filter === 'vencidas') { if (!vencidos.has(l.id)) continue }
      else if (filter === 'expropiado') { if (!expropiados.has(l.id)) continue }
      else if (filter !== 'todos' && l.status !== filter) continue
      ;(g[l.mz] = g[l.mz] || []).push(l)
    }
    for (const k in g) g[k].sort((a, b) => Number(a.lt) - Number(b.lt) || String(a.lt).localeCompare(String(b.lt)))
    return g
  }, [lots, filter, vencidos, expropiados])

  const counts = useMemo(() => {
    const c = { todos: lots.length, vencidas: vencidos.size }
    for (const l of lots) c[l.status] = (c[l.status] || 0) + 1
    c.expropiado = expropiados.size  // historial de expropiaciones (aparte del estado actual)
    return c
  }, [lots, vencidos, expropiados])

  function abrirLote(l) {
    setSel(l); setEdit(false); setEmsg(null); setChg(false); setChgReason(''); setChgFile(null)
  }

  async function guardarEdicion(e) {
    e.preventDefault()
    const payload = {
      area_m2: Number(ef.area_m2), price_per_m2: Number(ef.price_per_m2),
      associated_to: (ef.associated_to || '').toUpperCase() || null,
      initial_payment_default: Number(ef.initial_payment_default),
    }
    const { error } = await supabase.from('lots').update(payload).eq('id', sel.id)
    if (error) { setEmsg('ERROR: ' + error.message); return }
    setEmsg('LOTE ACTUALIZADO')
    await loadLots()
    setSel(x => ({ ...x, ...payload, total_price: payload.area_m2 * payload.price_per_m2 }))
    setEdit(false)
  }

  // cambio de estado con burocracia
  const docObligatorio = ['expropiado', 'invadido'].includes(chgTo)
  async function cambiarEstado(e) {
    e.preventDefault()
    if (detail?.sep && chgTo === 'disponible') {
      const limG = detail.sep.extended_until || detail.sep.expiration_date
      const vencG = limG && limG < new Date().toISOString().slice(0, 10)
      setEmsg('ERROR: ESTE LOTE TIENE UNA SEPARACION ' + (vencG ? 'VENCIDA' : 'VIGENTE') + '. RESUELVELA ARRIBA CON "EXTENDER PLAZO" O "MARCAR PERDIDA", NO CON CAMBIO DE ESTADO.')
      return
    }
    if (chgTo === 'expropiado' && role !== 'superuser') { setEmsg('ERROR: SOLO EL SUPERUSUARIO PUEDE EXPROPIAR (es un tramite formal).'); return }
    if (chgReason.trim().length < 10) { setEmsg('ERROR: EXPLICA EL MOTIVO (minimo 10 caracteres).'); return }
    if (docObligatorio && !chgFile) { setEmsg('ERROR: PARA ' + chgTo.toUpperCase() + ' EL DOCUMENTO DE RESPALDO FIRMADO ES OBLIGATORIO.'); return }
    setChgBusy(true); setEmsg(null)
    try {
      let docUrl = null
      if (chgFile) docUrl = await upload(`estado-lotes/${sel.mz}-${sel.lt}-${chgTo}`, chgFile)
      const { error: e1 } = await supabase.from('lot_status_changes').insert({
        lot_id: sel.id, previous_status: sel.status, new_status: chgTo,
        reason: chgReason.toUpperCase(), document_url: docUrl, changed_by: profile?.id,
      })
      if (e1) throw e1
      const { error: e2 } = await supabase.from('lots').update({ status: chgTo }).eq('id', sel.id)
      if (e2) throw e2
      // expropiar tambien marca la venta activa como expropiada
      if (chgTo === 'expropiado' && detail?.sale) {
        await supabase.from('sales').update({ status: 'expropiado' }).eq('id', detail.sale.id)
        await supabase.from('daily_income').update({ observation: 'EXPROPIADO' }).eq('sale_id', detail.sale.id)
      }
      setEmsg('ESTADO CAMBIADO A ' + chgTo.toUpperCase())
      await loadLots()
      setSel(x => ({ ...x, status: chgTo }))
      setChg(false); setChgReason(''); setChgFile(null)
    } catch (err) { setEmsg('ERROR: ' + err.message) }
    setChgBusy(false)
  }


  // creacion masiva de lotes (admin)
  async function crearLotes(e) {
    e.preventDefault()
    const mz = cf.mz.trim().toUpperCase()
    const d = parseInt(cf.desde), h = parseInt(cf.hasta)
    if (!mz || isNaN(d) || isNaN(h) || h < d) { setCMsg('ERROR: REVISA MANZANA Y RANGO (DESDE <= HASTA).'); return }
    if (h - d + 1 > 200) { setCMsg('ERROR: MAXIMO 200 LOTES POR TANDA.'); return }
    const existentes = new Set(lots.filter(l => String(l.mz).toUpperCase() === mz).map(l => String(l.lt)))
    const rows = []
    const saltados = []
    for (let n = d; n <= h; n++) {
      if (existentes.has(String(n))) { saltados.push(n); continue }
      rows.push({
        project_id: pidOp, mz, lt: String(n), status: 'disponible',
        area_m2: Number(cf.area), price_per_m2: Number(cf.ppm2),
        initial_payment_default: Number(cf.inicial || 0),
      })
    }
    if (!rows.length) { setCMsg('ERROR: TODOS ESOS LOTES YA EXISTEN EN LA MZ ' + mz + '.'); return }
    setCBusy(true); setCMsg(null)
    const { data, error } = await supabase.from('lots').insert(rows).select('id, total_price, area_m2, price_per_m2')
    if (error) { setCMsg('ERROR: ' + error.message); setCBusy(false); return }
    const sinTotal = (data || []).filter(r => r.total_price === null || r.total_price === undefined)
    for (const r of sinTotal) {
      await supabase.from('lots').update({ total_price: Number(r.area_m2) * Number(r.price_per_m2) }).eq('id', r.id)
    }
    setCMsg('OK: ' + rows.length + ' LOTES CREADOS EN MZ ' + mz + (saltados.length ? ' | YA EXISTIAN (saltados): ' + saltados.join(', ') : ''))
    setCBusy(false)
    loadLots()
  }

  async function borrarLote() {
    if (sel.status !== 'disponible') return
    if (!confirm('Eliminar el lote Mz ' + sel.mz + ' Lt ' + sel.lt + '? Solo se permite si esta DISPONIBLE.')) return
    const { error } = await supabase.from('lots').delete().eq('id', sel.id).eq('status', 'disponible')
    if (error) { setEmsg('NO SE PUDO ELIMINAR: TIENE SEPARACIONES, VENTAS O PAGOS HISTORICOS ASOCIADOS.'); return }
    setSel(null); loadLots()
  }

  async function extenderSep() {
    const sep = detail.sep
    const sug = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10) })()
    const nueva = prompt('NUEVA FECHA LIMITE de la separacion (AAAA-MM-DD):', sug)
    if (!nueva || !/^\d{4}-\d{2}-\d{2}$/.test(nueva)) { if (nueva !== null) alert('Formato invalido. Ej: ' + sug); return }
    const motivo = prompt('Motivo de la extension (obligatorio):')
    if (!motivo || motivo.trim().length < 5) { alert('MOTIVO OBLIGATORIO (minimo 5 caracteres).'); return }
    const { error } = await supabase.from('separations').update({ extended_until: nueva, aviso_previo_at: null, aviso_vencida_at: null }).eq('id', sep.id)
    if (error) { setEmsg('ERROR: ' + error.message); return }
    await supabase.from('secretary_tasks').update({ date: nueva }).eq('separation_id', sep.id).eq('status', 'pendiente')
    await supabase.from('activity_log').insert({
      action: 'UPDATE', entity_type: 'separations', user_email: profile?.email || null,
      details: { cambio: 'extension_separacion', lote: sel.mz + '-' + sel.lt, cliente: sep.client?.full_name || null, antes: sep.extended_until || sep.expiration_date, despues: nueva, motivo: motivo.toUpperCase() },
    })
    setEmsg('SEPARACION EXTENDIDA HASTA ' + nueva + ' (QUEDA EN BITACORA)')
    setSel(x => ({ ...x }))
  }

  async function perdidaSep() {
    const sep = detail.sep
    if (!confirm('MARCAR PERDIDA la separacion de ' + (sep.client?.full_name || 'este cliente') + ' (S/ ' + Number(sep.amount).toFixed(2) + ')?\n\nEl monto pagado queda como PERDIDA (no se devuelve) y el lote vuelve a DISPONIBLE.')) return
    const motivo = prompt('Motivo (obligatorio):', 'SEPARACION VENCIDA SIN PAGO DE INICIAL')
    if (!motivo || motivo.trim().length < 5) { alert('MOTIVO OBLIGATORIO (minimo 5 caracteres).'); return }
    const { error } = await supabase.from('separations').update({ status: 'perdida' }).eq('id', sep.id)
    if (error) { setEmsg('ERROR: ' + error.message); return }
    const { data: pgs } = await supabase.from('daily_income').select('id, observation').eq('separation_id', sep.id)
    for (const p of (pgs || [])) {
      if ((p.observation || '').toUpperCase().includes('PERDIDA')) continue
      await supabase.from('daily_income').update({ observation: ((p.observation ? p.observation + ' | ' : '') + 'PERDIDA: SEPARACION VENCIDA').slice(0, 400) }).eq('id', p.id)
    }
    await supabase.from('secretary_tasks').delete().eq('separation_id', sep.id).eq('status', 'pendiente')
    await supabase.from('lot_status_changes').insert({
      lot_id: sel.id, previous_status: sel.status, new_status: 'disponible',
      reason: ('PERDIDA DE SEPARACION: ' + motivo).toUpperCase().slice(0, 300), changed_by: profile?.id,
    })
    await supabase.from('lots').update({ status: 'disponible' }).eq('id', sel.id)
    await supabase.from('activity_log').insert({
      action: 'UPDATE', entity_type: 'separations', user_email: profile?.email || null,
      details: { cambio: 'perdida_separacion', lote: sel.mz + '-' + sel.lt, cliente: sep.client?.full_name || null, monto: sep.amount, motivo: motivo.toUpperCase() },
    })
    setEmsg('SEPARACION MARCADA COMO PERDIDA — LOTE DISPONIBLE OTRA VEZ')
    await loadLots()
    setSel(x => ({ ...x, status: 'disponible' }))
  }

  function waMessage() {
    const { sale, inst } = detail
    const overdue = inst.filter(i => i.status === 'vencido')
    const next = inst.find(i => i.status === 'pendiente')
    const name = sale.client?.full_name?.split(' ')[0] || 'CLIENTE'
    let msg = `Hola *${sale.client?.full_name}*, le saludamos de Urbis Group\n`
    msg += `Lote *Mz ${sel.mz} Lt ${sel.lt}* - Las Praderas de Cashibo\n\n`
    if (overdue.length) {
      const deuda = overdue.reduce((s, i) => s + Number(i.amount) - Number(i.amount_paid), 0)
      msg += `Tiene *${overdue.length} cuota(s) vencida(s)* por S/ ${deuda.toFixed(2)}.\n`
    }
    if (next) {
      const falta = Number(next.amount) - Number(next.amount_paid)
      msg += `Proxima cuota: N ${next.installment_number}, ${falta < Number(next.amount) ? 'le falta S/ ' + falta.toFixed(2) : 'de S/ ' + Number(next.amount).toFixed(2)}, vence el ${next.due_date}.\n`
    }
    msg += `\nPuede pagar por transferencia o deposito. Gracias ${name}!`
    const phone = (sale.client?.phone || '').replace(/\D/g, '')
    return `https://wa.me/${phone.startsWith('51') || phone.startsWith('52') || phone.startsWith('1') ? phone : '51' + phone}?text=${encodeURIComponent(msg)}`
  }

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Mapa de lotes</h1>
        <ProjectPicker />
        {['admin', 'superuser', 'secretary'].includes(role) && (
          <button className="btn-ghost" onClick={calcularSimulacro}>🧪 Simulacro cobranza</button>
        )}
        {['admin', 'superuser'].includes(role) && (
          <button className="btn-ghost" onClick={() => { setCrear(true); setCMsg(null) }}>➕ Crear lotes</button>
        )}
      </div>

      <div className="chips">
        {['todos', 'disponible', 'separado', 'vendido', 'entregado', 'invadido'].map(s => (
          <button key={s} className={`chip ${filter === s ? 'on' : ''}`}
            style={s !== 'todos' ? { '--dot': COLORS[s] } : {}}
            onClick={() => setFilter(s)}>
            {s !== 'todos' && <span className="dot" />}
            {s === 'todos' ? 'Todos' : LBL[s]} ({counts[s] || 0})
          </button>
        ))}
        <span className="muted small" style={{ alignSelf: 'center', margin: '0 .3rem', opacity: .6 }}>| histórico:</span>
        <button className={`chip ${filter === 'vencidas' ? 'on' : ''}`} style={{ '--dot': '#e05252' }}
          onClick={() => setFilter('vencidas')}>
          <span className="dot" /> Con vencidas ({counts.vencidas})
        </button>
        <button className={`chip ${filter === 'expropiado' ? 'on' : ''}`} style={{ '--dot': COLORS.expropiado }}
          onClick={() => setFilter('expropiado')}>
          <span className="dot" /> Expropiados ({counts.expropiado || 0})
        </button>
        <span style={{ flex: 1 }} />
        <button className={`chip ${vista === 'plano' ? 'on' : ''}`} onClick={() => setVista('plano')}>🗺️ Plano</button>
        <button className={`chip ${vista === 'lista' ? 'on' : ''}`} onClick={() => setVista('lista')}>☰ Lista</button>
      </div>

      {vista === 'plano' ? (
        <div className="plano-wrap">
          {Object.entries(byMz).map(([mz, arr]) => {
            const mitad = arr.length > 4 ? Math.ceil(arr.length / 2) : arr.length
            const filas = [arr.slice(0, mitad), arr.slice(mitad).reverse()].filter(f => f.length)
            return (
              <section key={mz} className="mz-plano">
                <span className="mz-tag">Mz. {mz}</span>
                {filas.map((fila, i) => (
                  <div key={i} className="fila-lotes">
                    {fila.map(l => (
                      <button key={l.id} className={`parcela ${vencidos.has(l.id) ? 'venc' : ''}`}
                        style={{ '--st': COLORS[l.status] }}
                        title={`Mz ${l.mz} Lt ${l.lt} - ${LBL[l.status]} - ${l.area_m2} m2${vencidos.has(l.id) ? ' - CON CUOTAS VENCIDAS' : ''}`}
                        onClick={() => abrirLote(l)}>
                        <b>{l.lt}</b>
                        <small>{Math.round(l.area_m2)} m²</small>
                      </button>
                    ))}
                  </div>
                ))}
              </section>
            )
          })}
        </div>
      ) : (
        Object.entries(byMz).map(([mz, arr]) => (
          <section key={mz} className="mz-block">
            <h3>Manzana {mz}</h3>
            <div className="lot-grid">
              {arr.map(l => (
                <button key={l.id} className={`lot-cell ${vencidos.has(l.id) ? 'venc' : ''}`}
                  style={{ background: COLORS[l.status] }}
                  title={`Mz ${l.mz} Lt ${l.lt} - ${LBL[l.status]}${vencidos.has(l.id) ? ' - CON CUOTAS VENCIDAS' : ''}`}
                  onClick={() => abrirLote(l)}>
                  {l.lt}
                </button>
              ))}
            </div>
          </section>
        ))
      )}

      {crear && (
        <div className="modal-bg" onClick={() => setCrear(false)}>
          <form className="glass modal" onClick={e => e.stopPropagation()} onSubmit={crearLotes}>
            <div className="modal-head">
              <h2>Crear lotes por manzana</h2>
              <button type="button" className="btn-ghost" onClick={() => setCrear(false)}>&#10005;</button>
            </div>
            <p className="muted small">Crea los lotes en tanda para el proyecto actual. Los numeros que ya existan en la manzana se saltan. Luego puedes editar area/precio de cada lote individual.</p>
            <div className="form-grid">
              <label>Manzana <input value={cf.mz} onChange={e => setCf(f => ({ ...f, mz: e.target.value }))} placeholder="A" required /></label>
              <label>Lote desde <input type="number" min="1" value={cf.desde} onChange={e => setCf(f => ({ ...f, desde: e.target.value }))} required /></label>
              <label>Lote hasta <input type="number" min="1" value={cf.hasta} onChange={e => setCf(f => ({ ...f, hasta: e.target.value }))} required /></label>
              <label>Area (m2) <input type="number" step="0.01" min="1" value={cf.area} onChange={e => setCf(f => ({ ...f, area: e.target.value }))} required /></label>
              <label>Precio por m2 (S/) <input type="number" step="0.01" min="0.01" value={cf.ppm2} onChange={e => setCf(f => ({ ...f, ppm2: e.target.value }))} required /></label>
              <label>Pago inicial por defecto (S/) <input type="number" step="0.01" min="0" value={cf.inicial} onChange={e => setCf(f => ({ ...f, inicial: e.target.value }))} /></label>
            </div>
            {cf.area && cf.ppm2 && (
              <p className="hint">Cada lote: {Number(cf.area)} m2 x S/ {Number(cf.ppm2).toFixed(2)} = <b>S/ {(Number(cf.area) * Number(cf.ppm2)).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</b>
                {' '}| Se crearan <b>{Math.max(0, (parseInt(cf.hasta) || 0) - (parseInt(cf.desde) || 0) + 1)}</b> lotes en la Mz {cf.mz.toUpperCase() || '?'}</p>
            )}
            {cMsg && <p className={cMsg.startsWith('OK') ? 'ok' : 'error'}>{cMsg}</p>}
            <button className="btn-primary" disabled={cBusy}>{cBusy ? 'Creando...' : 'Crear lotes'}</button>
          </form>
        </div>
      )}

      {sel && (
        <div className="modal-bg" onClick={() => setSel(null)}>
          <div className="glass modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Mz {sel.mz} - Lt {sel.lt}</h2>
              <span className="badge" style={{ background: COLORS[sel.status] }}>{LBL[sel.status]}</span>
              <button className="btn-ghost" onClick={() => setSel(null)}>&#10005;</button>
            </div>

            <div className="ficha">
              <p><span className="muted">Area:</span> {sel.area_m2} m2 | <span className="muted">Precio/m2:</span> S/ {Number(sel.price_per_m2).toFixed(2)}</p>
              <p><span className="muted">{detail?.sale ? 'Precio de venta:' : 'Precio lista:'}</span> <b>S/ {Number(detail?.sale ? detail.sale.total_sale_price : sel.total_price).toLocaleString('es-PE')}</b>{detail?.grupo && <span className="muted small"> (venta conjunta {detail.grupo.join('+')})</span>}</p>
              {sel.status === 'entregado' && <p><span className="muted">Entregado el:</span> <b>{sel.delivered_at || '- (sin fecha)'}</b></p>}
              {expropiados.get(sel.id) && <p className="hint" style={{ color: '#c39ce0', margin: '4px 0' }}>&#9888; Este lote fue EXPROPIADO <b>{expropiados.get(sel.id)} {expropiados.get(sel.id) > 1 ? 'veces' : 'vez'}</b> (histórico). Ver detalle en Ventas &#8594; filtro Expropiados.</p>}
              {sel.associated_to && !detail?.grupo && <p><span className="muted">Asociado a:</span> {sel.associated_to}</p>}
              {detail?.grupo && <p className="hint" style={{ margin: '4px 0' }}>&#128279; VENTA CONJUNTA de {detail.grupo.join(' + ')}. La venta y las cuotas se registran en el lote principal <b>{detail.grupo[0]}</b> y valen para todo el grupo.</p>}
              {detail?.hermanosLotes?.length > 0 && <p className="hint" style={{ margin: '4px 0' }}>&#127968; Este cliente tambien tiene: <b>{detail.hermanosLotes.join(', ')}</b> (ventas aparte, ver su estado de cuenta).</p>}
              {sel.boundaries?.medidas && (
                <p className="muted small">Medidas: {Object.entries(sel.boundaries.medidas).map(([k, v]) => `${k} ${v}`).join(' | ')}</p>
              )}
            </div>

            {['admin', 'secretary', 'superuser'].includes(role) && (
              <div className="ficha">
                {!edit ? (
                  <p>
                    <button className="btn-ghost" onClick={() => { setEdit(true); setChg(false); setEf({ area_m2: sel.area_m2, price_per_m2: sel.price_per_m2, associated_to: sel.associated_to || '', initial_payment_default: sel.initial_payment_default }) }}>Editar datos</button>
                    {' '}
                    {['admin', 'superuser'].includes(role) && (
                      <button className="btn-ghost" onClick={() => { setChg(!chg); setEdit(false) }}>Cambiar estado (admin)</button>
                    )}
                    {' '}
                    {role === 'superuser' && sel.status === 'disponible' && (
                      <button className="btn-ghost" style={{ color: '#ff8e7a', borderColor: 'rgba(255,142,122,.5)' }} onClick={borrarLote}>🗑 Eliminar lote</button>
                    )}
                  </p>
                ) : (
                  <form className="form-grid" onSubmit={guardarEdicion}>
                    <label>Area m2 <input type="number" step="0.01" value={ef.area_m2} onChange={e => setEf(f => ({ ...f, area_m2: e.target.value }))} required /></label>
                    <label>Precio por m2 <input type="number" step="0.01" value={ef.price_per_m2} onChange={e => setEf(f => ({ ...f, price_per_m2: e.target.value }))} required /></label>
                    <label>Separacion default S/ <input type="number" step="0.01" value={ef.initial_payment_default} onChange={e => setEf(f => ({ ...f, initial_payment_default: e.target.value }))} /></label>
                    <label>Asociado a <input value={ef.associated_to} onChange={e => setEf(f => ({ ...f, associated_to: e.target.value }))} /></label>
                    <div className="span2">
                      <button className="btn-primary">Guardar</button>{' '}
                      <button type="button" className="btn-ghost" onClick={() => setEdit(false)}>Cancelar</button>
                    </div>
                  </form>
                )}

                {chg && ['admin', 'superuser'].includes(role) && (
                  <form onSubmit={cambiarEstado} className="chg-box">
                    <p className="bad"><b>CAMBIO DE ESTADO - REQUIERE JUSTIFICACION</b></p>
                    <label>Nuevo estado
                      <select value={chgTo} onChange={e => setChgTo(e.target.value)}>
                        <option value="disponible">DISPONIBLE (liberar)</option>
                        <option value="separado">SEPARADO ADMINISTRATIVO (asunto interno)</option>
                        <option value="invadido">INVADIDO</option>
                        {role === 'superuser' && <option value="expropiado">EXPROPIADO (tramite formal, con documento)</option>}
                      </select>
                    </label>
                    <label>Motivo (obligatorio)
                      <textarea rows="3" value={chgReason} onChange={e => setChgReason(e.target.value)}
                        placeholder={chgTo === 'expropiado' ? 'Explica el motivo de la expropiacion...' : 'Explica el motivo del cambio...'} required />
                    </label>
                    <label>Documento de respaldo {docObligatorio ? <b className="bad">(OBLIGATORIO - firmado)</b> : '(opcional)'}
                      <input type="file" accept="image/*,.pdf" onChange={e => setChgFile(e.target.files[0] || null)} />
                    </label>
                    {chgTo === 'expropiado' && detail?.sale &&
                      <p className="warn">&#9888; La venta activa de {detail.sale.client?.full_name} pasara a EXPROPIADA.</p>}
                    <button className="btn-primary" disabled={chgBusy}>{chgBusy ? 'Procesando...' : 'Confirmar cambio de estado'}</button>
                  </form>
                )}
                {emsg && <p className={emsg.startsWith('ERROR') ? 'error' : 'ok'}>{emsg}</p>}

                {historial.length > 0 && (
                  <div className="small muted">
                    <p><b>HISTORIAL DE ESTADOS:</b></p>
                    {historial.map((h, i) => (
                      <p key={i}>
                        {new Date(h.changed_at).toLocaleDateString('es-PE')}: {h.previous_status} &#8594; <b>{h.new_status}</b> - {h.reason}
                        {h.document_url && <> | <a href={h.document_url} target="_blank" rel="noreferrer">DOC</a></>}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {detail?.sep && (() => {
              const sep = detail.sep
              const lim = sep.extended_until || sep.expiration_date
              const hoyStr = new Date().toISOString().slice(0, 10)
              const vencida = lim && lim < hoyStr
              const dias = lim ? Math.round((new Date(lim + 'T12:00:00') - new Date(hoyStr + 'T12:00:00')) / 86400000) : null
              return (
                <>
                  <hr />
                  <div className="ficha">
                    <p><b>SEPARACION VIGENTE</b> — {sep.client?.full_name || '-'}</p>
                    <p>
                      <span className="muted">Monto:</span> S/ {Number(sep.amount).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                      {' | '}<span className="muted">Fecha:</span> {sep.date}
                      {sep.advisor?.code && <>{' | '}<span className="muted">Asesor:</span> {sep.advisor.code}</>}
                    </p>
                    <p>
                      <span className="muted">Vence:</span> <b>{lim || '-'}</b>
                      {sep.extended_until && <span className="muted small"> (extendida; original {sep.expiration_date})</span>}{' '}
                      {vencida
                        ? <span className="st-chip st-per">VENCIDA</span>
                        : dias !== null && <span className={dias <= 2 ? 'warn' : 'ok'}>({dias === 0 ? 'vence HOY' : dias + ' dia(s) restante(s)'})</span>}
                    </p>
                    {vencida && (
                      <p className="error">&#128274; LOTE BLOQUEADO: no se puede vender ni liberar hasta que el administrador decida — extender el plazo o marcar perdida.</p>
                    )}
                    {['admin', 'superuser'].includes(role) && (
                      <p>
                        <button className="btn-ghost" onClick={extenderSep}>&#8987; Extender plazo</button>{' '}
                        <button className="btn-ghost" style={{ color: '#ff8e7a', borderColor: 'rgba(255,142,122,.5)' }} onClick={perdidaSep}>&#10060; Marcar perdida (libera el lote)</button>
                      </p>
                    )}
                  </div>
                </>
              )
            })()}

            {detail?.sale ? (
              <>
                <hr />
                <div className="ficha">
                  <p><span className="muted">Cliente:</span> <b>{detail.sale.client?.full_name}</b> ({detail.sale.client?.doc_number})</p>
                  <p><span className="muted">Cobranza automatica (agente WhatsApp):</span>{' '}
                    {detail.sale.auto_cobranza !== false
                      ? <span className="st-chip st-ok">ACTIVA</span>
                      : <span className="st-chip st-per">DESACTIVADA (gestion humana)</span>}
                    {['admin', 'secretary', 'superuser'].includes(role) && (
                      <>{' '}<button className="link-btn" onClick={async () => {
                        const nuevoVal = detail.sale.auto_cobranza === false
                        if (!confirm(nuevoVal ? 'Reactivar la cobranza automatica para esta venta?' : 'Desactivar la cobranza automatica? El agente dejara de escribirle y pasa a gestion humana.')) return
                        await supabase.from('sales').update({ auto_cobranza: nuevoVal }).eq('id', detail.sale.id)
                        setEmsg(nuevoVal ? 'COBRANZA AUTOMATICA REACTIVADA' : 'COBRANZA AUTOMATICA DESACTIVADA')
                        setSel(x => ({ ...x }))
                      }}>{detail.sale.auto_cobranza === false ? 'reactivar' : 'desactivar'}</button></>
                    )}
                  </p>
                  <p><span className="muted">Co-comprador:</span> {detail.sale.co_client?.full_name || '-'}
                    {['admin', 'secretary', 'superuser'].includes(role) && (
                      <>
                        {' '}<select value={coSel} onChange={e => setCoSel(e.target.value)} style={{ maxWidth: 220 }}>
                          <option value="">- elegir -</option>
                          <option value="QUITAR">(QUITAR CO-COMPRADOR)</option>
                          {clientes.filter(c => c.id !== detail.sale.client_id).map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                        </select>{' '}
                        <button className="link-btn" onClick={async () => {
                          if (!coSel) return
                          await supabase.from('sales').update({ co_client_id: coSel === 'QUITAR' ? null : coSel }).eq('id', detail.sale.id)
                          setEmsg('CO-COMPRADOR ACTUALIZADO'); setCoSel('')
                          setSel(x => ({ ...x }))
                        }}>guardar</button>
                      </>
                    )}
                  </p>
                  <p><span className="muted">Asesor:</span> {detail.sale.advisor?.code} | <span className="muted">Precio venta:</span> S/ {Number(detail.sale.total_sale_price).toLocaleString('es-PE')}</p>
                  {(() => {
                    const pagado = detail.inst.reduce((s, i) => s + Number(i.amount_paid), 0) + Number(detail.sale.initial_amount_paid)
                    const pct = (pagado / Number(detail.sale.total_sale_price) * 100).toFixed(1)
                    const venc = detail.inst.filter(i => i.status === 'vencido').length
                    const pag = detail.inst.filter(i => i.status === 'pagado').length
                    return (
                      <>
                        <p><span className="muted">Pagado:</span> S/ {pagado.toLocaleString('es-PE', { minimumFractionDigits: 2 })} ({pct}%)</p>
                        <p>
                          <span className="ok">&#9679; {pag} pagadas</span>{' '}
                          <span className="warn">&#9679; {detail.inst.length - pag - venc} pendientes</span>{' '}
                          <span className="bad">&#9679; {venc} vencidas</span>
                        </p>
                      </>
                    )
                  })()}
                  <p><button className="btn-ghost" onClick={async () => {
                    const { data } = await supabase.from('daily_income')
                      .select('date, amount, income_type, operation_number, voucher_url, observation, installment_id')
                      .eq('sale_id', detail.sale.id).order('date')
                    setPagosDesg(data || []); setDesg(true)
                  }}>📑 Ver desglosado de pagos</button></p>
                  {detail.sale.client?.phone_valid
                    ? <a className="btn-primary btn-link" href={waMessage()} target="_blank" rel="noreferrer">Mensaje de cobro por WhatsApp</a>
                    : <p className="error">Telefono no valido - actualizar en la ficha del cliente</p>}
                  {['admin', 'superuser'].includes(role) && detail.sale.status === 'en_proceso' && (
                    <p><button className="btn-ghost" onClick={async () => {
                      const sale = detail.sale
                      const nuevo = Number(prompt('AJUSTE DE PRECIO DE ESTA VENTA (solo admin).\n\nPrecio actual: S/ ' + sale.total_sale_price + '\nNuevo precio total:'))
                      if (!nuevo || isNaN(nuevo) || nuevo <= 0) return
                      const motivo = prompt('Motivo del ajuste (obligatorio):')
                      if (!motivo || motivo.trim().length < 5) { alert('MOTIVO OBLIGATORIO'); return }
                      const sepAmt = Math.round((Number(sale.total_sale_price) - Number(sale.initial_amount_paid) - Number(sale.financed_amount)) * 100) / 100
                      const pagadoCuotas = detail.inst.reduce((x, i) => x + Number(i.amount_paid), 0)
                      const pendientes = detail.inst.filter(i => i.status !== 'pagado')
                      const restante = Math.round((nuevo - Number(sale.initial_amount_paid) - sepAmt - pagadoCuotas) * 100) / 100
                      if (restante < 0) { alert('EL NUEVO PRECIO ES MENOR A LO YA PAGADO. NO PROCEDE.'); return }
                      if (!pendientes.length) { alert('NO HAY CUOTAS PENDIENTES PARA REDISTRIBUIR.'); return }
                      if (!confirm(`Nuevo precio: S/ ${nuevo}\nYa pagado: S/ ${(Number(sale.initial_amount_paid) + sepAmt + pagadoCuotas).toFixed(2)}\nSaldo a repartir en ${pendientes.length} cuotas: S/ ${restante.toFixed(2)} (aprox S/ ${(restante / pendientes.length).toFixed(2)} c/u)\n\nMOTIVO: ${motivo}\n\nConfirmar?`)) return
                      const share = Math.floor(restante / pendientes.length * 100) / 100
                      let acum = 0
                      for (let i = 0; i < pendientes.length; i++) {
                        const q = pendientes[i]
                        const extra = i === pendientes.length - 1 ? Math.round((restante - acum) * 100) / 100 : share
                        acum += extra
                        await supabase.from('installments').update({ amount: Math.round((Number(q.amount_paid) + extra) * 100) / 100 }).eq('id', q.id)
                      }
                      await supabase.from('sales').update({
                        total_sale_price: nuevo,
                        financed_amount: Math.round((nuevo - Number(sale.initial_amount_paid) - sepAmt) * 100) / 100,
                        monthly_amount: share,
                      }).eq('id', sale.id)
                      alert('PRECIO AJUSTADO. MOTIVO REGISTRADO EN BITACORA: ' + motivo.toUpperCase())
                      setSel(x => ({ ...x }))
                    }}>Ajustar precio de la venta (admin)</button></p>
                  )}
                </div>
              </>
            ) : detail && !detail.sep && sel.status !== 'disponible' ? (
              <p className="muted">Sin venta activa registrada.</p>
            ) : null}
          </div>
        </div>
      )}

      {simu && (
        <div className="modal-bg" onClick={() => setSimu(null)}>
          <div className="modal glass" onClick={e => e.stopPropagation()} style={{ maxWidth: 900, width: '96%', maxHeight: '88vh', overflowY: 'auto' }}>
            <div className="modal-head">
              <b>🧪 SIMULACRO DE COBRANZA — {simu.fecha || ''}</b>
              <button className="btn-ghost" onClick={() => setSimu(null)}>✕</button>
            </div>
            {simu.cargando ? <p className="muted">Calculando…</p> : (
              <>
                <p className="muted" style={{ fontSize: '.85rem' }}>Referencial: lo que el agente enviaría en el próximo barrido de las 9:00 con la data ACTUAL. No envía nada. (El agente además aplica dedupe: no repite el mismo aviso del mismo día.)</p>
                <p>
                  <span className="bad">&#9679; NIVEL C: {simu.envios.filter(x => x.nivel === 'C').length}</span>{' '}
                  <span className="warn">&#9679; NIVEL B: {simu.envios.filter(x => x.nivel === 'B').length}</span>{' '}
                  <span className="warn">&#9679; INSISTENCIAS: {simu.envios.filter(x => x.nivel === 'INSISTENCIA').length}</span>{' '}
                  <span className="ok">&#9679; RECORDATORIOS A: {simu.envios.filter(x => String(x.nivel).startsWith('A')).length}</span>{' '}
                  <span className="muted">| GESTIÓN HUMANA: {simu.humanos.length} | PAUSADAS: {simu.pausadas} | SIN ACCIÓN HOY: {simu.sinAccion}</span>
                </p>
                <h4 style={{ margin: '10px 0 4px' }}>MENSAJES QUE SALDRÍAN ({simu.envios.length})</h4>
                {!simu.envios.length && <p className="muted">Ninguno con la data actual.</p>}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
                  <tbody>
                    {simu.envios.map((e2, i) => (
                      <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,.07)', verticalAlign: 'top' }}>
                        <td style={{ whiteSpace: 'nowrap', paddingRight: 8 }}>
                          <span className={e2.nivel === 'C' ? 'bad' : e2.nivel === 'B' || e2.nivel === 'INSISTENCIA' ? 'warn' : 'ok'}>&#9679; {e2.nivel}</span>
                        </td>
                        <td style={{ paddingRight: 8 }}><b>{e2.cliente}</b><br /><span className="muted">{e2.tel} · {e2.lote} · {e2.nV} venc. · S/ {Number(e2.deuda).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</span></td>
                        <td>
                          <details>
                            <summary style={{ cursor: 'pointer' }}>ver mensaje</summary>
                            <div style={{ whiteSpace: 'pre-wrap', textTransform: 'none', fontSize: '.82rem', background: 'rgba(59,74,50,.35)', borderRadius: 8, padding: '8px 10px', marginTop: 4 }}>{e2.msj.replace(/\\n/g, '\n')}</div>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h4 style={{ margin: '14px 0 4px' }}>REQUIEREN GESTIÓN HUMANA ({simu.humanos.length}) — el bot ya no les escribe</h4>
                {!simu.humanos.length && <p className="muted">Ninguno.</p>}
                {simu.humanos.map((h, i) => (
                  <p key={i} style={{ margin: '2px 0' }}>• <b>{h.cliente}</b> — {h.lote} · S/ {Number(h.monto).toLocaleString('es-PE', { minimumFractionDigits: 2 })} · venció {h.vence} (hace {h.dd} días) <span className="muted">→ llamada del asesor</span></p>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {desg && detail?.sale && (
        <div className="modal-bg" onClick={() => setDesg(false)}>
          <div className="modal glass" onClick={e => e.stopPropagation()} style={{ maxWidth: 780, width: '95%', maxHeight: '86vh', overflowY: 'auto' }}>
            <div className="modal-head">
              <b>DESGLOSADO DE PAGOS — MZ {sel?.mz} LT {sel?.lt}</b>
              <button className="btn-ghost" onClick={() => setDesg(false)}>✕</button>
            </div>
            <p><span className="muted">Cliente:</span> <b>{detail.sale.client?.full_name}</b>{detail.sale.co_client?.full_name ? ' + ' + detail.sale.co_client.full_name : ''}</p>
            {(() => {
              const sale = detail.sale
              const pagCuotas = detail.inst.reduce((x, i) => x + Number(i.amount_paid), 0)
              const sepAmt = Math.round((Number(sale.total_sale_price) - Number(sale.initial_amount_paid) - Number(sale.financed_amount)) * 100) / 100
              const pagado = pagCuotas + Number(sale.initial_amount_paid) + sepAmt
              const saldo = Math.round((Number(sale.total_sale_price) - pagado) * 100) / 100
              const f = n => 'S/ ' + Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2 })
              return (
                <p>
                  <span className="muted">Precio:</span> <b>{f(sale.total_sale_price)}</b> · <span className="muted">Separación:</span> {f(sepAmt)} · <span className="muted">Inicial:</span> {f(sale.initial_amount_paid)} · <span className="muted">Cuotas pagadas:</span> {f(pagCuotas)} · <span className="muted">SALDO:</span> <b className={saldo > 0 ? 'warn' : 'ok'}>{f(saldo)}</b>
                </p>
              )
            })()}
            <h4 style={{ margin: '10px 0 4px' }}>CRONOGRAMA DE CUOTAS ({detail.inst.length})</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
              <thead><tr style={{ textAlign: 'left', opacity: .7 }}><th>N°</th><th>VENCE</th><th>MONTO</th><th>PAGADO</th><th>ESTADO</th></tr></thead>
              <tbody>
                {detail.inst.map(q => (
                  <tr key={q.id} style={{ borderTop: '1px solid rgba(255,255,255,.07)' }}>
                    <td>{q.installment_number}</td>
                    <td>{q.due_date?.split('-').reverse().join('/')}</td>
                    <td>S/ {Number(q.amount).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                    <td>S/ {Number(q.amount_paid).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                    <td><span className={q.status === 'pagado' ? 'ok' : q.status === 'vencido' ? 'bad' : 'warn'}>&#9679; {q.status.toUpperCase()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h4 style={{ margin: '14px 0 4px' }}>PAGOS REGISTRADOS ({(pagosDesg || []).length})</h4>
            {!pagosDesg?.length && <p className="muted">Sin pagos registrados para esta venta.</p>}
            {!!pagosDesg?.length && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
                <thead><tr style={{ textAlign: 'left', opacity: .7 }}><th>FECHA</th><th>TIPO</th><th>CUOTA</th><th>MONTO</th><th>OPERACIÓN</th><th>VOUCHER</th><th>OBS.</th></tr></thead>
                <tbody>
                  {pagosDesg.map((p2, i) => (
                    <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,.07)' }}>
                      <td>{p2.date?.split('-').reverse().join('/')}</td>
                      <td>{(p2.income_type || '').toUpperCase()}</td>
                      <td>{p2.installment_id ? ('N° ' + (detail.inst.find(q => q.id === p2.installment_id)?.installment_number ?? '?')) : '-'}</td>
                      <td>S/ {Number(p2.amount).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                      <td style={{ textTransform: 'none' }}>{p2.operation_number}</td>
                      <td>{p2.voucher_url ? <a href={p2.voucher_url} target="_blank" rel="noreferrer">ver</a> : <span className="bad">falta</span>}</td>
                      <td style={{ maxWidth: 170, textTransform: 'none' }}>{p2.observation || '-'}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid rgba(255,255,255,.2)', fontWeight: 700 }}>
                    <td colSpan="3">TOTAL PAGOS</td>
                    <td colSpan="4">S/ {pagosDesg.reduce((x, y) => x + Number(y.amount), 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  )
}
