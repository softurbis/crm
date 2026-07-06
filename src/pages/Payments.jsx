import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'

const hoy = () => new Date().toISOString().slice(0, 10)
const estadoDe = r => {
  const o = (r.observation || '').toUpperCase()
  if (o.includes('EXPROP')) return 'EXPROPIADO'
  if (o.includes('PERDIDA')) return 'PERDIDA'
  return 'ACEPTADO'
}
const EstadoChip = ({ r }) => {
  const e = estadoDe(r)
  const cls = e === 'EXPROPIADO' ? 'st-exp' : e === 'PERDIDA' ? 'st-per' : 'st-ok'
  return <span className={'st-chip ' + cls}>{e}</span>
}
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function addMonths(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDate()
  d.setMonth(d.getMonth() + n)
  if (d.getDate() < day) d.setDate(0)
  return d.toISOString().slice(0, 10)
}

async function upload(path, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const full = `${path}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('urbis-files').upload(full, file, { upsert: true })
  if (error) throw new Error('Error al subir archivo: ' + error.message)
  return supabase.storage.from('urbis-files').getPublicUrl(full).data.publicUrl
}

export default function Payments() {
  const { profile, role } = useAuth()
  const { pidOp } = useProject()
  const [tipo, setTipo] = useState('cuota')
  const [lots, setLots] = useState([])
  const [clients, setClients] = useState([])
  const [accounts, setAccounts] = useState([])
  const [pagos, setPagos] = useState([])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const [fq, setFq] = useState('')
  const [ftipo, setFtipo] = useState('todos')
  const [fdoc, setFdoc] = useState('todos') // todos | sin_voucher | sin_comprobante
  const [fest, setFest] = useState('todos')
  const [coId, setCoId] = useState('')
  const [obsEdit, setObsEdit] = useState('')
  const [opEdit, setOpEdit] = useState('')

  const [lotId, setLotId] = useState('')
  const [clientId, setClientId] = useState('')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(hoy())
  const [nroOp, setNroOp] = useState('')
  const [acctId, setAcctId] = useState('')
  const [opTipo, setOpTipo] = useState('TRANSFERENCIA')
  const [obs, setObs] = useState('')
  const [precioVenta, setPrecioVenta] = useState('')
  const [meses, setMeses] = useState(48)
  const [venc, setVenc] = useState(addDays(hoy(), 7))
  const [fVoucher, setFVoucher] = useState(null)
  const [ctx, setCtx] = useState(null)
  const [view, setView] = useState(null)
  const [advisors, setAdvisors] = useState([])
  const [advId, setAdvId] = useState('')
  const [comision, setComision] = useState('')
  const [secs, setSecs] = useState([])
  const [notifIds, setNotifIds] = useState([])
  const readOnly = role === 'manager'

  async function loadBase() {
    const [l, c, a, adv, r, sq] = await Promise.all([
      supabase.from('lots').select('id, mz, lt, status, total_price, initial_payment_default').eq('project_id', pidOp).order('mz').order('lt'),
      supabase.from('clients').select('id, full_name, doc_number').order('full_name'),
      supabase.from('financial_accounts').select('id, name').eq('active', true).eq('project_id', pidOp),
      supabase.from('advisors').select('id, code, full_name').eq('active', true).order('code'),
      supabase.from('secretaries').select('id, full_name, user_id, tipo').eq('active', true).order('full_name'),
      supabase.from('daily_income')
        .select('id, date, amount, operation_number, income_type, voucher_url, receipt_url, extra_url, observation, installment_id, sale_id, lot:lots(mz,lt), client:clients(full_name), installment:installments(installment_number), account:financial_accounts(name)')
        .eq('project_id', pidOp).order('date', { ascending: false }).order('created_at', { ascending: false }),
    ])
    setLots(l.data || []); setClients(c.data || []); setAccounts(a.data || []); setAdvisors(adv.data || []); setSecs(r.data || []); setPagos(sq.data || [])
  }
  useEffect(() => { if (pidOp) loadBase() }, [pidOp])

  const lotesFiltrados = useMemo(() => {
    if (tipo === 'separacion') return lots.filter(l => l.status === 'disponible')
    if (tipo === 'inicial') return lots.filter(l => ['separado', 'disponible'].includes(l.status))
    return lots.filter(l => l.status === 'vendido')
  }, [lots, tipo])

  useEffect(() => {
    setCtx(null)
    if (!lotId) return
    const lote = lots.find(l => l.id === lotId)
    async function load() {
      if (tipo === 'cuota') {
        const { data: sale } = await supabase.from('sales')
          .select('id, client_id, client:clients!sales_client_id_fkey(full_name)')
          .eq('lot_id', lotId).eq('status', 'en_proceso').maybeSingle()
        if (!sale) { setCtx({ error: 'Este lote no tiene venta activa' }); return }
        const { data: pend } = await supabase.from('installments')
          .select('id, installment_number, amount, amount_paid, due_date, status')
          .eq('sale_id', sale.id).neq('status', 'pagado')
          .order('installment_number')
        if (!pend?.length) { setCtx({ error: 'Todas las cuotas estan pagadas' }); return }
        setCtx({ sale, pend })
        setClientId(sale.client_id)
        setMonto((Number(pend[0].amount) - Number(pend[0].amount_paid)).toFixed(2))
      }
      if (tipo === 'inicial') {
        const { data: sep } = await supabase.from('separations')
          .select('id, client_id, amount, advisor_id, expiration_date, extended_until, client:clients(full_name)')
          .eq('lot_id', lotId).eq('status', 'vigente').maybeSingle()
        const lim = sep ? (sep.extended_until || sep.expiration_date) : null
        if (lim && lim < hoy()) setCtx({ sep, error: 'SEPARACION VENCIDA EL ' + lim + ' — LOTE BLOQUEADO. EL ADMINISTRADOR DEBE EXTENDER EL PLAZO O MARCAR PERDIDA EN EL MAPA DE LOTES (ficha del lote).' })
        else setCtx({ sep })
        if (sep) setClientId(sep.client_id)
        if (sep?.advisor_id) setAdvId(sep.advisor_id)
        setMonto(String(lote?.initial_payment_default ?? 500))
        setPrecioVenta(String(lote?.total_price ?? ''))
      }
      if (tipo === 'separacion') { setMonto('100'); setVenc(addDays(hoy(), 7)) }
    }
    load()
  }, [lotId, tipo])

  const plan = useMemo(() => {
    if (tipo !== 'cuota' || !ctx?.pend || !monto) return null
    let rest = Math.round(Number(monto) * 100) / 100
    const parts = []
    for (const q of ctx.pend) {
      if (rest <= 0.004) break
      const deuda = Math.round((Number(q.amount) - Number(q.amount_paid)) * 100) / 100
      const take = Math.min(rest, deuda)
      parts.push({ q, take: Math.round(take * 100) / 100, resto: Math.round((deuda - take) * 100) / 100 })
      rest = Math.round((rest - take) * 100) / 100
    }
    return { parts, sobra: rest }
  }, [tipo, ctx, monto])

  function reset() {
    setLotId(''); setClientId(''); setMonto(''); setNroOp(''); setObs(''); setCtx(null)
    setPrecioVenta(''); setMeses(48); setFecha(hoy()); setFVoucher(null); setAdvId(''); setCoId(''); setComision(''); setNotifIds([])
  }

  async function submit(e) {
    e.preventDefault()
    if (!fVoucher) { setMsg({ ok: false, t: 'OBLIGATORIO: adjunta la foto del voucher del cliente.' }); return }
    setBusy(true); setMsg(null)
    try {
      const op = (nroOp || 'SIN-REF').toUpperCase()
      const voucherUrl = await upload(`vouchers/${op.replace(/[^A-Z0-9-]/g, '')}`, fVoucher)
      const base = {
        project_id: pidOp,
        lot_id: lotId, client_id: clientId, date: fecha,
        operation_number: op, operation_type: opTipo,
        financial_account_id: acctId || null, observation: obs.toUpperCase(), origin: 'sistema',
        voucher_url: voucherUrl,
        registered_by: profile?.id, approved: true, approved_at: new Date().toISOString(),
      }

      if (tipo === 'separacion') {
        const { data: sep, error: e1 } = await supabase.from('separations').insert({
          lot_id: lotId, client_id: clientId, amount: Number(monto),
          date: fecha, expiration_date: venc, status: 'vigente', advisor_id: advId || null, created_by: profile?.id || null,
        }).select().single()
        if (e1) throw e1
        const { error: e2 } = await supabase.from('daily_income').insert({ ...base, amount: Number(monto), income_type: 'separacion', separation_id: sep.id })
        if (e2) throw e2
        await supabase.from('lots').update({ status: 'separado' }).eq('id', lotId)
        // recordatorio de vencimiento en el control de actividades (creadora + designadas)
        const loteSep = lots.find(l => l.id === lotId)
        const cliSep = clients.find(c => c.id === clientId)
        const destinos = new Set(notifIds)
        const propia = secs.find(s => s.user_id === profile?.id)
        if (propia) destinos.add(propia.id)
        if (destinos.size) {
          const titulo = ('VENCE SEPARACION MZ ' + (loteSep?.mz || '?') + ' LT ' + (loteSep?.lt || '?') + ' — ' + (cliSep?.full_name || 'CLIENTE') + ' (S/ ' + Number(monto).toFixed(2) + ')').slice(0, 200)
          const filas = [...destinos].map(sid => ({ secretary_id: sid, title: titulo, date: venc, slot: 'manana', category: 'administrativa', separation_id: sep.id }))
          const { error: e3 } = await supabase.from('secretary_tasks').insert(filas)
          if (e3) await supabase.from('secretary_tasks').insert(filas.map(({ separation_id, ...x }) => x))
        }
      }

      if (tipo === 'inicial') {
        const precio = Number(precioVenta)
        const inicial = Number(monto)
        const financiado = precio - inicial - (ctx?.sep ? Number(ctx.sep.amount) : 0)
        const cuotaBase = Math.round(financiado / meses * 100) / 100
        const { data: sale, error: e1 } = await supabase.from('sales').insert({
          lot_id: lotId, client_id: clientId, co_client_id: coId || null, separation_id: ctx?.sep?.id || null, advisor_id: advId || ctx?.sep?.advisor_id || null,
          total_sale_price: precio, initial_amount_paid: inicial,
          financed_amount: financiado, installments_count: meses,
          monthly_amount: cuotaBase, sale_date: fecha, status: 'en_proceso',
        }).select().single()
        if (e1) throw e1
        const rows = []
        let acumulado = 0
        for (let n = 1; n <= meses; n++) {
          const amt = n === meses ? Math.round((financiado - acumulado) * 100) / 100 : cuotaBase
          acumulado += amt
          rows.push({ sale_id: sale.id, installment_number: n, due_date: addMonths(fecha, n), amount: amt })
        }
        const { error: e2 } = await supabase.from('installments').insert(rows)
        if (e2) throw e2
        const { error: e3 } = await supabase.from('daily_income').insert({ ...base, amount: inicial, income_type: 'inicial', sale_id: sale.id })
        if (e3) throw e3
        await supabase.from('lots').update({ status: 'vendido' }).eq('id', lotId)
        if (ctx?.sep) await supabase.from('separations').update({ status: 'completada' }).eq('id', ctx.sep.id)
        const advFinal = advId || ctx?.sep?.advisor_id || null
        if (advFinal) {
          const { error: e4 } = await supabase.from('commissions').insert({
            sale_id: sale.id, advisor_id: advFinal, amount: Number(comision || 0), status: 'pendiente',
          })
          if (e4) setMsg({ ok: false, t: 'VENTA OK, PERO NO SE REGISTRO LA COMISION: ' + e4.message })
        }
      }

      if (tipo === 'cuota') {
        if (!plan || plan.parts.length === 0) throw new Error('Monto invalido')
        if (plan.sobra > 0.01) throw new Error(`El monto excede la deuda total del lote en ${soles(plan.sobra)}.`)
        for (const p of plan.parts) {
          const { error: e1 } = await supabase.from('daily_income').insert({
            ...base, amount: p.take, income_type: 'cuota', sale_id: ctx.sale.id, installment_id: p.q.id,
          })
          if (e1) throw e1
        }
      }

      setMsg({ ok: true, t: 'PAGO REGISTRADO. RECUERDA SUBIR EL COMPROBANTE INTERNO CUANDO LO GENERES.' })
      reset(); loadBase()
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + (err.message || err) }) }
    setBusy(false)
  }

  async function subirDoc(row, file, campo) {
    try {
      const url = await upload(`${campo === 'voucher_url' ? 'vouchers' : 'comprobantes'}/${row.id}`, file)
      await supabase.from('daily_income').update({ [campo]: url }).eq('id', row.id)
      setMsg({ ok: true, t: campo === 'voucher_url' ? 'VOUCHER SUBIDO' : 'COMPROBANTE SUBIDO' })
      loadBase()
    } catch (err) { setMsg({ ok: false, t: err.message }) }
  }

  // ---- correcciones del SUPERUSUARIO ----
  async function quitarDoc(campo) {
    if (!confirm('¿Quitar este documento del pago? (podrás subir otro)')) return
    const { error } = await supabase.from('daily_income').update({ [campo]: null }).eq('id', view.id)
    if (error) { setMsg({ ok: false, t: error.message }); return }
    setMsg({ ok: true, t: 'DOCUMENTO QUITADO' })
    setView(v => ({ ...v, [campo]: null })); loadBase()
  }
  async function editarFecha() {
    const nueva = prompt('NUEVA FECHA del pago (AAAA-MM-DD):', view.date)
    if (!nueva || !/^\d{4}-\d{2}-\d{2}$/.test(nueva)) { if (nueva !== null) alert('Formato inválido. Ej: 2026-06-15'); return }
    const { error } = await supabase.from('daily_income').update({ date: nueva, observation: ((view.observation || '') + ' | FECHA CORREGIDA POR SUPERUSUARIO (antes ' + view.date + ')').slice(0, 400) }).eq('id', view.id)
    if (error) { setMsg({ ok: false, t: error.message }); return }
    setMsg({ ok: true, t: 'FECHA CORREGIDA' }); setView(v => ({ ...v, date: nueva })); loadBase()
  }
  async function borrarPago() {
    if (!confirm('¿ELIMINAR ESTE PAGO de ' + soles(view.amount) + '?\n\nSi está aplicado a una cuota, la cuota se revierte (vuelve a deber ese monto). Esta acción no se puede deshacer.')) return
    if (view.installment_id) {
      const { data: q } = await supabase.from('installments').select('id, amount, amount_paid').eq('id', view.installment_id).maybeSingle()
      if (q) {
        const nuevoPagado = Math.max(0, Number(q.amount_paid) - Number(view.amount))
        await supabase.from('installments').update({
          amount_paid: nuevoPagado,
          status: nuevoPagado <= 0.01 ? 'pendiente' : (Number(q.amount) - nuevoPagado) <= 2 ? 'pagado' : 'pendiente',
          paid_date: nuevoPagado <= 0.01 ? null : undefined,
        }).eq('id', q.id)
      }
    }
    const { error } = await supabase.from('daily_income').delete().eq('id', view.id)
    if (error) { setMsg({ ok: false, t: error.message }); return }
    setMsg({ ok: true, t: 'PAGO ELIMINADO Y CUOTA REVERTIDA' }); setView(null); loadBase()
  }

  async function guardarNroOp() {
    const nuevo = (opEdit || '').trim().toUpperCase() || 'SIN-REF'
    const anterior = view.operation_number
    if (nuevo === anterior) { setMsg({ ok: true, t: 'SIN CAMBIOS EN EL N DE OPERACION' }); return }
    const { error } = await supabase.from('daily_income').update({ operation_number: nuevo }).eq('id', view.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    await supabase.from('activity_log').insert({
      action: 'UPDATE', entity_type: 'daily_income',
      user_email: profile?.email || null,
      details: { cambio: 'operation_number', antes: anterior, despues: nuevo, lote: view.lot ? view.lot.mz + '-' + view.lot.lt : null, monto: view.amount, project_id: pidOp },
    })
    setMsg({ ok: true, t: 'N DE OPERACION CORREGIDO: ' + anterior + ' -> ' + nuevo + ' (QUEDA EN BITACORA)' })
    setView(v => ({ ...v, operation_number: nuevo }))
    loadBase()
  }

  const pagosFiltrados = useMemo(() => {
    const t = fq.trim().toLowerCase()
    return pagos.filter(p => {
      if (ftipo !== 'todos' && p.income_type !== ftipo) return false
      if (fdoc === 'sin_voucher' && p.voucher_url) return false
      if (fdoc === 'sin_comprobante' && p.receipt_url) return false
      if (fest !== 'todos' && estadoDe(p) !== fest) return false
      if (!t) return true
      const lote = p.lot ? `${p.lot.mz}-${p.lot.lt}`.toLowerCase() : ''
      const lote2 = p.lot ? `mz ${p.lot.mz} lt ${p.lot.lt}`.toLowerCase() : ''
      return lote.includes(t) || lote2.includes(t) ||
        (p.client?.full_name || '').toLowerCase().includes(t) ||
        (p.operation_number || '').toLowerCase().includes(t)
    })
  }, [pagos, fq, ftipo, fdoc])
  const totalFiltrado = pagosFiltrados.reduce((s, p) => s + Number(p.amount), 0)
  const sinVoucher = pagos.filter(p => !p.voucher_url).length
  const sinComprobante = pagos.filter(p => !p.receipt_url).length

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Cuotas mensuales</h1>
        <ProjectPicker />
      </div>

      {!readOnly && <div className="chips">
        {[['cuota', 'Cuota'], ['separacion', 'Separacion'], ['inicial', 'Pago inicial']].map(([v, l]) => (
          <button key={v} className={`chip ${tipo === v ? 'on' : ''}`} onClick={() => { setTipo(v); reset() }}>{l}</button>
        ))}
      </div>}

      {!readOnly && <form className="glass form-card" onSubmit={submit}>
        <div className="form-grid">
          <label>Lote
            <select value={lotId} onChange={e => setLotId(e.target.value)} required>
              <option value="">- elegir -</option>
              {lotesFiltrados.map(l => <option key={l.id} value={l.id}>MZ {l.mz} LT {l.lt}</option>)}
            </select>
          </label>
          <label>Cliente
            <select value={clientId} onChange={e => setClientId(e.target.value)} required
              disabled={tipo === 'cuota' && !!ctx?.sale}>
              <option value="">- elegir -</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.full_name} ({c.doc_number})</option>)}
            </select>
          </label>
          <label>Fecha <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required /></label>
          <label>Monto S/ <input type="number" step="0.01" min="0.01" value={monto} onChange={e => setMonto(e.target.value)} required /></label>
          <label>N operacion <input value={nroOp} onChange={e => setNroOp(e.target.value)} placeholder="del voucher" /></label>
          <label>Banco / cuenta
            <select value={acctId} onChange={e => setAcctId(e.target.value)} required>
              <option value="">- elegir -</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>Tipo de operacion
            <select value={opTipo} onChange={e => setOpTipo(e.target.value)}>
              {['TRANSFERENCIA', 'DEPOSITO', 'BILLETERA DIGITAL', 'EFECTIVO'].map(t => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className={fVoucher ? '' : 'req-file'}>Voucher del cliente <b className="bad">(obligatorio)</b>
            <input type="file" accept="image/*,.pdf" required onChange={e => setFVoucher(e.target.files[0] || null)} />
          </label>
          {tipo === 'separacion' && (<>
            <label>Vence el <input type="date" value={venc} onChange={e => setVenc(e.target.value)} required /></label>
          <label>Vendedor (asesor)
            <select value={advId} onChange={e => setAdvId(e.target.value)} required>
              <option value="">- elegir -</option>
              {advisors.map(a => <option key={a.id} value={a.id}>{a.code}{a.full_name && a.full_name !== a.code ? ' - ' + a.full_name : ''}</option>)}
            </select>
          </label>
          {secs.length > 0 && (
            <div className="span2">
              <span className="muted small">RECORDAR EL VENCIMIENTO A (se registra en su control de actividades; tu registro se agrega solo):</span><br />
              {secs.map(s => (
                <label key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 14, fontWeight: 400 }}>
                  <input type="checkbox" checked={notifIds.includes(s.id)}
                    onChange={e => setNotifIds(ids => e.target.checked ? [...ids, s.id] : ids.filter(x => x !== s.id))} />
                  {s.tipo === 'gerencia' ? '\u{1F454} ' : ''}{s.full_name}{s.user_id === profile?.id ? ' (tu)' : ''}
                </label>
              ))}
            </div>
          )}
          </>)}
          {tipo === 'inicial' && (<>
          <label>Co-comprador (opcional, para ventas de 2 personas)
            <select value={coId} onChange={e => setCoId(e.target.value)}>
              <option value="">- ninguno -</option>
              {clients.filter(c => c.id !== clientId).map(c => <option key={c.id} value={c.id}>{c.full_name} ({c.doc_number})</option>)}
            </select>
          </label>
          <label>Vendedor (asesor)
            <select value={advId} onChange={e => setAdvId(e.target.value)} required>
              <option value="">- elegir -</option>
              {advisors.map(a => <option key={a.id} value={a.id}>{a.code}{a.full_name && a.full_name !== a.code ? ' - ' + a.full_name : ''}</option>)}
            </select>
          </label>
            <label>Precio de venta S/ <input type="number" step="0.01" value={precioVenta} onChange={e => setPrecioVenta(e.target.value)} required /></label>
            <label>Comision del asesor S/ <input type="number" step="0.01" min="0" value={comision} onChange={e => setComision(e.target.value)} placeholder="0.00" /></label>
            <label>Meses <input type="number" min="1" max="120" value={meses} onChange={e => setMeses(Number(e.target.value))} required /></label>
          </>)}
          <label className="span2">Observacion <input value={obs} onChange={e => setObs(e.target.value)} /></label>
        </div>

        {ctx?.error && <p className="error">{ctx.error}</p>}
        {tipo === 'cuota' && ctx?.pend && plan && plan.parts.length > 0 && (
          <div className="hint">
            <p>CLIENTE: <b>{ctx.sale.client?.full_name}</b> - SE APLICARA ASI:</p>
            {plan.parts.map(p => (
              <p key={p.q.id}>
                &#8594; CUOTA N {p.q.installment_number} ({p.q.status.toUpperCase()}, vence {p.q.due_date}): {soles(p.take)}
                {p.resto > 0.004
                  ? <b className="warn"> - QUEDARA FALTANDO {soles(p.resto)}</b>
                  : <b className="ok"> - QUEDA PAGADA</b>}
              </p>
            ))}
            {plan.sobra > 0.01 && <p className="error">SOBRAN {soles(plan.sobra)}: EXCEDE LA DEUDA TOTAL</p>}
          </div>
        )}
        {tipo === 'inicial' && ctx?.sep && <p className="hint">Separacion vigente de {soles(ctx.sep.amount)} ({ctx.sep.client?.full_name}). Se descuenta del financiado.</p>}
        {tipo === 'inicial' && precioVenta && monto && (
          <p className="hint">Se generara la venta con <b>{meses} cuotas</b> de aprox. {soles((Number(precioVenta) - Number(monto) - (ctx?.sep ? Number(ctx.sep.amount) : 0)) / meses)}</p>
        )}

        {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
        <button className="btn-primary" disabled={busy || !!ctx?.error || (tipo === 'cuota' && plan?.sobra > 0.01)}>
          {busy ? 'Guardando...' : 'Registrar pago'}
        </button>
      </form>}

      <h2 className="sub">
        Historial ({pagosFiltrados.length} de {pagos.length} | {soles(totalFiltrado)})
        {!readOnly && sinVoucher > 0 && <span className="warn"> | SIN VOUCHER: {sinVoucher}</span>}
        {!readOnly && sinComprobante > 0 && <span className="bad"> | FALTA COMPROBANTE: {sinComprobante}</span>}
      </h2>
      <div className="toolbar">
        <input className="search" placeholder="Filtrar por lote (G-7), cliente o N operacion..."
          value={fq} onChange={e => setFq(e.target.value)} />
        <select value={ftipo} onChange={e => setFtipo(e.target.value)}>
          <option value="todos">TODOS</option>
          <option value="cuota">CUOTAS</option>
          <option value="inicial">INICIALES</option>
          <option value="separacion">SEPARACIONES</option>
        </select>
        <select value={fdoc} onChange={e => setFdoc(e.target.value)}>
          <option value="todos">DOCS: TODOS</option>
          <option value="sin_voucher">SIN VOUCHER</option>
          <option value="sin_comprobante">SIN COMPROBANTE</option>
        </select>
        <select value={fest} onChange={e => setFest(e.target.value)}>
          <option value="todos">ESTADO: TODOS</option>
          <option value="ACEPTADO">ACEPTADOS</option>
          <option value="EXPROPIADO">EXPROPIADOS</option>
          <option value="PERDIDA">PERDIDAS</option>
        </select>
      </div>

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Lote</th><th>Concepto</th><th>Estado</th><th>Monto</th><th>Voucher</th><th>Comprobante</th><th>Cliente</th><th>N Op.</th><th>Banco</th></tr></thead>
          <tbody>
            {pagosFiltrados.slice(0, 300).map(r => (
              <tr key={r.id} className={'row-' + estadoDe(r).toLowerCase()}>
                <td>{r.date}</td>
                <td>{r.lot ? `${r.lot.mz}-${r.lot.lt}` : '-'}</td>
                <td><button className="link-btn" title="Ver documentos" onClick={() => { setView(r); setObsEdit(r.observation || ''); setOpEdit(r.operation_number || '') }}>{r.income_type === 'cuota' && r.installment ? `CUOTA N ${r.installment.installment_number}` : r.income_type}</button></td>
                <td><EstadoChip r={r} /></td>
                <td>{soles(r.amount)}</td>
                <td>
                  {r.voucher_url
                    ? <a href={r.voucher_url} target="_blank" rel="noreferrer">VER</a>
                    : readOnly ? <span className="muted">-</span>
                    : <label className="upload-btn warn">subir
                        <input type="file" accept="image/*,.pdf" hidden
                          onChange={e => e.target.files[0] && subirDoc(r, e.target.files[0], 'voucher_url')} />
                      </label>}
                </td>
                <td>
                  {r.receipt_url
                    ? <a href={r.receipt_url} target="_blank" rel="noreferrer">VER</a>
                    : readOnly ? <span className="muted">-</span>
                    : <label className="upload-btn bad">&#9888; falta
                        <input type="file" accept="image/*,.pdf" hidden
                          onChange={e => e.target.files[0] && subirDoc(r, e.target.files[0], 'receipt_url')} />
                      </label>}
                </td>
                <td>{r.client?.full_name || '-'}</td>
                <td>{r.operation_number}</td>
                <td>{r.account?.name || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {pagosFiltrados.length > 300 && <p className="muted small">Mostrando 300 de {pagosFiltrados.length} - usa los filtros.</p>}
      </div>

      {view && (
        <div className="modal-bg" onClick={() => setView(null)}>
          <div className="glass modal docs-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>
                {view.lot ? `MZ ${view.lot.mz} LT ${view.lot.lt}` : ''} |{' '}
                {view.income_type === 'cuota' && view.installment ? `CUOTA N ${view.installment.installment_number}` : view.income_type} |{' '}
                <span className="accent">{soles(view.amount)}</span>
              </h2>
              <button className="btn-ghost" onClick={() => setView(null)}>&#10005;</button>
            </div>
            <p className="muted">{view.client?.full_name || '-'} | {view.date} | N OP: {view.operation_number} | {view.account?.name || '-'} | <EstadoChip r={view} /></p>
            {(() => {
              const hermanos = pagos.filter(x => x.id !== view.id && x.operation_number === view.operation_number && x.operation_number !== 'SIN-REF')
              return hermanos.length > 0 && (
                <p className="hint">&#128279; MISMA OPERACION ({view.operation_number}) cubre tambien:{' '}
                  {hermanos.map(h => `${h.lot ? h.lot.mz + '-' + h.lot.lt : ''} ${h.income_type === 'cuota' && h.installment ? 'CUOTA ' + h.installment.installment_number : h.income_type} (${soles(h.amount)})`).join(' | ')}
                </p>
              )
            })()}
            <div className="form-grid">
              {!readOnly && <label className="span2">Observacion / comentario del pago
                <textarea rows="2" value={obsEdit} onChange={e => setObsEdit(e.target.value)} />
              </label>}
              {readOnly && view.observation && <p className="muted span2" style={{ margin: 0 }}>OBS: {view.observation}</p>}
              {role === 'superuser' && (
                <label className="span2">N de operacion (correccion, solo superusuario - queda en bitacora)
                  <span style={{ display: 'flex', gap: '.4rem' }}>
                    <input value={opEdit} onChange={e => setOpEdit(e.target.value)} style={{ flex: 1 }} />
                    <button type="button" className="btn-ghost" onClick={guardarNroOp}>Corregir N Op.</button>
                  </span>
                </label>
              )}
              {!readOnly && <div>
                <button type="button" className="btn-ghost" onClick={async () => {
                  await supabase.from('daily_income').update({ observation: obsEdit.toUpperCase() }).eq('id', view.id)
                  setMsg({ ok: true, t: 'OBSERVACION GUARDADA' }); loadBase()
                  setView(v => ({ ...v, observation: obsEdit.toUpperCase() }))
                }}>Guardar observacion</button>
              </div>}
              <div>
                {view.extra_url
                  ? <a href={view.extra_url} target="_blank" rel="noreferrer">VER ANEXO ADICIONAL</a>
                  : readOnly ? null
                  : <label className="upload-btn">+ Adjuntar anexo adicional (2do voucher, boleta, etc.)
                      <input type="file" accept="image/*,.pdf" hidden onChange={async e => {
                        if (!e.target.files[0]) return
                        try {
                          const url = await upload(`anexos/${view.id}`, e.target.files[0])
                          await supabase.from('daily_income').update({ extra_url: url }).eq('id', view.id)
                          setMsg({ ok: true, t: 'ANEXO SUBIDO' }); loadBase()
                          setView(v => ({ ...v, extra_url: url }))
                        } catch (err) { setMsg({ ok: false, t: err.message }) }
                      }} />
                    </label>}
              </div>
            </div>
            <div className="docs-grid">
              {role === 'superuser' && (
                <div className="chg-box" style={{ marginBottom: 10 }}>
                  <p style={{ fontSize: 12, fontWeight: 700 }}>🛠 CORRECCIONES (SUPERUSUARIO)</p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn-ghost" style={{ fontSize: 12 }} onClick={editarFecha}>📅 CORREGIR FECHA</button>
                    {view.voucher_url && <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => quitarDoc('voucher_url')}>🗑 QUITAR VOUCHER</button>}
                    {view.receipt_url && <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => quitarDoc('receipt_url')}>🗑 QUITAR COMPROBANTE</button>}
                    <button className="btn-ghost" style={{ fontSize: 12, color: '#ff8e7a', borderColor: 'rgba(255,142,122,.5)' }} onClick={borrarPago}>🗑 ELIMINAR PAGO</button>
                  </div>
                  <p className="muted" style={{ fontSize: 10 }}>El N° de operación se corrige arriba. Al eliminar un pago de cuota, la cuota vuelve a deber ese monto.</p>
                </div>
              )}
              {[['VOUCHER DEL CLIENTE', view.voucher_url], ['COMPROBANTE INTERNO', view.receipt_url]].map(([t, u]) => (
                <div key={t} className="doc-panel">
                  <p><b>{t}</b>{u && <> | <a href={u} target="_blank" rel="noreferrer">abrir aparte</a></>}</p>
                  {!u
                    ? <p className="bad big-alert">&#9888; NO SUBIDO</p>
                    : u.toLowerCase().includes('.pdf')
                      ? <iframe src={u} title={t} />
                      : <img src={u} alt={t} />}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
