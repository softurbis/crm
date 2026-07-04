import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const hoy = () => new Date().toISOString().slice(0, 10)
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const TIPOS = ['PAGO DE COMISION', 'GASTOS DE DESARROLLO', 'GASTOS ADMINISTRATIVOS', 'OTROS']

export default function Expenses() {
  const { profile } = useAuth()
  const [list, setList] = useState([])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)
  const [fq, setFq] = useState('')
  const [ftipo, setFtipo] = useState('todos')
  const [fmes, setFmes] = useState('todos')
  const [f, setF] = useState({})
  const [fVou, setFVou] = useState(null)

  async function load() {
    const { data } = await supabase.from('expenses').select('*').order('issue_date', { ascending: false })
    setList(data || [])
  }
  useEffect(() => { load() }, [])

  const meses = useMemo(() => {
    const s = new Set()
    for (const g of list) if (g.issue_date) s.add(g.issue_date.slice(0, 7))
    return [...s].sort().reverse()
  }, [list])

  const filtrada = useMemo(() => {
    const t = fq.trim().toLowerCase()
    return list.filter(g => {
      if (ftipo !== 'todos' && g.type !== ftipo) return false
      if (fmes !== 'todos' && (g.issue_date || '').slice(0, 7) !== fmes) return false
      if (!t) return true
      return [g.company, g.recipient, g.sender, g.description, g.document_number]
        .some(x => (x || '').toLowerCase().includes(t))
    })
  }, [list, fq, ftipo, fmes])
  const total = filtrada.reduce((s, g) => s + Number(g.amount), 0)

  async function guardar(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      let vou = null
      if (fVou) {
        const ext = (fVou.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `gastos/${Date.now()}.${ext}`
        const { error } = await supabase.storage.from('urbis-files').upload(path, fVou)
        if (error) throw new Error(error.message)
        vou = supabase.storage.from('urbis-files').getPublicUrl(path).data.publicUrl
      }
      const up = x => (x || '').toUpperCase().trim() || null
      const { error } = await supabase.from('expenses').insert({
        project_id: (await supabase.from('projects').select('id').limit(1).single()).data.id,
        type: f.type || 'OTROS', issue_date: f.issue_date || hoy(), reception_date: f.reception_date || null,
        company: up(f.company) || 'URBIS GROUP', recipient: up(f.recipient), sender: up(f.sender),
        amount: Number(f.amount), document_type: up(f.document_type), document_number: up(f.document_number),
        payment_method: up(f.payment_method) || 'EFECTIVO', description: up(f.description),
        voucher_url: vou, registered_by: profile?.id,
      })
      if (error) throw new Error(error.message)
      setMsg({ ok: true, t: 'GASTO REGISTRADO' }); setF({}); setFVou(null); setShow(false); load()
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + err.message }) }
    setBusy(false)
  }

  const IN = (k, label, type = 'text', req = false) => (
    <label>{label}
      <input type={type} step="0.01" value={f[k] || ''} required={req}
        onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} />
    </label>
  )

  return (
    <>
      <h1>Gastos</h1>

      <div className="toolbar">
        <input className="search" placeholder="Buscar por empresa, receptor, descripcion..."
          value={fq} onChange={e => setFq(e.target.value)} />
        <select value={ftipo} onChange={e => setFtipo(e.target.value)}>
          <option value="todos">TODOS LOS TIPOS</option>
          {TIPOS.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={fmes} onChange={e => setFmes(e.target.value)}>
          <option value="todos">TODOS LOS MESES</option>
          {meses.map(m => <option key={m}>{m}</option>)}
        </select>
        <button className="btn-primary" onClick={() => setShow(!show)}>{show ? 'Cerrar' : '+ Nuevo gasto'}</button>
      </div>

      <p className="hint">{filtrada.length} gastos | TOTAL: <b>{soles(total)}</b></p>

      {show && (
        <form className="glass form-card" onSubmit={guardar}>
          <div className="form-grid">
            <label>Tipo
              <select value={f.type || ''} onChange={e => setF(x => ({ ...x, type: e.target.value }))} required>
                <option value="">- elegir -</option>
                {TIPOS.map(t => <option key={t}>{t}</option>)}
              </select>
            </label>
            {IN('issue_date', 'Fecha de emision', 'date', true)}
            {IN('reception_date', 'Fecha de recepcion', 'date')}
            {IN('amount', 'Monto S/', 'number', true)}
            {IN('company', 'Empresa')}
            {IN('recipient', 'Receptor (quien recibe)')}
            {IN('sender', 'Remitente (quien paga)')}
            <label>Metodo de pago
              <select value={f.payment_method || ''} onChange={e => setF(x => ({ ...x, payment_method: e.target.value }))}>
                <option value="">- elegir -</option>
                {['EFECTIVO', 'TRANSFERENCIA', 'DEPOSITO', 'YAPE'].map(m => <option key={m}>{m}</option>)}
              </select>
            </label>
            {IN('document_type', 'Tipo de comprobante (RH, FACTURA...)')}
            {IN('document_number', 'N de comprobante')}
            <label className="span2">Descripcion
              <input value={f.description || ''} onChange={e => setF(x => ({ ...x, description: e.target.value }))} />
            </label>
            <label>Voucher / sustento (opcional)
              <input type="file" accept="image/*,.pdf" onChange={e => setFVou(e.target.files[0] || null)} />
            </label>
          </div>
          {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
          <button className="btn-primary" disabled={busy}>{busy ? 'Guardando...' : 'Registrar gasto'}</button>
        </form>
      )}

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Receptor</th><th>Descripcion</th><th>Monto</th><th>Comprobante</th><th>Metodo</th><th>Sustento</th></tr></thead>
          <tbody>
            {filtrada.slice(0, 200).map(g => (
              <tr key={g.id}>
                <td>{g.issue_date}</td>
                <td>{g.type}</td>
                <td>{g.recipient || '-'}</td>
                <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={g.description}>{g.description || '-'}</td>
                <td>{soles(g.amount)}</td>
                <td>{g.document_type || '-'} {g.document_number || ''}</td>
                <td>{g.payment_method || '-'}</td>
                <td>{g.voucher_url ? <a href={g.voucher_url} target="_blank" rel="noreferrer">VER</a> : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
