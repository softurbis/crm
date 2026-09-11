import { useState } from 'react'
import { supabase } from '../lib/supabase'

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const numSol = g => g.request_number ? 'SOL-' + String(g.request_number).padStart(5, '0') : String(g.id).slice(0, 8).toUpperCase()

// ============================================================
// REVISAR Y FIRMAR una solicitud de gasto (socio o superusuario)
// ------------------------------------------------------------
// Firmar = la firma registrada + la contraseña escrita AHORA. El servidor
// (aprobar_gasto, sql/73) rechaza la aprobacion si la sesion no se autentico
// con contraseña en los ultimos 5 minutos: una sesion abierta y olvidada en
// otra PC no puede aprobar nada.
// Rechazar no pide contraseña (no compromete dinero), pero si el motivo: la
// secretaria lo recibe para corregir.
// ============================================================
export default function AprobarGasto({ gasto: g, proyecto, profile, firmaUrl, onCerrar, onHecho, onPedirFirma }) {
  const [pass, setPass] = useState('')
  const [rechazo, setRechazo] = useState(null)   // null = aprobando; texto = escribiendo el motivo
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const items = (g.detail || '').split('\n').map(l => l.split('|').map(x => x.trim())).filter(a => a.length >= 2)
  const docs = [['Constancia', g.request_doc_url], ['RH / factura', g.receipt_url], ['Sustento', g.voucher_url]].filter(([, u]) => u)
  const fila = (t, v) => v ? <tr><td style={{ opacity: .65, padding: '4px 10px 4px 0', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{t}</td><td style={{ padding: '4px 0' }}>{v}</td></tr> : null

  async function aprobar(e) {
    e.preventDefault()
    if (!firmaUrl) { onPedirFirma?.(); return }
    if (!pass) { setErr('Escribe tu contraseña para firmar.'); return }
    setBusy(true); setErr('')
    // 1) la contraseña: un inicio de sesion nuevo con la MISMA cuenta. Si esta
    //    mal, el gasto no se llega a tocar.
    const { error: e1 } = await supabase.auth.signInWithPassword({ email: profile?.email, password: pass })
    if (e1) { setBusy(false); setErr('Contraseña incorrecta.'); return }
    // 2) la aprobacion, en el servidor: rol, proyecto, estado y contraseña reciente
    const { data, error } = await supabase.rpc('aprobar_gasto', { eid: g.id })
    setBusy(false); setPass('')
    if (error) { setErr(error.message); return }
    onHecho?.('✍ SOLICITUD ' + numSol(g) + ' APROBADA Y FIRMADA · código de verificación ' + (data?.code || ''))
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
          <b>✍ REVISAR Y FIRMAR · {numSol(g)}</b>
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
          {fila('Solicitante', g.sender)}
          {fila('Pago', (g.payment_method || '—') + ' · se descuenta de ' + (g.discount_from || 'URBIS GROUP'))}
          {fila('Comprobante', g.document_type)}
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
          <form onSubmit={aprobar} style={{ marginTop: 14 }}>
            {firmaUrl
              ? (
                <div style={{ textAlign: 'center' }}>
                  <img src={firmaUrl} alt="Tu firma registrada" style={{ height: 72, background: '#fff', borderRadius: 6, padding: 4 }} />
                  <div className="muted small">Tu firma registrada · {profile?.full_name}</div>
                </div>
              )
              : <p className="warn">Todavía no registraste tu firma. <button type="button" className="link-btn" onClick={onPedirFirma}>Registrarla ahora</button></p>}
            <label style={{ marginTop: 10 }}>Tu contraseña, para confirmar que eres tú
              <input type="password" autoComplete="current-password" value={pass}
                onChange={e => setPass(e.target.value)} style={{ textTransform: 'none' }} autoFocus />
            </label>
            {err && <p className="error">{err}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn-primary" disabled={busy || !firmaUrl}>{busy ? 'Firmando…' : '✍ Aprobar y firmar'}</button>
              <button type="button" className="btn-ghost" style={{ color: '#ff8e7a', borderColor: 'rgba(255,142,122,.5)' }}
                onClick={() => { setRechazo(''); setErr('') }}>Rechazar…</button>
            </div>
            <p className="muted small" style={{ textTransform: 'none', marginTop: 10 }}>
              Al firmar queda registrado quién aprobó, cuándo, y una huella del gasto. Si alguien lo modifica después, la constancia lo va a señalar.
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
