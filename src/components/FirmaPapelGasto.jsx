import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { upload } from '../lib/archivos'
import { numeroGasto, firmasEnPapelFaltan } from './ConstanciaGasto'

// ============================================================
// FIRMA EN PAPEL DE UN GASTO (sql/183, 5 nov 2026)
// ------------------------------------------------------------
// Pedido del dueño: "que diga la opción de firma digital y firma física, porque José es
// medio adulto y es difícil usar la firma digital". Cada firma de la constancia va
// digital (en el panel, con código) o A MANO en la hoja impresa:
//   SubirHojaFirmada → la oficina, la socia o su secretaria de facturación sube la foto o
//                      el PDF de la hoja firmada, y ESO pone la firma (registrar_firma_papel:
//                      queda quién la subió y cuándo, con su código y su huella).
//   CambiarFirma     → una firma que todavía falta pasa de digital a papel o al revés
//                      (cambiar_firma_gasto). La que ya está puesta no se cambia.
// ============================================================

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const faltaSql = e => /registrar_firma_papel|cambiar_firma_gasto|schema cache|PGRST202/i.test(e || '')
const LADO = {
  solicitud: { t: 'Quien recibe el dinero', sub: 'firma de la izquierda · RECEPTOR' },
  aprobacion: { t: 'Quien entrega el dinero', sub: 'firma de la derecha · REMITENTE · es la aprobación' },
}
const personaDe = (g, lado) => lado === 'solicitud'
  ? (g.recipient || '—') + (g.recipient_dni ? ' · DNI ' + g.recipient_dni : '')
  : (g.sender || '—') + (g.sender_dni ? ' · DNI ' + g.sender_dni : '')

export function SubirHojaFirmada({ gasto: g, onCerrar, onHecho, onImprimir }) {
  const faltan = firmasEnPapelFaltan(g)
  // la aprobación en papel espera la firma DIGITAL de la izquierda
  const esperaDigital = !faltan.includes('solicitud') && g.requester_id && !g.requester_signed_at
  const [lados, setLados] = useState(faltan)
  const [file, setFile] = useState(null)
  const [nota, setNota] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const marcar = (l, on) => setLados(xs => {
    let n = on ? [...new Set([...xs, l])] : xs.filter(x => x !== l)
    // sin la izquierda no va la derecha: si se desmarca la izquierda, la aprobación espera
    if (!on && l === 'solicitud') n = n.filter(x => x !== 'aprobacion')
    if (on && l === 'aprobacion' && faltan.includes('solicitud')) n = [...new Set([...n, 'solicitud'])]
    return n
  })

  async function subir(e) {
    e.preventDefault()
    if (!lados.length) { setErr('Marca qué firma tiene la hoja.'); return }
    if (!file) { setErr('Elige la foto o el PDF de la hoja firmada.'); return }
    setBusy(true); setErr('')
    try {
      const url = await upload('gastos/constancias/' + g.id, file)
      const { data, error } = await supabase.rpc('registrar_firma_papel', { eid: g.id, url, lados, nota: nota.trim() || null })
      if (error) throw new Error(faltaSql(error.message) ? 'Falta correr sql/183 en el servidor.' : error.message)
      const cods = [data?.codigo_receptor, data?.codigo_remitente].filter(Boolean)
      onHecho?.('📄 HOJA FIRMADA SUBIDA · ' + numeroGasto(g) + ' · ' +
        (lados.length > 1 ? 'quedan las dos firmas' : lados[0] === 'solicitud' ? 'queda la firma de quien recibe' : 'queda la aprobación') +
        (cods.length ? ' · código ' + [...new Set(cods)].join(' / ') : ''))
    } catch (x) { setErr(x.message || String(x)) }
    setBusy(false)
  }

  return (
    <div className="modal-bg" onClick={onCerrar}>
      <div className="glass modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, width: '96%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-head">
          <b>📄 SUBIR LA HOJA FIRMADA A MANO · {numeroGasto(g)}</b>
          <button className="btn-ghost" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        <div style={{ textAlign: 'center', margin: '4px 0 12px' }}>
          <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{soles(g.amount)}</div>
          <div className="small" style={{ textTransform: 'none' }}>{g.description || g.type}</div>
        </div>

        {esperaDigital ? (
          <p className="warn" style={{ textTransform: 'none' }}>
            Primero va la firma de la izquierda, que es <b>digital</b>: la pone en el panel quien pide el gasto, con su código.
            Después se imprime la constancia, la firma a mano {g.sender || 'quien entrega el dinero'} y se sube aquí.
          </p>
        ) : (
          <form onSubmit={subir}>
            <p className="small" style={{ textTransform: 'none', margin: '0 0 6px' }}><b>¿Qué firmas tiene la hoja?</b></p>
            {faltan.map(l => (
              <label key={l} className="inline-check" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '0 0 8px', textTransform: 'none' }}>
                <input type="checkbox" checked={lados.includes(l)} onChange={e => marcar(l, e.target.checked)} />
                <span><b>{personaDe(g, l)}</b><br /><span className="muted small">{LADO[l].t} — {LADO[l].sub}</span></span>
              </label>
            ))}
            <label style={{ marginTop: 6 }}>Foto o PDF de la hoja firmada
              <input type="file" accept="image/*,.pdf" onChange={e => setFile(e.target.files[0] || null)} />
            </label>
            <label>Nota (opcional)
              <input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej.: firmó en su casa el martes" style={{ textTransform: 'none' }} />
            </label>
            {err && <p className="error">{err}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn-primary" disabled={busy || !lados.length}>{busy ? 'Subiendo…' : 'Subir y registrar la firma'}</button>
              {onImprimir && <button type="button" className="btn-ghost" onClick={() => onImprimir(g)}>🖨 Imprimir la constancia</button>}
            </div>
            <p className="muted small" style={{ textTransform: 'none', marginTop: 10 }}>
              La hoja subida cuenta como la firma: queda registrado que la subiste tú y a qué hora, con un código de verificación.
              Revisa antes que se lean bien las firmas, los nombres y el monto. Si después se corrige el gasto, esta firma se anula y hay que firmar de nuevo.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

// opcionesPersonas: [[NOMBRE, DNI]] para llenar solo el DNI de quien firma en papel
export function CambiarFirma({ gasto: g, proyecto, opcionesPersonas = [], onCerrar, onHecho }) {
  const conSocia = !!proyecto?.expense_approval
  const izqPend = !g.requester_signed_at
  const derPend = conSocia && !g.approved_at
  const [izq, setIzq] = useState(!!g.requester_papel)
  const [der, setDer] = useState(!!g.approval_papel)
  // con la aprobación en papel, quién firma la hoja (ej. JOSE MACEDO SANCHEZ)
  const [nombre, setNombre] = useState(g.approval_papel ? (g.sender || '') : '')
  const [dni, setDni] = useState(g.approval_papel ? (g.sender_dni || '') : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const dniDe = n => opcionesPersonas.find(([x]) => x === String(n || '').toUpperCase())?.[1] || ''

  async function guardar(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const pasos = []
      if (izqPend && izq !== !!g.requester_papel) pasos.push({ lado: 'solicitud', papel: izq })
      if (derPend && (der !== !!g.approval_papel || (der && nombre.trim() && nombre.trim().toUpperCase() !== String(g.sender || '').toUpperCase())))
        pasos.push({ lado: 'aprobacion', papel: der, nombre: der ? nombre.trim() || null : null, dni: der ? dni.trim() || null : null })
      if (der && derPend && !nombre.trim() && !g.sender) throw new Error('Escribe quién firma la hoja como REMITENTE (quien entrega el dinero).')
      if (!pasos.length) { onCerrar?.(); return }
      for (const p of pasos) {
        const { error } = await supabase.rpc('cambiar_firma_gasto', { eid: g.id, ...p })
        if (error) throw new Error(faltaSql(error.message) ? 'Falta correr sql/183 en el servidor.' : error.message)
      }
      onHecho?.('✔ ' + numeroGasto(g) + ': ' + pasos.map(p => (p.lado === 'solicitud' ? 'la firma de quien recibe' : 'la aprobación') + ' va ' + (p.papel ? 'EN PAPEL' : 'DIGITAL')).join(' y ') + '.')
    } catch (x) { setErr(x.message || String(x)) }
    setBusy(false)
  }

  const opcion = (valor, set, papel, txt) => (
    <button type="button" className={'chip' + (valor === papel ? ' on' : '')} style={{ textTransform: 'none' }} onClick={() => set(papel)}>{txt}</button>
  )
  return (
    <div className="modal-bg" onClick={onCerrar}>
      <div className="glass modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, width: '96%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-head">
          <b>✎ CÓMO SE FIRMA · {numeroGasto(g)}</b>
          <button className="btn-ghost" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        <form onSubmit={guardar}>
          <p className="sg-sub" style={{ marginTop: 4 }}>Firma 1 · izquierda — quien pide y recibe</p>
          {izqPend ? (
            <div className="chips" style={{ margin: '0 0 6px' }}>
              {opcion(izq, setIzq, false, '✍ Digital (en el panel, con código)')}
              {opcion(izq, setIzq, true, '📄 En papel (a mano)')}
            </div>
          ) : <p className="ok small" style={{ textTransform: 'none' }}>✔ Ya está puesta ({g.requester_papel ? 'en papel' : 'digital'}).</p>}
          {izqPend && !izq && !g.requester_id && (
            <p className="warn small" style={{ textTransform: 'none' }}>Para firmar en el panel hay que elegir quién pide el gasto: corrígelo con "editar".</p>
          )}

          {conSocia && <>
            <p className="sg-sub">Firma 2 · derecha — quien aprueba y entrega el dinero</p>
            {derPend ? <>
              <div className="chips" style={{ margin: '0 0 6px' }}>
                {opcion(der, setDer, false, '✍ Digital (la socia en el panel)')}
                {opcion(der, setDer, true, '📄 En papel (a mano)')}
              </div>
              {der && (
                <div className="form-grid" style={{ margin: 0 }}>
                  <label>¿Quién firma la hoja?
                    <input list="personas-cambiar-firma" value={nombre} placeholder={g.sender || 'JOSE MACEDO SANCHEZ'}
                      onChange={e => { const v = e.target.value, d = dniDe(v); setNombre(v); if (d) setDni(d) }} />
                  </label>
                  <label>DNI
                    <input value={dni} inputMode="numeric" onChange={e => setDni(e.target.value)} />
                  </label>
                  <datalist id="personas-cambiar-firma">
                    {opcionesPersonas.map(([n, d]) => <option key={n} value={n}>{d ? 'DNI ' + d : ''}</option>)}
                  </datalist>
                </div>
              )}
              {!der && <p className="muted small" style={{ textTransform: 'none' }}>La aprueba la socia del proyecto con su firma y su código, y queda de remitente.</p>}
            </> : <p className="ok small" style={{ textTransform: 'none' }}>✔ Ya está puesta ({g.approval_papel ? 'en papel' : 'digital'}).</p>}
          </>}

          {err && <p className="error">{err}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn-primary" disabled={busy || (!izqPend && !derPend)}>{busy ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="btn-ghost" onClick={onCerrar} disabled={busy}>Cancelar</button>
          </div>
          <p className="muted small" style={{ textTransform: 'none', marginTop: 10 }}>
            En papel: se imprime la constancia, se firma a mano y se sube la hoja; no se piden contraseña ni código y no le llegan avisos de firma.
            Una firma que ya está puesta no se cambia: para eso se corrige la solicitud (se anulan las firmas).
          </p>
        </form>
      </div>
    </div>
  )
}
