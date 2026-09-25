import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { upload } from '../lib/archivos'
import { useMsg } from '../lib/saveFx'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'
import Paginador, { usePaginacion } from '../components/Paginador'
import { leerVoucher, esImagen } from '../lib/leerVoucher'
import VoucherReview from '../components/VoucherReview'
import DetallePago, { EstadoChip } from '../components/DetallePago'
import Buscador from '../components/Buscador'
import { repartirCuotas, textoCuotas } from '../lib/cronograma'
import {
  soles, estadoDe, conceptoPago, agruparPagos, COLS_PAGO as COLS, COLS_PAGO_NA as COLS_NA,
  subirDocPago, marcarNoAplica as marcarNA, quitarNoAplica as quitarNA,
} from '../lib/pagos'

const hoy = () => new Date().toISOString().slice(0, 10)

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function addMonths(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDate()
  d.setMonth(d.getMonth() + n)
  if (d.getDate() < day) d.setDate(0)
  return d.toISOString().slice(0, 10)
}


export default function Payments() {
  const { profile, role } = useAuth()
  const { pidOp } = useProject()
  // Llegando desde la ficha del lote (?tipo=cuota&lote=<id>) el formulario ya
  // viene con ese tipo y ese lote elegidos: la secretaria no los vuelve a buscar.
  const [searchParams] = useSearchParams()
  const loteFicha = searchParams.get('lote')
  const preLote = useRef(loteFicha)
  const [tipo, setTipo] = useState(() => {
    const t = searchParams.get('tipo')
    return ['cuota', 'separacion', 'inicial'].includes(t) ? t : 'cuota'
  })
  const [cuadreTipo, setCuadreTipo] = useState('inicial') // 'inicial' | 'separacion' (modo cuadre superusuario)
  const [lots, setLots] = useState([])
  const [clients, setClients] = useState([])
  const [accounts, setAccounts] = useState([])
  const [pagos, setPagos] = useState([])
  const [msg, setMsg] = useMsg(null)
  const [busy, setBusy] = useState(false)

  const [fq, setFq] = useState('')
  const [ftipo, setFtipo] = useState('todos')
  const [fdoc, setFdoc] = useState('todos') // todos | sin_voucher | sin_comprobante
  const [fest, setFest] = useState('todos')
  const [coId, setCoId] = useState('')

  const [lotId, setLotId] = useState('')
  const [clientId, setClientId] = useState('')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(hoy())
  const [nroOp, setNroOp] = useState('')
  const [acctId, setAcctId] = useState('')
  const [opTipo, setOpTipo] = useState('TRANSFERENCIA')
  const [obs, setObs] = useState('')
  const [precioVenta, setPrecioVenta] = useState('')
  const [meses, setMeses] = useState(48)
  const [venc, setVenc] = useState(addDays(hoy(), 7))
  const [fVoucher, setFVoucher] = useState(null)
  const [vNota, setVNota] = useState('')   // comentario del voucher que se sube al registrar
  const [ocr, setOcr] = useState(null)     // lo detectado en el voucher (sugerencia, no se aplica solo)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ctx, setCtx] = useState(null)
  const [view, setView] = useState(null)
  const [advisors, setAdvisors] = useState([])
  const [advId, setAdvId] = useState('')
  const [comision, setComision] = useState('')
  const [comUrbis, setComUrbis] = useState('')
  const [secs, setSecs] = useState([])
  const [notifIds, setNotifIds] = useState([])
  const [gruposAbiertos, setGruposAbiertos] = useState(new Set())
  const [repartoEdit, setRepartoEdit] = useState(null)
  const [repartoBusy, setRepartoBusy] = useState(false)
  const [naOk, setNaOk] = useState(true)   // false = sql/49 sin correr: sin "no aplica"
  const readOnly = ['manager', 'socio'].includes(role)

  // Trae TODOS los pagos del proyecto por paginas. Supabase corta en 1000 filas
  // por request, asi que sin esto en proyectos grandes (Pucallpa ~2200) el
  // historial salia incompleto: los mas antiguos (iniciales, lotes entregados)
  // se perdian y los filtros parecian rotos.
  // Pinta en cuanto llega la PRIMERA pagina y sigue trayendo el resto por
  // detras. Antes esperaba las 2.288 filas de Pucallpa (12 s con el servidor
  // solo, 62 s con cuatro secretarias a la vez) antes de mostrar nada — eso era
  // "la pantalla se queda sin cargar". `alPintar` recibe lo acumulado tras cada
  // pagina; el que llama decide que hacer con ello.
  async function traerPagos(alPintar) {
    const paso = 1000
    let desde = 0, todo = []
    // 1) camino rapido: una sola consulta en Postgres con los joins ya hechos
    //    (sql/71). Si la funcion no existe todavia, cae al camino de siempre.
    let rapido = true
    for (let guard = 0; guard < 60 && rapido; guard++) {
      const { data, error } = await supabase.rpc('pagos_proyecto', { pid: pidOp, lim: paso, offs: desde })
      if (error) { rapido = false; break }
      const filas = Array.isArray(data) ? data : []
      todo = todo.concat(filas)
      if (alPintar) alPintar(todo)
      if (filas.length < paso) return todo
      desde += paso
    }
    // 2) camino de siempre (PostgREST con las 5 tablas enlazadas)
    desde = 0; todo = []
    let cols = COLS + COLS_NA
    for (let guard = 0; guard < 60; guard++) {
      const { data, error } = await supabase.from('daily_income').select(cols)
        .eq('project_id', pidOp).order('date', { ascending: false }).order('created_at', { ascending: false })
        .range(desde, desde + paso - 1)
      // sql/49 todavia sin correr: se reintenta sin las columnas de "no aplica"
      // para que el historial siga funcionando (los botones se ocultan solos).
      if (error && cols !== COLS) { cols = COLS; setNaOk(false); continue }
      if (error || !data?.length) break
      todo = todo.concat(data)
      if (alPintar) alPintar(todo)
      if (data.length < paso) break
      desde += paso
    }
    return todo
  }

  async function loadBase() {
    // las listas cortas van en paralelo con los pagos; los pagos se pintan
    // pagina a pagina (la primera aparece en ~1 s aunque el resto siga bajando)
    const [l, c, a, adv, r] = await Promise.all([
      supabase.from('lots').select('id, mz, lt, status, total_price, initial_payment_default').eq('project_id', pidOp).order('mz').order('lt'),
      supabase.from('clients').select('id, full_name, doc_number').order('full_name'),
      supabase.from('financial_accounts').select('id, name').eq('active', true).eq('project_id', pidOp),
      supabase.from('advisors').select('id, code, full_name').eq('active', true).order('code'),
      supabase.from('secretaries').select('id, full_name, user_id, tipo').eq('active', true).order('full_name'),
      traerPagos(parcial => setPagos(parcial)),
    ])
    setLots(l.data || []); setClients(c.data || []); setAccounts(a.data || []); setAdvisors(adv.data || []); setSecs(r.data || [])
  }
  useEffect(() => { if (pidOp) loadBase() }, [pidOp])

  const lotesFiltrados = useMemo(() => {
    if (tipo === 'separacion') return lots.filter(l => l.status === 'disponible')
    if (tipo === 'inicial') return lots.filter(l => ['separado', 'disponible'].includes(l.status))
    // 'cuota' y 'cuadre' operan sobre ventas ya existentes. Se incluye 'entregado':
    // un lote entregado con un hueco de la migracion (cuota sin pago registrado)
    // debe poder recibir ese pago. Antes solo 'vendido' los ocultaba.
    return lots.filter(l => ['vendido', 'entregado'].includes(l.status))
  }, [lots, tipo])

  // el lote que mando la ficha se elige una sola vez, cuando ya cargo la lista
  useEffect(() => {
    if (!preLote.current || !lotesFiltrados.some(l => l.id === preLote.current)) return
    setLotId(preLote.current); preLote.current = null
  }, [lotesFiltrados])

  useEffect(() => {
    setCtx(null)
    if (!lotId) return
    const lote = lots.find(l => l.id === lotId)
    async function load() {
      if (tipo === 'cuota') {
        // se acepta la venta 'en_proceso' o 'pagado': un lote entregado/pagado con
        // un hueco de la migracion (cuota sin pago) igual necesita registrar ese pago.
        const { data: ventas } = await supabase.from('sales')
          .select('id, client_id, status, client:clients!sales_client_id_fkey(full_name)')
          .eq('lot_id', lotId).in('status', ['en_proceso', 'pagado']).order('created_at', { ascending: false })
        const sale = (ventas || []).find(s => s.status === 'en_proceso') || (ventas || [])[0]
        if (!sale) { setCtx({ error: 'Este lote no tiene venta registrada' }); return }
        const { data: pend } = await supabase.from('installments')
          .select('id, installment_number, amount, amount_paid, due_date, status')
          .eq('sale_id', sale.id).neq('status', 'pagado')
          .order('installment_number')
        if (!pend?.length) { setCtx({ error: 'Este lote no tiene cuotas pendientes (todas pagadas)' }); return }
        setCtx({ sale, pend })
        setClientId(sale.client_id)
        setMonto((Number(pend[0].amount) - Number(pend[0].amount_paid)).toFixed(2))
      }
      if (tipo === 'inicial') {
        const { data: sep } = await supabase.from('separations')
          .select('id, client_id, amount, advisor_id, expiration_date, extended_until, client:clients(full_name)')
          .eq('lot_id', lotId).eq('status', 'vigente').maybeSingle()
        const lim = sep ? (sep.extended_until || sep.expiration_date) : null
        if (lim && lim < hoy()) setCtx({ sep, error: 'SEPARACION VENCIDA EL ' + lim + ' — LOTE BLOQUEADO. EL ADMINISTRADOR DEBE EXTENDER EL PLAZO O MARCAR PERDIDA EN EL MAPA DE LOTES (ficha del lote).' })
        else setCtx({ sep })
        if (sep) setClientId(sep.client_id)
        if (sep?.advisor_id) setAdvId(sep.advisor_id)
        setMonto(String(lote?.initial_payment_default ?? 500))
        setPrecioVenta(String(lote?.total_price ?? ''))
      }
      if (tipo === 'separacion') { setMonto('100'); setVenc(addDays(hoy(), 7)) }
      if (tipo === 'cuadre') {
        const { data: sale } = await supabase.from('sales')
          .select('id, client_id, total_sale_price, initial_amount_paid, financed_amount, client:clients!sales_client_id_fkey(full_name)')
          .eq('lot_id', lotId).in('status', ['en_proceso', 'pagado']).maybeSingle()
        if (!sale) { setCtx({ error: 'Este lote no tiene venta registrada' }); return }
        const { data: pays } = await supabase.from('daily_income')
          .select('amount, income_type').eq('sale_id', sale.id)
        let iniPag = 0, sepPag = 0
        for (const p of (pays || [])) {
          if (p.income_type === 'inicial') iniPag += Number(p.amount)
          else if (p.income_type === 'separacion') sepPag += Number(p.amount)
        }
        setCtx({ sale, iniPag, sepPag })
        setClientId(sale.client_id)
        setMonto('')
      }
    }
    load()
  }, [lotId, tipo])

  const plan = useMemo(() => {
    if (tipo !== 'cuota' || !ctx?.pend || !monto) return null
    let rest = Math.round(Number(monto) * 100) / 100
    const parts = []
    for (const q of ctx.pend) {
      if (rest <= 0.004) break
      const deuda = Math.round((Number(q.amount) - Number(q.amount_paid)) * 100) / 100
      const take = Math.min(rest, deuda)
      parts.push({ q, take: Math.round(take * 100) / 100, resto: Math.round((deuda - take) * 100) / 100 })
      rest = Math.round((rest - take) * 100) / 100
    }
    return { parts, sobra: rest }
  }, [tipo, ctx, monto])

  // Lee el voucher y SUGIERE los datos. Nunca pisa lo que ya escribiste: tu decides
  // que aplicar. Solo se analizan imagenes (un PDF se sube igual, sin analizar).
  async function analizarVoucher(file) {
    setOcr(null)
    if (!file || !esImagen(file)) return
    setOcrBusy(true)
    try {
      const r = await leerVoucher(file)
      setOcr(r.monto == null && !r.operacion && !r.fecha ? { vacio: true } : r)
    } catch (err) { setOcr({ error: err.message || 'no se pudo analizar' }) }
    setOcrBusy(false)
  }
  // El banco detectado (BCP, YAPE...) se busca entre TUS cuentas del proyecto:
  // si alguna la menciona, se sugiere. Si no, no se inventa nada.
  const cuentaSugerida = useMemo(() => {
    if (!ocr?.banco || !accounts.length) return null
    const b = ocr.banco.toLowerCase()
    return accounts.find(a => {
      const n = (a.name || '').toLowerCase()
      return n.includes(b) || b.includes(n.split(/\s+/)[0])
    }) || null
  }, [ocr, accounts])

  // Contraste voucher vs cuota que toca. Es el chequeo que evita el error caro:
  // registrar un monto que no es el que el cliente debia. Solo avisa — igual se
  // puede registrar (puede ser adelanto, pago parcial o pago de varias cuotas).
  const cotejo = useMemo(() => {
    if (tipo !== 'cuota' || !ctx?.pend?.length) return null
    const leido = ocr?.monto != null ? Number(ocr.monto) : (monto ? Number(monto) : null)
    if (leido == null || !Number.isFinite(leido)) return null
    const q = ctx.pend[0]
    const esperado = Math.round((Number(q.amount) - Number(q.amount_paid)) * 100) / 100
    return { ok: Math.abs(leido - esperado) < 0.05, esperado, leido, n: q.installment_number }
  }, [tipo, ctx, ocr, monto])

  // aplica UN dato leido (al hacer clic en su cuadro o en su fila)
  const aplicarDato = k => {
    if (k === 'monto' && ocr?.monto != null) setMonto(String(ocr.monto))
    if (k === 'operacion' && ocr?.operacion) setNroOp(ocr.operacion)
    if (k === 'fecha' && ocr?.fecha) setFecha(ocr.fecha)
    if (k === 'cuenta') {
      if (cuentaSugerida) setAcctId(cuentaSugerida.id)
      if (ocr?.tipoOperacion) setOpTipo(ocr.tipoOperacion)
    }
  }
  const usarTodo = () => {
    if (ocr?.monto != null) setMonto(String(ocr.monto))
    if (ocr?.operacion) setNroOp(ocr.operacion)
    if (ocr?.fecha) setFecha(ocr.fecha)
    if (ocr?.tipoOperacion) setOpTipo(ocr.tipoOperacion)
    if (cuentaSugerida) setAcctId(cuentaSugerida.id)
  }

  function reset() {
    setLotId(''); setClientId(''); setMonto(''); setNroOp(''); setObs(''); setCtx(null)
    setPrecioVenta(''); setMeses(48); setFecha(hoy()); setFVoucher(null); setVNota(''); setOcr(null); setAdvId(''); setCoId(''); setComision(''); setComUrbis(''); setNotifIds([])
  }

  async function nuevoAsesor() {
    const code = (prompt('CODIGO corto del vendedor (ej. JUAN):') || '').trim().toUpperCase()
    if (!code) return
    const nombre = (prompt('Nombre completo (opcional, Enter para saltar):') || '').trim().toUpperCase()
    const { data, error } = await supabase.from('advisors').insert({ code, full_name: nombre || code, active: true }).select().single()
    if (error) { setMsg({ ok: false, t: 'ERROR AL CREAR VENDEDOR: ' + error.message }); return }
    await loadBase()
    setAdvId(data.id)
    setMsg({ ok: true, t: 'VENDEDOR ' + code + ' AGREGADO (tambien queda en Comisiones > Vendedores/asesores)' })
  }

  async function submit(e) {
    e.preventDefault()
    // en cuadre el voucher es opcional (regulariza data migrada antigua); en el resto es obligatorio
    if (tipo !== 'cuadre' && !fVoucher) { setMsg({ ok: false, t: 'OBLIGATORIO: adjunta la foto del voucher del cliente.' }); return }
    setBusy(true); setMsg(null)
    try {
      const op = (nroOp || 'SIN-REF').toUpperCase()
      const voucherUrl = fVoucher ? await upload(`vouchers/${op.replace(/[^A-Z0-9-]/g, '')}`, fVoucher) : null
      const base = {
        project_id: pidOp,
        lot_id: lotId, client_id: clientId, date: fecha,
        operation_number: op, operation_type: opTipo,
        financial_account_id: acctId || null, observation: obs.toUpperCase(), origin: 'sistema',
        voucher_url: voucherUrl, voucher_note: vNota.trim() || null,
        registered_by: profile?.id, approved: true, approved_at: new Date().toISOString(),
      }

      if (tipo === 'separacion') {
        const { data: sep, error: e1 } = await supabase.from('separations').insert({
          lot_id: lotId, client_id: clientId, amount: Number(monto),
          date: fecha, expiration_date: venc, status: 'vigente', advisor_id: advId || null, created_by: profile?.id || null,
        }).select().single()
        if (e1) throw e1
        const { error: e2 } = await supabase.from('daily_income').insert({ ...base, amount: Number(monto), income_type: 'separacion', separation_id: sep.id })
        if (e2) throw e2
        await supabase.from('lots').update({ status: 'separado' }).eq('id', lotId)
        // recordatorio de vencimiento en el control de actividades (creadora + designadas)
        const loteSep = lots.find(l => l.id === lotId)
        const cliSep = clients.find(c => c.id === clientId)
        const destinos = new Set(notifIds)
        const propia = secs.find(s => s.user_id === profile?.id)
        if (propia) destinos.add(propia.id)
        if (destinos.size) {
          const titulo = ('VENCE SEPARACION MZ ' + (loteSep?.mz || '?') + ' LT ' + (loteSep?.lt || '?') + ' — ' + (cliSep?.full_name || 'CLIENTE') + ' (S/ ' + Number(monto).toFixed(2) + ')').slice(0, 200)
          const filas = [...destinos].map(sid => ({ secretary_id: sid, title: titulo, date: venc, slot: 'manana', category: 'administrativa', separation_id: sep.id }))
          const { error: e3 } = await supabase.from('secretary_tasks').insert(filas)
          if (e3) await supabase.from('secretary_tasks').insert(filas.map(({ separation_id, ...x }) => x))
        }
      }

      if (tipo === 'inicial') {
        const precio = Number(precioVenta)
        const inicial = Number(monto)
        const financiado = precio - inicial - (ctx?.sep ? Number(ctx.sep.amount) : 0)
        // cuotas redondeadas a 10 centimos y la ultima menor (lib/cronograma)
        const montos = repartirCuotas(financiado, meses)
        if (!montos.length) throw new Error('No queda saldo por financiar: revisa el precio, la inicial y la separación.')
        const cuotaBase = montos[0]
        const { data: sale, error: e1 } = await supabase.from('sales').insert({
          lot_id: lotId, client_id: clientId, co_client_id: coId || null, separation_id: ctx?.sep?.id || null, advisor_id: advId || ctx?.sep?.advisor_id || null,
          total_sale_price: precio, initial_amount_paid: inicial,
          financed_amount: financiado, installments_count: meses,
          monthly_amount: cuotaBase, sale_date: fecha, status: 'en_proceso',
        }).select().single()
        if (e1) throw e1
        const rows = montos.map((amt, i) => ({ sale_id: sale.id, installment_number: i + 1, due_date: addMonths(fecha, i + 1), amount: amt }))
        const { error: e2 } = await supabase.from('installments').insert(rows)
        if (e2) throw e2
        const { error: e3 } = await supabase.from('daily_income').insert({ ...base, amount: inicial, income_type: 'inicial', sale_id: sale.id })
        if (e3) throw e3
        await supabase.from('lots').update({ status: 'vendido' }).eq('id', lotId)
        if (ctx?.sep) await supabase.from('separations').update({ status: 'completada' }).eq('id', ctx.sep.id)
        const advFinal = advId || ctx?.sep?.advisor_id || null
        if (advFinal || Number(comUrbis || 0) > 0) {
          const fila = { sale_id: sale.id, advisor_id: advFinal, amount: Number(comision || 0), urbis_amount: Number(comUrbis || 0), status: 'pendiente' }
          let r4 = await supabase.from('commissions').insert(fila)
          if (r4.error && /urbis_amount/i.test(r4.error.message)) {
            const { urbis_amount, ...f2 } = fila
            r4 = await supabase.from('commissions').insert(f2)
          }
          if (r4.error) setMsg({ ok: false, t: 'VENTA OK, PERO NO SE REGISTRO LA COMISION: ' + r4.error.message })
        }
      }

      if (tipo === 'cuota') {
        if (!plan || plan.parts.length === 0) throw new Error('Monto invalido')
        if (plan.sobra > 0.01) throw new Error(`El monto excede la deuda total del lote en ${soles(plan.sobra)}.`)
        for (const p of plan.parts) {
          const { error: e1 } = await supabase.from('daily_income').insert({
            ...base, amount: p.take, income_type: 'cuota', sale_id: ctx.sale.id, installment_id: p.q.id,
          })
          if (e1) throw e1
        }
      }

      if (tipo === 'cuadre') {
        if (!ctx?.sale) throw new Error('Selecciona un lote con venta registrada')
        const amt = Number(monto)
        if (!(amt > 0)) throw new Error('Monto invalido')
        const nota = ('CUADRE ' + cuadreTipo.toUpperCase() + ' POR SUPERUSUARIO' + (obs ? ' | ' + obs.toUpperCase() : '')).slice(0, 400)
        const { error: e1 } = await supabase.from('daily_income').insert({
          ...base, amount: amt, income_type: cuadreTipo, sale_id: ctx.sale.id, observation: nota,
        })
        if (e1) throw e1
      }

      setMsg({ ok: true, t: tipo === 'cuadre' ? 'CUADRE REGISTRADO. YA SUMA EN EL DESGLOSADO DEL LOTE.' : 'PAGO REGISTRADO. RECUERDA SUBIR EL COMPROBANTE INTERNO CUANDO LO GENERES.' })
      reset(); loadBase()
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + (err.message || err) }) }
    setBusy(false)
  }

  async function subirDoc(row, file, campo) {
    try {
      const t = await subirDocPago(row, file, campo, naOk)
      if (!t) return   // cancelo la nota: no se sube nada
      setMsg({ ok: true, t })
      loadBase()
    } catch (err) { setMsg({ ok: false, t: err.message }) }
  }

  // `filas` son todas las aplicaciones del mismo deposito: se marcan juntas (lib/pagos)
  async function marcarNoAplica(filas, campo) {
    const r = await marcarNA(filas, campo, { email: profile?.email, pidOp })
    if (!r) return
    setMsg(r)
    if (r.ok) loadBase()
  }

  async function quitarNoAplica(filas, campo) {
    const r = await quitarNA(filas, campo, { email: profile?.email, pidOp })
    if (!r) return
    setMsg(r)
    if (r.ok) loadBase()
  }

  function editarReparto(g) {
    setRepartoEdit({ key: g.key, valores: Object.fromEntries(g.items.map(p => [p.id, String(p.amount)])) })
    setGruposAbiertos(prev => new Set(prev).add(g.key))
  }

  async function guardarReparto(g) {
    if (role !== 'superuser' || repartoEdit?.key !== g.key) return
    const cambios = g.items.map(p => ({ ...p, nuevo: Math.round(Number(repartoEdit.valores[p.id]) * 100) / 100 }))
    if (cambios.some(p => !Number.isFinite(p.nuevo) || p.nuevo < 0)) {
      setMsg({ ok: false, t: 'CADA APLICACIÓN DEBE TENER UN MONTO VÁLIDO MAYOR O IGUAL A CERO.' }); return
    }
    const totalNuevo = Math.round(cambios.reduce((s, p) => s + p.nuevo, 0) * 100) / 100
    if (Math.abs(totalNuevo - Number(g.total)) > 0.009) {
      setMsg({ ok: false, t: `EL REPARTO SUMA ${soles(totalNuevo)} Y DEBE SEGUIR SUMANDO ${soles(g.total)}, QUE ES EL MONTO DEL VOUCHER.` }); return
    }
    const deltas = new Map()
    for (const p of cambios) deltas.set(p.installment_id, (deltas.get(p.installment_id) || 0) + p.nuevo - Number(p.amount))
    const cuotaIds = [...deltas.keys()].filter(Boolean)
    setRepartoBusy(true); setMsg(null)
    try {
      const { data: cuotas, error: e0 } = await supabase.from('installments')
        .select('id, amount, amount_paid, status, paid_date').in('id', cuotaIds)
      if (e0) throw e0
      for (const q of (cuotas || [])) {
        const nuevoPagado = Math.round((Number(q.amount_paid) + (deltas.get(q.id) || 0)) * 100) / 100
        if (nuevoPagado < -0.009 || nuevoPagado > Number(q.amount) + 0.009) throw new Error('EL REPARTO EXCEDE O DEJA NEGATIVA UNA CUOTA.')
      }
      for (const p of cambios) {
        const { error } = await supabase.from('daily_income').update({ amount: p.nuevo }).eq('id', p.id)
        if (error) throw error
      }
      for (const q of (cuotas || [])) {
        const nuevoPagado = Math.max(0, Math.round((Number(q.amount_paid) + (deltas.get(q.id) || 0)) * 100) / 100)
        const pagada = nuevoPagado >= Number(q.amount) - 0.009
        const { error } = await supabase.from('installments').update({
          amount_paid: nuevoPagado,
          status: pagada ? 'pagado' : (q.status === 'vencido' ? 'vencido' : 'pendiente'),
          paid_date: pagada ? (q.paid_date || g.referencia.date) : null,
        }).eq('id', q.id)
        if (error) throw error
      }
      await supabase.from('activity_log').insert({
        action: 'UPDATE', entity_type: 'daily_income', user_email: profile?.email || null,
        details: { cambio: 'reparto_voucher', operacion: g.referencia.operation_number, lote: g.lotes, monto_voucher: g.total,
          antes: cambios.map(p => ({ cuota: p.installment?.installment_number, monto: p.amount })),
          despues: cambios.map(p => ({ cuota: p.installment?.installment_number, monto: p.nuevo })), project_id: pidOp },
      })
      setMsg({ ok: true, t: 'REPARTO ACTUALIZADO. EL MONTO TOTAL DEL VOUCHER SE CONSERVÓ.' })
      setRepartoEdit(null)
      await loadBase()
    } catch (err) {
      setMsg({ ok: false, t: 'NO SE PUDO ACTUALIZAR EL REPARTO: ' + (err.message || err) })
    } finally { setRepartoBusy(false) }
  }

  // Rehace la cascada desde un voucher: conserva cada monto/voucher, pero vuelve
  // a repartirlo de la cuota más antigua pendiente hacia adelante. Sirve cuando
  // se corrigió un reparto antiguo y los pagos posteriores quedaron desfasados.
  async function recalcularCascadaDesde(g) {
    if (role !== 'superuser' || !g.referencia.sale_id) return
    if (!confirm(`¿Recalcular la cascada desde la operación ${g.referencia.operation_number}?\n\nSe conservarán los vouchers y sus montos; se corregirá únicamente a qué cuotas se aplican este pago y los posteriores.`)) return
    setRepartoBusy(true); setMsg(null)
    try {
      const [cuotasR, pagosR] = await Promise.all([
        supabase.from('installments').select('id, installment_number, amount, status, paid_date').eq('sale_id', g.referencia.sale_id).order('installment_number'),
        supabase.from('daily_income').select('*').eq('sale_id', g.referencia.sale_id).eq('income_type', 'cuota').order('date').order('created_at'),
      ])
      if (cuotasR.error) throw cuotasR.error
      if (pagosR.error) throw pagosR.error
      const cuotas = cuotasR.data || []
      const grupos = agruparPagos(pagosR.data || [])
      const desde = grupos.findIndex(x => x.items.some(p => p.id === g.referencia.id))
      if (desde < 0) throw new Error('NO ENCONTRÉ EL PAGO A RECALCULAR.')

      const anteriores = grupos.slice(0, desde).flatMap(x => x.items)
      const pagado = new Map(cuotas.map(q => [q.id, 0]))
      for (const p of anteriores) pagado.set(p.installment_id, (pagado.get(p.installment_id) || 0) + Number(p.amount || 0))
      const nuevos = []
      const borrarIds = grupos.slice(desde).flatMap(x => x.items.map(p => p.id))

      for (const grupo of grupos.slice(desde)) {
        let restante = Math.round(Number(grupo.total) * 100) / 100
        const fuente = grupo.items[0]
        const conVoucher = grupo.items.find(p => p.voucher_url) || fuente
        const conComprobante = grupo.items.find(p => p.receipt_url) || fuente
        for (const cuota of cuotas) {
          if (restante <= 0.004) break
          const debe = Math.max(0, Math.round((Number(cuota.amount) - (pagado.get(cuota.id) || 0)) * 100) / 100)
          if (debe <= 0.004) continue
          const toma = Math.min(restante, debe)
          const { id, created_at, ...base } = fuente
          nuevos.push({
            ...base, amount: Math.round(toma * 100) / 100, installment_id: cuota.id,
            voucher_url: conVoucher.voucher_url || null, voucher_note: conVoucher.voucher_note || null,
            receipt_url: conComprobante.receipt_url || null, receipt_note: conComprobante.receipt_note || null,
          })
          pagado.set(cuota.id, (pagado.get(cuota.id) || 0) + toma)
          restante = Math.round((restante - toma) * 100) / 100
        }
        if (restante > 0.01) throw new Error(`LA OPERACIÓN ${grupo.referencia.operation_number} EXCEDE LA DEUDA DE LAS CUOTAS EN ${soles(restante)}.`)
      }

      if (borrarIds.length) {
        const { error } = await supabase.from('daily_income').delete().in('id', borrarIds)
        if (error) throw error
      }
      if (nuevos.length) {
        const { error } = await supabase.from('daily_income').insert(nuevos)
        if (error) throw error
      }
      for (const cuota of cuotas) {
        const montoPagado = Math.round((pagado.get(cuota.id) || 0) * 100) / 100
        const pagada = montoPagado >= Number(cuota.amount) - 0.009
        const { error } = await supabase.from('installments').update({
          amount_paid: montoPagado,
          status: pagada ? 'pagado' : (cuota.status === 'vencido' ? 'vencido' : 'pendiente'),
          paid_date: pagada ? cuota.paid_date || g.referencia.date : null,
        }).eq('id', cuota.id)
        if (error) throw error
      }
      await supabase.from('activity_log').insert({
        action: 'UPDATE', entity_type: 'daily_income', user_email: profile?.email || null,
        details: { cambio: 'recalculo_cascada', desde_operacion: g.referencia.operation_number, lote: g.lotes, project_id: pidOp },
      })
      setRepartoEdit(null)
      setMsg({ ok: true, t: 'CASCADA RECALCULADA DESDE ESTE VOUCHER.' })
      await loadBase()
    } catch (err) {
      setMsg({ ok: false, t: 'NO SE PUDO RECALCULAR LA CASCADA: ' + (err.message || err) })
    } finally { setRepartoBusy(false) }
  }

  const pagosFiltrados = useMemo(() => {
    // busqueda avanzada: cada palabra puede ir en cualquier orden y contra
    // cualquier dato (lote, cliente, N operacion, concepto). "nilsson g7" o
    // "g7 cuota" encuentran igual.
    const terms = fq.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return pagos.filter(p => {
      if (ftipo !== 'todos' && p.income_type !== ftipo) return false
      // los marcados "no aplica" ya no son faltantes: no salen en estos filtros
      if (fdoc === 'sin_voucher' && (p.voucher_url || p.voucher_na)) return false
      if (fdoc === 'sin_comprobante' && (p.receipt_url || p.receipt_na)) return false
      if (fdoc === 'no_aplica' && !p.voucher_na && !p.receipt_na) return false
      if (fest !== 'todos' && estadoDe(p) !== fest) return false
      if (!terms.length) return true
      const heno = [
        p.lot ? `${p.lot.mz}${p.lot.lt} ${p.lot.mz}-${p.lot.lt} mz ${p.lot.mz} lt ${p.lot.lt}` : '',
        p.client?.full_name || '', p.operation_number || '',
        p.income_type || '', p.installment ? 'cuota ' + p.installment.installment_number : '',
      ].join(' ').toLowerCase()
      return terms.every(w => heno.includes(w))
    })
  }, [pagos, fq, ftipo, fdoc, fest])   // fest FALTABA: por eso el filtro de estado no reaccionaba
  const gruposHistorial = useMemo(() => agruparPagos(pagosFiltrados), [pagosFiltrados])
  const gruposTotales = useMemo(() => agruparPagos(pagos), [pagos])
  const pag = usePaginacion(gruposHistorial, 50)   // 50 depósitos por pagina, sin recargar

  // opciones para los buscadores. El lote se puede escribir como "G7" o "G-7"
  // (sub incluye ambos), asi la secretaria teclea como le salga.
  const opcLotes = useMemo(() => lotesFiltrados.map(l => ({
    id: l.id, label: `MZ ${l.mz} LT ${l.lt}`, sub: `${l.mz}${l.lt} ${l.mz}-${l.lt}`,
  })), [lotesFiltrados])
  const opcClientes = useMemo(() => clients.map(c => ({
    id: c.id, label: c.full_name, sub: c.doc_number || '',
  })), [clients])
  // en cuota/cuadre el cliente viene de la venta del lote: no se elige
  const clienteFijo = (tipo === 'cuota' || tipo === 'cuadre') && !!ctx?.sale
  const totalFiltrado = pagosFiltrados.reduce((s, p) => s + Number(p.amount), 0)
  const sinVoucher = gruposTotales.filter(g => !g.voucherUrl && !g.voucherNA).length
  const sinComprobante = gruposTotales.filter(g => !g.comprobanteUrl && !g.comprobanteNA).length
  const noAplica = gruposTotales.filter(g => g.voucherNA || g.comprobanteNA).length
  const hayFiltro = !!fq || ftipo !== 'todos' || fdoc !== 'todos' || fest !== 'todos'
  const limpiarFiltros = () => { setFq(''); setFtipo('todos'); setFdoc('todos'); setFest('todos') }
  const abrirPago = r => setView(r)
  // Celda de VOUCHER / COMPROBANTE del historial: el documento, o el boton para
  // subirlo, o la marca "no aplica" cuando ese pago no va a tener documento.
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
          title="Volver a pedir este documento" onClick={() => quitarNoAplica(g.items, campo)}>&#8634;</button>}
      </span>
    )
    if (readOnly) return <span className="muted">-</span>
    return (
      <>
        <label className={'upload-btn ' + (esVoucher ? 'warn' : 'bad')}>{esVoucher ? 'subir' : '⚠ falta'}
          <input type="file" accept="image/*,.pdf" hidden
            onChange={e => e.target.files[0] && subirDoc(g.referencia, e.target.files[0], campo)} />
        </label>
        {naOk && <button className="link-btn" style={{ display: 'block', fontSize: 10, marginTop: 2 }}
          title="Este pago nunca va a tener este documento (cascada, cuadre, canje). Se pide el motivo."
          onClick={() => marcarNoAplica(g.items, campo)}>no aplica</button>}
      </>
    )
  }

  const alternarGrupo = key => setGruposAbiertos(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  return (
    <>
      <div className="toolbar">
        {loteFicha && <Link className="btn-ghost" to={`/lotes/${loteFicha}`}>&#8592; Volver a la ficha del lote</Link>}
        <h1 style={{ margin: 0, flex: 1 }}>Cuotas mensuales</h1>
        <ProjectPicker />
      </div>

      {!readOnly && <div className="chips">
        {[['cuota', 'Cuota'], ['separacion', 'Separacion'], ['inicial', 'Pago inicial'],
        ...(role === 'superuser' ? [['cuadre', 'Cuadre inicial/separacion']] : [])].map(([v, l]) => (
          <button key={v} className={`chip ${tipo === v ? 'on' : ''}`} onClick={() => { setTipo(v); reset() }}>{l}</button>
        ))}
      </div>}

      {tipo === 'cuadre' && <div className="glass" style={{ padding: '10px 14px', margin: '0 0 10px', borderLeft: '3px solid #e0b34c' }}>
        <p style={{ margin: 0, fontSize: 13 }}><b style={{ color: '#e0b34c' }}>CUADRE (solo superusuario).</b> Registra una <b>inicial</b> o <b>separacion</b> que no se cargo en la migracion, sobre una <b>venta ya existente</b> (lote vendido). Entra a caja ligada a la venta y <b>suma en el desglosado del lote</b>. No crea venta nueva ni toca el cronograma de cuotas.</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12 }}>Registrar como:</span>
          {[['inicial', 'Inicial'], ['separacion', 'Separacion']].map(([v, l]) => (
            <button type="button" key={v} className={`chip ${cuadreTipo === v ? 'on' : ''}`} onClick={() => setCuadreTipo(v)}>{l}</button>
          ))}
        </div>
        {ctx?.sale && <p className="hint" style={{ marginTop: 8 }}>
          Venta de <b>{ctx.sale.client?.full_name}</b> · Precio {soles(ctx.sale.total_sale_price)} · Inicial ya registrada: {soles(ctx.iniPag)} · Separacion ya registrada: {soles(ctx.sepPag)}.
          {cuadreTipo === 'inicial' && ctx.iniPag > 0 && <b className="bad"> Ojo: esta venta ya tiene inicial registrada ({soles(ctx.iniPag)}), no la dupliques.</b>}
          {cuadreTipo === 'separacion' && ctx.sepPag > 0 && <b className="bad"> Ojo: esta venta ya tiene separacion registrada ({soles(ctx.sepPag)}), no la dupliques.</b>}
        </p>}
      </div>}

      {!readOnly && <form className="glass form-card form-compact" onSubmit={submit}>
        {/* PASO 1: primero el lote/cliente. Sabiendo el lote, el sistema ya sabe
            que cuota toca y con cuanto, y despues puede CONTRASTAR el voucher. */}
        <div className={`paso ${lotId ? 'listo' : ''}`}>
          <span className="paso-n">1</span>
          <span className="paso-t">Busca el lote o el cliente</span>
        </div>
        <div className="form-grid">
          <label>Lote <span className="muted small">({lotesFiltrados.length})</span>
            <Buscador opciones={opcLotes} valor={lotId} onChange={setLotId} required autoFocus
              placeholder="Escribe la mz o el lote… (ej. G7)" />
          </label>
          {/* En cuota/cuadre el cliente lo define el lote: no tiene sentido un
              buscador bloqueado, que parece usable y no lo es. Se muestra el dato. */}
          {clienteFijo ? (
            <label>Cliente <span className="muted small">(sale del lote)</span>
              <div className="dato-fijo" title={ctx.sale.client?.full_name || ''}>
                <span className="dato-pin" />
                <b>{ctx.sale.client?.full_name || '—'}</b>
              </div>
            </label>
          ) : (
            <label>Cliente <span className="muted small">({clients.length})</span>
              <Buscador opciones={opcClientes} valor={clientId} onChange={setClientId} required
                placeholder="Escribe el nombre o el DNI…" />
            </label>
          )}
        </div>

        {/* PASO 2: el voucher. Se lee y se contrasta con lo que deberia pagar. */}
        <div className={`paso ${fVoucher ? 'listo' : ''}`}>
          <span className="paso-n">2</span>
          <label className={tipo === 'cuadre' ? '' : (fVoucher ? '' : 'req-file')} style={{ flex: 1 }}>
            Voucher del cliente {tipo === 'cuadre' ? <span className="muted">(opcional)</span> : <b className="bad">(obligatorio)</b>}
            <input type="file" accept="image/*,.pdf" required={tipo !== 'cuadre'}
              onChange={e => { const f = e.target.files[0] || null; setFVoucher(f); analizarVoucher(f) }} />
          </label>
          <label style={{ flex: 1 }}>Nota del voucher <span className="muted small">(opcional)</span>
            <input value={vNota} placeholder="ej: lo mandó por WhatsApp" style={{ textTransform: 'none' }}
              onChange={e => setVNota(e.target.value)} />
          </label>
        </div>

        {ocrBusy && <div className="ocr-box"><span className="ocr-load">Leyendo el voucher…</span></div>}
        {ocr?.vacio && <div className="ocr-box"><span className="muted">No pude leer datos de esta imagen — llénalos a mano abajo.</span></div>}
        {ocr?.error && <div className="ocr-box"><span className="muted">No se pudo analizar la imagen — llénalos a mano abajo.</span></div>}

        {/* contraste contra la cuota que toca: es el chequeo que evita el error caro */}
        {cotejo && (
          <div className={`cotejo ${cotejo.ok ? 'ok' : 'dif'}`}>
            {cotejo.ok
              ? <>✓ <b>Coincide</b> con la cuota N° {cotejo.n}: {soles(cotejo.esperado)}</>
              : <>⚠ <b>No coincide.</b> La cuota N° {cotejo.n} debe <b>{soles(cotejo.esperado)}</b> y el voucher dice <b>{soles(cotejo.leido)}</b> ({cotejo.leido > cotejo.esperado ? 'paga de más' : 'falta'} {soles(Math.abs(cotejo.leido - cotejo.esperado))}). Puedes registrarlo igual si es correcto.</>}
          </div>
        )}

        <VoucherReview file={fVoucher} ocr={ocr} cuentaSugerida={cuentaSugerida}
          montoActual={monto} onElegirMonto={v => setMonto(String(v))}
          onAplicar={aplicarDato} onAplicarTodo={usarTodo} />

        <div className="paso">
          <span className="paso-n">3</span>
          <span className="paso-t">Revisa lo que se llenó solo y registra</span>
        </div>
        <div className="form-grid">
          <label>Fecha <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required /></label>
          <label>Monto S/ <input type="number" step="0.01" min="0.01" value={monto} onChange={e => setMonto(e.target.value)} required /></label>
          <label>N operacion <input value={nroOp} onChange={e => setNroOp(e.target.value)} placeholder="del voucher" /></label>
          <label>Banco / cuenta
            <select value={acctId} onChange={e => setAcctId(e.target.value)} required>
              <option value="">- elegir -</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>Tipo de operacion
            <select value={opTipo} onChange={e => setOpTipo(e.target.value)}>
              {['TRANSFERENCIA', 'DEPOSITO', 'BILLETERA DIGITAL', 'EFECTIVO'].map(t => <option key={t}>{t}</option>)}
            </select>
          </label>
          {tipo === 'separacion' && (<>
            <label>Vence el <input type="date" value={venc} onChange={e => setVenc(e.target.value)} required /></label>
          <label>Vendedor (asesor) <button type="button" className="link-btn" onClick={nuevoAsesor} title="Registrar un vendedor nuevo, tambien externo">+ nuevo</button>
            <select value={advId} onChange={e => setAdvId(e.target.value)} required>
              <option value="">- elegir -</option>
              {advisors.map(a => <option key={a.id} value={a.id}>{a.code}{a.full_name && a.full_name !== a.code ? ' - ' + a.full_name : ''}</option>)}
            </select>
          </label>
          {secs.length > 0 && (
            <div className="span2">
              <span className="muted small">RECORDAR EL VENCIMIENTO A (se registra en su control de actividades; tu registro se agrega solo):</span><br />
              {secs.map(s => (
                <label key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 14, fontWeight: 400 }}>
                  <input type="checkbox" checked={notifIds.includes(s.id)}
                    onChange={e => setNotifIds(ids => e.target.checked ? [...ids, s.id] : ids.filter(x => x !== s.id))} />
                  {s.tipo === 'gerencia' ? '\u{1F454} ' : ''}{s.full_name}{s.user_id === profile?.id ? ' (tu)' : ''}
                </label>
              ))}
            </div>
          )}
          </>)}
          {tipo === 'inicial' && (<>
          <label>Co-comprador (opcional, para ventas de 2 personas)
            <select value={coId} onChange={e => setCoId(e.target.value)}>
              <option value="">- ninguno -</option>
              {clients.filter(c => c.id !== clientId).map(c => <option key={c.id} value={c.id}>{c.full_name} ({c.doc_number})</option>)}
            </select>
          </label>
          <label>Vendedor (asesor) <button type="button" className="link-btn" onClick={nuevoAsesor} title="Registrar un vendedor nuevo, tambien externo">+ nuevo</button>
            <select value={advId} onChange={e => setAdvId(e.target.value)} required>
              <option value="">- elegir -</option>
              {advisors.map(a => <option key={a.id} value={a.id}>{a.code}{a.full_name && a.full_name !== a.code ? ' - ' + a.full_name : ''}</option>)}
            </select>
          </label>
            <label>Precio de venta S/ <input type="number" step="0.01" value={precioVenta} onChange={e => setPrecioVenta(e.target.value)} required /></label>
            <label>Comision asesor S/ <input type="number" step="0.01" min="0" value={comision} onChange={e => setComision(e.target.value)} placeholder="0.00" /></label>
            <label>Comision Urbis S/ <input type="number" step="0.01" min="0" value={comUrbis} onChange={e => setComUrbis(e.target.value)} placeholder="0.00" /></label>
            <label>Meses <input type="number" min="1" max="120" value={meses} onChange={e => setMeses(Number(e.target.value))} required /></label>
          </>)}
          <label className="span2">Observacion <input value={obs} onChange={e => setObs(e.target.value)} /></label>
        </div>

        {ctx?.error && <p className="error">{ctx.error}</p>}
        {tipo === 'cuota' && ctx?.pend && plan && plan.parts.length > 0 && (
          <div className="hint">
            <p>CLIENTE: <b>{ctx.sale.client?.full_name}</b> - SE APLICARA ASI:</p>
            {plan.parts.map(p => (
              <p key={p.q.id}>
                &#8594; CUOTA N {p.q.installment_number} ({p.q.status.toUpperCase()}, vence {p.q.due_date}): {soles(p.take)}
                {p.resto > 0.004
                  ? <b className="warn"> - QUEDARA FALTANDO {soles(p.resto)}</b>
                  : <b className="ok"> - QUEDA PAGADA</b>}
              </p>
            ))}
            {plan.sobra > 0.01 && <p className="error">SOBRAN {soles(plan.sobra)}: EXCEDE LA DEUDA TOTAL</p>}
          </div>
        )}
        {tipo === 'inicial' && ctx?.sep && <p className="hint">Separacion vigente de {soles(ctx.sep.amount)} ({ctx.sep.client?.full_name}). Se descuenta del financiado.</p>}
        {tipo === 'inicial' && precioVenta && monto && (
          <p className="hint">Se generara la venta con <b>{textoCuotas(repartirCuotas(Number(precioVenta) - Number(monto) - (ctx?.sep ? Number(ctx.sep.amount) : 0), meses)) || 'saldo cero: revisa precio e inicial'}</b></p>
        )}

        {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
        <button className="btn-primary" disabled={busy || !!ctx?.error || (tipo === 'cuota' && plan?.sobra > 0.01)}>
          {busy ? 'Guardando...' : 'Registrar pago'}
        </button>
      </form>}

      <h2 className="sub">
        Historial ({gruposHistorial.length} pagos / {pagosFiltrados.length} aplicaciones de {pagos.length} | {soles(totalFiltrado)})
        {!readOnly && sinVoucher > 0 && <span className="warn"> | SIN VOUCHER: {sinVoucher}</span>}
        {!readOnly && sinComprobante > 0 && <span className="bad"> | FALTA COMPROBANTE: {sinComprobante}</span>}
        {!readOnly && noAplica > 0 && <span className="muted" style={{ fontWeight: 400 }}> | NO APLICA: {noAplica}</span>}
      </h2>
      <div className="filtros">
        <input className="search fx-search" placeholder="Buscar: lote (G7), cliente, N° operación… (varias palabras)"
          value={fq} onChange={e => setFq(e.target.value)} />
        <select className={`fx-sel ${ftipo !== 'todos' ? 'on' : ''}`} value={ftipo} onChange={e => setFtipo(e.target.value)}>
          <option value="todos">🔖 Tipo: todos</option>
          <option value="cuota">Cuotas</option>
          <option value="inicial">Iniciales</option>
          <option value="separacion">Separaciones</option>
        </select>
        <select className={`fx-sel ${fdoc !== 'todos' ? 'on' : ''}`} value={fdoc} onChange={e => setFdoc(e.target.value)}>
          <option value="todos">📎 Docs: todos</option>
          <option value="sin_voucher">Sin voucher</option>
          <option value="sin_comprobante">Sin comprobante</option>
          {noAplica > 0 && <option value="no_aplica">Marcados "no aplica" ({noAplica})</option>}
        </select>
        <select className={`fx-sel ${fest !== 'todos' ? 'on' : ''}`} value={fest} onChange={e => setFest(e.target.value)}>
          <option value="todos">● Estado: todos</option>
          <option value="ACEPTADO">Aceptados</option>
          <option value="EXPROPIADO">Expropiados</option>
          <option value="PERDIDA">Pérdidas</option>
        </select>
        {hayFiltro && <button className="fx-clear" onClick={limpiarFiltros} title="Quitar todos los filtros">✕ Limpiar</button>}
      </div>

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Lote</th><th>Concepto</th><th>Estado</th><th>Monto</th><th>Voucher</th><th>Comprobante</th><th>Cliente</th><th>N Op.</th><th>Banco</th></tr></thead>
          <tbody>
            {pag.pagina.map(g => {
              const expandible = g.items.length > 1
              const abierto = gruposAbiertos.has(g.key)
              const editando = repartoEdit?.key === g.key
              const puedeEditarReparto = role === 'superuser' && g.items.every(p => p.installment_id)
              const totalEditado = editando
                ? Math.round(g.items.reduce((s, p) => s + Number(repartoEdit.valores[p.id] || 0), 0) * 100) / 100
                : g.total
              const r = g.referencia
              return (
                <Fragment key={g.key}>
                  <tr key={g.key} className={'row-' + estadoDe(r).toLowerCase()}>
                    <td>{r.date}</td>
                    <td>{g.lotes}</td>
                    <td><button className="link-btn" title={expandible ? 'Ver cómo se distribuyó el pago' : 'Ver documentos'} onClick={() => expandible ? alternarGrupo(g.key) : abrirPago(r)}>
                      {expandible && (abierto ? '▾ ' : '▸ ')}{g.concepto}
                    </button></td>
                    <td><EstadoChip r={r} /></td>
                    <td><b>{soles(g.total)}</b>{expandible && <span className="muted small"> ({g.items.length} cuotas)</span>}
                      {puedeEditarReparto && <button className="link-btn" style={{ marginLeft: 6, fontSize: 11 }} title="Corregir directamente cómo se repartió este voucher" onClick={() => editando ? setRepartoEdit(null) : editarReparto(g)}>
                        {editando ? 'Cancelar edición' : '✎ Editar reparto'}
                      </button>}
                      {puedeEditarReparto && <button className="link-btn" style={{ marginLeft: 6, fontSize: 11 }} disabled={repartoBusy}
                        title="Reparte de nuevo este voucher y los posteriores, respetando el monto de cada cuota"
                        onClick={() => recalcularCascadaDesde(g)}>↻ Recalcular cascada</button>}
                    </td>
                    <td>{celdaDoc(g, 'voucher_url')}</td>
                    <td>{celdaDoc(g, 'receipt_url')}</td>
                    <td>{g.clientes}</td>
                    <td>{r.operation_number}</td>
                    <td>{r.account?.name || '-'}</td>
                  </tr>
                  {abierto && g.items.map((p, i) => (
                    <tr key={p.id} style={{ background: 'rgba(255,255,255,.025)' }}>
                      <td></td>
                      <td>{p.lot ? `${p.lot.mz}-${p.lot.lt}` : '-'}</td>
                      <td><button className="link-btn muted" title="Ver detalle de esta aplicación" onClick={() => abrirPago(p)}>↳ {conceptoPago(p)}</button></td>
                      <td><span className="muted small">aplicación</span></td>
                      <td>{editando
                        ? <input type="number" step="0.01" min="0" value={repartoEdit.valores[p.id] ?? ''} autoFocus={i === 0}
                            onChange={e => setRepartoEdit(x => ({ ...x, valores: { ...x.valores, [p.id]: e.target.value } }))}
                            style={{ width: 92, padding: '3px 5px' }} />
                        : soles(p.amount)}</td>
                      <td colSpan="5" className="muted small">{editando && i === g.items.length - 1 ? <>
                        Reparto: <b className={Math.abs(totalEditado - Number(g.total)) <= 0.009 ? 'ok' : 'bad'}>{soles(totalEditado)} de {soles(g.total)}</b>{' '}
                        <button className="btn-ghost" style={{ fontSize: 11 }} disabled={repartoBusy || Math.abs(totalEditado - Number(g.total)) > 0.009} onClick={() => guardarReparto(g)}>{repartoBusy ? 'Guardando...' : 'Guardar reparto'}</button>
                      </> : <>Parte del pago S/ {soles(g.total)} · operación {r.operation_number}</>}</td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <Paginador {...pag} />

      {view && (
        <DetallePago key={view.id} pago={view} pagos={pagos} accounts={accounts} naOk={naOk}
          onClose={() => setView(null)} onCambio={loadBase} />
      )}
    </>
  )
}
