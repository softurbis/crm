import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'

const hoy = () => new Date().toISOString().slice(0, 10)
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const TIPOS = ['PAGO DE COMISION', 'GASTOS DE DESARROLLO', 'GASTOS ADMINISTRATIVOS', 'OTROS']

async function upload(path, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const full = `${path}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('urbis-files').upload(full, file, { upsert: true })
  if (error) throw new Error(error.message)
  return supabase.storage.from('urbis-files').getPublicUrl(full).data.publicUrl
}

export default function Expenses() {
  const { profile, role } = useAuth()
  const { pidOp, current, projects } = useProject()
  const proj = current || projects.find(p => p.id === pidOp)
  const [list, setList] = useState([])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)
  const [fq, setFq] = useState('')
  const [ftipo, setFtipo] = useState('todos')
  const [fest, setFest] = useState('todos')
  const [f, setF] = useState({})
  const [prt, setPrt] = useState(null)   // solicitud a imprimir

  async function load() {
    if (!pidOp) return
    const { data } = await supabase.from('expenses').select('*').eq('project_id', pidOp).order('issue_date', { ascending: false })
    setList(data || [])
  }
  useEffect(() => { load() }, [pidOp])

  const filtrada = useMemo(() => {
    const t = fq.trim().toLowerCase()
    return list.filter(g => {
      if (ftipo !== 'todos' && g.type !== ftipo) return false
      if (fest === 'solicitado' && g.status !== 'solicitado') return false
      if (fest === 'confirmado' && g.status !== 'confirmado') return false
      if (fest === 'falta_rh' && (g.status !== 'confirmado' || g.receipt_url)) return false
      if (!t) return true
      return [g.company, g.recipient, g.sender, g.description, g.document_number]
        .some(x => (x || '').toLowerCase().includes(t))
    })
  }, [list, fq, ftipo, fest])
  const total = filtrada.reduce((s, g) => s + Number(g.amount), 0)
  const pendConfirmar = list.filter(g => g.status === 'solicitado').length
  const faltaRH = list.filter(g => g.status === 'confirmado' && !g.receipt_url).length

  async function guardar(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const up = x => (x || '').toUpperCase().trim() || null
      const { error } = await supabase.from('expenses').insert({
        project_id: pidOp,
        type: f.type || 'OTROS', issue_date: f.issue_date || hoy(),
        company: up(f.company) || 'URBIS GROUP', recipient: up(f.recipient), sender: up(f.sender),
        amount: Number(f.amount), document_type: up(f.document_type), document_number: up(f.document_number),
        payment_method: up(f.payment_method) || 'EFECTIVO', description: up(f.description),
        status: 'solicitado', registered_by: profile?.id,
      })
      if (error) throw new Error(error.message)
      setMsg({ ok: true, t: 'SOLICITUD REGISTRADA. Imprimela desde la lista y hazla firmar.' })
      setF({}); setShow(false); load()
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + err.message }) }
    setBusy(false)
  }

  async function confirmar(g) {
    if (!confirm(`Confirmar que el dinero de "${g.description || g.type}" (${soles(g.amount)}) ya se entrego/pago?`)) return
    await supabase.from('expenses').update({
      status: 'confirmado', reception_date: hoy(),
      confirmed_at: new Date().toISOString(), confirmed_by: profile?.id,
    }).eq('id', g.id)
    setMsg({ ok: true, t: 'PAGO CONFIRMADO. Ahora sube el RH o factura.' })
    load()
  }

  async function subirDoc(g, file, campo, carpeta) {
    try {
      const url = await upload(`gastos/${carpeta}/${g.id}`, file)
      await supabase.from('expenses').update({ [campo]: url }).eq('id', g.id)
      setMsg({ ok: true, t: 'DOCUMENTO SUBIDO' }); load()
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + err.message }) }
  }

  const UpBtn = ({ g, campo, carpeta, label, alerta }) => (
    g[campo]
      ? <a href={g[campo]} target="_blank" rel="noreferrer">VER</a>
      : <label className={`upload-btn ${alerta ? 'bad' : ''}`}>{alerta ? '⚠ ' : ''}{label}
          <input type="file" accept="image/*,.pdf" hidden
            onChange={e => e.target.files[0] && subirDoc(g, e.target.files[0], campo, carpeta)} />
        </label>
  )

  const IN = (k, label, type = 'text', req = false) => (
    <label key={k}>{label}
      <input type={type} step="0.01" value={f[k] || ''} required={req}
        onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} />
    </label>
  )

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Gastos</h1>
        <ProjectPicker />
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Buscar por receptor, empresa, descripcion..." value={fq} onChange={e => setFq(e.target.value)} />
        <select value={ftipo} onChange={e => setFtipo(e.target.value)}>
          <option value="todos">TODOS LOS TIPOS</option>
          {TIPOS.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={fest} onChange={e => setFest(e.target.value)}>
          <option value="todos">TODOS LOS ESTADOS</option>
          <option value="solicitado">SOLICITADOS (sin confirmar)</option>
          <option value="confirmado">CONFIRMADOS</option>
          <option value="falta_rh">FALTA RH / FACTURA</option>
        </select>
        <button className="btn-primary" onClick={() => setShow(!show)}>{show ? 'Cerrar' : '+ Solicitar gasto'}</button>
      </div>

      <p className="hint">
        {filtrada.length} gastos | TOTAL: <b>{soles(total)}</b>
        {pendConfirmar > 0 && <span className="warn"> | POR CONFIRMAR: {pendConfirmar}</span>}
        {faltaRH > 0 && <span className="bad"> | FALTA RH/FACTURA: {faltaRH}</span>}
      </p>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      {show && (
        <form className="glass form-card" onSubmit={guardar}>
          <p><b>SOLICITUD DE GASTO</b> — se registra, se imprime para firma, y cuando el dinero se entregue se confirma.</p>
          <div className="form-grid">
            <label>Tipo
              <select value={f.type || ''} onChange={e => setF(x => ({ ...x, type: e.target.value }))} required>
                <option value="">- elegir -</option>
                {TIPOS.map(t => <option key={t}>{t}</option>)}
              </select>
            </label>
            {IN('issue_date', 'Fecha de solicitud', 'date', true)}
            {IN('amount', 'Monto S/', 'number', true)}
            {IN('recipient', 'Receptor (quien recibira el dinero)', 'text', true)}
            {IN('sender', 'Solicitante')}
            <label>Metodo de pago previsto
              <select value={f.payment_method || ''} onChange={e => setF(x => ({ ...x, payment_method: e.target.value }))}>
                <option value="">- elegir -</option>
                {['EFECTIVO', 'TRANSFERENCIA', 'DEPOSITO', 'YAPE'].map(m => <option key={m}>{m}</option>)}
              </select>
            </label>
            {IN('document_type', 'Comprobante esperado (RH, FACTURA...)')}
            <label className="span2">Descripcion / motivo
              <input value={f.description || ''} onChange={e => setF(x => ({ ...x, description: e.target.value }))} required />
            </label>
          </div>
          <button className="btn-primary" disabled={busy}>{busy ? 'Guardando...' : 'Registrar solicitud'}</button>
        </form>
      )}

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Estado</th><th>Tipo</th><th>Receptor</th><th>Monto</th><th>Solicitud</th><th>RH/Factura</th><th>Constancia</th><th></th></tr></thead>
          <tbody>
            {filtrada.slice(0, 200).map(g => (
              <tr key={g.id}>
                <td>{g.issue_date}</td>
                <td>{g.status === 'solicitado'
                  ? <span className="warn">&#9203; SOLICITADO</span>
                  : <span className="ok">&#10004; CONFIRMADO</span>}</td>
                <td>{g.type}</td>
                <td title={g.description}>{g.recipient || '-'}</td>
                <td>{soles(g.amount)}</td>
                <td>
                  <button className="link-btn" onClick={() => setPrt(g)}>imprimir</button>{' | '}
                  <UpBtn g={g} campo="request_doc_url" carpeta="solicitudes" label="firmada" />
                </td>
                <td><UpBtn g={g} campo="receipt_url" carpeta="rh" label="subir" alerta={g.status === 'confirmado' && !g.receipt_url} /></td>
                <td><UpBtn g={g} campo="voucher_url" carpeta="constancias" label="subir" /></td>
                <td>
                  {g.status === 'solicitado' && ['admin', 'secretary'].includes(role) &&
                    <button className="btn-ghost" onClick={() => confirmar(g)}>Confirmar pago</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {prt && (
        <div className="modal-bg" onClick={() => setPrt(null)}>
          <div className="glass modal print-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head no-print">
              <h2>Solicitud de gasto</h2>
              <button className="btn-primary" onClick={() => window.print()}>Imprimir / PDF</button>
              <button className="btn-ghost" onClick={() => setPrt(null)}>&#10005;</button>
            </div>
            <div className="print-area contract">
              <h2 style={{ textAlign: 'center' }}>SOLICITUD DE EGRESO</h2>
              <p style={{ textAlign: 'center' }}>URBIS GROUP — {proj?.name || ''}</p>
              <p style={{ textAlign: 'right' }}>N.° {String(prt.id).slice(0, 8).toUpperCase()}<br />Pucallpa, {new Date(prt.issue_date + 'T12:00:00').toLocaleDateString('es-PE')}</p>
              <table className="ctable">
                <tbody>
                  <tr><td><b>Tipo de gasto</b></td><td>{prt.type}</td></tr>
                  <tr><td><b>Monto solicitado</b></td><td><b>{soles(prt.amount)}</b></td></tr>
                  <tr><td><b>Receptor</b></td><td>{prt.recipient || '-'}</td></tr>
                  <tr><td><b>Solicitante</b></td><td>{prt.sender || '-'}</td></tr>
                  <tr><td><b>Metodo de pago</b></td><td>{prt.payment_method || '-'}</td></tr>
                  <tr><td><b>Comprobante a presentar</b></td><td>{prt.document_type || 'RH / FACTURA'}</td></tr>
                  <tr><td><b>Motivo</b></td><td>{prt.description || '-'}</td></tr>
                </tbody>
              </table>
              <p>Por medio del presente documento se solicita la autorizacion y desembolso del gasto detallado, el cual sera sustentado con el comprobante correspondiente una vez ejecutado.</p>
              <table className="ctable firmas">
                <tbody>
                  <tr>
                    <td style={{ textAlign: 'center', paddingTop: '4em' }}>______________________________<br /><b>SOLICITANTE</b><br />{prt.sender || ''}</td>
                    <td style={{ textAlign: 'center', paddingTop: '4em' }}>______________________________<br /><b>AUTORIZADO POR</b><br />ADMINISTRACION</td>
                    <td style={{ textAlign: 'center', paddingTop: '4em' }}>______________________________<br /><b>RECIBI CONFORME</b><br />{prt.recipient || ''}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
