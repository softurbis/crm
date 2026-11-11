import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { upload } from '../lib/archivos'
import '../styles/gasto-directo.css'

// ============================================================
// REGISTRO DIRECTO DE GASTOS CON EL VOUCHER (sql/200, 11 nov 2026)
// ------------------------------------------------------------
// En los proyectos con `gasto_directo` (Las Praderas de Pucallpa) el gasto NO se
// solicita: se registra ya pagado, con su voucher, sin constancia ni firmas. Un mismo
// voucher puede cubrir VARIOS gastos (una transferencia de S/ 8,000 = 3 gastos) o ser
// una captura con varias operaciones.
//   1. se sube el voucher y la IA lo lee (una o varias operaciones)
//   2. se reparte el total en los gastos (tipo, motivo, quién recibe, monto)
//   3. se registran todos juntos: la base exige que sumen EXACTAMENTE el voucher, y que
//      la IA lo haya validado o que alguien marque que lo revisó
// ============================================================

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hoy = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10)
const dmy = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''
const espera = ms => new Promise(r => setTimeout(r, ms))
const aNumero = t => { const n = Number(String(t ?? '').replace(/[^\d.,]/g, '').replace(/,/g, '')); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null }
const r2 = n => Math.round(Number(n || 0) * 100) / 100
const ICONO = { ok: '✅', duda: '⚠️', mal: '❌' }
const faltaSql = e => /pedir_lectura_voucher_gastos|registrar_gastos_directos|schema cache|PGRST202/i.test(e || '')

export const TIPOS_GASTO = ['PAGO DE COMISION', 'GASTOS DE DESARROLLO', 'GASTOS ADMINISTRATIVOS', 'OTROS']
// atajos por gasto: tipo y el comienzo del motivo
const ATAJOS = [
  { t: '🤝 Comisión', tipo: 'PAGO DE COMISION', motivo: 'PAGO DE COMISION POR LA VENTA DEL LOTE ' },
  { t: '🧰 Obra / materiales', tipo: 'GASTOS DE DESARROLLO', motivo: '' },
  { t: '📅 Administrativo', tipo: 'GASTOS ADMINISTRATIVOS', motivo: '' },
  { t: '📣 Publicidad', tipo: 'GASTOS ADMINISTRATIVOS', motivo: 'PAGO DE PUBLICIDAD (ADS) DEL PROYECTO' },
  { t: '✏️ Otro', tipo: 'OTROS', motivo: '' },
]
const EJEMPLO = {
  'PAGO DE COMISION': 'PAGO DE COMISION POR LA VENTA DEL LOTE MZ B LT 7',
  'GASTOS DE DESARROLLO': 'SERVICIO DE EXCAVADORA PARA LA APERTURA DE CALLES',
  'GASTOS ADMINISTRATIVOS': 'PAGO DE LUZ E INTERNET DE LA OFICINA',
  OTROS: 'MOVILIDAD PARA LA ENTREGA DE LOTES',
}
const METODO_DE = { transferencia: 'TRANSFERENCIA', yape: 'YAPE', plin: 'PLIN', deposito: 'DEPOSITO', efectivo: 'EFECTIVO' }
// un nombre del voucher sirve de punto de partida solo si no está tapado con asteriscos
const nombreUsable = n => n && !/\*/.test(n) && n.trim().length >= 5 ? n.trim().toUpperCase() : ''
const lineaVacia = (extra = {}) => ({ tipo: '', motivo: '', receptor: '', dni: '', monto: '', operacion: '', ...extra })
// el atajo que corresponde a un gasto: primero el que coincide por el comienzo del motivo
// (Publicidad), si no el de ese tipo sin motivo (Administrativo)
const atajoDe = l => ATAJOS.find(a => a.tipo === l.tipo && a.motivo && String(l.motivo || '').startsWith(a.motivo.slice(0, 12)))
  || ATAJOS.find(a => a.tipo === l.tipo && !a.motivo)

export default function GastoDirecto({ proyecto, opcionesPersonas = [], onCerrar, onHecho }) {
  const pid = proyecto?.id
  const [file, setFile] = useState(null)
  const [vista, setVista] = useState(null)
  const [fase, setFase] = useState('elegir')          // elegir | leyendo | listo
  const [url, setUrl] = useState(null)
  const [lecturaId, setLecturaId] = useState(null)
  const [res, setRes] = useState(null)                 // fila de comprobante_lecturas, { estado: 'demora' } o { estado: 'error', error }
  const [manual, setManual] = useState(false)          // "el total no es ese": se escribe a mano
  const [totalEscrito, setTotalEscrito] = useState('')
  const [revisado, setRevisado] = useState(false)
  const [v, setV] = useState({ fecha: hoy(), metodo: 'TRANSFERENCIA', banco: '', operacion: '', nota: '', descuento: 'EL PROYECTO' })
  const [lineas, setLineas] = useState([lineaVacia()])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [falta, setFalta] = useState('')
  const vivo = useRef(true)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])

  useEffect(() => {
    if (!file || !String(file.type).startsWith('image/')) { setVista(null); return }
    const u = URL.createObjectURL(file)
    setVista(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  const L = res?.estado === 'listo' ? res.lectura : null
  const pagos = Array.isArray(L?.pagos) ? L.pagos : []
  const variasOps = pagos.length > 1
  const iaTotal = L?.monto != null ? r2(L.monto) : null
  // la IA leyó y no hay nada que no cuadre: el total es el que leyó (salvo que digan que no)
  const iaOk = res?.estado === 'listo' && res.alertas === 0 && iaTotal != null
  const aMano = !iaOk || manual
  const total = aMano ? aNumero(totalEscrito) : iaTotal
  const suma = r2(lineas.reduce((s, l) => s + (aNumero(l.monto) || 0), 0))
  const resta = total != null ? r2(total - suma) : null

  async function elegir(f) {
    if (!f) return
    setFile(f); setErr(''); setRes(null); setLecturaId(null); setUrl(null)
    setManual(false); setTotalEscrito(''); setRevisado(false); setFalta('')
    setFase('leyendo')
    let u = null
    try {
      u = await upload('gastos/sustentos/directo-' + pid, f)
      if (!vivo.current) return
      setUrl(u)
      const { data: id, error } = await supabase.rpc('pedir_lectura_voucher_gastos', { pid, url: u })
      if (error) throw new Error(faltaSql(error.message) ? 'Falta correr sql/200 en la base.' : error.message)
      setLecturaId(id)
      // el servidor la toma en ~3 s; la IA tarda unos segundos más
      const fin = Date.now() + 120000
      while (vivo.current && Date.now() < fin) {
        await espera(2000)
        let { data: fila, error: e2 } = await supabase.rpc('lectura_comprobante', { p_id: id })
        if (e2) ({ data: fila } = await supabase.from('comprobante_lecturas').select('estado, lectura, validacion, alertas, error').eq('id', id).maybeSingle())
        if (fila && (fila.estado === 'listo' || fila.estado === 'error')) {
          if (!vivo.current) return
          setRes(fila)
          if (fila.estado === 'listo') prellenar(fila.lectura)
          setFase('listo')
          return
        }
      }
      if (vivo.current) { setRes({ estado: 'demora' }); setFase('listo') }
    } catch (e) {
      if (!vivo.current) return
      // subido pero sin lectura: se sigue a mano (total escrito + "lo revisé")
      if (u) { setRes({ estado: 'error', error: e.message }); setFase('listo') }
      else { setErr(e.message); setFase('elegir'); setFile(null) }
    }
  }

  // lo que leyó la IA arranca el formulario: fecha, banco, operación y una fila por
  // operación (o una sola con el total). Todo se puede cambiar.
  function prellenar(lec) {
    if (!lec) return
    const ps = Array.isArray(lec.pagos) ? lec.pagos : []
    setV(x => ({
      ...x,
      fecha: lec.fecha || x.fecha,
      metodo: METODO_DE[lec.tipo] || x.metodo,
      banco: lec.banco_o_app ? String(lec.banco_o_app).toUpperCase() : x.banco,
      operacion: ps.length > 1 ? '' : (lec.numero_operacion || ''),
    }))
    // quien recibe, si el voucher lo dice entero; y su DNI si ya es conocido
    const conQuien = n => { const r = nombreUsable(n); return { receptor: r, dni: r ? dniDe(r) : '' } }
    if (ps.length > 1) {
      setLineas(ps.map(p => lineaVacia({ monto: p.monto != null ? String(p.monto) : '', operacion: p.numero_operacion || '', ...conQuien(p.destinatario_nombre) })))
    } else {
      setLineas([lineaVacia({ monto: lec.monto != null ? String(lec.monto) : '', ...conQuien(lec.destinatario_nombre) })])
    }
  }

  const dniDe = nombre => opcionesPersonas.find(([n]) => n === String(nombre || '').toUpperCase())?.[1] || ''
  const setLinea = (i, campo, valor) => { setFalta(''); setLineas(ls => ls.map((l, j) => j === i ? { ...l, [campo]: valor } : l)) }
  const elegirAtajo = (i, a) => { setFalta(''); setLineas(ls => ls.map((l, j) => j === i ? { ...l, tipo: a.tipo, motivo: a.motivo && !String(l.motivo || '').trim() ? a.motivo : l.motivo } : l)) }
  const agregar = () => {
    setFalta('')
    setLineas(ls => [...ls, lineaVacia({ monto: resta > 0 ? String(resta) : '' })])
  }
  const quitar = i => setLineas(ls => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)

  // por operación (captura con varias): cuánto de cada una ya se repartió
  const porOp = variasOps ? pagos.map(p => ({
    op: p.numero_operacion || '', monto: r2(p.monto),
    asignado: r2(lineas.filter(l => l.operacion && l.operacion === p.numero_operacion).reduce((s, l) => s + (aNumero(l.monto) || 0), 0)),
  })) : []

  function queFalta() {
    if (!url) return 'Sube el voucher.'
    if (!v.fecha) return 'Falta la fecha del pago.'
    if (total == null) return aMano ? 'Escribe el TOTAL que dice el voucher (míralo en la foto).' : 'Falta el total del voucher.'
    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i], q = lineas.length > 1 ? 'Gasto ' + (i + 1) + ': ' : ''
      if (!l.tipo) return q + 'elige qué se pagó (tipo de gasto).'
      if (String(l.motivo || '').trim().length < 4) return q + 'escribe el motivo.'
      if (String(l.receptor || '').trim().length < 3) return q + 'escribe quién recibió el dinero.'
      if (!aNumero(l.monto)) return q + 'falta el monto.'
    }
    if (Math.abs(suma - total) >= 0.005) return 'Los gastos suman ' + soles(suma) + ' y el voucher es de ' + soles(total) + (suma < total ? ': falta repartir ' + soles(total - suma) + '.' : ': sobran ' + soles(suma - total) + '.')
    if (aMano && !revisado) return 'Marca que revisaste el voucher.'
    return ''
  }

  async function registrar() {
    const t = queFalta()
    if (t) { setFalta(t); return }
    setBusy(true); setErr('')
    const gastos = lineas.map(l => ({
      tipo: l.tipo, motivo: l.motivo.trim(), receptor: l.receptor.trim(), dni: (l.dni || '').trim() || null,
      monto: aNumero(l.monto), operacion: (l.operacion || '').trim() || null,
    }))
    const { data, error } = await supabase.rpc('registrar_gastos_directos', {
      pid, url, fecha: v.fecha, monto: total, gastos,
      metodo: v.metodo || null, banco: (v.banco || '').trim() || null, operacion: (v.operacion || '').trim() || null,
      nota: (v.nota || '').trim() || null, descuento: v.descuento || null,
      lectura: lecturaId, revisado: aMano ? revisado : false,
    })
    setBusy(false)
    if (error) { setErr(faltaSql(error.message) ? 'Falta correr sql/200 en la base.' : error.message); return }
    const nums = (data?.numeros || []).map(n => 'GAS-' + String(n).padStart(5, '0'))
    onHecho?.('✔ ' + (gastos.length === 1 ? 'GASTO REGISTRADO' : gastos.length + ' GASTOS REGISTRADOS') + ' CON EL VOUCHER DE ' + soles(total)
      + (nums.length ? ' (' + (nums.length > 1 ? nums[0] + ' a ' + nums[nums.length - 1] : nums[0]) + ')' : '')
      + '. Ya figuran pagados; el RH o la factura se sube en cada uno.')
  }

  const lectura = () => {
    if (fase === 'leyendo') return <div className="gd-leyendo">⏳ Subiendo y leyendo el voucher con IA…<div className="muted small">Tarda unos segundos.</div></div>
    if (!res) return null
    if (res.estado !== 'listo') return (
      <div className="gd-aviso warn">
        {res.estado === 'demora' ? '⚠️ La IA está tardando más de lo normal.' : '⚠️ La IA no pudo leer el voucher' + (res.error ? ': ' + res.error : '.')}
        {' '}Puedes seguir: escribe el total que ves en el voucher y marca que lo revisaste.
      </div>
    )
    return (
      <div className="gd-lectura">
        <div className="gd-lect-cab">
          <b>🤖 La IA leyó</b>
          <span className="muted small">{[L.banco_o_app, L.fecha && dmy(L.fecha), L.hora].filter(Boolean).join(' · ')}</span>
          {iaTotal != null && <b className="gd-total-ia">{soles(iaTotal)}</b>}
        </div>
        {variasOps && (
          <table className="gd-ops"><tbody>
            {pagos.map((p, i) => (
              <tr key={i}>
                <td className="muted">Op. {i + 1}</td>
                <td><b>{p.monto != null ? soles(p.monto) : '¿monto?'}</b></td>
                <td>{p.numero_operacion ? 'N° ' + p.numero_operacion : <span className="muted">sin N°</span>}</td>
                <td className="muted">{p.destinatario_nombre || ''}</td>
              </tr>
            ))}
          </tbody></table>
        )}
        <ul className="gd-valid">
          {(res.validacion || []).map((x, i) => <li key={i} className={x.nivel}>{ICONO[x.nivel] || '•'} {x.texto}</li>)}
        </ul>
      </div>
    )
  }

  return (
    <div className="modal-bg" onClick={busy || fase === 'leyendo' ? undefined : onCerrar}>
      <div className="glass modal gd-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <b style={{ flex: 1 }}>🧾 REGISTRAR GASTOS CON EL VOUCHER · {proyecto?.name}</b>
          <button className="btn-ghost" onClick={onCerrar} disabled={busy} aria-label="Cerrar">✕</button>
        </div>
        <p className="muted small gd-intro">
          Sin solicitud ni firmas: el gasto entra <b>pagado</b>. Si el voucher cubre varios gastos (ej. S/ 8,000 = comisión + materiales + publicidad), agrégalos todos aquí.
        </p>

        {/* 1. el voucher */}
        <div className="gd-paso"><span className="gd-n">1</span> El voucher</div>
        {fase !== 'leyendo' && (
          <label className="btn-ghost gd-subir">
            {file ? '🔄 Elegir otro voucher' : '📷 Tomar foto o elegir el voucher'}
            <input type="file" accept="image/*,.pdf" hidden onChange={e => { elegir(e.target.files[0]); e.target.value = '' }} />
          </label>
        )}
        {vista && <img src={vista} alt="Voucher elegido" className="gd-vista" />}
        {file && !vista && <p className="small" style={{ textTransform: 'none', marginTop: 8 }}>📄 {file.name}</p>}
        {lectura()}
        {err && <p className="error" style={{ textTransform: 'none' }}>{err}</p>}

        {fase === 'listo' && <>
          {/* el total y los datos del pago */}
          <div className="form-grid gd-datos">
            <label>Total del voucher
              {aMano
                ? <input inputMode="decimal" value={totalEscrito} placeholder="el que dice el voucher"
                    onChange={e => { setFalta(''); setTotalEscrito(e.target.value) }} />
                : <div className="gd-fijo"><b>{soles(iaTotal)}</b> <button type="button" className="link-btn small" onClick={() => setManual(true)}>no es ese</button></div>}
            </label>
            <label>Fecha del pago
              <input type="date" value={v.fecha} onChange={e => setV(x => ({ ...x, fecha: e.target.value }))} />
            </label>
            <label>¿Cómo se pagó?
              <select value={v.metodo} onChange={e => setV(x => ({ ...x, metodo: e.target.value }))}>
                {['TRANSFERENCIA', 'DEPOSITO', 'YAPE', 'PLIN', 'EFECTIVO'].map(m => <option key={m}>{m}</option>)}
              </select>
            </label>
            <label>Banco / app
              <input value={v.banco} placeholder="BCP, BBVA, YAPE…" onChange={e => setV(x => ({ ...x, banco: e.target.value }))} />
            </label>
            {!variasOps && <label>N° de operación
              <input value={v.operacion} onChange={e => setV(x => ({ ...x, operacion: e.target.value }))} />
            </label>}
            <label>Se descuenta de
              <select value={v.descuento} onChange={e => setV(x => ({ ...x, descuento: e.target.value }))}>
                <option>EL PROYECTO</option>
                <option>URBIS GROUP</option>
              </select>
            </label>
          </div>
          {aMano && (
            <label className="inline-check gd-revisado">
              <input type="checkbox" checked={revisado} onChange={e => { setFalta(''); setRevisado(e.target.checked) }} />
              {' '}Revisé el voucher: el total, la fecha y que no se haya registrado antes.
            </label>
          )}

          {/* 2. los gastos */}
          <div className="gd-paso"><span className="gd-n">2</span> Los gastos de este voucher</div>
          {variasOps && (
            <div className="gd-porop">
              {porOp.map((o, i) => {
                const listo = Math.abs(o.asignado - o.monto) < 0.005
                return <span key={i} className={listo ? 'ok' : 'warn'}>Op. {i + 1}{o.op ? ' (' + o.op + ')' : ''}: {soles(o.asignado)} de {soles(o.monto)} {listo ? '✓' : ''}</span>
              })}
            </div>
          )}
          {lineas.map((l, i) => (
            <div key={i} className="gd-linea">
              <div className="gd-linea-cab">
                <b>Gasto {i + 1}</b>
                <div className="chips gd-chips">
                  {ATAJOS.map(a => (
                    <button key={a.t} type="button" className={'chip' + (atajoDe(l) === a ? ' on' : '')}
                      onClick={() => elegirAtajo(i, a)}>{a.t}</button>
                  ))}
                </div>
                {lineas.length > 1 && <button type="button" className="link-btn bad" title="Quitar este gasto" onClick={() => quitar(i)}>✕</button>}
              </div>
              <div className="form-grid">
                <label>Tipo
                  <select value={l.tipo} onChange={e => setLinea(i, 'tipo', e.target.value)}>
                    <option value="">- elegir -</option>
                    {TIPOS_GASTO.map(t => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label className="span2">Motivo
                  <input value={l.motivo} placeholder={EJEMPLO[l.tipo] || EJEMPLO.OTROS} onChange={e => setLinea(i, 'motivo', e.target.value)} />
                </label>
                <label>¿Quién recibió el dinero?
                  <input list="personas-gasto-directo" value={l.receptor}
                    onChange={e => { const val = e.target.value, d = dniDe(val); setFalta(''); setLineas(ls => ls.map((x, j) => j === i ? { ...x, receptor: val, ...(d ? { dni: d } : {}) } : x)) }} />
                </label>
                <label>DNI / RUC <span className="muted small">(opcional)</span>
                  <input inputMode="numeric" value={l.dni} onChange={e => setLinea(i, 'dni', e.target.value)} />
                </label>
                <label>Monto S/
                  <input inputMode="decimal" value={l.monto} onChange={e => setLinea(i, 'monto', e.target.value)} />
                </label>
                {variasOps && (
                  <label>Operación
                    <select value={l.operacion} onChange={e => setLinea(i, 'operacion', e.target.value)}>
                      <option value="">- elegir -</option>
                      {pagos.map((p, k) => <option key={k} value={p.numero_operacion || ''}>{(p.numero_operacion || 'op. ' + (k + 1)) + ' · ' + soles(p.monto)}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </div>
          ))}
          <div className="gd-suma">
            <button type="button" className="btn-ghost" onClick={agregar} disabled={lineas.length >= 30}>+ Agregar otro gasto de este voucher</button>
            <span className={total != null && Math.abs(resta) < 0.005 ? 'ok' : 'warn'}>
              Suma <b>{soles(suma)}</b>{total != null ? <> de <b>{soles(total)}</b>{Math.abs(resta) >= 0.005 ? (resta > 0 ? ' · falta ' + soles(resta) : ' · sobra ' + soles(-resta)) : ' ✓'}</> : ''}
            </span>
          </div>
          <label className="gd-nota">Nota <span className="muted small">(opcional)</span>
            <input value={v.nota} style={{ textTransform: 'none' }} onChange={e => setV(x => ({ ...x, nota: e.target.value }))} />
          </label>
        </>}

        <datalist id="personas-gasto-directo">
          {opcionesPersonas.map(([n, d]) => <option key={n} value={n}>{d ? 'DNI ' + d : ''}</option>)}
        </datalist>
        {falta && <p className="error" style={{ textTransform: 'none', margin: '10px 0 0' }}>{falta}</p>}
        <div className="sg-botones">
          <button type="button" className="btn-primary" disabled={busy || fase !== 'listo'} onClick={registrar}>
            {busy ? 'Registrando…' : lineas.length > 1 ? 'Registrar los ' + lineas.length + ' gastos' : 'Registrar el gasto'}
          </button>
          <button type="button" className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={onCerrar} disabled={busy}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Corregir los textos de UN gasto registrado directo: tipo, motivo y quién recibió.
// El monto no se toca aquí (los gastos tienen que seguir sumando el voucher): para
// eso se anula el voucher y se vuelve a registrar.
// ------------------------------------------------------------
export function CorregirGastoDirecto({ gasto: g, opcionesPersonas = [], profile, onCerrar, onHecho }) {
  const [f, setF] = useState({ type: g.type || '', description: g.description || '', recipient: g.recipient || '', recipient_dni: g.recipient_dni || '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const dniDe = nombre => opcionesPersonas.find(([n]) => n === String(nombre || '').toUpperCase())?.[1] || ''

  async function guardar() {
    const up = x => String(x || '').toUpperCase().trim()
    if (!TIPOS_GASTO.includes(f.type)) { setErr('Elige el tipo de gasto.'); return }
    if (up(f.description).length < 4) { setErr('Escribe el motivo.'); return }
    if (up(f.recipient).length < 3) { setErr('Escribe quién recibió el dinero.'); return }
    setBusy(true); setErr('')
    const nuevo = { type: f.type, description: up(f.description), recipient: up(f.recipient), recipient_dni: String(f.recipient_dni || '').trim() || null }
    const { error } = await supabase.from('expenses').update(nuevo).eq('id', g.id)
    if (error) { setBusy(false); setErr(error.message); return }
    await supabase.from('activity_log').insert({
      action: 'UPDATE', entity_type: 'expenses', entity_id: g.id, user_email: profile?.email || null,
      details: { cambio: 'gasto_directo_corregido', antes: { type: g.type, description: g.description, recipient: g.recipient, recipient_dni: g.recipient_dni }, despues: nuevo, monto: Number(g.amount), project_id: g.project_id },
    })
    setBusy(false)
    onHecho?.('GASTO CORREGIDO. QUEDA EN BITÁCORA.')
  }

  return (
    <div className="modal-bg" onClick={busy ? undefined : onCerrar}>
      <div className="glass modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, width: '96%' }}>
        <div className="modal-head">
          <b style={{ flex: 1 }}>✏ CORREGIR GASTO · {soles(g.amount)}</b>
          <button className="btn-ghost" onClick={onCerrar} disabled={busy} aria-label="Cerrar">✕</button>
        </div>
        <div className="form-grid">
          <label>Tipo
            <select value={f.type} onChange={e => setF(x => ({ ...x, type: e.target.value }))}>
              <option value="">- elegir -</option>
              {TIPOS_GASTO.map(t => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="span2">Motivo
            <input value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} />
          </label>
          <label>¿Quién recibió el dinero?
            <input list="personas-gasto-corregir" value={f.recipient}
              onChange={e => { const val = e.target.value, d = dniDe(val); setF(x => ({ ...x, recipient: val, ...(d ? { recipient_dni: d } : {}) })) }} />
          </label>
          <label>DNI / RUC
            <input inputMode="numeric" value={f.recipient_dni} onChange={e => setF(x => ({ ...x, recipient_dni: e.target.value }))} />
          </label>
        </div>
        <datalist id="personas-gasto-corregir">
          {opcionesPersonas.map(([n, d]) => <option key={n} value={n}>{d ? 'DNI ' + d : ''}</option>)}
        </datalist>
        <p className="muted small" style={{ textTransform: 'none' }}>El monto no se cambia aquí: los gastos tienen que seguir sumando el voucher. Si el monto está mal, anula el voucher y regístralo de nuevo.</p>
        {err && <p className="error" style={{ textTransform: 'none' }}>{err}</p>}
        <div className="sg-botones">
          <button type="button" className="btn-primary" disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : 'Guardar'}</button>
          <button type="button" className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={onCerrar} disabled={busy}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
