import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const hoy = () => new Date().toISOString().slice(0, 10)

function addMonths(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDate()
  d.setMonth(d.getMonth() + n)
  if (d.getDate() < day) d.setDate(0) // fin de mes (30 ene + 1m = 28 feb)
  return d.toISOString().slice(0, 10)
}

export default function Payments() {
  const { profile } = useAuth()
  const [tipo, setTipo] = useState('cuota')
  const [lots, setLots] = useState([])
  const [clients, setClients] = useState([])
  const [accounts, setAccounts] = useState([])
  const [recent, setRecent] = useState([])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  // formulario
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
  const [venc, setVenc] = useState(addMonths(hoy(), 0))
  const [ctx, setCtx] = useState(null) // venta/cuota detectada

  async function loadBase() {
    const [l, c, a, r] = await Promise.all([
      supabase.from('lots').select('id, mz, lt, status, total_price, initial_payment_default').order('mz').order('lt'),
      supabase.from('clients').select('id, full_name, doc_number').order('full_name'),
      supabase.from('financial_accounts').select('id, name').eq('active', true),
      supabase.from('daily_income').select('id, date, amount, operation_number, income_type, voucher_url, lot:lots(mz,lt), client:clients(full_name)')
        .order('created_at', { ascending: false }).limit(15),
    ])
    setLots(l.data || []); setClients(c.data || []); setAccounts(a.data || []); setRecent(r.data || [])
  }
  useEffect(() => { loadBase() }, [])

  const lotesFiltrados = useMemo(() => {
    if (tipo === 'separacion') return lots.filter(l => l.status === 'disponible')
    if (tipo === 'inicial') return lots.filter(l => ['separado', 'disponible'].includes(l.status))
    return lots.filter(l => l.status === 'vendido')
  }, [lots, tipo])

  // al elegir lote: detectar venta activa / cuota pendiente / separación vigente
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
        const { data: inst } = await supabase.from('installments')
          .select('id, installment_number, amount, amount_paid, due_date, status')
          .eq('sale_id', sale.id).neq('status', 'pagado')
          .order('installment_number').limit(1)
        if (!inst?.length) { setCtx({ error: 'Todas las cuotas están pagadas 🎉' }); return }
        const q = inst[0]
        const deuda = (Number(q.amount) - Number(q.amount_paid)).toFixed(2)
        setCtx({ sale, cuota: q })
        setClientId(sale.client_id); setMonto(deuda)
      }
      if (tipo === 'inicial') {
        const { data: sep } = await supabase.from('separations')
          .select('id, client_id, amount, client:clients(full_name)')
          .eq('lot_id', lotId).eq('status', 'vigente').maybeSingle()
        setCtx({ sep })
        if (sep) setClientId(sep.client_id)
        setMonto(String(lote?.initial_payment_default ?? 500))
        setPrecioVenta(String(lote?.total_price ?? ''))
      }
      if (tipo === 'separacion') {
        setMonto('100'); setVenc(addMonths(hoy(), 1))
      }
    }
    load()
  }, [lotId, tipo])

  function reset() {
    setLotId(''); setClientId(''); setMonto(''); setNroOp(''); setObs(''); setCtx(null)
    setPrecioVenta(''); setMeses(48); setFecha(hoy())
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const base = {
        project_id: (await supabase.from('projects').select('id').limit(1).single()).data.id,
        lot_id: lotId, client_id: clientId, date: fecha, amount: Number(monto),
        operation_number: (nroOp || 'SIN-REF').toUpperCase(), operation_type: opTipo,
        financial_account_id: acctId || null, observation: obs.toUpperCase(), origin: 'sistema',
        registered_by: profile?.id, approved: true, approved_at: new Date().toISOString(),
      }

      if (tipo === 'separacion') {
        const { data: sep, error: e1 } = await supabase.from('separations').insert({
          lot_id: lotId, client_id: clientId, amount: Number(monto),
          date: fecha, expiration_date: venc, status: 'vigente',
        }).select().single()
        if (e1) throw e1
        const { error: e2 } = await supabase.from('daily_income').insert({ ...base, income_type: 'separacion', separation_id: sep.id })
        if (e2) throw e2
        await supabase.from('lots').update({ status: 'separado' }).eq('id', lotId)
      }

      if (tipo === 'inicial') {
        const precio = Number(precioVenta)
        const inicial = Number(monto)
        const financiado = precio - inicial - (ctx?.sep ? Number(ctx.sep.amount) : 0)
        const cuotaBase = Math.round(financiado / meses * 100) / 100
        const { data: sale, error: e1 } = await supabase.from('sales').insert({
          lot_id: lotId, client_id: clientId, separation_id: ctx?.sep?.id || null,
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
        const { error: e3 } = await supabase.from('daily_income').insert({ ...base, income_type: 'inicial', sale_id: sale.id })
        if (e3) throw e3
        await supabase.from('lots').update({ status: 'vendido' }).eq('id', lotId)
        if (ctx?.sep) await supabase.from('separations').update({ status: 'completada' }).eq('id', ctx.sep.id)
      }

      if (tipo === 'cuota') {
        const { error: e1 } = await supabase.from('daily_income').insert({
          ...base, income_type: 'cuota', sale_id: ctx.sale.id, installment_id: ctx.cuota.id,
        })
        if (e1) throw e1
      }

      setMsg({ ok: true, t: 'Pago registrado correctamente ✔' })
      reset(); loadBase()
    } catch (err) {
      setMsg({ ok: false, t: 'Error: ' + (err.message || err) })
    }
    setBusy(false)
  }

  async function subirVoucher(row, file) {
    const path = `vouchers/${row.id}-${file.name}`
    const { error } = await supabase.storage.from('urbis-files').upload(path, file, { upsert: true })
    if (error) { setMsg({ ok: false, t: 'Error al subir: ' + error.message }); return }
    const { data } = supabase.storage.from('urbis-files').getPublicUrl(path)
    await supabase.from('daily_income').update({ voucher_url: data.publicUrl }).eq('id', row.id)
    setMsg({ ok: true, t: 'Voucher subido ✔' }); loadBase()
  }

  return (
    <>
      <h1>Cuotas mensuales</h1>

      <div className="chips">
        {[['cuota', '💵 Cuota'], ['separacion', '📌 Separación'], ['inicial', '🏁 Pago inicial']].map(([v, l]) => (
          <button key={v} className={`chip ${tipo === v ? 'on' : ''}`} onClick={() => { setTipo(v); reset() }}>{l}</button>
        ))}
      </div>

      <form className="glass form-card" onSubmit={submit}>
        <div className="form-grid">
          <label>Lote
            <select value={lotId} onChange={e => setLotId(e.target.value)} required>
              <option value="">— elegir —</option>
              {lotesFiltrados.map(l => <option key={l.id} value={l.id}>Mz {l.mz} Lt {l.lt}</option>)}
            </select>
          </label>

          <label>Cliente
            <select value={clientId} onChange={e => setClientId(e.target.value)} required
              disabled={tipo === 'cuota' && !!ctx?.sale}>
              <option value="">— elegir —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.full_name} ({c.doc_number})</option>)}
            </select>
          </label>

          <label>Fecha <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required /></label>
          <label>Monto S/ <input type="number" step="0.01" min="0.01" value={monto} onChange={e => setMonto(e.target.value)} required /></label>
          <label>Nº operación <input value={nroOp} onChange={e => setNroOp(e.target.value)} placeholder="del voucher" /></label>
          <label>Banco / cuenta
            <select value={acctId} onChange={e => setAcctId(e.target.value)} required>
              <option value="">— elegir —</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>Tipo de operación
            <select value={opTipo} onChange={e => setOpTipo(e.target.value)}>
              {['TRANSFERENCIA', 'DEPOSITO', 'BILLETERA DIGITAL', 'EFECTIVO'].map(t => <option key={t}>{t}</option>)}
            </select>
          </label>

          {tipo === 'separacion' && (
            <label>Vence el <input type="date" value={venc} onChange={e => setVenc(e.target.value)} required /></label>
          )}
          {tipo === 'inicial' && (<>
            <label>Precio de venta S/ <input type="number" step="0.01" value={precioVenta} onChange={e => setPrecioVenta(e.target.value)} required /></label>
            <label>Meses <input type="number" min="1" max="120" value={meses} onChange={e => setMeses(Number(e.target.value))} required /></label>
          </>)}
          <label className="span2">Observación <input value={obs} onChange={e => setObs(e.target.value)} /></label>
        </div>

        {ctx?.error && <p className="error">{ctx.error}</p>}
        {ctx?.cuota && (
          <p className="hint">→ Se pagará la <b>cuota N°{ctx.cuota.installment_number}</b> de <b>{ctx.sale.client?.full_name}</b>
            {' '}(vence {ctx.cuota.due_date}, saldo S/ {(Number(ctx.cuota.amount) - Number(ctx.cuota.amount_paid)).toFixed(2)})</p>
        )}
        {tipo === 'inicial' && ctx?.sep && <p className="hint">→ Tiene separación vigente de S/ {ctx.sep.amount} ({ctx.sep.client?.full_name}). Se descuenta del financiado.</p>}
        {tipo === 'inicial' && precioVenta && monto && (
          <p className="hint">→ Se generará la venta con <b>{meses} cuotas</b> de ≈ S/ {(Math.round((Number(precioVenta) - Number(monto) - (ctx?.sep ? Number(ctx.sep.amount) : 0)) / meses * 100) / 100).toFixed(2)}</p>
        )}

        {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
        <button className="btn-primary" disabled={busy || !!ctx?.error}>{busy ? 'Guardando…' : 'Registrar pago'}</button>
      </form>

      <h2 className="sub">Últimos pagos</h2>
      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Lote</th><th>Cliente</th><th>Tipo</th><th>Monto</th><th>Nº Op.</th><th>Voucher</th></tr></thead>
          <tbody>
            {recent.map(r => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{r.lot ? `${r.lot.mz}-${r.lot.lt}` : '—'}</td>
                <td>{r.client?.full_name || '—'}</td>
                <td>{r.income_type}</td>
                <td>S/ {Number(r.amount).toFixed(2)}</td>
                <td>{r.operation_number}</td>
                <td>
                  {r.voucher_url
                    ? <a href={r.voucher_url} target="_blank" rel="noreferrer">ver 📎</a>
                    : <label className="upload-btn">subir
                        <input type="file" accept="image/*,.pdf" hidden
                          onChange={e => e.target.files[0] && subirVoucher(r, e.target.files[0])} />
                      </label>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
