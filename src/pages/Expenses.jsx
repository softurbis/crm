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

const GASTO_VARS = ['RECEPTOR','RECEPTOR_DNI','FECHA_LETRAS','MONTO','MONTO_LETRAS','MOTIVO','TIPO','PROYECTO','DESCUENTO','NUMERO']
const GASTO_BLOQUES = ['TABLA_DETALLE','FIRMA_RECEPTOR']

const DEFAULT_GASTO_TEMPLATE = `CONSTANCIA DE RECEPCION DE DINERO

Yo, {{RECEPTOR}}, identificado con DNI N. {{RECEPTOR_DNI}}, dejo constancia de haber recibido en la fecha {{FECHA_LETRAS}}, la suma de {{MONTO}} ({{MONTO_LETRAS}} SOLES).
Este monto corresponde al pago por {{MOTIVO}} del proyecto "{{PROYECTO}}".
{{TABLA_DETALLE}}
*Este presupuesto se descontara directamente de {{DESCUENTO}}.
Sin otro particular, firmo la presente para los fines que correspondan.

Pucallpa, {{FECHA_LETRAS}}.
{{FIRMA_RECEPTOR}}`


// Estado REAL de una solicitud. La columna status solo guarda solicitado /
// confirmado; la decision del socio vive en sus propias columnas (sql/73).
const estadoGasto = g => g.status === 'confirmado' ? 'confirmado'
  : g.rejected_at ? 'rechazado' : g.approved_at ? 'aprobado' : 'solicitado'
const fechaHora = s => new Date(s).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function Expenses() {
  const { profile, role } = useAuth()
  const { pidOp } = useProject()
  const readOnly = ['manager', 'socio'].includes(role)
  const esSocio = role === 'socio'
  const puedeAprobar = ['socio', 'superuser'].includes(role)
  const [aprobar, setAprobar] = useState(null)          // solicitud abierta para firmar
  const [miFirma, setMiFirma] = useState(null)          // firma recien registrada (el perfil del contexto no se recarga solo)
  const [cambiarFirma, setCambiarFirma] = useState(false)
  const [firmaBusy, setFirmaBusy] = useState(false)
  const [verif, setVerif] = useState(null)              // huella de la firma: true intacta / false alterada / null sin dato
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
  useEffect(() => {
    setVerif(null)
    if (!prt?.approved_at) return
    supabase.rpc('verificar_gasto', { eid: prt.id }).then(({ data }) => setVerif(data ? !!data.valido : null), () => {})
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
  const faltaRH = list.filter(g => g.status === 'confirmado' && !g.receipt_url && !g.receipt_na).length
  const noAplican = list.filter(g => g.request_doc_na || g.receipt_na || g.voucher_na).length

  function abrirEditar(g) {
    setF({
      type: g.type, issue_date: g.issue_date, amount: g.amount,
      recipient: g.recipient, recipient_dni: g.recipient_dni, sender: g.sender,
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
      const campos = {
        type: f.type || 'OTROS', issue_date: f.issue_date || hoy(),
        recipient: up(f.recipient), recipient_dni: (f.recipient_dni || '').trim() || null,
        sender: up(f.sender), amount: Number(f.amount),
        document_type: up(f.document_type), payment_method: up(f.payment_method) || 'EFECTIVO',
        description: up(f.description), discount_from: f.discount_from || 'URBIS GROUP',
        detail: (f.detail || '').trim() || null,
      }
      if (editId) {
        // corrige la MISMA solicitud: conserva el correlativo (request_number).
        // Si ya estaba aprobada, la firma era sobre OTROS datos: se anula y la
        // solicitud vuelve a pedir la firma del socio. Si estaba rechazada,
        // corregirla la reenvia.
        const antes = list.find(x => x.id === editId)
        if (antes?.approved_at && !confirm('Esta solicitud ya estaba APROBADA por ' + (antes.approved_name || 'el socio') + '.\n\nSi la corriges, la aprobación se ANULA y vuelve a pedir su firma.\n\n¿Corregir igual?')) { setBusy(false); return }
        const reinicio = antes && 'approved_at' in antes ? {
          approved_by: null, approved_at: null, approved_name: null, approval_signature_url: null, approval_hash: null, approval_code: null,
          rejected_by: null, rejected_at: null, rejected_reason: null, approval_notified_at: null, decision_notified_at: null,
        } : {}
        const { error } = await supabase.from('expenses').update({ ...campos, ...reinicio }).eq('id', editId)
        if (error) throw new Error(error.message)
        setMsg({ ok: true, t: 'SOLICITUD CORREGIDA \u2014 se mantiene el mismo correlativo. Ya puedes imprimirla.' })
      } else {
        const { data: creado, error } = await supabase.from('expenses')
          .insert({ project_id: pidOp, company: 'URBIS GROUP', status: 'solicitado', registered_by: profile?.id, ...campos })
          .select('request_number').single()
        if (error) throw new Error(error.message)
        setMsg({ ok: true, t: 'SOLICITUD ' + (creado?.request_number ? 'N\u00B0 SOL-' + String(creado.request_number).padStart(5, '0') + ' ' : '') + 'REGISTRADA. Imprime la constancia y hazla firmar.' })
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
      setMsg({ ok: true, t: 'FIRMA REGISTRADA. Ya puedes aprobar solicitudes.' })
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

  const IN = (k, label, type = 'text', req = false) => (
    <label key={k}>{label}
      <input type={type} step="0.01" value={f[k] || ''} required={req}
        onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} />
    </label>
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
          <option value="por_aprobar">POR APROBAR (socio)</option>
          <option value="aprobado">APROBADOS, SIN PAGAR</option>
          <option value="rechazado">RECHAZADOS</option>
          <option value="falta_rh">FALTA RH / FACTURA</option>
          <option value="no_aplica">MARCADOS "NO APLICA"</option>
        </select>
        {!readOnly && <button className="btn-primary" onClick={() => { setShow(!show); setEditId(null); setF({}) }}>{show ? 'Cerrar' : '+ Solicitar gasto'}</button>}
      </div>

      <p className="hint">
        {filtrada.length} gastos | TOTAL: <b>{soles(total)}</b>
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
      {puedeAprobar && ((esSocio && !(miFirma || profile?.signature_url)) || cambiarFirma) && (
        <div className="glass form-card">
          <p><b>✍ {(miFirma || profile?.signature_url) ? 'CAMBIAR' : 'REGISTRA'} TU FIRMA</b></p>
          <p className="muted small" style={{ textTransform: 'none' }}>Dibújala con el dedo o el mouse, como firmas en papel. Se usa en cada aprobación, junto con tu contraseña.</p>
          <FirmaPad busy={firmaBusy} onGuardar={guardarFirma} />
          {cambiarFirma && <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setCambiarFirma(false)}>Cancelar</button>}
        </div>
      )}
      {puedeAprobar && !cambiarFirma && (miFirma || profile?.signature_url) && (esSocio || proyecto?.expense_approval) && (
        <p className="hint">
          <img src={miFirma || profile.signature_url} alt="Tu firma" style={{ height: 30, background: '#fff', borderRadius: 4, verticalAlign: 'middle', padding: 2 }} />
          {' '}Tu firma registrada · <button className="link-btn" onClick={() => setCambiarFirma(true)}>cambiarla</button>
        </p>
      )}
      {role === 'superuser' && proyecto?.expense_approval && !(miFirma || profile?.signature_url) && !cambiarFirma && (
        <p className="hint muted">Tú también puedes aprobar como respaldo: <button className="link-btn" onClick={() => setCambiarFirma(true)}>registrar mi firma</button></p>
      )}

      {show && !readOnly && (
        <form className="glass form-card" onSubmit={guardar}>
          <p><b>{editId ? 'CORREGIR SOLICITUD (se mantiene el mismo correlativo)' : 'SOLICITUD DE GASTO'}</b> — genera la CONSTANCIA DE RECEPCION para firma; al entregarse el dinero se confirma.</p>
          <div className="form-grid">
            <label>Tipo
              <select value={f.type || ''} onChange={e => setF(x => ({ ...x, type: e.target.value }))} required>
                <option value="">- elegir -</option>
                {TIPOS.map(t => <option key={t}>{t}</option>)}
              </select>
            </label>
            {IN('issue_date', 'Fecha', 'date', true)}
            {IN('amount', 'Monto S/', 'number', true)}
            {IN('recipient', 'Receptor (quien recibe el dinero)', 'text', true)}
            {IN('recipient_dni', 'DNI del receptor', 'text', true)}
            {IN('sender', 'Solicitante')}
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
            <label className="span2">Detalle itemizado (opcional, una linea por gasto: FECHA | DESCRIPCION | MONTO)
              <textarea rows="3" value={f.detail || ''} style={{ textTransform: 'none' }}
                placeholder={'07/04/2026 | VENENO PARA FUMIGACION | 150.00\n08/04/2026 | ALMUERZO + AGUA | 30.00'}
                onChange={e => setF(x => ({ ...x, detail: e.target.value }))} />
            </label>
          </div>
          <button className="btn-primary" disabled={busy}>{busy ? 'Guardando...' : (editId ? 'Guardar cambios' : 'Registrar solicitud')}</button>
        </form>
      )}

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>N&#176;</th><th>Fecha</th><th>Estado</th><th>Tipo</th><th>Receptor</th><th>Monto</th><th>Constancia</th><th>RH/Factura</th><th>Sustento</th><th></th></tr></thead>
          <tbody>
            {filtrada.slice(0, 200).map(g => (
              <tr key={g.id}>
                <td>{g.request_number ? <b>{'SOL-' + String(g.request_number).padStart(5, '0')}</b> : <span className="muted">-</span>}</td>
                <td>{g.issue_date || g.reception_date || '-'}</td>
                <td>{(() => {
                  const e = estadoGasto(g)
                  if (e === 'confirmado') return <span className="ok">&#10004; CONFIRMADO</span>
                  if (e === 'aprobado') return <span className="ok" title={'Aprobado por ' + (g.approved_name || '') + ' · código ' + (g.approval_code || '')}>✍ APROBADO<br /><span className="muted small">{(g.approved_name || '').split(' ')[0]}</span></span>
                  if (e === 'rechazado') return <span className="bad" title={g.rejected_reason || ''}>✖ RECHAZADO<br /><span className="muted small" style={{ textTransform: 'none' }}>{(g.rejected_reason || '').slice(0, 40)}</span></span>
                  return <span className="warn">&#9203; {proyecto?.expense_approval ? 'POR APROBAR' : 'SOLICITADO'}</span>
                })()}</td>
                <td>{g.type}</td>
                <td title={g.description}>{g.recipient || '-'}</td>
                <td>{soles(g.amount)}</td>
                <td>
                  <button className="link-btn" onClick={() => setPrt(g)}>imprimir</button>{' | '}
                  <UpBtn g={g} campo="request_doc_url" carpeta="constancias" label="firmada" />
                </td>
                <td><UpBtn g={g} campo="receipt_url" carpeta="rh" label="subir" alerta={g.status === 'confirmado' && !g.receipt_url} /></td>
                <td><UpBtn g={g} campo="voucher_url" carpeta="sustentos" label="subir" /></td>
                <td>
                  {puedeAprobar && g.status === 'solicitado' && !g.approved_at && !g.rejected_at && (esSocio || proyecto?.expense_approval) && (
                    <><button className="btn-primary" style={{ fontSize: 12 }} onClick={() => setAprobar(g)}>✍ Revisar y firmar</button>{' '}</>
                  )}
                  {g.status === 'solicitado' && ['admin', 'secretary', 'superuser'].includes(role) && (<>
                    <button className="btn-ghost" onClick={() => abrirEditar(g)}>editar</button>{' '}
                    <button className="btn-ghost" onClick={() => confirmar(g)}>Confirmar pago</button>{' '}
                    {['admin', 'superuser'].includes(role) &&
                      <button className="link-btn bad" onClick={async () => {
                        if (!confirm(`ELIMINAR la solicitud "${g.description || g.type}" (${soles(g.amount)})?\nSolo se pueden eliminar solicitudes NO confirmadas.`)) return
                        const { error } = await supabase.from('expenses').delete().eq('id', g.id)
                        setMsg(error ? { ok: false, t: error.message } : { ok: true, t: 'SOLICITUD ELIMINADA' })
                        load()
                      }}>eliminar</button>}
                  </>)}
                  {g.status === 'confirmado' && role === 'superuser' &&
                    <button className="btn-ghost" onClick={() => abrirEditar(g)}>editar (superuser)</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {prt && (() => {
        const vars = {
          RECEPTOR: prt.recipient || '____________________',
          RECEPTOR_DNI: prt.recipient_dni || '__________',
          FECHA_LETRAS: fechaLetras(prt.issue_date),
          MONTO: 'S/. ' + Number(prt.amount).toLocaleString('es-PE', { minimumFractionDigits: 2 }),
          MONTO_LETRAS: letras(Number(prt.amount)),
          MOTIVO: prt.description || prt.type,
          TIPO: prt.type, PROYECTO: proyecto?.name || '',
          DESCUENTO: prt.discount_from || 'URBIS GROUP',
          NUMERO: prt.request_number ? 'SOL-' + String(prt.request_number).padStart(5, '0') : String(prt.id).slice(0, 8).toUpperCase(),
        }
        const fill = t => t.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] !== undefined ? String(vars[k]) : m)

        const items = (prt.detail || '').split('\n').map(l => l.split('|').map(x => x.trim())).filter(a => a.length >= 2)
        const TablaDetalle = items.length > 0 ? (
          <table className="ctable">
            <thead><tr><th>FECHA DE GASTO</th><th>DESCRIPCION</th><th>MONTO</th></tr></thead>
            <tbody>
              {items.map((a, i) => <tr key={i}><td>{a[0]}</td><td>{a[1]}</td><td>{a[2] ? 'S/. ' + a[2] : ''}</td></tr>)}
              <tr><td></td><td><b>TOTAL</b></td><td><b>{'S/. ' + Number(prt.amount).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</b></td></tr>
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
        const cuerpo = tpl.split('\n').map((ln, i) => {
          const t = ln.trim()
          if (!t) return null
          const mb = t.match(/^\{\{(\w+)\}\}$/)
          if (mb && mb[1] in BLOQ) return <div key={i}>{BLOQ[mb[1]]}</div>
          if (primera) { primera = false; return <h2 key={i} style={{ textAlign: 'center' }}>{fill(t)}</h2> }
          return <p key={i}>{fill(t)}</p>
        })

        return (
          <div className="modal-bg" onClick={() => setPrt(null)}>
            <div className="glass modal print-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-head no-print">
                <h2>Constancia — {prt.recipient}</h2>
                <button className="btn-primary" onClick={() => window.print()}>Imprimir / PDF</button>
                <button className="btn-ghost" onClick={() => setPrt(null)}>&#10005;</button>
              </div>
              <div className="print-area contract">
                <p style={{ textAlign: 'right' }} className="small"><b>SOLICITUD N. {vars.NUMERO}</b></p>
                {prt.rejected_at && <p style={{ textAlign: 'center', border: '2px solid #c0392b', color: '#c0392b', padding: 6 }}><b>SOLICITUD RECHAZADA</b> · {prt.rejected_reason}</p>}
                {cuerpo}
                <table className="ctable firmas"><tbody><tr>
                  <td style={{ textAlign: 'center', paddingTop: '4.5em', width: '50%' }}>
                    ______________________________<br /><b>SOLICITANTE</b>{prt.sender ? <><br />{prt.sender}</> : null}
                  </td>
                  <td style={{ textAlign: 'center', paddingTop: prt.approved_at && prt.approval_signature_url ? '0.5em' : '4.5em', width: '50%' }}>
                    {prt.approved_at && prt.approval_signature_url
                      ? <>
                          <img src={prt.approval_signature_url} alt="Firma de quien aprueba" style={{ height: 70, display: 'block', margin: '0 auto' }} />
                          ______________________________<br /><b>APRUEBA</b><br />{prt.approved_name}<br />
                          <span className="small">Firmado electrónicamente el {fechaHora(prt.approved_at)}<br />Código de verificación: <b>{prt.approval_code}</b>
                            {verif === false && <><br /><b style={{ color: '#c0392b' }}>⚠ EL GASTO FUE MODIFICADO DESPUÉS DE LA FIRMA</b></>}
                            {verif === true && ' · verificado'}</span>
                        </>
                      : <>______________________________<br /><b>APRUEBA</b><br />ADMINISTRACION — URBIS GROUP</>}
                  </td>
                </tr></tbody></table>
              </div>
            </div>
          </div>
        )
      })()}

      {aprobar && (
        <AprobarGasto gasto={aprobar} proyecto={proyecto} profile={profile} firmaUrl={miFirma || profile?.signature_url}
          onCerrar={() => setAprobar(null)}
          onHecho={t => { setAprobar(null); setMsg({ ok: true, t }); load() }}
          onPedirFirma={() => { setAprobar(null); setCambiarFirma(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
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
