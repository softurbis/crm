import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const hoy = () => new Date().toISOString().slice(0, 10)

async function subirRH(id, file) {
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
  const path = `rh/${id}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('urbis-files').upload(path, file, { upsert: true })
  if (error) throw new Error('Error al subir RH: ' + error.message)
  return supabase.storage.from('urbis-files').getPublicUrl(path).data.publicUrl
}

export default function Commissions() {
  const { role } = useAuth()
  const { pidOp } = useProject()
  const canEdit = ['superuser', 'admin'].includes(role)
  const [rows, setRows] = useState([])
  const [ventasSin, setVentasSin] = useState([])
  const [advisors, setAdvisors] = useState([])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const [q, setQ] = useState('')
  const [fEst, setFEst] = useState('todos')
  const [fAdv, setFAdv] = useState('todos')

  const [advOpen, setAdvOpen] = useState(false)
  const [nCode, setNCode] = useState('')
  const [nName, setNName] = useState('')
  const [advEdit, setAdvEdit] = useState(null)

  const [pay, setPay] = useState(null)
  const [rhNum, setRhNum] = useState('')
  const [rhFile, setRhFile] = useState(null)
  const [payDate, setPayDate] = useState(hoy())

  const [amtEdit, setAmtEdit] = useState(null)
  const [addSale, setAddSale] = useState(null)
  const [addMonto, setAddMonto] = useState('')

  async function load() {
    const [c, a] = await Promise.all([
      pidOp
        ? supabase.from('commissions')
            .select('*, advisor:advisors(id, code, full_name), sale:sales!inner(id, sale_date, total_sale_price, client:clients!sales_client_id_fkey(full_name), lot:lots!inner(mz, lt, project_id))')
            .eq('sale.lot.project_id', pidOp)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase.from('advisors').select('*').order('code'),
    ])
    setRows(c.data || [])
    setAdvisors(a.data || [])
    if (pidOp) {
      const ids = (c.data || []).map(x => x.sale_id)
      const { data: v } = await supabase.from('sales')
        .select('id, sale_date, total_sale_price, advisor_id, advisor:advisors(code), client:clients!sales_client_id_fkey(full_name), lot:lots!inner(mz, lt, project_id)')
        .eq('lot.project_id', pidOp).in('status', ['en_proceso', 'pagado'])
        .order('sale_date', { ascending: false })
      setVentasSin((v || []).filter(s => !ids.includes(s.id)))
    }
  }
  useEffect(() => { load() }, [pidOp])

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter(r => {
      if (fEst !== 'todos' && r.status !== fEst) return false
      if (fAdv !== 'todos' && r.advisor?.id !== fAdv) return false
      if (!t) return true
      const lote = r.sale?.lot ? `${r.sale.lot.mz}-${r.sale.lot.lt}`.toLowerCase() : ''
      return lote.includes(t) ||
        (r.sale?.client?.full_name || '').toLowerCase().includes(t) ||
        (r.advisor?.code || '').toLowerCase().includes(t) ||
        (r.rh_number || '').toLowerCase().includes(t)
    })
  }, [rows, q, fEst, fAdv])

  const totPend = filtradas.filter(r => r.status === 'pendiente').reduce((s, r) => s + Number(r.amount), 0)
  const totPag = filtradas.filter(r => r.status === 'pagada').reduce((s, r) => s + Number(r.amount), 0)

  const porAsesor = useMemo(() => {
    const m = {}
    for (const r of rows) {
      const k = r.advisor?.code || 'SIN ASESOR'
      m[k] = m[k] || { n: 0, total: 0, pend: 0, pag: 0 }
      m[k].n++
      m[k].total += Number(r.amount)
      if (r.status === 'pagada') m[k].pag += Number(r.amount)
      else m[k].pend += Number(r.amount)
    }
    return Object.entries(m).sort((x, y) => y[1].total - x[1].total)
  }, [rows])

  async function crearAsesor(e) {
    e.preventDefault()
    if (!nCode.trim()) return
    const { error } = await supabase.from('advisors').insert({ code: nCode.trim().toUpperCase(), full_name: (nName.trim() || nCode.trim()).toUpperCase(), active: true })
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: 'ASESOR CREADO' })
    setNCode(''); setNName(''); load()
  }

  async function guardarAsesor() {
    const { error } = await supabase.from('advisors').update({ code: advEdit.code.trim().toUpperCase(), full_name: (advEdit.full_name || '').trim().toUpperCase() }).eq('id', advEdit.id)
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: 'ASESOR ACTUALIZADO' })
    setAdvEdit(null); load()
  }

  async function toggleAsesor(a) {
    await supabase.from('advisors').update({ active: !a.active }).eq('id', a.id)
    load()
  }

  async function borrarAsesor(a) {
    if (!confirm(`Eliminar al asesor ${a.code}? Solo se puede si no tiene ventas ni leads asociados.`)) return
    const { error } = await supabase.from('advisors').delete().eq('id', a.id)
    setMsg(error
      ? { ok: false, t: 'NO SE PUDO ELIMINAR (tiene registros asociados). Puedes DESACTIVARLO.' }
      : { ok: true, t: 'ASESOR ELIMINADO' })
    load()
  }

  async function marcarPagada(e) {
    e.preventDefault()
    if (!rhNum.trim()) { setMsg({ ok: false, t: 'INGRESA EL NUMERO DE RH (RECIBO POR HONORARIOS).' }); return }
    setBusy(true)
    try {
      let url = pay.rh_url || null
      if (rhFile) url = await subirRH(pay.id, rhFile)
      const { error } = await supabase.from('commissions').update({
        status: 'pagada', rh_number: rhNum.trim().toUpperCase(), rh_url: url, paid_date: payDate,
      }).eq('id', pay.id)
      if (error) throw error
      setMsg({ ok: true, t: 'COMISION MARCADA COMO PAGADA' })
      setPay(null); setRhNum(''); setRhFile(null); load()
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + (err.message || err) }) }
    setBusy(false)
  }

  async function volverPendiente(r) {
    if (!confirm('Volver esta comision a PENDIENTE? Se conserva el RH registrado.')) return
    await supabase.from('commissions').update({ status: 'pendiente', paid_date: null }).eq('id', r.id)
    load()
  }

  async function guardarMonto() {
    const { error } = await supabase.from('commissions').update({ amount: Number(amtEdit.amount || 0) }).eq('id', amtEdit.id)
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: 'MONTO ACTUALIZADO' })
    setAmtEdit(null); load()
  }

  async function agregarComision(e) {
    e.preventDefault()
    const { error } = await supabase.from('commissions').insert({
      sale_id: addSale.id, advisor_id: addSale.advisor_id || null,
      amount: Number(addMonto || 0), status: 'pendiente',
    })
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: 'COMISION REGISTRADA' })
    setAddSale(null); setAddMonto(''); load()
  }

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Comisiones</h1>
        <ProjectPicker />
        {canEdit && (
          <button className="btn-ghost" onClick={() => setAdvOpen(!advOpen)}>
            {advOpen ? 'Cerrar asesores' : 'Vendedores / asesores'}
          </button>
        )}
      </div>

      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      {advOpen && canEdit && (
        <div className="glass form-card" style={{ maxWidth: 'none' }}>
          <p><b>VENDEDORES / ASESORES</b> <span className="muted small">(no necesitan usuario del sistema, solo el nombre)</span></p>
          <form onSubmit={crearAsesor} className="form-grid">
            <label>Codigo corto <input value={nCode} onChange={e => setNCode(e.target.value)} placeholder="EJ: JUAN" required /></label>
            <label>Nombre completo <input value={nName} onChange={e => setNName(e.target.value)} placeholder="EJ: JUAN PEREZ RIOS" /></label>
            <div style={{ alignSelf: 'end' }}><button className="btn-primary">+ Agregar asesor</button></div>
          </form>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Codigo</th><th>Nombre</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {advisors.map(a => (
                  <tr key={a.id} style={a.active ? {} : { opacity: .45 }}>
                    {advEdit?.id === a.id ? (<>
                      <td><input value={advEdit.code} onChange={e => setAdvEdit({ ...advEdit, code: e.target.value })} style={{ width: '7em' }} /></td>
                      <td><input value={advEdit.full_name || ''} onChange={e => setAdvEdit({ ...advEdit, full_name: e.target.value })} /></td>
                      <td colSpan="2">
                        <button className="btn-primary" onClick={guardarAsesor}>Guardar</button>{' '}
                        <button className="btn-ghost" onClick={() => setAdvEdit(null)}>Cancelar</button>
                      </td>
                    </>) : (<>
                      <td><b>{a.code}</b></td>
                      <td>{a.full_name}</td>
                      <td>{a.active ? <span className="ok">ACTIVO</span> : <span className="muted">INACTIVO</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="link-btn" onClick={() => setAdvEdit({ ...a })}>editar</button>{' | '}
                        <button className="link-btn" onClick={() => toggleAsesor(a)}>{a.active ? 'desactivar' : 'activar'}</button>{' | '}
                        <button className="link-btn bad" onClick={() => borrarAsesor(a)}>eliminar</button>
                      </td>
                    </>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="chips">
        <span className="chip on">PENDIENTE: {soles(totPend)}</span>
        <span className="chip">PAGADO: {soles(totPag)}</span>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Buscar por lote, cliente, asesor o RH..." value={q} onChange={e => setQ(e.target.value)} />
        <select value={fEst} onChange={e => setFEst(e.target.value)}>
          <option value="todos">ESTADO: TODOS</option>
          <option value="pendiente">PENDIENTES</option>
          <option value="pagada">PAGADAS</option>
        </select>
        <select value={fAdv} onChange={e => setFAdv(e.target.value)}>
          <option value="todos">ASESOR: TODOS</option>
          {advisors.map(a => <option key={a.id} value={a.id}>{a.code}</option>)}
        </select>
      </div>

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Asesor</th><th>Lote</th><th>Cliente</th><th>Fecha venta</th><th>Venta</th><th>Comision</th><th>Estado</th><th>RH</th><th></th></tr></thead>
          <tbody>
            {filtradas.map(r => (
              <tr key={r.id}>
                <td><b>{r.advisor?.code || '-'}</b></td>
                <td>{r.sale?.lot ? `${r.sale.lot.mz}-${r.sale.lot.lt}` : '-'}</td>
                <td>{r.sale?.client?.full_name || '-'}</td>
                <td>{r.sale?.sale_date || '-'}</td>
                <td>{soles(r.sale?.total_sale_price)}</td>
                <td>
                  {amtEdit?.id === r.id ? (
                    <span style={{ whiteSpace: 'nowrap' }}>
                      <input type="number" step="0.01" value={amtEdit.amount} onChange={e => setAmtEdit({ ...amtEdit, amount: e.target.value })} style={{ width: '6.5em' }} />{' '}
                      <button className="link-btn ok" onClick={guardarMonto}>ok</button>{' '}
                      <button className="link-btn" onClick={() => setAmtEdit(null)}>x</button>
                    </span>
                  ) : (<>
                    <b>{soles(r.amount)}</b>
                    {canEdit && r.status !== 'pagada' && <>{' '}<button className="link-btn muted" onClick={() => setAmtEdit({ id: r.id, amount: r.amount })}>editar</button></>}
                  </>)}
                </td>
                <td>{r.status === 'pagada' ? <span className="st-chip st-ok">PAGADA</span> : <span className="st-chip st-per">PENDIENTE</span>}</td>
                <td>
                  {r.rh_number ? <>{r.rh_number}{r.rh_url && <>{' '}<a href={r.rh_url} target="_blank" rel="noreferrer">VER</a></>}<br /><span className="muted small">{r.paid_date || ''}</span></> : '-'}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {canEdit && r.status !== 'pagada' &&
                    <button className="btn-ghost" onClick={() => { setPay(r); setRhNum(r.rh_number || ''); setPayDate(hoy()) }}>Marcar pagada</button>}
                  {role === 'superuser' && r.status === 'pagada' &&
                    <button className="link-btn muted" onClick={() => volverPendiente(r)}>volver a pendiente</button>}
                </td>
              </tr>
            ))}
            {filtradas.length === 0 && <tr><td colSpan="9" className="muted">Sin comisiones registradas en este proyecto.</td></tr>}
          </tbody>
        </table>
      </div>

      {canEdit && ventasSin.length > 0 && (
        <div className="glass form-card" style={{ maxWidth: 'none' }}>
          <p><b>&#9888; VENTAS SIN COMISION REGISTRADA ({ventasSin.length})</b> <span className="muted small">Ventas antiguas: registra su comision aqui.</span></p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Lote</th><th>Cliente</th><th>Fecha</th><th>Asesor</th><th>Venta</th><th></th></tr></thead>
              <tbody>
                {ventasSin.slice(0, 50).map(s => (
                  <tr key={s.id}>
                    <td>{s.lot?.mz}-{s.lot?.lt}</td>
                    <td>{s.client?.full_name}</td>
                    <td>{s.sale_date}</td>
                    <td>{s.advisor?.code || <span className="muted">sin asesor</span>}</td>
                    <td>{soles(s.total_sale_price)}</td>
                    <td><button className="btn-ghost" onClick={() => { setAddSale(s); setAddMonto('') }}>+ Registrar comision</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h2 className="sub">Resumen por asesor</h2>
      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Asesor</th><th>Ventas</th><th>Total comisiones</th><th>Pendiente</th><th>Pagado</th></tr></thead>
          <tbody>
            {porAsesor.map(([k, v]) => (
              <tr key={k}><td><b>{k}</b></td><td>{v.n}</td><td>{soles(v.total)}</td><td className={v.pend > 0 ? 'warn' : ''}>{soles(v.pend)}</td><td className="ok">{soles(v.pag)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      {pay && (
        <div className="modal-bg" onClick={() => setPay(null)}>
          <form className="glass modal" onClick={e => e.stopPropagation()} onSubmit={marcarPagada}>
            <div className="modal-head">
              <h2>Pagar comision - {pay.advisor?.code}</h2>
              <button type="button" className="btn-ghost" onClick={() => setPay(null)}>&#10005;</button>
            </div>
            <p className="muted">Lote {pay.sale?.lot?.mz}-{pay.sale?.lot?.lt} | {pay.sale?.client?.full_name} | Comision: <b className="accent">{soles(pay.amount)}</b></p>
            <div className="form-grid">
              <label>N de RH (recibo por honorarios) <input value={rhNum} onChange={e => setRhNum(e.target.value)} placeholder="E001-123" required /></label>
              <label>Fecha de pago <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} required /></label>
              <label className="span2">Archivo del RH (foto o PDF, recomendado)
                <input type="file" accept="image/*,.pdf" onChange={e => setRhFile(e.target.files[0] || null)} />
              </label>
            </div>
            <button className="btn-primary" disabled={busy}>{busy ? 'Guardando...' : 'Confirmar pago de comision'}</button>
          </form>
        </div>
      )}

      {addSale && (
        <div className="modal-bg" onClick={() => setAddSale(null)}>
          <form className="glass modal" onClick={e => e.stopPropagation()} onSubmit={agregarComision}>
            <div className="modal-head">
              <h2>Comision - Lote {addSale.lot?.mz}-{addSale.lot?.lt}</h2>
              <button type="button" className="btn-ghost" onClick={() => setAddSale(null)}>&#10005;</button>
            </div>
            <p className="muted">{addSale.client?.full_name} | Venta: {soles(addSale.total_sale_price)} | Asesor: {addSale.advisor?.code || 'SIN ASESOR'}</p>
            <div className="form-grid">
              <label>Monto de la comision S/ <input type="number" step="0.01" min="0" value={addMonto} onChange={e => setAddMonto(e.target.value)} required autoFocus /></label>
            </div>
            <button className="btn-primary">Registrar comision pendiente</button>
          </form>
        </div>
      )}
    </>
  )
}
