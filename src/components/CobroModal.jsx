import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { savedFx } from '../lib/saveFx'
import { confirmar, pedirDatos, avisar } from '../lib/dialogos'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import DatosPago from './DatosPago'
import { EmitirComprobante, ComprobanteDetalle } from './Comprobante'
import { estaVivo, nombreComprobante } from '../lib/comprobantes'
import FormPersona, { BuscarCliente } from './FormPersona'
import { soles } from '../lib/pagos'
import { fechaPe } from '../lib/lotes'
import { repartirCuotas, textoCuotas, fechaCuota, mesesParaPrimera, textoDiaPago, FIN_DE_MES } from '../lib/cronograma'
import {
  hoyPe, sumarDias, digitos, celularValido, esPendiente, faltanParaContrato,
  buscarPorCelular, guardarPersona, validarPago, planCascada, planCascadaVarios, MAX_VOUCHERS, subirVoucher, pagosParecidos,
  registrarSeparacion, registrarInicial, registrarCuota, registrarCuadre,
} from '../lib/cobros'

const r2 = n => Math.round(Number(n) * 100) / 100
let uidVoucher = 0   // para los recuadros de los vouchers del 2 en adelante
// el bot a veces guarda como "nombre" del lead el primer mensaje entero: eso no se copia
const pareceNombre = t => { const x = String(t || '').trim(); return x.length >= 5 && x.length <= 60 && !/\d/.test(x) && x.split(/\s+/).length <= 6 }
const TITULO = { separacion: 'Separar', inicial: 'Cobrar inicial', directa: 'Vender directo', cuota: 'Cobrar cuota', cuadre: 'Cuadre de inicial / separación' }

// Cobrar desde la ficha del lote (fase 2, 24 sep 2026): separacion, inicial
// (con o sin separacion previa), cuota y cuadre del superusuario. Todo en una
// ventana, con los pasos a la vista. La escritura vive en lib/cobros.js.
export default function CobroModal({ tipo, lote, detail, onClose, onListo, onContrato }) {
  const { profile, puedeCorregir } = useAuth()   // puedeCorregir = superusuario u operador
  const pidOp = lote.project_id
  // ¿este proyecto emite sus boletas desde el panel (sql/113)? Cambia el aviso final.
  const { projects } = useProject()
  const proyecto = projects.find(p => p.id === pidOp) || null
  const facturaAqui = !!proyecto?.fact_activo
  const sep = detail.sep
  const sale = detail.sale
  const modo = tipo === 'inicial' && !sep ? 'directa' : tipo
  const esInicial = modo === 'inicial' || modo === 'directa'

  const [cuentas, setCuentas] = useState([])
  const [asesores, setAsesores] = useState([])
  const [secs, setSecs] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [hecho, setHecho] = useState(null)   // { titulo, texto, saleId, avisos, cobro }
  // la boleta o factura del cobro recién hecho, sin salir de aquí (sql/113)
  const [emitirDe, setEmitirDe] = useState(null)   // el depósito, como lo arma agruparPagos
  const [comp, setComp] = useState(null)           // el comprobante ya pedido
  const [verComp, setVerComp] = useState(false)
  const [buscandoPago, setBuscandoPago] = useState(false)

  // ---- cuotas pendientes (cuota) ----
  const pendientes = useMemo(() => (sale ? detail.inst : [])
    .filter(q => q.status !== 'pagado' && Number(q.amount) - Number(q.amount_paid) > 0.004)
    .sort((a, b) => a.installment_number - b.installment_number), [sale, detail])
  const primera = pendientes[0] || null
  const debePrimera = primera ? r2(Number(primera.amount) - Number(primera.amount_paid)) : null

  const [pago, setPago] = useState(() => ({
    file: null, nota: '', fecha: hoyPe(), nroOp: '', cuentaId: '', bancoOrigen: '', opTipo: 'TRANSFERENCIA', obs: '',
    monto: modo === 'cuota' && debePrimera ? debePrimera.toFixed(2) : esInicial ? String(lote.initial_payment_default ?? '') : '',
  }))

  // la inicial o la cuota pagada con VARIOS depositos (25 nov: Yape deja máximo S/ 500
  // por operación, o el cliente trae 3 vouchers para varias cuotas): los vouchers
  // del 2 en adelante. [] = un solo voucher. Cada uno con su uid: cuando le llega un
  // archivo elegido desde el primero (todos a la vez), cambia el uid y su recuadro se
  // vuelve a armar para que la IA lo lea.
  const [extras, setExtras] = useState([])
  const nuevoExtra = (file = null, monto = '') => ({ uid: ++uidVoucher, file, nota: '', fecha: pago.fecha, nroOp: '', cuentaId: '', bancoOrigen: '', opTipo: 'TRANSFERENCIA', obs: '', monto })
  function agregarVouchers(files = []) {
    // los recuadros vacíos se llenan primero; el resto entra hasta el máximo
    if (files.length > MAX_VOUCHERS - 1 - extras.filter(x => x.file).length) avisar('Máximo ' + MAX_VOUCHERS + ' vouchers por cobro: los demás regístralos en otro cobro.')
    setExtras(xs => {
      const lista = [...xs]
      if (!files.length) {
        // un recuadro vacío; en la cuota propone lo que falta para cerrar la cuota que toca
        const suma = r2(Number(pago.monto || 0) + lista.reduce((s, x) => s + Number(x.monto || 0), 0))
        const falta = modo === 'cuota' && debePrimera ? r2(debePrimera - suma) : 0
        return 1 + lista.length < MAX_VOUCHERS ? [...lista, nuevoExtra(null, falta > 0 ? falta.toFixed(2) : '')] : lista
      }
      for (const f of files) {
        const vacio = lista.findIndex(x => !x.file)
        if (vacio >= 0) lista[vacio] = { ...lista[vacio], file: f, uid: ++uidVoucher }
        else if (1 + lista.length < MAX_VOUCHERS) lista.push(nuevoExtra(f))
      }
      return lista
    })
  }
  const setExtra = uid => fn => setExtras(xs => xs.map(x => (x.uid === uid ? (typeof fn === 'function' ? fn(x) : fn) : x)))
  const quitarExtra = uid => setExtras(xs => xs.filter(x => x.uid !== uid))
  const todos = [pago, ...extras]

  // ---- separacion ----
  const [cel, setCel] = useState('')
  const [nombre, setNombre] = useState('')
  const [hallado, setHallado] = useState(null)       // { clientes, lead }
  const [clienteSel, setClienteSel] = useState('nuevo')
  const [vence, setVence] = useState(sumarDias(hoyPe(), 7))
  const [advisorId, setAdvisorId] = useState(sep?.advisor_id || '')
  const [recordarA, setRecordarA] = useState([])

  // ---- inicial ----
  const [titular, setTitular] = useState(() => (sep?.client ? { ...sep.client } : null))
  const [archTit, setArchTit] = useState(null)
  const [co, setCo] = useState(null)                 // null = sin co-comprador
  const [buscandoCo, setBuscandoCo] = useState(false)
  const [archCo, setArchCo] = useState(null)
  const [leyendoDni, setLeyendoDni] = useState({})   // { titular, co }: mientras la IA lee un DNI no se registra
  const [precio, setPrecio] = useState(String(lote.total_price ?? ''))
  const [meses, setMeses] = useState(48)
  // dia de pago (el 1, el 15, fin de mes u otro) y a cuantos meses de la inicial
  // cae la primera cuota: asi se pacta en el contrato
  const [diaOpc, setDiaOpc] = useState('')           // '1' | '15' | '31' | 'otro'
  const [diaOtro, setDiaOtro] = useState('')
  const [aMeses, setAMeses] = useState(1)
  const [comision, setComision] = useState('')
  const [comUrbis, setComUrbis] = useState('')

  // ---- cuadre ----
  const [cuadreTipo, setCuadreTipo] = useState('inicial')

  useEffect(() => {
    supabase.from('financial_accounts').select('id, name, account_number').eq('active', true).eq('project_id', pidOp)
      .then(({ data }) => setCuentas(data || []))
    if (modo === 'separacion' || esInicial) cargarAsesores()
    if (modo === 'separacion') supabase.from('secretaries').select('id, full_name, user_id, tipo').eq('active', true).order('full_name')
      .then(({ data }) => setSecs(data || []))
  }, [])

  function cargarAsesores() {
    return supabase.from('advisors').select('id, code, full_name').eq('active', true).order('code')
      .then(({ data }) => setAsesores(data || []))
  }
  async function nuevoAsesor() {
    // codigo y nombre en un solo dialogo (antes eran dos ventanas seguidas)
    const datos = await pedirDatos({
      titulo: 'Vendedor nuevo',
      campos: [
        { clave: 'code', etiqueta: 'CODIGO corto del vendedor (ej. JUAN)', obligatorio: true },
        { clave: 'nom', etiqueta: 'Nombre completo (opcional)' },
      ],
    })
    if (datos === null) return
    const code = (datos.code || '').trim().toUpperCase()
    if (!code) return
    const nom = (datos.nom || '').trim().toUpperCase()
    const { data, error } = await supabase.from('advisors').insert({ code, full_name: nom || code, active: true }).select().single()
    if (error) { setErr('No se pudo crear el vendedor: ' + error.message); return }
    await cargarAsesores()
    setAdvisorId(data.id)
  }

  // separacion: con el celular completo se busca si ya es cliente o es un lead
  useEffect(() => {
    if (modo !== 'separacion') return
    if (digitos(cel).length < 9) { setHallado(null); setClienteSel('nuevo'); return }
    let vivo = true
    const t = setTimeout(async () => {
      const r = await buscarPorCelular(cel, pidOp)
      if (!vivo) return
      setHallado(r)
      setClienteSel(r.clientes[0]?.id || 'nuevo')
      if (r.lead && !nombre.trim() && pareceNombre(r.lead.full_name)) setNombre(r.lead.full_name)
    }, 400)
    return () => { vivo = false; clearTimeout(t) }
  }, [cel])

  // ---- numeros de la inicial ----
  const sepMonto = sep ? Number(sep.amount) : 0
  const montoInicial = r2(todos.reduce((s, x) => s + Number(x.monto || 0), 0))
  const financiado = r2(Number(precio || 0) - montoInicial - sepMonto)
  const nMeses = parseInt(meses) || 0
  const montos = esInicial && financiado > 0 && nMeses >= 1 && nMeses <= 120 ? repartirCuotas(financiado, nMeses) : []
  const diaPago = parseInt(diaOpc === 'otro' ? diaOtro : diaOpc) || 0
  const diaOk = diaPago >= 1 && diaPago <= 31
  const baseMes = /^\d{4}-\d{2}-\d{2}$/.test(pago.fecha || '') ? pago.fecha : hoyPe()
  const primeraCuota = diaOk ? fechaCuota(baseMes, Number(aMeses) || 0, diaPago) : ''
  // la cuota: con varios vouchers se reparte la suma (lo que se ve) y al registrar cada
  // voucher guarda su parte (planCascadaVarios)
  const montoCobro = montoInicial
  const plan = useMemo(() => (modo === 'cuota' ? planCascada(pendientes, montoCobro) : null), [modo, pendientes, montoCobro])
  const sumaTexto = todos.map(x => soles(x.monto || 0)).join(' + ')

  const tocado = !!(pago.file || extras.length || cel || nombre || archTit || co)
  const cerrar = async () => {
    if (hecho) { onListo(); return }
    if (tocado && !await confirmar('¿Cerrar sin registrar? Se pierde lo que llenaste.', { aceptar: 'Sí, cerrar', cancelar: 'Seguir llenando' })) return
    onClose()
  }

  // los vouchers del 2 en adelante (inicial o cuota): completos, sin repetidos y con
  // N° de operación distinto entre todos
  function validarExtras() {
    for (const [k, x] of extras.entries()) {
      const e = validarPago(x)
      if (e) return 'Voucher ' + (k + 2) + ': ' + e
      if (x.bloqueo) return 'El voucher ' + (k + 2) + ' ya está registrado (mismo N° de operación y monto). Pide la aprobación del superusuario con el botón rojo.'
    }
    const ops = todos.map(x => String(x.nroOp || '').trim().toUpperCase()).filter(o => o && o !== 'SIN-REF')
    const rep = ops.find((o, i) => ops.indexOf(o) !== i)
    if (rep) return 'Dos vouchers tienen el mismo N° de operación (' + rep + '): revisa que no sea el mismo depósito.'
    return null
  }

  function validar() {
    const ePago = validarPago(pago, { voucherObligatorio: modo !== 'cuadre' })
    // voucher repetido (mismo N° de operación y monto) sin aprobar del superusuario (sql/154)
    if (pago.bloqueo) return 'Este voucher ya está registrado (mismo N° de operación y monto). Pide la aprobación del superusuario con el botón rojo de arriba.'
    if (modo === 'separacion') {
      if (!celularValido(cel)) return 'Escribe un celular válido (9 dígitos).'
      if (clienteSel === 'nuevo' && nombre.trim().length < 5) return 'Escribe el nombre completo de quien separa.'
      if (ePago) return ePago
      if (!vence || vence < pago.fecha) return 'La fecha de vencimiento no puede ser antes del pago.'
      if (!advisorId) return 'Elige el vendedor (asesor).'
    }
    if (esInicial) {
      if (!titular) return 'Elige o registra al titular.'
      const ft = faltanParaContrato(titular, archTit)
      if (ft.length) return 'Faltan datos del titular para el contrato: ' + ft.join(', ') + '.'
      if (co) {
        const fc = faltanParaContrato(co, archCo)
        if (fc.length) return 'Faltan datos del co-comprador: ' + fc.join(', ') + '.'
        if (String(co.doc_number).toUpperCase() === String(titular.doc_number).toUpperCase()) return 'El co-comprador no puede tener el mismo documento que el titular.'
      }
      if (ePago) return ePago
      const e2 = validarExtras()
      if (e2) return e2
      if (!(Number(precio) > 0)) return 'Revisa el precio de venta.'
      if (!(nMeses >= 1 && nMeses <= 120)) return 'Número de cuotas inválido (1 a 120).'
      if (!(financiado > 0)) return 'No queda saldo por financiar: revisa precio, inicial y separación.'
      if (!diaOk) return 'Elige el día de pago de las cuotas: el 1, el 15, fin de mes u otro día (del 1 al 31).'
      if (!/^\d{4}-\d{2}-\d{2}$/.test(primeraCuota) || primeraCuota <= pago.fecha || extras.some(x => primeraCuota <= x.fecha)) return 'La primera cuota tiene que vencer después de la fecha de la inicial: elige un mes más adelante.'
      if (!advisorId) return 'Elige el vendedor (asesor).'
    }
    if (modo === 'cuota') {
      if (ePago) return ePago
      const e2 = validarExtras()
      if (e2) return e2
      if (!plan?.parts.length) return 'Monto inválido.'
      if (plan.sobra > 0.01) return 'El monto pasa lo que debe el lote en ' + soles(plan.sobra) + '.'
    }
    if (modo === 'cuadre' && ePago) return ePago
    return null
  }

  // Las filas del pago que se acaba de registrar: se buscan por lote, fecha y N° de
  // operación (las más nuevas), igual que las agrupa la ficha.
  const refDe = (x, n) => ({ op: (String(x.nroOp || '').trim() || 'SIN-REF').toUpperCase(), fecha: x.fecha, n })
  const refPago = n => refDe(pago, n)
  async function abrirEmitir() {
    const c = hecho?.cobro
    if (!c) return
    setBuscandoPago(true)
    const buscar = r => supabase.from('daily_income')
      .select('id, date, amount, income_type, installment_id, installment:installments(installment_number)')
      .eq('lot_id', lote.id).eq('date', r.fecha).eq('operation_number', r.op)
      .order('created_at', { ascending: false }).limit(r.n)
    // el cobro pagado con varios vouchers sale en UN comprobante por el total
    const rs = await Promise.all([c, ...(c.otros || [])].map(buscar))
    setBuscandoPago(false)
    // (vouchers sin N° de operación el mismo día se encuentran más de una vez: una sola fila por pago)
    const data = [...new Map(rs.flatMap(r => r.data || []).map(x => [x.id, x])).values()]
    if (rs.some(r => r.error || !r.data?.length)) { avisar('No encontré el pago recién registrado. Emite el comprobante desde la pestaña Pagos y documentos de la ficha.', { tono: 'error' }); return }
    setEmitirDe({ items: data })
  }

  async function registrar() {
    setErr(null)
    const e = validar()
    if (e) { setErr(e); return }
    setBusy(true)
    try {
      // el lote pudo cambiar mientras se llenaba (otra secretaria lo separo)
      const { data: ahora } = await supabase.from('lots').select('status').eq('id', lote.id).single()
      if (modo === 'separacion' && ahora?.status !== 'disponible') throw new Error('Este lote ya no está disponible (ahora figura ' + (ahora?.status || '?').toUpperCase() + '). Recarga la ficha.')
      if (esInicial && !['disponible', 'separado'].includes(ahora?.status)) throw new Error('Este lote ya no se puede vender (ahora figura ' + (ahora?.status || '?').toUpperCase() + '). Recarga la ficha.')
      // ¿ya está registrado? (mismo día y monto en el lote, o el mismo N° de operación)
      if (modo === 'cuota' || modo === 'cuadre') {
        const avisosDup = await pagosParecidos({ pidOp, loteId: lote.id, fecha: pago.fecha, monto: pago.monto, op: pago.nroOp })
        // los demás vouchers de la cuota también se revisan
        if (modo === 'cuota') for (const [k, x] of extras.entries()) {
          const d = await pagosParecidos({ pidOp, loteId: lote.id, fecha: x.fecha, monto: x.monto, op: x.nroOp })
          avisosDup.push(...d.map(t => 'Voucher ' + (k + 2) + ': ' + t))
        }
        if (avisosDup.length && !await confirmar('⚠ ¿ESTE PAGO YA ESTÁ REGISTRADO?\n\n' + avisosDup.join('\n') +
          '\n\nSi es el MISMO voucher, no lo registres otra vez: ábrelo en la pestaña "Pagos y documentos" y corrígele el N° de operación.',
          { aceptar: 'Es un pago nuevo, registrarlo', cancelar: 'No, revisar primero', peligro: true })) { setBusy(false); return }
      }

      if (modo === 'separacion') {
        await registrarSeparacion({
          pidOp, lote, pago, vence, advisorId, recordarA, secs, profile, leadId: hallado?.lead?.id,
          clienteId: clienteSel !== 'nuevo' ? clienteSel : null,
          nuevaPersona: clienteSel === 'nuevo' ? { nombre, celular: cel } : null,
        })
        const quien = clienteSel !== 'nuevo' ? hallado?.clientes.find(c => c.id === clienteSel) : { full_name: nombre.trim().toUpperCase() }
        setHecho({ titulo: 'Separación registrada', cobro: { ...refPago(1), cliente: quien || null }, texto: `MZ ${lote.mz} LT ${lote.lt} queda SEPARADO hasta el ${fechaPe(vence)}. Los datos del contrato (DNI, dirección…) se piden al cobrar la inicial.` })
      }
      if (esInicial) {
        // el voucher primero: si no sube, no se toca ninguna ficha ni se crea la venta
        const subida = await subirVoucher(pago)
        const subidasExtra = []
        for (const x of extras) subidasExtra.push(await subirVoucher(x))
        const { cliente } = await guardarPersona(titular, archTit)
        const coCli = co ? (await guardarPersona(co, archCo)).cliente : null
        const r = await registrarInicial({
          pidOp, lote, sep, clienteId: cliente.id,
          clientePendienteId: sep && sep.client_id !== cliente.id ? sep.client_id : null,
          coClienteId: coCli?.id || null, pago, subida, extras, subidasExtra, precio, meses: nMeses, primeraCuota, diaPago,
          advisorId, comision, comUrbis, profile, telefonos: [cliente.phone, cliente.phone2],
        })
        setHecho({
          titulo: 'Venta registrada' + (extras.length ? ` (${todos.length} vouchers)` : ''), saleId: r.sale.id,
          // cada voucher de la inicial es una fila: el comprobante sale por todos juntos
          cobro: { ...refPago(1), cliente, otros: extras.map(x => refDe(x, 1)) },
          avisos: r.avisos,
          texto: (extras.length ? `Inicial: ${sumaTexto} = ${soles(montoInicial)}. ` : '')
            + `${cliente.full_name}${coCli ? ' y ' + coCli.full_name : ''} · MZ ${lote.mz} LT ${lote.lt} · ${textoCuotas(montos)}, desde el ${fechaPe(primeraCuota)}, ${textoDiaPago(diaPago)}.`,
        })
      }
      if (modo === 'cuota') {
        // varios vouchers: el primero desde la cuota más antigua y cada uno sigue donde quedó el anterior
        const planes = planCascadaVarios(pendientes, todos.map(x => x.monto))
        await registrarCuota({ pidOp, lote, sale, cobros: todos.map((x, k) => ({ pago: x, plan: planes[k] })), profile })
        setHecho({
          titulo: 'Pago registrado' + (extras.length ? ` (${todos.length} vouchers)` : ''),
          cobro: { ...refPago(planes[0].parts.length), cliente: sale.client || null, otros: extras.map((x, k) => refDe(x, planes[k + 1].parts.length)) },
          texto: (extras.length ? `Vouchers: ${sumaTexto} = ${soles(montoCobro)}. ` : '')
            + plan.parts.map(p => `Cuota N° ${p.q.installment_number}: ${soles(p.take)}${p.resto > 0.004 ? ' (queda debiendo ' + soles(p.resto) + ')' : ' — pagada'}`).join(' · '),
        })
      }
      if (modo === 'cuadre') {
        await registrarCuadre({ pidOp, lote, sale, pago, tipo: cuadreTipo, profile })
        setHecho({ titulo: 'Cuadre registrado', texto: `${cuadreTipo === 'inicial' ? 'Inicial' : 'Separación'} de ${soles(pago.monto)}: ya suma en lo pagado del lote.` })
      }
      savedFx()
    } catch (x) { setErr(x.message || String(x)) }
    setBusy(false)
  }

  // los vouchers del 2 en adelante (inicial y cuota): cada uno con su lectura de la IA
  const otrosVouchers = (pasoBase, de, ayuda) => (
    <div className="cobro-caja">
      {extras.map((x, k) => (
        <div key={x.uid} style={{ marginBottom: 10 }}>
          <p className="fl-lbl" style={{ margin: '0 0 4px' }}>Voucher {k + 2} {de}</p>
          <DatosPago pago={x} setPago={setExtra(x.uid)} cuentas={cuentas} loteId={lote?.id} paso={pasoBase + 2 * k} />
          <button type="button" className="link-btn small" onClick={() => quitarExtra(x.uid)}>quitar voucher {k + 2}</button>
        </div>
      ))}
      {todos.length < MAX_VOUCHERS
        ? <button type="button" className="link-btn" onClick={() => agregarVouchers()}>+ Agregar {extras.length ? 'otro' : 'segundo'} voucher ({ayuda})</button>
        : <p className="muted small">Máximo {MAX_VOUCHERS} vouchers por cobro.</p>}
    </div>
  )

  const Vendedor = (
    <label>Vendedor (asesor) <button type="button" className="link-btn" onClick={nuevoAsesor} title="Registrar un vendedor nuevo, también externo">+ nuevo</button>
      <select value={advisorId} onChange={e => setAdvisorId(e.target.value)}>
        <option value="">- elegir -</option>
        {asesores.map(a => <option key={a.id} value={a.id}>{a.code}{a.full_name && a.full_name !== a.code ? ' - ' + a.full_name : ''}</option>)}
      </select>
    </label>
  )

  return (
    <div className="modal-bg">
      <div className="glass modal cobro-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{TITULO[modo]} · Mz {lote.mz} Lt {lote.lt}</h2>
          <button className="btn-ghost" onClick={cerrar} title="Cerrar">&#10005;</button>
        </div>

        {hecho ? (
          <div className="cobro-hecho">
            <p className="ok cobro-hecho-t">✓ {hecho.titulo}</p>
            <p>{hecho.texto}</p>
            {(hecho.avisos || []).map((a, i) => <p key={i} className="warn">{a}</p>)}
            {!facturaAqui
              ? <p className="muted small">Cuando emitas la boleta o factura SUNAT, súbela en la pestaña <b>Pagos y documentos</b> de la ficha.</p>
              : estaVivo(comp)
                ? <p className="ok small" style={{ textTransform: 'none' }}>🧾 {comp.tipo === 'factura' ? 'Factura' : 'Boleta'} {nombreComprobante(comp)} pedida para este pago. <button type="button" className="link-btn" onClick={() => setVerComp(true)}>Ver / enviar por WhatsApp</button></p>
                : <p className="muted small">{hecho.cobro ? 'Emite ahora su boleta o factura electrónica y envíasela por WhatsApp. También' : 'La boleta o factura electrónica'} se puede emitir después, en la pestaña <b>Pagos y documentos</b> de la ficha, botón <b>🧾 Emitir</b>.</p>}
            <div className="acc-row" style={{ marginTop: 10 }}>
              {facturaAqui && hecho.cobro && !estaVivo(comp) && (
                <button className="btn-primary" onClick={abrirEmitir} disabled={buscandoPago}>{buscandoPago ? 'Buscando el pago…' : '🧾 Emitir boleta o factura'}</button>
              )}
              {hecho.saleId && (onContrato
                ? <button className="btn-primary" onClick={() => onContrato(hecho.saleId)}>&#128196; Generar contrato</button>
                : <Link className="btn-primary" to={`/contratos?venta=${hecho.saleId}`}>&#128196; Generar contrato</Link>)}
              <button className="btn-ghost" onClick={onListo}>Volver a la ficha</button>
            </div>
          </div>
        ) : (
          <form className="form-compact" onSubmit={e => { e.preventDefault(); registrar() }}>
            {/* ======================= SEPARACION ======================= */}
            {modo === 'separacion' && (<>
              <div className={`paso ${celularValido(cel) && (clienteSel !== 'nuevo' || nombre.trim()) ? 'listo' : ''}`}>
                <span className="paso-n">1</span><span className="paso-t">¿Quién separa? Solo nombre y celular: el DNI se pide en la inicial</span>
              </div>
              <div className="form-grid">
                <label>Celular <input value={cel} inputMode="tel" autoFocus placeholder="9 dígitos" onChange={e => setCel(e.target.value)} /></label>
                {clienteSel === 'nuevo'
                  ? <label>Nombre completo <input value={nombre} onChange={e => setNombre(e.target.value)} /></label>
                  : <label>Nombre <div className="dato-fijo"><span className="dato-pin" /><b>{hallado?.clientes.find(c => c.id === clienteSel)?.full_name}</b></div></label>}
              </div>
              {hallado?.clientes.length > 0 && (
                <div className="cobro-caja">
                  <p className="small" style={{ margin: '0 0 4px' }}>Ese celular ya está registrado. ¿Es esta persona?</p>
                  {hallado.clientes.map(c => (
                    <label key={c.id} className="cobro-opcion">
                      <input type="radio" name="clisep" checked={clienteSel === c.id} onChange={() => setClienteSel(c.id)} />
                      <b>{c.full_name}</b> <span className="muted small">{esPendiente(c) ? 'DNI pendiente' : `${c.doc_type} ${c.doc_number}`}</span>
                    </label>
                  ))}
                  <label className="cobro-opcion">
                    <input type="radio" name="clisep" checked={clienteSel === 'nuevo'} onChange={() => setClienteSel('nuevo')} />
                    Es otra persona (usa el mismo celular)
                  </label>
                </div>
              )}
              {hallado?.lead && (
                <p className="hint small">&#128227; Es un lead de WhatsApp: <b>{hallado.lead.full_name}</b> ({String(hallado.lead.status).replace('_', ' ')}). Al separar pasa a <b>en negociación</b> y Campañas lo cuenta.</p>
              )}
              <DatosPago pago={pago} setPago={setPago} cuentas={cuentas} loteId={lote?.id} paso={2}>
                <label>Vence el <input type="date" value={vence} onChange={e => setVence(e.target.value)} /></label>
                {Vendedor}
                {secs.length > 0 && (
                  <div className="span2">
                    <span className="muted small">RECORDAR EL VENCIMIENTO A (va a su control de actividades; tu registro se agrega solo):</span><br />
                    {secs.map(s => (
                      <label key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 14, fontWeight: 400 }}>
                        <input type="checkbox" checked={recordarA.includes(s.id)}
                          onChange={e => setRecordarA(ids => e.target.checked ? [...ids, s.id] : ids.filter(x => x !== s.id))} />
                        {s.tipo === 'gerencia' ? '\u{1F454} ' : ''}{s.full_name}{s.user_id === profile?.id ? ' (tú)' : ''}
                      </label>
                    ))}
                  </div>
                )}
              </DatosPago>
            </>)}

            {/* ======================= INICIAL ======================= */}
            {esInicial && (<>
              <div className={`paso ${titular && !faltanParaContrato(titular, archTit).length ? 'listo' : ''}`}>
                <span className="paso-n">1</span>
                <span className="paso-t">{sep ? 'Titular: la misma persona que separó. Completa los datos del contrato' : '¿Quién compra? Datos del contrato'}</span>
              </div>
              {sep && <p className="hint small" style={{ margin: '0 0 6px' }}>Separó el {fechaPe(sep.date)} con {soles(sep.amount)} (se descuenta del saldo).</p>}
              {!titular ? (
                <div className="cobro-caja">
                  <BuscarCliente onElegir={c => setTitular(c)} />
                  <p className="small" style={{ margin: '6px 0 0' }}>¿No está registrado? <button type="button" className="link-btn" onClick={() => setTitular({ doc_type: 'DNI' })}>+ Persona nueva</button></p>
                </div>
              ) : (
                <div className="cobro-caja">
                  <FormPersona persona={titular} setPersona={setTitular} archivo={archTit} setArchivo={setArchTit} titulo="Titular"
                    onLeyendo={v => setLeyendoDni(l => ({ ...l, titular: v }))} />
                  {!sep && <button type="button" className="link-btn small" onClick={() => { setTitular(null); setArchTit(null) }}>cambiar de persona</button>}
                </div>
              )}

              <div className="cobro-caja">
                {!co && !buscandoCo && <button type="button" className="link-btn" onClick={() => setBuscandoCo(true)}>+ Agregar co-comprador (firma también el contrato)</button>}
                {!co && buscandoCo && (<>
                  <p className="fl-lbl" style={{ margin: '0 0 4px' }}>Co-comprador</p>
                  <BuscarCliente onElegir={c => { setCo(c); setBuscandoCo(false) }} excluir={titular?.id ? [titular.id] : []} />
                  <p className="small" style={{ margin: '6px 0 0' }}>
                    <button type="button" className="link-btn" onClick={() => { setCo({ doc_type: 'DNI' }); setBuscandoCo(false) }}>+ Persona nueva</button>
                    {' · '}<button type="button" className="link-btn" onClick={() => setBuscandoCo(false)}>cancelar</button>
                  </p>
                </>)}
                {co && (<>
                  <FormPersona persona={co} setPersona={setCo} archivo={archCo} setArchivo={setArchCo} titulo="Co-comprador" excluirDoc={titular?.doc_number}
                    onLeyendo={v => setLeyendoDni(l => ({ ...l, co: v }))} />
                  <button type="button" className="link-btn small" onClick={() => { setCo(null); setArchCo(null); setLeyendoDni(l => ({ ...l, co: false })) }}>quitar co-comprador</button>
                </>)}
              </div>

              <DatosPago pago={pago} setPago={setPago} cuentas={cuentas} loteId={lote?.id} paso={2} onOtros={agregarVouchers}>
                <label>Precio de venta S/ <input type="number" step="0.01" value={precio} onChange={e => setPrecio(e.target.value)} /></label>
                <label>N° de cuotas <input type="number" min="1" max="120" value={meses} onChange={e => setMeses(e.target.value)} /></label>
                <label>Día de pago
                  <select value={diaOpc} onChange={e => setDiaOpc(e.target.value)}>
                    <option value="">— elige —</option>
                    <option value="1">El 1 de cada mes</option>
                    <option value="15">El 15 de cada mes</option>
                    <option value={String(FIN_DE_MES)}>Fin de mes (último día)</option>
                    <option value="otro">Otro día…</option>
                  </select>
                </label>
                {diaOpc === 'otro' && <label>¿Qué día? (1 a 31) <input type="number" min="1" max="31" value={diaOtro} onChange={e => setDiaOtro(e.target.value)} placeholder="Ej: 5" /></label>}
                <label>Primera cuota en
                  <select value={aMeses} onChange={e => setAMeses(Number(e.target.value))}>
                    {mesesParaPrimera(baseMes).map((o, k) => <option key={o.valor} value={k}>{o.etiqueta}</option>)}
                  </select>
                </label>
                {Vendedor}
                <label>Comisión asesor S/ <input type="number" step="0.01" min="0" value={comision} onChange={e => setComision(e.target.value)} placeholder="0.00" /></label>
                <label>Comisión Urbis S/ <input type="number" step="0.01" min="0" value={comUrbis} onChange={e => setComUrbis(e.target.value)} placeholder="0.00" /></label>
              </DatosPago>
              {otrosVouchers(4, 'de la inicial', 'la inicial se pagó con varios depósitos')}
              <div className="cobro-resumen">
                <p style={{ margin: 0 }}>
                  Precio {soles(precio)}{sep ? <> − separación {soles(sepMonto)}</> : null} − inicial {soles(montoInicial)}{extras.length ? <> ({sumaTexto})</> : null} = <b>{soles(financiado)}</b> a financiar
                </p>
                {montos.length > 0
                  ? (primeraCuota
                    ? <p style={{ margin: '4px 0 0' }}>&#128197; <b>{textoCuotas(montos)}</b>, {textoDiaPago(diaPago)}: la primera el <b>{fechaPe(primeraCuota)}</b> y la última el {fechaPe(fechaCuota(primeraCuota, montos.length - 1, diaPago))}. <span className="muted small">(cuotas redondeadas al sol; la última absorbe la diferencia)</span></p>
                    : <p className="warn" style={{ margin: '4px 0 0' }}>&#128197; {textoCuotas(montos)}. Elige el <b>día de pago</b> para ver las fechas.</p>)
                  : <p className="warn" style={{ margin: '4px 0 0' }}>Completa precio, inicial y cuotas para ver el cronograma.</p>}
              </div>
            </>)}

            {/* ======================= CUOTA ======================= */}
            {modo === 'cuota' && (<>
              <p className="muted small" style={{ margin: '0 0 6px' }}>
                Cliente: <b>{sale.client?.full_name}</b>
                {primera ? <> · toca la cuota N° {primera.installment_number}: <b>{soles(debePrimera)}</b>, vence {fechaPe(primera.due_date)}</> : ' · no tiene cuotas pendientes'}
              </p>
              {/* con varios vouchers el cotejo de la cuota va abajo, con la suma de todos */}
              <DatosPago pago={pago} setPago={setPago} cuentas={cuentas} loteId={lote?.id} paso={1} onOtros={agregarVouchers}
                esperado={primera && !extras.length ? { monto: debePrimera, n: primera.installment_number } : null} />
              {otrosVouchers(3, 'de este pago', 'pagó en varias operaciones, ej. Yape de máximo S/ 500')}
              {extras.length > 0 && primera && extras.some(x => Number(x.monto) > 0) && (
                Math.abs(montoCobro - debePrimera) < 0.05
                  ? <div className="cotejo ok">✓ <b>Los {todos.length} vouchers suman {soles(montoCobro)}</b> ({sumaTexto}): coincide con la cuota N° {primera.installment_number}.</div>
                  : montoCobro > debePrimera
                    ? <div className="cotejo ok">✓ <b>Los {todos.length} vouchers suman {soles(montoCobro)}</b> ({sumaTexto}): cubren la cuota N° {primera.installment_number} ({soles(debePrimera)}) y lo demás sigue con las cuotas siguientes. Abajo ves cómo se aplica.</div>
                    : <div className="cotejo dif">⚠ <b>Los {todos.length} vouchers suman {soles(montoCobro)}</b> ({sumaTexto}) y la cuota N° {primera.installment_number} debe <b>{soles(debePrimera)}</b>: falta {soles(debePrimera - montoCobro)}. Puedes registrarlo igual si es correcto.</div>
              )}
              {plan?.parts.length > 0 && (
                <div className="cobro-resumen">
                  <p style={{ margin: '0 0 4px' }}>Se aplicará así (de la cuota más antigua a la más nueva){extras.length ? <>, con los {todos.length} vouchers: <b>{soles(montoCobro)}</b></> : null}:</p>
                  {plan.parts.map(p => (
                    <p key={p.q.id} style={{ margin: '2px 0' }}>
                      &#8594; Cuota N° {p.q.installment_number} (vence {fechaPe(p.q.due_date)}): {soles(p.take)}
                      {p.resto > 0.004 ? <b className="warn"> — quedará debiendo {soles(p.resto)}</b> : <b className="ok"> — queda pagada</b>}
                    </p>
                  ))}
                  {plan.sobra > 0.01 && <p className="error">Sobran {soles(plan.sobra)}: pasa lo que debe el lote.</p>}
                </div>
              )}
            </>)}

            {/* ======================= CUADRE (superusuario) ======================= */}
            {modo === 'cuadre' && puedeCorregir && (<>
              <div className="cobro-caja" style={{ borderLeft: '3px solid #e0b34c' }}>
                <p className="small" style={{ margin: 0 }}>Registra una <b>inicial</b> o <b>separación</b> que no se cargó en la migración, sobre esta venta. Entra a caja ligada a la venta y suma en lo pagado. <b>No crea venta ni toca el cronograma.</b></p>
                <div className="acc-row" style={{ marginTop: 6 }}>
                  {[['inicial', 'Inicial'], ['separacion', 'Separación']].map(([v, l]) => (
                    <button type="button" key={v} className={`chip ${cuadreTipo === v ? 'on' : ''}`} style={{ margin: 0 }} onClick={() => setCuadreTipo(v)}>{l}</button>
                  ))}
                </div>
                <p className="hint small" style={{ margin: '6px 0 0' }}>
                  Ya registrado en caja: inicial {soles(detail.iniPagado)} · separación {soles(detail.sepPagado)}.
                  {cuadreTipo === 'inicial' && detail.iniPagado > 0 && <b className="bad"> Ojo: ya tiene inicial, no la dupliques.</b>}
                  {cuadreTipo === 'separacion' && detail.sepPagado > 0 && <b className="bad"> Ojo: ya tiene separación, no la dupliques.</b>}
                </p>
              </div>
              <DatosPago pago={pago} setPago={setPago} cuentas={cuentas} loteId={lote?.id} paso={1} voucherObligatorio={false} />
            </>)}

            {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
            <div className="acc-row" style={{ marginTop: 12 }}>
              <button className="btn-primary" disabled={busy || (esInicial && (leyendoDni.titular || leyendoDni.co)) || (modo === 'cuota' && plan?.sobra > 0.01)}>
                {busy ? 'Registrando…' : esInicial && (leyendoDni.titular || leyendoDni.co) ? 'Leyendo el DNI…' : modo === 'separacion' ? 'Registrar separación' : esInicial ? 'Registrar venta e inicial' : modo === 'cuadre' ? 'Registrar cuadre' : 'Registrar pago'}
              </button>
              <button type="button" className="btn-ghost" onClick={cerrar} disabled={busy}>Cancelar</button>
            </div>
          </form>
        )}
      </div>
      {emitirDe && (
        <EmitirComprobante grupo={emitirDe} proyecto={proyecto} lote={lote} cliente={hecho?.cobro?.cliente || null}
          totalCuotas={modo === 'cuota' && detail.inst?.length ? Math.max(...detail.inst.map(i => i.installment_number)) : null}
          onCerrar={() => setEmitirDe(null)} onListo={c => setComp(c)} />
      )}
      {verComp && comp && (
        <ComprobanteDetalle comprobante={comp} proyecto={proyecto} onCerrar={() => setVerComp(false)} onCambio={c => setComp(c)} />
      )}
    </div>
  )
}
