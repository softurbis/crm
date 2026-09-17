import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { upload, subirRuta } from '../lib/archivos'
import { useMsg } from '../lib/saveFx'
import { letras, fechaLetras } from '../lib/letras'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'
import VisorDoc from '../components/VisorDoc'
import FirmaPad from '../components/FirmaPad'
import AprobarGasto from '../components/AprobarGasto'
import RegistrarPago from '../components/RegistrarPago'
import { useEsCelular } from '../lib/useEsCelular'

const hoy = () => new Date().toISOString().slice(0, 10)
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

const DEFAULT_GASTO_TEMPLATE = `CONSTANCIA DE RECEPCION DE DINERO

Yo, {{RECEPTOR}}, identificado con DNI N. {{RECEPTOR_DNI}}, dejo constancia de haber recibido en la fecha {{FECHA_LETRAS}}, la suma de {{MONTO}} ({{MONTO_LETRAS}} SOLES) de parte de {{REMITENTE}}, identificado(a) con DNI N. {{REMITENTE_DNI}}.
Este monto corresponde al pago por {{MOTIVO}} del proyecto "{{PROYECTO}}".
{{TABLA_DETALLE}}
*Este presupuesto se descontara directamente de {{DESCUENTO}}.
Sin otro particular, firmo la presente para los fines que correspondan.

Pucallpa, {{FECHA_LETRAS}}.
{{FIRMA_RECEPTOR}}`


// Estado REAL de una solicitud. La columna status solo guarda solicitado /
// confirmado; las dos firmas viven en sus propias columnas (sql/73 y sql/74).
// El orden importa: primero firma quien pide el gasto, despues el socio. Una
// solicitud sin la primera firma NO esta "por aprobar", esta por firmar.
const estadoGasto = g => g.status === 'confirmado' ? 'confirmado'
  : g.rejected_at ? 'rechazado' : g.approved_at ? 'aprobado'
  : (g.requester_id && !g.requester_signed_at) ? 'por_firmar' : 'solicitado'
const fechaHora = s => new Date(s).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function Expenses() {
  const { profile, role } = useAuth()
  const { pidOp } = useProject()
  const readOnly = ['manager', 'socio'].includes(role)
  const esSocio = role === 'socio'
  const puedeAprobar = ['socio', 'superuser'].includes(role)
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
  const [editId, setEditId] = useState(null)
  const [prt, setPrt] = useState(null)
  const [tplOpen, setTplOpen] = useState(false)
  const [tplText, setTplText] = useState('')

  async function load() {
    if (!pidOp) return
    const [g, p] = await Promise.all([
      supabase.from('expenses').select('*').eq('project_id', pidOp).order('issue_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('projects').select('*').eq('id', pidOp).single(),
    ])
    setList(g.data || []); setProyecto(p.data || null)
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
      if (!t) return true
      return [g.company, g.recipient, g.sender, g.description, g.document_number, g.request_number ? 'sol-' + String(g.request_number).padStart(5, '0') : '']
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
  const miPuedeAprobar = g => puedeAprobar && estadoGasto(g) === 'solicitado' && (esSocio || proyecto?.expense_approval) && g.requester_id !== profile?.id
  // Tercer paso en los proyectos con aprobación (sql/101): aprobada la solicitud, la
  // socia paga y sube el comprobante. Hasta entonces el gasto está "pago pendiente".
  const pagoPendiente = g => !!proyecto?.expense_approval && estadoGasto(g) === 'aprobado'
  const miPuedePagar = g => puedeAprobar && pagoPendiente(g) && g.requester_id !== profile?.id
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
  const noAplican = list.filter(g => g.request_doc_na || g.receipt_na || g.voucher_na).length

  function abrirEditar(g) {
    setF({
      type: g.type, issue_date: g.issue_date, amount: g.amount,
      recipient: g.recipient, recipient_dni: g.recipient_dni, sender: g.sender,
      requester_id: g.requester_id || '',
      discount_from: g.discount_from, payment_method: g.payment_method,
      document_type: g.document_type, description: g.description, detail: g.detail,
    })
    setEditId(g.id); setShow(true); setMsg(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function guardar(e) {
    e.preventDefault()
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
        sender: up(f.sender), sender_dni: (f.sender_dni || '').trim() || null,
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
      // si todavía no se corrió sql/87, la columna sender_dni no existe: se
      // reintenta sin ella en vez de dejar a nadie sin poder registrar el gasto
      const sinDni = o => { const c = { ...o }; delete c.sender_dni; return c }
      const faltaCol = e => /sender_dni/i.test(e?.message || '')

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
        if (firmadas.length && !confirm('Esta solicitud ya tiene ' + firmadas.join(' y ') + '.\n\nSi la corriges se ANULA' + (firmadas.length > 1 ? 'n' : '') + ' y hay que volver a firmarla desde el principio.\n\n¿Corregir igual?')) { setBusy(false); return }
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
        setMsg({ ok: true, t: 'SOLICITUD CORREGIDA \u2014 se mantiene el mismo correlativo. Ya puedes imprimirla.' })
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
                    : 'IMPRIME LA CONSTANCIA Y HAZLA FIRMAR.'),
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
    if (g.rejected_at) { alert('Esta solicitud fue RECHAZADA por ' + (g.rejected_reason ? 'este motivo:\n\n' + g.rejected_reason : 'el socio') + '\n\nCorrígela con "editar" para reenviarla.'); return }
    // si se eligio un solicitante, se espera su firma — exija o no el proyecto la
    // del socio. Elegirlo ES pedirle la firma; si no, el selector se deja vacio.
    if (g.requester_id && !g.requester_signed_at) {
      alert('Falta la firma de ' + (g.sender || 'quien pidió el gasto') + '.'
        + (proyecto?.expense_approval ? '\n\nEste proyecto exige las DOS firmas: primero la de quien pide el gasto, después la del socio.' : '\n\nEsta solicitud espera su firma en el panel.'))
      return
    }
    if (proyecto?.expense_approval && !g.approved_at) { alert('Falta la aprobación del socio.\n\nEste proyecto exige que un socio revise y firme la solicitud antes de entregar el dinero.'); return }
    if (!confirm(`Confirmar que el dinero de "${g.description || g.type}" (${soles(g.amount)}) ya se entrego?`)) return
    await supabase.from('expenses').update({
      status: 'confirmado', reception_date: hoy(),
      confirmed_at: new Date().toISOString(), confirmed_by: profile?.id,
    }).eq('id', g.id)
    setMsg({ ok: true, t: 'PAGO CONFIRMADO. Sube el RH o factura.' }); load()
  }

  async function subirDoc(g, file, campo, carpeta) {
    try {
      // todo documento se sube con su nota/comentario
      const nota = prompt('Comentario / nota de este documento (opcional, Enter para saltar):')
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
    const nota = prompt('Comentario / nota de este documento:', g[kn] || '')
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
  const puedeNA = ['admin', 'superuser'].includes(role)

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
    const r = prompt(`¿Por que este gasto no va a tener ${doc}?\n\n${lista}\n\nEscribe el NUMERO del motivo, o el motivo con tus palabras:`)
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
    if (!confirm(`¿Volver a pedir ${LBL_DOC[campo]} para este gasto?\n\nVuelve a aparecer en la lista de faltantes.`)) return
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
      const nota = prompt('Nota de este RH adicional (de quién es, opcional):')
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
    if (!d || !confirm('¿Quitar este RH adicional' + (d.note ? ' (' + d.note + ')' : '') + '?\n\nEl archivo queda en el almacenamiento; solo se desliga del gasto.')) return
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
    if (!confirm('¿Quitar ' + LBL_DOC[campo] + ' de este gasto?\n\nLa casilla volvera a pedir el documento y podras subir otro. El archivo anterior queda en el almacenamiento.')) return
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
        {role === 'superuser' && <>
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
              {role === 'superuser' && <> <button className="link-btn" title="Quitar este RH adicional" onClick={() => quitarRhExtra(g, i)}>&#128465;</button></>}
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
  const ATAJOS = [
    { t: '📅 Administrativos del mes', f: { type: 'GASTOS ADMINISTRATIVOS', description: 'GASTOS ADMINISTRATIVOS CORRESPONDIENTE AL MES DE ' + MESES[new Date().getMonth()], discount_from: 'URBIS GROUP', payment_method: 'EFECTIVO' } },
    { t: '🤝 Pago de comisión', f: { type: 'PAGO DE COMISION', description: 'PAGO DE COMISION POR LA VENTA DEL LOTE ', discount_from: 'EL PROYECTO', payment_method: 'EFECTIVO' } },
    { t: '📣 Publicidad (ADS)', f: { type: 'GASTOS ADMINISTRATIVOS', description: 'PAGO DE PUBLICIDAD (ADS) DEL PROYECTO', discount_from: 'EL PROYECTO', payment_method: 'TRANSFERENCIA' } },
    { t: '🧰 Compra de materiales', f: { type: 'GASTOS DE DESARROLLO', description: 'COMPRA DE MATERIALES PARA EL PROYECTO', discount_from: 'EL PROYECTO', payment_method: 'EFECTIVO' } },
  ]
  // Lo que ya sabemos del proyecto viene puesto: quién firma la solicitud y a
  // quién se le suele entregar el dinero (lo último registrado de ese tipo).
  // Todo se puede cambiar: son valores de arranque, no una regla.
  function porDefecto(extra = {}) {
    const ult = list.find(g => (!extra.type || g.type === extra.type) && g.recipient) || {}
    const previo = firmantes.length === 1 ? firmantes[0].id : (list.find(g => g.requester_id)?.requester_id || '')
    // quien ENTREGA de parte de Urbis: el socio del proyecto, o el último que entregó
    const socio = personas.find(p => p.rol === 'socio')
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
  const usarAtajo = a => { setEditId(null); setF(porDefecto(a.f)); setShow(true) }

  // Copiar una solicitud anterior: sirve para el gasto que se repite cada mes.
  // No se copian ni el correlativo ni las firmas: es una solicitud nueva.
  function duplicar(g) {
    setEditId(null)
    setF({
      type: g.type, issue_date: hoy(), amount: g.amount, recipient: g.recipient, recipient_dni: g.recipient_dni,
      requester_id: g.requester_id || '', sender: g.sender, discount_from: g.discount_from,
      payment_method: g.payment_method, document_type: g.document_type, description: g.description, detail: g.detail,
    })
    setShow(true)
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

  // ---- LA CONSTANCIA, EN UN SOLO LUGAR ----
  // La arman igual la VISTA PREVIA (mientras se llena la solicitud) y la ventana
  // de imprimir: lo que se ve mientras se escribe es exactamente lo que se firma.
  const numeroDe = g => g.request_number ? 'SOL-' + String(g.request_number).padStart(5, '0')
    : g.id ? String(g.id).slice(0, 8).toUpperCase() : '(se asigna al registrarla)'

  function constanciaDe(g) {
    const vars = {
      RECEPTOR: g.recipient || '____________________',
      RECEPTOR_DNI: g.recipient_dni || '__________',
      REMITENTE: g.sender || '____________________',
      REMITENTE_DNI: g.sender_dni || '__________',
      FECHA_LETRAS: fechaLetras(g.issue_date || hoy()),
      MONTO: 'S/. ' + Number(g.amount || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 }),
      MONTO_LETRAS: letras(Number(g.amount || 0)),
      MOTIVO: g.description || g.type || '____________________',
      TIPO: g.type || '', PROYECTO: proyecto?.name || '',
      DESCUENTO: g.discount_from || 'URBIS GROUP',
      NUMERO: numeroDe(g),
    }
    const fill = t => t.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] !== undefined ? String(vars[k]) : m)

    const items = (g.detail || '').split('\n').map(l => l.split('|').map(x => x.trim())).filter(a => a.length >= 2)
    const TablaDetalle = items.length > 0 ? (
      <table className="ctable">
        <thead><tr><th>FECHA DE GASTO</th><th>DESCRIPCION</th><th>MONTO</th></tr></thead>
        <tbody>
          {items.map((a, i) => <tr key={i}><td>{a[0]}</td><td>{a[1]}</td><td>{a[2] ? 'S/. ' + a[2] : ''}</td></tr>)}
          <tr><td></td><td><b>TOTAL</b></td><td><b>{'S/. ' + Number(g.amount || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</b></td></tr>
        </tbody>
      </table>
    ) : null
    const Firma = (
      <table className="ctable firmas"><tbody><tr>
        <td style={{ textAlign: 'center', paddingTop: '5em' }}>
          ______________________________<br /><b>{vars.RECEPTOR}</b><br />DNI N. {vars.RECEPTOR_DNI}
        </td>
      </tr></tbody></table>
    )
    const BLOQ = { TABLA_DETALLE: TablaDetalle, FIRMA_RECEPTOR: Firma }

    const tpl = proyecto?.expense_template || DEFAULT_GASTO_TEMPLATE
    let primera = true
    return tpl.split('\n').map((ln, i) => {
      const t = ln.trim()
      if (!t) return null
      const mb = t.match(/^\{\{(\w+)\}\}$/)
      if (mb && mb[1] in BLOQ) return <div key={i}>{BLOQ[mb[1]]}</div>
      if (primera) { primera = false; return <h2 key={i} style={{ textAlign: 'center' }}>{fill(t)}</h2> }
      return <p key={i}>{fill(t)}</p>
    })
  }

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

  async function eliminarGasto(g) {
    if (!confirm(`ELIMINAR la solicitud "${g.description || g.type}" (${soles(g.amount)})?\nSolo se pueden eliminar solicitudes NO confirmadas.`)) return
    const { error } = await supabase.from('expenses').delete().eq('id', g.id)
    setMsg(error ? { ok: false, t: error.message } : { ok: true, t: 'SOLICITUD ELIMINADA' })
    load()
  }

  const accionesOficina = g => <>
    {!readOnly && <><button className="btn-ghost" title="Crear una solicitud nueva con estos mismos datos (el gasto que se repite cada mes)"
      onClick={() => duplicar(g)}>duplicar</button>{' '}</>}
    {g.status === 'solicitado' && ['admin', 'secretary', 'superuser'].includes(role) && (<>
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
      {['admin', 'superuser'].includes(role) && <button className="link-btn bad" onClick={() => eliminarGasto(g)}>eliminar</button>}
    </>)}
    {g.status === 'confirmado' && role === 'superuser' &&
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
      </div>
      {!readOnly && <div className="gc-oficina">{accionesOficina(g)}</div>}
    </div>
  )

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Gastos</h1>
        <ProjectPicker />
        {role === 'superuser' && (
          <button className="btn-ghost" onClick={() => setTplOpen(!tplOpen)}>
            {tplOpen ? 'Cerrar plantilla' : 'Plantilla de constancia (superusuario)'}
          </button>
        )}
      </div>

      {tplOpen && role === 'superuser' && (
        <div className="glass form-card" style={{ maxWidth: 'none' }}>
          <p><b>PLANTILLA DE CONSTANCIA DE RECEPCION — {proyecto?.name}</b></p>
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
        </select>
        {!readOnly && <button className="btn-primary" onClick={() => { setShow(!show); setEditId(null); setF(porDefecto()) }}>{show ? 'Cerrar' : '+ Solicitar gasto'}</button>}
      </div>

      <p className="hint">
        {filtrada.length} gastos | TOTAL: <b>{soles(total)}</b>
        {porFirmar > 0 && <span className="warn"> | ✍ ESPERAN LA FIRMA DEL SOLICITANTE: {porFirmar}</span>}
        {proyecto?.expense_approval && porAprobar > 0 && <span className="warn"> | ✍ POR APROBAR: {porAprobar}</span>}
        {!readOnly && pendConfirmar > 0 && <span className="warn"> | POR CONFIRMAR: {pendConfirmar}</span>}
        {!readOnly && faltaRH > 0 && <span className="bad"> | FALTA RH/FACTURA: {faltaRH}</span>}
        {!readOnly && noAplican > 0 && <span className="muted"> | SIN DOCUMENTO A PROPOSITO: {noAplican}</span>}
      </p>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      {role === 'superuser' && proyecto && 'expense_approval' in proyecto && (
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
      {role === 'superuser' && proyecto?.expense_approval && !tengoFirma && !cambiarFirma && (
        <p className="hint muted">Tú también puedes aprobar los gastos que no pediste: <button className="link-btn" onClick={() => setCambiarFirma(true)}>registrar mi firma</button></p>
      )}

      {show && !readOnly && (
        <form className="glass form-card" style={{ maxWidth: 'none' }} onSubmit={guardar}>
          <p><b>{editId ? 'CORREGIR SOLICITUD (se mantiene el mismo correlativo)' : 'SOLICITUD DE GASTO'}</b> — genera la CONSTANCIA DE RECEPCION para firma; al entregarse el dinero se confirma.</p>
          {!editId && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '0 0 10px', alignItems: 'center' }}>
              <span className="muted small" style={{ textTransform: 'none' }}>Atajos:</span>
              {ATAJOS.map(a => (
                <button key={a.t} type="button" className="chip" style={{ textTransform: 'none' }}
                  title="Llena el gasto típico; después puedes cambiar lo que quieras" onClick={() => usarAtajo(a)}>{a.t}</button>
              ))}
            </div>
          )}
          {/* dos columnas: los campos a la izquierda y la constancia a la
              derecha, para llenar mirando cómo va quedando. En pantalla angosta
              se apilan solas. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', gap: 18, alignItems: 'start' }}>
          <div className="form-grid">
            <label>Tipo
              <select value={f.type || ''} onChange={e => setF(x => ({ ...x, type: e.target.value }))} required>
                <option value="">- elegir -</option>
                {TIPOS.map(t => <option key={t}>{t}</option>)}
              </select>
            </label>
            {IN('issue_date', 'Fecha', 'date', true)}
            {IN('amount', 'Monto S/', 'number', true)}
            {/* LAS DOS PERSONAS DE LA CONSTANCIA. Al elegir a alguien conocido
                (del sistema o de un gasto anterior) su DNI se llena solo. */}
            <label>Quien RECIBE el dinero
              <input list="personas-gasto" value={f.recipient || ''} required
                onChange={e => {
                  const v = e.target.value, d = dniDe(v)
                  setF(x => ({ ...x, recipient: v, ...(d ? { recipient_dni: d } : {}) }))
                }} />
            </label>
            {IN('recipient_dni', 'DNI de quien recibe', 'text', true)}
            <label>Quien ENTREGA el dinero <span className="muted small">(de parte de Urbis)</span>
              <input list="personas-gasto" value={f.sender || ''}
                onChange={e => {
                  const v = e.target.value, d = dniDe(v)
                  setF(x => ({ ...x, sender: v, ...(d ? { sender_dni: d } : {}) }))
                }} />
            </label>
            {IN('sender_dni', 'DNI de quien entrega')}
            <datalist id="personas-gasto">
              {opcionesPersonas.map(([n, d]) => <option key={n} value={n}>{d ? 'DNI ' + d : ''}</option>)}
            </datalist>
            {/* El solicitante deja de ser un texto suelto: es la persona que
                despues FIRMA la solicitud en el panel (sql/74). Si el proyecto
                exige la aprobacion del socio, elegirlo es obligatorio — sin
                solicitante no hay primera firma y el pago no se destraba. */}
            <label>Quien FIRMA la solicitud <span className="muted small">(normalmente, quien recibe)</span>
              {firmantes.length > 0 ? (
                <select value={f.requester_id || ''} required={!!proyecto?.expense_approval}
                  onChange={e => {
                    const id = e.target.value
                    const p = firmantes.find(x => x.id === id)
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
            </label>
            <label>Se descuenta de
              <select value={f.discount_from || 'URBIS GROUP'} onChange={e => setF(x => ({ ...x, discount_from: e.target.value }))}>
                <option>URBIS GROUP</option>
                <option>EL PROYECTO</option>
              </select>
            </label>
            <label>Metodo de pago
              <select value={f.payment_method || ''} onChange={e => setF(x => ({ ...x, payment_method: e.target.value }))}>
                <option value="">- elegir -</option>
                {['EFECTIVO', 'TRANSFERENCIA', 'DEPOSITO', 'YAPE'].map(m => <option key={m}>{m}</option>)}
              </select>
            </label>
            {IN('document_type', 'Comprobante a presentar (RH, FACTURA...)')}
            <label className="span2">Motivo (sale en la constancia: "pago por ...")
              <input value={f.description || ''} onChange={e => setF(x => ({ ...x, description: e.target.value }))} required
                placeholder="GASTOS ADMINISTRATIVOS DEL MES DE JULIO / COMISION POR LA VENTA DEL LOTE MZ K LT 8 / OBRAS DE FUMIGADO..." />
            </label>
            {/* El detalle se llena como una tabla, no escribiendo con barras: cada
                fila sale igual en la constancia y el total puede llenar el monto. */}
            <div className="span2">
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
          </div>
          {/* VISTA PREVIA: la MISMA constancia que se imprime, armada con lo que
              está escrito ahora. Se actualiza al escribir, así nadie descubre un
              error recién cuando la imprime para hacerla firmar. */}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 13 }}>👁️ VISTA PREVIA DE LA CONSTANCIA</b>
              <span className="muted small" style={{ textTransform: 'none' }}>se actualiza mientras escribes</span>
              {role === 'superuser' && (
                <button type="button" className="link-btn" onClick={() => { setTplOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
                  ✏️ cambiar el texto de la plantilla
                </button>
              )}
            </div>
            <div className="print-area contract"
              style={{ background: '#fff', color: '#111', padding: '20px 22px', borderRadius: 8, marginTop: 6, maxHeight: 460, overflow: 'auto' }}>
              <p style={{ textAlign: 'right' }} className="small"><b>SOLICITUD N. {numeroDe(editId ? (list.find(g => g.id === editId) || {}) : {})}</b></p>
              {constanciaDe({
                ...f,
                amount: Number(f.amount || 0),
                issue_date: f.issue_date || hoy(),
                request_number: editId ? (list.find(g => g.id === editId)?.request_number ?? null) : null,
              })}
            </div>
            <p className="muted small" style={{ textTransform: 'none', marginTop: 4 }}>
              Las firmas y sus códigos aparecen al imprimirla, cuando ya esté firmada.
            </p>
          </div>
          </div>

          <button className="btn-primary" disabled={busy} style={{ marginTop: 12 }}>{busy ? 'Guardando...' : (editId ? 'Guardar cambios' : 'Registrar solicitud')}</button>
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
          <thead><tr><th>N&#176;</th><th>Fecha</th><th>Estado</th><th>Firma / pago</th><th>Tipo</th><th>Receptor</th><th>Monto</th><th>Constancia</th><th>RH/Factura</th><th>Comprobante de pago</th><th></th></tr></thead>
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
                <td>{docComprobante(g)}</td>
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
                <p style={{ textAlign: 'right' }} className="small"><b>SOLICITUD N. {numeroDe(prt)}</b></p>
                {prt.rejected_at && <p style={{ textAlign: 'center', border: '2px solid #c0392b', color: '#c0392b', padding: 6 }}><b>SOLICITUD RECHAZADA</b> · {prt.rejected_reason}</p>}
                {constanciaDe(prt)}
                <table className="ctable firmas"><tbody><tr>
                  {/* las DOS firmas de la constancia. Cada una sale con su
                      codigo: quien reciba el papel puede pedir que se verifique
                      contra el panel, y si el gasto cambio despues lo dice aqui. */}
                  <td style={{ textAlign: 'center', paddingTop: prt.requester_signed_at && prt.requester_signature_url ? '0.5em' : '4.5em', width: '50%' }}>
                    {prt.requester_signed_at && prt.requester_signature_url
                      ? <>
                          <img src={prt.requester_signature_url} alt="Firma de quien recibe" style={{ height: 70, display: 'block', margin: '0 auto' }} />
                          ______________________________<br /><b>RECEPTOR</b><br />{prt.requester_name || prt.recipient}
                          {prt.recipient_dni ? <><br />DNI: {prt.recipient_dni}</> : null}<br />
                          <span className="small">Firmado electrónicamente el {fechaHora(prt.requester_signed_at)}<br />Código de verificación: <b>{prt.requester_code}</b>
                            {verif?.solicitud_valida === false && <><br /><b style={{ color: '#c0392b' }}>⚠ EL GASTO FUE MODIFICADO DESPUÉS DE LA FIRMA</b></>}
                            {verif?.solicitud_valida === true && ' · verificado'}</span>
                        </>
                      : <>______________________________<br /><b>RECEPTOR</b>{prt.recipient ? <><br />{prt.recipient}</> : null}
                          {prt.recipient_dni ? <><br />DNI: {prt.recipient_dni}</> : null}</>}
                  </td>
                  <td style={{ textAlign: 'center', paddingTop: prt.approved_at && prt.approval_signature_url ? '0.5em' : '4.5em', width: '50%' }}>
                    {prt.approved_at && prt.approval_signature_url
                      ? <>
                          <img src={prt.approval_signature_url} alt="Firma de quien entrega" style={{ height: 70, display: 'block', margin: '0 auto' }} />
                          ______________________________<br /><b>REMITENTE</b><br />{prt.approved_name || prt.sender}
                          {prt.sender_dni ? <><br />DNI: {prt.sender_dni}</> : null}<br />
                          <span className="small">Firmado electrónicamente el {fechaHora(prt.approved_at)}<br />Código de verificación: <b>{prt.approval_code}</b>
                            {verif?.valido === false && <><br /><b style={{ color: '#c0392b' }}>⚠ EL GASTO FUE MODIFICADO DESPUÉS DE LA FIRMA</b></>}
                            {verif?.valido === true && ' · verificado'}</span>
                        </>
                      : <>______________________________<br /><b>REMITENTE</b><br />{prt.sender || 'ADMINISTRACION — URBIS GROUP'}
                          {prt.sender_dni ? <><br />DNI: {prt.sender_dni}</> : null}</>}
                  </td>
                </tr></tbody></table>
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
