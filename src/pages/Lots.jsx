import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const COLORS = {
  disponible: '#4caf72', separado: '#e0913f', vendido: '#4f83c2',
  invadido: '#c94f4f', expropiado: '#9a6bc9',
}
const LBL = {
  disponible: 'Disponible', separado: 'Separado', vendido: 'Vendido',
  invadido: 'Invadido', expropiado: 'Expropiado',
}

export default function Lots() {
  const { role } = useAuth()
  const [edit, setEdit] = useState(false)
  const [ef, setEf] = useState({})
  const [emsg, setEmsg] = useState(null)
  const [lots, setLots] = useState([])
  const [vencidos, setVencidos] = useState(new Set())
  const [filter, setFilter] = useState('todos')
  const [sel, setSel] = useState(null)
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    supabase.from('lots').select('*').order('mz').order('lt')
      .then(({ data }) => setLots(data || []))
    supabase.from('installments').select('sales!inner(lot_id, status)').eq('status', 'vencido')
      .then(({ data }) => setVencidos(new Set((data || []).filter(r => r.sales.status === 'en_proceso').map(r => r.sales.lot_id))))
  }, [])

  useEffect(() => {
    if (!sel) { setDetail(null); return }
    async function load() {
      const { data: sale } = await supabase.from('sales')
        .select('*, client:clients!sales_client_id_fkey(full_name, phone, phone_valid, doc_number), advisor:advisors(code)')
        .eq('lot_id', sel.id).in('status', ['en_proceso', 'pagado'])
        .maybeSingle()
      let inst = []
      if (sale) {
        const { data } = await supabase.from('installments')
          .select('installment_number, due_date, amount, amount_paid, status')
          .eq('sale_id', sale.id).order('installment_number')
        inst = data || []
      }
      setDetail({ sale, inst })
    }
    load()
  }, [sel])

  const byMz = useMemo(() => {
    const g = {}
    for (const l of lots) {
      if (filter === 'vencidas') { if (!vencidos.has(l.id)) continue }
      else if (filter !== 'todos' && l.status !== filter) continue
      ;(g[l.mz] = g[l.mz] || []).push(l)
    }
    for (const k in g) g[k].sort((a, b) => Number(a.lt) - Number(b.lt) || String(a.lt).localeCompare(String(b.lt)))
    return g
  }, [lots, filter, vencidos])

  const counts = useMemo(() => {
    const c = { todos: lots.length, vencidas: vencidos.size }
    for (const l of lots) c[l.status] = (c[l.status] || 0) + 1
    return c
  }, [lots, vencidos])

  function waMessage() {
    const { sale, inst } = detail
    const overdue = inst.filter(i => i.status === 'vencido')
    const next = inst.find(i => i.status === 'pendiente')
    const name = sale.client?.full_name?.split(' ')[0] || 'CLIENTE'
    let msg = `Hola *${sale.client?.full_name}*, le saludamos de Urbis Group\n`
    msg += `Lote *Mz ${sel.mz} Lt ${sel.lt}* - Las Praderas de Cashibo\n\n`
    if (overdue.length) {
      const deuda = overdue.reduce((s, i) => s + Number(i.amount) - Number(i.amount_paid), 0)
      msg += `Tiene *${overdue.length} cuota(s) vencida(s)* por S/ ${deuda.toFixed(2)}.\n`
    }
    if (next) msg += `Proxima cuota: N ${next.installment_number} de S/ ${Number(next.amount).toFixed(2)}, vence el ${next.due_date}.\n`
    msg += `\nPuede pagar por transferencia o deposito. Gracias ${name}!`
    const phone = (sale.client?.phone || '').replace(/\D/g, '')
    return `https://wa.me/${phone.startsWith('51') || phone.startsWith('52') || phone.startsWith('1') ? phone : '51' + phone}?text=${encodeURIComponent(msg)}`
  }

  return (
    <>
      <h1>Mapa de lotes</h1>

      <div className="chips">
        {['todos', 'disponible', 'separado', 'vendido', 'invadido', 'expropiado'].map(s => (
          <button key={s}
            className={`chip ${filter === s ? 'on' : ''}`}
            style={s !== 'todos' ? { '--dot': COLORS[s] } : {}}
            onClick={() => setFilter(s)}>
            {s !== 'todos' && <span className="dot" />}
            {s === 'todos' ? 'Todos' : LBL[s]} ({counts[s] || 0})
          </button>
        ))}
        <button className={`chip ${filter === 'vencidas' ? 'on' : ''}`} style={{ '--dot': '#e05252' }}
          onClick={() => setFilter('vencidas')}>
          <span className="dot" /> Con vencidas ({counts.vencidas})
        </button>
      </div>

      {Object.entries(byMz).map(([mz, arr]) => (
        <section key={mz} className="mz-block">
          <h3>Manzana {mz}</h3>
          <div className="lot-grid">
            {arr.map(l => (
              <button key={l.id} className={`lot-cell ${vencidos.has(l.id) ? 'venc' : ''}`}
                style={{ background: COLORS[l.status] }}
                title={`Mz ${l.mz} Lt ${l.lt} - ${LBL[l.status]}${vencidos.has(l.id) ? ' - CON CUOTAS VENCIDAS' : ''}`}
                onClick={() => { setSel(l); setEdit(false); setEmsg(null) }}>
                {l.lt}
              </button>
            ))}
          </div>
        </section>
      ))}

      {sel && (
        <div className="modal-bg" onClick={() => setSel(null)}>
          <div className="glass modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Mz {sel.mz} - Lt {sel.lt}</h2>
              <span className="badge" style={{ background: COLORS[sel.status] }}>{LBL[sel.status]}</span>
              <button className="btn-ghost" onClick={() => setSel(null)}>&#10005;</button>
            </div>

            <div className="ficha">
              <p><span className="muted">Area:</span> {sel.area_m2} m2</p>
              <p><span className="muted">Precio/m2:</span> S/ {Number(sel.price_per_m2).toFixed(2)}</p>
              <p><span className="muted">Precio lista:</span> S/ {Number(sel.total_price).toLocaleString('es-PE')}</p>
              {sel.associated_to && <p><span className="muted">Asociado a:</span> {sel.associated_to}</p>}
              {sel.boundaries?.medidas && (
                <p className="muted small">
                  Medidas: {Object.entries(sel.boundaries.medidas).map(([k, v]) => `${k} ${v}`).join(' | ')}
                </p>
              )}
            </div>

            {['admin', 'secretary'].includes(role) && (
              <div className="ficha">
                {!edit ? (
                  <button className="btn-ghost" onClick={() => { setEdit(true); setEf({ area_m2: sel.area_m2, price_per_m2: sel.price_per_m2, status: sel.status, associated_to: sel.associated_to || '', initial_payment_default: sel.initial_payment_default }) }}>Editar lote</button>
                ) : (
                  <form className="form-grid" onSubmit={async e => {
                    e.preventDefault()
                    const payload = {
                      area_m2: Number(ef.area_m2), price_per_m2: Number(ef.price_per_m2),
                      status: ef.status, associated_to: (ef.associated_to || '').toUpperCase() || null,
                      initial_payment_default: Number(ef.initial_payment_default),
                    }
                    const { error } = await supabase.from('lots').update(payload).eq('id', sel.id)
                    if (error) { setEmsg('ERROR: ' + error.message); return }
                    setEmsg('LOTE ACTUALIZADO')
                    const { data } = await supabase.from('lots').select('*').order('mz').order('lt')
                    setLots(data || [])
                    setSel(x => ({ ...x, ...payload, total_price: payload.area_m2 * payload.price_per_m2 }))
                    setEdit(false)
                  }}>
                    <label>Area m2 <input type="number" step="0.01" value={ef.area_m2} onChange={e => setEf(f => ({ ...f, area_m2: e.target.value }))} required /></label>
                    <label>Precio por m2 <input type="number" step="0.01" value={ef.price_per_m2} onChange={e => setEf(f => ({ ...f, price_per_m2: e.target.value }))} required /></label>
                    <label>Estado
                      <select value={ef.status} onChange={e => setEf(f => ({ ...f, status: e.target.value }))}>
                        {Object.keys(COLORS).map(s => <option key={s} value={s}>{LBL[s]}</option>)}
                      </select>
                    </label>
                    <label>Separacion default S/ <input type="number" step="0.01" value={ef.initial_payment_default} onChange={e => setEf(f => ({ ...f, initial_payment_default: e.target.value }))} /></label>
                    <label className="span2">Asociado a (vacio = ninguno) <input value={ef.associated_to} onChange={e => setEf(f => ({ ...f, associated_to: e.target.value }))} /></label>
                    <div className="span2">
                      <button className="btn-primary">Guardar lote</button>{' '}
                      <button type="button" className="btn-ghost" onClick={() => setEdit(false)}>Cancelar</button>
                    </div>
                  </form>
                )}
                {emsg && <p className={emsg.startsWith('ERROR') ? 'error' : 'ok'}>{emsg}</p>}
              </div>
            )}

            {detail?.sale ? (
              <>
                <hr />
                <div className="ficha">
                  <p><span className="muted">Cliente:</span> <b>{detail.sale.client?.full_name}</b> ({detail.sale.client?.doc_number})</p>
                  <p><span className="muted">Asesor:</span> {detail.sale.advisor?.code}</p>
                  <p><span className="muted">Precio venta:</span> S/ {Number(detail.sale.total_sale_price).toLocaleString('es-PE')}</p>
                  {(() => {
                    const pagado = detail.inst.reduce((s, i) => s + Number(i.amount_paid), 0) + Number(detail.sale.initial_amount_paid)
                    const pct = (pagado / Number(detail.sale.total_sale_price) * 100).toFixed(1)
                    const venc = detail.inst.filter(i => i.status === 'vencido').length
                    const pag = detail.inst.filter(i => i.status === 'pagado').length
                    return (
                      <>
                        <p><span className="muted">Pagado:</span> S/ {pagado.toLocaleString('es-PE', { minimumFractionDigits: 2 })} ({pct}%)</p>
                        <p>
                          <span className="ok">&#9679; {pag} pagadas</span>{' '}
                          <span className="warn">&#9679; {detail.inst.length - pag - venc} pendientes</span>{' '}
                          <span className="bad">&#9679; {venc} vencidas</span>
                        </p>
                      </>
                    )
                  })()}
                  {detail.sale.client?.phone_valid
                    ? <a className="btn-primary btn-link" href={waMessage()} target="_blank" rel="noreferrer">Mensaje de cobro por WhatsApp</a>
                    : <p className="error">Telefono no valido - actualizar en la ficha del cliente</p>}
                </div>
              </>
            ) : detail && sel.status !== 'disponible' ? (
              <p className="muted">Sin venta activa registrada.</p>
            ) : null}
          </div>
        </div>
      )}
    </>
  )
}
