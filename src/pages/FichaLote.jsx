import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { upload } from '../lib/archivos'
import { useMsg, savedFx } from '../lib/saveFx'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import EstadoCuentaDownload from '../components/EstadoCuentaDownload'
import BuscarLote from '../components/BuscarLote'
import Buscador from '../components/Buscador'
import DetallePago from '../components/DetallePago'
import CobroModal from '../components/CobroModal'
import ContratoModal from '../components/ContratoModal'
import { subirContratoFirmado } from '../lib/contrato'
import { COLORS, LBL, hoyPeru, fechaPe } from '../lib/lotes'
import { repartirCuotas, textoCuotas } from '../lib/cronograma'
import { soles, agruparPagos, COLS_PAGO, COLS_PAGO_NA, subirDocPago, marcarNoAplica, quitarNoAplica } from '../lib/pagos'

// cierre economico de una expropiacion (sql/50)
const COLS_CIERRE = 'expr_fecha_cierre, expr_monto_recuperado, expr_monto_devuelto, expr_saldo, expr_acuerdo_url, expr_notas, expr_cierre_at'
const tieneCierre = e => !!(e.expr_fecha_cierre || e.expr_monto_recuperado != null ||
  e.expr_monto_devuelto != null || e.expr_saldo != null || e.expr_acuerdo_url || e.expr_notas)

const r2 = n => Math.round(n * 100) / 100
const esPend = c => !c?.doc_number || c.doc_type === 'PEND' || String(c.doc_number).toUpperCase().startsWith('PEND')
const dniDe = c => c?.dni_url || c?.dni_front_url || null

function sumarMeses(fecha, n) {
  const d = new Date(fecha + 'T12:00:00')
  const dia = d.getDate()
  d.setMonth(d.getMonth() + n)
  if (d.getDate() < dia) d.setDate(0)   // 31 de enero + 1 mes = 28/29 de febrero
  return d.toISOString().slice(0, 10)
}

// Lo que le falta a una persona para firmar el contrato. Se muestra en la ficha
// para que la secretaria lo complete antes de que el cliente venga a firmar.
function faltaParaContrato(c) {
  if (!c) return []
  const f = []
  if (esPend(c)) f.push('N° de DNI')
  if (!(c.dni_url || (c.dni_front_url && c.dni_back_url))) f.push('foto del DNI')
  if (!c.address) f.push('dirección')
  if (!c.district || !c.province || !c.department) f.push('distrito / provincia / departamento')
  if (!c.civil_status) f.push('estado civil')
  if (!c.phone_valid) f.push('celular válido')
  return f
}

function Persona({ c, titulo, editable, children }) {
  if (!c) return null
  const falta = faltaParaContrato(c)
  const dni = dniDe(c)
  return (
    <div className="fl-persona">
      <p className="fl-lbl">{titulo}</p>
      <p className="fl-nombre">{c.full_name}</p>
      <p className="muted small">
        {esPend(c) ? <span className="warn">DNI pendiente</span> : `${c.doc_type || 'DNI'} ${c.doc_number}`}
        {c.phone ? <> · &#128241; {c.phone}{!c.phone_valid && <span className="bad"> (no válido)</span>}</> : <> · <span className="bad">sin celular</span></>}
        {c.phone2 ? ' · ' + c.phone2 : ''}
      </p>
      {c.address && <p className="muted small">{[c.address, c.district, c.province, c.department].filter(Boolean).join(', ')}</p>}
      {c.civil_status && <p className="muted small">Estado civil: {c.civil_status}</p>}
      <p className="small fl-links">
        {dni ? <a href={dni} target="_blank" rel="noreferrer">ver DNI</a> : <span className="bad">sin foto del DNI</span>}
        {editable && <Link to={`/clientes?cliente=${c.id}`}>&#9998; editar datos</Link>}
      </p>
      {falta.length > 0 && <p className="fl-falta">&#9888; Falta para el contrato: {falta.join(', ')}</p>}
      {children}
    </div>
  )
}

// Ficha del lote a pantalla completa: todo lo del día a día en un solo lugar
// (cliente, separación, venta, cuotas, pagos con sus documentos y lo del lote).
// Antes esto era una ventanita del mapa con otra ventana encima para el
// desglosado, y los documentos se subían desde otra pantalla (Cuotas).
export default function FichaLote() {
  const { id } = useParams()
  const irA = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') || 'resumen'   // en la URL: al volver de Cuotas se cae en la misma pestaña
  const { role, profile } = useAuth()
  const { projects, pid, select } = useProject()
  const readOnly = ['manager', 'socio'].includes(role)
  const puedeEditar = ['admin', 'secretary', 'superuser'].includes(role)
  const esAdmin = ['admin', 'superuser'].includes(role)
  const puedeCierre = esAdmin

  const [sel, setSel] = useState(null)            // el lote
  const [estado, setEstado] = useState('cargando') // cargando | ok | no
  const [detail, setDetail] = useState(null)
  const [pagos, setPagos] = useState([])
  const [naOk, setNaOk] = useState(true)          // false = sql/49 sin correr: sin "no aplica"
  const [historial, setHistorial] = useState([])
  const [ver, setVer] = useState(0)
  const reload = () => setVer(v => v + 1)
  const pidOp = sel?.project_id || null

  const [emsg, setEmsg] = useState(null)
  const [msg, setMsg] = useMsg(null)
  const [verPago, setVerPago] = useState(null)
  const [cobro, setCobro] = useState(null)   // separacion | inicial | cuota | cuadre (fase 2: se cobra aqui mismo)
  const [contrato, setContrato] = useState(null)   // id de la venta cuyo contrato se genera aqui mismo (fase 3)
  const [pagoQ, setPagoQ] = useState('')
  const [pagoFiltro, setPagoFiltro] = useState('todos')   // todos | sin_voucher | sin_comprobante

  // clientes: solo se consultan al cambiar co-comprador o titular
  const [clientes, setClientes] = useState(null)
  const [coEdit, setCoEdit] = useState(false)
  const [coSel, setCoSel] = useState('')

  // edicion normal del lote (sin estado)
  const [edit, setEdit] = useState(false)
  const [ef, setEf] = useState({})
  // cambio de estado critico (solo admin)
  const [chg, setChg] = useState(false)
  const [chgTo, setChgTo] = useState('separado')
  const [chgReason, setChgReason] = useState('')
  const [chgFile, setChgFile] = useState(null)
  const [chgBusy, setChgBusy] = useState(false)

  // ---- cuadre de migracion (SOLO superusuario): cambiar titular / consolidar lotes ----
  const [tit, setTit] = useState(false)
  const [titNew, setTitNew] = useState('')
  const [titModo, setTitModo] = useState('correccion')   // 'correccion' | 'transferencia'
  const [titReason, setTitReason] = useState('')
  const [cons, setCons] = useState(false)
  const [consDest, setConsDest] = useState('')           // venta destino (el lote que se queda)
  const [consFate, setConsFate] = useState('disponible') // que pasa con el lote que suelta
  const [consReason, setConsReason] = useState('')
  const [consOpts, setConsOpts] = useState([])           // otras ventas activas del mismo cliente
  const [uBusy, setUBusy] = useState(false)
  const [uMsg, setUMsg] = useMsg(null)

  // ---- ficha de cierre de una EXPROPIACION (admin/superusuario) ----
  const [cierre, setCierre] = useState(null)        // { exp, f } = la expropiacion que se completa
  const [cierreFile, setCierreFile] = useState(null)
  const [cierreBusy, setCierreBusy] = useState(false)
  const [cierreMsg, setCierreMsg] = useMsg(null)
  // Pago viejo que nunca se registro en una venta YA EXPROPIADA: esa plata —que
  // si entro a la empresa— no tenia por donde entrar al sistema.
  const [pagoExp, setPagoExp] = useState(null)      // { exp, cuotas, f }
  const [pagoExpFile, setPagoExpFile] = useState(null)
  const [pagoExpBusy, setPagoExpBusy] = useState(false)
  const [pagoExpMsg, setPagoExpMsg] = useMsg(null)

  // ---- CARGA: el lote, su venta viva, la separacion, cuotas, pagos e historial ----
  useEffect(() => {
    let vivo = true
    async function cargar() {
      const { data: l, error } = await supabase.from('lots').select('*').eq('id', id).maybeSingle()
      if (!vivo) return
      if (error || !l) { setEstado('no'); return }
      // venta conjunta: si el lote es parte de un grupo, la venta vive en el lote principal
      let saleLotId = l.id
      const mG = (l.associated_to || '').match(/^VENTA CONJUNTA\s+([A-Z]+-\d+(?:\+[A-Z]+-\d+)+)/)
      const grupo = mG ? mG[1].split('+') : null
      if (grupo) {
        const [pmz, plt] = grupo[0].split('-')
        const { data: prim } = await supabase.from('lots').select('id')
          .eq('project_id', l.project_id).eq('mz', pmz).eq('lt', plt).maybeSingle()
        if (prim) saleLotId = prim.id
      }
      const [{ data: sale }, { data: sps }, { data: hist }] = await Promise.all([
        supabase.from('sales')
          .select('*, client:clients!sales_client_id_fkey(*), co_client:clients!sales_co_client_id_fkey(*), advisor:advisors(code, full_name)')
          .eq('lot_id', saleLotId).in('status', ['en_proceso', 'pagado']).maybeSingle(),
        supabase.from('separations')
          .select('*, client:clients(*), advisor:advisors(code, full_name)')
          .eq('lot_id', l.id).eq('status', 'vigente')
          .order('created_at', { ascending: false }).limit(1),
        supabase.from('lot_status_changes')
          .select('new_status, previous_status, reason, document_url, changed_at')
          .eq('lot_id', l.id).order('changed_at', { ascending: false }).limit(10),
      ])
      const sep = (l.status === 'separado' || !sale) ? ((sps || [])[0] || null) : null

      // pagos de la venta viva + los de su separacion (la separacion se cobra
      // antes de que exista la venta, por eso no lleva sale_id)
      const sepIds = [...new Set([sale?.separation_id, sep?.id].filter(Boolean))]
      const filtro = [sale && `sale_id.eq.${sale.id}`, ...sepIds.map(s => `separation_id.eq.${s}`)].filter(Boolean).join(',')
      const traerPagos = async () => {
        if (!filtro) return { data: [], na: true }
        const cols = COLS_PAGO + ', separation_id, created_at'
        let res = await supabase.from('daily_income').select(cols + COLS_PAGO_NA).or(filtro).order('date').order('created_at')
        if (!res.error) return { data: res.data || [], na: true }
        res = await supabase.from('daily_income').select(cols).or(filtro).order('date')
        return { data: res.data || [], na: false }
      }
      // historial de EXPROPIACIONES de este lote: cliente original, dinero pagado
      // (perdido) y como cerro la plata (sql/50), si ya se registro.
      const traerExp = async () => {
        const COLS_EXP = 'id, sale_date, total_sale_price, initial_amount_paid, client_id, client:clients!sales_client_id_fkey(full_name, doc_number)'
        const qExp = cols => supabase.from('sales').select(cols).eq('lot_id', l.id).eq('status', 'expropiado').order('sale_date')
        let resExp = await qExp(COLS_EXP + ', ' + COLS_CIERRE)
        if (resExp.error) resExp = await qExp(COLS_EXP)   // sql/50 sin correr todavia
        const exps = resExp.data || []
        if (!exps.length) return []
        const { data: incs } = await supabase.from('daily_income').select('sale_id, amount').in('sale_id', exps.map(e => e.id))
        const pagosPorVenta = {}
        for (const p of (incs || [])) pagosPorVenta[p.sale_id] = (pagosPorVenta[p.sale_id] || 0) + Number(p.amount)
        return exps.map(e => ({ ...e, pagado: pagosPorVenta[e.id] || 0 }))
      }
      // otros lotes del mismo cliente (para saltar a ellos desde aqui)
      const traerHermanos = async () => {
        if (!sale?.client_id) return []
        const { data: os } = await supabase.from('sales')
          .select('lot:lots!inner(id, mz, lt, project_id)')
          .eq('client_id', sale.client_id).eq('lot.project_id', l.project_id).in('status', ['en_proceso', 'pagado'])
        const fuera = new Set(grupo || [`${l.mz}-${l.lt}`])
        const vistos = new Set()
        return (os || []).map(x => x.lot).filter(x => {
          const k = `${x.mz}-${x.lt}`
          if (fuera.has(k) || vistos.has(k)) return false
          vistos.add(k); return true
        })
      }
      const [instR, pagosR, expropiaciones, hermanosLotes] = await Promise.all([
        sale ? supabase.from('installments').select('id, installment_number, due_date, amount, amount_paid, status')
          .eq('sale_id', sale.id).order('installment_number') : Promise.resolve({ data: [] }),
        traerPagos(), traerExp(), traerHermanos(),
      ])
      if (!vivo) return
      const inst = instR.data || []
      // montos REALES de inicial/separación registrados en caja para esta venta
      // (cuadre del superusuario incluido), aunque sale.initial_amount_paid haya
      // quedado en 0 tras la migración.
      let iniPagado = 0, sepPagado = 0
      for (const p of pagosR.data) {
        if (!sale || p.sale_id !== sale.id) continue
        if (p.income_type === 'inicial') iniPagado += Number(p.amount)
        else if (p.income_type === 'separacion') sepPagado += Number(p.amount)
      }
      const numDe = qid => inst.find(q => q.id === qid)?.installment_number ?? 999
      const ordenados = pagosR.data.slice().sort((a, b) =>
        (a.date || '').localeCompare(b.date || '') || (numDe(a.installment_id) - numDe(b.installment_id)))
      setSel(l)
      setDetail({ sale, inst, sep, iniPagado, sepPagado, grupo, hermanosLotes, expropiaciones })
      setPagos(ordenados); setNaOk(pagosR.na)
      setHistorial(hist || [])
      setEstado('ok')
    }
    cargar()
    return () => { vivo = false }
  }, [id, ver])

  // al cambiar de lote se cierran los formularios que quedaron abiertos
  useEffect(() => {
    setEmsg(null); setEdit(false); setChg(false); setChgReason(''); setChgFile(null)
    setCoEdit(false); setVerPago(null); setPagoQ(''); setPagoFiltro('todos')
  }, [id])

  // el menú y los colores siguen al proyecto del lote (se puede llegar por enlace)
  useEffect(() => {
    if (sel?.project_id && sel.project_id !== pid && projects.some(p => p.id === sel.project_id)) select(sel.project_id)
  }, [sel?.project_id, projects])

  async function cargarClientes() {
    if (clientes) return
    const { data } = await supabase.from('clients').select('id, full_name, doc_number').order('full_name')
    setClientes(data || [])
  }

  // otras ventas ACTIVAS del mismo cliente = posibles destinos al consolidar
  useEffect(() => {
    if (!cons || !detail?.sale?.client_id) { setConsOpts([]); return }
    supabase.from('sales')
      .select('id, lot_id, client_id, lot:lots!inner(mz, lt, project_id)')
      .eq('client_id', detail.sale.client_id).eq('status', 'en_proceso').eq('lot.project_id', pidOp)
      .then(({ data }) => setConsOpts((data || []).filter(s => s.lot_id !== sel?.id)))
  }, [cons, detail, pidOp, sel])

  const logCambio = (entity, eid, details) => supabase.from('activity_log').insert({
    user_id: profile?.id, user_email: profile?.email, action: 'UPDATE', entity_type: entity, entity_id: eid,
    details: { ...details, project_id: pidOp },
  })

  // ---- CAMBIAR TITULAR (superusuario) ----
  //  correccion    = el lote SIEMPRE fue de esta persona (se registro con otro nombre por error)
  //                  -> los pagos historicos tambien se re-ligan al nuevo titular.
  //  transferencia = el lote pasa de una persona a otra -> los pagos historicos QUEDAN con el
  //                  titular anterior (mismo criterio que las expropiaciones).
  async function cambiarTitular() {
    if (!titNew) { setUMsg({ ok: false, t: 'ELIGE EL NUEVO TITULAR' }); return }
    if (titReason.trim().length < 5) { setUMsg({ ok: false, t: 'EL MOTIVO ES OBLIGATORIO' }); return }
    setUBusy(true); setUMsg(null)
    try {
      const sale = detail.sale
      const antes = sale.client?.full_name || '?'
      const despues = (clientes || []).find(c => c.id === titNew)?.full_name || '?'
      const { error } = await supabase.from('sales').update({ client_id: titNew }).eq('id', sale.id)
      if (error) throw error
      if (titModo === 'correccion') {
        const { error: e2 } = await supabase.from('daily_income').update({ client_id: titNew }).eq('sale_id', sale.id)
        if (e2) throw e2
      }
      await supabase.from('activity_log').insert({
        user_id: profile?.id, user_email: profile?.email,
        action: 'UPDATE', entity_type: 'sales', entity_id: sale.id,
        details: {
          cambio: 'cambio_titular', modo: titModo, lote: sel.mz + '-' + sel.lt,
          antes, despues, motivo: titReason.trim().toUpperCase(), project_id: pidOp,
        },
      })
      setUMsg({ ok: true, t: 'TITULAR ACTUALIZADO: ' + antes + ' → ' + despues })
      setTit(false); setTitNew(''); setTitReason(''); reload()
    } catch (e) { setUMsg({ ok: false, t: 'ERROR: ' + e.message }) }
    setUBusy(false)
  }

  // ---- CONSOLIDAR 2 LOTES EN 1 (superusuario) ----
  // El cliente suelta ESTE lote: todo lo que pago aqui se pasa al lote que se queda y se aplica
  // a sus cuotas pendientes (de la mas antigua a la mas nueva). Las cuotas de este lote se revierten.
  async function consolidar() {
    if (!consDest) { setUMsg({ ok: false, t: 'ELIGE EL LOTE QUE SE QUEDA' }); return }
    if (consReason.trim().length < 5) { setUMsg({ ok: false, t: 'EL MOTIVO ES OBLIGATORIO' }); return }
    const dest = consOpts.find(o => o.id === consDest)
    if (!dest) { setUMsg({ ok: false, t: 'DESTINO INVALIDO' }); return }
    setUBusy(true); setUMsg(null)
    try {
      const origen = detail.sale
      // 1) todo lo realmente pagado en este lote
      const { data: pays, error: e0 } = await supabase.from('daily_income').select('id, amount').eq('sale_id', origen.id)
      if (e0) throw e0
      const total = r2((pays || []).reduce((s, p) => s + Number(p.amount), 0))
      if (!total) { setUMsg({ ok: false, t: 'ESTE LOTE NO TIENE PAGOS QUE MOVER' }); setUBusy(false); return }
      // 2) revertir las cuotas del lote que se suelta
      const { error: e1 } = await supabase.from('installments').update({ amount_paid: 0, status: 'pendiente' }).eq('sale_id', origen.id)
      if (e1) throw e1
      // 3) mover cada pago al lote destino (conserva fecha/voucher/n° operacion; queda como credito de cuota)
      const nota = ('TRASPASO DESDE MZ ' + sel.mz + ' LT ' + sel.lt + ' — ' + consReason.trim().toUpperCase()).slice(0, 400)
      for (const p of (pays || [])) {
        const { error: e2 } = await supabase.from('daily_income').update({
          sale_id: dest.id, lot_id: dest.lot_id, client_id: dest.client_id,
          installment_id: null, income_type: 'cuota', observation: nota,
        }).eq('id', p.id)
        if (e2) throw e2
      }
      // 4) aplicar el total a las cuotas pendientes del destino, en orden
      const { data: pend } = await supabase.from('installments')
        .select('id, amount, amount_paid').eq('sale_id', dest.id).neq('status', 'pagado').order('installment_number')
      let rest = total
      for (const q of (pend || [])) {
        if (rest <= 0.004) break
        const deuda = r2(Number(q.amount) - Number(q.amount_paid))
        const take = Math.min(rest, deuda)
        const nuevo = r2(Number(q.amount_paid) + take)
        await supabase.from('installments').update({
          amount_paid: nuevo, status: nuevo >= Number(q.amount) - 0.004 ? 'pagado' : 'pendiente',
        }).eq('id', q.id)
        rest = r2(rest - take)
      }
      // 5) cerrar el lote que se suelta segun lo elegido
      const { error: e3 } = await supabase.from('sales').update({ status: consFate === 'expropiado' ? 'expropiado' : 'anulado' }).eq('id', origen.id)
      if (e3) throw e3
      const { error: e4 } = await supabase.from('lots').update({ status: consFate }).eq('id', sel.id)
      if (e4) throw e4
      // 6) bitacora con el motivo
      await supabase.from('activity_log').insert({
        user_id: profile?.id, user_email: profile?.email,
        action: 'UPDATE', entity_type: 'sales', entity_id: origen.id,
        details: {
          cambio: 'consolidacion_lotes', desde: sel.mz + '-' + sel.lt, hacia: dest.lot.mz + '-' + dest.lot.lt,
          monto_movido: total, sobrante: rest, lote_queda: consFate,
          motivo: consReason.trim().toUpperCase(), project_id: pidOp,
        },
      })
      alert('CONSOLIDADO: S/ ' + total.toFixed(2) + ' movido a MZ ' + dest.lot.mz + ' LT ' + dest.lot.lt +
        (rest > 0.01 ? '\n\nOJO: SOBRAN S/ ' + rest.toFixed(2) + ' (el lote destino ya quedo totalmente cubierto). Ese saldo queda a favor del cliente en la venta destino.' : ''))
      setCons(false); setConsDest(''); setConsReason('')
      reload()
    } catch (e) { setUMsg({ ok: false, t: 'ERROR: ' + e.message }) }
    setUBusy(false)
  }

  // ---- RECUADRAR CUOTAS (superusuario) ----
  // Data migrada: una cuota quedo sobrepagada (ej. 787 de 777) y otra corta (767 de 777).
  // El excedente NO corre solo a la siguiente porque cada cuota cuenta unicamente los pagos
  // ligados a ella. Esto redistribuye el TOTAL ya pagado en cuotas, en orden (1, 2, 3...),
  // sin tocar los pagos reales de caja (vouchers, fechas y montos quedan intactos).
  async function recuadrarCuotas() {
    const inst = [...detail.inst].sort((a, b) => a.installment_number - b.installment_number)
    const total = r2(inst.reduce((s, i) => s + Number(i.amount_paid), 0))
    let rest = total
    const cambios = []
    for (const q of inst) {
      const take = r2(Math.min(rest, Number(q.amount)))
      rest = r2(rest - take)
      if (take !== r2(Number(q.amount_paid))) cambios.push({ q, nuevo: take })
    }
    if (!cambios.length) { alert('LAS CUOTAS YA ESTAN BIEN DISTRIBUIDAS. No hay nada que recuadrar.'); return }
    const lineas = cambios.map(c => 'Cuota ' + c.q.installment_number + ': S/ ' + Number(c.q.amount_paid).toFixed(2) + ' → S/ ' + c.nuevo.toFixed(2)).join('\n')
    const motivo = prompt('RECUADRAR CUOTAS — se redistribuye lo ya pagado (S/ ' + total.toFixed(2) + ') en orden.\nLos pagos de caja NO se tocan.\n\nCambios:\n' + lineas + (rest > 0.01 ? '\n\nOJO: sobran S/ ' + rest.toFixed(2) + ' por encima del cronograma (queda a favor del cliente).' : '') + '\n\nMotivo del recuadre (obligatorio):')
    if (motivo === null) return
    if (motivo.trim().length < 5) { alert('MOTIVO OBLIGATORIO'); return }
    const hoyStr = new Date().toISOString().slice(0, 10)
    for (const { q, nuevo } of cambios) {
      const full = nuevo >= Number(q.amount) - 0.05
      const { error } = await supabase.from('installments').update({
        amount_paid: nuevo,
        status: full ? 'pagado' : (q.due_date < hoyStr ? 'vencido' : 'pendiente'),
      }).eq('id', q.id)
      if (error) { alert('ERROR: ' + error.message); return }
    }
    await supabase.from('activity_log').insert({
      user_id: profile?.id, user_email: profile?.email,
      action: 'UPDATE', entity_type: 'installments', entity_id: detail.sale.id,
      details: {
        cambio: 'recuadre_cuotas', lote: sel.mz + '-' + sel.lt, cliente: detail.sale.client?.full_name || null,
        total_redistribuido: total, cambios: cambios.map(c => ({ cuota: c.q.installment_number, antes: Number(c.q.amount_paid), despues: c.nuevo })),
        motivo: motivo.trim().toUpperCase(), project_id: pidOp,
      },
    })
    alert('CUOTAS RECUADRADAS (' + cambios.length + ' corregidas). MOTIVO EN BITACORA.')
    reload()
  }

  // ---- CIERRE DE UNA EXPROPIACION (admin/superusuario) ----
  // La expropiacion se ejecuta el dia que se firma, pero la plata se cierra despues:
  // cuanto entro, cuanto se devolvio y con que saldo quedo. Esta ficha se completa
  // cuando se sepa, sin tocar los pagos historicos del cliente.
  function abrirCierre(exp) {
    setCierreMsg(null); setCierreFile(null)
    setCierre({
      exp,
      f: {
        sale_date: exp.sale_date || '',
        total_sale_price: exp.total_sale_price ?? '',
        expr_fecha_cierre: exp.expr_fecha_cierre || '',
        expr_monto_recuperado: exp.expr_monto_recuperado ?? '',
        expr_monto_devuelto: exp.expr_monto_devuelto ?? '',
        expr_saldo: exp.expr_saldo ?? '',
        expr_notas: exp.expr_notas || '',
      },
    })
  }

  async function guardarCierre(e) {
    e.preventDefault()
    const { exp, f } = cierre
    const num = v => (v === '' || v === null || v === undefined ? null : r2(Number(v)))
    const rec = num(f.expr_monto_recuperado), dev = num(f.expr_monto_devuelto), sal = num(f.expr_saldo)
    if ([rec, dev].some(v => v !== null && (!Number.isFinite(v) || v < 0))) {
      setCierreMsg({ ok: false, t: 'LOS MONTOS RECUPERADO Y DEVUELTO NO PUEDEN SER NEGATIVOS.' }); return
    }
    if (sal !== null && !Number.isFinite(sal)) { setCierreMsg({ ok: false, t: 'SALDO INVALIDO.' }); return }
    const precio = num(f.total_sale_price)
    if (!(precio > 0)) { setCierreMsg({ ok: false, t: 'EL PRECIO DE LA VENTA DEBE SER MAYOR A CERO.' }); return }
    for (const [k, lbl] of [['sale_date', 'fecha de venta'], ['expr_fecha_cierre', 'fecha de cierre']]) {
      if (f[k] && !/^\d{4}-\d{2}-\d{2}$/.test(f[k])) { setCierreMsg({ ok: false, t: 'REVISA LA ' + lbl.toUpperCase() + ' (AAAA-MM-DD).' }); return }
    }
    if (!f.sale_date) { setCierreMsg({ ok: false, t: 'LA FECHA DE VENTA NO PUEDE QUEDAR VACIA.' }); return }
    setCierreBusy(true); setCierreMsg(null)
    try {
      let acuerdoUrl = exp.expr_acuerdo_url || null
      if (cierreFile) acuerdoUrl = await upload(`expropiaciones/${exp.id}`, cierreFile)
      const payload = {
        sale_date: f.sale_date, total_sale_price: precio,
        expr_fecha_cierre: f.expr_fecha_cierre || null,
        expr_monto_recuperado: rec, expr_monto_devuelto: dev, expr_saldo: sal,
        expr_acuerdo_url: acuerdoUrl, expr_notas: (f.expr_notas || '').trim().toUpperCase() || null,
        expr_cierre_at: new Date().toISOString(), expr_cierre_by: profile?.id || null,
      }
      const { error } = await supabase.from('sales').update(payload).eq('id', exp.id)
      if (error) throw error
      await logCambio('sales', exp.id, {
        cambio: 'cierre_expropiacion', lote: sel.mz + '-' + sel.lt,
        cliente: exp.client?.full_name || null, pagado_por_el_cliente: exp.pagado,
        antes: {
          fecha_venta: exp.sale_date, precio: exp.total_sale_price,
          recuperado: exp.expr_monto_recuperado ?? null, devuelto: exp.expr_monto_devuelto ?? null,
          saldo: exp.expr_saldo ?? null, fecha_cierre: exp.expr_fecha_cierre || null,
        },
        despues: {
          fecha_venta: payload.sale_date, precio: payload.total_sale_price,
          recuperado: rec, devuelto: dev, saldo: sal, fecha_cierre: payload.expr_fecha_cierre,
        },
        acuerdo_firmado: !!acuerdoUrl, notas: payload.expr_notas,
      })
      setCierreMsg({ ok: true, t: 'CIERRE GUARDADO (QUEDA EN BITACORA)' })
      savedFx()
      setCierre(null); setCierreFile(null)
      reload()
    } catch (err) {
      setCierreMsg({ ok: false, t: 'ERROR: ' + (err.message || err) + (String(err.message || '').includes('expr_') ? ' — ¿falta correr sql/50?' : '') })
    }
    setCierreBusy(false)
  }

  // ---- BORRAR EL CIERRE ECONOMICO (admin/superusuario) ----
  // El cierre es una ANOTACION del acuerdo, no plata en caja. Si lo que se anoto
  // ahi en realidad fue un pago del cliente, ese pago se registra como pago (y
  // suma), y el cierre tiene que irse: si no, la misma plata queda contada dos
  // veces. Lo borrado va integro a la bitacora —incluido el enlace al acuerdo—
  // por si hay que reponerlo; el archivo en R2 no se toca.
  async function borrarCierre() {
    const { exp } = cierre
    if (!confirm('BORRAR EL CIERRE ECONOMICO de ' + (exp.client?.full_name || 'este cliente') + '?\n\n'
      + 'Se borran fecha, montos, saldo, notas y el enlace al acuerdo firmado.\n'
      + 'Los PAGOS del cliente NO se tocan.\n\nTodo queda en bitacora.')) return
    setCierreBusy(true); setCierreMsg(null)
    try {
      const { error } = await supabase.from('sales').update({
        expr_fecha_cierre: null, expr_monto_recuperado: null, expr_monto_devuelto: null,
        expr_saldo: null, expr_acuerdo_url: null, expr_notas: null,
        expr_cierre_at: null, expr_cierre_by: null,
      }).eq('id', exp.id)
      if (error) throw error
      await logCambio('sales', exp.id, {
        cambio: 'borrar_cierre_expropiacion', lote: sel.mz + '-' + sel.lt,
        cliente: exp.client?.full_name || null, pagado_por_el_cliente: exp.pagado,
        borrado: {
          fecha_cierre: exp.expr_fecha_cierre || null,
          recuperado: exp.expr_monto_recuperado ?? null,
          devuelto: exp.expr_monto_devuelto ?? null,
          saldo: exp.expr_saldo ?? null,
          acuerdo_url: exp.expr_acuerdo_url || null,
          notas: exp.expr_notas || null,
        },
      })
      setCierreMsg({ ok: true, t: 'CIERRE BORRADO (QUEDA EN BITACORA)' })
      savedFx()
      setCierre(null); setCierreFile(null)
      reload()
    } catch (err) { setCierreMsg({ ok: false, t: 'ERROR: ' + (err.message || err) }) }
    setCierreBusy(false)
  }

  // ---- PAGO QUE FALTO REGISTRAR EN UNA VENTA EXPROPIADA (admin/superusuario) ----
  // El lote se expropio, pero despues aparece un voucher del cliente que nunca se
  // subio. Esa plata ENTRO de verdad: tiene que sumar en lo pagado y en la caja,
  // no anotarse como "dinero que entro al cerrar" (eso es del acuerdo, otra cosa).
  async function abrirPagoExp(exp) {
    setPagoExpMsg(null); setPagoExpFile(null)
    setPagoExp({
      exp, cuotas: null,
      f: { date: '', amount: '', operation_number: '', operation_type: 'TRANSFERENCIA', installment_id: '', observation: '' },
    })
    // el cronograma de la venta expropiada sigue existiendo: si el pago era de una
    // cuota concreta se puede enganchar ahi y la cuota queda saldada.
    const { data } = await supabase.from('installments')
      .select('id, installment_number, amount, amount_paid, due_date')
      .eq('sale_id', exp.id).order('installment_number')
    setPagoExp(p => (p && p.exp.id === exp.id ? { ...p, cuotas: data || [] } : p))
  }

  async function guardarPagoExp(ev) {
    ev.preventDefault()
    const { exp, f } = pagoExp
    const monto = r2(Number(f.amount))
    if (!(monto > 0)) { setPagoExpMsg({ ok: false, t: 'EL MONTO DEBE SER MAYOR A CERO.' }); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) { setPagoExpMsg({ ok: false, t: 'REVISA LA FECHA DEL PAGO (AAAA-MM-DD).' }); return }
    const motivo = (f.observation || '').trim()
    if (motivo.length < 5) { setPagoExpMsg({ ok: false, t: 'ESCRIBE DE DONDE SALE ESTE PAGO (OBLIGATORIO, QUEDA EN BITACORA).' }); return }
    const cuota = (pagoExp.cuotas || []).find(q => q.id === f.installment_id) || null
    if (cuota && monto > Number(cuota.amount) - Number(cuota.amount_paid) + 0.01) {
      setPagoExpMsg({ ok: false, t: 'EL MONTO PASA LO QUE DEBE LA CUOTA ' + cuota.installment_number + '. DEJA "NINGUNA CUOTA" O CORRIGE EL MONTO.' }); return
    }
    setPagoExpBusy(true); setPagoExpMsg(null)
    try {
      const op = (f.operation_number || 'SIN-REF').toUpperCase()
      const voucherUrl = pagoExpFile ? await upload(`vouchers/${op.replace(/[^A-Z0-9-]/g, '')}`, pagoExpFile) : null
      const { error } = await supabase.from('daily_income').insert({
        project_id: pidOp, lot_id: sel.id, client_id: exp.client_id || null, sale_id: exp.id,
        installment_id: cuota?.id || null,
        date: f.date, amount: monto,
        operation_number: op, operation_type: f.operation_type,
        income_type: cuota ? 'cuota' : 'otro',
        observation: ('PAGO DE VENTA EXPROPIADA REGISTRADO A MANO | ' + motivo.toUpperCase()).slice(0, 400),
        origin: 'sistema', voucher_url: voucherUrl,
        registered_by: profile?.id || null, approved: true, approved_at: new Date().toISOString(),
      })
      if (error) throw error
      await logCambio('daily_income', exp.id, {
        cambio: 'pago_venta_expropiada', lote: sel.mz + '-' + sel.lt,
        cliente: exp.client?.full_name || null,
        monto, fecha: f.date, operacion: op, cuota: cuota?.installment_number || null,
        pagado_antes: exp.pagado, pagado_despues: r2(Number(exp.pagado) + monto),
        motivo: motivo.toUpperCase(), voucher: !!voucherUrl,
      })
      setPagoExpMsg({ ok: true, t: 'PAGO REGISTRADO. YA SUMA EN LO PAGADO Y EN LA CAJA.' })
      savedFx()
      setPagoExp(null); setPagoExpFile(null)
      reload()
    } catch (err) {
      setPagoExpMsg({ ok: false, t: 'ERROR: ' + (err.message || err) })
    }
    setPagoExpBusy(false)
  }

  // ---- GENERAR EL CRONOGRAMA DE UNA VENTA QUE NO LO TIENE ----
  // De la migracion de Neshuya quedaron 10 ventas sin cronograma: el contrato era
  // un escaneo con sellos notariales encima y no se pudo leer la tabla de cuotas.
  // Esto arma el cronograma completo de una sola vez, con la misma cuenta que usa
  // la pantalla de Cuotas al registrar una venta nueva.
  async function generarCronograma() {
    const sale = detail.sale
    if (detail.inst.length) { alert('Esta venta YA tiene cronograma. Para corregirlo usa las columnas de cada cuota.'); return }
    const precio = Number(sale.total_sale_price || 0)
    // si el campo contractual vino en 0 de la migracion, vale lo realmente pagado
    // en caja (cuadres incluidos)
    const inicial = Number(sale.initial_amount_paid || 0) || Number(detail.iniPagado || 0)
    const sepAmt = Number(detail.sep?.amount || 0) || Number(detail.sepPagado || 0)
    const financiado = r2(precio - inicial - sepAmt)
    if (!(financiado > 0)) { alert('No hay saldo por financiar: precio S/ ' + precio + ' menos inicial S/ ' + inicial + (sepAmt ? ' y separacion S/ ' + sepAmt : '') + '.\n\nSi el lote se pago al contado, esta venta no lleva cronograma.'); return }
    const mesesStr = prompt('GENERAR EL CRONOGRAMA DE ESTA VENTA\n\n'
      + 'Precio:      S/ ' + precio.toLocaleString('es-PE') + '\n'
      + 'Inicial:     S/ ' + inicial.toLocaleString('es-PE') + (sepAmt ? '\nSeparacion:  S/ ' + sepAmt.toLocaleString('es-PE') : '') + '\n'
      + 'A financiar: S/ ' + financiado.toLocaleString('es-PE') + '\n\n'
      + '¿En cuantas cuotas? (mira el contrato):', String(sale.installments_count || 48))
    if (mesesStr === null) return
    const meses = parseInt(mesesStr)
    if (!meses || meses < 1 || meses > 120) { alert('Numero de cuotas invalido (1 a 120).'); return }
    // cuotas redondeadas a 10 centimos y la ultima menor (lib/cronograma)
    const montos = repartirCuotas(financiado, meses)
    const cuotaAprox = montos[0]
    const fecha1 = prompt('Fecha de vencimiento de la CUOTA 1 (AAAA-MM-DD).\n\n'
      + 'Las demas se generan mes a mes desde esa fecha.\n'
      + 'Saldrian ' + textoCuotas(montos) + ':', '')
    if (fecha1 === null) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha1)) { alert('Fecha invalida. Escribela asi: 2026-09-30'); return }
    const motivo = prompt('¿De donde salen estos datos? (obligatorio, queda en bitacora)\nEj: contrato fisico MZ A LT 19 firmado el 12/05/2026')
    if (!motivo || motivo.trim().length < 5) { alert('MOTIVO OBLIGATORIO'); return }
    if (!confirm('Se crearan ' + textoCuotas(montos)
      + '\nDesde el ' + fecha1 + ' hasta el ' + sumarMeses(fecha1, meses - 1)
      + '\n\nLos pagos ya registrados NO se tocan.\n\n¿Confirmar?')) return

    const hoyStr = new Date().toISOString().slice(0, 10)
    const filas = montos.map((monto, i) => {
      const vence = sumarMeses(fecha1, i)
      return { sale_id: sale.id, installment_number: i + 1, amount: monto, amount_paid: 0, due_date: vence, status: vence < hoyStr ? 'vencido' : 'pendiente' }
    })
    const { error } = await supabase.from('installments').insert(filas)
    if (error) { alert('ERROR: ' + error.message); return }
    await supabase.from('sales').update({ installments_count: meses, monthly_amount: cuotaAprox, financed_amount: financiado }).eq('id', sale.id).then(() => {}, () => {})
    await logCambio('installments', sale.id, {
      cambio: 'generar_cronograma', lote: sel.mz + '-' + sel.lt,
      cuotas: meses, financiado, cuota: cuotaAprox, desde: fecha1, hasta: sumarMeses(fecha1, meses - 1),
      motivo: motivo.trim().toUpperCase(),
    })
    alert('✅ CRONOGRAMA CREADO: ' + meses + ' cuotas por S/ ' + financiado.toLocaleString('es-PE')
      + '.\n\nRevisa que la cuota 1 y la ultima coincidan con el contrato.')
    reload()
  }

  // ---- INSERTAR CUOTA FALTANTE (superusuario) ----
  // Migración con hueco (ej. falta la 11). Crea solo esa cuota; NO toca las demás.
  async function insertarCuota() {
    const sale = detail.sale
    const nums = detail.inst.map(i => i.installment_number)
    const max = nums.length ? Math.max(...nums) : 0
    const faltan = []
    for (let i = 1; i <= max; i++) if (!nums.includes(i)) faltan.push(i)
    const sug = faltan[0] || (max + 1)
    const nStr = prompt('N° de la cuota a CREAR' + (faltan.length ? '  (faltan: ' + faltan.join(', ') + ')' : '  (no hay huecos; se agregaría al final)') + ':', String(sug))
    if (nStr === null) return
    const n = parseInt(nStr)
    if (!n || n < 1 || n > 120) { alert('N° inválido (1-120).'); return }
    if (nums.includes(n)) { alert('La cuota ' + n + ' ya existe. Para corregirla usa las columnas del cronograma.'); return }
    const refMonto = detail.inst.find(i => i.installment_number > 1)?.amount || detail.inst[0]?.amount || sale.monthly_amount || ''
    const montoStr = prompt('Monto de la cuota ' + n + ' (S/):', String(refMonto))
    if (montoStr === null) return
    const monto = Number(montoStr)
    if (!(monto > 0)) { alert('Monto inválido.'); return }
    const fecha = prompt('Fecha de vencimiento de la cuota ' + n + ' (AAAA-MM-DD):', '')
    if (fecha === null) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { alert('Fecha inválida. Ej: 2025-11-30'); return }
    const motivo = prompt('Motivo (obligatorio):')
    if (!motivo || motivo.trim().length < 5) { alert('MOTIVO OBLIGATORIO'); return }
    const hoyStr = new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('installments').insert({
      sale_id: sale.id, installment_number: n, amount: monto, amount_paid: 0,
      due_date: fecha, status: fecha < hoyStr ? 'vencido' : 'pendiente',
    })
    if (error) { alert('ERROR: ' + error.message); return }
    await logCambio('installments', sale.id, { cambio: 'insertar_cuota', lote: sel.mz + '-' + sel.lt, cuota: n, monto, vence: fecha, motivo: motivo.trim().toUpperCase() })
    alert('CUOTA ' + n + ' CREADA (S/ ' + monto.toFixed(2) + ', vence ' + fecha + '). MOTIVO EN BITÁCORA.')
    reload()
  }

  // ---- CAMBIAR MONTO DESDE UNA CUOTA (superusuario) ----
  // Se conserva todo lo ya pactado/pagado antes de la cuota elegida. El nuevo
  // importe se replica hasta la penultima cuota y la ultima absorbe el ajuste
  // de centavos para que el cronograma siga sumando exactamente lo financiado.
  async function editarMontoCuotasDesde(q) {
    const inst = [...detail.inst].sort((a, b) => a.installment_number - b.installment_number)
    const inicio = inst.findIndex(i => i.id === q.id)
    const ultima = inst.length - 1
    if (inicio < 0 || ultima < 1) { alert('SE NECESITAN AL MENOS DOS CUOTAS PARA HACER ESTE AJUSTE.'); return }
    if (inicio === ultima) { alert('LA ULTIMA CUOTA SE CALCULA SOLA PARA CUADRAR EL SALDO. Elige una cuota anterior.'); return }

    const afectadas = inst.slice(inicio)
    if (afectadas.some(i => i.status === 'pagado')) {
      alert('NO SE PUEDE CAMBIAR ESTE TRAMO PORQUE INCLUYE CUOTAS YA PAGADAS. Elige una cuota posterior a la ultima pagada.')
      return
    }

    const montoStr = prompt(
      'Nuevo monto fijo desde la cuota ' + q.installment_number + ' hasta la ' + inst[ultima - 1].installment_number + ' (S/).\n\n' +
      'La cuota ' + inst[ultima].installment_number + ' se calculara automaticamente para cuadrar el saldo:',
      Number(q.amount).toFixed(2),
    )
    if (montoStr === null) return
    const monto = r2(Number(String(montoStr).replace(',', '.')))
    if (!(monto > 0)) { alert('MONTO INVALIDO.'); return }

    const fijos = inst.slice(inicio, ultima)
    const minimoFijo = Math.max(...fijos.map(i => Number(i.amount_paid || 0)))
    if (monto < minimoFijo - 0.004) {
      alert('EL MONTO NO PUEDE SER MENOR A LO YA PAGADO EN UNA CUOTA DEL TRAMO (S/ ' + minimoFijo.toFixed(2) + ').')
      return
    }

    const antes = inst.slice(0, inicio).reduce((s, i) => s + Number(i.amount), 0)
    // La ultima cuota se calcula contra el PRECIO DEL CONTRATO restando TODO lo
    // que no es cuota: la inicial y la separacion. En las ventas migradas de
    // Excel sales.financed_amount vino mal (habia ventas con financed_amount =
    // precio, sin restar la inicial). Si el campo contractual quedo en 0 por la
    // migracion, se usa lo realmente pagado en caja (cuadres incluidos).
    const precio = Number(detail.sale.total_sale_price || 0)
    const inicial = Number(detail.sale.initial_amount_paid || 0) || Number(detail.iniPagado || 0)
    const separacion = Number(detail.sep?.amount || 0) || Number(detail.sepPagado || 0)
    const objetivo = r2(precio - inicial - separacion)
    const finViejo = r2(Number(detail.sale.financed_amount || 0))
    const montoFinal = r2(objetivo - antes - monto * fijos.length)
    const cuotaFinal = inst[ultima]
    if (montoFinal <= 0) {
      alert('ESE MONTO DEJA LA ULTIMA CUOTA EN S/ ' + montoFinal.toFixed(2) + '. Usa un monto menor para que el cronograma cuadre.')
      return
    }
    if (montoFinal < Number(cuotaFinal.amount_paid || 0) - 0.004) {
      alert('ESE MONTO DEJA LA ULTIMA CUOTA (S/ ' + montoFinal.toFixed(2) + ') POR DEBAJO DE LO QUE YA SE PAGO (S/ ' + Number(cuotaFinal.amount_paid).toFixed(2) + ').')
      return
    }

    const motivo = prompt('Motivo del cambio de cuotas (obligatorio):')
    if (motivo === null) return
    if (motivo.trim().length < 5) { alert('MOTIVO OBLIGATORIO'); return }
    const resumen = 'Cuotas ' + q.installment_number + ' a ' + fijos[fijos.length - 1].installment_number + ': S/ ' + monto.toFixed(2) +
      ' cada una. Cuota ' + cuotaFinal.installment_number + ': S/ ' + montoFinal.toFixed(2) + '.'
    const cuadre = 'EL CUADRE COMPLETO:\n'
      + '  Precio del contrato:  S/ ' + precio.toFixed(2) + '\n'
      + '  − Inicial:            S/ ' + inicial.toFixed(2) + '\n'
      + (separacion ? '  − Separacion:         S/ ' + separacion.toFixed(2) + '\n' : '')
      + '  = Va en cuotas:       S/ ' + objetivo.toFixed(2)
      + (Math.abs(objetivo - finViejo) > 0.01 ? '\n  ⚠ El campo "financiado" decia S/ ' + finViejo.toFixed(2) + ' (venia mal de la migracion): se corrige tambien.' : '')
    if (!confirm('CAMBIAR CRONOGRAMA\n\n' + resumen + '\n\n' + cuadre + '\n\nNo se modifican pagos registrados.\nMotivo: ' + motivo.trim().toUpperCase() + '\n\nConfirmar?')) return

    const idsFijos = fijos.map(i => i.id)
    const { error: e1 } = await supabase.from('installments').update({ amount: monto }).in('id', idsFijos)
    if (e1) { alert('ERROR: ' + e1.message); return }
    const { error: e2 } = await supabase.from('installments').update({ amount: montoFinal }).eq('id', cuotaFinal.id)
    if (e2) { alert('ERROR: ' + e2.message); return }
    // financed_amount se alinea con el contrato (precio − inicial − separacion):
    // el resto del panel suma contra ese campo y debe contar la misma historia.
    const { error: e3 } = await supabase.from('sales').update({ monthly_amount: monto, financed_amount: objetivo }).eq('id', detail.sale.id)
    if (e3) { alert('ERROR: ' + e3.message); return }
    await logCambio('installments', detail.sale.id, {
      cambio: 'monto_cuotas_desde', lote: sel.mz + '-' + sel.lt,
      desde_cuota: q.installment_number, hasta_cuota: fijos[fijos.length - 1].installment_number,
      monto_fijo: monto, cuota_ajuste: cuotaFinal.installment_number, monto_cuota_ajuste: montoFinal,
      precio, inicial, separacion, financiado: objetivo,
      financiado_antes: finViejo !== objetivo ? finViejo : undefined,
      motivo: motivo.trim().toUpperCase(),
    })
    alert('CRONOGRAMA ACTUALIZADO. ' + resumen + ' MOTIVO REGISTRADO EN BITACORA.')
    reload()
  }

  // ---- EDITAR FECHA DE VENCIMIENTO de una cuota (superusuario) ----
  async function editarVence(q) {
    const nueva = prompt('Nueva fecha de VENCIMIENTO de la cuota ' + q.installment_number + ' (AAAA-MM-DD):', q.due_date || '')
    if (nueva === null) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nueva)) { alert('Formato inválido. Ej: 2025-11-30'); return }
    if (nueva === q.due_date) return
    const hoyStr = new Date().toISOString().slice(0, 10)
    // no se re-vence una cuota ya pagada; si no, se recalcula por la fecha nueva
    const status = q.status === 'pagado' ? 'pagado' : (nueva < hoyStr ? 'vencido' : 'pendiente')
    const { error } = await supabase.from('installments').update({ due_date: nueva, status }).eq('id', q.id)
    if (error) { alert('ERROR: ' + error.message); return }
    await logCambio('installments', detail.sale.id, { cambio: 'vence_cuota', lote: sel.mz + '-' + sel.lt, cuota: q.installment_number, antes: q.due_date, despues: nueva })
    reload()
  }

  // ---- EDITAR "PAGADA EL": la fecha del pago que cubrió la cuota (superusuario) ----
  async function editarPagadaEl(q) {
    const { data: pays } = await supabase.from('daily_income').select('id, date').eq('installment_id', q.id).order('date')
    if (!pays?.length) { alert('Esta cuota no tiene un pago registrado con fecha para editar.'); return }
    const ultimo = pays[pays.length - 1]
    const nueva = prompt('Fecha en que se PAGÓ la cuota ' + q.installment_number + ' (AAAA-MM-DD):', ultimo.date || '')
    if (nueva === null) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nueva)) { alert('Formato inválido. Ej: 2025-11-30'); return }
    const { error } = await supabase.from('daily_income').update({ date: nueva }).eq('id', ultimo.id)
    if (error) { alert('ERROR: ' + error.message); return }
    await logCambio('daily_income', ultimo.id, { cambio: 'fecha_pago_cuota', lote: sel.mz + '-' + sel.lt, cuota: q.installment_number, antes: ultimo.date, despues: nueva })
    reload()
  }

  // ---- EDITAR fecha de ENTREGA / de VENTA del lote (superusuario) ----
  async function editarFechaLote(campo, label, actual, tabla, eid) {
    const nueva = prompt('Nueva ' + label + ' (AAAA-MM-DD)' + (campo === 'delivered_at' ? ', vacío para quitarla' : '') + ':', actual || '')
    if (nueva === null) return
    const val = nueva.trim()
    if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) { alert('Formato inválido. Ej: 2025-11-30'); return }
    if (!val && campo !== 'delivered_at') { alert('Esta fecha no puede quedar vacía.'); return }
    const { error } = await supabase.from(tabla).update({ [campo]: val || null }).eq('id', eid)
    if (error) { alert('ERROR: ' + error.message); return }
    await logCambio(tabla, eid, { cambio: campo, lote: sel.mz + '-' + sel.lt, antes: actual || null, despues: val || null })
    reload()
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
    setEmsg('LOTE ACTUALIZADO'); savedFx()
    setEdit(false); reload()
  }

  // cambio de estado con burocracia
  const docObligatorio = ['expropiado', 'invadido'].includes(chgTo)
  async function cambiarEstado(e) {
    e.preventDefault()
    if (detail?.sep && chgTo === 'disponible') {
      const limG = detail.sep.extended_until || detail.sep.expiration_date
      const vencG = limG && limG < new Date().toISOString().slice(0, 10)
      setEmsg('ERROR: ESTE LOTE TIENE UNA SEPARACION ' + (vencG ? 'VENCIDA' : 'VIGENTE') + '. RESUELVELA EN EL RESUMEN CON "EXTENDER PLAZO" O "MARCAR PERDIDA", NO CON CAMBIO DE ESTADO.')
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
      setEmsg('ESTADO CAMBIADO A ' + chgTo.toUpperCase()); savedFx()
      setChg(false); setChgReason(''); setChgFile(null)
      reload()
    } catch (err) { setEmsg('ERROR: ' + err.message) }
    setChgBusy(false)
  }

  async function borrarLote() {
    if (sel.status !== 'disponible') return
    if (!confirm('Eliminar el lote Mz ' + sel.mz + ' Lt ' + sel.lt + '? Solo se permite si esta DISPONIBLE.')) return
    const { error } = await supabase.from('lots').delete().eq('id', sel.id).eq('status', 'disponible')
    if (error) { setEmsg('NO SE PUDO ELIMINAR: TIENE SEPARACIONES, VENTAS O PAGOS HISTORICOS ASOCIADOS.'); return }
    irA('/lotes', { replace: true })
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
    setEmsg('SEPARACION EXTENDIDA HASTA ' + nueva + ' (QUEDA EN BITACORA)'); savedFx()
    reload()
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
    setEmsg('SEPARACION MARCADA COMO PERDIDA — LOTE DISPONIBLE OTRA VEZ'); savedFx()
    reload()
  }

  async function toggleCobranza() {
    const nuevoVal = detail.sale.auto_cobranza === false
    if (!confirm(nuevoVal
      ? 'Reactivar los avisos automaticos de cobranza para esta venta?'
      : 'Pausar los avisos automaticos de cobranza para esta venta (por ejemplo, mientras dure un acuerdo de pago)?\n\nNo le llega ningun recordatorio ni aviso de pago vencido hasta que se reactive. Si el cliente escribe al numero de cobranzas, el agente igual le responde.')) return
    const { error } = await supabase.from('sales').update({ auto_cobranza: nuevoVal }).eq('id', detail.sale.id)
    if (error) { setEmsg('ERROR: ' + error.message); return }
    setEmsg(nuevoVal ? 'COBRANZA AUTOMATICA REACTIVADA' : 'COBRANZA AUTOMATICA DESACTIVADA')
    reload()
  }

  async function guardarCo() {
    if (!coSel) return
    const { error } = await supabase.from('sales').update({ co_client_id: coSel === 'QUITAR' ? null : coSel }).eq('id', detail.sale.id)
    if (error) { setEmsg('ERROR: ' + error.message); return }
    setEmsg('CO-COMPRADOR ACTUALIZADO'); savedFx(); setCoSel(''); setCoEdit(false)
    reload()
  }

  async function ajustarPrecio() {
    const sale = detail.sale
    const nuevo = Number(prompt('AJUSTE DE PRECIO DE ESTA VENTA (solo admin).\n\nPrecio actual: S/ ' + sale.total_sale_price + '\nNuevo precio total:'))
    if (!nuevo || isNaN(nuevo) || nuevo <= 0) return
    const motivo = prompt('Motivo del ajuste (obligatorio):')
    if (!motivo || motivo.trim().length < 5) { alert('MOTIVO OBLIGATORIO'); return }
    const sepAmt = r2(Number(sale.total_sale_price) - Number(sale.initial_amount_paid) - Number(sale.financed_amount))
    const pagadoCuotas = detail.inst.reduce((x, i) => x + Number(i.amount_paid), 0)
    const pendientes = detail.inst.filter(i => i.status !== 'pagado')
    const restante = r2(nuevo - Number(sale.initial_amount_paid) - sepAmt - pagadoCuotas)
    if (restante < 0) { alert('EL NUEVO PRECIO ES MENOR A LO YA PAGADO. NO PROCEDE.'); return }
    if (!pendientes.length) { alert('NO HAY CUOTAS PENDIENTES PARA REDISTRIBUIR.'); return }
    if (!confirm(`Nuevo precio: S/ ${nuevo}\nYa pagado: S/ ${(Number(sale.initial_amount_paid) + sepAmt + pagadoCuotas).toFixed(2)}\nSaldo a repartir en ${pendientes.length} cuotas: S/ ${restante.toFixed(2)} (aprox S/ ${(restante / pendientes.length).toFixed(2)} c/u)\n\nMOTIVO: ${motivo}\n\nConfirmar?`)) return
    const share = Math.floor(restante / pendientes.length * 100) / 100
    let acum = 0
    for (let i = 0; i < pendientes.length; i++) {
      const q = pendientes[i]
      const extra = i === pendientes.length - 1 ? r2(restante - acum) : share
      acum += extra
      await supabase.from('installments').update({ amount: r2(Number(q.amount_paid) + extra) }).eq('id', q.id)
    }
    await supabase.from('sales').update({
      total_sale_price: nuevo,
      financed_amount: r2(nuevo - Number(sale.initial_amount_paid) - sepAmt),
      monthly_amount: share,
    }).eq('id', sale.id)
    alert('PRECIO AJUSTADO. MOTIVO REGISTRADO EN BITACORA: ' + motivo.toUpperCase())
    reload()
  }

  // ---- el contrato firmado, desde la tarjeta de la venta ----
  async function subirFirmado(file) {
    try {
      const t = await subirContratoFirmado({ ...detail.sale, lot: sel }, file)
      if (!t) return
      setMsg({ ok: true, t }); savedFx(); reload()
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + err.message }) }
  }

  // ---- documentos de un pago desde la pestaña de pagos ----
  async function subirDoc(row, file, campo) {
    try {
      const t = await subirDocPago(row, file, campo, naOk)
      if (!t) return
      setMsg({ ok: true, t }); reload()
    } catch (err) { setMsg({ ok: false, t: err.message }) }
  }
  async function noAplica(filas, campo, marcar) {
    const r = marcar
      ? await marcarNoAplica(filas, campo, { email: profile?.email, pidOp })
      : await quitarNoAplica(filas, campo, { email: profile?.email, pidOp })
    if (!r) return
    setMsg(r)
    if (r.ok) reload()
  }

  // ---- numeros de la venta, calculados en vivo ----
  const hoy = hoyPeru()
  const resumen = useMemo(() => {
    if (!detail?.sale) return null
    const s = detail.sale
    const inst = detail.inst
    const pagCuotas = inst.reduce((x, i) => x + Number(i.amount_paid), 0)
    const sepDeriv = Math.max(0, r2(Number(s.total_sale_price) - Number(s.initial_amount_paid) - Number(s.financed_amount)))
    // prefiere el monto REAL registrado en caja (incluye el cuadre del superusuario)
    const iniReal = detail.iniPagado > 0 ? detail.iniPagado : Number(s.initial_amount_paid)
    const sepReal = detail.sepPagado > 0 ? detail.sepPagado : sepDeriv
    const pagado = r2(pagCuotas + iniReal + sepReal)
    const saldo = r2(Number(s.total_sale_price) - pagado)
    const pct = Number(s.total_sale_price) > 0 ? (pagado / Number(s.total_sale_price) * 100) : 0
    const debe = q => r2(Number(q.amount) - Number(q.amount_paid))
    // "vencida" EN VIVO (como el mapa): fecha pasada + no pagada + con saldo
    const vencida = q => q.status !== 'pagado' && q.due_date < hoy && debe(q) > 2
    const vencidas = inst.filter(vencida)
    const deudaVencida = r2(vencidas.reduce((x, q) => x + debe(q), 0))
    const pagadas = inst.filter(q => q.status === 'pagado').length
    const proxima = inst.find(q => q.status !== 'pagado' && debe(q) > 0.009) || null
    // EL CUADRE DEL CRONOGRAMA: inicial + separacion + todas las cuotas tiene
    // que dar exactamente el precio. La migracion dejo ventas donde no da.
    const sumaCuotas = r2(inst.reduce((x, i) => x + Number(i.amount), 0))
    const totalPlan = r2(iniReal + sepReal + sumaCuotas)
    const dif = r2(totalPlan - Number(s.total_sale_price))
    return { pagCuotas, iniReal, sepReal, pagado, saldo, pct, vencida, vencidas, deudaVencida, pagadas, proxima, debe, sumaCuotas, totalPlan, dif }
  }, [detail, hoy])

  const sepInfo = useMemo(() => {
    const sep = detail?.sep
    if (!sep) return null
    const lim = sep.extended_until || sep.expiration_date
    const vencida = lim && lim < hoy
    const dias = lim ? Math.round((new Date(lim + 'T12:00:00') - new Date(hoy + 'T12:00:00')) / 86400000) : null
    return { sep, lim, vencida, dias }
  }, [detail, hoy])

  const grupos = useMemo(() => agruparPagos(pagos)
    .sort((a, b) => (b.referencia.date || '').localeCompare(a.referencia.date || '')), [pagos])
  const faltaVoucher = grupos.filter(g => !g.voucherUrl && !g.voucherNA).length
  const faltaComprobante = grupos.filter(g => !g.comprobanteUrl && !g.comprobanteNA).length
  const gruposVista = useMemo(() => {
    const terms = pagoQ.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return grupos.filter(g => {
      if (pagoFiltro === 'sin_voucher' && (g.voucherUrl || g.voucherNA)) return false
      if (pagoFiltro === 'sin_comprobante' && (g.comprobanteUrl || g.comprobanteNA)) return false
      if (!terms.length) return true
      const r = g.referencia
      const heno = [r.date || '', fechaPe(r.date), g.concepto, r.operation_number || '', r.account?.name || '',
        g.items.map(p => p.observation || '').join(' '), String(g.total)].join(' ').toLowerCase()
      return terms.every(w => heno.includes(w))
    })
  }, [grupos, pagoQ, pagoFiltro])

  const proyecto = projects.find(p => p.id === sel?.project_id)

  function waMessage() {
    const { sale } = detail
    const next = resumen?.proxima
    const name = sale.client?.full_name?.split(' ')[0] || 'CLIENTE'
    let texto = `Hola *${sale.client?.full_name}*, le saludamos de Urbis Group\n`
    texto += `Lote *Mz ${sel.mz} Lt ${sel.lt}*${proyecto ? ' - ' + proyecto.name : ''}\n\n`
    if (resumen?.vencidas.length) texto += `Tiene *${resumen.vencidas.length} cuota(s) vencida(s)* por S/ ${resumen.deudaVencida.toFixed(2)}.\n`
    if (next) {
      const falta = resumen.debe(next)
      texto += `Proxima cuota: N ${next.installment_number}, ${falta < Number(next.amount) ? 'le falta S/ ' + falta.toFixed(2) : 'de S/ ' + Number(next.amount).toFixed(2)}, vence el ${fechaPe(next.due_date)}.\n`
    }
    texto += `\nPuede pagar por transferencia o deposito. Gracias ${name}!`
    const phone = (sale.client?.phone || '').replace(/\D/g, '')
    return `https://wa.me/${phone.startsWith('51') || phone.startsWith('52') || phone.startsWith('1') ? phone : '51' + phone}?text=${encodeURIComponent(texto)}`
  }

  const volver = () => (location.state?.desdeMapa ? irA(-1) : irA('/lotes'))

  // Celda de VOUCHER / COMPROBANTE: el documento, el boton para subirlo o la
  // marca "no aplica" cuando ese pago no va a tener documento.
  function celdaDoc(g, campo) {
    const esVoucher = campo === 'voucher_url'
    const url = esVoucher ? g.voucherUrl : g.comprobanteUrl
    const na = esVoucher ? g.voucherNA : g.comprobanteNA
    const motivo = esVoucher ? g.voucherNAMotivo : g.comprobanteNAMotivo
    const falta = esVoucher ? g.voucherFaltante : g.comprobanteFaltante
    if (url) return <><a href={url} target="_blank" rel="noreferrer">VER</a>{falta && <span className="warn small"> + falta</span>}</>
    if (na) return (
      <span className="st-chip st-na" title={'NO APLICA' + (motivo ? ' — ' + motivo : '')}>
        no aplica
        {!readOnly && <button className="link-btn" style={{ marginLeft: 4, fontSize: 11 }}
          title="Volver a pedir este documento" onClick={() => noAplica(g.items, campo, false)}>&#8634;</button>}
      </span>
    )
    if (readOnly) return <span className="bad small">falta</span>
    return (
      <>
        <label className={'upload-btn ' + (esVoucher ? 'warn' : 'bad')}>{esVoucher ? '⬆ subir' : '⚠ subir'}
          <input type="file" accept="image/*,.pdf" hidden
            onChange={e => e.target.files[0] && subirDoc(g.referencia, e.target.files[0], campo)} />
        </label>
        {naOk && <button className="link-btn" style={{ display: 'block', fontSize: 10, marginTop: 2 }}
          title="Este pago nunca va a tener este documento (cascada, cuadre, canje). Se pide el motivo."
          onClick={() => noAplica(g.items, campo, true)}>no aplica</button>}
      </>
    )
  }

  if (estado === 'no') return (
    <div className="glass fl-vacio">
      <p>No encontré este lote, o no tienes acceso a su proyecto.</p>
      <p><Link className="btn-primary btn-link" to="/lotes">Ir al mapa de lotes</Link></p>
    </div>
  )
  if (!sel || !detail) return <p className="muted">Cargando la ficha del lote…</p>

  const sale = detail.sale
  const cobrar = !readOnly
  const tabs = [
    ['resumen', 'Resumen'],
    sale && ['cuotas', `Cuotas (${detail.inst.length})`, resumen?.vencidas.length ? `${resumen.vencidas.length} vencida${resumen.vencidas.length > 1 ? 's' : ''}` : null],
    (sale || detail.sep || pagos.length > 0) && ['pagos', `Pagos y documentos (${grupos.length})`, !readOnly && (faltaVoucher + faltaComprobante) ? `${faltaVoucher + faltaComprobante} por subir` : null],
    ['lote', 'Lote e historial', detail.expropiaciones.length ? `${detail.expropiaciones.length} exprop.` : null],
  ].filter(Boolean)
  const tabActiva = tabs.some(t => t[0] === tab) ? tab : 'resumen'
  const setTab = t => setSearchParams(t === 'resumen' ? {} : { tab: t }, { replace: true })

  return (
    <div className="fl">
      {/* ---- cabecera: que lote es, en que estado esta y un buscador para saltar a otro ---- */}
      <div className="fl-top">
        <button className="btn-ghost" onClick={volver} title="Volver al mapa de lotes">&#8592; Mapa</button>
        <div className="fl-titulo">
          <h1>Mz {sel.mz} · Lt {sel.lt}
            <span className="badge" style={{ background: COLORS[sel.status] }}>{LBL[sel.status] || sel.status}</span>
            {resumen?.vencidas.length > 0 && <span className="st-chip st-per">{resumen.vencidas.length} cuota{resumen.vencidas.length > 1 ? 's' : ''} vencida{resumen.vencidas.length > 1 ? 's' : ''}</span>}
            {sale?.status === 'pagado' && <span className="st-chip st-ok">PAGADO 100%</span>}
          </h1>
          <p className="muted small">
            {proyecto?.name || ''} · {Number(sel.area_m2)} m² · {sale ? 'precio de venta' : 'precio lista'} <b>{soles(sale ? sale.total_sale_price : sel.total_price)}</b>
            {detail.grupo && <> · venta conjunta {detail.grupo.join(' + ')}</>}
          </p>
        </div>
        <div className="fl-buscar"><BuscarLote placeholder="Ir a otro lote: G7, nombre, DNI…" /></div>
      </div>

      {/* ---- lo que se puede hacer con este lote AHORA, segun su estado ---- */}
      <div className="fl-acciones">
        {cobrar && sel.status === 'disponible' && !detail.sep && (<>
          <button className="btn-primary" onClick={() => setCobro('separacion')}>&#10133; Separar</button>
          <button className="btn-act" onClick={() => setCobro('inicial')}>&#128181; Vender directo (inicial)</button>
        </>)}
        {cobrar && detail.sep && !sale && (sepInfo?.vencida
          ? <span className="fl-aviso bad">&#128274; Separación vencida: el administrador debe extender el plazo o marcarla perdida antes de cobrar la inicial.</span>
          : <button className="btn-primary" onClick={() => setCobro('inicial')}>&#128181; Cobrar inicial</button>)}
        {cobrar && sale?.status === 'en_proceso' && ['vendido', 'entregado'].includes(sel.status) &&
          <button className="btn-primary" onClick={() => setCobro('cuota')}>&#128181; Cobrar cuota</button>}
        {sale && (sale.client?.phone_valid
          ? <a className="btn-act" href={waMessage()} target="_blank" rel="noreferrer">&#128172; WhatsApp de cobro</a>
          : <span className="fl-aviso warn">Celular no válido: corrígelo en los datos del cliente</span>)}
        {sale && <EstadoCuentaDownload key={sale.id} cliente={sale.client || {}} saleId={sale.id} />}
        {sale && <button className="btn-act alt" onClick={() => setContrato(sale.id)}>&#128196; Generar contrato</button>}
      </div>

      {emsg && <p className={emsg.startsWith('ERROR') || emsg.startsWith('NO SE') ? 'error' : 'ok'} style={{ margin: '0 0 10px' }}>{emsg}</p>}
      {msg && <p className={msg.ok ? 'ok' : 'error'} style={{ margin: '0 0 10px' }}>{msg.t}</p>}

      {/* ---- los numeros que se miran siempre ---- */}
      {resumen ? (
        <div className="fl-kpis">
          <div className="glass fl-kpi"><span>Pagado</span><b className="ok">{soles(resumen.pagado)}</b><small>{resumen.pct.toFixed(1)}% de {soles(sale.total_sale_price)}</small>
            <div className="fl-barra"><i style={{ width: Math.min(100, resumen.pct) + '%' }} /></div></div>
          <div className="glass fl-kpi"><span>Saldo</span><b className={resumen.saldo > 0.009 ? 'warn' : 'ok'}>{soles(resumen.saldo)}</b><small>{sale.status === 'pagado' ? 'venta pagada' : 'por cobrar'}</small></div>
          <div className="glass fl-kpi"><span>Cuotas</span><b>{resumen.pagadas} / {detail.inst.length}</b>
            <small>{resumen.vencidas.length ? <span className="bad">{resumen.vencidas.length} vencida{resumen.vencidas.length > 1 ? 's' : ''} · {soles(resumen.deudaVencida)}</span> : detail.inst.length ? 'al día' : 'sin cronograma'}</small></div>
          <div className="glass fl-kpi"><span>Próxima cuota</span>
            {resumen.proxima
              ? <><b>{soles(resumen.debe(resumen.proxima))}</b><small>N° {resumen.proxima.installment_number} · vence {fechaPe(resumen.proxima.due_date)}</small></>
              : <><b className="ok">—</b><small>{detail.inst.length ? 'no quedan cuotas' : 'sin cronograma'}</small></>}</div>
        </div>
      ) : sepInfo ? (
        <div className="fl-kpis">
          <div className="glass fl-kpi"><span>Separación</span><b>{soles(sepInfo.sep.amount)}</b><small>el {fechaPe(sepInfo.sep.date)}</small></div>
          <div className="glass fl-kpi"><span>Vence</span><b className={sepInfo.vencida ? 'bad' : sepInfo.dias <= 2 ? 'warn' : 'ok'}>{fechaPe(sepInfo.lim)}</b>
            <small>{sepInfo.vencida ? 'VENCIDA' : sepInfo.dias === 0 ? 'vence HOY' : sepInfo.dias + ' día(s) restante(s)'}</small></div>
          <div className="glass fl-kpi"><span>Precio lista</span><b>{soles(sel.total_price)}</b><small>inicial sugerida {soles(sel.initial_payment_default)}</small></div>
        </div>
      ) : (
        <div className="fl-kpis">
          <div className="glass fl-kpi"><span>Precio lista</span><b>{soles(sel.total_price)}</b><small>{Number(sel.area_m2)} m² × {soles(sel.price_per_m2)}</small></div>
          <div className="glass fl-kpi"><span>Inicial sugerida</span><b>{soles(sel.initial_payment_default)}</b><small>se puede cambiar al cobrar</small></div>
        </div>
      )}

      {/* ---- pestañas ---- */}
      <div className="fl-tabs" role="tablist">
        {tabs.map(([k, lbl, nota]) => (
          <button key={k} role="tab" aria-selected={tabActiva === k} className={`fl-tab ${tabActiva === k ? 'on' : ''}`} onClick={() => setTab(k)}>
            {lbl}{nota && <span className="fl-tab-nota">{nota}</span>}
          </button>
        ))}
      </div>

      {/* ======================= RESUMEN ======================= */}
      {tabActiva === 'resumen' && (
        <div className="fl-grid">
          {sale && (
            <div className="glass fl-card">
              <h3>&#128100; Cliente</h3>
              <Persona c={sale.client} titulo="Titular" editable={puedeEditar} />
              {sale.co_client
                ? <Persona c={sale.co_client} titulo="Co-comprador" editable={puedeEditar} />
                : <p className="muted small">Sin co-comprador.</p>}
              {puedeEditar && (coEdit ? (
                <div className="fl-co">
                  <Buscador opciones={[{ id: 'QUITAR', label: '(QUITAR CO-COMPRADOR)' }, ...(clientes || []).filter(c => c.id !== sale.client_id).map(c => ({ id: c.id, label: c.full_name, sub: c.doc_number || '' }))]}
                    valor={coSel} onChange={setCoSel} placeholder={clientes ? 'Busca por nombre o DNI…' : 'Cargando clientes…'} />
                  <button className="btn-ghost" onClick={guardarCo} disabled={!coSel}>Guardar</button>
                  <button className="btn-ghost" onClick={() => { setCoEdit(false); setCoSel('') }}>Cancelar</button>
                </div>
              ) : (
                <button className="link-btn" onClick={() => { setCoEdit(true); cargarClientes() }}>{sale.co_client ? 'cambiar co-comprador' : '+ agregar co-comprador'}</button>
              ))}
              {detail.hermanosLotes.length > 0 && (
                <p className="small" style={{ marginTop: 8 }}>&#127968; También tiene:{' '}
                  {detail.hermanosLotes.map(h => <Link key={h.id} className="lote-chip" style={{ marginRight: 4 }} to={`/lotes/${h.id}`}>{h.mz}-{h.lt}</Link>)}
                </p>
              )}
            </div>
          )}

          {sepInfo && (
            <div className="glass fl-card">
              <h3>&#128278; Separación vigente</h3>
              <Persona c={sepInfo.sep.client} titulo="Separó" editable={puedeEditar} />
              <dl className="fl-dl">
                <dt>Monto</dt><dd>{soles(sepInfo.sep.amount)}</dd>
                <dt>Fecha</dt><dd>{fechaPe(sepInfo.sep.date)}</dd>
                <dt>Vence</dt><dd><b>{fechaPe(sepInfo.lim)}</b>{sepInfo.sep.extended_until && <span className="muted small"> (extendida; original {fechaPe(sepInfo.sep.expiration_date)})</span>}{' '}
                  {sepInfo.vencida
                    ? <span className="st-chip st-per">VENCIDA</span>
                    : sepInfo.dias !== null && <span className={sepInfo.dias <= 2 ? 'warn' : 'ok'}>({sepInfo.dias === 0 ? 'vence HOY' : sepInfo.dias + ' día(s)'})</span>}</dd>
                {sepInfo.sep.advisor?.code && <><dt>Asesor</dt><dd>{sepInfo.sep.advisor.code}{sepInfo.sep.advisor.full_name && sepInfo.sep.advisor.full_name !== sepInfo.sep.advisor.code ? ' - ' + sepInfo.sep.advisor.full_name : ''}</dd></>}
              </dl>
              {sepInfo.vencida && <p className="error">&#128274; LOTE BLOQUEADO: no se puede vender ni liberar hasta que el administrador decida — extender el plazo o marcar perdida.</p>}
              {esAdmin && (
                <p className="acc-row">
                  <button className="btn-ghost" onClick={extenderSep}>&#8987; Extender plazo</button>
                  <button className="btn-ghost" style={{ color: '#ff8e7a', borderColor: 'rgba(255,142,122,.5)' }} onClick={perdidaSep}>&#10060; Marcar perdida (libera el lote)</button>
                </p>
              )}
            </div>
          )}

          {sale && (
            <div className="glass fl-card">
              <h3>&#127991; Venta</h3>
              <dl className="fl-dl">
                <dt>Fecha de venta</dt><dd>{fechaPe(sale.sale_date)}
                  {role === 'superuser' && <button className="fecha-edit" style={{ marginLeft: 6 }} onClick={() => editarFechaLote('sale_date', 'fecha de venta', sale.sale_date, 'sales', sale.id)} title="Corregir fecha de venta">&#9998;</button>}</dd>
                <dt>Precio</dt><dd><b>{soles(sale.total_sale_price)}</b></dd>
                <dt>Separación</dt><dd>{soles(resumen.sepReal)}</dd>
                <dt>Inicial</dt><dd>{soles(resumen.iniReal)}</dd>
                <dt>Financiado</dt><dd>{soles(sale.financed_amount)} en {sale.installments_count} cuotas{sale.monthly_amount ? ' de ~' + soles(sale.monthly_amount) : ''}</dd>
                <dt>Asesor</dt><dd>{sale.advisor?.code || '—'}</dd>
                <dt>Contrato</dt><dd>
                  {sale.signed_contract_url
                    ? <a href={sale.signed_contract_url} target="_blank" rel="noreferrer">ver contrato firmado</a>
                    : <span className="warn">sin contrato firmado</span>}
                  {/* el firmado se sube aqui mismo; reemplazar uno ya subido queda para el superusuario */}
                  {puedeEditar && (!sale.signed_contract_url || role === 'superuser') && (
                    <label className="upload-btn" style={{ marginLeft: 8 }}>{sale.signed_contract_url ? 'reemplazar' : '⬆ subir firmado'}
                      <input type="file" accept="image/*,.pdf" hidden onChange={e => e.target.files[0] && subirFirmado(e.target.files[0])} />
                    </label>
                  )}
                  {sale.contract_note && <div className="muted small" style={{ textTransform: 'none' }}>{sale.contract_note}</div>}
                </dd>
                <dt>Cobranza automática</dt><dd>
                  {sale.auto_cobranza !== false
                    ? <span className="st-chip st-ok">ACTIVA</span>
                    : <span className="st-chip st-per">PAUSADA (acuerdo de pago / gestión humana)</span>}
                  {puedeEditar && <> <button className="link-btn" onClick={toggleCobranza}>{sale.auto_cobranza === false ? 'reactivar' : 'pausar'}</button></>}
                </dd>
              </dl>
              {detail.grupo && <p className="hint small">&#128279; VENTA CONJUNTA de {detail.grupo.join(' + ')}. La venta y las cuotas se registran en el lote principal <b>{detail.grupo[0]}</b> y valen para todo el grupo.</p>}
              {(esAdmin && sale.status === 'en_proceso') || role === 'superuser' ? (
                <div className="fl-admin">
                  <p className="fl-lbl">Administración</p>
                  <p className="acc-row">
                    {esAdmin && sale.status === 'en_proceso' && <button className="btn-ghost" onClick={ajustarPrecio}>Ajustar precio de la venta</button>}
                    {/* corregir/transferir el titular vale tambien en ventas PAGADAS (un nombre mal
                        escrito se corrige igual) y en ventas conjuntas (aplica a todo el grupo). */}
                    {role === 'superuser' && <button className="btn-ghost" onClick={() => { setUMsg(null); setTitNew(''); setTitReason(''); setTitModo('correccion'); setTit(true); cargarClientes() }}>&#128100; Cambiar titular</button>}
                    {/* consolidar solo tiene sentido con una venta activa: mueve plata a cuotas pendientes */}
                    {role === 'superuser' && sale.status === 'en_proceso' &&
                      <button className="btn-ghost" onClick={() => { setUMsg(null); setConsDest(''); setConsReason(''); setConsFate('disponible'); setCons(true) }}>&#128260; Consolidar en otro lote</button>}
                  </p>
                </div>
              ) : null}
            </div>
          )}

          {!sale && !detail.sep && (
            <div className="glass fl-card">
              <h3>&#127793; Lote sin cliente</h3>
              {sel.status === 'disponible'
                ? <p>Este lote está <b>disponible</b>. {cobrar ? 'Para reservarlo usa "Separar"; si el cliente paga la inicial de una vez, "Vender directo".' : ''}</p>
                : <p className="muted">Sin venta activa registrada.</p>}
              {detail.expropiaciones.length > 0 && <p className="hint small">&#9888; Este lote fue expropiado {detail.expropiaciones.length} {detail.expropiaciones.length > 1 ? 'veces' : 'vez'}. El detalle está en "Lote e historial".</p>}
            </div>
          )}
        </div>
      )}

      {/* ======================= CUOTAS ======================= */}
      {tabActiva === 'cuotas' && sale && (
        <div className="glass fl-panel">
          <p>
            <span className="muted">Precio:</span> <b>{soles(sale.total_sale_price)}</b> · <span className="muted">Separación:</span> {soles(resumen.sepReal)} · <span className="muted">Inicial:</span> {soles(resumen.iniReal)} · <span className="muted">Cuotas pagadas:</span> {soles(resumen.pagCuotas)} · <span className="muted">TOTAL PAGADO:</span> <b style={{ color: '#7ec8a0' }}>{soles(resumen.pagado)}</b> · <span className="muted">SALDO:</span> <b className={resumen.saldo > 0 ? 'warn' : 'ok'}>{soles(resumen.saldo)}</b>
          </p>
          {detail.inst.length > 0 && (Math.abs(resumen.dif) <= 0.05
            ? <p className="ok" style={{ fontSize: 12, margin: '2px 0 0' }}>✓ EL CRONOGRAMA CUADRA: inicial {soles(resumen.iniReal)}{resumen.sepReal > 0 ? ' + separación ' + soles(resumen.sepReal) : ''} + {detail.inst.length} cuotas {soles(resumen.sumaCuotas)} = {soles(resumen.totalPlan)}, igual al precio.</p>
            : <p className="warn" style={{ fontSize: 12, margin: '2px 0 0' }}>
                ⚠ <b>EL CRONOGRAMA NO CUADRA:</b> inicial {soles(resumen.iniReal)}{resumen.sepReal > 0 ? ' + separación ' + soles(resumen.sepReal) : ''} + {detail.inst.length} cuotas {soles(resumen.sumaCuotas)} = <b>{soles(resumen.totalPlan)}</b>, y el precio es {soles(sale.total_sale_price)} → <b>{soles(Math.abs(resumen.dif))} {resumen.dif > 0 ? 'DE MÁS (el cliente pagaría encima del precio)' : 'DE MENOS (faltaría cobrar)'}</b>.
                {role === 'superuser' ? ' Revisa el contrato y corrige con MONTO en la primera cuota impaga: la última se recalcula sola.' : ' Avisa al superusuario.'}
              </p>)}
          <div className="acc-row" style={{ margin: '10px 0 6px' }}>
            {detail.inst.length === 0 && sale.status === 'en_proceso' && puedeEditar && (
              <button className="btn-act" onClick={generarCronograma}
                title="Esta venta no tiene cuotas. Crea el cronograma completo desde el contrato.">&#128197; Generar cronograma</button>
            )}
            {role === 'superuser' && (<>
              <button className="btn-ghost" style={{ fontSize: 12 }} title="Redistribuye lo ya pagado entre las cuotas, en orden. Corrige cuotas sobrepagadas/cortas de la migracion sin tocar los pagos de caja."
                onClick={recuadrarCuotas}>&#9878; Recuadrar cuotas</button>
              <button className="btn-ghost" style={{ fontSize: 12 }} title="Registrar una inicial o separación que no se cargó en la migración, sobre esta venta. No crea venta ni toca el cronograma."
                onClick={() => setCobro('cuadre')}>&#9998; Cuadre inicial / separación</button>
              <button className="btn-ghost" style={{ fontSize: 12 }} title="Crear una cuota que faltó en la migración (ej. la 11). No toca las demás."
                onClick={insertarCuota}>&#10133; Insertar cuota faltante</button>
            </>)}
          </div>
          {role === 'superuser' && <p className="muted" style={{ fontSize: 10, margin: '0 0 4px' }}>💡 Superusuario: haz clic en <b>VENCE</b>, <b>MONTO</b> o <b>PAGADA EL</b> para corregir. En MONTO, el nuevo importe se aplica desde esa cuota y la última se ajusta para cuadrar.</p>}
          <div className="table-wrap fl-tabla">
            <table>
              <thead><tr><th>N°</th><th>Vence</th><th>Monto</th><th>Pagado</th><th>Debe</th><th>Estado</th><th>Pagada el</th></tr></thead>
              <tbody>
                {(() => {
                  const sepPagos = pagos.filter(p => (p.income_type || '') === 'separacion')
                  const iniPagos = pagos.filter(p => (p.income_type || '') === 'inicial')
                  const sepAmt = Math.max(0, r2(Number(sale.total_sale_price) - Number(sale.initial_amount_paid) - Number(sale.financed_amount)))
                  const mkRow = (key, label, fecha, monto) => (
                    <tr key={key} className="fl-fila-ini">
                      <td><b>{label}</b></td><td>{fecha ? fechaPe(fecha) : '- (sin fecha)'}</td>
                      <td>{soles(monto)}</td><td>{soles(monto)}</td><td>—</td>
                      <td><span className="ok">&#9679; PAGADO</span></td><td>{fecha ? fechaPe(fecha) : '-'}</td>
                    </tr>
                  )
                  // cada pago real de separación/inicial (incluye el cuadre); si no hay
                  // ninguno registrado, cae al monto derivado/campo de la venta.
                  const rows = []
                  if (sepPagos.length) sepPagos.forEach((p, k) => rows.push(mkRow('sep' + k, 'SEPARACIÓN', p.date, p.amount)))
                  else if (sepAmt > 0) rows.push(mkRow('sep', 'SEPARACIÓN', null, sepAmt))
                  if (iniPagos.length) iniPagos.forEach((p, k) => rows.push(mkRow('ini' + k, 'INICIAL', p.date, p.amount)))
                  else if (Number(sale.initial_amount_paid) > 0) rows.push(mkRow('ini', 'INICIAL', null, sale.initial_amount_paid))
                  return rows
                })()}
                {detail.inst.map(q => {
                  const pagadaEl = (() => { const ps = pagos.filter(p => p.installment_id === q.id).map(p => p.date).filter(Boolean).sort(); return ps.length ? ps[ps.length - 1] : null })()
                  const sup = role === 'superuser'
                  const venc = resumen.vencida(q)
                  const esProx = resumen.proxima?.id === q.id
                  const est = q.status === 'pagado' ? 'pagado' : venc ? 'vencido' : 'pendiente'
                  return (
                    <tr key={q.id} className={esProx ? 'fl-fila-prox' : venc ? 'fl-fila-venc' : ''}>
                      <td>{q.installment_number}{esProx && <span className="fl-prox">próxima</span>}</td>
                      <td>{sup
                        ? <button className="fecha-edit" onClick={() => editarVence(q)} title="Corregir vencimiento">{fechaPe(q.due_date)} <span>&#9998;</span></button>
                        : fechaPe(q.due_date)}</td>
                      <td>{sup
                        ? <button className="fecha-edit" onClick={() => editarMontoCuotasDesde(q)} title="Cambiar el monto desde esta cuota">{soles(q.amount)} <span>&#9998;</span></button>
                        : soles(q.amount)}</td>
                      <td>{soles(q.amount_paid)}</td>
                      <td>{resumen.debe(q) > 0.009 ? soles(resumen.debe(q)) : '—'}</td>
                      <td><span className={est === 'pagado' ? 'ok' : est === 'vencido' ? 'bad' : 'warn'}>&#9679; {est.toUpperCase()}</span></td>
                      <td>{sup && pagadaEl
                        ? <button className="fecha-edit" onClick={() => editarPagadaEl(q)} title="Corregir fecha de pago">{fechaPe(pagadaEl)} <span>&#9998;</span></button>
                        : (pagadaEl ? fechaPe(pagadaEl) : '-')}</td>
                    </tr>
                  )
                })}
                {/* TOTAL de verdad: las columnas sumadas una a una, a la vista.
                    Contra este total se compara el precio en el aviso de arriba. */}
                {detail.inst.length > 0 && (
                  <tr className="fl-fila-total">
                    <td colSpan="2">TOTAL EN CUOTAS ({detail.inst.length})</td>
                    <td>{soles(resumen.sumaCuotas)}</td>
                    <td>{soles(resumen.pagCuotas)}</td>
                    <td>{soles(r2(resumen.sumaCuotas - resumen.pagCuotas))}</td>
                    <td colSpan="2" className="muted" style={{ fontWeight: 400, fontSize: 11 }}>+ inicial y separación = lo que paga el cliente</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ======================= PAGOS Y DOCUMENTOS ======================= */}
      {tabActiva === 'pagos' && (
        <div className="glass fl-panel">
          <p className="muted small" style={{ margin: '0 0 8px' }}>
            Cada fila es <b>un pago real</b> (un depósito), por el monto exacto del voucher. Aquí mismo se sube el
            <b> voucher del cliente</b> y el <b>comprobante</b> (boleta o factura SUNAT). Clic en el concepto para ver los documentos.
          </p>
          <div className="filtros">
            <input className="search fx-search" style={{ textTransform: 'none' }}
              placeholder="Buscar: fecha (15/06/2026), N° operación, cuota, monto…"
              value={pagoQ} onChange={e => setPagoQ(e.target.value)} />
            {[['todos', `Todos (${grupos.length})`], ['sin_voucher', `Falta voucher (${faltaVoucher})`], ['sin_comprobante', `Falta comprobante (${faltaComprobante})`]].map(([k, l]) => (
              <button key={k} className={`chip ${pagoFiltro === k ? 'on' : ''}`} style={{ margin: 0 }} onClick={() => setPagoFiltro(k)}>{l}</button>
            ))}
            {(pagoQ || pagoFiltro !== 'todos') && <button className="fx-clear" onClick={() => { setPagoQ(''); setPagoFiltro('todos') }}>✕ Limpiar</button>}
          </div>
          {!grupos.length && <p className="muted">Sin pagos registrados.</p>}
          {!!grupos.length && !gruposVista.length && <p className="muted">Ningún pago coincide con el filtro.</p>}
          {!!gruposVista.length && (
            <div className="table-wrap fl-tabla">
              <table>
                <thead><tr><th>Fecha</th><th>Concepto</th><th style={{ textAlign: 'right' }}>Monto</th><th>N° operación</th><th>Banco</th><th>Voucher</th><th>Comprobante</th></tr></thead>
                <tbody>
                  {gruposVista.map(g => {
                    const r = g.referencia
                    return (
                      <tr key={g.key}>
                        <td style={{ whiteSpace: 'nowrap' }}>{fechaPe(r.date)}</td>
                        <td><button className="link-btn" title="Ver los documentos de este pago" onClick={() => setVerPago(r)}>{g.concepto}</button>
                          {g.items.length > 1 && <span className="muted small"> ({g.items.length} aplic.)</span>}
                          {r.observation && <div className="muted small fl-obs">{r.observation}</div>}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><b>{soles(g.total)}</b></td>
                        <td style={{ textTransform: 'none' }}>{r.operation_number}</td>
                        <td>{r.account?.name || '-'}</td>
                        <td>{celdaDoc(g, 'voucher_url')}</td>
                        <td>{celdaDoc(g, 'receipt_url')}</td>
                      </tr>
                    )
                  })}
                  <tr className="fl-fila-total">
                    <td colSpan="2">{gruposVista.length === grupos.length ? `TOTAL EN ${grupos.length} PAGOS` : `FILTRADO: ${gruposVista.length} de ${grupos.length} pagos`}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{soles(gruposVista.reduce((x, g) => x + g.total, 0))}</td>
                    <td colSpan="4" />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ======================= LOTE E HISTORIAL ======================= */}
      {tabActiva === 'lote' && (
        <div className="fl-grid">
          <div className="glass fl-card">
            <h3>&#128205; Datos del lote</h3>
            <dl className="fl-dl">
              <dt>Área</dt><dd>{sel.area_m2} m²</dd>
              <dt>Precio por m²</dt><dd>{soles(sel.price_per_m2)}</dd>
              <dt>Precio lista</dt><dd>{soles(sel.total_price)}</dd>
              <dt>Inicial sugerida</dt><dd>{soles(sel.initial_payment_default)}</dd>
              {sel.associated_to && <><dt>Asociado a</dt><dd>{sel.associated_to}</dd></>}
              {sel.boundaries?.medidas && <><dt>Medidas</dt><dd>{Object.entries(sel.boundaries.medidas).map(([k, v]) => `${k} ${v}`).join(' | ')}</dd></>}
              {sel.status === 'entregado' && <><dt>Entregado el</dt><dd><b>{sel.delivered_at ? fechaPe(sel.delivered_at) : '- (sin fecha)'}</b>
                {role === 'superuser' && <button className="fecha-edit" style={{ marginLeft: 6 }} onClick={() => editarFechaLote('delivered_at', 'fecha de entrega', sel.delivered_at, 'lots', sel.id)} title="Corregir fecha de entrega">&#9998;</button>}</dd></>}
            </dl>
            {sel.status === 'eliminado' && <p className="hint" style={{ color: '#c9cbd0', margin: '4px 0' }}>
              &#9888; Este lote está marcado como <b>ELIMINADO</b>: no existe en el terreno y no cuenta en el
              total del proyecto. Se conserva únicamente porque tiene ventas y pagos reales asociados.</p>}
            {puedeEditar && (!edit ? (
              <p className="acc-row">
                <button className="btn-ghost" onClick={() => { setEdit(true); setChg(false); setEf({ area_m2: sel.area_m2, price_per_m2: sel.price_per_m2, associated_to: sel.associated_to || '', initial_payment_default: sel.initial_payment_default }) }}>Editar datos</button>
                {esAdmin && <button className="btn-ghost" onClick={() => { setChg(!chg); setEdit(false) }}>Cambiar estado (admin)</button>}
                {role === 'superuser' && sel.status === 'disponible' && (
                  <button className="btn-ghost" style={{ color: '#ff8e7a', borderColor: 'rgba(255,142,122,.5)' }} onClick={borrarLote}>🗑 Eliminar lote</button>
                )}
              </p>
            ) : (
              <form className="form-grid" onSubmit={guardarEdicion}>
                <label>Área m² <input type="number" step="0.01" value={ef.area_m2} onChange={e => setEf(f => ({ ...f, area_m2: e.target.value }))} required /></label>
                <label>Precio por m² <input type="number" step="0.01" value={ef.price_per_m2} onChange={e => setEf(f => ({ ...f, price_per_m2: e.target.value }))} required /></label>
                <label>Inicial sugerida S/ <input type="number" step="0.01" value={ef.initial_payment_default} onChange={e => setEf(f => ({ ...f, initial_payment_default: e.target.value }))} /></label>
                <label>Asociado a <input value={ef.associated_to} onChange={e => setEf(f => ({ ...f, associated_to: e.target.value }))} /></label>
                <div className="span2">
                  <button className="btn-primary">Guardar</button>{' '}
                  <button type="button" className="btn-ghost" onClick={() => setEdit(false)}>Cancelar</button>
                </div>
              </form>
            ))}
            {chg && esAdmin && (
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
                {chgTo === 'expropiado' && sale &&
                  <p className="warn">&#9888; La venta activa de {sale.client?.full_name} pasara a EXPROPIADA.</p>}
                <button className="btn-primary" disabled={chgBusy}>{chgBusy ? 'Procesando...' : 'Confirmar cambio de estado'}</button>
              </form>
            )}
          </div>

          <div className="glass fl-card">
            <h3>&#128203; Historial de estados</h3>
            {!historial.length && <p className="muted small">Sin cambios de estado registrados.</p>}
            {historial.map((h, i) => (
              <p key={i} className="small">
                <span className="muted">{new Date(h.changed_at).toLocaleDateString('es-PE')}:</span> {h.previous_status} &#8594; <b>{h.new_status}</b> — {h.reason}
                {h.document_url && <> | <a href={h.document_url} target="_blank" rel="noreferrer">DOC</a></>}
              </p>
            ))}
          </div>

          {detail.expropiaciones.length > 0 && (() => {
            const exps = detail.expropiaciones
            const totalExp = exps.reduce((s, e) => s + Number(e.pagado), 0)
            const totalRec = exps.reduce((s, e) => s + Number(e.expr_monto_recuperado || 0), 0)
            const totalDev = exps.reduce((s, e) => s + Number(e.expr_monto_devuelto || 0), 0)
            const conCierre = exps.filter(tieneCierre).length
            return (
              <div className="glass fl-card fl-ancho" style={{ borderLeft: '3px solid #c39ce0' }}>
                <h3 style={{ color: '#c39ce0' }}>&#9888; Historial de expropiaciones ({exps.length})</h3>
                <p><span className="muted">Pagado por los clientes:</span> <b style={{ color: '#c39ce0' }}>{soles(totalExp)}</b>
                  {totalRec > 0 && <> · <span className="muted">recuperado al cerrar:</span> <b className="ok">{soles(totalRec)}</b></>}
                  {totalDev > 0 && <> · <span className="muted">devuelto:</span> <b className="warn">{soles(totalDev)}</b></>}
                </p>
                {conCierre < exps.length && (
                  <p className="muted small" style={{ margin: '0 0 4px' }}>
                    {exps.length - conCierre} de {exps.length} {exps.length - conCierre === 1 ? 'expropiación' : 'expropiaciones'} sin cierre económico registrado
                    {puedeCierre ? ' — complétalo en la columna CIERRE.' : '.'}
                  </p>
                )}
                <div className="table-wrap fl-tabla">
                  <table>
                    <thead><tr><th>Cliente original</th><th>Fecha venta</th><th>Precio</th><th>Pagado (perdido)</th><th>Cierre económico</th></tr></thead>
                    <tbody>
                      {exps.map((e, i) => (
                        <tr key={i} style={{ verticalAlign: 'top' }}>
                          <td><b>{e.client?.full_name || '—'}</b>{e.client?.doc_number ? <><br /><span className="muted">{e.client.doc_number}</span></> : null}</td>
                          <td>{fechaPe(e.sale_date)}</td>
                          <td>{soles(e.total_sale_price)}</td>
                          <td><b style={{ color: '#c39ce0' }}>{soles(e.pagado)}</b>
                            {puedeCierre && <div><button className="link-btn" style={{ fontSize: 11 }}
                              onClick={() => abrirPagoExp(e)}>&#43; pago que faltó</button></div>}
                          </td>
                          <td>
                            {tieneCierre(e) ? (
                              <div className="small">
                                {e.expr_fecha_cierre && <div><span className="muted">cerrado el</span> {fechaPe(e.expr_fecha_cierre)}</div>}
                                {e.expr_monto_recuperado != null && <div><span className="muted">entró:</span> <b className="ok">{soles(e.expr_monto_recuperado)}</b></div>}
                                {e.expr_monto_devuelto != null && <div><span className="muted">devuelto:</span> <b className="warn">{soles(e.expr_monto_devuelto)}</b></div>}
                                {e.expr_saldo != null && <div><span className="muted">saldo:</span> <b className={Number(e.expr_saldo) < 0 ? 'bad' : 'ok'}>{soles(e.expr_saldo)}</b> <span className="muted">{Number(e.expr_saldo) < 0 ? '(en contra)' : '(a favor)'}</span></div>}
                                {e.expr_acuerdo_url && <div><a href={e.expr_acuerdo_url} target="_blank" rel="noreferrer">ver acuerdo firmado</a></div>}
                                {e.expr_notas && <div className="muted" style={{ textTransform: 'none' }}>{e.expr_notas}</div>}
                              </div>
                            ) : <span className="muted small">sin registrar</span>}
                            {puedeCierre && <div><button className="link-btn" style={{ fontSize: 11 }}
                              onClick={() => abrirCierre(e)}>{tieneCierre(e) ? '✎ editar cierre' : '✎ completar cierre'}</button></div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ---- detalle de un pago: sus documentos a la vista ---- */}
      {/* ---- cobrar aqui mismo: separacion, inicial, cuota o cuadre ---- */}
      {cobro && (
        <CobroModal tipo={cobro} lote={sel} detail={detail}
          onClose={() => setCobro(null)} onListo={() => { setCobro(null); reload() }}
          onContrato={saleId => { setCobro(null); reload(); setContrato(saleId) }} />
      )}

      {/* ---- el contrato de la venta, generado aqui mismo ---- */}
      {contrato && (
        <ContratoModal saleId={contrato} onClose={() => setContrato(null)} />
      )}

      {verPago && (
        <DetallePago key={verPago.id} pago={verPago} pagos={pagos} naOk={naOk}
          onClose={() => setVerPago(null)} onCambio={reload} />
      )}

      {/* ---- CIERRE ECONOMICO DE UNA EXPROPIACION (admin/superusuario) ---- */}
      {cierre && (
        <div className="modal-bg" onClick={() => setCierre(null)}>
          <form className="glass modal" onClick={e => e.stopPropagation()} onSubmit={guardarCierre}
            style={{ maxWidth: 720, width: '96%', maxHeight: '88vh', overflowY: 'auto' }}>
            <div className="modal-head">
              <h2>Cierre de expropiación — MZ {sel.mz} LT {sel.lt}</h2>
              <button type="button" className="btn-ghost" onClick={() => setCierre(null)}>&#10005;</button>
            </div>
            <p className="muted small" style={{ margin: '0 0 6px' }}>
              Cliente original: <b>{cierre.exp.client?.full_name || '—'}</b> · pagó y perdió{' '}
              <b style={{ color: '#c39ce0' }}>{soles(cierre.exp.pagado)}</b>.
              Sus pagos <b>no se tocan</b>: acá solo se registra cómo terminó el acuerdo.
            </p>

            <p className="muted small" style={{ margin: '8px 0 2px', fontWeight: 700 }}>DATOS DE LA VENTA (corrígelos si se cargaron mal)</p>
            <div className="form-grid">
              <label>Fecha de venta
                <input type="date" value={cierre.f.sale_date}
                  onChange={e => setCierre(c => ({ ...c, f: { ...c.f, sale_date: e.target.value } }))} required />
              </label>
              <label>Precio de la venta S/
                <input type="number" step="0.01" min="0.01" value={cierre.f.total_sale_price}
                  onChange={e => setCierre(c => ({ ...c, f: { ...c.f, total_sale_price: e.target.value } }))} required />
              </label>
            </div>

            <p className="muted small" style={{ margin: '12px 0 2px', fontWeight: 700 }}>CÓMO TERMINÓ LA PLATA</p>
            <div className="form-grid">
              <label>Fecha del cierre / acuerdo
                <input type="date" value={cierre.f.expr_fecha_cierre}
                  onChange={e => setCierre(c => ({ ...c, f: { ...c.f, expr_fecha_cierre: e.target.value } }))} />
              </label>
              <label>Dinero que ENTRÓ al final S/ <span className="muted small">(penalidad, gastos, saldo cobrado)</span>
                <input type="number" step="0.01" min="0" placeholder="0.00" value={cierre.f.expr_monto_recuperado}
                  onChange={e => setCierre(c => ({ ...c, f: { ...c.f, expr_monto_recuperado: e.target.value } }))} />
              </label>
              <label>Dinero DEVUELTO al cliente S/
                <input type="number" step="0.01" min="0" placeholder="0.00" value={cierre.f.expr_monto_devuelto}
                  onChange={e => setCierre(c => ({ ...c, f: { ...c.f, expr_monto_devuelto: e.target.value } }))} />
              </label>
              <label>Saldo final S/ <span className="muted small">(+ a favor · − en contra)</span>
                <input type="number" step="0.01" placeholder="0.00" value={cierre.f.expr_saldo}
                  onChange={e => setCierre(c => ({ ...c, f: { ...c.f, expr_saldo: e.target.value } }))} />
              </label>
              <label className="span2">Acuerdo firmado {cierre.exp.expr_acuerdo_url && <a href={cierre.exp.expr_acuerdo_url} target="_blank" rel="noreferrer">(ver el que ya está subido)</a>}
                <input type="file" accept="image/*,.pdf" onChange={e => setCierreFile(e.target.files[0] || null)} />
              </label>
              <label className="span2">Notas del cierre
                <textarea rows="3" style={{ textTransform: 'none' }} value={cierre.f.expr_notas}
                  placeholder="Qué se acordó, condiciones, pendientes…"
                  onChange={e => setCierre(c => ({ ...c, f: { ...c.f, expr_notas: e.target.value } }))} />
              </label>
            </div>
            {(() => {
              // referencia para no adivinar: lo que la empresa retiene si devuelve lo indicado
              const dev = Number(cierre.f.expr_monto_devuelto || 0)
              const rec = Number(cierre.f.expr_monto_recuperado || 0)
              const retenido = r2(Number(cierre.exp.pagado) - dev + rec)
              return <p className="hint" style={{ margin: '6px 0' }}>
                Referencia: pagado {Number(cierre.exp.pagado).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                {dev ? ' − devuelto ' + dev.toLocaleString('es-PE', { minimumFractionDigits: 2 }) : ''}
                {rec ? ' + entró ' + rec.toLocaleString('es-PE', { minimumFractionDigits: 2 }) : ''}
                {' '}= <b>{soles(retenido)}</b> que quedan en la empresa.
                El saldo final lo escribes tú, porque lo define el acuerdo.
              </p>
            })()}
            {cierreMsg && <p className={cierreMsg.ok ? 'ok' : 'error'}>{cierreMsg.t}</p>}
            <button className="btn-primary" disabled={cierreBusy}>{cierreBusy ? 'Guardando…' : 'Guardar cierre'}</button>
            {tieneCierre(cierre.exp) && (
              <>
                {' '}
                <button type="button" className="btn-ghost bad" disabled={cierreBusy} onClick={borrarCierre}>Borrar cierre</button>
                <p className="muted small" style={{ margin: '6px 0 0', textTransform: 'none' }}>
                  Si ese monto fue en realidad un pago del cliente, bórralo de acá y regístralo con <b>+ pago que faltó</b>: así suma en lo pagado y en la caja, en vez de quedar como una nota.
                </p>
              </>
            )}
          </form>
        </div>
      )}

      {/* ---- PAGO QUE FALTO EN UNA VENTA EXPROPIADA (admin/superusuario) ---- */}
      {pagoExp && (
        <div className="modal-bg" onClick={() => setPagoExp(null)}>
          <form className="glass modal" onClick={e => e.stopPropagation()} onSubmit={guardarPagoExp}
            style={{ maxWidth: 720, width: '96%', maxHeight: '88vh', overflowY: 'auto' }}>
            <div className="modal-head">
              <h2>Pago que faltó — MZ {sel.mz} LT {sel.lt}</h2>
              <button type="button" className="btn-ghost" onClick={() => setPagoExp(null)}>&#10005;</button>
            </div>
            <p className="muted small" style={{ margin: '0 0 6px' }}>
              Venta expropiada de <b>{pagoExp.exp.client?.full_name || '—'}</b> · hoy figura pagado{' '}
              <b style={{ color: '#c39ce0' }}>{soles(pagoExp.exp.pagado)}</b>.
              Esto es para la plata que <b>sí entró</b> y nunca se registró. Suma en lo pagado y en la caja del proyecto.
            </p>
            <p className="hint" style={{ margin: '0 0 8px' }}>
              Si lo que quieres anotar es cómo terminó el acuerdo (penalidad, devolución), eso va en <b>completar cierre</b>, no acá.
            </p>

            <div className="form-grid">
              <label>Fecha del pago
                <input type="date" value={pagoExp.f.date}
                  onChange={e => setPagoExp(p => ({ ...p, f: { ...p.f, date: e.target.value } }))} required />
              </label>
              <label>Monto S/
                <input type="number" step="0.01" min="0.01" placeholder="0.00" value={pagoExp.f.amount}
                  onChange={e => setPagoExp(p => ({ ...p, f: { ...p.f, amount: e.target.value } }))} required />
              </label>
              <label>N° de operación <span className="muted small">(si no se ubica, déjalo vacío)</span>
                <input value={pagoExp.f.operation_number} placeholder="SIN-REF"
                  onChange={e => setPagoExp(p => ({ ...p, f: { ...p.f, operation_number: e.target.value } }))} />
              </label>
              <label>Tipo de operación
                <select value={pagoExp.f.operation_type}
                  onChange={e => setPagoExp(p => ({ ...p, f: { ...p.f, operation_type: e.target.value } }))}>
                  {['TRANSFERENCIA', 'DEPOSITO', 'BILLETERA DIGITAL', 'EFECTIVO', 'POR CONFIRMAR'].map(v => <option key={v}>{v}</option>)}
                </select>
              </label>
              <label className="span2">¿A qué cuota va? <span className="muted small">(opcional — si la eliges, esa cuota queda saldada)</span>
                <select value={pagoExp.f.installment_id}
                  onChange={e => setPagoExp(p => ({ ...p, f: { ...p.f, installment_id: e.target.value } }))}>
                  <option value="">NINGUNA — solo suma a lo pagado</option>
                  {(pagoExp.cuotas || []).map(q => {
                    const debe = r2(Number(q.amount) - Number(q.amount_paid))
                    return <option key={q.id} value={q.id} disabled={debe <= 0.01}>
                      CUOTA {String(q.installment_number).padStart(2, '0')} · vence {q.due_date} · debe S/ {debe.toFixed(2)}
                    </option>
                  })}
                </select>
              </label>
              <label className="span2">Voucher del cliente <span className="muted small">(opcional: es plata vieja, puede no estar)</span>
                <input type="file" accept="image/*,.pdf" onChange={e => setPagoExpFile(e.target.files[0] || null)} />
              </label>
              <label className="span2">¿De dónde sale este pago? <span className="muted small">(obligatorio, queda en bitácora)</span>
                <textarea rows="2" style={{ textTransform: 'none' }} value={pagoExp.f.observation}
                  placeholder="Ej: voucher de la cuota 04 que estaba en el Drive y nunca se subió"
                  onChange={e => setPagoExp(p => ({ ...p, f: { ...p.f, observation: e.target.value } }))} required />
              </label>
            </div>
            {Number(pagoExp.f.amount) > 0 && (
              <p className="hint" style={{ margin: '6px 0' }}>
                Lo pagado por este cliente pasaría de <b>{soles(pagoExp.exp.pagado)}</b> a{' '}
                <b>{soles(r2(Number(pagoExp.exp.pagado) + Number(pagoExp.f.amount)))}</b>.
              </p>
            )}
            {pagoExpMsg && <p className={pagoExpMsg.ok ? 'ok' : 'error'}>{pagoExpMsg.t}</p>}
            <button className="btn-primary" disabled={pagoExpBusy}>{pagoExpBusy ? 'Guardando…' : 'Registrar el pago'}</button>
          </form>
        </div>
      )}

      {/* ---- CAMBIAR TITULAR (superusuario) ---- */}
      {tit && sale && (
        <div className="modal-bg" onClick={() => setTit(false)}>
          <div className="glass modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Cambiar titular — MZ {sel.mz} LT {sel.lt}</h2>
              <button className="btn-ghost" onClick={() => setTit(false)}>&#10005;</button>
            </div>
            <p className="muted small">Titular actual: <b>{sale.client?.full_name}</b></p>
            {detail.grupo && (
              <p className="hint" style={{ margin: '4px 0' }}>
                &#128279; Este lote es parte de la <b>VENTA CONJUNTA {detail.grupo.join(' + ')}</b>. La venta vive en el lote
                principal <b>{detail.grupo[0]}</b>, asi que el cambio de titular aplica a <b>todo el grupo</b> ({detail.grupo.length} lotes).
              </p>
            )}
            {sale.status !== 'en_proceso' && (
              <p className="hint" style={{ margin: '4px 0' }}>
                Esta venta esta <b>{String(sale.status).toUpperCase()}</b>. El cambio de titular se aplica igual (un nombre mal registrado se corrige este pagada o no).
              </p>
            )}
            <label>Tipo de cambio
              <select value={titModo} onChange={e => setTitModo(e.target.value)}>
                <option value="correccion">CORRECCION — el lote siempre fue de esta persona (los pagos tambien pasan)</option>
                <option value="transferencia">TRANSFERENCIA — pasa a otra persona (los pagos historicos quedan con el anterior)</option>
              </select>
            </label>
            <label>Nuevo titular
              <Buscador opciones={(clientes || []).filter(c => c.id !== sale.client_id).map(c => ({ id: c.id, label: c.full_name, sub: c.doc_number || '' }))}
                valor={titNew} onChange={setTitNew} placeholder={clientes ? 'Busca por nombre o DNI…' : 'Cargando clientes…'} />
            </label>
            <label>Motivo (obligatorio)
              <textarea value={titReason} onChange={e => setTitReason(e.target.value)}
                style={{ textTransform: 'none', minHeight: 54 }} placeholder="Ej: el lote se registro a nombre del hermano por error" />
            </label>
            {uMsg && <p className={uMsg.ok ? 'ok' : 'error'}>{uMsg.t}</p>}
            <button className="btn-primary" disabled={uBusy} onClick={cambiarTitular}>{uBusy ? 'GUARDANDO...' : 'CAMBIAR TITULAR'}</button>
          </div>
        </div>
      )}

      {/* ---- CONSOLIDAR 2 LOTES EN 1 (superusuario) ---- */}
      {cons && sale && (
        <div className="modal-bg" onClick={() => setCons(false)}>
          <div className="glass modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Consolidar — el cliente suelta MZ {sel.mz} LT {sel.lt}</h2>
              <button className="btn-ghost" onClick={() => setCons(false)}>&#10005;</button>
            </div>
            <p className="muted small">
              Todo el dinero pagado en <b>MZ {sel.mz} LT {sel.lt}</b> se pasa al lote que el cliente se queda y se aplica
              a sus cuotas pendientes, de la mas antigua a la mas nueva. Las cuotas de este lote se revierten.
              Los pagos conservan su fecha, voucher y N° de operacion.
            </p>
            <label>Lote que se queda (destino)
              <select value={consDest} onChange={e => setConsDest(e.target.value)}>
                <option value="">- elegir -</option>
                {consOpts.map(o => <option key={o.id} value={o.id}>MZ {o.lot.mz} LT {o.lot.lt}</option>)}
              </select>
            </label>
            {!consOpts.length && <p className="error">Este cliente no tiene otro lote con venta activa en este proyecto. Primero registra la venta del lote que se queda.</p>}
            <label>Que pasa con MZ {sel.mz} LT {sel.lt}
              <select value={consFate} onChange={e => setConsFate(e.target.value)}>
                <option value="disponible">DISPONIBLE — vuelve a estar en venta</option>
                <option value="expropiado">EXPROPIADO — queda el historico de que lo tuvo</option>
                <option value="eliminado">ELIMINADO — el lote ya no existe</option>
              </select>
            </label>
            <label>Motivo (obligatorio)
              <textarea value={consReason} onChange={e => setConsReason(e.target.value)}
                style={{ textTransform: 'none', minHeight: 54 }} placeholder="Ej: el cliente decidio quedarse solo con un lote y juntar todo su pago ahi" />
            </label>
            {uMsg && <p className={uMsg.ok ? 'ok' : 'error'}>{uMsg.t}</p>}
            <button className="btn-primary" disabled={uBusy || !consOpts.length} onClick={consolidar}>{uBusy ? 'PROCESANDO...' : 'CONSOLIDAR'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
