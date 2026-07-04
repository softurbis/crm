import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const CAMPOS = [
  ['doc_number', 'DNI / Documento'], ['full_name', 'Nombres completos'],
  ['phone', 'Celular'], ['address', 'Dirección'], ['district', 'Distrito'],
  ['province', 'Provincia'], ['department', 'Departamento'], ['civil_status', 'Estado civil'],
]

export default function Clients() {
  const [list, setList] = useState([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)     // cliente en edición
  const [form, setForm] = useState({})
  const [ventas, setVentas] = useState([])
  const [msg, setMsg] = useState(null)
  const [nuevo, setNuevo] = useState(false)

  async function load() {
    const { data } = await supabase.from('clients')
      .select('*, sales(id)').order('full_name')
    setList(data || [])
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!sel?.id) { setVentas([]); return }
    supabase.from('sales')
      .select('id, total_sale_price, status, sale_date, lot:lots(mz,lt), installments(amount, amount_paid, status)')
      .eq('client_id', sel.id)
      .then(({ data }) => setVentas(data || []))
  }, [sel])

  const filtrada = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return list
    return list.filter(c =>
      c.full_name?.toLowerCase().includes(t) ||
      c.doc_number?.toLowerCase().includes(t) ||
      c.phone?.replace(/\s/g, '').includes(t.replace(/\s/g, '')))
  }, [list, q])

  const pendientes = list.filter(c => c.doc_type === 'PEND').length
  const telInvalidos = list.filter(c => !c.phone_valid).length

  function abrir(c) {
    setSel(c); setNuevo(!c.id)
    setForm(Object.fromEntries(CAMPOS.map(([k]) => [k, c[k] || ''])))
    setMsg(null)
  }

  async function guardar(e) {
    e.preventDefault()
    const telDigits = (form.phone || '').replace(/\D/g, '')
    const payload = {
      ...form,
      phone_valid: telDigits.length >= 9 && !telDigits.includes('999999999'),
      doc_type: /^\d{8}$/.test(form.doc_number) ? 'DNI' : (form.doc_number.startsWith('PEND') ? 'PEND' : sel.doc_type || 'DNI'),
    }
    const r = nuevo
      ? await supabase.from('clients').insert(payload)
      : await supabase.from('clients').update(payload).eq('id', sel.id)
    if (r.error) { setMsg({ ok: false, t: 'Error: ' + r.error.message }); return }
    setMsg({ ok: true, t: 'Guardado ✔' })
    load()
    if (nuevo) setSel(null)
  }

  return (
    <>
      <h1>Clientes</h1>

      <div className="toolbar">
        <input className="search" placeholder="Buscar por nombre, DNI o celular…"
          value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn-primary" onClick={() => abrir({})}>+ Nuevo cliente</button>
      </div>

      {(pendientes > 0 || telInvalidos > 0) && (
        <p className="hint">
          {pendientes > 0 && <>⚠ {pendientes} cliente(s) con DNI pendiente. </>}
          {telInvalidos > 0 && <>📵 {telInvalidos} sin celular válido (WhatsApp bloqueado).</>}
        </p>
      )}

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Documento</th><th>Nombres</th><th>Celular</th><th>Lotes</th><th></th></tr></thead>
          <tbody>
            {filtrada.map(c => (
              <tr key={c.id}>
                <td>{c.doc_type === 'PEND' ? <span className="bad">⚠ {c.doc_number}</span> : c.doc_number}</td>
                <td>{c.full_name}</td>
                <td>{c.phone_valid ? c.phone : <span className="bad">{c.phone || 'sin celular'} 📵</span>}</td>
                <td>{c.sales?.length || 0}</td>
                <td><button className="btn-ghost" onClick={() => abrir(c)}>ver / editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sel !== null && (
        <div className="modal-bg" onClick={() => setSel(null)}>
          <div className="glass modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{nuevo ? 'Nuevo cliente' : sel.full_name}</h2>
              <button className="btn-ghost" onClick={() => setSel(null)}>✕</button>
            </div>

            <form onSubmit={guardar} className="form-grid">
              {CAMPOS.map(([k, label]) => (
                <label key={k} className={k === 'full_name' || k === 'address' ? 'span2' : ''}>
                  {label}
                  <input value={form[k] || ''} required={['doc_number', 'full_name'].includes(k)}
                    onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
                </label>
              ))}
              <div className="span2">
                {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
                <button className="btn-primary">Guardar</button>
              </div>
            </form>

            {!nuevo && ventas.length > 0 && (<>
              <hr />
              <h3 className="sub">Sus lotes</h3>
              {ventas.map(v => {
                const pagado = v.installments.reduce((s, i) => s + Number(i.amount_paid), 0) + 0
                const total = Number(v.total_sale_price)
                const pct = total ? ((pagado / total) * 100).toFixed(0) : 0
                return (
                  <p key={v.id}>
                    <b>Mz {v.lot?.mz} Lt {v.lot?.lt}</b> — {v.status} — S/ {total.toLocaleString('es-PE')}
                    <span className="muted"> · cuotas pagadas S/ {pagado.toLocaleString('es-PE')} ({pct}%)</span>
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
