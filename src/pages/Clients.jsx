import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const CAMPOS = [
  ['doc_number', 'DNI / Documento'], ['full_name', 'Nombres completos'],
  ['phone', 'Celular'], ['address', 'Direccion'], ['district', 'Distrito'],
  ['province', 'Provincia'], ['department', 'Departamento'], ['civil_status', 'Estado civil'],
]

export default function Clients() {
  const [list, setList] = useState([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)
  const [form, setForm] = useState({})
  const [ventas, setVentas] = useState([])
  const [msg, setMsg] = useState(null)
  const [nuevo, setNuevo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fFrente, setFFrente] = useState(null)
  const [fReverso, setFReverso] = useState(null)

  async function load() {
    const { data, error } = await supabase.from('clients')
      .select('*, sales!sales_client_id_fkey(id)').order('full_name')
    if (error) setMsg({ ok: false, t: 'Error al listar: ' + error.message })
    setList(data || [])
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!sel?.id) { setVentas([]); return }
    supabase.from('sales')
      .select('id, total_sale_price, status, sale_date, lot:lots(mz,lt), installments(amount_paid)')
      .eq('client_id', sel.id)
      .then(({ data }) => setVentas(data || []))
  }, [sel])

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
    setFFrente(null); setFReverso(null); setMsg(null)
  }

  async function subir(file, cara, doc) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `dni/${doc}-${cara}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('urbis-files').upload(path, file, { upsert: true })
    if (error) throw new Error('No se pudo subir la foto (' + cara + '): ' + error.message + '. Verifica que exista el bucket urbis-files en Supabase Storage.')
    return supabase.storage.from('urbis-files').getPublicUrl(path).data.publicUrl
  }

  async function guardar(e) {
    e.preventDefault()
    if (nuevo && (!fFrente || !fReverso)) {
      setMsg({ ok: false, t: 'Obligatorio: sube la foto del DNI por ambas caras.' }); return
    }
    setBusy(true); setMsg(null)
    try {
      const doc = form.doc_number.trim()
      let front = sel?.dni_front_url || null
      let back = sel?.dni_back_url || null
      if (fFrente) front = await subir(fFrente, 'frente', doc)
      if (fReverso) back = await subir(fReverso, 'reverso', doc)
      const tel = (form.phone || '').replace(/\D/g, '')
      const payload = {
        ...form, doc_number: doc,
        dni_front_url: front, dni_back_url: back,
        phone_valid: tel.length >= 9 && !tel.includes('999999999'),
        doc_type: /^\d{8}$/.test(doc) ? 'DNI' : (doc.startsWith('PEND') ? 'PEND' : (sel?.doc_type || 'DNI')),
      }
      const r = nuevo
        ? await supabase.from('clients').insert(payload)
        : await supabase.from('clients').update(payload).eq('id', sel.id)
      if (r.error) throw new Error(r.error.message)
      setMsg({ ok: true, t: 'Guardado correctamente' })
      await load()
      if (nuevo) setSel(null)
    } catch (err) {
      setMsg({ ok: false, t: err.message })
    }
    setBusy(false)
  }

  return (
    <>
      <h1>Clientes</h1>

      <div className="toolbar">
        <input className="search" placeholder="Buscar por nombre, DNI o celular..."
          value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn-primary" onClick={() => abrir({})}>+ Nuevo cliente</button>
      </div>

      {(pendientes > 0 || telInvalidos > 0) && (
        <p className="hint">
          {pendientes > 0 && <>&#9888; {pendientes} cliente(s) con DNI pendiente. </>}
          {telInvalidos > 0 && <>&#128245; {telInvalidos} sin celular valido (WhatsApp bloqueado).</>}
        </p>
      )}

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Documento</th><th>Nombres</th><th>Celular</th><th>DNI foto</th><th>Lotes</th><th></th></tr></thead>
          <tbody>
            {filtrada.map(c => (
              <tr key={c.id}>
                <td>{c.doc_type === 'PEND' ? <span className="bad">&#9888; {c.doc_number}</span> : c.doc_number}</td>
                <td>{c.full_name}</td>
                <td>{c.phone_valid ? c.phone : <span className="bad">{c.phone || 'sin celular'}</span>}</td>
                <td>{c.dni_front_url && c.dni_back_url ? <span className="ok">completo</span> : <span className="warn">falta</span>}</td>
                <td>{c.sales?.length || 0}</td>
                <td><button className="btn-ghost" onClick={() => abrir(c)}>ver / editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sel !== null && (
        <div className="modal-bg" onClick={() => !busy && setSel(null)}>
          <div className="glass modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{nuevo ? 'Nuevo cliente' : sel.full_name}</h2>
              <button className="btn-ghost" onClick={() => setSel(null)}>&#10005;</button>
            </div>

            <form onSubmit={guardar} className="form-grid">
              {CAMPOS.map(([k, label]) => (
                <label key={k} className={k === 'full_name' || k === 'address' ? 'span2' : ''}>
                  {label}
                  <input value={form[k] || ''} required={['doc_number', 'full_name'].includes(k)}
                    onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
                </label>
              ))}

              <label>DNI - frente {nuevo && <b className="bad">(obligatorio)</b>}
                <input type="file" accept="image/*,.pdf" onChange={e => setFFrente(e.target.files[0] || null)} />
                {!nuevo && sel.dni_front_url && <a href={sel.dni_front_url} target="_blank" rel="noreferrer">ver actual</a>}
              </label>
              <label>DNI - reverso {nuevo && <b className="bad">(obligatorio)</b>}
                <input type="file" accept="image/*,.pdf" onChange={e => setFReverso(e.target.files[0] || null)} />
                {!nuevo && sel.dni_back_url && <a href={sel.dni_back_url} target="_blank" rel="noreferrer">ver actual</a>}
              </label>

              <div className="span2">
                {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
                <button className="btn-primary" disabled={busy}>{busy ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </form>

            {!nuevo && ventas.length > 0 && (<>
              <hr />
              <h3 className="sub">Sus lotes</h3>
              {ventas.map(v => {
                const pagado = v.installments.reduce((s, i) => s + Number(i.amount_paid), 0)
                const total = Number(v.total_sale_price)
                const pct = total ? ((pagado / total) * 100).toFixed(0) : 0
                return (
                  <p key={v.id}>
                    <b>Mz {v.lot?.mz} Lt {v.lot?.lt}</b> - {v.status} - S/ {total.toLocaleString('es-PE')}
                    <span className="muted"> | cuotas pagadas S/ {pagado.toLocaleString('es-PE')} ({pct}%)</span>
                  </p>
                )
              })}
            </>)}
          </div>
        </div>
      )}
    </>
  )
}
