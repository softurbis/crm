import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'

const CAMPOS = [
  ['doc_number', 'DNI / Documento'], ['full_name', 'Nombres completos'],
  ['phone', 'Celular'], ['address', 'Direccion'], ['district', 'Distrito'],
  ['province', 'Provincia'], ['department', 'Departamento'], ['civil_status', 'Estado civil'],
]
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })

export default function Clients() {
  const { role } = useAuth()
  const { projects } = useProject()
  const readOnly = role === 'manager'
  const allowed = useMemo(() => new Set(projects.map(p => p.id)), [projects])
  const nombreProy = id => projects.find(p => p.id === id)?.name || 'OTRO PROYECTO'
  const [allProjects, setAllProjects] = useState([])
  const [list, setList] = useState([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)
  const [form, setForm] = useState({})
  const [msg, setMsg] = useState(null)
  const [nuevo, setNuevo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [docType, setDocType] = useState('DNI')
  const [fFrente, setFFrente] = useState(null)
  const [fReverso, setFReverso] = useState(null)
  const [cta, setCta] = useState(null)       // cliente del estado de cuenta
  const [ctaData, setCtaData] = useState(null)

  async function load() {
    const [{ data, error }, prj] = await Promise.all([
      supabase.from('clients')
        .select('*, sales!sales_client_id_fkey(id, status, lot:lots(project_id)), separations(id, status, lot:lots(project_id))')
        .order('full_name'),
      supabase.from('projects').select('id, name').order('created_at'),
    ])
    if (error) setMsg({ ok: false, t: 'Error al listar: ' + error.message })
    setList(data || [])
    setAllProjects(prj.data || [])
  }

  // proyectos a los que esta vinculado un cliente (ventas + separaciones vigentes)
  function proysDe(c) {
    const ids = new Set()
    for (const s of (c.sales || [])) if (s.lot?.project_id) ids.add(s.lot.project_id)
    for (const sp of (c.separations || [])) if (sp.status === 'vigente' && sp.lot?.project_id) ids.add(sp.lot.project_id)
    return [...ids]
  }
  const nombreProyFull = id => allProjects.find(p => p.id === id)?.name || 'PROYECTO'
  useEffect(() => { load() }, [])

  // ---- estado de cuenta: ventas + cuotas + pagos con voucher ----
  useEffect(() => {
    if (!cta) { setCtaData(null); return }
    async function loadCta() {
      const [v, p] = await Promise.all([
        supabase.from('sales')
          .select('id, total_sale_price, initial_amount_paid, status, sale_date, installments_count, lot:lots(mz,lt,project_id), installments(installment_number, due_date, amount, amount_paid, status)')
          .eq('client_id', cta.id).order('sale_date'),
        supabase.from('daily_income')
          .select('date, amount, income_type, operation_number, voucher_url, observation, lot:lots(mz,lt,project_id), installment:installments(installment_number)')
          .eq('client_id', cta.id).order('date'),
      ])
      const ventas = (v.data || []).filter(x => x.lot?.project_id && allowed.has(x.lot.project_id))
      const pagos = (p.data || []).filter(x => !x.lot?.project_id || allowed.has(x.lot.project_id))
      setCtaData({ ventas, pagos, ocultas: (v.data || []).length - ventas.length })
    }
    loadCta()
  }, [cta])

  const filtrada = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return list
    return list.filter(c =>
      c.full_name?.toLowerCase().includes(t) ||
      c.doc_number?.toLowerCase().includes(t) ||
      (c.phone || '').replace(/\s/g, '').includes(t.replace(/\s/g, '')))
  }, [list, q])

  const pendientes = list.filter(c => c.doc_type === 'PEND').length
  const telInvalidos = list.filter(c => !c.phone_valid).length

  function abrir(c) {
    setSel(c); setNuevo(!c.id)
    setForm(Object.fromEntries(CAMPOS.map(([k]) => [k, c[k] || ''])))
    setDocType(['DNI', 'CE', 'PASAPORTE', 'RUC'].includes(c.doc_type) ? c.doc_type : 'DNI')
    setFFrente(null); setFReverso(null); setMsg(null)
  }

  async function subirFoto(file, cara, doc) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `dni/${doc}-${cara}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('urbis-files').upload(path, file, { upsert: true })
    if (error) throw new Error('No se pudo subir la foto (' + cara + '): ' + error.message + '. Verifica el bucket urbis-files en Supabase Storage.')
    return supabase.storage.from('urbis-files').getPublicUrl(path).data.publicUrl
  }

  async function guardar(e) {
    e.preventDefault()
    if (nuevo && (!fFrente || !fReverso)) {
      setMsg({ ok: false, t: 'OBLIGATORIO: sube la foto del DNI por ambas caras.' }); return
    }
    setBusy(true); setMsg(null)
    try {
      const doc = form.doc_number.trim().toUpperCase()
      let front = sel?.dni_front_url || null
      let back = sel?.dni_back_url || null
      if (fFrente) front = await subirFoto(fFrente, 'frente', doc)
      if (fReverso) back = await subirFoto(fReverso, 'reverso', doc)
      const tel = (form.phone || '').replace(/\D/g, '')
      const payload = {}
      for (const [k] of CAMPOS) payload[k] = (form[k] || '').toUpperCase().trim() || null
      Object.assign(payload, {
        doc_number: doc,
        dni_front_url: front, dni_back_url: back,
        phone: form.phone || null,
        phone_valid: tel.length >= 9 && !tel.includes('999999999'),
        doc_type: doc.startsWith('PEND') ? 'PEND' : docType,
      })
      const r = nuevo
        ? await supabase.from('clients').insert(payload)
        : await supabase.from('clients').update(payload).eq('id', sel.id)
      if (r.error) throw new Error(r.error.message)
      setMsg({ ok: true, t: 'GUARDADO CORRECTAMENTE' })
      await load()
      if (nuevo) setSel(null)
    } catch (err) { setMsg({ ok: false, t: err.message }) }
    setBusy(false)
  }

  return (
    <>
      <h1>Clientes</h1>

      <div className="toolbar">
        <input className="search" placeholder="Buscar por nombre, DNI o celular..."
          value={q} onChange={e => setQ(e.target.value)} />
        {!readOnly && <button className="btn-primary" onClick={() => abrir({})}>+ Nuevo cliente</button>}
      </div>

      {(pendientes > 0 || telInvalidos > 0) && (
        <p className="hint">
          {pendientes > 0 && <>&#9888; {pendientes} con DNI pendiente. </>}
          {telInvalidos > 0 && <>&#128245; {telInvalidos} sin celular valido (WhatsApp bloqueado).</>}
        </p>
      )}

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Documento</th><th>Nombres</th><th>Celular</th><th>DNI foto</th><th>Proyectos</th><th>Lotes</th><th></th></tr></thead>
          <tbody>
            {filtrada.map(c => (
              <tr key={c.id}>
                <td>{c.doc_type === 'PEND' ? <span className="bad">&#9888; {c.doc_number}</span> : c.doc_number}</td>
                <td>{c.full_name}</td>
                <td>{c.phone_valid ? c.phone : <span className="bad">{c.phone || 'sin celular'}</span>}</td>
                <td>{c.dni_front_url && c.dni_back_url ? <span className="ok">completo</span> : <span className="warn">falta</span>}</td>
                <td>
                  {proysDe(c).length === 0 ? <span className="muted">-</span> : proysDe(c).map(pid => (
                    <span key={pid} className="st-chip" title={allowed.has(pid) ? nombreProyFull(pid) : nombreProyFull(pid) + ' (no asignado a tu usuario: solo referencia)'}
                      style={{ marginRight: 4, marginBottom: 2, display: 'inline-block', fontSize: '.68rem', opacity: allowed.has(pid) ? 1 : .45 }}>
                      {!allowed.has(pid) && <>&#128274; </>}{nombreProyFull(pid)}
                    </span>
                  ))}
                </td>
                <td>{c.sales?.length || 0}</td>
                <td>
                  <button className="btn-ghost" onClick={() => abrir(c)}>{readOnly ? 'ver' : 'editar'}</button>{' '}
                  {(c.sales?.length || 0) > 0 &&
                    <button className="btn-ghost" onClick={() => setCta(c)}>estado de cuenta</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ------- modal editar / nuevo ------- */}
      {sel !== null && (
        <div className="modal-bg" onClick={() => !busy && setSel(null)}>
          <div className="glass modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{nuevo ? 'Nuevo cliente' : sel.full_name}</h2>
              <button className="btn-ghost" onClick={() => setSel(null)}>&#10005;</button>
            </div>
            <form onSubmit={guardar} className="form-grid">
              <label>Tipo de documento
                <select value={docType} onChange={e => setDocType(e.target.value)}>
                  <option value="DNI">DNI</option>
                  <option value="CE">CARNET DE EXTRANJERIA</option>
                  <option value="PASAPORTE">PASAPORTE</option>
                  <option value="RUC">RUC</option>
                </select>
              </label>
              {CAMPOS.map(([k, label]) => (
                <label key={k} className={k === 'full_name' || k === 'address' ? 'span2' : ''}>
                  {label}
                  <input value={form[k] || ''} required={['doc_number', 'full_name'].includes(k)} disabled={readOnly}
                    onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
                </label>
              ))}
              <label>DNI - frente {nuevo && !readOnly && <b className="bad">(obligatorio)</b>}
                {!readOnly && <input type="file" accept="image/*,.pdf" onChange={e => setFFrente(e.target.files[0] || null)} />}
                {!nuevo && sel.dni_front_url && <a href={sel.dni_front_url} target="_blank" rel="noreferrer" title="Abrir en alta calidad"><img className="thumb" src={sel.dni_front_url} alt="DNI frente" /></a>}
              </label>
              <label>DNI - reverso {nuevo && !readOnly && <b className="bad">(obligatorio)</b>}
                {!readOnly && <input type="file" accept="image/*,.pdf" onChange={e => setFReverso(e.target.files[0] || null)} />}
                {!nuevo && sel.dni_back_url && <a href={sel.dni_back_url} target="_blank" rel="noreferrer" title="Abrir en alta calidad"><img className="thumb" src={sel.dni_back_url} alt="DNI reverso" /></a>}
              </label>
              <div className="span2">
                {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
                {!readOnly && <button className="btn-primary" disabled={busy}>{busy ? 'Guardando...' : 'Guardar'}</button>}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------- estado de cuenta (imprimible / PDF) ------- */}
      {cta && (
        <div className="modal-bg" onClick={() => setCta(null)}>
          <div className="glass modal print-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head no-print">
              <h2>Estado de cuenta</h2>
              <button className="btn-primary" onClick={() => window.print()}>Exportar PDF</button>
              <button className="btn-ghost" onClick={() => setCta(null)}>&#10005;</button>
            </div>

            <div className="print-area">
              <h2>URBIS GROUP - ESTADO DE CUENTA</h2>
              <p><b>{cta.full_name}</b> | {cta.doc_type} {cta.doc_number} | CEL: {cta.phone || '-'}</p>
              <p className="small">EMITIDO: {new Date().toLocaleDateString('es-PE')}{ctaData && ctaData.ventas.length > 0 && <> - {[...new Set(ctaData.ventas.map(v => v.lot?.project_id).filter(Boolean))].map(nombreProyFull).join(' / ')}</>}</p>
              {ctaData && ctaData.ocultas > 0 && (
                <p className="hint no-print">&#128274; Este cliente tiene {ctaData.ocultas} venta(s) en proyectos NO asignados a tu usuario — no se muestran aqui.</p>
              )}

              {!ctaData ? <p>Cargando...</p> : ctaData.ventas.map(v => {
                const cuotasPag = v.installments.filter(i => i.status === 'pagado').length
                const pagadoCuotas = v.installments.reduce((s, i) => s + Number(i.amount_paid), 0)
                const totalPagado = pagadoCuotas + Number(v.initial_amount_paid)
                const saldo = Number(v.total_sale_price) - totalPagado
                const vencidas = v.installments.filter(i => i.status === 'vencido')
                return (
                  <div key={v.id}>
                    <hr />
                    <h3>LOTE MZ {v.lot?.mz} LT {v.lot?.lt} ({v.status})</h3>
                    <p>
                      PRECIO: <b>{soles(v.total_sale_price)}</b> | INICIAL: {soles(v.initial_amount_paid)} |
                      PAGADO: <b>{soles(totalPagado)}</b> | SALDO: <b>{soles(saldo)}</b>
                    </p>
                    <p>
                      CUOTAS: {cuotasPag} pagadas de {v.installments_count}
                      {vencidas.length > 0 && <b> | {vencidas.length} VENCIDAS ({soles(vencidas.reduce((s, i) => s + Number(i.amount) - Number(i.amount_paid), 0))})</b>}
                    </p>
                    <table>
                      <thead><tr><th>N</th><th>Vence</th><th>Monto</th><th>Pagado</th><th>Estado</th></tr></thead>
                      <tbody>
                        {v.installments.sort((a, b) => a.installment_number - b.installment_number).map(i => (
                          <tr key={i.installment_number}>
                            <td>{i.installment_number}</td>
                            <td>{i.due_date}</td>
                            <td>{soles(i.amount)}</td>
                            <td>{Number(i.amount_paid) > 0 ? soles(i.amount_paid) : '-'}</td>
                            <td>{i.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })}

              {ctaData && ctaData.pagos.length > 0 && (<>
                <hr />
                <h3>HISTORIAL DE PAGOS ({ctaData.pagos.length})</h3>
                <table>
                  <thead><tr><th>Fecha</th><th>Lote</th><th>Concepto</th><th>N Operacion</th><th>Monto</th><th>Voucher</th></tr></thead>
                  <tbody>
                    {ctaData.pagos.map((p, i) => (
                      <tr key={i}>
                        <td>{p.date}</td>
                        <td>{p.lot ? `${p.lot.mz}-${p.lot.lt}` : '-'}</td>
                        <td>{p.income_type}{p.installment ? ' N' + p.installment.installment_number : ''}</td>
                        <td>{p.operation_number}</td>
                        <td>{soles(p.amount)}</td>
                        <td>{p.voucher_url ? <a href={p.voucher_url} target="_blank" rel="noreferrer">VER</a> : <span className="no-print">pendiente</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p><b>TOTAL PAGADO: {soles(ctaData.pagos.reduce((s, p) => s + Number(p.amount), 0))}</b></p>
              </>)}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
