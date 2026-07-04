import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { letras, fechaLetras } from '../lib/letras'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'

const hoy = () => new Date().toISOString().slice(0, 10)
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const TIPOS = ['PAGO DE COMISION', 'GASTOS DE DESARROLLO', 'GASTOS ADMINISTRATIVOS', 'OTROS']

const GASTO_VARS = ['RECEPTOR','RECEPTOR_DNI','FECHA_LETRAS','MONTO','MONTO_LETRAS','MOTIVO','TIPO','PROYECTO','DESCUENTO','NUMERO']
const GASTO_BLOQUES = ['TABLA_DETALLE','FIRMA_RECEPTOR']

const DEFAULT_GASTO_TEMPLATE = `CONSTANCIA DE RECEPCION DE DINERO

Yo, {{RECEPTOR}}, identificado con DNI N. {{RECEPTOR_DNI}}, dejo constancia de haber recibido en la fecha {{FECHA_LETRAS}}, la suma de {{MONTO}} ({{MONTO_LETRAS}} SOLES).
Este monto corresponde al pago por {{MOTIVO}} del proyecto "{{PROYECTO}}".
{{TABLA_DETALLE}}
*Este presupuesto se descontara directamente de {{DESCUENTO}}.
Sin otro particular, firmo la presente para los fines que correspondan.

Pucallpa, {{FECHA_LETRAS}}.
{{FIRMA_RECEPTOR}}`

async function upload(path, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const full = `${path}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('urbis-files').upload(full, file, { upsert: true })
  if (error) throw new Error(error.message)
  return supabase.storage.from('urbis-files').getPublicUrl(full).data.publicUrl
}

export default function Expenses() {
  const { profile, role } = useAuth()
  const { pidOp } = useProject()
  const [proyecto, setProyecto] = useState(null)
  const [list, setList] = useState([])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)
  const [fq, setFq] = useState('')
  const [ftipo, setFtipo] = useState('todos')
  const [fest, setFest] = useState('todos')
  const [f, setF] = useState({})
  const [prt, setPrt] = useState(null)
  const [tplOpen, setTplOpen] = useState(false)
  const [tplText, setTplText] = useState('')

  async function load() {
    if (!pidOp) return
    const [g, p] = await Promise.all([
      supabase.from('expenses').select('*').eq('project_id', pidOp).order('issue_date', { ascending: false }),
      supabase.from('projects').select('*').eq('id', pidOp).single(),
    ])
    setList(g.data || []); setProyecto(p.data || null)
    setTplText((p.data?.expense_template) || DEFAULT_GASTO_TEMPLATE)
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
        company: 'URBIS GROUP', recipient: up(f.recipient), recipient_dni: (f.recipient_dni || '').trim() || null,
        sender: up(f.sender), amount: Number(f.amount),
        document_type: up(f.document_type), payment_method: up(f.payment_method) || 'EFECTIVO',
        description: up(f.description), discount_from: f.discount_from || 'URBIS GROUP',
        detail: (f.detail || '').trim() || null,
        status: 'solicitado', registered_by: profile?.id,
      })
      if (error) throw new Error(error.message)
      setMsg({ ok: true, t: 'SOLICITUD REGISTRADA. Imprime la constancia y hazla firmar.' })
      setF({}); setShow(false); load()
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + err.message }) }
    setBusy(false)
  }

  async function confirmar(g) {
    if (!confirm(`Confirmar que el dinero de "${g.description || g.type}" (${soles(g.amount)}) ya se entrego?`)) return
    await supabase.from('expenses').update({
      status: 'confirmado', reception_date: hoy(),
      confirmed_at: new Date().toISOString(), confirmed_by: profile?.id,
    }).eq('id', g.id)
    setMsg({ ok: true, t: 'PAGO CONFIRMADO. Sube el RH o factura.' }); load()
  }

  async function subirDoc(g, file, campo, carpeta) {
    try {
      const url = await upload(`gastos/${carpeta}/${g.id}`, file)
      await supabase.from('expenses').update({ [campo]: url }).eq('id', g.id)
      setMsg({ ok: true, t: 'DOCUMENTO SUBIDO' }); load()
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + err.message }) }
  }

  async function guardarPlantilla() {
    const { error } = await supabase.from('projects').update({ expense_template: tplText }).eq('id', pidOp)
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: 'PLANTILLA DE CONSTANCIA GUARDADA' })
    load()
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
        {role === 'superuser' && (
          <button className="btn-ghost" onClick={() => setTplOpen(!tplOpen)}>
            {tplOpen ? 'Cerrar plantilla' : 'Plantilla de constancia (superusuario)'}
          </button>
        )}
      </div>

      {tplOpen && role === 'superuser' && (
        <div className="glass form-card" style={{ maxWidth: 'none' }}>
          <p><b>PLANTILLA DE CONSTANCIA DE RECEPCION — {proyecto?.name}</b></p>
          <p className="small">VARIABLES: {GASTO_VARS.map(v => <code key={v} className="tok">{'{{' + v + '}}'}</code>)}</p>
          <p className="small">BLOQUES: {GASTO_BLOQUES.map(v => <code key={v} className="tok tok2">{'{{' + v + '}}'}</code>)}</p>
          <textarea rows="14" value={tplText} spellCheck="false"
            style={{ textTransform: 'none', fontFamily: 'monospace', fontSize: '.85rem' }}
            onChange={e => setTplText(e.target.value)} />
          <div>
            <button className="btn-primary" onClick={guardarPlantilla}>Guardar plantilla</button>{' '}
            <button className="btn-ghost" onClick={() => setTplText(DEFAULT_GASTO_TEMPLATE)}>Restaurar base</button>
          </div>
        </div>
      )}

      <div className="toolbar">
        <input className="search" placeholder="Buscar por receptor, descripcion..." value={fq} onChange={e => setFq(e.target.value)} />
        <select value={ftipo} onChange={e => setFtipo(e.target.value)}>
          <option value="todos">TODOS LOS TIPOS</option>
          {TIPOS.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={fest} onChange={e => setFest(e.target.value)}>
          <option value="todos">TODOS LOS ESTADOS</option>
          <option value="solicitado">SOLICITADOS</option>
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
          <p><b>SOLICITUD DE GASTO</b> — genera la CONSTANCIA DE RECEPCION para firma; al entregarse el dinero se confirma.</p>
          <div className="form-grid">
            <label>Tipo
              <select value={f.type || ''} onChange={e => setF(x => ({ ...x, type: e.target.value }))} required>
                <option value="">- elegir -</option>
                {TIPOS.map(t => <option key={t}>{t}</option>)}
              </select>
            </label>
            {IN('issue_date', 'Fecha', 'date', true)}
            {IN('amount', 'Monto S/', 'number', true)}
            {IN('recipient', 'Receptor (quien recibe el dinero)', 'text', true)}
            {IN('recipient_dni', 'DNI del receptor', 'text', true)}
            {IN('sender', 'Solicitante')}
            <label>Se descuenta de
              <select value={f.discount_from || 'URBIS GROUP'} onChange={e => setF(x => ({ ...x, discount_from: e.target.value }))}>
                <option>URBIS GROUP</option>
                <option>EL PROYECTO</option>
              </select>
            </label>
            <label>Metodo de pago
              <select value={f.payment_method || ''} onChange={e => setF(x => ({ ...x, payment_method: e.target.value }))}>
                <option value="">- elegir -</option>
                {['EFECTIVO', 'TRANSFERENCIA', 'DEPOSITO', 'YAPE'].map(m => <option key={m}>{m}</option>)}
              </select>
            </label>
            {IN('document_type', 'Comprobante a presentar (RH, FACTURA...)')}
            <label className="span2">Motivo (sale en la constancia: "pago por ...")
              <input value={f.description || ''} onChange={e => setF(x => ({ ...x, description: e.target.value }))} required
                placeholder="GASTOS ADMINISTRATIVOS DEL MES DE JULIO / COMISION POR LA VENTA DEL LOTE MZ K LT 8 / OBRAS DE FUMIGADO..." />
            </label>
            <label className="span2">Detalle itemizado (opcional, una linea por gasto: FECHA | DESCRIPCION | MONTO)
              <textarea rows="3" value={f.detail || ''} style={{ textTransform: 'none' }}
                placeholder={'07/04/2026 | VENENO PARA FUMIGACION | 150.00\n08/04/2026 | ALMUERZO + AGUA | 30.00'}
                onChange={e => setF(x => ({ ...x, detail: e.target.value }))} />
            </label>
          </div>
          <button className="btn-primary" disabled={busy}>{busy ? 'Guardando...' : 'Registrar solicitud'}</button>
        </form>
      )}

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Estado</th><th>Tipo</th><th>Receptor</th><th>Monto</th><th>Constancia</th><th>RH/Factura</th><th>Sustento</th><th></th></tr></thead>
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
                  <UpBtn g={g} campo="request_doc_url" carpeta="constancias" label="firmada" />
                </td>
                <td><UpBtn g={g} campo="receipt_url" carpeta="rh" label="subir" alerta={g.status === 'confirmado' && !g.receipt_url} /></td>
                <td><UpBtn g={g} campo="voucher_url" carpeta="sustentos" label="subir" /></td>
                <td>
                  {g.status === 'solicitado' && ['admin', 'secretary', 'superuser'].includes(role) &&
                    <button className="btn-ghost" onClick={() => confirmar(g)}>Confirmar pago</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {prt && (() => {
        const vars = {
          RECEPTOR: prt.recipient || '____________________',
          RECEPTOR_DNI: prt.recipient_dni || '__________',
          FECHA_LETRAS: fechaLetras(prt.issue_date),
          MONTO: 'S/. ' + Number(prt.amount).toLocaleString('es-PE', { minimumFractionDigits: 2 }),
          MONTO_LETRAS: letras(Number(prt.amount)),
          MOTIVO: prt.description || prt.type,
          TIPO: prt.type, PROYECTO: proyecto?.name || '',
          DESCUENTO: prt.discount_from || 'URBIS GROUP',
          NUMERO: String(prt.id).slice(0, 8).toUpperCase(),
        }
        const fill = t => t.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] !== undefined ? String(vars[k]) : m)

        const items = (prt.detail || '').split('\n').map(l => l.split('|').map(x => x.trim())).filter(a => a.length >= 2)
        const TablaDetalle = items.length > 0 ? (
          <table className="ctable">
            <thead><tr><th>FECHA DE GASTO</th><th>DESCRIPCION</th><th>MONTO</th></tr></thead>
            <tbody>
              {items.map((a, i) => <tr key={i}><td>{a[0]}</td><td>{a[1]}</td><td>{a[2] ? 'S/. ' + a[2] : ''}</td></tr>)}
              <tr><td></td><td><b>TOTAL</b></td><td><b>{'S/. ' + Number(prt.amount).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</b></td></tr>
            </tbody>
          </table>
        ) : null
        const Firma = (
          <table className="ctable firmas"><tbody><tr>
            <td style={{ textAlign: 'center', paddingTop: '5em' }}>
              ______________________________<br /><b>{vars.RECEPTOR}</b><br />DNI N. {vars.RECEPTOR_DNI}
            </td>
          </tr></tbody></table>
        )
        const BLOQ = { TABLA_DETALLE: TablaDetalle, FIRMA_RECEPTOR: Firma }

        const tpl = proyecto?.expense_template || DEFAULT_GASTO_TEMPLATE
        let primera = true
        const cuerpo = tpl.split('\n').map((ln, i) => {
          const t = ln.trim()
          if (!t) return null
          const mb = t.match(/^\{\{(\w+)\}\}$/)
          if (mb && mb[1] in BLOQ) return <div key={i}>{BLOQ[mb[1]]}</div>
          if (primera) { primera = false; return <h2 key={i} style={{ textAlign: 'center' }}>{fill(t)}</h2> }
          return <p key={i}>{fill(t)}</p>
        })

        return (
          <div className="modal-bg" onClick={() => setPrt(null)}>
            <div className="glass modal print-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-head no-print">
                <h2>Constancia — {prt.recipient}</h2>
                <button className="btn-primary" onClick={() => window.print()}>Imprimir / PDF</button>
                <button className="btn-ghost" onClick={() => setPrt(null)}>&#10005;</button>
              </div>
              <div className="print-area contract">
                <p style={{ textAlign: 'right' }} className="small">N. {vars.NUMERO}</p>
                {cuerpo}
              </div>
            </div>
          </div>
        )
      })()}
    </>
  )
}
