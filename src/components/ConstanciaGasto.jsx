import { letras, fechaLetras } from '../lib/letras'

// ---- LA CONSTANCIA DE UN GASTO, EN UN SOLO LUGAR ----
// La arman igual la VISTA PREVIA de la solicitud, la ventana de imprimir de Gastos
// y la pantalla de Gastos del rol facturación (sql/145): lo que se ve es
// exactamente lo que se firma y se imprime.

export const DEFAULT_GASTO_TEMPLATE = `CONSTANCIA DE RECEPCION DE DINERO

Yo, {{RECEPTOR}}, identificado con DNI N. {{RECEPTOR_DNI}}, dejo constancia de haber recibido en la fecha {{FECHA_LETRAS}}, la suma de {{MONTO}} ({{MONTO_LETRAS}} SOLES) de parte de {{REMITENTE}}, identificado(a) con DNI N. {{REMITENTE_DNI}}.
Este monto corresponde al pago por {{MOTIVO}} del proyecto "{{PROYECTO}}".
{{TABLA_DETALLE}}
*Este presupuesto se descontara directamente de {{DESCUENTO}}.
Sin otro particular, firmo la presente para los fines que correspondan.

Pucallpa, {{FECHA_LETRAS}}.
{{FIRMA_RECEPTOR}}`

// la fecha de HOY en Lima: con la hora UTC, después de las 7 pm salía la de mañana
const hoy = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10)
export const fechaHora = s => new Date(s).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// Estado REAL de una solicitud. La columna status solo guarda solicitado /
// confirmado; las dos firmas viven en sus propias columnas (sql/73 y sql/74).
// El orden importa: primero firma quien pide el gasto, despues el socio. Una
// solicitud sin la primera firma NO esta "por aprobar", esta por firmar.
// 'en_papel' (sql/183): la firma que toca ahora va A MANO y falta subir la hoja firmada.
export const estadoGasto = g => g.status === 'confirmado' ? 'confirmado'
  : g.rejected_at ? 'rechazado' : g.approved_at ? 'aprobado'
  : (g.requester_papel && !g.requester_signed_at) ? 'en_papel'
  : (g.requester_id && !g.requester_signed_at) ? 'por_firmar'
  : g.approval_papel ? 'en_papel' : 'solicitado'

// FIRMA EN PAPEL (sql/183, 5 nov): cada firma de la constancia va digital (en el panel,
// con código) o a mano en la hoja impresa, que después se sube. Las firmas en papel que
// todavía faltan: 'solicitud' (izquierda, quien recibe) y/o 'aprobacion' (derecha, quien
// entrega). Solo la de la izquierda mientras ella falte: la aprobación va después.
export const firmasEnPapelFaltan = g => {
  if (g.status === 'confirmado' || g.rejected_at) return []
  const izq = !!g.requester_papel && !g.requester_signed_at
  const der = !!g.approval_papel && !g.approved_at
  return [izq && 'solicitud', der && 'aprobacion'].filter(Boolean)
}
// ¿se puede subir ya la hoja? la aprobación en papel espera la firma digital de la izquierda
export const hojaListaParaSubir = g => {
  const f = firmasEnPapelFaltan(g)
  if (!f.length) return false
  if (f.includes('solicitud')) return true
  return !!g.requester_signed_at || !g.requester_id
}

export const numeroGasto = g => g.request_number ? 'SOL-' + String(g.request_number).padStart(5, '0')
  : g.id ? String(g.id).slice(0, 8).toUpperCase() : '(se asigna al registrarla)'

// `conFirmas`: abajo van las DOS firmas (receptor y remitente), así que la línea de
// firma del receptor de la plantilla ({{FIRMA_RECEPTOR}}) sobra: salía el nombre de
// quien recibe dos veces (10 oct, "sale de más la firma de Victor arriba")
export function constanciaGasto(g, proyecto, { conFirmas = false } = {}) {
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
    NUMERO: numeroGasto(g),
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
  const BLOQ = { TABLA_DETALLE: TablaDetalle, FIRMA_RECEPTOR: conFirmas ? null : Firma }

  // firmada: manda la copia del texto que se guardó al firmar (sql/102). Cambiar la
  // plantilla después no puede cambiar lo que alguien ya firmó.
  // sin firmar: el texto propio de esta solicitud (sql/143) o el del proyecto
  const tpl = g.plantilla_firmada || (g.plantilla_propia || '').trim() || proyecto?.expense_template || DEFAULT_GASTO_TEMPLATE
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

// Las DOS firmas de la constancia impresa. Cada una sale con su código: quien reciba
// el papel puede pedir que se verifique contra el panel, y si el gasto cambió después
// lo dice aquí. `verif`: { valido, solicitud_valida } (verificar_gasto, o lo que trae
// facturacion_gastos como firma_valida / solicitud_valida).
export function FirmasConstancia({ g, verif }) {
  // una firma puesta A MANO (sql/183): no hay imagen; la firma está en la hoja subida
  const aMano = (cuando, quien, dni, codigo, valida, rol) => <>
    ______________________________<br /><b>{rol}</b><br />{quien}
    {dni ? <><br />DNI: {dni}</> : null}<br />
    <span className="small">Firmado a mano · hoja firmada subida el {fechaHora(cuando)}<br />Código de verificación: <b>{codigo}</b>
      {valida === false && <><br /><b style={{ color: '#c0392b' }}>⚠ EL GASTO FUE MODIFICADO DESPUÉS DE LA FIRMA</b></>}
      {valida === true && ' · verificado'}</span>
  </>
  const izqPapel = g.requester_signed_at && !g.requester_signature_url && g.requester_papel
  const derPapel = g.approved_at && !g.approval_signature_url && g.approval_papel
  return (
    <table className="ctable firmas"><tbody><tr>
      <td style={{ textAlign: 'center', paddingTop: g.requester_signed_at && g.requester_signature_url ? '0.5em' : '4.5em', width: '50%' }}>
        {izqPapel ? aMano(g.requester_signed_at, g.requester_name || g.recipient, g.recipient_dni, g.requester_code, verif?.solicitud_valida, 'RECEPTOR')
        : g.requester_signed_at && g.requester_signature_url
          ? <>
              <img src={g.requester_signature_url} alt="Firma de quien recibe" style={{ height: 70, display: 'block', margin: '0 auto' }} />
              ______________________________<br /><b>RECEPTOR</b><br />{g.requester_name || g.recipient}
              {g.recipient_dni ? <><br />DNI: {g.recipient_dni}</> : null}<br />
              <span className="small">Firmado electrónicamente el {fechaHora(g.requester_signed_at)}<br />Código de verificación: <b>{g.requester_code}</b>
                {verif?.solicitud_valida === false && <><br /><b style={{ color: '#c0392b' }}>⚠ EL GASTO FUE MODIFICADO DESPUÉS DE LA FIRMA</b></>}
                {verif?.solicitud_valida === true && ' · verificado'}</span>
            </>
          : <>______________________________<br /><b>RECEPTOR</b>{g.recipient ? <><br />{g.recipient}</> : null}
              {g.recipient_dni ? <><br />DNI: {g.recipient_dni}</> : null}</>}
      </td>
      <td style={{ textAlign: 'center', paddingTop: g.approved_at && g.approval_signature_url ? '0.5em' : '4.5em', width: '50%' }}>
        {derPapel ? aMano(g.approved_at, g.approved_name || g.sender, g.sender_dni, g.approval_code, verif?.valido, 'REMITENTE')
        : g.approved_at && g.approval_signature_url
          ? <>
              <img src={g.approval_signature_url} alt="Firma de quien entrega" style={{ height: 70, display: 'block', margin: '0 auto' }} />
              ______________________________<br /><b>REMITENTE</b><br />{g.approved_name || g.sender}
              {g.sender_dni ? <><br />DNI: {g.sender_dni}</> : null}<br />
              <span className="small">Firmado electrónicamente el {fechaHora(g.approved_at)}<br />Código de verificación: <b>{g.approval_code}</b>
                {verif?.valido === false && <><br /><b style={{ color: '#c0392b' }}>⚠ EL GASTO FUE MODIFICADO DESPUÉS DE LA FIRMA</b></>}
                {verif?.valido === true && ' · verificado'}</span>
            </>
          : <>______________________________<br /><b>REMITENTE</b><br />{g.sender || 'ADMINISTRACION — URBIS GROUP'}
              {g.sender_dni ? <><br />DNI: {g.sender_dni}</> : null}</>}
      </td>
    </tr></tbody></table>
  )
}

// La hoja completa, como sale en papel: número, aviso de rechazada, el texto y las
// dos firmas. La usan la ventana de imprimir de Gastos y la de facturación.
export function HojaConstancia({ g, proyecto, verif }) {
  return <>
    <p style={{ textAlign: 'right' }} className="small"><b>SOLICITUD N. {numeroGasto(g)}</b></p>
    {g.rejected_at && <p style={{ textAlign: 'center', border: '2px solid #c0392b', color: '#c0392b', padding: 6 }}><b>SOLICITUD RECHAZADA</b> · {g.rejected_reason}</p>}
    {g.plantilla_firmada && proyecto?.expense_template && g.plantilla_firmada !== ((g.plantilla_propia || '').trim() || proyecto.expense_template) && (
      <p className="no-print small" style={{ textAlign: 'center', color: '#6b5a1e', background: '#fff6d6', padding: 4, borderRadius: 4 }}>
        🔒 Texto fijado al firmar: la plantilla del proyecto cambió después y esta constancia no la toma.
      </p>
    )}
    {constanciaGasto(g, proyecto, { conFirmas: true })}
    <FirmasConstancia g={g} verif={verif} />
  </>
}
