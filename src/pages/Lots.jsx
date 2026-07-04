import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'

const COLORS = {
  disponible: '#4caf72', separado: '#e0913f', vendido: '#4f83c2',
  invadido: '#c94f4f', expropiado: '#9a6bc9',
}
const LBL = {
  disponible: 'Disponible', separado: 'Separado', vendido: 'Vendido',
  invadido: 'Invadido', expropiado: 'Expropiado',
}

async function upload(path, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const full = `${path}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('urbis-files').upload(full, file, { upsert: true })
  if (error) throw new Error('Error al subir documento: ' + error.message)
  return supabase.storage.from('urbis-files').getPublicUrl(full).data.publicUrl
}

export default function Lots() {
  const { role, profile } = useAuth()
  const { pidOp } = useProject()
  const [lots, setLots] = useState([])
  const [vencidos, setVencidos] = useState(new Set())
  const [filter, setFilter] = useState('todos')
  const [sel, setSel] = useState(null)
  const [detail, setDetail] = useState(null)
  const [historial, setHistorial] = useState([])

  // edicion normal (sin estado)
  const [edit, setEdit] = useState(false)
  const [ef, setEf] = useState({})
  const [emsg, setEmsg] = useState(null)

  // cambio de estado critico (solo admin)
  const [chg, setChg] = useState(false)
  const [chgTo, setChgTo] = useState('separado')
  const [chgReason, setChgReason] = useState('')
  const [chgFile, setChgFile] = useState(null)
  const [chgBusy, setChgBusy] = useState(false)

  async function loadLots() {
    if (!pidOp) return
    const { data } = await supabase.from('lots').select('*').eq('project_id', pidOp).order('mz').order('lt')
    setLots(data || [])
  }
  useEffect(() => {
    loadLots()
    supabase.from('installments').select('sales!inner(lot_id, status)').eq('status', 'vencido')
      .then(({ data }) => setVencidos(new Set((data || []).filter(r => r.sales.status === 'en_proceso').map(r => r.sales.lot_id))))
  }, [pidOp])

  useEffect(() => {
    if (!sel) { setDetail(null); setHistorial([]); return }
    async function load() {
      const { data: sale } = await supabase.from('sales')
        .select('*, client:clients!sales_client_id_fkey(full_name, phone, phone_valid, doc_number), advisor:advisors(code)')
        .eq('lot_id', sel.id).in('status', ['en_proceso', 'pagado'])
        .maybeSingle()
      let inst = []
      if (sale) {
        const { data } = await supabase.from('installments')
          .select('id, installment_number, due_date, amount, amount_paid, status')
          .eq('sale_id', sale.id).order('installment_number')
        inst = data || []
      }
      setDetail({ sale, inst })
      const { data: hist } = await supabase.from('lot_status_changes')
        .select('new_status, previous_status, reason, document_url, changed_at')
        .eq('lot_id', sel.id).order('changed_at', { ascending: false }).limit(5)
      setHistorial(hist || [])
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

  function abrirLote(l) {
    setSel(l); setEdit(false); setEmsg(null); setChg(false); setChgReason(''); setChgFile(null)
  }

  async function guardarEdicion(e) {
    e.preventDefault()
    const payload = {
      area_m2: Number(ef.area_m2), price_per_m2: Number(ef.price_per_m2),
      associated_to: (ef.associated_to || '').toUpperCase() || null,
      initial_payment_default: Number(ef.initial_payment_default),
    }
    const { error } = await supabase.from('lots').update(payload).eq('id', sel.id)
    if (error) { setEmsg('ERROR: ' + error.message); return }
    setEmsg('LOTE ACTUALIZADO')
    await loadLots()
    setSel(x => ({ ...x, ...payload, total_price: payload.area_m2 * payload.price_per_m2 }))
    setEdit(false)
  }

  // cambio de estado con burocracia
  const docObligatorio = ['expropiado', 'invadido'].includes(chgTo)
  async function cambiarEstado(e) {
    e.preventDefault()
    if (chgReason.trim().length < 10) { setEmsg('ERROR: EXPLICA EL MOTIVO (minimo 10 caracteres).'); return }
    if (docObligatorio && !chgFile) { setEmsg('ERROR: PARA ' + chgTo.toUpperCase() + ' EL DOCUMENTO DE RESPALDO FIRMADO ES OBLIGATORIO.'); return }
    setChgBusy(true); setEmsg(null)
    try {
      let docUrl = null
      if (chgFile) docUrl = await upload(`estado-lotes/${sel.mz}-${sel.lt}-${chgTo}`, chgFile)
      const { error: e1 } = await supabase.from('lot_status_changes').insert({
        lot_id: sel.id, previous_status: sel.status, new_status: chgTo,
        reason: chgReason.toUpperCase(), document_url: docUrl, changed_by: profile?.id,
      })
      if (e1) throw e1
      const { error: e2 } = await supabase.from('lots').update({ status: chgTo }).eq('id', sel.id)
      if (e2) throw e2
      // expropiar tambien marca la venta activa como expropiada
      if (chgTo === 'expropiado' && detail?.sale) {
        await supabase.from('sales').update({ status: 'expropiado' }).eq('id', detail.sale.id)
        await supabase.from('daily_income').update({ observation: 'EXPROPIADO' }).eq('sale_id', detail.sale.id)
      }
      setEmsg('ESTADO CAMBIADO A ' + chgTo.toUpperCase())
      await loadLots()
      setSel(x => ({ ...x, status: chgTo }))
      setChg(false); setChgReason(''); setChgFile(null)
    } catch (err) { setEmsg('ERROR: ' + err.message) }
    setChgBusy(false)
  }

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
    if (next) {
      const falta = Number(next.amount) - Number(next.amount_paid)
      msg += `Proxima cuota: N ${next.installment_number}, ${falta < Number(next.amount) ? 'le falta S/ ' + falta.toFixed(2) : 'de S/ ' + Number(next.amount).toFixed(2)}, vence el ${next.due_date}.\n`
    }
    msg += `\nPuede pagar por transferencia o deposito. Gracias ${name}!`
    const phone = (sale.client?.phone || '').replace(/\D/g, '')
    return `https://wa.me/${phone.startsWith('51') || phone.startsWith('52') || phone.startsWith('1') ? phone : '51' + phone}?text=${encodeURIComponent(msg)}`
  }

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Mapa de lotes</h1>
        <ProjectPicker />
        {role === 'admin' && (
          <button className="btn-ghost" onClick={async () => {
            const pct = Number(prompt('SUBIDA DE PRECIOS (solo lotes DISPONIBLES de este proyecto).\n\nPorcentaje de aumento (ej. 5 para +5%, -3 para bajar 3%):'))
            if (!pct || isNaN(pct)) return
            const disp = lots.filter(l => l.status === 'disponible')
            if (!confirm(`Se actualizara el precio/m2 de ${disp.length} lotes disponibles en ${pct}%. Continuar?`)) return
            for (const l of disp) {
              await supabase.from('lots').update({ price_per_m2: Math.round(Number(l.price_per_m2) * (1 + pct / 100) * 100) / 100 }).eq('id', l.id)
            }
            alert(`${disp.length} LOTES ACTUALIZADOS (${pct > 0 ? '+' : ''}${pct}%)`)
            loadLots()
          }}>Precios % (admin)</button>
        )}
      </div>

      <div className="chips">
        {['todos', 'disponible', 'separado', 'vendido', 'invadido', 'expropiado'].map(s => (
          <button key={s} className={`chip ${filter === s ? 'on' : ''}`}
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
                onClick={() => abrirLote(l)}>
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
              <p><span className="muted">Area:</span> {sel.area_m2} m2 | <span className="muted">Precio/m2:</span> S/ {Number(sel.price_per_m2).toFixed(2)}</p>
              <p><span className="muted">Precio lista:</span> S/ {Number(sel.total_price).toLocaleString('es-PE')}</p>
              {sel.associated_to && <p><span className="muted">Asociado a:</span> {sel.associated_to}</p>}
              {sel.boundaries?.medidas && (
                <p className="muted small">Medidas: {Object.entries(sel.boundaries.medidas).map(([k, v]) => `${k} ${v}`).join(' | ')}</p>
              )}
            </div>

            {['admin', 'secretary'].includes(role) && (
              <div className="ficha">
                {!edit ? (
                  <p>
                    <button className="btn-ghost" onClick={() => { setEdit(true); setChg(false); setEf({ area_m2: sel.area_m2, price_per_m2: sel.price_per_m2, associated_to: sel.associated_to || '', initial_payment_default: sel.initial_payment_default }) }}>Editar datos</button>
                    {' '}
                    {role === 'admin' && (
                      <button className="btn-ghost" onClick={() => { setChg(!chg); setEdit(false) }}>Cambiar estado (admin)</button>
                    )}
                  </p>
                ) : (
                  <form className="form-grid" onSubmit={guardarEdicion}>
                    <label>Area m2 <input type="number" step="0.01" value={ef.area_m2} onChange={e => setEf(f => ({ ...f, area_m2: e.target.value }))} required /></label>
                    <label>Precio por m2 <input type="number" step="0.01" value={ef.price_per_m2} onChange={e => setEf(f => ({ ...f, price_per_m2: e.target.value }))} required /></label>
                    <label>Separacion default S/ <input type="number" step="0.01" value={ef.initial_payment_default} onChange={e => setEf(f => ({ ...f, initial_payment_default: e.target.value }))} /></label>
                    <label>Asociado a <input value={ef.associated_to} onChange={e => setEf(f => ({ ...f, associated_to: e.target.value }))} /></label>
                    <div className="span2">
                      <button className="btn-primary">Guardar</button>{' '}
                      <button type="button" className="btn-ghost" onClick={() => setEdit(false)}>Cancelar</button>
                    </div>
                  </form>
                )}

                {chg && role === 'admin' && (
                  <form onSubmit={cambiarEstado} className="chg-box">
                    <p className="bad"><b>CAMBIO DE ESTADO - REQUIERE JUSTIFICACION</b></p>
                    <label>Nuevo estado
                      <select value={chgTo} onChange={e => setChgTo(e.target.value)}>
                        <option value="disponible">DISPONIBLE (liberar)</option>
                        <option value="separado">SEPARADO ADMINISTRATIVO (asunto interno)</option>
                        <option value="invadido">INVADIDO</option>
                        <option value="expropiado">EXPROPIADO</option>
                      </select>
                    </label>
                    <label>Motivo (obligatorio)
                      <textarea rows="3" value={chgReason} onChange={e => setChgReason(e.target.value)}
                        placeholder={chgTo === 'expropiado' ? 'Explica el motivo de la expropiacion...' : 'Explica el motivo del cambio...'} required />
                    </label>
                    <label>Documento de respaldo {docObligatorio ? <b className="bad">(OBLIGATORIO - firmado)</b> : '(opcional)'}
                      <input type="file" accept="image/*,.pdf" onChange={e => setChgFile(e.target.files[0] || null)} />
                    </label>
                    {chgTo === 'expropiado' && detail?.sale &&
                      <p className="warn">&#9888; La venta activa de {detail.sale.client?.full_name} pasara a EXPROPIADA.</p>}
                    <button className="btn-primary" disabled={chgBusy}>{chgBusy ? 'Procesando...' : 'Confirmar cambio de estado'}</button>
                  </form>
                )}
                {emsg && <p className={emsg.startsWith('ERROR') ? 'error' : 'ok'}>{emsg}</p>}

                {historial.length > 0 && (
                  <div className="small muted">
                    <p><b>HISTORIAL DE ESTADOS:</b></p>
                    {historial.map((h, i) => (
                      <p key={i}>
                        {new Date(h.changed_at).toLocaleDateString('es-PE')}: {h.previous_status} &#8594; <b>{h.new_status}</b> - {h.reason}
                        {h.document_url && <> | <a href={h.document_url} target="_blank" rel="noreferrer">DOC</a></>}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {detail?.sale ? (
              <>
                <hr />
                <div className="ficha">
                  <p><span className="muted">Cliente:</span> <b>{detail.sale.client?.full_name}</b> ({detail.sale.client?.doc_number})</p>
                  <p><span className="muted">Asesor:</span> {detail.sale.advisor?.code} | <span className="muted">Precio venta:</span> S/ {Number(detail.sale.total_sale_price).toLocaleString('es-PE')}</p>
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
                  {role === 'admin' && detail.sale.status === 'en_proceso' && (
                    <p><button className="btn-ghost" onClick={async () => {
                      const sale = detail.sale
                      const nuevo = Number(prompt('AJUSTE DE PRECIO DE ESTA VENTA (solo admin).\n\nPrecio actual: S/ ' + sale.total_sale_price + '\nNuevo precio total:'))
                      if (!nuevo || isNaN(nuevo) || nuevo <= 0) return
                      const motivo = prompt('Motivo del ajuste (obligatorio):')
                      if (!motivo || motivo.trim().length < 5) { alert('MOTIVO OBLIGATORIO'); return }
                      const sepAmt = Math.round((Number(sale.total_sale_price) - Number(sale.initial_amount_paid) - Number(sale.financed_amount)) * 100) / 100
                      const pagadoCuotas = detail.inst.reduce((x, i) => x + Number(i.amount_paid), 0)
                      const pendientes = detail.inst.filter(i => i.status !== 'pagado')
                      const restante = Math.round((nuevo - Number(sale.initial_amount_paid) - sepAmt - pagadoCuotas) * 100) / 100
                      if (restante < 0) { alert('EL NUEVO PRECIO ES MENOR A LO YA PAGADO. NO PROCEDE.'); return }
                      if (!pendientes.length) { alert('NO HAY CUOTAS PENDIENTES PARA REDISTRIBUIR.'); return }
                      if (!confirm(`Nuevo precio: S/ ${nuevo}\nYa pagado: S/ ${(Number(sale.initial_amount_paid) + sepAmt + pagadoCuotas).toFixed(2)}\nSaldo a repartir en ${pendientes.length} cuotas: S/ ${restante.toFixed(2)} (aprox S/ ${(restante / pendientes.length).toFixed(2)} c/u)\n\nMOTIVO: ${motivo}\n\nConfirmar?`)) return
                      const share = Math.floor(restante / pendientes.length * 100) / 100
                      let acum = 0
                      for (let i = 0; i < pendientes.length; i++) {
                        const q = pendientes[i]
                        const extra = i === pendientes.length - 1 ? Math.round((restante - acum) * 100) / 100 : share
                        acum += extra
                        await supabase.from('installments').update({ amount: Math.round((Number(q.amount_paid) + extra) * 100) / 100 }).eq('id', q.id)
                      }
                      await supabase.from('sales').update({
                        total_sale_price: nuevo,
                        financed_amount: Math.round((nuevo - Number(sale.initial_amount_paid) - sepAmt) * 100) / 100,
                        monthly_amount: share,
                      }).eq('id', sale.id)
                      alert('PRECIO AJUSTADO. MOTIVO REGISTRADO EN BITACORA: ' + motivo.toUpperCase())
                      setSel(x => ({ ...x }))
                    }}>Ajustar precio de la venta (admin)</button></p>
                  )}
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
