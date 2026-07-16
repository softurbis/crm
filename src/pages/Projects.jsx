import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PALETA_PROYECTOS } from '../context/ProjectContext'


const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const hoyISO = () => new Date().toISOString().slice(0, 10)

function diasPara(fecha) {
  if (!fecha) return null
  return Math.ceil((new Date(fecha + 'T12:00:00') - new Date(hoyISO() + 'T12:00:00')) / 86400000)
}

async function upload(path, file) {
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
  const full = `${path}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('urbis-files').upload(full, file, { upsert: true })
  if (error) throw new Error(error.message)
  return supabase.storage.from('urbis-files').getPublicUrl(full).data.publicUrl
}

function LegalChip({ label, expiry, docUrl }) {
  const d = diasPara(expiry)
  if (!expiry || !docUrl) return <span className="chip-legal bad">&#9888; {label}: FALTA {!docUrl ? 'DOCUMENTO' : 'FECHA'}</span>
  if (d < 0) return <span className="chip-legal bad">&#9940; {label}: VENCIDA HACE {Math.abs(d)} DIAS</span>
  if (d <= 30) return <span className="chip-legal warn2">&#9888; {label}: VENCE EN {d} DIAS</span>
  return <span className="chip-legal ok2">&#10004; {label}: VIGENTE ({d} dias)</span>
}

export default function Projects() {
  const { role } = useAuth()
  const canEdit = ['admin', 'superuser'].includes(role)
  const [migra, setMigra] = useState(false)
  const [projects, setProjects] = useState([])
  const [stats, setStats] = useState({})
  const [accounts, setAccounts] = useState([])
  const [edit, setEdit] = useState(null)       // id | 'nuevo' | null
  const [f, setF] = useState({})
  const [fLiteral, setFLiteral] = useState(null)
  const [fPoder, setFPoder] = useState(null)
  const [fPlano, setFPlano] = useState(null)
  const [fFoto1, setFFoto1] = useState(null)
  const [fFoto2, setFFoto2] = useState(null)
  const [fFoto3, setFFoto3] = useState(null)
  const [fVideo, setFVideo] = useState(null)
  const [fBrochure, setFBrochure] = useState(null)
  const [fLogo, setFLogo] = useState(null)
  const [na, setNa] = useState({})
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const CAMPOS = [
    ['name', 'Nombre del proyecto', true],
    ['description', 'Descripcion del proyecto', true, 'span2'],
    ['how_to_arrive', 'Como llegar (referencia escrita)', true, 'span2'],
    ['latitude', 'Latitud (ej. -8.3456)', true],
    ['longitude', 'Longitud (ej. -74.5678)', true],
    ['maps_url', 'Link de Google Maps', true],
    ['facebook_url', 'Link de Facebook', false],
    ['instagram_url', 'Link de Instagram', false],
    ['partida_number', 'Partida registral N.', true],
    ['titular_name', 'Titular (vendedor en contratos)', true],
    ['titular_dni', 'DNI del titular', true],
    ['titular_phone', 'WhatsApp oficial', true],
    ['vista360_url', 'Link vista 360 (tour virtual)', false],
    ['office_address', 'Direccion de oficina', true, 'span2'],
  ]

  async function load() {
    const [p, l, i, g, a] = await Promise.all([
      supabase.from('projects').select('*').order('created_at'),
      supabase.from('lots').select('project_id, status'),
      supabase.from('daily_income').select('project_id, amount'),
      supabase.from('expenses').select('project_id, amount'),
      supabase.from('financial_accounts').select('*'),
    ])
    setProjects(p.data || []); setAccounts(a.data || [])
    const st = {}
    for (const pr of p.data || []) st[pr.id] = { lotes: {}, ingresos: 0, gastos: 0, total: 0 }
    for (const x of l.data || []) if (st[x.project_id]) { st[x.project_id].lotes[x.status] = (st[x.project_id].lotes[x.status] || 0) + 1; st[x.project_id].total++ }
    for (const x of i.data || []) if (st[x.project_id]) st[x.project_id].ingresos += Number(x.amount)
    for (const x of g.data || []) if (st[x.project_id]) st[x.project_id].gastos += Number(x.amount)
    setStats(st)
  }
  useEffect(() => { load() }, [])

  function abrirForm(p) {
    setEdit(p ? p.id : 'nuevo')
    const base = {}
    for (const [k] of CAMPOS) base[k] = p?.[k] ?? ''
    base.color = p?.color ?? ''
    base.copia_literal_expiry = p?.copia_literal_expiry ?? ''
    base.copia_literal_note = p?.copia_literal_note ?? ''
    base.bot_knowledge = p?.bot_knowledge ?? ''
    base.poder_expiry = p?.poder_expiry ?? ''
    base.carta_poder_note = p?.carta_poder_note ?? ''
    setF(base); setFLiteral(null); setFPoder(null); setFPlano(null); setFFoto1(null); setFFoto2(null); setFFoto3(null); setFVideo(null); setFBrochure(null); setFLogo(null); setMsg(null)
  }

  async function guardar(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const p = edit !== 'nuevo' ? projects.find(x => x.id === edit) : null
      if (!f.copia_literal_expiry) throw new Error('La fecha de vencimiento de la partida es obligatoria.')
      if (edit === 'nuevo' && !fLiteral) throw new Error('Debes subir la copia literal / partida registral (documento obligatorio).')
      if ((fPoder || p?.carta_poder_url) && !f.poder_expiry) throw new Error('Si hay carta poder, su vigencia es obligatoria.')

      let literalUrl = p?.copia_literal_url || null
      let poderUrl = p?.carta_poder_url || null
      if (fLiteral) literalUrl = await upload('legal/partida', fLiteral)
      if (fPoder) poderUrl = await upload('legal/poder', fPoder)

      let planoUrl = p?.plano_url || null
      let foto1 = p?.foto1_url || null, foto2 = p?.foto2_url || null, foto3 = p?.foto3_url || null
      let videoUrl = p?.video_url || null
      let brochureUrl = p?.brochure_url || null
      let logoUrl = p?.logo_url || null
      if (fLogo) logoUrl = await upload('brand/logo', fLogo)
      if (fBrochure) brochureUrl = await upload('bot/brochure', fBrochure)
      if (fPlano) planoUrl = await upload('bot/plano', fPlano)
      if (fFoto1) foto1 = await upload('bot/foto1', fFoto1)
      if (fFoto2) foto2 = await upload('bot/foto2', fFoto2)
      if (fFoto3) foto3 = await upload('bot/foto3', fFoto3)
      if (fVideo) {
        if (fVideo.size > 15 * 1024 * 1024) throw new Error('El video debe pesar maximo 15 MB para WhatsApp.')
        videoUrl = await upload('bot/video', fVideo)
      }

      const payload = {}
      for (const [k, , req] of CAMPOS) {
        const v = (String(f[k] ?? '')).trim()
        if (req && !v) throw new Error('Campo obligatorio: ' + k.replace(/_/g, ' '))
        payload[k] = k.includes('url') || k === 'latitude' || k === 'longitude' ? (v || null) : (v.toUpperCase() || null)
      }
      payload.latitude = f.latitude ? Number(f.latitude) : null
      payload.longitude = f.longitude ? Number(f.longitude) : null
      payload.color = f.color || null        // color identificador (menu y selector)
      payload.copia_literal_url = literalUrl
      payload.copia_literal_expiry = f.copia_literal_expiry || null
      payload.copia_literal_note = (f.copia_literal_note || '').trim() || null
      payload.carta_poder_url = poderUrl
      payload.poder_expiry = f.poder_expiry || null
      payload.carta_poder_note = (f.carta_poder_note || '').trim() || null
      payload.bot_knowledge = f.bot_knowledge || null
      payload.plano_url = planoUrl
      payload.brochure_url = brochureUrl
      payload.logo_url = logoUrl
      payload.foto1_url = foto1
      payload.foto2_url = foto2
      payload.foto3_url = foto3
      payload.video_url = videoUrl

      const r = edit === 'nuevo'
        ? await supabase.from('projects').insert(payload)
        : await supabase.from('projects').update(payload).eq('id', edit)
      if (r.error) throw new Error(r.error.message)
      setMsg({ ok: true, t: edit === 'nuevo' ? 'PROYECTO CREADO' : 'PROYECTO ACTUALIZADO' })
      setEdit(null); load()
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + err.message }) }
    setBusy(false)
  }

  async function agregarCuenta(pid) {
    if (!na.name) return
    const { error } = await supabase.from('financial_accounts').insert({
      project_id: pid, name: (na.name || '').toUpperCase(),
      type: na.type || 'bank', account_number: na.account_number || null,
      cci: na.cci || null, holder_name: (na.holder || '').toUpperCase() || null,
    })
    setMsg(error ? { ok: false, t: error.message } : { ok: true, t: 'CUENTA AGREGADA' })
    setNa({}); load()
  }

  const pcur = edit && edit !== 'nuevo' ? projects.find(x => x.id === edit) : null

  const FORM = (
    <form className="glass form-card" onSubmit={guardar}>
      <p><b>{edit === 'nuevo' ? 'NUEVO PROYECTO' : 'EDITAR PROYECTO'}</b> — todos los campos marcados son obligatorios.</p>
      <div className="form-grid">
        {CAMPOS.map(([k, label, req, cls]) => (
          <label key={k} className={cls || ''}>
            {label} {req && <b className="bad">*</b>}
            <input value={f[k] ?? ''} required={req}
              style={k.includes('url') ? { textTransform: 'none' } : {}}
              onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} />
          </label>
        ))}
        {/* color identificador: se ve en el menu izquierdo y en el selector de proyecto */}
        <label className="span2">Color del proyecto <span className="muted small">(lo distingue en el menu y en el selector)</span>
          <div className="color-pick">
            {PALETA_PROYECTOS.map(c => (
              <button type="button" key={c} title={c}
                className={`color-op ${(f.color || '').toLowerCase() === c.toLowerCase() ? 'on' : ''}`}
                style={{ '--co': c }} onClick={() => setF(x => ({ ...x, color: c }))} />
            ))}
            <input type="color" value={f.color || '#8fd16f'} title="Otro color"
              onChange={e => setF(x => ({ ...x, color: e.target.value }))} className="color-libre" />
            {f.color && <button type="button" className="link-btn" onClick={() => setF(x => ({ ...x, color: '' }))}>quitar</button>}
          </div>
        </label>
        <label>Partida / copia literal (PDF o foto) {edit === 'nuevo' && <b className="bad">*</b>}
          <input type="file" accept="image/*,.pdf" onChange={e => setFLiteral(e.target.files[0] || null)} />
          <input value={f.copia_literal_note || ''} placeholder="nota / comentario del documento"
            style={{ textTransform: 'none', marginTop: 4 }}
            onChange={e => setF(x => ({ ...x, copia_literal_note: e.target.value }))} />
        </label>
        <label>Vencimiento de la partida <b className="bad">*</b>
          <input type="date" value={f.copia_literal_expiry || ''} required
            onChange={e => setF(x => ({ ...x, copia_literal_expiry: e.target.value }))} />
        </label>
        <label>Carta poder (si aplica)
          <input type="file" accept="image/*,.pdf" onChange={e => setFPoder(e.target.files[0] || null)} />
          <input value={f.carta_poder_note || ''} placeholder="nota / comentario del documento"
            style={{ textTransform: 'none', marginTop: 4 }}
            onChange={e => setF(x => ({ ...x, carta_poder_note: e.target.value }))} />
        </label>
        <label>Vigencia del poder
          <input type="date" value={f.poder_expiry || ''}
            onChange={e => setF(x => ({ ...x, poder_expiry: e.target.value }))} />
        </label>
        <label>Logo del proyecto (para el contrato) {pcur?.logo_url && <a href={pcur.logo_url} target="_blank" rel="noreferrer" style={{ textTransform: 'none' }}>ver actual</a>}
          <input type="file" accept="image/*" onChange={e => setFLogo(e.target.files[0] || null)} />
        </label>
        <p className="span2" style={{ margin: '8px 0 0' }}><b>📎 MATERIAL DEL BOT (WhatsApp)</b> — el agente lo envía en la conversación cuando el cliente pide plano, fotos o video.</p>
        <label>Plano actualizado (imagen o PDF) {pcur?.plano_url && <a href={pcur.plano_url} target="_blank" rel="noreferrer" style={{ textTransform: 'none' }}>ver actual</a>}
          <input type="file" accept="image/*,.pdf" onChange={e => setFPlano(e.target.files[0] || null)} />
        </label>
        <label>Brochure (PDF o imagen) {pcur?.brochure_url && <a href={pcur.brochure_url} target="_blank" rel="noreferrer">ver actual</a>}
          <input type="file" accept="image/*,.pdf" onChange={e => setFBrochure(e.target.files[0] || null)} />
        </label>
        <label>Foto 1 {pcur?.foto1_url && <a href={pcur.foto1_url} target="_blank" rel="noreferrer">ver</a>}
          <input type="file" accept="image/*" onChange={e => setFFoto1(e.target.files[0] || null)} />
        </label>
        <label>Foto 2 {pcur?.foto2_url && <a href={pcur.foto2_url} target="_blank" rel="noreferrer">ver</a>}
          <input type="file" accept="image/*" onChange={e => setFFoto2(e.target.files[0] || null)} />
        </label>
        <label>Foto 3 {pcur?.foto3_url && <a href={pcur.foto3_url} target="_blank" rel="noreferrer">ver</a>}
          <input type="file" accept="image/*" onChange={e => setFFoto3(e.target.files[0] || null)} />
        </label>
        <label>Video (MP4, máx. 15 MB) {pcur?.video_url && <a href={pcur.video_url} target="_blank" rel="noreferrer">ver</a>}
          <input type="file" accept="video/mp4,video/*" onChange={e => setFVideo(e.target.files[0] || null)} />
        </label>
      </div>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
      <div>
        <button className="btn-primary" disabled={busy}>{busy ? 'Guardando...' : 'Guardar proyecto'}</button>{' '}
        <button type="button" className="btn-ghost" onClick={() => setEdit(null)}>Cancelar</button>
      </div>
    </form>
  )

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Proyectos</h1>
        {role === 'superuser' && <button className="btn-ghost" onClick={() => setMigra(!migra)}>&#128229; Migración masiva</button>}
        {canEdit && <button className="btn-primary" onClick={() => abrirForm(null)}>+ Nuevo proyecto</button>}
      </div>
      {msg && !edit && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      {migra && role === 'superuser' && (
        <div className="glass form-card" style={{ maxWidth: 'none' }}>
          <p><b>&#128229; MIGRACION MASIVA DE UN PROYECTO</b> <span className="muted small">(cargar un proyecto que ya venia operando: lotes, clientes, ventas, cuotas y pagos historicos)</span></p>
          <p style={{ margin: '8px 0' }}>
            <a className="btn-primary btn-link" href={import.meta.env.BASE_URL + 'PLANTILLA-MIGRACION-PROYECTO.xlsx'} download>&#11015; Descargar formato Excel</a>
          </p>
          <div className="hint">
            <p><b>1.</b> Crea el proyecto aqui con "+ Nuevo proyecto" (nombre, titular, cuentas bancarias, tasa de mora).</p>
            <p><b>2.</b> Descarga el formato y llena las hojas EN ORDEN (la hoja LEEME trae todas las reglas): 1-LOTES &#8594; 2-CLIENTES &#8594; 3-VENDEDORES &#8594; 4-CUENTAS &#8594; 5-SEPARACIONES vigentes &#8594; 6-VENTAS &#8594; 7-PAGOS historicos &#8594; 8-GASTOS (opcional).</p>
            <p><b>3.</b> Entrega el Excel lleno en el chat de Claude (proyecto Sistema CRM): "genera el SQL de migracion de [nombre del proyecto]".</p>
            <p><b>4.</b> Se valida que todo cuadre (lotes vs ventas vs pagos) y se genera el script de carga para Supabase. El cronograma de cuotas y la aplicacion de pagos a las cuotas mas antiguas se calculan solos &#8212; igual que se migro Las Praderas de Cashibo.</p>
          </div>
        </div>
      )}
      {edit === 'nuevo' && FORM}

      {projects.map(p => {
        const s = stats[p.id] || { lotes: {}, ingresos: 0, gastos: 0, total: 0 }
        return (
          <div className="glass form-card" key={p.id}>
            <div className="modal-head">
              <h2>{p.name}</h2>
              {canEdit && <button className="btn-ghost" onClick={() => edit === p.id ? setEdit(null) : abrirForm(p)}>{edit === p.id ? 'Cerrar' : 'Editar'}</button>}
            </div>

            <p>
              <LegalChip label="PARTIDA" expiry={p.copia_literal_expiry} docUrl={p.copia_literal_url} />{' '}
              {(p.carta_poder_url || p.poder_expiry) && <LegalChip label="PODER" expiry={p.poder_expiry} docUrl={p.carta_poder_url} />}
              {p.copia_literal_url && <> <a href={p.copia_literal_url} target="_blank" rel="noreferrer" className="small">VER PARTIDA</a></>}
              {p.carta_poder_url && <> | <a href={p.carta_poder_url} target="_blank" rel="noreferrer" className="small">VER PODER</a></>}
            </p>

            <div className="cards">
              <div className="card glass"><p className="muted">Recaudado</p><p className="kpi">{soles(s.ingresos)}</p></div>
              <div className="card glass"><p className="muted">Gastos</p><p className="kpi">{soles(s.gastos)}</p></div>
              <div className="card glass"><p className="muted">Balance</p><p className="kpi">{soles(s.ingresos - s.gastos)}</p></div>
              <div className="card glass"><p className="muted">Lotes</p><p className="kpi">{s.total}</p></div>
            </div>
            <p>
              <span className="ok">&#9679; {s.lotes.disponible || 0} disponibles</span>{' '}
              <span style={{ color: '#4f83c2' }}>&#9679; {s.lotes.vendido || 0} vendidos</span>{' '}
              <span className="warn">&#9679; {s.lotes.separado || 0} separados</span>{' '}
              <span style={{ color: '#9a6bc9' }}>&#9679; {s.lotes.expropiado || 0} expropiados</span>{' '}
              <span className="bad">&#9679; {s.lotes.invadido || 0} invadidos</span>
            </p>
            {p.description && <p className="muted small">{p.description}</p>}
            {p.how_to_arrive && <p className="muted small">COMO LLEGAR: {p.how_to_arrive}</p>}
            <p className="small">
              {p.maps_url && <a href={p.maps_url} target="_blank" rel="noreferrer">&#128205; MAPS</a>}
              {p.facebook_url && <> | <a href={p.facebook_url} target="_blank" rel="noreferrer">FACEBOOK</a></>}
              {p.instagram_url && <> | <a href={p.instagram_url} target="_blank" rel="noreferrer">INSTAGRAM</a></>}
              {p.latitude && <span className="muted"> | {p.latitude}, {p.longitude}</span>}
              {p.partida_number && <span className="muted"> | PARTIDA N. {p.partida_number}</span>}
            </p>
            <p className="muted small">TITULAR: {p.titular_name || '-'} (DNI {p.titular_dni || '-'}) | OFICINA: {p.office_address || '-'}</p>

            {edit === p.id && FORM}

            <hr />
            <p><b>CUENTAS DE COBRO:</b></p>
            {accounts.filter(a => a.project_id === p.id).map(a => (
              <p key={a.id} className={a.active ? '' : 'muted'}>
                &#127974; {a.name} {a.account_number ? `| CTA ${a.account_number}` : ''} {a.cci ? `| CCI ${a.cci}` : ''} {a.holder_name ? `| ${a.holder_name}` : ''}
                {!a.active && ' (INACTIVA)'}
                {canEdit && <button className="link-btn" style={{ marginLeft: 8 }}
                  onClick={async () => { await supabase.from('financial_accounts').update({ active: !a.active }).eq('id', a.id); load() }}>
                  {a.active ? 'desactivar' : 'activar'}</button>}
              </p>
            ))}
            {canEdit && (
              <div className="form-grid">
                <label>Banco/billetera <input value={na.name || ''} onChange={e => setNa(x => ({ ...x, name: e.target.value }))} /></label>
                <label>Tipo
                  <select value={na.type || 'bank'} onChange={e => setNa(x => ({ ...x, type: e.target.value }))}>
                    <option value="bank">BANCO</option><option value="digital_wallet">BILLETERA DIGITAL</option>
                  </select>
                </label>
                <label>N cuenta <input value={na.account_number || ''} onChange={e => setNa(x => ({ ...x, account_number: e.target.value }))} /></label>
                <label>CCI <input value={na.cci || ''} onChange={e => setNa(x => ({ ...x, cci: e.target.value }))} /></label>
                <label>Titular <input value={na.holder || ''} onChange={e => setNa(x => ({ ...x, holder: e.target.value }))} /></label>
                <div><button className="btn-ghost" type="button" onClick={() => agregarCuenta(p.id)}>+ Agregar cuenta</button></div>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
