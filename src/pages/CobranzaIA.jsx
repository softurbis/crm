import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { upload } from '../lib/archivos'
import { useMsg } from '../lib/saveFx'
import { useAuth } from '../context/AuthContext'
import VisorDoc from '../components/VisorDoc'

// ============================================================================
// COBRANZA IA — la pantalla de la responsable de cobranza (sql/76)
// ----------------------------------------------------------------------------
// El agente (agente/cobranza.js) conversa con los clientes por el numero
// oficial de cobranza. Aqui la secretaria:
//   · valida o rechaza los vouchers que leyo el agente (nada suma en Cuotas
//     hasta que ella valida),
//   · ve las promesas de pago y lo que vence en la semana,
//   · lee las conversaciones, toma un chat o se lo devuelve al agente,
//   · prueba el agente con datos reales sin mandarle nada al cliente,
//   · prende/apaga el agente y los avisos y ajusta los dias.
// La ve el superusuario, el administrador (solo mirar) y quien tenga el permiso
// especial 'cobranza' (Usuarios).
// ============================================================================

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hoyLima = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const diasHasta = iso => Math.round((new Date(iso + 'T12:00:00Z') - new Date(hoyLima() + 'T12:00:00Z')) / 86400000)
const fCorta = iso => iso ? String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) + '/' + String(iso).slice(0, 4) : '—'
const fHora = s => s ? new Date(s).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const loteDe = s => s?.lot ? `MZ ${s.lot.mz} LT ${s.lot.lt}` : '—'
const capital = s => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''
const TIPOS_OP = ['TRANSFERENCIA', 'DEPOSITO', 'BILLETERA DIGITAL', 'POR CONFIRMAR']
const PRECIO = { in: 1, out: 5, cache: 0.1 }   // Claude Haiku 4.5, US$ por millon de tokens
const ventanaAbierta = c => !!c?.ultimo_entrante_at && Date.now() - new Date(c.ultimo_entrante_at).getTime() < 23.5 * 3600e3
const AUTOR = { cliente: '', agente: '🤖 Agente', secretaria: '👩 Secretaria', celular: '📲 Desde el celular', plantilla: '📨 Aviso', sistema: '⚙️ Sistema' }

export default function CobranzaIA() {
  const { profile, role } = useAuth()
  const puede = role === 'superuser' || (profile?.permisos || []).includes('cobranza')
  const ve = puede || role === 'admin'
  const [tab, setTab] = useState('validar')
  const [cfg, setCfg] = useState(null)
  const [falta, setFalta] = useState('')
  const [msg, setMsg] = useMsg(null)

  async function cargarCfg() {
    const { data, error } = await supabase.from('cobranza_config').select('*').eq('id', 1).maybeSingle()
    if (error) { setFalta(/cobranza_config/.test(error.message) ? 'Falta correr sql/76_agente_cobranza.sql en la base.' : 'ERROR: ' + error.message); return }
    setFalta(''); setCfg(data)
  }
  useEffect(() => {
    if (!ve) return
    cargarCfg()
    const t = setInterval(cargarCfg, 30000)
    return () => clearInterval(t)
  }, [ve])

  if (!ve) return <p className="error">Esta pantalla es de la responsable de cobranza. El superusuario da el permiso desde Usuarios.</p>
  const vivo = !!cfg?.latido && Date.now() - new Date(cfg.latido).getTime() < 3 * 60000
  const TABS = [['validar', '💵 Por validar'], ['promesas', '📅 Promesas y vencimientos'], ['chats', '💬 Conversaciones'], ['probar', '🧪 Probar agente'], ['config', '⚙️ Configuración']]

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Cobranza IA</h1>
        {cfg && (
          <span className="small" title={cfg.latido ? 'Último latido del proceso: ' + fHora(cfg.latido) : 'El proceso nunca reportó'}>
            {vivo ? '🟢 agente corriendo' : '🔴 el proceso no responde'}
            {' · '}{cfg.agente_activo ? '🤖 contesta a clientes' : '⏸ no contesta'}
            {' · '}{cfg.avisos_activos ? '📨 avisos ON' : '📨 avisos off'}
            {vivo && cfg.latido_info && !cfg.latido_info.whatsapp ? ' · ⚠ sin token de WhatsApp: solo pruebas' : ''}
          </span>
        )}
      </div>
      {falta && <p className="error">{falta}</p>}
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
      {!puede && <p className="hint muted">Modo consulta: validar, escribir y configurar es de la responsable de cobranza.</p>}
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {!falta && cfg && tab === 'validar' && <PorValidar puede={puede} setMsg={setMsg} />}
      {!falta && cfg && tab === 'promesas' && <Promesas puede={puede} setMsg={setMsg} />}
      {!falta && cfg && tab === 'chats' && <Conversaciones puede={puede} profile={profile} setMsg={setMsg} />}
      {!falta && cfg && tab === 'probar' && <Probar puede={puede} vivo={vivo} setMsg={setMsg} />}
      {!falta && cfg && tab === 'config' && <Configuracion cfg={cfg} puede={puede} profile={profile} recargar={cargarCfg} setMsg={setMsg} />}
    </>
  )
}

// ============================================================================
// POR VALIDAR
// ============================================================================
const COLS_PAGO = 'id, created_at, monto, fecha, numero_operacion, banco, titular, alerta, estado, voucher_url, client_id, sale_id, chat_id, motivo_rechazo, validado_at, client:clients(full_name, doc_number), sale:sales(id, lot:lots(mz, lt, project:projects(name))), chat:cobranza_chats(phone)'

function PorValidar({ puede, setMsg }) {
  const [lista, setLista] = useState([])
  const [recientes, setRecientes] = useState([])
  const [abierto, setAbierto] = useState(null)

  async function cargar() {
    const [p, r] = await Promise.all([
      supabase.from('cobranza_pagos_reportados').select(COLS_PAGO).eq('estado', 'pendiente').eq('es_prueba', false).order('created_at'),
      supabase.from('cobranza_pagos_reportados').select(COLS_PAGO).neq('estado', 'pendiente').eq('es_prueba', false).order('validado_at', { ascending: false }).limit(15),
    ])
    setLista(p.data || []); setRecientes(r.data || [])
  }
  useEffect(() => { cargar(); const t = setInterval(cargar, 20000); return () => clearInterval(t) }, [])

  return (
    <>
      <p className="hint">
        {lista.length
          ? <><b>{lista.length}</b> voucher(s) esperando validación. Nada de esto suma en Cuotas hasta que lo valides.</>
          : 'No hay vouchers por validar.'}
      </p>
      {lista.map(r => (
        <TarjetaPago key={r.id} r={r} puede={puede} abierto={abierto === r.id}
          abrir={() => setAbierto(abierto === r.id ? null : r.id)}
          alTerminar={t => { setMsg(t); if (t.ok) { setAbierto(null); cargar() } }} />
      ))}
      {recientes.length > 0 && (
        <div className="glass table-wrap" style={{ marginTop: 16 }}>
          <p style={{ margin: '8px 10px' }}><b>Últimos revisados</b></p>
          <table>
            <thead><tr><th>Revisado</th><th>Cliente</th><th>Lote</th><th>Monto</th><th>Operación</th><th>Resultado</th></tr></thead>
            <tbody>
              {recientes.map(r => (
                <tr key={r.id}>
                  <td>{fHora(r.validado_at)}</td>
                  <td>{r.client?.full_name || '—'}</td>
                  <td>{loteDe(r.sale)}</td>
                  <td>{r.monto != null ? soles(r.monto) : '—'}</td>
                  <td>{r.numero_operacion || '—'}</td>
                  <td>{r.estado === 'validado' ? <span className="ok">✅ validado</span> : <span className="bad" title={r.motivo_rechazo || ''}>✖ rechazado: {r.motivo_rechazo}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function TarjetaPago({ r, puede, abierto, abrir, alTerminar }) {
  const nombre = capital((r.client?.full_name || '').split(' ')[0])
  const [ventas, setVentas] = useState([])
  const [cuentas, setCuentas] = useState([])
  const [cuotas, setCuotas] = useState([])
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState(() => ({
    sale: r.sale_id || '', monto: r.monto ?? '', fecha: r.fecha || '', op: r.numero_operacion || '',
    tipo: /yape|plin|billetera|lemon/i.test(r.banco || '') ? 'BILLETERA DIGITAL' : 'TRANSFERENCIA',
    cuenta: '', obs: '',
    aviso: `Hola ${nombre || ''}, su pago${r.monto ? ' de ' + soles(r.monto) : ''} fue validado y registrado. ¡Muchas gracias! — Urbis Group`,
  }))
  const campo = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  useEffect(() => {
    if (!abierto || !r.client_id) return
    supabase.from('sales').select('id, status, lot:lots(mz, lt, project_id, project:projects(name))')
      .or(`client_id.eq.${r.client_id},co_client_id.eq.${r.client_id}`).in('status', ['en_proceso', 'pagado'])
      .then(({ data }) => {
        setVentas(data || [])
        if (!r.sale_id && (data || []).filter(v => v.status === 'en_proceso').length === 1) setF(x => ({ ...x, sale: data.find(v => v.status === 'en_proceso').id }))
      })
  }, [abierto])
  const venta = ventas.find(v => v.id === f.sale)
  useEffect(() => {
    if (!venta) { setCuentas([]); setCuotas([]); return }
    supabase.from('financial_accounts').select('id, name, account_number').eq('project_id', venta.lot.project_id).eq('active', true)
      .then(({ data }) => setCuentas(data || []))
    supabase.from('installments').select('id, installment_number, amount, amount_paid, due_date, status')
      .eq('sale_id', venta.id).neq('status', 'pagado').order('installment_number')
      .then(({ data }) => setCuotas(data || []))
  }, [f.sale, ventas])

  // SOLO para mostrar: la regla real la aplica validar_pago_reportado en la base,
  // y es la misma de Cuotas (Payments.jsx → plan)
  const reparto = useMemo(() => {
    let resto = Math.round(Number(f.monto || 0) * 100) / 100
    const partes = []
    for (const q of cuotas) {
      if (resto <= 0.004) break
      const deuda = Math.round((Number(q.amount) - Number(q.amount_paid)) * 100) / 100
      if (deuda <= 0) continue
      const toma = Math.min(resto, deuda)
      partes.push({ n: q.installment_number, toma: Math.round(toma * 100) / 100, queda: Math.round((deuda - toma) * 100) / 100 })
      resto = Math.round((resto - toma) * 100) / 100
    }
    return { partes, sobra: resto }
  }, [cuotas, f.monto])

  async function validar() {
    if (!f.sale) { alTerminar({ ok: false, t: 'ELIGE EL LOTE AL QUE CORRESPONDE EL PAGO.' }); return }
    if (!(Number(f.monto) > 0) || !f.fecha) { alTerminar({ ok: false, t: 'FALTA EL MONTO O LA FECHA DEL PAGO.' }); return }
    if (reparto.sobra > 0.01) { alTerminar({ ok: false, t: 'EL MONTO SUPERA LA DEUDA DEL LOTE EN ' + soles(reparto.sobra) + '.' }); return }
    if (!confirm(`¿Registrar ${soles(f.monto)} en ${loteDe(venta)}?\n\nSe aplica a: ${reparto.partes.map(p => 'cuota ' + p.n).join(', ')}.`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('validar_pago_reportado', {
      rid: r.id, p_sale: f.sale, p_monto: Number(f.monto), p_fecha: f.fecha, p_operacion: f.op,
      p_tipo_op: f.tipo, p_cuenta: f.cuenta || null, p_obs: f.obs || null, p_mensaje: f.aviso.trim() || null,
    })
    setBusy(false)
    alTerminar(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: 'PAGO VALIDADO Y REGISTRADO EN CUOTAS' + (data?.cuotas ? ' (cuota ' + data.cuotas + ')' : '') + '.' })
  }

  async function rechazar() {
    const motivo = prompt('¿Por qué se rechaza este voucher? (queda en bitácora)')
    if (!motivo || motivo.trim().length < 4) return
    const aviso = prompt('Mensaje para el cliente (Cancelar = no enviar nada):',
      `Hola ${nombre || ''}, no pudimos validar su voucher: ${motivo.trim()}. ¿Nos envía una foto más clara o el comprobante correcto? Gracias.`)
    const { error } = await supabase.rpc('rechazar_pago_reportado', { rid: r.id, p_motivo: motivo, p_mensaje: aviso ? aviso.trim() : null })
    alTerminar(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: 'VOUCHER RECHAZADO' + (aviso ? '. SE LE AVISA AL CLIENTE.' : '.') })
  }

  const esPdf = /\.pdf(\?|$)/i.test(r.voucher_url || '')
  return (
    <div className="glass form-card" style={{ maxWidth: 'none', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ flex: '0 1 300px', minWidth: 200 }}>
        {!r.voucher_url ? <span className="muted">sin imagen</span>
          : esPdf ? <VisorDoc url={r.voucher_url} titulo="Voucher" alto={360} />
            : <a href={r.voucher_url} target="_blank" rel="noreferrer"><img src={r.voucher_url} alt="Voucher del cliente" style={{ width: '100%', borderRadius: 8, background: '#fff' }} /></a>}
      </div>
      <div style={{ flex: '1 1 380px' }}>
        <p style={{ margin: 0 }}><b>{r.client?.full_name || 'Cliente sin identificar'}</b> <span className="muted small">+{r.chat?.phone || '—'} · {fHora(r.created_at)}</span></p>
        <p className="small" style={{ margin: '6px 0', textTransform: 'none' }}>
          El agente leyó: <b>{r.monto != null ? soles(r.monto) : 'monto ilegible'}</b> · {fCorta(r.fecha)} · operación <b>{r.numero_operacion || '—'}</b> · {r.banco || '—'}{r.titular ? ' · ' + r.titular : ''}
          <br />Lote: {r.sale ? loteDe(r.sale) + ' · ' + (r.sale.lot?.project?.name || '') : <span className="warn">sin definir</span>}
        </p>
        {r.alerta && <p className="warn small" style={{ margin: '6px 0' }}>⚠ {r.alerta}</p>}

        {puede && !abierto && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={abrir}>Revisar y validar</button>
            <button className="btn-ghost" onClick={rechazar}>Rechazar…</button>
          </div>
        )}
        {puede && abierto && (
          <div className="form-grid" style={{ marginTop: 8 }}>
            <label>Lote
              <select value={f.sale} onChange={campo('sale')}>
                <option value="">- elegir -</option>
                {ventas.map(v => <option key={v.id} value={v.id}>{loteDe(v)} · {v.lot?.project?.name}{v.status === 'pagado' ? ' (ya pagado)' : ''}</option>)}
              </select>
            </label>
            <label>Monto S/<input type="number" step="0.01" value={f.monto} onChange={campo('monto')} /></label>
            <label>Fecha del pago<input type="date" value={f.fecha} max={hoyLima()} onChange={campo('fecha')} /></label>
            <label>N° de operación<input value={f.op} onChange={campo('op')} style={{ textTransform: 'none' }} /></label>
            <label>Tipo
              <select value={f.tipo} onChange={campo('tipo')}>{TIPOS_OP.map(t => <option key={t}>{t}</option>)}</select>
            </label>
            <label>Cuenta que recibió
              <select value={f.cuenta} onChange={campo('cuenta')}>
                <option value="">- sin especificar -</option>
                {cuentas.map(c => <option key={c.id} value={c.id}>{c.name}{c.account_number ? ' · ' + c.account_number : ''}</option>)}
              </select>
            </label>
            <label className="span2">Observación (opcional)<input value={f.obs} onChange={campo('obs')} /></label>
            <label className="span2">Mensaje al cliente (sale si la conversación sigue abierta; vacío = no enviar)
              <textarea rows="2" value={f.aviso} onChange={campo('aviso')} style={{ textTransform: 'none' }} />
            </label>
            <div className="span2 small" style={{ textTransform: 'none' }}>
              {reparto.partes.length
                ? <>Se aplica a: {reparto.partes.map(p => `cuota ${p.n} (${soles(p.toma)}${p.queda > 0 ? ', le quedan ' + soles(p.queda) : ''})`).join(' · ')}</>
                : <span className="muted">Elige el lote y el monto para ver a qué cuotas se aplica.</span>}
              {reparto.sobra > 0.01 && <b className="bad"> · SOBRAN {soles(reparto.sobra)}: el monto supera la deuda</b>}
            </div>
            <div className="span2" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn-primary" disabled={busy} onClick={validar}>{busy ? 'Registrando…' : '✅ Validar y registrar'}</button>
              <button className="btn-ghost" onClick={rechazar}>Rechazar…</button>
              <button className="btn-ghost" onClick={abrir}>Cerrar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// PROMESAS Y VENCIMIENTOS
// ============================================================================
function Promesas({ puede, setMsg }) {
  const [vigentes, setVigentes] = useState([])
  const [semana, setSemana] = useState([])
  const [cerradas, setCerradas] = useState([])

  async function cargar() {
    const hoy = hoyLima()
    const [a, b, c] = await Promise.all([
      supabase.from('cobranza_promesas')
        .select('id, fecha_promesa, monto, texto_cliente, origen, avisar_dias_antes, aviso_enviado_at, created_at, client:clients(full_name), sale:sales(lot:lots(mz, lt, project:projects(name)))')
        .eq('estado', 'vigente').eq('es_prueba', false).order('fecha_promesa'),
      supabase.from('installments')
        .select('id, installment_number, amount, amount_paid, due_date, sale:sales!inner(id, status, client:clients!sales_client_id_fkey(full_name), lot:lots(mz, lt, project:projects(name)))')
        .gte('due_date', hoy).lte('due_date', sumarDias(hoy, 7)).neq('status', 'pagado').eq('sale.status', 'en_proceso')
        .order('due_date').limit(500),
      supabase.from('cobranza_promesas')
        .select('id, fecha_promesa, monto, estado, cerrado_at, client:clients(full_name), sale:sales(lot:lots(mz, lt))')
        .in('estado', ['cumplida', 'incumplida']).eq('es_prueba', false).order('cerrado_at', { ascending: false }).limit(20),
    ])
    setVigentes(a.data || []); setSemana(b.data || []); setCerradas(c.data || [])
  }
  useEffect(() => { cargar() }, [])

  async function cambiar(p, campos, t) {
    const { error } = await supabase.from('cobranza_promesas').update(campos).eq('id', p.id)
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t })
    cargar()
  }

  return (
    <>
      <div className="glass table-wrap">
        <p style={{ margin: '8px 10px' }}><b>Promesas de pago vigentes ({vigentes.length})</b> <span className="muted small">— mientras una promesa esté vigente, ese lote no recibe los avisos de siempre</span></p>
        <table>
          <thead><tr><th>Prometió pagar</th><th>Cliente</th><th>Lote</th><th>Monto</th><th>Lo que dijo</th><th>Recordar antes</th><th>Recordatorio</th><th></th></tr></thead>
          <tbody>
            {vigentes.map(p => {
              const d = diasHasta(p.fecha_promesa)
              return (
                <tr key={p.id}>
                  <td><b>{fCorta(p.fecha_promesa)}</b><br /><span className={d < 0 ? 'bad small' : d === 0 ? 'warn small' : 'muted small'}>{d < 0 ? 'venció' : d === 0 ? 'HOY' : 'faltan ' + d + ' d'}</span></td>
                  <td>{p.client?.full_name}</td>
                  <td>{loteDe(p.sale)}<br /><span className="muted small">{p.sale?.lot?.project?.name}</span></td>
                  <td>{p.monto ? soles(p.monto) : '—'}</td>
                  <td className="small" style={{ textTransform: 'none', maxWidth: 260 }}>{p.texto_cliente || '—'}{p.origen === 'secretaria' ? ' (secretaria)' : ''}</td>
                  <td>
                    <input type="number" min="0" max="15" disabled={!puede} defaultValue={p.avisar_dias_antes ?? ''} placeholder="config" style={{ width: 70 }}
                      onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (p.avisar_dias_antes ?? null)) cambiar(p, { avisar_dias_antes: v }, 'RECORDATORIO AJUSTADO') }} /> días
                  </td>
                  <td className="small">{p.aviso_enviado_at ? '✅ ' + fHora(p.aviso_enviado_at) : 'pendiente'}</td>
                  <td>
                    {puede && <>
                      <button className="link-btn" onClick={() => cambiar(p, { estado: 'cumplida', cerrado_at: new Date().toISOString() }, 'PROMESA MARCADA COMO CUMPLIDA')}>cumplida</button>{' · '}
                      <button className="link-btn bad" onClick={() => confirm('¿Cancelar esta promesa? El lote vuelve a recibir los avisos normales.') && cambiar(p, { estado: 'cancelada', cerrado_at: new Date().toISOString() }, 'PROMESA CANCELADA')}>cancelar</button>
                    </>}
                  </td>
                </tr>
              )
            })}
            {!vigentes.length && <tr><td colSpan="8" className="muted">No hay promesas vigentes.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="glass table-wrap" style={{ marginTop: 16 }}>
        <p style={{ margin: '8px 10px' }}><b>Cuotas que vencen en los próximos 7 días ({semana.length})</b></p>
        <table>
          <thead><tr><th>Vence</th><th>Cliente</th><th>Lote</th><th>Proyecto</th><th>Cuota</th><th>Pendiente</th></tr></thead>
          <tbody>
            {semana.map(q => (
              <tr key={q.id}>
                <td>{fCorta(q.due_date)}{diasHasta(q.due_date) === 0 ? <span className="warn small"> HOY</span> : ''}</td>
                <td>{q.sale?.client?.full_name}</td>
                <td>{loteDe(q.sale)}</td>
                <td>{q.sale?.lot?.project?.name}</td>
                <td>N° {q.installment_number}</td>
                <td>{soles(Number(q.amount) - Number(q.amount_paid))}</td>
              </tr>
            ))}
            {!semana.length && <tr><td colSpan="6" className="muted">Nada vence en los próximos 7 días.</td></tr>}
          </tbody>
        </table>
      </div>

      {cerradas.length > 0 && (
        <div className="glass table-wrap" style={{ marginTop: 16 }}>
          <p style={{ margin: '8px 10px' }}><b>Promesas cerradas recientes</b></p>
          <table>
            <thead><tr><th>Prometida</th><th>Cliente</th><th>Lote</th><th>Monto</th><th>Resultado</th></tr></thead>
            <tbody>
              {cerradas.map(p => (
                <tr key={p.id}>
                  <td>{fCorta(p.fecha_promesa)}</td><td>{p.client?.full_name}</td><td>{loteDe(p.sale)}</td>
                  <td>{p.monto ? soles(p.monto) : '—'}</td>
                  <td>{p.estado === 'cumplida' ? <span className="ok">✅ cumplió</span> : <span className="bad">✖ no cumplió</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ============================================================================
// CONVERSACIONES
// ============================================================================
function Burbujas({ msgs }) {
  const fin = useRef(null)
  useEffect(() => { fin.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '6px 2px', minHeight: 260 }}>
      {msgs.map(m => {
        const sale = m.direccion === 'out'
        const fondo = !sale ? 'rgba(255,255,255,.07)' : m.autor === 'agente' ? 'rgba(88,196,130,.18)' : m.autor === 'plantilla' ? 'rgba(224,179,76,.16)' : 'rgba(123,167,247,.18)'
        return (
          <div key={m.id} style={{ display: 'flex', justifyContent: sale ? 'flex-end' : 'flex-start', margin: '4px 0' }}>
            <div style={{ maxWidth: '78%', padding: '6px 10px', borderRadius: 10, background: fondo, whiteSpace: 'pre-wrap', textTransform: 'none', fontSize: 13 }}>
              {AUTOR[m.autor] && <div className="muted" style={{ fontSize: 10 }}>{AUTOR[m.autor]}</div>}
              {m.media_url && (m.media_type === 'image'
                ? <a href={m.media_url} target="_blank" rel="noreferrer"><img src={m.media_url} alt="adjunto" style={{ maxWidth: 220, borderRadius: 6, display: 'block', marginBottom: 4 }} /></a>
                : <div><a href={m.media_url} target="_blank" rel="noreferrer">📎 {m.media_name || 'adjunto'}</a></div>)}
              {m.texto}
              <div className="muted" style={{ fontSize: 10, textAlign: 'right' }}>
                {fHora(m.created_at)}{sale && m.estado ? ' · ' + m.estado : ''}
                {m.tokens_in ? ` · ${(m.tokens_in || 0) + (m.tokens_cache || 0)}/${m.tokens_out || 0} tokens` : ''}
              </div>
              {m.error && <div className="bad" style={{ fontSize: 11 }}>⚠ {m.error}</div>}
            </div>
          </div>
        )
      })}
      <div ref={fin} />
    </div>
  )
}

function Conversaciones({ puede, profile, setMsg }) {
  const [chats, setChats] = useState([])
  const [nombres, setNombres] = useState({})
  const [sel, setSel] = useState(null)
  const [msgs, setMsgs] = useState([])
  const [txt, setTxt] = useState('')
  const [filtro, setFiltro] = useState('todos')

  async function cargarChats() {
    const { data } = await supabase.from('cobranza_chats').select('*').eq('es_prueba', false)
      .order('ultimo_mensaje_at', { ascending: false, nullsFirst: false }).limit(200)
    setChats(data || [])
    const ids = [...new Set((data || []).flatMap(c => c.client_ids || []))]
    if (ids.length) {
      const { data: cl } = await supabase.from('clients').select('id, full_name').in('id', ids)
      setNombres(Object.fromEntries((cl || []).map(c => [c.id, c.full_name])))
    }
  }
  async function cargarMsgs(id) {
    const { data } = await supabase.from('cobranza_mensajes').select('*').eq('chat_id', id).order('created_at', { ascending: false }).limit(200)
    setMsgs((data || []).reverse())
  }
  useEffect(() => { cargarChats(); const t = setInterval(cargarChats, 10000); return () => clearInterval(t) }, [])
  useEffect(() => {
    if (!sel) return
    cargarMsgs(sel)
    if (puede) supabase.from('cobranza_chats').update({ no_leidos: 0 }).eq('id', sel).then(() => {}, () => {})
    const t = setInterval(() => cargarMsgs(sel), 5000)
    return () => clearInterval(t)
  }, [sel])

  const chat = chats.find(c => c.id === sel)
  const titulo = c => (c.client_ids || []).map(id => nombres[id]).filter(Boolean).join(' / ') || c.nombre_whatsapp || 'Número no registrado'

  async function cambiarModo(modo) {
    const campos = modo === 'humano'
      ? { modo: 'humano', motivo_humano: 'la tomó la secretaria desde el panel', humano_desde: new Date().toISOString(), humano_por: profile?.id || null }
      : { modo: 'agente', motivo_humano: null, humano_desde: null, humano_por: null }
    const { error } = await supabase.from('cobranza_chats').update(campos).eq('id', sel)
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: modo === 'humano' ? 'CHAT TOMADO: EL AGENTE YA NO RESPONDE AQUÍ.' : 'CHAT DEVUELTO AL AGENTE.' })
    cargarChats()
  }
  async function enviar(e) {
    e.preventDefault()
    const t = txt.trim()
    if (!t) return
    const { error } = await supabase.from('cobranza_mensajes').insert({ chat_id: sel, direccion: 'out', autor: 'secretaria', texto: t, estado: 'pendiente', enviado_por: profile?.id || null })
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setTxt('')
    cargarMsgs(sel)
  }

  const visibles = chats.filter(c => filtro === 'todos' || c.modo === filtro)
  const paraSecretaria = chats.filter(c => c.modo === 'humano').length
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
      <div className="glass" style={{ flex: '1 1 260px', maxWidth: 380, maxHeight: '72vh', overflowY: 'auto', padding: 8 }}>
        <select value={filtro} onChange={e => setFiltro(e.target.value)} style={{ width: '100%', marginBottom: 6 }}>
          <option value="todos">Todas ({chats.length})</option>
          <option value="humano">👩 Para la secretaria ({paraSecretaria})</option>
          <option value="agente">🤖 Con el agente</option>
        </select>
        {visibles.map(c => (
          <div key={c.id} onClick={() => setSel(c.id)}
            style={{ padding: '8px 6px', cursor: 'pointer', borderRadius: 6, background: sel === c.id ? 'rgba(255,255,255,.08)' : 'transparent' }}>
            <b>{titulo(c)}</b>{c.no_leidos > 0 && <span className="warn"> ({c.no_leidos})</span>}
            <div className="muted small">+{c.phone} · {c.modo === 'humano' ? '👩 secretaria' : '🤖 agente'} · {fHora(c.ultimo_mensaje_at)}</div>
            {c.modo === 'humano' && c.motivo_humano && <div className="small warn" style={{ textTransform: 'none' }}>{c.motivo_humano}</div>}
          </div>
        ))}
        {!visibles.length && <p className="muted small">Todavía no hay conversaciones.</p>}
      </div>

      <div className="glass" style={{ flex: '3 1 380px', display: 'flex', flexDirection: 'column', maxHeight: '72vh', padding: 10 }}>
        {!chat ? <p className="muted">Elige una conversación.</p> : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid rgba(255,255,255,.08)', paddingBottom: 6 }}>
              <div style={{ flex: 1 }}>
                <b>{titulo(chat)}</b> <span className="muted small">+{chat.phone}</span>
                <div className="small">{chat.modo === 'humano' ? '👩 La atiende la secretaria' + (chat.motivo_humano ? ' — ' + chat.motivo_humano : '') : '🤖 La atiende el agente'}</div>
              </div>
              {puede && (chat.modo === 'humano'
                ? <button className="btn-ghost" onClick={() => cambiarModo('agente')}>Devolver al agente</button>
                : <button className="btn-ghost" onClick={() => cambiarModo('humano')}>Tomar yo</button>)}
            </div>
            <Burbujas msgs={msgs} />
            {puede && (ventanaAbierta(chat)
              ? (
                <form onSubmit={enviar} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input value={txt} onChange={e => setTxt(e.target.value)} placeholder="Escribir al cliente (el agente se calla en este chat)" style={{ flex: 1, textTransform: 'none' }} />
                  <button className="btn-primary">Enviar</button>
                </form>
              )
              : <p className="muted small" style={{ marginTop: 6 }}>Pasaron más de 24 h desde el último mensaje del cliente: Meta solo deja escribirle con una plantilla. Cuando él escriba, se abre de nuevo.</p>)}
          </>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// PROBAR (datos reales, nada sale por WhatsApp)
// ============================================================================
function Probar({ puede, vivo, setMsg }) {
  const [q, setQ] = useState('')
  const [opciones, setOpciones] = useState([])
  const [cli, setCli] = useState(null)
  const [msgs, setMsgs] = useState([])
  const [txt, setTxt] = useState('')
  const [subiendo, setSubiendo] = useState(false)

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 3) { setOpciones([]); return }
      const { data } = await supabase.from('clients').select('id, full_name, doc_number, phone, phone_valid, phone_bot, phone2, phone2_valid, phone2_bot')
        .ilike('full_name', '%' + q.trim() + '%').order('full_name').limit(15)
      setOpciones(data || [])
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  // el mismo criterio del agente: solo un celular validado y marcado para el bot
  const telDe = c => {
    const t = String((c.phone && c.phone_valid && c.phone_bot !== false) ? c.phone : (c.phone2 && c.phone2_valid && c.phone2_bot) ? c.phone2 : '').replace(/\D/g, '')
    return t.length === 9 ? '51' + t : t
  }
  const tel = cli ? telDe(cli) : ''

  async function cargar() {
    if (!tel) { setMsgs([]); return }
    const { data: c } = await supabase.from('cobranza_chats').select('id').eq('phone', tel).eq('es_prueba', true).maybeSingle()
    if (!c) { setMsgs([]); return }
    const { data } = await supabase.from('cobranza_mensajes').select('*').eq('chat_id', c.id).order('created_at', { ascending: false }).limit(100)
    setMsgs((data || []).reverse())
  }
  useEffect(() => { cargar(); if (!tel) return; const t = setInterval(cargar, 3000); return () => clearInterval(t) }, [tel])

  async function mandar(extra) {
    const { error } = await supabase.from('cobranza_pruebas').insert({ client_id: cli.id, phone: tel, ...extra })
    if (error) setMsg({ ok: false, t: 'ERROR: ' + error.message })
  }
  async function enviarTxt(e) { e.preventDefault(); const t = txt.trim(); if (!t) return; setTxt(''); await mandar({ texto: t }) }
  async function subir(file) {
    setSubiendo(true)
    try {
      const url = await upload('cobranza/pruebas', file)
      await mandar({ texto: null, media_url: url, media_type: /pdf/i.test(file.type) ? 'document' : 'image' })
    } catch (e) { setMsg({ ok: false, t: 'ERROR AL SUBIR: ' + (e.message || e) }) }
    setSubiendo(false)
  }

  if (!puede) return <p className="muted">Probar el agente es de la responsable de cobranza.</p>
  return (
    <>
      <p className="hint" style={{ textTransform: 'none' }}>
        Escribe como si fueras el cliente. El agente usa sus <b>datos reales</b> pero <b>no le envía nada</b> por WhatsApp; los vouchers y promesas de prueba no aparecen en "Por validar".
        {!vivo && <span className="bad"> El proceso del agente no está corriendo: los mensajes quedan en espera.</span>}
      </p>
      <div className="glass form-card" style={{ maxWidth: 'none' }}>
        <label>Cliente
          <input value={q} onChange={e => { setQ(e.target.value); setCli(null) }} placeholder="Busca por nombre (mínimo 3 letras)" />
        </label>
        {!cli && opciones.map(c => (
          <div key={c.id} className="small" style={{ padding: '4px 0', cursor: 'pointer' }} onClick={() => { setCli(c); setQ(c.full_name) }}>
            {c.full_name} · DNI {c.doc_number} · {telDe(c) ? '+' + telDe(c) : <span className="warn">sin celular validado</span>}
          </div>
        ))}
        {cli && !tel && <p className="warn small">Este cliente no tiene un celular validado y marcado para el bot: en la vida real el agente le respondería que el número no está registrado y no le daría ningún dato.</p>}
      </div>
      {cli && tel && (
        <div className="glass" style={{ display: 'flex', flexDirection: 'column', maxHeight: '64vh', padding: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <b style={{ flex: 1 }}>{cli.full_name} <span className="muted small">+{tel} · PRUEBA</span></b>
            <button className="btn-ghost" onClick={() => mandar({ texto: '/aviso' })}>📨 ¿Qué aviso le toca hoy?</button>
            <button className="btn-ghost" onClick={() => confirm('¿Borrar esta conversación de prueba y empezar de cero?') && mandar({ texto: '/reiniciar' })}>♻️ Reiniciar</button>
          </div>
          <Burbujas msgs={msgs} />
          <form onSubmit={enviarTxt} style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <input value={txt} onChange={e => setTxt(e.target.value)} placeholder='Ej: "cuánto debo", "no podré pagar el 30, pago el 15"' style={{ flex: 1, minWidth: 200, textTransform: 'none' }} />
            <button className="btn-primary">Enviar</button>
            <label className="btn-ghost" style={{ cursor: 'pointer' }}>{subiendo ? 'Subiendo…' : '📷 Voucher'}
              <input type="file" accept="image/*,.pdf" hidden disabled={subiendo} onChange={e => e.target.files[0] && subir(e.target.files[0])} />
            </label>
          </form>
        </div>
      )}
    </>
  )
}

// ============================================================================
// CONFIGURACION
// ============================================================================
function Configuracion({ cfg, puede, profile, recargar, setMsg }) {
  const [f, setF] = useState(null)
  const [uso, setUso] = useState(null)
  const [envHoy, setEnvHoy] = useState(null)

  useEffect(() => {
    if (!cfg || f) return
    setF({ ...cfg, dias_antes: (cfg.dias_antes || []).join(', '), dias_despues: (cfg.dias_despues || []).join(', '), hora_avisos: String(cfg.hora_avisos || '09:00').slice(0, 5) })
  }, [cfg])
  useEffect(() => {
    (async () => {
      const hoy = hoyLima()
      const mes = new Date(hoy.slice(0, 7) + '-01T05:00:00Z').toISOString()
      let tin = 0, tout = 0, tcache = 0, n = 0
      for (let desde = 0; desde < 100000; desde += 1000) {   // paginado: Supabase corta a las 1000 filas sin avisar
        const { data } = await supabase.from('cobranza_mensajes').select('tokens_in, tokens_out, tokens_cache')
          .eq('autor', 'agente').gte('created_at', mes).order('created_at').range(desde, desde + 999)
        for (const m of (data || [])) { tin += m.tokens_in || 0; tout += m.tokens_out || 0; tcache += m.tokens_cache || 0; n++ }
        if (!data || data.length < 1000) break
      }
      setUso({ n, usd: tin * PRECIO.in / 1e6 + tout * PRECIO.out / 1e6 + tcache * PRECIO.cache / 1e6 })
      const { count } = await supabase.from('cobranza_envios').select('id', { count: 'exact', head: true }).gte('created_at', new Date(hoy + 'T05:00:00Z').toISOString())
      setEnvHoy(count ?? 0)
    })()
  }, [])

  const lista = s => [...new Set(String(s || '').split(/[,\s]+/).map(x => parseInt(x, 10)).filter(n => Number.isInteger(n) && n >= 0 && n <= 120))]
  const campo = k => e => setF(x => ({ ...x, [k]: e.target.value }))

  async function guardar(campos, t = 'CONFIGURACIÓN GUARDADA') {
    const { error } = await supabase.from('cobranza_config').update({ ...campos, updated_at: new Date().toISOString(), updated_by: profile?.id || null }).eq('id', 1)
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t })
    recargar()
    return !error
  }
  async function interruptor(k, on) {
    if (on && k === 'avisos_activos' && !(cfg.plantilla_recordatorio || cfg.plantilla_vence_hoy || cfg.plantilla_vencida)) {
      alert('Primero escribe (y guarda) los nombres de las plantillas aprobadas por Meta.')
      return
    }
    if (on && !confirm(k === 'agente_activo'
      ? '¿Prender el agente?\n\nDesde ahora contesta a TODOS los clientes que escriban al número de cobranza.'
      : '¿Prender los avisos?\n\nDesde la hora configurada saldrán plantillas a los clientes con cuotas por vencer o vencidas.')) return
    if (await guardar({ [k]: on }, on ? (k === 'agente_activo' ? 'AGENTE PRENDIDO' : 'AVISOS PRENDIDOS') : (k === 'agente_activo' ? 'AGENTE APAGADO' : 'AVISOS APAGADOS')))
      setF(x => ({ ...x, [k]: on }))
  }
  function guardarForm(e) {
    e.preventDefault()
    const txt = v => (v || '').trim() || null
    guardar({
      hora_avisos: f.hora_avisos, tope_diario: Number(f.tope_diario), dias_antes: lista(f.dias_antes), dias_despues: lista(f.dias_despues),
      repetir_cada: Number(f.repetir_cada), promesa_avisar_dias: Number(f.promesa_avisar_dias), promesa_max_dias: Number(f.promesa_max_dias),
      plantilla_recordatorio: txt(f.plantilla_recordatorio), plantilla_vence_hoy: txt(f.plantilla_vence_hoy),
      plantilla_vencida: txt(f.plantilla_vencida), plantilla_promesa: txt(f.plantilla_promesa),
      plantilla_idioma: txt(f.plantilla_idioma) || 'es', notas_agente: txt(f.notas_agente),
      ...('grave_desde_cuotas' in cfg ? {                                        // sql/90
        plantilla_vencida_grave: txt(f.plantilla_vencida_grave),
        grave_desde_cuotas: Math.min(12, Math.max(2, Number(f.grave_desde_cuotas) || 4)),
      } : {}),
      ...('numero_cobranza' in cfg ? { numero_cobranza: String(f.numero_cobranza || '').replace(/\D/g, '') || '51986598614' } : {}),   // sql/77
    })
  }
  if (!f) return null
  const info = cfg.latido_info || {}

  return (
    <>
      <div className="glass form-card" style={{ maxWidth: 'none' }}>
        <p><b>Interruptores</b></p>
        <label className="inline-check" style={{ display: 'flex', margin: '6px 0' }}>
          <input type="checkbox" disabled={!puede} checked={!!cfg.agente_activo} onChange={e => interruptor('agente_activo', e.target.checked)} />
          🤖 <b>Agente</b>: contesta a los clientes que escriben al número de cobranza
        </label>
        <label className="inline-check" style={{ display: 'flex', margin: '6px 0' }}>
          <input type="checkbox" disabled={!puede} checked={!!cfg.avisos_activos} onChange={e => interruptor('avisos_activos', e.target.checked)} />
          📨 <b>Avisos</b>: plantillas automáticas antes y después del vencimiento
        </label>
        <p className="small muted" style={{ textTransform: 'none' }}>
          Proceso: {cfg.latido ? 'último latido ' + fHora(cfg.latido) : 'nunca reportó'} · WhatsApp {info.whatsapp ? '✅' : '❌ sin token'} · Claude {info.ia ? (info.clave_ia_propia ? '✅ clave propia' : '⚠ usando la clave general') : '❌ sin clave'} · Telegram {info.telegram ? '✅' : '—'}
          <br />Avisos enviados hoy: {envHoy ?? '…'} de {cfg.tope_diario} · Último barrido: {cfg.ultimo_barrido ? fCorta(cfg.ultimo_barrido) : 'nunca'}
          <br />Consumo del agente este mes: {uso ? `${uso.n} respuestas · aprox. US$ ${uso.usd.toFixed(2)}` : '…'} <span className="muted">(Claude Haiku; lo exacto está en la consola de Anthropic)</span>
        </p>
      </div>

      <form className="glass form-card" style={{ maxWidth: 'none' }} onSubmit={guardarForm}>
        <p><b>Avisos y promesas</b></p>
        <div className="form-grid">
          <label>Días ANTES de vencer (0 = el mismo día)<input value={f.dias_antes} onChange={campo('dias_antes')} disabled={!puede} placeholder="3, 0" /></label>
          <label>Días DESPUÉS de vencida<input value={f.dias_despues} onChange={campo('dias_despues')} disabled={!puede} placeholder="2, 5" /></label>
          <label>Después, repetir cada (días)<input type="number" min="1" value={f.repetir_cada} onChange={campo('repetir_cada')} disabled={!puede} /></label>
          <label>Hora de envío (Lima)<input type="time" value={f.hora_avisos} onChange={campo('hora_avisos')} disabled={!puede} /></label>
          <label>Tope de avisos por día<input type="number" min="0" value={f.tope_diario} onChange={campo('tope_diario')} disabled={!puede} /></label>
          <label>Promesa: recordar N días antes<input type="number" min="0" max="15" value={f.promesa_avisar_dias} onChange={campo('promesa_avisar_dias')} disabled={!puede} /></label>
          <label>Promesa: el agente acepta hasta (días)<input type="number" min="1" max="120" value={f.promesa_max_dias} onChange={campo('promesa_max_dias')} disabled={!puede} /></label>
          <label>Idioma de las plantillas<input value={f.plantilla_idioma || ''} onChange={campo('plantilla_idioma')} disabled={!puede} style={{ textTransform: 'none' }} /></label>
          <label>Número de cobranzas (el bot de leads se lo pasa a los clientes)<input value={f.numero_cobranza || ''} onChange={campo('numero_cobranza')} disabled={!puede} placeholder="51986598614" /></label>
        </div>
        <p className="small muted" style={{ textTransform: 'none' }}>Meta pone un tope de 250 conversaciones iniciadas por día mientras el negocio no esté verificado: deja el tope por debajo.</p>

        <p><b>Nombres de las plantillas aprobadas en Meta</b> <span className="muted small">(exactos; vacío = ese aviso no sale)</span></p>
        <div className="form-grid">
          <label>Recordatorio antes de vencer<input value={f.plantilla_recordatorio || ''} onChange={campo('plantilla_recordatorio')} disabled={!puede} placeholder="urbis_cuota_recordatorio" style={{ textTransform: 'none' }} /></label>
          <label>Vence hoy<input value={f.plantilla_vence_hoy || ''} onChange={campo('plantilla_vence_hoy')} disabled={!puede} placeholder="urbis_cuota_vence_hoy" style={{ textTransform: 'none' }} /></label>
          <label>Cuota vencida<input value={f.plantilla_vencida || ''} onChange={campo('plantilla_vencida')} disabled={!puede} placeholder="urbis_cuota_vencida" style={{ textTransform: 'none' }} /></label>
          <label>Recordatorio de promesa<input value={f.plantilla_promesa || ''} onChange={campo('plantilla_promesa')} disabled={!puede} placeholder="urbis_promesa_pago" style={{ textTransform: 'none' }} /></label>
          {'grave_desde_cuotas' in cfg && <>
            <label>Varias cuotas vencidas <span className="muted small">(reemplaza al de arriba)</span><input value={f.plantilla_vencida_grave || ''} onChange={campo('plantilla_vencida_grave')} disabled={!puede} placeholder="urbis_cuotas_atrasadas" style={{ textTransform: 'none' }} /></label>
            <label>…desde cuántas cuotas vencidas<input type="number" min="2" max="12" value={f.grave_desde_cuotas ?? 4} onChange={campo('grave_desde_cuotas')} disabled={!puede} /></label>
          </>}
        </div>
        {'grave_desde_cuotas' in cfg && <p className="small muted" style={{ textTransform: 'none' }}>
          Al llegar a esa cantidad de cuotas vencidas, el cliente recibe el aviso que menciona la <b>resolución del contrato</b> en vez del recordatorio normal (nunca los dos).
          El contrato considera incumplimiento grave <b>2 cuotas seguidas o 3 acumuladas</b>: por encima de 4 el aviso llega tarde.
        </p>}

        <label style={{ marginTop: 10, display: 'block' }}>Indicaciones para el agente <span className="muted small">(horario de atención, cómo se llama la secretaria, avisos del mes…)</span>
          <textarea rows="4" value={f.notas_agente || ''} onChange={campo('notas_agente')} disabled={!puede} style={{ textTransform: 'none' }}
            placeholder="Ej: La secretaria de cobranzas atiende de lunes a sábado de 8 a 6. En feriados no se validan pagos hasta el día hábil siguiente." />
        </label>
        {puede && <button className="btn-primary" style={{ marginTop: 10 }}>Guardar configuración</button>}
      </form>
    </>
  )
}
