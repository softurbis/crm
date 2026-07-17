import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'

// 'phone' se maneja aparte (abajo): son 2 celulares, cada uno con nota y check de bot.
const CAMPOS = [
  ['doc_number', 'DNI / Documento'], ['full_name', 'Nombres completos'],
  ['address', 'Direccion'], ['district', 'Distrito'],
  ['province', 'Provincia'], ['department', 'Departamento'], ['civil_status', 'Estado civil'],
]
// [campo del numero, campo de la nota, campo del check de bot, etiqueta]
const CELULARES = [
  ['phone', 'phone_note', 'phone_bot', 'Celular principal'],
  ['phone2', 'phone2_note', 'phone2_bot', 'Celular 2 (opcional)'],
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
  const [fproj, setFproj] = useState('todos') // filtro por proyecto

  async function load() {
    const [{ data, error }, prj] = await Promise.all([
      supabase.from('clients')
        .select('*, sales!sales_client_id_fkey(id, status, lot:lots(mz, lt, project_id)), separations(id, status, lot:lots(mz, lt, project_id))')
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
  // lotes del cliente agrupados por proyecto: { project_id: ['G-7', 'H-3 (exp)'] }
  function lotesDe(c) {
    const m = {}
    for (const s of (c.sales || [])) {
      const pid = s.lot?.project_id
      if (!pid || !s.lot?.mz) continue
      ;(m[pid] = m[pid] || []).push(`${s.lot.mz}-${s.lot.lt}` + (s.status === 'expropiado' ? ' ⚠' : ''))
    }
    return m
  }
  useEffect(() => { load() }, [])

  // ---- estado de cuenta: ventas + cuotas + pagos con voucher ----
  useEffect(() => {
    if (!cta) { setCtaData(null); return }
    async function loadCta() {
      const [v, p] = await Promise.all([
        supabase.from('sales')
          .select('id, total_sale_price, initial_amount_paid, financed_amount, status, sale_date, installments_count, lot:lots(mz,lt,project_id,associated_to), installments(installment_number, due_date, amount, amount_paid, status)')
          .eq('client_id', cta.id).order('sale_date'),
        supabase.from('daily_income')
          .select('date, amount, income_type, operation_number, voucher_url, observation, sale_id, lot:lots(mz,lt,project_id), installment:installments(installment_number)')
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
    return list.filter(c => {
      if (fproj !== 'todos' && !proysDe(c).includes(fproj)) return false
      if (!t) return true
      // lotes del cliente en varias formas: "G7", "G-7", "mz g lt 7"
      const lotes = (c.sales || []).map(s => s.lot?.mz
        ? `${s.lot.mz}${s.lot.lt} ${s.lot.mz}-${s.lot.lt} mz ${s.lot.mz} lt ${s.lot.lt}` : '').join(' ').toLowerCase()
      return c.full_name?.toLowerCase().includes(t) ||
        c.doc_number?.toLowerCase().includes(t) ||
        lotes.includes(t) ||
        (c.phone || '').replace(/\s/g, '').includes(t.replace(/\s/g, ''))
    })
  }, [list, q, fproj])

  const pendientes = list.filter(c => c.doc_type === 'PEND').length
  const telInvalidos = list.filter(c => !c.phone_valid).length

  function abrir(c) {
    setSel(c); setNuevo(!c.id)
    setForm({
      ...Object.fromEntries(CAMPOS.map(([k]) => [k, c[k] || ''])),
      phone: c.phone || '', phone_note: c.phone_note || '', phone_bot: c.phone_bot !== false,
      phone2: c.phone2 || '', phone2_note: c.phone2_note || '', phone2_bot: !!c.phone2_bot,
      dni_front_note: c.dni_front_note || '', dni_back_note: c.dni_back_note || '',
    })
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
      const valido = v => { const t = (v || '').replace(/\D/g, ''); return t.length >= 9 && !t.includes('999999999') }
      const payload = {}
      for (const [k] of CAMPOS) payload[k] = (form[k] || '').toUpperCase().trim() || null
      Object.assign(payload, {
        doc_number: doc,
        dni_front_url: front, dni_back_url: back,
        dni_front_note: (form.dni_front_note || '').trim() || null,
        dni_back_note: (form.dni_back_note || '').trim() || null,
        phone: form.phone || null,
        phone_valid: valido(form.phone),
        phone_note: (form.phone_note || '').trim() || null,
        phone_bot: form.phone_bot !== false,
        phone2: form.phone2 || null,
        phone2_valid: valido(form.phone2),
        phone2_note: (form.phone2_note || '').trim() || null,
        phone2_bot: !!form.phone2_bot,
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

      <div className="filtros">
        <input className="search fx-search" placeholder="Buscar por nombre, DNI, celular o lote (G-7)..."
          value={q} onChange={e => setQ(e.target.value)} />
        <select className={`fx-sel ${fproj !== 'todos' ? 'on' : ''}`} value={fproj} onChange={e => setFproj(e.target.value)}>
          <option value="todos">🏗️ Proyecto: todos</option>
          {allProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {(q || fproj !== 'todos') && <button className="fx-clear" onClick={() => { setQ(''); setFproj('todos') }} title="Quitar filtros">✕ Limpiar</button>}
        {!readOnly && <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={() => abrir({})}>+ Nuevo cliente</button>}
      </div>
      <p className="muted small" style={{ margin: '0 0 10px' }}>{filtrada.length} de {list.length} clientes{fproj !== 'todos' ? ' en ' + nombreProyFull(fproj) : ''}</p>

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
                <td>{c.full_name}
                  {(c.sales || []).some(s => s.status === 'expropiado') &&
                    <span className="bad" style={{ marginLeft: 6, fontSize: '.66rem', fontWeight: 700 }}>&#9888; EXPROPIADO</span>}
                </td>
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
                <td>{(() => {
                  const porProy = lotesDe(c)
                  // con filtro activo: solo los lotes de ese proyecto; sin filtro: todos, agrupados
                  const entradas = fproj !== 'todos'
                    ? (porProy[fproj] ? [[fproj, porProy[fproj]]] : [])
                    : Object.entries(porProy)
                  if (!entradas.length) return <span className="muted">-</span>
                  return entradas.map(([pid, lotes]) => (
                    <span key={pid} style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 3, marginRight: 6 }} title={nombreProyFull(pid)}>
                      {lotes.map((l, i) => <span key={i} className="lote-chip">{l}</span>)}
                    </span>
                  ))
                })()}</td>
                <td>
                  <div className="acc-row">
                    <button className="btn-act" onClick={() => abrir(c)}>{readOnly ? '👁️ Ver' : '✏️ Editar'}</button>
                    {(c.sales?.length || 0) > 0 &&
                      <button className="btn-act alt" onClick={() => setCta(c)}>📄 Estado de cuenta</button>}
                  </div>
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
              {/* 2 celulares: cada uno con su comentario y su check de "lo usa el bot" */}
              <div className="span2" style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, padding: '8px 10px' }}>
                <span className="muted small">CELULARES — marca cual(es) usa el bot de WhatsApp para cobranza. Un numero sin marcar (o invalido) no recibe nada del bot.</span>
                {CELULARES.map(([kp, kn, kb, label]) => (
                  <div key={kp} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}>
                    <label style={{ flex: '0 1 150px' }}>{label}
                      <input value={form[kp] || ''} disabled={readOnly}
                        onChange={e => setForm(f => ({ ...f, [kp]: e.target.value }))} />
                    </label>
                    <label style={{ flex: '1 1 200px' }}>Comentario
                      <input value={form[kn] || ''} disabled={readOnly} placeholder="ej: es el celular de la esposa"
                        style={{ textTransform: 'none' }}
                        onChange={e => setForm(f => ({ ...f, [kn]: e.target.value }))} />
                    </label>
                    <label style={{ flex: '0 0 auto', display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer', paddingBottom: 7, whiteSpace: 'nowrap' }}>
                      <input type="checkbox" checked={!!form[kb]} disabled={readOnly}
                        onChange={e => setForm(f => ({ ...f, [kb]: e.target.checked }))} /> usa el bot
                    </label>
                  </div>
                ))}
              </div>
              <label>DNI - frente {nuevo && !readOnly && <b className="bad">(obligatorio)</b>}
                {!readOnly && <input type="file" accept="image/*,.pdf" onChange={e => setFFrente(e.target.files[0] || null)} />}
                {!readOnly && <input value={form.dni_front_note || ''} placeholder="nota / comentario del documento"
                  style={{ textTransform: 'none', marginTop: 4 }}
                  onChange={e => setForm(f => ({ ...f, dni_front_note: e.target.value }))} />}
                {!nuevo && sel.dni_front_url && <a href={sel.dni_front_url} target="_blank" rel="noreferrer" title="Abrir en alta calidad"><img className="thumb" src={sel.dni_front_url} alt="DNI frente" /></a>}
              </label>
              <label>DNI - reverso {nuevo && !readOnly && <b className="bad">(obligatorio)</b>}
                {!readOnly && <input type="file" accept="image/*,.pdf" onChange={e => setFReverso(e.target.files[0] || null)} />}
                {!readOnly && <input value={form.dni_back_note || ''} placeholder="nota / comentario del documento"
                  style={{ textTransform: 'none', marginTop: 4 }}
                  onChange={e => setForm(f => ({ ...f, dni_back_note: e.target.value }))} />}
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
                // separación/inicial REALES desde caja (mismo criterio que el desglosado del lote):
                // se prefiere el pago registrado; si no hay, la separación se deriva y la inicial usa el campo.
                const pagosV = (ctaData.pagos || []).filter(p => p.sale_id === v.id)
                const sepPagos = pagosV.filter(p => (p.income_type || '') === 'separacion')
                const iniPagos = pagosV.filter(p => (p.income_type || '') === 'inicial')
                const sepDeriv = Math.max(0, Math.round((Number(v.total_sale_price) - Number(v.initial_amount_paid) - Number(v.financed_amount || 0)) * 100) / 100)
                const sepReal = sepPagos.length ? sepPagos.reduce((s, p) => s + Number(p.amount), 0) : sepDeriv
                const iniReal = iniPagos.length ? iniPagos.reduce((s, p) => s + Number(p.amount), 0) : Number(v.initial_amount_paid)
                const totalPagado = Math.round((pagadoCuotas + iniReal + sepReal) * 100) / 100
                const saldo = Math.round((Number(v.total_sale_price) - totalPagado) * 100) / 100
                const vencidas = v.installments.filter(i => i.status === 'vencido')
                const fFecha = f => f ? f.split('-').reverse().join('/') : '-'
                return (
                  <div key={v.id}>
                    <hr />
                    <h3>{(v.lot?.associated_to || '').startsWith('VENTA CONJUNTA')
                      ? v.lot.associated_to.split(' (')[0]
                      : `LOTE MZ ${v.lot?.mz} LT ${v.lot?.lt}`} ({v.status})</h3>
                    <p>
                      PRECIO: <b>{soles(v.total_sale_price)}</b> | SEPARACIÓN: {soles(sepReal)} | INICIAL: {soles(iniReal)} |
                      PAGADO: <b>{soles(totalPagado)}</b> | SALDO: <b>{soles(saldo)}</b>
                    </p>
                    <p>
                      CUOTAS: {cuotasPag} pagadas de {v.installments_count}
                      {vencidas.length > 0 && <b> | {vencidas.length} VENCIDAS ({soles(vencidas.reduce((s, i) => s + Number(i.amount) - Number(i.amount_paid), 0))})</b>}
                    </p>
                    <table>
                      <thead><tr><th>N</th><th>Vence</th><th>Monto</th><th>Pagado</th><th>Estado</th></tr></thead>
                      <tbody>
                        {/* fila de SEPARACIÓN (pago real, o el derivado si no hay registro) */}
                        {(sepPagos.length ? sepPagos.map((p, k) => ({ k: 'sep' + k, f: p.date, m: p.amount })) : (sepReal > 0 ? [{ k: 'sep', f: null, m: sepReal }] : [])).map(r => (
                          <tr key={r.k} style={{ background: 'rgba(80,160,120,.10)' }}>
                            <td><b>SEP.</b></td><td>{fFecha(r.f)}</td><td>{soles(r.m)}</td><td>{soles(r.m)}</td><td>PAGADO</td>
                          </tr>
                        ))}
                        {/* fila de INICIAL */}
                        {(iniPagos.length ? iniPagos.map((p, k) => ({ k: 'ini' + k, f: p.date, m: p.amount })) : (iniReal > 0 ? [{ k: 'ini', f: null, m: iniReal }] : [])).map(r => (
                          <tr key={r.k} style={{ background: 'rgba(80,160,120,.10)' }}>
                            <td><b>INICIAL</b></td><td>{fFecha(r.f)}</td><td>{soles(r.m)}</td><td>{soles(r.m)}</td><td>PAGADO</td>
                          </tr>
                        ))}
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
