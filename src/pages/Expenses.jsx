import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { upload, subirRuta } from '../lib/archivos'
import { useMsg } from '../lib/saveFx'
// "preguntar" = confirmar de lib/dialogos: aquí ya hay una función confirmar(g) (el dinero se entregó)
import { avisar, confirmar as preguntar, pedir } from '../lib/dialogos'
import { fechaLetras } from '../lib/letras'
import { DEFAULT_GASTO_TEMPLATE, estadoGasto, numeroGasto, constanciaGasto, HojaConstancia } from '../components/ConstanciaGasto'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'
import VisorDoc from '../components/VisorDoc'
import FirmaPad from '../components/FirmaPad'
import AprobarGasto from '../components/AprobarGasto'
import RegistrarPago from '../components/RegistrarPago'
import ReponerGasto from '../components/ReponerGasto'
import { useEsCelular } from '../lib/useEsCelular'

// la fecha de HOY en Lima: con la hora UTC, después de las 7 pm salía la de mañana
const hoy = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10)
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const TIPOS = ['PAGO DE COMISION', 'GASTOS DE DESARROLLO', 'GASTOS ADMINISTRATIVOS', 'OTROS']
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']

// Documentos que se pueden dar por NO APLICABLES (sql/66), casillero por
// casillero: un gasto viejo puede tener la factura y no la constancia.
const NA = { request_doc_url: 'request_doc_na', receipt_url: 'receipt_na', voucher_url: 'voucher_na' }
const naDe = campo => NA[campo]
const naMotivo = campo => NA[campo] + '_reason'
const LBL_DOC = { request_doc_url: 'la constancia firmada', receipt_url: 'el RH o la factura', voucher_url: 'el voucher del pago' }
// Motivos sacados de por que pasa de verdad. Si cada uno lo escribe a su manera,
// despues no se pueden contar ni explicarle al contador por que faltan.
const MOTIVOS_NA = [
  'GESTION ANTERIOR - el gasto es previo a este sistema',
  'GASTO ANTIGUO SIN RESPALDO - nunca se emitio',
  'PAGADO EN EFECTIVO - no hay voucher que subir',
  'DOCUMENTO EN FISICO - firmado en papel, no se escaneo',
  'EL PROVEEDOR NO EMITIO COMPROBANTE',
]

const GASTO_VARS = ['RECEPTOR','RECEPTOR_DNI','REMITENTE','REMITENTE_DNI','FECHA_LETRAS','MONTO','MONTO_LETRAS','MOTIVO','TIPO','PROYECTO','DESCUENTO','NUMERO']
const GASTO_BLOQUES = ['TABLA_DETALLE','FIRMA_RECEPTOR']

// la plantilla base, el estado real de una solicitud y la constancia viven en
// components/ConstanciaGasto (los usa también la pantalla de facturación, sql/145)
// adelantado por alguien, sin devolver todavía y no rechazado (sql/125)
const faltaReponer = g => !!g.adelanto_por && !g.reposicion_id && !g.rejected_at

export default function Expenses() {
  // puedeCorregir = superusuario u operador (corregir, reemplazar, plantilla);
  // esJefe suma al administrador; esSuper queda para lo que es solo del dueño
  const { profile, role, esSuper, puedeCorregir, esJefe } = useAuth()
  const { pidOp } = useProject()
  const readOnly = ['manager', 'socio'].includes(role)
  const esSocio = role === 'socio'
  // la APROBACIÓN FIRMADA es SOLO de la socia del proyecto (sql/136, 10 oct): ni el
  // superusuario ni la oficina, o la segunda firma no controlaría nada
  const puedeAprobar = role === 'socio'
  // registrar el pago con su voucher: la socia, o el superusuario si hace falta (sql/101)
  const puedePagar = ['socio', 'superuser'].includes(role)
  const [aprobar, setAprobar] = useState(null)          // { g, modo } solicitud abierta para firmar
  const [pagar, setPagar] = useState(null)              // solicitud aprobada a la que la socia le sube el comprobante
  const esCelular = useEsCelular()                      // en el celular la tabla ancha se vuelve tarjetas
  const [miFirma, setMiFirma] = useState(null)          // firma recien registrada (el perfil del contexto no se recarga solo)
  const [cambiarFirma, setCambiarFirma] = useState(false)
  const [firmaBusy, setFirmaBusy] = useState(false)
  const [verif, setVerif] = useState(null)              // huellas de las dos firmas (verificar_gasto)
  const [firmantes, setFirmantes] = useState([])        // a quien se le puede pedir la firma en este proyecto
  const [personas, setPersonas] = useState([])          // personas del proyecto con su DNI (sql/87)
  const [proyecto, setProyecto] = useState(null)
  const [list, setList] = useState([])
  const [msg, setMsg] = useMsg(null)
  const [verDoc, setVerDoc] = useState(null)   // { url, titulo } del documento abierto
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)
  const [fq, setFq] = useState('')
  const [ftipo, setFtipo] = useState('todos')
  const [fest, setFest] = useState('todos')
  const [fanio, setFanio] = useState('todos')
  const [fmes, setFmes] = useState('todos')
  const [f, setF] = useState({})
  const [paso, setPaso] = useState(1)                   // la solicitud se llena por pasos (1 a 4)
  const [faltaPaso, setFaltaPaso] = useState('')        // lo que falta para pasar al siguiente
  const [conDetalle, setConDetalle] = useState(false)   // la tabla de detalle, opcional
  const [editTexto, setEditTexto] = useState(false)     // el texto de ESTA constancia, abierto para editar (sql/143)
  const [editId, setEditId] = useState(null)
  const [prt, setPrt] = useState(null)
  const [tplOpen, setTplOpen] = useState(false)
  const [tplText, setTplText] = useState('')
  // REPOSICIONES (sql/125): devolverle el dinero a quien adelantó un gasto
  const [reposiciones, setReposiciones] = useState({})  // id -> reposición
  const [hay125, setHay125] = useState(false)           // la tabla existe: si no, nada de esto se muestra
  const [reponer, setReponer] = useState(null)          // { persona, ids } ventana abierta

  async function load() {
    if (!pidOp) return
    const [g, p, r] = await Promise.all([
      supabase.from('expenses').select('*').eq('project_id', pidOp).order('issue_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('projects').select('*').eq('id', pidOp).single(),
      supabase.from('expense_reposiciones').select('*').eq('project_id', pidOp).order('fecha', { ascending: false }),
    ])
    setList(g.data || []); setProyecto(p.data || null)
    setHay125(!r.error); setReposiciones(Object.fromEntries((r.data || []).map(x => [x.id, x])))
    setTplText((p.data?.expense_template) || DEFAULT_GASTO_TEMPLATE)
  }
  useEffect(() => { load() }, [pidOp])
  // a quien se le puede pedir la firma de solicitante en este proyecto (sql/74).
  // Va por RPC y no por consulta a profiles: la secretaria no puede leer la
  // tabla de usuarios entera, y para elegir solo necesita los nombres.
  useEffect(() => {
    if (!pidOp || readOnly) return
    supabase.rpc('firmantes_gasto', { pid: pidOp }).then(({ data }) => setFirmantes(data || []), () => setFirmantes([]))
    // todas las personas del proyecto CON su DNI (sql/87): sirven para llenar
    // solos al que recibe y al que entrega el dinero, socios incluidos
    supabase.rpc('personas_gasto', { pid: pidOp }).then(({ data }) => setPersonas(data || []), () => setPersonas([]))
  }, [pidOp, readOnly])
  useEffect(() => {
    setVerif(null)
    if (!prt?.approved_at && !prt?.requester_signed_at) return
    supabase.rpc('verificar_gasto', { eid: prt.id }).then(({ data }) => setVerif(data || null), () => {})
  }, [prt])

  // años que existen de verdad en los gastos del proyecto (no una lista fija)
  const anios = useMemo(
    () => [...new Set(list.map(g => String(g.issue_date || g.reception_date || '').slice(0, 4)).filter(Boolean))].sort().reverse(),
    [list])

  const filtrada = useMemo(() => {
    const t = fq.trim().toLowerCase()
    return list.filter(g => {
      if (ftipo !== 'todos' && g.type !== ftipo) return false
      const fecha = String(g.issue_date || g.reception_date || '')
      if (fanio !== 'todos' && fecha.slice(0, 4) !== fanio) return false
      if (fmes !== 'todos' && fecha.slice(5, 7) !== fmes) return false
      if (fest === 'solicitado' && g.status !== 'solicitado') return false
      if (fest === 'confirmado' && g.status !== 'confirmado') return false
      if (fest === 'por_aprobar' && estadoGasto(g) !== 'solicitado') return false
      if (fest === 'por_firmar' && estadoGasto(g) !== 'por_firmar') return false
      if (fest === 'aprobado' && estadoGasto(g) !== 'aprobado') return false
      if (fest === 'rechazado' && estadoGasto(g) !== 'rechazado') return false
      // un gasto marcado NO APLICA no es un faltante: no tiene que aparecer aqui
      if (fest === 'falta_rh' && (g.status !== 'confirmado' || g.receipt_url || g.receipt_na)) return false
      if (fest === 'no_aplica' && !(g.request_doc_na || g.receipt_na || g.voucher_na)) return false
      if (fest === 'falta_reponer' && !faltaReponer(g)) return false
      if (!t) return true
      return [g.company, g.recipient, g.sender, g.adelanto_por, g.description, g.document_number, g.request_number ? 'sol-' + String(g.request_number).padStart(5, '0') : '']
        .some(x => (x || '').toLowerCase().includes(t))
    })
  }, [list, fq, ftipo, fest, fanio, fmes])
  const total = filtrada.reduce((s, g) => s + Number(g.amount), 0)
  const pendConfirmar = list.filter(g => g.status === 'solicitado').length
  const porAprobar = list.filter(g => estadoGasto(g) === 'solicitado').length
  const porFirmar = list.filter(g => estadoGasto(g) === 'por_firmar').length
  // las que me tocan a MI: mientras existan, la pantalla me ofrece registrar mi firma
  // Dos firmas, dos personas (sql/100): la de la solicitud es SOLO de quien pide el
  // gasto (el superusuario ya no la firma "de respaldo") y quien lo pidió no lo aprueba.
  const miPuedeFirmar = g => estadoGasto(g) === 'por_firmar' && g.requester_id === profile?.id
  // en los proyectos con firma de socio, una solicitud sin "quien la pide" no se
  // aprueba: primero se corrige (sql/136)
  const sinSolicitante = g => !!proyecto?.expense_approval && !g.requester_id && estadoGasto(g) === 'solicitado'
  const miPuedeAprobar = g => puedeAprobar && estadoGasto(g) === 'solicitado' && !sinSolicitante(g) && g.requester_id !== profile?.id
  // Tercer paso en los proyectos con aprobación (sql/101): aprobada la solicitud, la
  // socia paga y sube el comprobante. Hasta entonces el gasto está "pago pendiente".
  const pagoPendiente = g => !!proyecto?.expense_approval && estadoGasto(g) === 'aprobado'
  const miPuedePagar = g => puedePagar && pagoPendiente(g) && g.requester_id !== profile?.id
  const miasPorFirmar = list.filter(miPuedeFirmar).length
  const nombreFirmante = g => firmantes.find(p => p.id === g.requester_id)?.full_name || g.requester_name || 'quien la pidió'
  // el primer nombre; sin nombre (el socio no carga la lista de firmantes) no se corta la frase
  const primerFirmante = g => { const n = nombreFirmante(g); return n === 'quien la pidió' ? n : n.split(' ')[0] }
  // lo que me toca AHORA: mi firma como quien pide, la aprobación del socio o
  // (la socia) subir el comprobante. Va arriba, con su botón, para no buscar la fila.
  const pendientesMias = list.flatMap(g => {
    const e = estadoGasto(g)
    if (e === 'por_firmar' && miPuedeFirmar(g)) return [{ g, modo: 'solicitar' }]
    if (miPuedeAprobar(g)) return [{ g, modo: 'aprobar' }]
    if (esSocio && miPuedePagar(g)) return [{ g, modo: 'pagar' }]
    return []
  })
  const tengoFirma = miFirma || profile?.signature_url
  const hay74 = firmantes.length > 0      // la RPC de sql/74 respondio: la segunda firma existe
  // el socio registra su firma apenas entra, aunque no haya nada pendiente:
  // cuando llegue la primera solicitud no tiene que aprender dos cosas a la vez
  const meToca = esSocio || miasPorFirmar > 0
  const faltaRH = list.filter(g => g.status === 'confirmado' && !g.receipt_url && !g.receipt_na).length
  // lo que alguien adelantó con su dinero y todavía no se le devolvió, por persona
  const porReponer = list.filter(faltaReponer)
  const deudaPorPersona = Object.values(porReponer.reduce((m, g) => {
    const k = g.adelanto_por
    m[k] = m[k] || { persona: k, ids: [], total: 0 }
    m[k].ids.push(g.id); m[k].total += Number(g.amount || 0)
    return m
  }, {})).sort((a, b) => b.total - a.total)
  const totalPorReponer = porReponer.reduce((x, g) => x + Number(g.amount || 0), 0)
  // suben la reposición la oficina y la socia del proyecto (cualquiera de las dos)
  const puedeReponer = hay125 && (['admin', 'secretary', 'superuser', 'operador'].includes(role) || esSocio)
  const noAplican = list.filter(g => g.request_doc_na || g.receipt_na || g.voucher_na).length

  function abrirEditar(g) {
    setF({
      type: g.type, issue_date: g.issue_date, amount: g.amount,
      recipient: g.recipient, recipient_dni: g.recipient_dni, sender: g.sender, sender_dni: g.sender_dni || '',
      requester_id: g.requester_id || '',
      discount_from: g.discount_from, payment_method: g.payment_method,
      document_type: g.document_type, description: g.description, detail: g.detail,
      adelanto_por: g.adelanto_por || '',
      plantilla_propia: g.plantilla_propia || '',
    })
    setEditTexto(false)
    setEditId(g.id); setShow(true); setMsg(null)
    setPaso(1); setFaltaPaso(''); setConDetalle(!!g.detail)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function guardar(e) {
    e.preventDefault()
    // por pasos: Enter o "Siguiente" en los pasos 1 a 3 solo avanza
    if (paso < 4) { irAPaso(paso + 1); return }
    for (const n of [1, 2, 3]) { const t = faltaEn(n); if (t) { setPaso(n); setFaltaPaso(t); return } }
    setBusy(true); setMsg(null)
    try {
      const up = x => (x || '').toUpperCase().trim() || null
      // el solicitante elegido manda sobre el texto: su nombre es el que sale en
      // la constancia y el que tiene que coincidir con la firma. Si no se eligio
      // a nadie (gasto viejo, o proyecto sin el circuito) se respeta el texto.
      const firm = firmantes.find(p => p.id === f.requester_id)
      const campos = {
        type: f.type || 'OTROS', issue_date: f.issue_date || hoy(),
        recipient: up(f.recipient), recipient_dni: (f.recipient_dni || '').trim() || null,
        // quien ENTREGA el dinero (el remitente de la constancia) es un dato
        // propio: antes se copiaba el nombre de quien firma la solicitud, que
        // casi siempre es OTRA persona — justamente la que recibe (sql/87)
        // con firma de socio y una sola socia, ella entrega: su nombre y su DNI (sql/136)
        sender: sociaFija ? up(sociaFija.full_name) : up(f.sender),
        sender_dni: (sociaFija?.dni || f.sender_dni || '').trim() || null,
        amount: Number(f.amount),
        // la columna solo se manda si sql/74 esta corrido (si no, firmantes_gasto
        // no responde y la lista queda vacia). Sin esto, un panel desplegado
        // antes que la migracion dejaria a la secretaria sin poder registrar
        // gastos: el insert entero se cae por una columna que todavia no existe.
        ...(hay74 ? { requester_id: f.requester_id || null } : {}),
        document_type: up(f.document_type), payment_method: up(f.payment_method) || 'EFECTIVO',
        description: up(f.description), discount_from: f.discount_from || 'URBIS GROUP',
        detail: (f.detail || '').trim() || null,
      }
      // quién adelantó el dinero (sql/125). Ya repuesto, no se cambia desde aquí.
      if (hay125 && !(editId && list.find(x => x.id === editId)?.reposicion_id)) campos.adelanto_por = up(f.adelanto_por)
      // el texto propio de ESTA constancia (sql/143): vacío = la plantilla del proyecto.
      // Se manda si se escribió algo o si la base ya tiene la columna.
      const filaAntes = editId ? list.find(x => x.id === editId) : null
      if ((f.plantilla_propia || '').trim() || (filaAntes && 'plantilla_propia' in filaAntes)) campos.plantilla_propia = (f.plantilla_propia || '').trim() || null
      // si todavía no se corrió sql/87 (sender_dni) o sql/143 (plantilla_propia), esa
      // columna no existe: se reintenta sin ella en vez de dejar a nadie sin poder
      // registrar el gasto
      let sinTexto = false
      const sinDni = o => { const c = { ...o }; delete c.sender_dni; if ('plantilla_propia' in c) { delete c.plantilla_propia; sinTexto = true } return c }
      const faltaCol = e => /sender_dni|plantilla_propia/i.test(e?.message || '')

      if (editId) {
        // corrige la MISMA solicitud: conserva el correlativo (request_number).
        // Las firmas eran sobre OTROS datos: se anulan las dos y la solicitud
        // vuelve a recorrer el camino (solicitante -> socio). Si estaba
        // rechazada, corregirla la reenvia.
        const antes = list.find(x => x.id === editId)
        const firmadas = [
          antes?.requester_signed_at && 'la FIRMA de ' + (antes.requester_name || 'quien la pidió'),
          antes?.approved_at && 'la APROBACIÓN de ' + (antes.approved_name || 'el socio'),
        ].filter(Boolean)
        if (firmadas.length && !await preguntar('Esta solicitud ya tiene ' + firmadas.join(' y ') + '.\n\nSi la corriges se ANULA' + (firmadas.length > 1 ? 'n' : '') + ' y hay que volver a firmarla desde el principio.\n\n¿Corregir igual?')) { setBusy(false); return }
        const reinicio = antes && 'approved_at' in antes ? {
          approved_by: null, approved_at: null, approved_name: null, approval_signature_url: null, approval_hash: null, approval_code: null,
          rejected_by: null, rejected_at: null, rejected_reason: null, approval_notified_at: null, decision_notified_at: null,
          ...(antes && 'requester_signed_at' in antes ? {
            requester_signed_at: null, requester_name: null, requester_signature_url: null,
            requester_hash: null, requester_code: null, requester_notified_at: null,
          } : {}),
        } : {}
        let { error } = await supabase.from('expenses').update({ ...campos, ...reinicio }).eq('id', editId)
        if (error && faltaCol(error)) ({ error } = await supabase.from('expenses').update({ ...sinDni(campos), ...reinicio }).eq('id', editId))
        if (error) throw new Error(error.message)
        setMsg({ ok: !sinTexto, t: 'SOLICITUD CORREGIDA \u2014 se mantiene el mismo correlativo. Ya puedes imprimirla.' + (sinTexto ? ' OJO: el texto propio de la constancia NO se guard\u00f3 (falta correr sql/143).' : '') })
      } else {
        const base = { project_id: pidOp, company: 'URBIS GROUP', status: 'solicitado', registered_by: profile?.id }
        let { data: creado, error } = await supabase.from('expenses')
          .insert({ ...base, ...campos }).select('request_number').single()
        if (error && faltaCol(error)) {
          ({ data: creado, error } = await supabase.from('expenses')
            .insert({ ...base, ...sinDni(campos) }).select('request_number').single())
        }
        if (error) throw new Error(error.message)
        setMsg({
          ok: true,
          t: 'SOLICITUD ' + (creado?.request_number ? 'N\u00B0 SOL-' + String(creado.request_number).padStart(5, '0') + ' ' : '') + 'REGISTRADA. '
            + (firm ? (firm.id === profile?.id ? 'F\u00CDRMALA T\u00DA CON "\u270D FIRMAR" Y PASA AL SOCIO.' : 'SE LE AVISA A ' + (firm.full_name || '').split(' ')[0] + ' PARA QUE LA FIRME.')
                    : 'IMPRIME LA CONSTANCIA Y HAZLA FIRMAR.')
            + (sinTexto ? ' OJO: el texto propio de la constancia NO se guard\u00F3 (falta correr sql/143).' : ''),
        })
      }
      setF({}); setEditId(null); setShow(false); load()
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + err.message }) }
    setBusy(false)
  }

  async function guardarFirma(file) {
    setFirmaBusy(true)
    try {
      const url = await subirRuta('firmas/' + profile.id + '-' + Date.now() + '.png', file, { comprimir: false, abrirWord: false })
      const { error } = await supabase.rpc('guardar_mi_firma', { url })
      if (error) throw new Error(/guardar_mi_firma/.test(error.message) ? 'Falta correr sql/73 en la base.' : error.message)
      setMiFirma(url); setCambiarFirma(false)
      setMsg({ ok: true, t: 'FIRMA REGISTRADA. Ya puedes firmar solicitudes.' })
    } catch (e) { setMsg({ ok: false, t: 'ERROR: ' + e.message }) }
    setFirmaBusy(false)
  }

  async function toggleAprobacion(on) {
    const { error } = await supabase.from('projects').update({ expense_approval: on }).eq('id', pidOp)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setProyecto(p => ({ ...p, expense_approval: on }))
    setMsg({ ok: true, t: on ? 'DESDE AHORA LOS GASTOS DE ESTE PROYECTO NECESITAN LA FIRMA DE UN SOCIO ANTES DE PAGARSE' : 'APROBACIÓN DE SOCIO DESACTIVADA EN ESTE PROYECTO' })
  }

  async function confirmar(g) {
    if (g.rejected_at) { await avisar('Esta solicitud fue RECHAZADA por ' + (g.rejected_reason ? 'este motivo:\n\n' + g.rejected_reason : 'el socio') + '\n\nCorrígela con "editar" para reenviarla.', { tono: 'error' }); return }
    // si se eligio un solicitante, se espera su firma — exija o no el proyecto la
    // del socio. Elegirlo ES pedirle la firma; si no, el selector se deja vacio.
    if (g.requester_id && !g.requester_signed_at) {
      await avisar('Falta la firma de ' + (g.sender || 'quien pidió el gasto') + '.'
        + (proyecto?.expense_approval ? '\n\nEste proyecto exige las DOS firmas: primero la de quien pide el gasto, después la del socio.' : '\n\nEsta solicitud espera su firma en el panel.'))
      return
    }
    if (proyecto?.expense_approval && !g.approved_at) { await avisar('Falta la aprobación del socio.\n\nEste proyecto exige que un socio revise y firme la solicitud antes de entregar el dinero.'); return }
    if (!await preguntar(`Confirmar que el dinero de "${g.description || g.type}" (${soles(g.amount)}) ya se entrego?`)) return
    await supabase.from('expenses').update({
      status: 'confirmado', reception_date: hoy(),
      confirmed_at: new Date().toISOString(), confirmed_by: profile?.id,
    }).eq('id', g.id)
    setMsg({ ok: true, t: 'PAGO CONFIRMADO. Sube el RH o factura.' }); load()
  }

  async function subirDoc(g, file, campo, carpeta) {
    try {
      // todo documento se sube con su nota/comentario
      const nota = await pedir('Comentario / nota de este documento (opcional, Enter para saltar):')
      if (nota === null) return   // cancelo: no se sube nada
      const url = await upload(`gastos/${carpeta}/${g.id}`, file)
      // si el documento aparecio, la marca de "no aplica" sobra: se limpia sola
      const { error } = await supabase.from('expenses').update({
        [campo]: url, [campo.replace('_url', '_note')]: nota.trim() || null,
        [naDe(campo)]: false, [naMotivo(campo)]: null,
      }).eq('id', g.id)
      // el update NO lanza: devuelve el error. Ignorarlo costo dias de "DOCUMENTO
      // SUBIDO" con el archivo en R2 pero la URL sin guardar (faltaba receipt_note,
      // sql/68) — y nadie vio nada raro hasta que un gasto salio sin su RH.
      if (error) throw new Error(error.message)
      setMsg({ ok: true, t: 'DOCUMENTO SUBIDO' }); load()
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + err.message }) }
  }

  // editar/agregar la nota de un documento de gasto ya subido
  async function notaDoc(g, campo) {
    const kn = campo.replace('_url', '_note')
    const nota = await pedir('Comentario / nota de este documento:', { tipo: 'largo', valor: g[kn] || '' })
    if (nota === null) return
    const { error } = await supabase.from('expenses').update({ [kn]: nota.trim() || null }).eq('id', g.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setMsg({ ok: true, t: 'NOTA GUARDADA' }); load()
  }

  // ---- DOCUMENTO QUE NO APLICA (sql/66) ----
  // Marcar un faltante como "nunca va a llegar" no es esconder un problema: es lo
  // contrario. El aviso ⚠ deja de significar algo cuando arrastra veinte gastos de
  // otra gestion que jamas se van a completar, y entonces tampoco se ve el gasto de
  // esta semana al que si le falta el documento. Por eso el motivo es obligatorio y
  // queda en bitacora con quien lo marco.
  const puedeNA = esJefe   // administrador, superusuario y operador

  const anotarNA = (g, campo, motivo, marcado) => supabase.from('activity_log').insert({
    action: 'UPDATE', entity_type: 'expenses', entity_id: g.id, user_email: profile?.email || null,
    details: {
      cambio: marcado ? 'documento_no_aplica' : 'documento_vuelve_a_pedirse',
      documento: LBL_DOC[campo], motivo,
      solicitud: g.request_number ? 'SOL-' + String(g.request_number).padStart(5, '0') : null,
      monto: Number(g.amount), receptor: g.recipient, fecha_gasto: g.issue_date, project_id: pidOp,
    },
  })

  async function marcarNoAplica(g, campo) {
    const doc = LBL_DOC[campo]
    const lista = MOTIVOS_NA.map((m, i) => `${i + 1}. ${m}`).join('\n')
    const r = await pedir(`¿Por que este gasto no va a tener ${doc}?\n\n${lista}\n\nEscribe el NUMERO del motivo, o el motivo con tus palabras:`)
    if (r === null) return
    const t = (r || '').trim()
    if (!t) { setMsg({ ok: false, t: 'HACE FALTA EL MOTIVO: sin el, dentro de un año nadie va a saber por que falta.' }); return }
    const n = Number(t)
    const motivo = (Number.isInteger(n) && n >= 1 && n <= MOTIVOS_NA.length) ? MOTIVOS_NA[n - 1] : t.toUpperCase()
    const { error } = await supabase.from('expenses')
      .update({ [naDe(campo)]: true, [naMotivo(campo)]: motivo }).eq('id', g.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    await anotarNA(g, campo, motivo, true)
    setMsg({ ok: true, t: 'MARCADO: ya no cuenta como faltante (' + motivo.split(' - ')[0] + ').' })
    load()
  }

  async function quitarNoAplica(g, campo) {
    if (!await preguntar(`¿Volver a pedir ${LBL_DOC[campo]} para este gasto?\n\nVuelve a aparecer en la lista de faltantes.`)) return
    const { error } = await supabase.from('expenses')
      .update({ [naDe(campo)]: false, [naMotivo(campo)]: null }).eq('id', g.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    await anotarNA(g, campo, null, false)
    setMsg({ ok: true, t: 'MARCA QUITADA: el documento vuelve a pedirse.' })
    load()
  }

  async function guardarPlantilla() {
    const { error } = await supabase.from('projects').update({ expense_template: tplText }).eq('id', pidOp)
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: 'PLANTILLA DE CONSTANCIA GUARDADA' })
    load()
  }

  // ---- RH MULTIPLES (sql/70) ----
  // Un pago real junta a veces 3, 5 y hasta 6 recibos por honorarios. El
  // principal sigue en receipt_url (los contadores de "falta RH" no cambian);
  // los demas viven en receipt_docs = [{url, note}].
  const rhExtras = g => (Array.isArray(g.receipt_docs) ? g.receipt_docs : [])

  async function agregarRhExtra(g, file) {
    try {
      const nota = await pedir('Nota de este RH adicional (de quién es, opcional):')
      if (nota === null) return
      const url = await upload(`gastos/rh/${g.id}`, file)
      const { error } = await supabase.from('expenses')
        .update({ receipt_docs: [...rhExtras(g), { url, note: nota.trim() || null }] }).eq('id', g.id)
      if (error) throw new Error(/receipt_docs/.test(error.message) ? 'Falta correr sql/70 en la base (columna receipt_docs).' : error.message)
      setMsg({ ok: true, t: 'RH ADICIONAL SUBIDO (' + (rhExtras(g).length + 2) + ' en total en este gasto)' })
      load()
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + err.message }) }
  }

  async function quitarRhExtra(g, i) {
    const d = rhExtras(g)[i]
    if (!d || !await preguntar('¿Quitar este RH adicional' + (d.note ? ' (' + d.note + ')' : '') + '?\n\nEl archivo queda en el almacenamiento; solo se desliga del gasto.', { peligro: true, aceptar: 'Sí, quitar' })) return
    const { error } = await supabase.from('expenses')
      .update({ receipt_docs: rhExtras(g).filter((_, j) => j !== i) }).eq('id', g.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    await supabase.from('activity_log').insert({
      action: 'UPDATE', entity_type: 'expenses', entity_id: g.id, user_email: profile?.email || null,
      details: { cambio: 'rh_extra_quitado', url_anterior: d.url, nota: d.note || null, receptor: g.recipient, project_id: pidOp },
    })
    setMsg({ ok: true, t: 'RH ADICIONAL QUITADO. QUEDA EN BITÁCORA.' })
    load()
  }

  // quitar un documento ya subido (superusuario): la casilla vuelve a "subir".
  // El archivo en si no se borra del almacenamiento — solo se desliga del gasto —
  // asi que un error aqui no destruye evidencia.
  async function quitarDocGasto(g, campo) {
    if (!await preguntar('¿Quitar ' + LBL_DOC[campo] + ' de este gasto?\n\nLa casilla volvera a pedir el documento y podras subir otro. El archivo anterior queda en el almacenamiento.', { peligro: true, aceptar: 'Sí, quitar' })) return
    const { error } = await supabase.from('expenses')
      .update({ [campo]: null, [campo.replace('_url', '_note')]: null }).eq('id', g.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    await supabase.from('activity_log').insert({
      action: 'UPDATE', entity_type: 'expenses', entity_id: g.id, user_email: profile?.email || null,
      details: {
        cambio: 'documento_quitado', documento: LBL_DOC[campo], url_anterior: g[campo],
        solicitud: g.request_number ? 'SOL-' + String(g.request_number).padStart(5, '0') : null,
        monto: Number(g.amount), receptor: g.recipient, project_id: pidOp,
      },
    })
    setMsg({ ok: true, t: 'DOCUMENTO QUITADO — YA PUEDES SUBIR OTRO. QUEDA EN BITÁCORA.' })
    load()
  }

  const UpBtn = ({ g, campo, carpeta, label, alerta }) => {
    const nota = g[campo.replace('_url', '_note')]
    if (g[campo]) return (
      <>
        {/* "ver" abre el documento dentro del panel: un Word tambien, que antes
            solo se podia bajar y abrir en Word aparte */}
        <button className="link-btn" onClick={() => setVerDoc({ url: g[campo], titulo: label })}>VER</button>
        {' '}<a href={g[campo]} target="_blank" rel="noreferrer" title="abrir en otra pestaña" className="muted small">↗</a>
        {!readOnly && <> <button className="link-btn" title={nota || 'sin nota'} onClick={() => notaDoc(g, campo)}>&#128221;</button></>}
        {puedeCorregir && <>
          {' '}<label className="link-btn" title="Reemplazar el documento por otro archivo" style={{ cursor: 'pointer' }}>&#128260;
            <input type="file" accept="image/*,.pdf,.docx" hidden
              onChange={e => e.target.files[0] && subirDoc(g, e.target.files[0], campo, carpeta)} />
          </label>
          {' '}<button className="link-btn" title="Quitar el documento (queda en bitácora)" onClick={() => quitarDocGasto(g, campo)}>&#128465;</button>
        </>}
        {nota && <div className="muted small" style={{ textTransform: 'none' }}>{nota}</div>}
        {campo === 'receipt_url' && <>
          {rhExtras(g).map((d, i) => (
            <div key={i} className="small" style={{ textTransform: 'none' }}>
              <button className="link-btn" onClick={() => setVerDoc({ url: d.url, titulo: 'RH ' + (i + 2) + ' de este gasto' })}>VER RH {i + 2}</button>
              {' '}<a href={d.url} target="_blank" rel="noreferrer" title="abrir en otra pestaña" className="muted small">↗</a>
              {d.note && <span className="muted"> · {d.note}</span>}
              {puedeCorregir && <> <button className="link-btn" title="Quitar este RH adicional" onClick={() => quitarRhExtra(g, i)}>&#128465;</button></>}
            </div>
          ))}
          {!readOnly && rhExtras(g).length < 7 && (
            <label className="link-btn small" style={{ cursor: 'pointer' }}
              title="Un pago puede juntar varios RH (3, 5, hasta 6): agrégalos aquí, cada uno con su nota">
              &#10133; otro RH
              <input type="file" accept="image/*,.pdf,.docx" hidden
                onChange={e => e.target.files[0] && agregarRhExtra(g, e.target.files[0])} />
            </label>
          )}
        </>}
      </>
    )
    // marcado como que nunca va a llegar: se ve el motivo, y se puede revertir
    if (g[naDe(campo)]) return (
      <>
        <span className="muted" title={g[naMotivo(campo)] || ''}>NO APLICA</span>
        {g[naMotivo(campo)] && <div className="muted small" style={{ textTransform: 'none' }}>{g[naMotivo(campo)]}</div>}
        {puedeNA && <button className="link-btn muted small" onClick={() => quitarNoAplica(g, campo)}>volver a pedirlo</button>}
      </>
    )
    if (readOnly) return <span className="muted">-</span>
    return (
      <>
        <label className={`upload-btn ${alerta ? 'bad' : ''}`}>{alerta ? '⚠ ' : ''}{label}
          <input type="file" accept="image/*,.pdf,.docx" hidden
            onChange={e => e.target.files[0] && subirDoc(g, e.target.files[0], campo, carpeta)} />
        </label>
        {puedeNA && <div><button className="link-btn muted small" title="Este gasto nunca va a tener este documento"
          onClick={() => marcarNoAplica(g, campo)}>no aplica</button></div>}
      </>
    )
  }

  // ---- ATAJOS: los gastos que se piden siempre, ya prellenados ----
  // El texto sale igual que en las constancias de papel; despues se puede editar.
  // `ej`: un ejemplo real de cómo se escribe el motivo de ese gasto (paso 1)
  const ATAJOS = [
    { t: '🤝 Comisión', ej: 'PAGO DE COMISION POR LA VENTA DEL LOTE MZ B LT 7', f: { type: 'PAGO DE COMISION', description: 'PAGO DE COMISION POR LA VENTA DEL LOTE ', discount_from: 'EL PROYECTO', payment_method: 'EFECTIVO' } },
    { t: '📅 Administrativos del mes', ej: 'GASTOS ADMINISTRATIVOS CORRESPONDIENTE AL MES DE ' + MESES[new Date().getMonth()], f: { type: 'GASTOS ADMINISTRATIVOS', description: 'GASTOS ADMINISTRATIVOS CORRESPONDIENTE AL MES DE ' + MESES[new Date().getMonth()], discount_from: 'URBIS GROUP', payment_method: 'EFECTIVO' } },
    { t: '📣 Publicidad (ADS)', ej: 'PAGO DE PUBLICIDAD (ADS) DEL PROYECTO DEL MES DE ' + MESES[new Date().getMonth()], f: { type: 'GASTOS ADMINISTRATIVOS', description: 'PAGO DE PUBLICIDAD (ADS) DEL PROYECTO', discount_from: 'EL PROYECTO', payment_method: 'TRANSFERENCIA' } },
    { t: '🧰 Materiales u obra', ej: 'SERVICIO DE EXCAVADORA ORUGA PARA LA APERTURA DE CALLES', f: { type: 'GASTOS DE DESARROLLO', description: 'COMPRA DE MATERIALES PARA EL PROYECTO', discount_from: 'EL PROYECTO', payment_method: 'EFECTIVO' } },
    { t: '✏️ Otro', ej: 'MOVILIDAD PARA LA ENTREGA DE LOTES DEL SABADO', f: { type: 'OTROS', description: '' } },
  ]
  const EJEMPLO_TIPO = {
    'PAGO DE COMISION': 'PAGO DE COMISION POR LA VENTA DEL LOTE MZ B LT 7',
    'GASTOS ADMINISTRATIVOS': 'GASTOS ADMINISTRATIVOS CORRESPONDIENTE AL MES DE ' + MESES[new Date().getMonth()],
    'GASTOS DE DESARROLLO': 'SERVICIO DE EXCAVADORA ORUGA PARA LA APERTURA DE CALLES',
    OTROS: 'MOVILIDAD PARA LA ENTREGA DE LOTES DEL SABADO',
  }
  // las socias del proyecto: en los proyectos con firma de socio, ELLA entrega el
  // dinero y firma la aprobación (sql/136). Con una sola, se pone sola.
  const socias = personas.filter(p => p.rol === 'socio')
  const sociaFija = proyecto?.expense_approval && socias.length === 1 ? socias[0] : null
  // Lo que ya sabemos del proyecto viene puesto: quién firma la solicitud y a
  // quién se le suele entregar el dinero (lo último registrado de ese tipo).
  // Todo se puede cambiar: son valores de arranque, no una regla.
  function porDefecto(extra = {}) {
    const ult = list.find(g => (!extra.type || g.type === extra.type) && g.recipient) || {}
    const previo = firmantes.length === 1 ? firmantes[0].id : (list.find(g => g.requester_id)?.requester_id || '')
    // quien ENTREGA de parte de Urbis: la socia del proyecto, o el último que entregó
    const socio = socias[0]
    const ultEntrega = list.find(g => g.sender) || {}
    return {
      issue_date: hoy(),
      requester_id: firmantes.some(p => p.id === previo) ? previo : '',
      recipient: ult.recipient || '',
      recipient_dni: ult.recipient_dni || dniDe(ult.recipient),
      sender: socio?.full_name || ultEntrega.sender || '',
      sender_dni: socio?.dni || ultEntrega.sender_dni || '',
      ...extra,
    }
  }
  // paso 1: elegir qué se paga llena tipo, motivo, de dónde se descuenta y cómo se
  // paga; no toca a las personas ni el monto ya escritos
  const elegirQue = a => { setF(x => ({ ...x, ...a.f })); setFaltaPaso('') }
  const atajoActivo = a => a.f.type === f.type && (!a.f.description || String(f.description || '').startsWith(a.f.description.slice(0, 15)))
  const primerNombre = s => String(s || '').trim().split(/\s+/)[0] || ''
  const abrirNueva = () => { setEditId(null); setF(porDefecto()); setShow(true); setPaso(1); setFaltaPaso(''); setConDetalle(false); setEditTexto(false); setMsg(null) }

  // ---- LA SOLICITUD POR PASOS (10 oct 2026, pedido del dueño: "más práctico de
  // entender, con ejemplos") ----
  //   1. ¿Qué se paga?   2. ¿Quién pide y quién recibe?   3. ¿Cuánto y cómo?   4. Revisa
  // Lo que falta en cada paso se dice ahí mismo, antes de pasar al siguiente.
  const PASOS = ['¿Qué se paga?', '¿Quién pide y quién recibe?', '¿Cuánto y cómo?', 'Revisa y registra']
  const solicitante = firmantes.find(p => p.id === f.requester_id) || null
  function faltaEn(n) {
    if (n === 1) {
      if (!f.type) return 'Elige qué se paga (o "Otro").'
      if (String(f.description || '').trim().length < 6) return 'Escribe el motivo: es lo que sale en la constancia después de "pago por".'
    }
    if (n === 2) {
      if (proyecto?.expense_approval && hay74 && !f.requester_id) return 'Elige quién pide el gasto: su firma va primero (la de la izquierda).'
      if (!String(f.recipient || '').trim()) return 'Escribe quién recibe el dinero.'
      if (!String(f.recipient_dni || '').trim()) return 'Falta el DNI de quien recibe el dinero.'
    }
    if (n === 3) {
      if (!(Number(f.amount) > 0)) return 'Escribe el monto.'
      if (!f.issue_date) return 'Falta la fecha.'
      if (proyecto?.expense_approval && !socias.length) return 'Este proyecto no tiene socia asignada: nadie podría aprobar el gasto. Pídele al superusuario que se la asigne en Usuarios.'
      if (!sociaFija && !String(f.sender || '').trim()) return 'Escribe quién entrega el dinero.'
    }
    return ''
  }
  function irAPaso(n) {
    // hacia atrás siempre; hacia adelante, solo con los pasos anteriores completos
    for (let i = 1; i < n; i++) { const t = faltaEn(i); if (t) { setPaso(i); setFaltaPaso(t); return } }
    setPaso(n); setFaltaPaso('')
  }

  // Copiar una solicitud anterior: sirve para el gasto que se repite cada mes.
  // No se copian ni el correlativo ni las firmas: es una solicitud nueva.
  function duplicar(g) {
    setEditId(null)
    setF({
      type: g.type, issue_date: hoy(), amount: g.amount, recipient: g.recipient, recipient_dni: g.recipient_dni,
      requester_id: g.requester_id || '', sender: g.sender, sender_dni: g.sender_dni || '', discount_from: g.discount_from,
      payment_method: g.payment_method, document_type: g.document_type, description: g.description, detail: g.detail,
      plantilla_propia: g.plantilla_propia || '',
    })
    setShow(true); setPaso(1); setFaltaPaso(''); setConDetalle(!!g.detail); setEditTexto(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ---- NOMBRES CONOCIDOS con su DNI ----
  // Las personas del sistema (sql/87) y quienes ya recibieron o entregaron en
  // gastos anteriores. Al elegir uno, su DNI se llena solo.
  const opcionesPersonas = useMemo(() => {
    const m = new Map()
    for (const p of personas) if (p.full_name) m.set(String(p.full_name).toUpperCase(), p.dni || '')
    for (const g of list) {
      if (g.recipient && !m.has(g.recipient)) m.set(g.recipient, g.recipient_dni || '')
      if (g.sender && !m.has(g.sender)) m.set(g.sender, g.sender_dni || '')
    }
    return [...m.entries()]
  }, [personas, list])
  const dniDe = nombre => opcionesPersonas.find(([n]) => n === String(nombre || '').toUpperCase())?.[1] || ''

  // ---- DETALLE en filas (se guarda como siempre: FECHA | DESCRIPCION | MONTO) ----
  // La primera columna casi siempre es la fecha, pero en gastos viejos puede ser
  // otra cosa ("2.00 UND" en la tabla de una compra): se guarda TAL CUAL y el
  // calendario aparece solo cuando de verdad es una fecha.
  const esFechaDmy = s => /^\d{2}\/\d{2}\/\d{4}$/.test(s || '')
  const aIso = d => esFechaDmy(d) ? d.slice(6, 10) + '-' + d.slice(3, 5) + '-' + d.slice(0, 2) : ''
  const aDmy = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.slice(8, 10) + '/' + v.slice(5, 7) + '/' + v.slice(0, 4) : v
  const filas = (f.detail || '').split('\n').map(l => l.split('|').map(x => x.trim()))
    .filter(a => a.some(Boolean)).map(a => ({ fecha: a[0] || '', desc: a[1] || '', monto: a[2] || '' }))
  const filasVista = filas.length ? filas : [{ fecha: '', desc: '', monto: '' }]
  const guardarFilas = fs => setF(x => ({
    ...x,
    detail: fs.filter(r => r.desc || r.monto).map(r => [r.fecha, r.desc, r.monto].join(' | ')).join('\n'),
  }))
  const setFila = (i, campo, valor) => guardarFilas(filasVista.map((r, j) =>
    j === i ? { ...r, [campo]: campo === 'fecha' ? aDmy(valor) : valor } : r))
  const totalDetalle = filasVista.reduce((s, r) => s + Number(r.monto || 0), 0)

  const IN = (k, label, type = 'text', req = false) => (
    <label key={k}>{label}
      <input type={type} step="0.01" value={f[k] || ''} required={req}
        onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} />
    </label>
  )

  // ---- LA CONSTANCIA, EN UN SOLO LUGAR (components/ConstanciaGasto) ----
  // La arman igual la VISTA PREVIA (mientras se llena la solicitud) y la ventana
  // de imprimir: lo que se ve mientras se escribe es exactamente lo que se firma.
  const numeroDe = numeroGasto
  const constanciaDe = (g, opciones) => constanciaGasto(g, proyecto, opciones)

  // ---- LAS PIEZAS DE CADA GASTO ----
  // Las usan igual la tabla (computadora) y las tarjetas (celular): así un estado o
  // un botón nuevo aparece en los dos lados. Son funciones que devuelven JSX, no
  // componentes: un componente definido aquí adentro se remontaría en cada render.
  const estadoDe = g => {
    const e = estadoGasto(g)
    if (e === 'confirmado') return <span className="ok">&#10004; CONFIRMADO</span>
    if (e === 'aprobado') return pagoPendiente(g)
      ? <span className="warn" title={'Aprobado por ' + (g.approved_name || '') + ' · código ' + (g.approval_code || '')}>💸 PAGO PENDIENTE<br /><span className="muted small">aprobó {(g.approved_name || '').split(' ')[0]} · falta comprobante</span></span>
      : <span className="ok" title={'Aprobado por ' + (g.approved_name || '') + ' · código ' + (g.approval_code || '')}>✍ APROBADO<br /><span className="muted small">{(g.approved_name || '').split(' ')[0]}</span></span>
    if (e === 'rechazado') return <span className="bad" title={g.rejected_reason || ''}>✖ RECHAZADO<br /><span className="muted small" style={{ textTransform: 'none' }}>{(g.rejected_reason || '').slice(0, 40)}</span></span>
    if (e === 'por_firmar') return <span className="warn" title={'Espera la firma de ' + nombreFirmante(g)}>&#9203; POR FIRMAR<br /><span className="muted small">{primerFirmante(g)}</span></span>
    if (sinSolicitante(g)) return <span className="bad" title="Se registró sin elegir quién pide el gasto: nadie firmó primero">⚠ FALTA QUIÉN LA PIDE<br /><span className="muted small" style={{ textTransform: 'none' }}>corrígela con "editar"</span></span>
    return <span className="warn">&#9203; {proyecto?.expense_approval ? 'POR APROBAR' : 'SOLICITADO'}</span>
  }

  // firmar, aprobar o (la socia) subir el comprobante; `grande` = botón a lo ancho (celular)
  const accionesFirma = (g, grande) => {
    const st = grande ? { width: '100%', padding: '.8rem', fontSize: '1rem' } : { fontSize: 12, whiteSpace: 'nowrap' }
    const espera = t => <span className="muted small" style={{ textTransform: 'none' }}>⏳ {t}</span>
    return <>
      {miPuedeFirmar(g) && <button className="btn-primary" style={st} onClick={() => setAprobar({ g, modo: 'solicitar' })}>✍ Firmar</button>}
      {estadoGasto(g) === 'por_firmar' && !miPuedeFirmar(g) && espera('espera la firma de ' + primerFirmante(g))}
      {miPuedeAprobar(g) && <button className="btn-primary" style={st} onClick={() => setAprobar({ g, modo: 'aprobar' })}>✍ Revisar y firmar</button>}
      {puedeAprobar && estadoGasto(g) === 'solicitado' && (esSocio || proyecto?.expense_approval) && g.requester_id === profile?.id && espera('la aprueba otra persona')}
      {miPuedePagar(g) && <button className="btn-primary" style={st} onClick={() => setPagar(g)}>💸 Subir comprobante</button>}
      {pagoPendiente(g) && !miPuedePagar(g) && espera('la socia paga y sube el comprobante')}
    </>
  }

  const docConstancia = g => <>
    <button className="link-btn" onClick={() => setPrt(g)}>imprimir</button>{' | '}
    <UpBtn g={g} campo="request_doc_url" carpeta="constancias" label="firmada" />
  </>

  // el comprobante de un pago pendiente lo sube la socia con su botón (queda PAGADO al
  // subirlo): la oficina no lo sube por su lado, o quedaría el archivo sin el pago
  const docComprobante = g => pagoPendiente(g) && !g.voucher_url
    ? <span className="muted small" style={{ textTransform: 'none' }}>{miPuedePagar(g) ? 'con 💸 Subir comprobante' : 'lo sube la socia'}</span>
    : <UpBtn g={g} campo="voucher_url" carpeta="sustentos" label="subir" />

  // ---- REPOSICIÓN (sql/125) ----
  // El voucher del gasto es el pago a quien recibió el dinero; el de la reposición,
  // la devolución a quien lo adelantó. Una transferencia puede devolver varios.
  const abrirReponer = g => setReponer({ persona: g.adelanto_por || '', ids: [g.id] })
  async function marcarAdelanto(g) {
    const v = await pedir('¿Quién adelantó el dinero de este gasto?\n\nQueda en "falta reponer" hasta que se suba la devolución. Déjalo vacío si nadie lo adelantó (lo pagó Urbis o el proyecto).', { valor: g.adelanto_por || '' })
    if (v === null) return
    const { error } = await supabase.rpc('marcar_adelanto_gasto', { eid: g.id, persona: v })
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setMsg({ ok: true, t: v.trim() ? 'MARCADO: FALTA REPONERLE A ' + v.trim().toUpperCase() + '.' : 'QUITADO: ESTE GASTO NO TIENE NADA QUE REPONER.' })
    load()
  }
  async function quitarReposicion(r) {
    const n = list.filter(g => g.reposicion_id === r.id).length
    if (!await preguntar('¿Quitar la reposición de ' + soles(r.monto) + ' a ' + r.persona + '?\n\n' + (n > 1 ? 'Cubre ' + n + ' gastos: los ' + n + ' vuelven' : 'El gasto vuelve') + ' a "falta reponer". El voucher queda guardado y en la bitácora.', { peligro: true, aceptar: 'Sí, quitar' })) return
    const { error } = await supabase.rpc('quitar_reposicion', { rid: r.id })
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setMsg({ ok: true, t: 'REPOSICIÓN QUITADA. QUEDA EN BITÁCORA.' }); load()
  }
  const docReposicion = g => {
    const r = g.reposicion_id && reposiciones[g.reposicion_id]
    if (r) {
      const n = list.filter(x => x.reposicion_id === r.id).length
      return <>
        <button className="link-btn" onClick={() => setVerDoc({ url: r.voucher_url, titulo: 'Reposición a ' + r.persona })}>VER</button>
        {' '}<a href={r.voucher_url} target="_blank" rel="noreferrer" title="abrir en otra pestaña" className="muted small">↗</a>
        {esJefe && <> <button className="link-btn" title="Quitar la reposición (queda en bitácora)" onClick={() => quitarReposicion(r)}>&#128465;</button></>}
        <div className="muted small" style={{ textTransform: 'none' }}>
          a {r.persona} · {r.fecha}{n > 1 ? ' · cubre ' + n + ' gastos (' + soles(r.monto) + ')' : ''}{r.operacion ? ' · OP ' + r.operacion : ''}
        </div>
      </>
    }
    if (g.rejected_at) return <span className="muted small">—</span>
    if (g.adelanto_por) return <>
      <span className="warn small" title={'Lo adelantó ' + g.adelanto_por}>⚠ falta reponer a {g.adelanto_por.split(' ')[0]}</span>
      {puedeReponer && <div>
        <button type="button" className="upload-btn" onClick={() => abrirReponer(g)}>subir</button>
        {' '}<button type="button" className="link-btn muted small" onClick={() => marcarAdelanto(g)}>cambiar</button>
      </div>}
    </>
    if (!puedeReponer) return <span className="muted small">—</span>
    return <>
      <button type="button" className="upload-btn" title="Alguien pagó este gasto con su dinero y ya se le devolvió: sube el voucher de la devolución" onClick={() => abrirReponer(g)}>subir</button>
      <div><button type="button" className="link-btn muted small" title="Alguien pagó este gasto con su dinero y todavía no se le devuelve" onClick={() => marcarAdelanto(g)}>lo adelantó alguien</button></div>
    </>
  }
  // la casilla de vouchers: el del gasto y, debajo, el de la reposición
  const docVouchers = g => !hay125 ? docComprobante(g) : <div className="vouchers-gasto">
    <div><span className="muted small vg-lbl">Gasto</span>{docComprobante(g)}</div>
    <div><span className="muted small vg-lbl">Reposición</span>{docReposicion(g)}</div>
  </div>

  async function eliminarGasto(g) {
    if (!await preguntar(`ELIMINAR la solicitud "${g.description || g.type}" (${soles(g.amount)})?\nSolo se pueden eliminar solicitudes NO confirmadas.`, { peligro: true, aceptar: 'Sí, eliminar' })) return
    const { error } = await supabase.from('expenses').delete().eq('id', g.id)
    setMsg(error ? { ok: false, t: error.message } : { ok: true, t: 'SOLICITUD ELIMINADA' })
    load()
  }

  const accionesOficina = g => <>
    {!readOnly && <><button className="btn-ghost" title="Crear una solicitud nueva con estos mismos datos (el gasto que se repite cada mes)"
      onClick={() => duplicar(g)}>duplicar</button>{' '}</>}
    {g.status === 'solicitado' && ['admin', 'secretary', 'superuser', 'operador'].includes(role) && (<>
      <button className="btn-ghost" onClick={() => abrirEditar(g)}>editar</button>{' '}
      {/* confirmar = el dinero ya se entregó. No se habilita hasta que esté la firma
          de quien lo pidió (la base también lo impide, sql/89). En los proyectos con
          aprobación de socio NO hay botón: el pago lo registra la socia al subir el
          comprobante (sql/101). */}
      {!proyecto?.expense_approval && (() => {
        const motivo = g.requester_id && !g.requester_signed_at ? 'Falta la firma de ' + nombreFirmante(g) : ''
        return (
          <button className="btn-ghost" onClick={() => confirmar(g)} disabled={!!motivo}
            title={motivo || 'El dinero ya se entregó'}
            style={motivo ? { opacity: .45, cursor: 'not-allowed' } : undefined}>
            {motivo ? '🔒 Confirmar pago' : 'Confirmar pago'}
          </button>
        )
      })()}{' '}
      {esJefe && <button className="link-btn bad" onClick={() => eliminarGasto(g)}>eliminar</button>}
    </>)}
    {g.status === 'confirmado' && puedeCorregir &&
      <button className="btn-ghost" onClick={() => abrirEditar(g)}>editar (superuser)</button>}
  </>

  const tarjetaGasto = g => (
    <div key={g.id} className="glass gasto-card">
      <div className="gc-top">
        <b>{g.request_number ? numeroDe(g) : '—'}</b>
        <span className="muted small">{g.issue_date || g.reception_date || ''}</span>
      </div>
      <div>{estadoDe(g)}</div>
      <div className="gc-monto">{soles(g.amount)}</div>
      <div><b>{g.recipient || '—'}</b></div>
      <div className="muted small gc-motivo">{g.description || g.type}</div>
      <div className="gc-acciones">{accionesFirma(g, true)}</div>
      <div className="gc-docs">
        <div className="gc-doc"><span className="muted">Constancia</span><span>{docConstancia(g)}</span></div>
        <div className="gc-doc"><span className="muted">RH / factura</span><span><UpBtn g={g} campo="receipt_url" carpeta="rh" label="subir" alerta={g.status === 'confirmado' && !g.receipt_url} /></span></div>
        <div className="gc-doc"><span className="muted">Comprobante de pago</span><span>{docComprobante(g)}</span></div>
        {hay125 && <div className="gc-doc"><span className="muted">Reposición</span><span>{docReposicion(g)}</span></div>}
      </div>
      {!readOnly && <div className="gc-oficina">{accionesOficina(g)}</div>}
    </div>
  )

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Gastos</h1>
        <ProjectPicker />
        {puedeCorregir && (
          <button className="btn-ghost" onClick={() => setTplOpen(!tplOpen)}>
            {tplOpen ? 'Cerrar plantilla' : 'Plantilla de constancia (superusuario)'}
          </button>
        )}
      </div>

      {tplOpen && puedeCorregir && (
        <div className="glass form-card" style={{ maxWidth: 'none' }}>
          <p><b>PLANTILLA DE CONSTANCIA DE RECEPCION — {proyecto?.name}</b></p>
          <p className="small warn" style={{ textTransform: 'none' }}>
            🔒 Los gastos que ya están firmados conservan el texto con que se firmaron. Cambiar la plantilla solo afecta a las solicitudes que todavía no tienen firma.
          </p>
          <p className="small">VARIABLES: {GASTO_VARS.map(v => <code key={v} className="tok">{'{{' + v + '}}'}</code>)}</p>
          <p className="small">BLOQUES: {GASTO_BLOQUES.map(v => <code key={v} className="tok tok2">{'{{' + v + '}}'}</code>)}</p>
          <textarea rows="14" value={tplText} spellCheck="false"
            style={{ textTransform: 'none', fontFamily: 'monospace', fontSize: '.85rem' }}
            onChange={e => setTplText(e.target.value)} />
          <div>
            <button className="btn-primary" onClick={guardarPlantilla}>Guardar plantilla</button>{' '}
            <button className="btn-ghost" onClick={() => setTplText(DEFAULT_GASTO_TEMPLATE)}>Restaurar base</button>
          </div>
        </div>
      )}

      <div className="toolbar">
        <input className="search" placeholder="Buscar por receptor, descripcion..." value={fq} onChange={e => setFq(e.target.value)} />
        <select value={ftipo} onChange={e => setFtipo(e.target.value)}>
          <option value="todos">TODOS LOS TIPOS</option>
          {TIPOS.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={fanio} onChange={e => setFanio(e.target.value)}>
          <option value="todos">TODOS LOS AÑOS</option>
          {anios.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={fmes} onChange={e => setFmes(e.target.value)}>
          <option value="todos">TODOS LOS MESES</option>
          {MESES.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
        </select>
        <select value={fest} onChange={e => setFest(e.target.value)}>
          <option value="todos">TODOS LOS ESTADOS</option>
          <option value="solicitado">SOLICITADOS</option>
          <option value="confirmado">CONFIRMADOS</option>
          <option value="por_firmar">POR FIRMAR (solicitante)</option>
          <option value="por_aprobar">POR APROBAR (socio)</option>
          <option value="aprobado">{proyecto?.expense_approval ? 'PAGO PENDIENTE (falta comprobante)' : 'APROBADOS, SIN PAGAR'}</option>
          <option value="rechazado">RECHAZADOS</option>
          <option value="falta_rh">FALTA RH / FACTURA</option>
          <option value="no_aplica">MARCADOS "NO APLICA"</option>
          {hay125 && <option value="falta_reponer">FALTA REPONER (lo adelantó alguien)</option>}
        </select>
        {!readOnly && <button className="btn-primary" onClick={() => show ? setShow(false) : abrirNueva()}>{show ? 'Cerrar' : '+ Solicitar gasto'}</button>}
      </div>

      <p className="hint">
        {filtrada.length} gastos | TOTAL: <b>{soles(total)}</b>
        {porFirmar > 0 && <span className="warn"> | ✍ ESPERAN LA FIRMA DEL SOLICITANTE: {porFirmar}</span>}
        {proyecto?.expense_approval && porAprobar > 0 && <span className="warn"> | ✍ POR APROBAR: {porAprobar}</span>}
        {!readOnly && pendConfirmar > 0 && <span className="warn"> | POR CONFIRMAR: {pendConfirmar}</span>}
        {!readOnly && faltaRH > 0 && <span className="bad"> | FALTA RH/FACTURA: {faltaRH}</span>}
        {!readOnly && noAplican > 0 && <span className="muted"> | SIN DOCUMENTO A PROPOSITO: {noAplican}</span>}
        {porReponer.length > 0 && <span className="warn"> | FALTA REPONER: {soles(totalPorReponer)}</span>}
      </p>
      {/* lo que se le debe a cada persona que adelantó dinero, con su botón */}
      {deudaPorPersona.length > 0 && (
        <div className="glass form-card" style={{ maxWidth: 'none', padding: '10px 14px' }}>
          <p style={{ margin: '0 0 6px' }}><b>💸 FALTA REPONER</b> <span className="muted small" style={{ textTransform: 'none' }}>— dinero que alguien adelantó y todavía no se le devolvió</span></p>
          {deudaPorPersona.map(d => (
            <div key={d.persona} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '3px 0' }}>
              <b style={{ minWidth: 180 }}>{d.persona}</b>
              <span className="muted small">{d.ids.length} gasto{d.ids.length > 1 ? 's' : ''}</span>
              <b style={{ fontVariantNumeric: 'tabular-nums' }}>{soles(d.total)}</b>
              <button type="button" className="link-btn small" onClick={() => { setFest('falta_reponer'); setFq(d.persona) }}>ver</button>
              {puedeReponer && <button type="button" className="btn-ghost" style={{ marginLeft: 'auto', fontSize: 12 }}
                onClick={() => setReponer({ persona: d.persona, ids: d.ids })}>💸 Subir reposición</button>}
            </div>
          ))}
        </div>
      )}
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      {/* exigir o no la firma del socio es una regla del proyecto: la decide solo el superusuario */}
      {esSuper && proyecto && 'expense_approval' in proyecto && (
        <label className="inline-check" style={{ display: 'block', margin: '0 0 10px' }}>
          <input type="checkbox" checked={!!proyecto.expense_approval} onChange={e => toggleAprobacion(e.target.checked)} />
          {' '}Este proyecto exige la <b>aprobación firmada de un socio</b> antes de confirmar el pago
        </label>
      )}
      {/* La firma se dibuja UNA vez y sirve para las dos firmas de la constancia:
          la del socio que aprueba y la de quien pide el gasto (sql/74). Se ofrece
          sola a quien le toca firmar algo y todavia no la registro. */}
      {((meToca && !tengoFirma) || cambiarFirma) && (
        <div className="glass form-card">
          <p><b>✍ {tengoFirma ? 'CAMBIAR' : 'REGISTRA'} TU FIRMA</b></p>
          <p className="muted small" style={{ textTransform: 'none' }}>Dibújala con el dedo o el mouse, como firmas en papel. Se usa cada vez que firmes, junto con tu contraseña.</p>
          <FirmaPad busy={firmaBusy} onGuardar={guardarFirma} />
          {cambiarFirma && <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setCambiarFirma(false)}>Cancelar</button>}
        </div>
      )}
      {!cambiarFirma && tengoFirma && (meToca || proyecto?.expense_approval) && (
        <p className="hint">
          <img src={miFirma || profile.signature_url} alt="Tu firma" style={{ height: 30, background: '#fff', borderRadius: 4, verticalAlign: 'middle', padding: 2 }} />
          {' '}Tu firma registrada · <button className="link-btn" onClick={() => setCambiarFirma(true)}>cambiarla</button>
        </p>
      )}

      {show && !readOnly && (
        <form className="glass form-card sg" style={{ maxWidth: 'none' }} onSubmit={guardar} noValidate>
          <div className="sg-cab">
            <b>{editId ? 'CORREGIR LA SOLICITUD ' + numeroDe(list.find(g => g.id === editId) || {}) : 'NUEVA SOLICITUD DE GASTO'}</b>
            <span className="muted small" style={{ textTransform: 'none' }}>
              {editId ? 'Se mantiene el mismo número. Si ya tenía firmas, hay que volver a firmarla.' : 'Cuatro pasos. Al final ves la constancia tal como se va a firmar.'}
            </span>
          </div>
          {/* los cuatro pasos: tocando uno se vuelve a él (hacia adelante, solo si
              lo anterior está completo) */}
          <ol className="sg-pasos">
            {PASOS.map((t, i) => (
              <li key={t} className={paso === i + 1 ? 'on' : paso > i + 1 ? 'hecho' : ''}>
                <button type="button" onClick={() => irAPaso(i + 1)}><span className="sg-n">{paso > i + 1 ? '✓' : i + 1}</span>{t}</button>
              </li>
            ))}
          </ol>

          {paso === 1 && (
            <div className="sg-paso">
              <p className="sg-preg">1. ¿Qué se paga?</p>
              <div className="chips" style={{ margin: '0 0 12px' }}>
                {ATAJOS.map(a => (
                  <button key={a.t} type="button" className={'chip' + (atajoActivo(a) ? ' on' : '')} style={{ textTransform: 'none' }}
                    onClick={() => elegirQue(a)}>{a.t}</button>
                ))}
              </div>
              <div className="form-grid">
                <label>Tipo de gasto
                  <select value={f.type || ''} onChange={e => { setF(x => ({ ...x, type: e.target.value })); setFaltaPaso('') }}>
                    <option value="">- elegir -</option>
                    {TIPOS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label>Se descuenta de
                  <select value={f.discount_from || 'URBIS GROUP'} onChange={e => setF(x => ({ ...x, discount_from: e.target.value }))}>
                    <option>URBIS GROUP</option>
                    <option>EL PROYECTO</option>
                  </select>
                </label>
                <label className="span2">Motivo <span className="muted small" style={{ textTransform: 'none' }}>(en la constancia sale: "este monto corresponde al pago por …")</span>
                  <input value={f.description || ''} placeholder={EJEMPLO_TIPO[f.type] || ATAJOS[0].ej}
                    onChange={e => { setF(x => ({ ...x, description: e.target.value })); setFaltaPaso('') }} />
                  <span className="sg-ej">Ej.: {EJEMPLO_TIPO[f.type] || ATAJOS[0].ej}</span>
                </label>
              </div>
              {/* El detalle se llena como una tabla, no escribiendo con barras: cada
                  fila sale igual en la constancia y el total puede llenar el monto. */}
              {!conDetalle ? (
                <button type="button" className="link-btn" style={{ marginTop: 8 }} onClick={() => setConDetalle(true)}>
                  + Agregar el detalle en una tabla <span className="muted">(opcional: cuando un pago junta varias cosas)</span>
                </button>
              ) : (
                <div style={{ marginTop: 10 }}>
                  <label style={{ marginBottom: 4 }}>Detalle del gasto <span className="muted small">(opcional — sale como tabla en la constancia)</span></label>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="ctable" style={{ fontSize: 12, minWidth: 440 }}>
                      <thead><tr><th style={{ width: 130 }}>Fecha</th><th>Descripción</th><th style={{ width: 110 }}>Monto S/</th><th style={{ width: 34 }}></th></tr></thead>
                      <tbody>
                        {filasVista.map((r, i) => (
                          <tr key={i}>
                            <td>{esFechaDmy(r.fecha) || !r.fecha
                              ? <input type="date" value={aIso(r.fecha)} style={{ width: '100%' }} onChange={e => setFila(i, 'fecha', e.target.value)} />
                              : <input value={r.fecha} style={{ width: '100%', textTransform: 'none' }} title="Este gasto viejo no usa fecha en esta columna" onChange={e => setFila(i, 'fecha', e.target.value)} />}</td>
                            <td><input value={r.desc} style={{ width: '100%', textTransform: 'none' }} placeholder="VENENO PARA FUMIGACION" onChange={e => setFila(i, 'desc', e.target.value)} /></td>
                            <td><input type="number" step="0.01" value={r.monto} style={{ width: '100%' }} onChange={e => setFila(i, 'monto', e.target.value)} /></td>
                            <td>{filasVista.length > 1 && <button type="button" className="link-btn bad" title="Quitar esta fila"
                              onClick={() => guardarFilas(filasVista.filter((_, j) => j !== i))}>✕</button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                    <button type="button" className="btn-ghost" onClick={() => guardarFilas([...filasVista, { fecha: '', desc: '', monto: '' }])}>+ Agregar fila</button>
                    {totalDetalle > 0 && <>
                      <b>TOTAL {soles(totalDetalle)}</b>
                      {Number(f.amount || 0) !== Number(totalDetalle.toFixed(2)) &&
                        <button type="button" className="btn-act" onClick={() => setF(x => ({ ...x, amount: totalDetalle.toFixed(2) }))}>Usar como monto</button>}
                    </>}
                  </div>
                </div>
              )}
            </div>
          )}

          {paso === 2 && (
            <div className="sg-paso">
              <p className="sg-preg">2. ¿Quién pide el gasto y quién recibe el dinero?</p>
              <div className="form-grid">
                {/* El solicitante es la persona que despues FIRMA la solicitud en el
                    panel (sql/74). Con firma de socio es obligatorio (sql/136): sin
                    él no hay primera firma y la socia no puede aprobar. */}
                <label className="span2">¿Quién pide el gasto? <span className="muted small" style={{ textTransform: 'none' }}>(firma 1, la de la izquierda{proyecto?.expense_approval ? ' · obligatoria' : ''})</span>
                  {firmantes.length > 0 ? (
                    <select value={f.requester_id || ''}
                      onChange={e => {
                        const id = e.target.value
                        const p = firmantes.find(x => x.id === id)
                        setFaltaPaso('')
                        // si todavía no se puso a quién se le entrega, se asume que
                        // es esta misma persona: es lo que pasa casi siempre
                        setF(x => ({
                          ...x, requester_id: id,
                          ...(p && !x.recipient ? { recipient: p.full_name, recipient_dni: p.dni || x.recipient_dni || '' } : {}),
                        }))
                      }}>
                      <option value="">{proyecto?.expense_approval ? '- elegir -' : '- nadie / se firma en papel -'}</option>
                      {firmantes.map(p => (
                        <option key={p.id} value={p.id}>{p.full_name}{p.tiene_firma ? '' : ' — sin firma registrada'}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="muted small" style={{ textTransform: 'none' }}>Falta correr sql/74: la constancia se firma en papel.</span>
                  )}
                  <span className="sg-ej">Le llega un aviso por WhatsApp y Telegram para firmar con su código. Ej.: VICTOR, que pide el pago de su comisión.</span>
                  <span className="sg-ej">¿No aparece quien pide? Aquí salen solo los usuarios del panel que tienen <b>este proyecto</b> asignado (se marca en Usuarios). La socia no sale: ella firma del otro lado.</span>
                  {solicitante && !solicitante.tiene_firma && (
                    <span className="warn small" style={{ textTransform: 'none' }}>⚠ {primerNombre(solicitante.full_name)} todavía no registró su firma: se la pide el panel la primera vez que entre a Gastos.</span>
                  )}
                </label>
                <label>¿Quién recibe el dinero?
                  <input list="personas-gasto" value={f.recipient || ''}
                    onChange={e => {
                      const v = e.target.value, d = dniDe(v)
                      setFaltaPaso('')
                      setF(x => ({ ...x, recipient: v, ...(d ? { recipient_dni: d } : {}) }))
                    }} />
                  <span className="sg-ej">Ej.: el vendedor que cobra su comisión, o el proveedor (el dueño de la excavadora).</span>
                  {solicitante && String(f.recipient || '').trim().toUpperCase() !== String(solicitante.full_name || '').toUpperCase() && (
                    <button type="button" className="link-btn small" style={{ textAlign: 'left' }}
                      onClick={() => setF(x => ({ ...x, recipient: solicitante.full_name, recipient_dni: solicitante.dni || dniDe(solicitante.full_name) || x.recipient_dni || '' }))}>
                      👤 lo recibe {primerNombre(solicitante.full_name)}, el mismo que lo pide
                    </button>
                  )}
                </label>
                <label>DNI de quien recibe
                  <input value={f.recipient_dni || ''} inputMode="numeric" onChange={e => { setFaltaPaso(''); setF(x => ({ ...x, recipient_dni: e.target.value })) }} />
                </label>
                {hay125 && (
                  <label className="span2">¿Alguien lo pagó con su propio dinero? <span className="muted small" style={{ textTransform: 'none' }}>(opcional: queda en "falta reponer" hasta que se le devuelva)</span>
                    <input list="personas-gasto" value={f.adelanto_por || ''} placeholder="vacío = lo paga Urbis o el proyecto"
                      disabled={!!(editId && list.find(x => x.id === editId)?.reposicion_id)}
                      onChange={e => setF(x => ({ ...x, adelanto_por: e.target.value }))} />
                  </label>
                )}
              </div>
            </div>
          )}

          {paso === 3 && (
            <div className="sg-paso">
              <p className="sg-preg">3. ¿Cuánto, cuándo y cómo se paga?</p>
              <div className="form-grid">
                <label>Monto S/
                  <input type="number" step="0.01" min="0" value={f.amount || ''} placeholder="700.00"
                    onChange={e => { setFaltaPaso(''); setF(x => ({ ...x, amount: e.target.value })) }} />
                </label>
                <label>Fecha
                  <input type="date" value={f.issue_date || ''} onChange={e => setF(x => ({ ...x, issue_date: e.target.value }))} />
                </label>
                <label>¿Cómo se paga?
                  <select value={f.payment_method || ''} onChange={e => setF(x => ({ ...x, payment_method: e.target.value }))}>
                    <option value="">- elegir -</option>
                    {['EFECTIVO', 'TRANSFERENCIA', 'DEPOSITO', 'YAPE'].map(m => <option key={m}>{m}</option>)}
                  </select>
                </label>
                <label>Comprobante que va a presentar
                  <input value={f.document_type || ''} placeholder="RH, FACTURA, BOLETA…" onChange={e => setF(x => ({ ...x, document_type: e.target.value }))} />
                  <span className="sg-ej">Ej.: RH, si cobra con recibo por honorarios.</span>
                </label>
                <div className="span2">
                  <p className="sg-sub">¿Quién entrega el dinero? <span className="muted small" style={{ textTransform: 'none' }}>(firma 2, la de la derecha)</span></p>
                  {proyecto?.expense_approval ? (
                    sociaFija ? (
                      <div className="sg-fija">
                        <b>{sociaFija.full_name}</b>{sociaFija.dni ? ' · DNI ' + sociaFija.dni : <span className="warn"> · ⚠ sin DNI: cárgalo en Usuarios</span>}
                        <div className="muted small" style={{ textTransform: 'none' }}>Es la socia del proyecto: aprueba, entrega el dinero y sube el voucher del pago. La pone el sistema.</div>
                      </div>
                    ) : socias.length > 1 ? (
                      <select value={f.sender || ''} onChange={e => { const s = socias.find(x => x.full_name === e.target.value); setFaltaPaso(''); setF(x => ({ ...x, sender: e.target.value, sender_dni: s?.dni || '' })) }}>
                        <option value="">- elegir la socia -</option>
                        {socias.map(s => <option key={s.id} value={s.full_name}>{s.full_name}</option>)}
                      </select>
                    ) : (
                      <p className="bad small" style={{ textTransform: 'none' }}>Este proyecto no tiene socia asignada: nadie podría aprobar el gasto. Pídele al superusuario que se la asigne en Usuarios.</p>
                    )
                  ) : (
                    <div className="form-grid" style={{ margin: 0 }}>
                      <label>Nombre
                        <input list="personas-gasto" value={f.sender || ''}
                          onChange={e => {
                            const v = e.target.value, d = dniDe(v)
                            setFaltaPaso('')
                            setF(x => ({ ...x, sender: v, ...(d ? { sender_dni: d } : {}) }))
                          }} />
                      </label>
                      <label>DNI
                        <input value={f.sender_dni || ''} inputMode="numeric" onChange={e => setF(x => ({ ...x, sender_dni: e.target.value }))} />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {paso === 4 && (() => {
            const quienPide = solicitante?.full_name || ''
            const recibe = String(f.recipient || '').trim().toUpperCase()
            const mismo = quienPide && recibe === quienPide.toUpperCase()
            const entrega = sociaFija?.full_name || f.sender || ''
            return (
              <div className="sg-paso">
                <p className="sg-preg">4. Revisa y registra</p>
                <div className="sg-firmas">
                  <div>
                    <span className="muted small">FIRMA 1 · IZQUIERDA</span>
                    <b>{quienPide || (proyecto?.expense_approval ? '⚠ falta elegir' : 'se firma en papel')}</b>
                    <span className="small" style={{ textTransform: 'none' }}>{mismo ? 'pide el gasto y recibe el dinero' : 'pide el gasto' + (recibe ? ' · el dinero lo recibe ' + recibe : '')}</span>
                  </div>
                  <div>
                    <span className="muted small">FIRMA 2 · DERECHA</span>
                    <b>{entrega || '—'}</b>
                    <span className="small" style={{ textTransform: 'none' }}>{proyecto?.expense_approval ? 'aprueba y entrega el dinero' : 'entrega el dinero'}</span>
                  </div>
                </div>
                <ol className="sg-flujo">
                  <li>{quienPide ? primerNombre(quienPide) + ' firma la solicitud con su código (le llega el aviso).' : 'Se imprime y se firma en papel.'}</li>
                  {proyecto?.expense_approval && <li>{primerNombre(entrega) || 'La socia'} la revisa y la aprueba con su firma.</li>}
                  {proyecto?.expense_approval && <li>{primerNombre(entrega) || 'La socia'} paga y sube el voucher del pago.</li>}
                  <li>Se sube {f.document_type ? 'el ' + String(f.document_type).toUpperCase() : 'el RH o la factura'} de quien recibió el dinero.</li>
                </ol>
                <p className="sg-resumen"><b>{soles(f.amount)}</b> · {f.issue_date ? fechaLetras(f.issue_date) : ''} · {f.payment_method || 'sin método de pago'}</p>
                {/* VISTA PREVIA: la MISMA constancia que se imprime, armada con lo que
                    está escrito ahora. Así nadie descubre un error recién cuando la
                    imprime para hacerla firmar. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                  <b style={{ fontSize: 13 }}>👁️ ASÍ SALE LA CONSTANCIA</b>
                  {(f.plantilla_propia || '').trim() && !editTexto && <span className="warn small" style={{ textTransform: 'none' }}>con texto propio de esta solicitud</span>}
                  <button type="button" className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setEditTexto(x => !x)}>
                    {editTexto ? '✓ Listo' : '✏️ Editar el texto de esta constancia'}
                  </button>
                </div>
                {/* EL TEXTO DE ESTA SOLA CONSTANCIA (sql/143, 12 oct): se edita aquí, mirando
                    la vista previa de abajo. La plantilla del proyecto no se toca. */}
                {editTexto && (() => {
                  const base = proyecto?.expense_template || DEFAULT_GASTO_TEMPLATE
                  const firmada = editId && (filaEdit => filaEdit && (filaEdit.requester_signed_at || filaEdit.approved_at))(list.find(g => g.id === editId))
                  return (
                    <div className="sg-texto">
                      <p className="muted small" style={{ textTransform: 'none', margin: '0 0 6px' }}>
                        Cambia solo <b>esta</b> constancia; la plantilla del proyecto queda igual. Lo que está entre <code>{'{{ }}'}</code> se llena
                        solo con los datos de la solicitud (nombre, DNI, monto…): puedes moverlo, pero no lo borres.
                        {firmada && <b className="warn"> Esta solicitud ya tiene firmas: al guardarla con otro texto hay que volver a firmarla.</b>}
                      </p>
                      <textarea rows={11} value={(f.plantilla_propia || '').trim() ? f.plantilla_propia : base} spellCheck="false"
                        onChange={e => setF(x => ({ ...x, plantilla_propia: e.target.value === base ? '' : e.target.value }))} />
                      <div className="sg-vars">
                        {[['RECEPTOR', 'quien recibe'], ['RECEPTOR_DNI', 'su DNI'], ['REMITENTE', 'quien entrega'], ['REMITENTE_DNI', 'su DNI'],
                          ['MONTO', 'monto'], ['MONTO_LETRAS', 'monto en letras'], ['MOTIVO', 'motivo'], ['FECHA_LETRAS', 'fecha'],
                          ['PROYECTO', 'proyecto'], ['DESCUENTO', 'se descuenta de'], ['TABLA_DETALLE', 'tabla del detalle']].map(([v, t]) => (
                          <span key={v}><code>{'{{' + v + '}}'}</code> {t}</span>
                        ))}
                      </div>
                      {(f.plantilla_propia || '').trim() && (
                        <button type="button" className="link-btn small" onClick={() => setF(x => ({ ...x, plantilla_propia: '' }))}>
                          ↺ volver al texto del proyecto
                        </button>
                      )}
                      {puedeCorregir && (
                        <button type="button" className="link-btn small" style={{ marginLeft: 12 }} onClick={() => { setTplOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
                          cambiar la plantilla del proyecto (para TODAS las solicitudes)
                        </button>
                      )}
                    </div>
                  )
                })()}
                <div className="print-area contract"
                  style={{ background: '#fff', color: '#111', padding: '20px 22px', borderRadius: 8, marginTop: 6, maxHeight: 460, overflow: 'auto' }}>
                  <p style={{ textAlign: 'right' }} className="small"><b>SOLICITUD N. {numeroDe(editId ? (list.find(g => g.id === editId) || {}) : {})}</b></p>
                  {constanciaDe({
                    ...f,
                    sender: entrega || f.sender,
                    sender_dni: sociaFija?.dni || f.sender_dni,
                    amount: Number(f.amount || 0),
                    issue_date: f.issue_date || hoy(),
                    request_number: editId ? (list.find(g => g.id === editId)?.request_number ?? null) : null,
                  }, { conFirmas: true })}
                  {/* las dos firmas, como salen al imprimir (ahí van con la firma y el código) */}
                  <table className="ctable firmas"><tbody><tr>
                    <td style={{ textAlign: 'center', paddingTop: '4.5em', width: '50%' }}>
                      ______________________________<br /><b>RECEPTOR</b><br />{quienPide || f.recipient || ''}
                      {f.recipient_dni ? <><br />DNI: {f.recipient_dni}</> : null}
                    </td>
                    <td style={{ textAlign: 'center', paddingTop: '4.5em', width: '50%' }}>
                      ______________________________<br /><b>REMITENTE</b><br />{entrega}
                      {(sociaFija?.dni || f.sender_dni) ? <><br />DNI: {sociaFija?.dni || f.sender_dni}</> : null}
                    </td>
                  </tr></tbody></table>
                </div>
                <p className="muted small" style={{ textTransform: 'none', marginTop: 4 }}>
                  Las firmas y sus códigos aparecen al imprimirla, cuando ya esté firmada.
                </p>
              </div>
            )
          })()}

          <datalist id="personas-gasto">
            {opcionesPersonas.map(([n, d]) => <option key={n} value={n}>{d ? 'DNI ' + d : ''}</option>)}
          </datalist>
          {faltaPaso && <p className="error" style={{ textTransform: 'none', margin: '10px 0 0' }}>{faltaPaso}</p>}
          <div className="sg-botones">
            {paso > 1 && <button type="button" className="btn-ghost" onClick={() => { setPaso(paso - 1); setFaltaPaso('') }}>← Atrás</button>}
            {paso < 4
              ? <button className="btn-primary">Siguiente →</button>
              : <button className="btn-primary" disabled={busy}>{busy ? 'Guardando...' : (editId ? 'Guardar cambios' : 'Registrar solicitud')}</button>}
            <button type="button" className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setShow(false)} disabled={busy}>Cancelar</button>
          </div>
        </form>
      )}

      {/* LO QUE TE TOCA, arriba y con su botón: antes había que buscar la fila en
          la tabla y correrla hasta la última columna. */}
      {pendientesMias.length > 0 && (
        <div className="glass form-card" style={{ maxWidth: 'none' }}>
          <p style={{ margin: '0 0 8px' }}><b>✍ TE TOCA ({pendientesMias.length})</b></p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: esCelular ? 14 : 8 }}>
            {pendientesMias.slice(0, 8).map(({ g, modo }) => (
              <div key={g.id} style={{ display: 'flex', gap: esCelular ? 6 : 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <b style={{ minWidth: 90 }}>{numeroDe(g)}</b>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{soles(g.amount)}</b>
                <span className="muted small" style={{ textTransform: 'none', flexBasis: esCelular ? '100%' : undefined }}>
                  {g.recipient || '—'} · {(g.description || g.type || '').slice(0, 60)}
                </span>
                <button className="btn-primary"
                  style={esCelular ? { width: '100%', padding: '.8rem' } : { fontSize: 12, marginLeft: 'auto', whiteSpace: 'nowrap' }}
                  onClick={() => modo === 'pagar' ? setPagar(g) : setAprobar({ g, modo })}>
                  {modo === 'solicitar' ? '✍ Firmar' : modo === 'pagar' ? '💸 Subir comprobante de pago' : '✍ Revisar y firmar'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* En el celular cada gasto es una TARJETA: la tabla de 11 columnas obligaba
          a correr la pantalla de costado y los botones no se alcanzaban. */}
      {esCelular ? (
        <div className="gastos-cards">
          {filtrada.length === 0 && <p className="muted" style={{ padding: 12 }}>No hay gastos con estos filtros.</p>}
          {filtrada.slice(0, 200).map(tarjetaGasto)}
        </div>
      ) : (
      <div className="glass table-wrap">
        <table>
          <thead><tr><th>N&#176;</th><th>Fecha</th><th>Estado</th><th>Firma / pago</th><th>Tipo</th><th>Receptor</th><th>Monto</th><th>Constancia</th><th>RH/Factura</th><th>{hay125 ? 'Vouchers (gasto / reposición)' : 'Comprobante de pago'}</th><th></th></tr></thead>
          <tbody>
            {filtrada.slice(0, 200).map(g => (
              <tr key={g.id}>
                <td>{g.request_number ? <b>{'SOL-' + String(g.request_number).padStart(5, '0')}</b> : <span className="muted">-</span>}</td>
                <td>{g.issue_date || g.reception_date || '-'}</td>
                <td>{estadoDe(g)}</td>
                {/* La firma va ADELANTE: antes estaba en la última columna y había
                    que barrer toda la tabla a la derecha para llegar al botón. */}
                <td>{accionesFirma(g, false)}</td>
                <td>{g.type}</td>
                <td title={g.description}>{g.recipient || '-'}</td>
                <td>{soles(g.amount)}</td>
                <td>{docConstancia(g)}</td>
                <td><UpBtn g={g} campo="receipt_url" carpeta="rh" label="subir" alerta={g.status === 'confirmado' && !g.receipt_url} /></td>
                <td>{docVouchers(g)}</td>
                {/* los botones de firma viven en la columna "Firma", adelante:
                    acá quedan las acciones de oficina */}
                <td>{accionesOficina(g)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {prt && (
          <div className="modal-bg" onClick={() => setPrt(null)}>
            <div className="glass modal print-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-head no-print">
                <h2>Constancia — {prt.recipient}</h2>
                <button className="btn-primary" onClick={() => window.print()}>Imprimir / PDF</button>
                <button className="btn-ghost" onClick={() => setPrt(null)}>&#10005;</button>
              </div>
              <div className="print-area contract">
                <HojaConstancia g={prt} proyecto={proyecto} verif={verif} />
              </div>
            </div>
          </div>
      )}

      {aprobar && (
        <AprobarGasto gasto={aprobar.g} modo={aprobar.modo} proyecto={proyecto} profile={profile} firmaUrl={tengoFirma}
          onCerrar={() => setAprobar(null)}
          onHecho={t => { setAprobar(null); setMsg({ ok: true, t }); load() }}
          onPedirFirma={() => { setAprobar(null); setCambiarFirma(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
      )}

      {pagar && (
        <RegistrarPago gasto={pagar} proyecto={proyecto}
          onCerrar={() => setPagar(null)}
          onHecho={t => { setPagar(null); setMsg({ ok: true, t }); load() }} />
      )}

      {reponer && (
        <ReponerGasto pidOp={pidOp} gastos={list} inicial={reponer} opcionesPersonas={opcionesPersonas}
          onCerrar={() => setReponer(null)}
          onHecho={t => { setReponer(null); setMsg({ ok: true, t }); load() }} />
      )}

      {verDoc && (
        <div className="modal-bg" onClick={() => setVerDoc(null)}>
          <div className="glass modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 900, width: '95%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-head">
              <b>{String(verDoc.titulo || 'documento').toUpperCase()}</b>
              <a href={verDoc.url} target="_blank" rel="noreferrer" className="muted small">abrir aparte ↗</a>
              <button className="btn-ghost" onClick={() => setVerDoc(null)}>&#10005;</button>
            </div>
            <VisorDoc url={verDoc.url} titulo={verDoc.titulo} alto={560} />
          </div>
        </div>
      )}
    </>
  )
}
