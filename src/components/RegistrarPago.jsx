import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { upload } from '../lib/archivos'

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const numSol = g => g.request_number ? 'SOL-' + String(g.request_number).padStart(5, '0') : String(g.id).slice(0, 8).toUpperCase()

// ============================================================
// LA SOCIA PAGA Y SUBE EL COMPROBANTE (sql/101)
// ------------------------------------------------------------
// Último paso de una solicitud aprobada, en los proyectos que exigen la firma
// del socio: el comprobante del pago (voucher de la transferencia, captura del
// Yape, foto del depósito). Al guardarlo el gasto queda PAGADO.
// En el celular, el selector de archivo ofrece la cámara o la galería.
// ============================================================
export default function RegistrarPago({ gasto: g, proyecto, onCerrar, onHecho }) {
  const [file, setFile] = useState(null)
  const [vista, setVista] = useState(null)
  const [nota, setNota] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // vista previa de la foto elegida (y se libera al cambiarla o cerrar)
  useEffect(() => {
    if (!file || !String(file.type).startsWith('image/')) { setVista(null); return }
    const u = URL.createObjectURL(file)
    setVista(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  async function guardar(e) {
    e.preventDefault()
    if (!file) { setErr('Elige la foto o el PDF del comprobante.'); return }
    setBusy(true); setErr('')
    try {
      const url = await upload(`gastos/sustentos/${g.id}`, file)
      const { error } = await supabase.rpc('registrar_pago_gasto', { eid: g.id, url, nota: nota.trim() || null })
      if (error) throw new Error(/registrar_pago_gasto|schema cache|PGRST202/i.test(error.message) ? 'Falta correr sql/101 en la base.' : error.message)
      onHecho?.('💸 PAGO REGISTRADO · ' + numSol(g) + ' quedó PAGADO con su comprobante.')
    } catch (e2) { setErr(e2.message) }
    setBusy(false)
  }

  return (
    <div className="modal-bg" onClick={busy ? undefined : onCerrar}>
      <div className="glass modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, width: '96%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-head">
          <b style={{ flex: 1 }}>💸 SUBIR COMPROBANTE DE PAGO · {numSol(g)}</b>
          <button className="btn-ghost" onClick={onCerrar} disabled={busy} aria-label="Cerrar">✕</button>
        </div>

        <div style={{ textAlign: 'center', margin: '4px 0 12px' }}>
          <div className="muted small">{proyecto?.name}</div>
          <div style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{soles(g.amount)}</div>
          <div>para <b>{g.recipient || '—'}</b>{g.recipient_dni ? ' · DNI ' + g.recipient_dni : ''}</div>
          <div className="muted small" style={{ textTransform: 'none', marginTop: 4 }}>
            {(g.description || g.type || '')}{g.payment_method ? ' · ' + g.payment_method : ''}
          </div>
          {g.approved_at && <div className="ok small" style={{ marginTop: 4 }}>✍ Aprobado por {g.approved_name || '—'} · código {g.approval_code || '—'}</div>}
        </div>

        <form onSubmit={guardar} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="btn-ghost" style={{ cursor: 'pointer', textAlign: 'center', padding: '14px', fontSize: '1rem', color: 'var(--text)', borderStyle: 'dashed' }}>
            {file ? '📄 ' + file.name : '📷 Tomar foto o elegir el comprobante'}
            <input type="file" accept="image/*,.pdf" hidden onChange={e => { setFile(e.target.files[0] || null); setErr('') }} />
          </label>
          {vista && <img src={vista} alt="Comprobante elegido" style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 8, background: '#0a0d09' }} />}

          <label>Nota <span className="muted small">(opcional: banco, número de operación…)</span>
            <input value={nota} onChange={e => setNota(e.target.value)} style={{ textTransform: 'none' }} placeholder="BCP · operación 123456" />
          </label>

          {err && <p className="error">{err}</p>}
          <button className="btn-primary" disabled={busy || !file} style={{ padding: '.9rem' }}>
            {busy ? 'Subiendo…' : '💸 Guardar comprobante y marcar PAGADO'}
          </button>
          <p className="muted small" style={{ textTransform: 'none' }}>
            Al guardarlo, el gasto queda como pagado y el comprobante queda adjunto a la solicitud. Si te equivocas de archivo, avísale al superusuario para reemplazarlo.
          </p>
        </form>
      </div>
    </div>
  )
}
