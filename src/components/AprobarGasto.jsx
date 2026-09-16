import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const numSol = g => g.request_number ? 'SOL-' + String(g.request_number).padStart(5, '0') : String(g.id).slice(0, 8).toUpperCase()
const mmss = s => String(Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0')

// ============================================================
// REVISAR Y FIRMAR una solicitud de gasto
// ------------------------------------------------------------
// La misma pantalla sirve para las DOS firmas de la constancia, porque lo que
// hay que revisar antes de firmar es exactamente lo mismo:
//   modo="solicitar" → la firma de quien pide el gasto (firmar_solicitud, sql/74)
//   modo="aprobar"   → la firma del socio que lo autoriza (aprobar_gasto, sql/73)
//
// Firmar pide TRES cosas (sql/85):
//   1. la firma registrada de esa persona,
//   2. su contraseña escrita AHORA (el servidor rechaza una sesión vieja),
//   3. un código de 6 dígitos que le llega al celular — Telegram, o WhatsApp si
//      no lo tiene vinculado. Así no basta con saber la contraseña: hay que
//      tener el teléfono de esa persona.
// Si la base todavía no tiene sql/85, se firma como antes y la pantalla lo avisa.
// Rechazar es solo del socio y no pide contraseña ni código (no compromete
// dinero), pero sí el motivo: la secretaria lo recibe para corregir.
// ============================================================
export default function AprobarGasto({ gasto: g, proyecto, profile, firmaUrl, modo = 'aprobar', onCerrar, onHecho, onPedirFirma }) {
  const pidiendo = modo === 'solicitar'
  const accion = pidiendo ? 'solicitud' : 'aprobacion'
  const rpcFirma = pidiendo ? 'firmar_solicitud' : 'aprobar_gasto'
  const [pass, setPass] = useState('')
  const [codigo, setCodigo] = useState('')
  const [envio, setEnvio] = useState(null)       // { destino } cuando el código ya salió
  const [quedan, setQuedan] = useState(0)        // segundos de vida del código
  const [rechazo, setRechazo] = useState(null)   // null = firmando; texto = escribiendo el motivo
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // cuenta regresiva del código
  useEffect(() => {
    if (!quedan) return
    const t = setInterval(() => setQuedan(s => (s <= 1 ? 0 : s - 1)), 1000)
    return () => clearInterval(t)
  }, [quedan])

  const items = (g.detail || '').split('\n').map(l => l.split('|').map(x => x.trim())).filter(a => a.length >= 2)
  const docs = [['Constancia', g.request_doc_url], ['RH / factura', g.receipt_url], ['Sustento', g.voucher_url]].filter(([, u]) => u)
  const fila = (t, v) => v ? <tr><td style={{ opacity: .65, padding: '4px 10px 4px 0', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{t}</td><td style={{ padding: '4px 0' }}>{v}</td></tr> : null

  const faltaSql85 = e => /pedir_codigo_firma|schema cache|PGRST202/i.test(e || '')

  // Firma de verdad. `cod` va vacío cuando la base todavía no pide código.
  async function firmar(cod) {
    const args = cod === null ? { eid: g.id } : { eid: g.id, codigo: cod }
    const { data, error } = await supabase.rpc(rpcFirma, args)
    if (error) return { error }
    onHecho?.(pidiendo
      ? '✍ SOLICITUD ' + numSol(g) + ' FIRMADA · código ' + (data?.code || '')
        + (proyecto?.expense_approval ? '. Ahora pasa al socio para su aprobación.' : '')
      : '✍ SOLICITUD ' + numSol(g) + ' APROBADA Y FIRMADA · código de verificación ' + (data?.code || ''))
    return {}
  }

  // Paso 1: contraseña → se pide el código al celular
  async function pedirCodigo(e) {
    e?.preventDefault?.()
    if (!firmaUrl) { onPedirFirma?.(); return }
    if (!pass) { setErr('Escribe tu contraseña para firmar.'); return }
    setBusy(true); setErr('')
    // la contraseña: un inicio de sesión nuevo con la MISMA cuenta. Si está mal,
    // el gasto no se llega a tocar.
    const { error: e1 } = await supabase.auth.signInWithPassword({ email: profile?.email, password: pass })
    if (e1) { setBusy(false); setErr('Contraseña incorrecta.'); return }

    const { data, error } = await supabase.rpc('pedir_codigo_firma', { eid: g.id, accion })
    if (error && faltaSql85(error.message)) {
      // base sin sql/85: se firma como antes (contraseña + firma) y se avisa
      const r = await firmar(null)
      setBusy(false); setPass('')
      if (r.error) setErr(r.error.message)
      return
    }
    setBusy(false); setPass('')
    if (error) { setErr(error.message); return }
    setEnvio(data || {}); setQuedan((data?.minutos || 5) * 60); setCodigo('')
  }

  // Paso 2: el código que llegó al celular
  async function firmarConCodigo(e) {
    e.preventDefault()
    if (codigo.replace(/\D/g, '').length !== 6) { setErr('El código son 6 dígitos.'); return }
    setBusy(true); setErr('')
    const r = await firmar(codigo.replace(/\D/g, ''))
    setBusy(false)
    if (r.error) { setErr(r.error.message); setCodigo('') }
  }

  async function reenviar() {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('pedir_codigo_firma', { eid: g.id, accion })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setEnvio(data || {}); setQuedan((data?.minutos || 5) * 60); setCodigo('')
  }

  async function rechazar() {
    const motivo = (rechazo || '').trim()
    if (motivo.length < 5) { setErr('Escribe el motivo del rechazo: quien pidió el gasto lo va a leer para corregirlo.'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('rechazar_gasto', { eid: g.id, motivo })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onHecho?.('✖ SOLICITUD ' + numSol(g) + ' RECHAZADA. Se le avisa a quien la pidió.')
  }

  return (
    <div className="modal-bg" onClick={onCerrar}>
      <div className="glass modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 600, width: '96%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-head">
          <b>✍ {pidiendo ? 'FIRMAR LA SOLICITUD' : 'REVISAR Y FIRMAR'} · {numSol(g)}</b>
          <button className="btn-ghost" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>

        <div style={{ textAlign: 'center', margin: '6px 0 14px' }}>
          <div className="muted small">{proyecto?.name}</div>
          <div style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{soles(g.amount)}</div>
          <div>para <b>{g.recipient || '—'}</b>{g.recipient_dni ? ' · DNI ' + g.recipient_dni : ''}</div>
        </div>

        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}><tbody>
          {fila('Motivo', g.description || g.type)}
          {fila('Tipo', g.type)}
          {fila('Fecha', g.issue_date)}
          {/* las dos personas de la constancia: quien recibe va arriba, en grande */}
          {fila('Entrega', (g.sender || '—') + (g.sender_dni ? ' · DNI ' + g.sender_dni : ''))}
          {fila('Pago', (g.payment_method || '—') + ' · se descuenta de ' + (g.discount_from || 'URBIS GROUP'))}
          {fila('Comprobante', g.document_type)}
          {/* al socio le importa ver que la primera firma ya esta puesta */}
          {!pidiendo && g.requester_signed_at && fila('Ya firmó',
            <span className="ok">✍ {g.requester_name} · código {g.requester_code}</span>)}
        </tbody></table>

        {items.length > 0 && (
          <table style={{ width: '100%', fontSize: 12, marginTop: 10, borderCollapse: 'collapse' }}>
            <thead><tr style={{ opacity: .65, textAlign: 'left' }}><th>Fecha</th><th>Detalle</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
            <tbody>{items.map((a, i) => (
              <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,.08)' }}>
                <td>{a[0]}</td><td>{a[1]}</td><td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{a[2] ? 'S/ ' + a[2] : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        )}

        {docs.length > 0 && (
          <p className="small" style={{ marginTop: 10 }}>
            Adjuntos: {docs.map(([t, u], i) => <span key={t}>{i ? ' · ' : ''}<a href={u} target="_blank" rel="noreferrer">{t} ↗</a></span>)}
          </p>
        )}

        {rechazo === null ? (
          <form onSubmit={envio ? firmarConCodigo : pedirCodigo} style={{ marginTop: 14 }}>
            {firmaUrl
              ? (
                <div style={{ textAlign: 'center' }}>
                  <img src={firmaUrl} alt="Tu firma registrada" style={{ height: 72, background: '#fff', borderRadius: 6, padding: 4 }} />
                  <div className="muted small">Tu firma registrada · {profile?.full_name}</div>
                </div>
              )
              : <p className="warn">Todavía no registraste tu firma. <button type="button" className="link-btn" onClick={onPedirFirma}>Registrarla ahora</button></p>}

            {!envio ? (
              <label style={{ marginTop: 10 }}>Tu contraseña, para confirmar que eres tú
                <input type="password" autoComplete="current-password" value={pass}
                  onChange={e => setPass(e.target.value)} style={{ textTransform: 'none' }} autoFocus />
              </label>
            ) : (
              <div style={{ marginTop: 10 }}>
                <p className="ok small" style={{ textTransform: 'none' }}>
                  📲 Te mandamos un código al celular {envio.destino ? <b>{envio.destino}</b> : ''}. Escríbelo aquí:
                </p>
                <input inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={codigo} autoFocus
                  onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  style={{ fontSize: 30, letterSpacing: 8, textAlign: 'center', width: '100%', fontVariantNumeric: 'tabular-nums' }} />
                <p className="muted small" style={{ textTransform: 'none', marginTop: 4 }}>
                  {quedan > 0 ? <>Vence en <b>{mmss(quedan)}</b>.</> : <b>El código venció.</b>}{' '}
                  <button type="button" className="link-btn" disabled={busy || quedan > 240} onClick={reenviar}>Reenviar</button>
                </p>
              </div>
            )}

            {err && <p className="error">{err}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn-primary" disabled={busy || !firmaUrl}>
                {busy ? (envio ? 'Firmando…' : 'Enviando el código…') : envio ? '✍ Confirmar y firmar' : 'Continuar'}
              </button>
              {envio && <button type="button" className="btn-ghost" disabled={busy} onClick={() => { setEnvio(null); setErr(''); setCodigo('') }}>Volver</button>}
              {!pidiendo && !envio && (
                <button type="button" className="btn-ghost" style={{ color: '#ff8e7a', borderColor: 'rgba(255,142,122,.5)' }}
                  onClick={() => { setRechazo(''); setErr('') }}>Rechazar…</button>
              )}
            </div>
            <p className="muted small" style={{ textTransform: 'none', marginTop: 10 }}>
              Firmar pide tu contraseña y un código que llega a tu celular. Queda registrado quién {pidiendo ? 'pidió el gasto' : 'aprobó'}, cuándo, y una huella del gasto. Si alguien lo modifica después,
              {pidiendo ? ' tu firma se anula y hay que volver a firmarla.' : ' la constancia lo va a señalar.'}
            </p>
          </form>
        ) : (
          <div style={{ marginTop: 14 }}>
            <label>Motivo del rechazo
              <textarea rows="3" value={rechazo} onChange={e => setRechazo(e.target.value)} autoFocus
                style={{ textTransform: 'none' }} placeholder="Ej: el monto no coincide con la cotización; falta el detalle de gastos…" />
            </label>
            {err && <p className="error">{err}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn-primary" disabled={busy} onClick={rechazar}>{busy ? 'Enviando…' : '✖ Rechazar solicitud'}</button>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => { setRechazo(null); setErr('') }}>Volver</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
