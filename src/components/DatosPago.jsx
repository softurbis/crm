import { useEffect, useMemo, useRef, useState } from 'react'
import { leerVoucher, esImagen } from '../lib/leerVoucher'
import { leerVoucherIA, voucherRepetido, pedirAprobacionVoucher } from '../lib/leerVoucherIA'
import { useProject } from '../context/ProjectContext'
import { useAuth } from '../context/AuthContext'
import { soles } from '../lib/pagos'
import VoucherReview from './VoucherReview'

// El voucher y los datos del deposito, igual para separacion, inicial, cuota y
// cuadre. Lee el voucher y SUGIERE los datos: nunca pisa lo que ya se escribio,
// la persona decide que aplicar. Desde el 16 oct lo lee la IA en el servidor (foto
// o PDF, sql/154); si la IA no está o falla, el OCR del navegador de siempre.
// El voucher REPETIDO (mismo N° de operación y monto ya registrado) deja pago.bloqueo
// hasta que el superusuario lo apruebe por Telegram: CobroModal no registra.
//   pago      = { file, nota, fecha, monto, nroOp, cuentaId, opTipo, obs }
//   esperado  = { monto, n } la cuota que toca, para avisar si no coincide
export default function DatosPago({ pago, setPago, cuentas, voucherObligatorio = true, esperado, paso = 2, loteId = null, children }) {
  const { pidOp } = useProject()
  const { role } = useAuth()
  const [ocr, setOcr] = useState(null)
  const [ocrBusy, setOcrBusy] = useState(false)
  const set = (k, v) => setPago(p => ({ ...p, [k]: v }))
  const turno = useRef(0)

  async function analizar(file) {
    setOcr(null)
    const t = ++turno.current
    if (!file) { setOcrBusy(false); return }
    setOcrBusy('ia')
    try {
      const r = await leerVoucherIA(file, pidOp)
      if (t === turno.current) setOcr(r)
    } catch (err) {
      // sin IA (sql/154 sin correr, sin clave, o tardó): el OCR del navegador, solo fotos
      if (t !== turno.current) return
      if (!esImagen(file)) { setOcr({ error: err.message || 'no se pudo leer' }); setOcrBusy(false); return }
      setOcrBusy('ocr')
      try {
        const r = await leerVoucher(file)
        if (t === turno.current) setOcr(r.monto == null && !r.operacion && !r.fecha ? { vacio: true } : r)
      } catch (e2) { if (t === turno.current) setOcr({ error: e2.message || 'no se pudo analizar' }) }
    }
    if (t === turno.current) setOcrBusy(false)
  }

  // "Banco / cuenta" = con qué pagó el cliente, según el voucher (YAPE, BCP...): se
  // busca entre las cuentas del proyecto. La app primero (Yape, Plin) y luego el
  // banco. Si ninguna lo menciona, no se inventa nada.
  const cuentaSugerida = useMemo(() => {
    const posibles = (ocr?.bancosPosibles?.length ? ocr.bancosPosibles : [ocr?.banco]).filter(Boolean)
    if (!posibles.length || !cuentas.length) return null
    const limpio = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    for (const banco of posibles) {
      const b = limpio(banco)
      const c = cuentas.find(a => { const n = limpio(a.name); return n.includes(b) || b.includes(n.split(/\s+/)[0]) })
      if (c) return c
    }
    return null
  }, [ocr, cuentas])

  // ---- el voucher REPETIDO: con lo que queda ESCRITO (N° de operación y monto) ----
  const [rep, setRep] = useState(null)   // { repetidos: [], aprobacion }
  const [pidiendo, setPidiendo] = useState(false)
  const [repErr, setRepErr] = useState('')
  const opN = String(pago.nroOp || '').trim().toUpperCase()
  const montoN = Number(pago.monto)
  const revisar = useRef(null)
  revisar.current = async () => {
    if (!opN || opN === 'SIN-REF' || opN.replace(/\D/g, '').length < 4 || !(montoN > 0)) { setRep(null); return }
    setRep(await voucherRepetido(pidOp, opN, montoN))
  }
  useEffect(() => {
    const t = setTimeout(() => revisar.current(), 500)
    return () => clearTimeout(t)
  }, [opN, montoN, pidOp])
  const hayRepetido = !!rep?.repetidos?.length
  const estadoAprob = rep?.aprobacion?.estado || null
  // mientras se espera al superusuario, se vuelve a mirar cada 4 s
  useEffect(() => {
    if (!hayRepetido || estadoAprob !== 'pedida') return
    const t = setInterval(() => revisar.current(), 4000)
    return () => clearInterval(t)
  }, [hayRepetido, estadoAprob])
  // el superusuario no se pide permiso a sí mismo: solo ve el aviso
  const bloqueo = hayRepetido && estadoAprob !== 'aprobada' && role !== 'superuser'
  useEffect(() => { if (!!pago.bloqueo !== bloqueo) setPago(p => ({ ...p, bloqueo })) }, [bloqueo])   // eslint-disable-line
  async function pedirAprobacion() {
    setPidiendo(true); setRepErr('')
    try {
      await pedirAprobacionVoucher({ projectId: pidOp, lotId: loteId, op: opN, monto: montoN, fecha: pago.fecha, url: ocr?.urlLectura || null, nota: pago.obs })
      await revisar.current()
    } catch (e) { setRepErr(e.message) }
    setPidiendo(false)
  }
  const fechaCorta = f => f ? String(f).slice(8, 10) + '/' + String(f).slice(5, 7) + '/' + String(f).slice(0, 4) : ''

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

      {ocrBusy && <div className="ocr-box"><span className="ocr-load">{ocrBusy === 'ia' ? '🤖 La IA está leyendo el voucher… (unos segundos)' : 'Leyendo el voucher…'}</span></div>}
      {ocr?.vacio && <div className="ocr-box"><span className="muted">No pude leer datos de este voucher{ocr.motivo ? ': ' + ocr.motivo : ''} — llénalos a mano abajo.</span></div>}
      {ocr?.error && <div className="ocr-box"><span className="muted">No se pudo leer el voucher — llénalos a mano abajo.</span></div>}
      {ocr?.ia && !ocr.vacio && (ocr.noEsComprobante || ocr.ilegible || ocr.moneda === 'USD' || ocr.observaciones) && (
        <div className="cotejo dif">⚠ {[ocr.noEsComprobante && 'No parece un comprobante de pago.', ocr.ilegible && 'Se lee mal: revísalo bien.',
          ocr.moneda === 'USD' && 'El voucher está en DÓLARES.', ocr.observaciones].filter(Boolean).join(' ')}</div>
      )}
      {hayRepetido && (
        <div className={'cotejo ' + (estadoAprob === 'aprobada' ? 'ok' : 'dif')} style={estadoAprob === 'aprobada' ? null : { borderColor: 'rgba(255,120,100,.6)', color: '#ff9a87', background: 'rgba(255,120,100,.1)' }}>
          {estadoAprob === 'aprobada'
            ? <>✓ <b>Voucher repetido APROBADO</b>{rep.aprobacion.por ? ' por ' + rep.aprobacion.por : ''}: ya puedes registrarlo.</>
            : <><b>⛔ ESTE VOUCHER YA ESTÁ REGISTRADO</b> (mismo N° de operación {opN} y {soles(montoN)}):</>}
          <ul style={{ margin: '.3rem 0', paddingLeft: '1.1rem', textTransform: 'none' }}>
            {rep.repetidos.map((r, i) => <li key={i}>{r.proyecto} · lote {r.lote || '—'} · {r.concepto || ''} · {soles(r.monto)} · {fechaCorta(r.fecha)}</li>)}
          </ul>
          {estadoAprob !== 'aprobada' && (role === 'superuser'
            ? <span className="small">Eres superusuario: puedes registrarlo si estás seguro.</span>
            : estadoAprob === 'pedida'
              ? <span className="cp-busca"><span className="cp-gira" /> Esperando la aprobación del superusuario por Telegram… se desbloquea aquí solo.</span>
              : <>
                  {estadoAprob === 'rechazada' && <p className="small" style={{ margin: '0 0 .3rem' }}>❌ El superusuario lo RECHAZÓ{rep.aprobacion.motivo ? ': ' + rep.aprobacion.motivo : ''}. Si es un pago distinto, revisa el N° de operación.</p>}
                  <button type="button" className="btn-primary" disabled={pidiendo} onClick={pedirAprobacion}>{pidiendo ? 'Pidiendo…' : '📲 Pedir aprobación al superusuario'}</button>
                  <span className="small"> Le llega por Telegram con ✅ / ❌.</span>
                </>)}
          {repErr && <p className="error" style={{ textTransform: 'none', margin: '.3rem 0 0' }}>{repErr}</p>}
        </div>
      )}
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
