import { useMemo, useState } from 'react'
import { leerVoucher, esImagen } from '../lib/leerVoucher'
import { soles } from '../lib/pagos'
import VoucherReview from './VoucherReview'

// El voucher y los datos del deposito, igual para separacion, inicial, cuota y
// cuadre. Lee el voucher y SUGIERE los datos: nunca pisa lo que ya se escribio,
// la persona decide que aplicar. Solo se analizan imagenes (un PDF se sube igual).
//   pago      = { file, nota, fecha, monto, nroOp, cuentaId, opTipo, obs }
//   esperado  = { monto, n } la cuota que toca, para avisar si no coincide
export default function DatosPago({ pago, setPago, cuentas, voucherObligatorio = true, esperado, paso = 2, children }) {
  const [ocr, setOcr] = useState(null)
  const [ocrBusy, setOcrBusy] = useState(false)
  const set = (k, v) => setPago(p => ({ ...p, [k]: v }))

  async function analizar(file) {
    setOcr(null)
    if (!file || !esImagen(file)) return
    setOcrBusy(true)
    try {
      const r = await leerVoucher(file)
      setOcr(r.monto == null && !r.operacion && !r.fecha ? { vacio: true } : r)
    } catch (err) { setOcr({ error: err.message || 'no se pudo analizar' }) }
    setOcrBusy(false)
  }

  // El banco detectado (BCP, YAPE...) se busca entre las cuentas del proyecto:
  // si alguna lo menciona, se sugiere. Si no, no se inventa nada.
  const cuentaSugerida = useMemo(() => {
    if (!ocr?.banco || !cuentas.length) return null
    const b = ocr.banco.toLowerCase()
    return cuentas.find(a => { const n = (a.name || '').toLowerCase(); return n.includes(b) || b.includes(n.split(/\s+/)[0]) }) || null
  }, [ocr, cuentas])

  // Contraste voucher vs lo que toca pagar: el chequeo que evita el error caro.
  // Solo avisa (puede ser adelanto, pago parcial o de varias cuotas).
  const cotejo = useMemo(() => {
    if (!esperado) return null
    const leido = ocr?.monto != null ? Number(ocr.monto) : (pago.monto ? Number(pago.monto) : null)
    if (leido == null || !Number.isFinite(leido)) return null
    return { ok: Math.abs(leido - esperado.monto) < 0.05, esperado: esperado.monto, leido, n: esperado.n }
  }, [esperado, ocr, pago.monto])

  const aplicar = k => {
    if (k === 'monto' && ocr?.monto != null) set('monto', String(ocr.monto))
    if (k === 'operacion' && ocr?.operacion) set('nroOp', ocr.operacion)
    if (k === 'fecha' && ocr?.fecha) set('fecha', ocr.fecha)
    if (k === 'cuenta') setPago(p => ({ ...p, ...(cuentaSugerida ? { cuentaId: cuentaSugerida.id } : {}), ...(ocr?.tipoOperacion ? { opTipo: ocr.tipoOperacion } : {}) }))
  }
  const usarTodo = () => setPago(p => ({
    ...p,
    ...(ocr?.monto != null ? { monto: String(ocr.monto) } : {}),
    ...(ocr?.operacion ? { nroOp: ocr.operacion } : {}),
    ...(ocr?.fecha ? { fecha: ocr.fecha } : {}),
    ...(ocr?.tipoOperacion ? { opTipo: ocr.tipoOperacion } : {}),
    ...(cuentaSugerida ? { cuentaId: cuentaSugerida.id } : {}),
  }))

  return (
    <>
      <div className={`paso ${pago.file ? 'listo' : ''}`}>
        <span className="paso-n">{paso}</span>
        <label className={voucherObligatorio && !pago.file ? 'req-file' : ''} style={{ flex: 1 }}>
          Voucher del cliente {voucherObligatorio ? <b className="bad">(obligatorio)</b> : <span className="muted">(opcional)</span>}
          <input type="file" accept="image/*,.pdf"
            onChange={e => { const f = e.target.files[0] || null; set('file', f); analizar(f) }} />
        </label>
        <label style={{ flex: 1 }}>Nota del voucher <span className="muted small">(opcional)</span>
          <input value={pago.nota} placeholder="ej: lo mandó por WhatsApp" style={{ textTransform: 'none' }}
            onChange={e => set('nota', e.target.value)} />
        </label>
      </div>

      {ocrBusy && <div className="ocr-box"><span className="ocr-load">Leyendo el voucher…</span></div>}
      {ocr?.vacio && <div className="ocr-box"><span className="muted">No pude leer datos de esta imagen — llénalos a mano abajo.</span></div>}
      {ocr?.error && <div className="ocr-box"><span className="muted">No se pudo analizar la imagen — llénalos a mano abajo.</span></div>}
      {cotejo && (
        <div className={`cotejo ${cotejo.ok ? 'ok' : 'dif'}`}>
          {cotejo.ok
            ? <>✓ <b>Coincide</b> con la cuota N° {cotejo.n}: {soles(cotejo.esperado)}</>
            : <>⚠ <b>No coincide.</b> La cuota N° {cotejo.n} debe <b>{soles(cotejo.esperado)}</b> y el voucher dice <b>{soles(cotejo.leido)}</b> ({cotejo.leido > cotejo.esperado ? 'paga de más' : 'falta'} {soles(Math.abs(cotejo.leido - cotejo.esperado))}). Puedes registrarlo igual si es correcto.</>}
        </div>
      )}
      <VoucherReview file={pago.file} ocr={ocr} cuentaSugerida={cuentaSugerida}
        montoActual={pago.monto} onElegirMonto={v => set('monto', String(v))}
        onAplicar={aplicar} onAplicarTodo={usarTodo} />

      <div className="paso">
        <span className="paso-n">{paso + 1}</span>
        <span className="paso-t">Revisa lo que se llenó solo</span>
      </div>
      <div className="form-grid">
        <label>Fecha del pago <input type="date" value={pago.fecha} onChange={e => set('fecha', e.target.value)} /></label>
        <label>Monto S/ <input type="number" step="0.01" min="0.01" value={pago.monto} onChange={e => set('monto', e.target.value)} /></label>
        <label>N° de operación <input value={pago.nroOp} onChange={e => set('nroOp', e.target.value)} placeholder="del voucher" /></label>
        <label>Banco / cuenta
          <select value={pago.cuentaId} onChange={e => set('cuentaId', e.target.value)}>
            <option value="">- elegir -</option>
            {cuentas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label>Tipo de operación
          <select value={pago.opTipo} onChange={e => set('opTipo', e.target.value)}>
            {['TRANSFERENCIA', 'DEPOSITO', 'BILLETERA DIGITAL', 'EFECTIVO'].map(t => <option key={t}>{t}</option>)}
          </select>
        </label>
        {children}
        <label className="span2">Observación <input value={pago.obs} onChange={e => set('obs', e.target.value)} /></label>
      </div>
    </>
  )
}
