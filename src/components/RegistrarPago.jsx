import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { upload } from '../lib/archivos'

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const numSol = g => g.request_number ? 'SOL-' + String(g.request_number).padStart(5, '0') : String(g.id).slice(0, 8).toUpperCase()
const dmy = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''
const espera = ms => new Promise(r => setTimeout(r, ms))
const aNumero = t => { const n = Number(String(t || '').replace(/[^\d.,]/g, '').replace(/,/g, '')); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null }
const ICONO = { ok: '✅', duda: '⚠️', mal: '❌' }
const faltaSql = e => /pedir_lectura_comprobante|registrar_pago_gasto|comprobante_lecturas|schema cache|PGRST202/i.test(e || '')

// ============================================================
// LA SOCIA PAGA Y SUBE EL COMPROBANTE — con DOBLE VALIDACIÓN (sql/101, 103)
// ------------------------------------------------------------
// 1. Elige la foto o el PDF: se sube y el servidor lo LEE CON IA (monto, fecha,
//    banco, operación, a quién). La IA lee a ciegas; la comparación con la
//    solicitud la hace el servidor, en código.
// 2. Si todo cuadra, confirma con un botón.
// 3. Si algo NO cuadra (o la IA no pudo leer), para seguir tiene que escribir el
//    monto que ve en el comprobante y marcar que lo revisó. La base también lo exige.
// ============================================================
export default function RegistrarPago({ gasto: g, proyecto, onCerrar, onHecho }) {
  const [file, setFile] = useState(null)
  const [vista, setVista] = useState(null)
  const [fase, setFase] = useState('elegir')        // elegir | leyendo | resultado
  const [url, setUrl] = useState(null)
  const [lecturaId, setLecturaId] = useState(null)
  const [res, setRes] = useState(null)               // fila de comprobante_lecturas (o { estado: 'demora' })
  const [montoVisto, setMontoVisto] = useState('')
  const [revisado, setRevisado] = useState(false)
  const [nota, setNota] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const vivo = useRef(true)
  // se vuelve a poner en true al montar: en desarrollo React monta dos veces
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])

  // vista previa de la foto elegida (y se libera al cambiarla o cerrar)
  useEffect(() => {
    if (!file || !String(file.type).startsWith('image/')) { setVista(null); return }
    const u = URL.createObjectURL(file)
    setVista(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  async function elegir(f) {
    if (!f) return
    setFile(f); setErr(''); setRes(null); setLecturaId(null); setUrl(null)
    setMontoVisto(''); setRevisado(false); setNota('')
    setFase('leyendo')
    try {
      const u = await upload(`gastos/sustentos/${g.id}`, f)
      if (!vivo.current) return
      setUrl(u)
      const { data: id, error } = await supabase.rpc('pedir_lectura_comprobante', { eid: g.id, url: u })
      if (error) throw new Error(faltaSql(error.message) ? 'Falta correr sql/103 en la base.' : error.message)
      setLecturaId(id)
      // el servidor la toma en ~3 s; la IA tarda unos segundos más
      const fin = Date.now() + 120000
      while (vivo.current && Date.now() < fin) {
        await espera(2000)
        const { data: fila } = await supabase.from('comprobante_lecturas').select('estado, lectura, validacion, alertas, error').eq('id', id).maybeSingle()
        if (fila && (fila.estado === 'listo' || fila.estado === 'error')) {
          if (!vivo.current) return
          setRes(fila)
          const L = fila.lectura
          if (L) setNota([L.banco_o_app, L.numero_operacion && 'OP ' + L.numero_operacion, L.fecha && dmy(L.fecha)].filter(Boolean).join(' · '))
          setFase('resultado')
          return
        }
      }
      if (vivo.current) { setRes({ estado: 'demora' }); setFase('resultado') }
    } catch (e) {
      if (!vivo.current) return
      setErr(e.message); setFase('elegir'); setFile(null)
    }
  }

  const L = res?.lectura || null
  const listo = res?.estado === 'listo'
  const todoCuadra = listo && res.alertas === 0
  // revisión a mano: con diferencias, o cuando la IA no pudo leer
  const visto = aNumero(montoVisto)
  const montoOk = visto != null && (Math.abs(visto - Number(g.amount)) < 0.005 || (L?.monto != null && Math.abs(visto - L.monto) < 0.005))
  const puedeIgual = revisado && montoOk

  async function registrar(conRevision) {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('registrar_pago_gasto', {
      eid: g.id, url, nota: nota.trim() || null, lectura: lecturaId, revisado: !!conRevision,
    })
    setBusy(false)
    if (error) { setErr(faltaSql(error.message) ? 'Falta correr sql/103 en la base.' : error.message); return }
    onHecho?.('💸 PAGO REGISTRADO · ' + numSol(g) + ' quedó PAGADO con su comprobante' + (conRevision ? ' (revisado a mano)' : ' (validado con IA)') + '.')
  }

  const fila = (t, v) => v ? <tr><td style={{ opacity: .65, padding: '3px 10px 3px 0', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{t}</td><td style={{ padding: '3px 0', textTransform: 'none', overflowWrap: 'anywhere' }}>{v}</td></tr> : null

  return (
    <div className="modal-bg" onClick={busy || fase === 'leyendo' ? undefined : onCerrar}>
      <div className="glass modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540, width: '96%', maxHeight: '92vh', overflowY: 'auto' }}>
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
        </div>

        {/* 1. elegir el archivo (al elegirlo, se lee solo) */}
        {fase !== 'leyendo' && (
          <label className="btn-ghost" style={{ display: 'block', cursor: 'pointer', textAlign: 'center', padding: '14px', fontSize: '1rem', color: 'var(--text)', borderStyle: 'dashed' }}>
            {file ? '🔄 Elegir otro comprobante' : '📷 Tomar foto o elegir el comprobante'}
            <input type="file" accept="image/*,.pdf" hidden onChange={e => { elegir(e.target.files[0]); e.target.value = '' }} />
          </label>
        )}
        {vista && <img src={vista} alt="Comprobante elegido" style={{ width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 8, background: '#0a0d09', marginTop: 10 }} />}
        {file && !vista && <p className="small" style={{ textTransform: 'none', marginTop: 8 }}>📄 {file.name}</p>}

        {/* 2. leyendo */}
        {fase === 'leyendo' && (
          <div style={{ textAlign: 'center', padding: '16px 6px' }}>
            <div style={{ fontSize: 28 }}>🤖</div>
            <b>Leyendo el comprobante con IA…</b>
            <p className="muted small" style={{ textTransform: 'none', marginTop: 4 }}>Revisa el monto, la fecha, a quién se pagó y que no se haya usado antes. Tarda unos segundos.</p>
          </div>
        )}

        {/* 3. resultado */}
        {fase === 'resultado' && res && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {listo && L && (
              <div className="glass" style={{ padding: '10px 12px' }}>
                <b className="small">🤖 LO QUE DICE EL COMPROBANTE</b>
                <table style={{ width: '100%', fontSize: 13, marginTop: 6, borderCollapse: 'collapse' }}><tbody>
                  {fila('Monto', L.monto != null ? <b>{soles(L.monto)}{L.moneda === 'USD' ? ' (DÓLARES)' : ''}</b> : '—')}
                  {fila('Fecha', L.fecha ? dmy(L.fecha) + (L.hora ? ' · ' + L.hora : '') : '—')}
                  {fila('Banco / app', L.banco_o_app)}
                  {fila('Operación', L.numero_operacion)}
                  {fila('Pagado a', [L.destinatario_nombre, L.destinatario_cuenta].filter(Boolean).join(' · '))}
                  {fila('Pagado por', L.ordenante_nombre)}
                </tbody></table>
              </div>
            )}

            {listo && Array.isArray(res.validacion) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {res.validacion.map((v, i) => (
                  <div key={i} className="small" style={{ textTransform: 'none', color: v.nivel === 'mal' ? 'var(--error)' : v.nivel === 'duda' ? '#e0b23f' : 'var(--ok)' }}>
                    {ICONO[v.nivel] || '•'} {v.texto}
                  </div>
                ))}
              </div>
            )}

            {todoCuadra && (
              <div style={{ border: '1px solid rgba(111,221,155,.5)', borderRadius: 10, padding: '10px 12px' }}>
                <b className="ok">✅ Todo cuadra con la solicitud {numSol(g)}.</b>
                <p className="small muted" style={{ textTransform: 'none', margin: '4px 0 0' }}>
                  {res.validacion?.some(v => v.nivel === 'duda') ? 'Mira los puntos en amarillo y, ' : ''}Si es el comprobante correcto, confírmalo:
                </p>
              </div>
            )}

            {/* no cuadra, o la IA no pudo leer: revisión a mano obligatoria */}
            {!todoCuadra && (
              <div style={{ border: '2px solid rgba(255,142,122,.6)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {listo
                  ? <b className="bad">❌ OJO: {res.alertas} cosa{res.alertas === 1 ? '' : 's'} NO cuadra{res.alertas === 1 ? '' : 'n'} con la solicitud.</b>
                  : <b className="warn">⚠️ No se pudo leer con IA{res.error ? ': ' + res.error : ' a tiempo'}. Revísalo tú.</b>}
                <p className="small" style={{ textTransform: 'none', margin: 0 }}>
                  ¿Subiste el comprobante correcto? Si te equivocaste, elige otro arriba. Si es el correcto, confírmalo aquí:
                </p>
                <label className="small">Escribe el monto que ves en el comprobante
                  {/* sin el monto de la solicitud como ejemplo: tiene que salir de mirar el comprobante */}
                  <input inputMode="decimal" value={montoVisto} onChange={e => setMontoVisto(e.target.value)} placeholder="Míralo en el comprobante"
                    style={{ fontSize: '1.2rem', fontVariantNumeric: 'tabular-nums' }} />
                </label>
                {visto != null && !montoOk && (
                  <span className="small bad" style={{ textTransform: 'none' }}>
                    {soles(visto)} no coincide ni con la solicitud ({soles(g.amount)}){L?.monto != null ? ' ni con lo que leyó la IA (' + soles(L.monto) + ')' : ''}. Revisa bien el comprobante.
                  </span>
                )}
                <label className="inline-check small" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, textTransform: 'none' }}>
                  <input type="checkbox" checked={revisado} onChange={e => setRevisado(e.target.checked)} />
                  Revisé el comprobante: es el correcto para este pago.
                </label>
              </div>
            )}

            <label>Nota <span className="muted small">(se llena sola; puedes corregirla)</span>
              <input value={nota} onChange={e => setNota(e.target.value)} style={{ textTransform: 'none' }} placeholder="BCP · OP 123456 · 16/09/2026" />
            </label>

            {err && <p className="error">{err}</p>}
            {todoCuadra
              ? <button className="btn-primary" disabled={busy} style={{ padding: '.9rem' }} onClick={() => registrar(false)}>
                  {busy ? 'Guardando…' : '✔ Sí, es este comprobante · marcar PAGADO'}
                </button>
              : <button className="btn-primary" disabled={busy || !puedeIgual} style={{ padding: '.9rem' }} onClick={() => registrar(true)}
                  title={puedeIgual ? '' : 'Escribe el monto del comprobante y marca que lo revisaste'}>
                  {busy ? 'Guardando…' : puedeIgual ? '✔ Revisado · marcar PAGADO' : !montoOk ? 'Escribe el monto del comprobante' : 'Marca que lo revisaste'}
                </button>}
          </div>
        )}

        {fase === 'elegir' && err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
        <p className="muted small" style={{ textTransform: 'none', marginTop: 10 }}>
          Al guardarlo, el gasto queda como pagado con el comprobante adjunto y lo que leyó la IA queda registrado.
        </p>
      </div>
    </div>
  )
}
