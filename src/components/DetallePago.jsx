import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { upload } from '../lib/archivos'
import { useMsg } from '../lib/saveFx'
import { avisar, confirmar, pedir } from '../lib/dialogos'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import VisorDoc from './VisorDoc'
import { reciboWspInfo, enviarReciboWsp, celularBonito, enlaceWsp } from '../lib/comprobantes'
import { ListaValidacion, conAviso, nombreTipo } from './LecturaBoleta'
import {
  soles, estadoDe, campoNA, campoNAMotivo, campoNota, filasDelPago, marcarNoAplica, quitarNoAplica,
  notaVisible, recalcularCascada,
} from '../lib/pagos'

const r2 = n => Math.round(Number(n) * 100) / 100

export const EstadoChip = ({ r }) => {
  const e = estadoDe(r)
  const cls = e === 'EXPROPIADO' ? 'st-exp' : e === 'PERDIDA' ? 'st-per' : 'st-ok'
  return <span className={'st-chip ' + cls}>{e}</span>
}

// Detalle de UN pago (un depósito, un voucher): sus documentos a la vista (voucher
// del cliente y comprobante), la nota de cada uno, el anexo y las correcciones del
// superusuario. Lo abren la pantalla de Cuotas y la ficha del lote.
// Una cascada reparte un voucher en varias cuotas y deja una fila por cuota, pero
// es UN pago: se muestra entero, con su reparto, y se corrige entero. Antes se
// abría una sola parte (S/ 40 de un voucher de S/ 500) y parecía un monto mal
// puesto; "corregirla" a 500 dejó lotes con plata de más (7 oct 2026).
//   pagos     = los pagos que se estan mirando (para juntar las partes del deposito)
//   accounts  = cuentas del proyecto; si no llegan y hace falta, se consultan
//   onCambio  = el padre recarga su lista despues de cada cambio
export default function DetallePago({ pago, pagos = [], accounts: cuentasPadre, naOk = true, onClose, onCambio }) {
  const { profile, role, puedeCorregir } = useAuth()   // puedeCorregir = superusuario u operador
  const { pidOp, projects } = useProject()
  const readOnly = ['manager', 'socio'].includes(role)
  // las partes del depósito se fijan al abrir: corregir el N° de operación de todas
  // juntas no tiene que "despegarlas" mientras la lista del padre se recarga
  const [ids] = useState(() => filasDelPago(pago, pagos.some(x => x.id === pago.id) ? pagos : [pago]).map(x => x.id))
  const [cambiado, setCambiado] = useState({})   // lo ya guardado, por fila, hasta que el padre recargue
  const filas = useMemo(() => ids
    .map(id => ({ ...(id === pago.id ? pago : pagos.find(x => x.id === id)), ...(cambiado[id] || {}) }))
    .filter(x => x.id), [ids, pago, pagos, cambiado])
  const view = filas.find(x => x.id === pago.id) || pago
  const deposito = filas.length > 1
  const total = r2(filas.reduce((s, x) => s + Number(x.amount || 0), 0))
  const reparto = filas.filter(x => x.income_type === 'cuota' && x.installment)
    .map(x => ({ id: x.id, n: x.installment.installment_number, monto: Number(x.amount || 0) }))
    .sort((a, b) => a.n - b.n)
  const notas = [...new Set(filas.map(x => notaVisible(x.observation)).filter(Boolean))].join(' | ')
  const conDoc = campo => filas.find(x => x[campo])   // la parte que tiene el documento

  const [msg, setMsg] = useMsg(null)
  const [obsEdit, setObsEdit] = useState(notas)
  const [opEdit, setOpEdit] = useState(pago.operation_number || '')
  const [accEdit, setAccEdit] = useState(pago.financial_account_id || '')
  const [amtEdit, setAmtEdit] = useState(String(total))
  const [busy, setBusy] = useState(false)
  const [cuentas, setCuentas] = useState(cuentasPadre || [])

  useEffect(() => {
    if (cuentasPadre) { setCuentas(cuentasPadre); return }
    if (!puedeCorregir || !pidOp) return
    supabase.from('financial_accounts').select('id, name').eq('active', true).eq('project_id', pidOp)
      .then(({ data }) => setCuentas(data || []))
  }, [cuentasPadre, puedeCorregir, pidOp])

  // un cambio que vale para todo el depósito (todas sus partes)
  const cambio = patch => {
    setCambiado(c => Object.fromEntries(ids.map(id => [id, { ...(c[id] || {}), ...(typeof patch === 'function' ? patch(filas.find(x => x.id === id) || {}) : patch) }])))
    onCambio?.()
  }
  const lote = view.lot ? view.lot.mz + '-' + view.lot.lt : null
  const log = details => supabase.from('activity_log').insert({
    action: 'UPDATE', entity_type: 'daily_income', user_email: profile?.email || null,
    details: { ...details, aplicaciones: ids.length, project_id: pidOp },
  })
  const actualizar = patch => supabase.from('daily_income').update(patch).in('id', ids)

  async function guardarObs() {
    const obs = obsEdit.trim().toUpperCase()
    const { error } = await actualizar({ observation: obs })
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setMsg({ ok: true, t: 'OBSERVACION GUARDADA' })
    cambio({ observation: obs })
  }

  async function subirAnexo(file) {
    try {
      const nota = await pedir('Comentario / nota de este anexo (opcional, Enter para saltar):')
      if (nota === null) return
      const url = await upload(`anexos/${view.id}`, file)
      const { error } = await actualizar({ extra_url: url, extra_note: nota.trim() || null })
      if (error) throw error
      setMsg({ ok: true, t: 'ANEXO SUBIDO' })
      cambio({ extra_url: url, extra_note: nota.trim() || null })
    } catch (err) { setMsg({ ok: false, t: err.message }) }
  }

  // editar/agregar la nota de un documento ya subido
  async function notaDoc(campo) {
    const kn = campoNota(campo)
    const nota = await pedir('Comentario / nota de este documento:', { tipo: 'largo', valor: conDoc(campo)?.[kn] || '' })
    if (nota === null) return
    const { error } = await actualizar({ [kn]: nota.trim() || null })
    if (error) { setMsg({ ok: false, t: error.message }); return }
    setMsg({ ok: true, t: 'NOTA GUARDADA' })
    cambio({ [kn]: nota.trim() || null })
  }

  async function noAplica(campo, marcar) {
    const r = marcar
      ? await marcarNoAplica(filas, campo, { email: profile?.email, pidOp })
      : await quitarNoAplica(filas, campo, { email: profile?.email, pidOp })
    if (!r) return
    setMsg(r)
    if (r.ok) cambio({ [campoNA(campo)]: marcar, [campoNAMotivo(campo)]: marcar ? r.motivo : null })
  }

  // ---- correcciones del SUPERUSUARIO (siempre al depósito entero) ----
  async function quitarDoc(campo) {
    if (!await confirmar('¿Quitar este documento del pago? (podrás subir otro)', { peligro: true, aceptar: 'Sí, quitar' })) return
    const { error } = await actualizar({ [campo]: null, [campoNota(campo)]: null })
    if (error) { setMsg({ ok: false, t: error.message }); return }
    setMsg({ ok: true, t: 'DOCUMENTO QUITADO' })
    cambio({ [campo]: null, [campoNota(campo)]: null })
  }
  async function editarFecha() {
    const nueva = await pedir('NUEVA FECHA del pago:', { tipo: 'fecha', valor: view.date, obligatorio: true })
    if (!nueva || !/^\d{4}-\d{2}-\d{2}$/.test(nueva)) { if (nueva !== null) await avisar('Fecha inválida.'); return }
    const sufijo = ' | FECHA CORREGIDA POR SUPERUSUARIO (antes ' + view.date + ')'
    for (const f of filas) {
      const { error } = await supabase.from('daily_income')
        .update({ date: nueva, observation: ((f.observation || '') + sufijo).slice(0, 400) }).eq('id', f.id)
      if (error) { setMsg({ ok: false, t: error.message }); return }
    }
    await log({ cambio: 'fecha', antes: view.date, despues: nueva, lote, monto: total })
    setMsg({ ok: true, t: 'FECHA CORREGIDA' })
    cambio(f => ({ date: nueva, observation: ((f.observation || '') + sufijo).slice(0, 400) }))
  }
  async function borrarPago() {
    const enCuotas = reparto.length > 0 && view.sale_id
    const texto = deposito
      ? '¿ELIMINAR ESTE PAGO COMPLETO de ' + soles(total) + '?\n\nEstá repartido en ' + reparto.map(x => 'la cuota ' + x.n).join(' y ') +
        ': se borra entero. Esas cuotas vuelven a deber ese monto y los pagos que vienen después se vuelven a repartir en orden.\n\nNo se puede deshacer.'
      : '¿ELIMINAR ESTE PAGO de ' + soles(total) + '?\n\n' + (enCuotas
        ? 'La cuota vuelve a deber ese monto y los pagos que vienen después se vuelven a repartir en orden.\n\n' : '') + 'No se puede deshacer.'
    if (!await confirmar(texto, { peligro: true, aceptar: 'Sí, eliminar el pago' })) return
    setBusy(true)
    try {
      const { error } = await supabase.from('daily_income').delete().in('id', ids)
      if (error) throw error
      await log({ cambio: 'pago_eliminado', lote, monto: total, fecha: view.date, operacion: view.operation_number,
        reparto: reparto.map(x => ({ cuota: x.n, monto: x.monto })) })
      if (enCuotas) await recalcularCascada({ saleId: view.sale_id, desdeFecha: view.date })
      onCambio?.(); onClose()
      await avisar('Pago eliminado.' + (enCuotas ? ' Las cuotas y los pagos siguientes quedaron otra vez en orden.' : ''))
    } catch (err) {
      setMsg({ ok: false, t: 'NO SE PUDO ELIMINAR: ' + (err.message || err) })
    }
    setBusy(false)
  }
  async function guardarNroOp() {
    const nuevo = (opEdit || '').trim().toUpperCase() || 'SIN-REF'
    const anterior = view.operation_number
    if (nuevo === anterior) { setMsg({ ok: true, t: 'SIN CAMBIOS EN EL N DE OPERACION' }); return }
    const { error } = await actualizar({ operation_number: nuevo })
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    await log({ cambio: 'operation_number', antes: anterior, despues: nuevo, lote, monto: total })
    setMsg({ ok: true, t: 'N DE OPERACION CORREGIDO: ' + anterior + ' -> ' + nuevo + ' (QUEDA EN BITACORA)' })
    cambio({ operation_number: nuevo })
  }
  async function guardarBanco() {
    const nuevo = accEdit || null
    const anterior = view.financial_account_id || null
    if (nuevo === anterior) { setMsg({ ok: true, t: 'SIN CAMBIOS EN EL BANCO/CUENTA' }); return }
    const { error } = await actualizar({ financial_account_id: nuevo })
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    const nombreNuevo = cuentas.find(a => a.id === nuevo)?.name || '(sin cuenta)'
    await log({ cambio: 'financial_account', antes: view.account?.name || null, despues: nombreNuevo, lote, monto: total })
    setMsg({ ok: true, t: 'BANCO/CUENTA CORREGIDO -> ' + nombreNuevo + ' (QUEDA EN BITACORA)' })
    cambio({ financial_account_id: nuevo, account: { name: nombreNuevo } })
  }
  // El monto que se corrige es el del VOUCHER (el depósito entero). Si es de cuotas,
  // se vuelve a repartir: este pago y los que vienen después.
  async function guardarMonto() {
    const nuevo = r2(amtEdit)
    if (!nuevo || nuevo <= 0) { setMsg({ ok: false, t: 'MONTO INVALIDO' }); return }
    if (Math.abs(nuevo - total) < 0.005) { setMsg({ ok: true, t: 'SIN CAMBIOS EN EL MONTO' }); return }
    const enCuotas = reparto.length > 0 && view.sale_id
    if (!await confirmar('¿El voucher es por ' + soles(nuevo) + ' y no por ' + soles(total) + '?\n\n' + (enCuotas
      ? 'El pago se vuelve a repartir entre las cuotas (la más antigua primero), y también los pagos que vienen después.'
      : 'Se corrige el monto del pago.'), { aceptar: 'Sí, corregir' })) return
    setBusy(true)
    try {
      const obs = ((view.observation || '') + ' | MONTO CORREGIDO POR SUPERUSUARIO (antes ' + soles(total) + ')').slice(0, 400)
      // queda una sola fila con el monto nuevo; la cascada la reparte otra vez
      const otras = ids.filter(id => id !== view.id)
      if (otras.length) {
        const { error } = await supabase.from('daily_income').delete().in('id', otras)
        if (error) throw error
      }
      const { error } = await supabase.from('daily_income').update({ amount: nuevo, observation: obs }).eq('id', view.id)
      if (error) throw error
      await log({ cambio: 'amount', antes: total, despues: nuevo, lote, operacion: view.operation_number })
      if (enCuotas) await recalcularCascada({ saleId: view.sale_id, desdeId: view.id })
      onCambio?.(); onClose()
      await avisar('Monto corregido: ' + soles(total) + ' → ' + soles(nuevo) + '.' + (enCuotas ? ' Las cuotas quedaron otra vez en orden.' : ''))
    } catch (err) {
      setMsg({ ok: false, t: 'NO SE PUDO CORREGIR EL MONTO: ' + (err.message || err) })
    }
    setBusy(false)
  }

  // el mismo N° de operación en OTRO lote (una transferencia que pagó dos lotes)
  const hermanos = pagos.filter(x => !ids.includes(x.id) && x.operation_number === view.operation_number && x.operation_number !== 'SIN-REF')
  const titulo = reparto.length > 1 ? `CUOTAS N ${reparto.map(x => x.n).join(' + ')}`
    : view.income_type === 'cuota' && view.installment ? `CUOTA N ${view.installment.installment_number}` : view.income_type

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="glass modal docs-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            {view.lot ? `MZ ${view.lot.mz} LT ${view.lot.lt}` : ''} | {titulo} | <span className="accent">{soles(total)}</span>
          </h2>
          <button className="btn-ghost" onClick={onClose}>&#10005;</button>
        </div>
        <p className="muted">{view.client?.full_name || '-'} | {view.date} | N OP: {view.operation_number} | {view.account?.name || '-'} | <EstadoChip r={view} /></p>
        {deposito && reparto.length > 1 && (
          <div className="pago-reparto">
            <p>&#129534; <b>Es un solo pago de {soles(total)}</b> (lo que dice el voucher), repartido así:</p>
            <ul>{reparto.map(x => <li key={x.id}>Cuota N° {x.n}: <b>{soles(x.monto)}</b></li>)}</ul>
            <p className="muted small">Cada pago primero termina la cuota más antigua que debe y lo que sobra pasa a la siguiente.
              Por eso las partes no se parecen al voucher: lo que tiene que coincidir con el voucher es el <b>total</b>.</p>
          </div>
        )}
        {hermanos.length > 0 && (
          <p className="hint">&#128279; MISMA OPERACION ({view.operation_number}) cubre tambien:{' '}
            {hermanos.map(h => `${h.lot ? h.lot.mz + '-' + h.lot.lt : ''} ${h.income_type === 'cuota' && h.installment ? 'CUOTA ' + h.installment.installment_number : h.income_type} (${soles(h.amount)})`).join(' | ')}
          </p>
        )}
        {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
        <div className="form-grid">
          {!readOnly && <label className="span2">Observacion / comentario del pago
            <textarea rows="2" value={obsEdit} onChange={e => setObsEdit(e.target.value)} />
          </label>}
          {readOnly && notas && <p className="muted span2" style={{ margin: 0 }}>OBS: {notas}</p>}
          {puedeCorregir && (<>
            <label className="span2">N de operacion (correccion, solo superusuario - queda en bitacora)
              <span style={{ display: 'flex', gap: '.4rem' }}>
                <input value={opEdit} onChange={e => setOpEdit(e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="btn-ghost" onClick={guardarNroOp}>Corregir N Op.</button>
              </span>
            </label>
            <label className="span2">Banco / cuenta del pago (corregir si no coincide con el voucher - queda en bitacora)
              <span style={{ display: 'flex', gap: '.4rem' }}>
                <select value={accEdit} onChange={e => setAccEdit(e.target.value)} style={{ flex: 1 }}>
                  <option value="">(sin cuenta)</option>
                  {cuentas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <button type="button" className="btn-ghost" onClick={guardarBanco}>Corregir banco</button>
              </span>
            </label>
            <label className="span2">{deposito
              ? `Monto del voucher (el total de las ${filas.length} partes) - si lo cambias, se vuelve a repartir entre las cuotas`
              : 'Monto del pago (corregir si no coincide con el voucher - recalcula la cuota, queda en bitacora)'}
              <span style={{ display: 'flex', gap: '.4rem' }}>
                <input type="number" step="0.01" min="0" value={amtEdit} onChange={e => setAmtEdit(e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="btn-ghost" disabled={busy} onClick={guardarMonto}>Corregir monto</button>
              </span>
            </label>
            {deposito && <p className="muted small span2" style={{ margin: '-4px 0 0' }}>
              N° de operación, banco, fecha y eliminar se aplican al pago entero ({filas.length} partes).</p>}
          </>)}
          {!readOnly && <div>
            <button type="button" className="btn-ghost" onClick={guardarObs}>Guardar observacion</button>
          </div>}
          <div>
            {conDoc('extra_url')
              ? <a href={conDoc('extra_url').extra_url} target="_blank" rel="noreferrer">VER ANEXO ADICIONAL</a>
              : readOnly ? null
              : <label className="upload-btn">+ Adjuntar anexo adicional (2do voucher, boleta, etc.)
                  <input type="file" accept="image/*,.pdf" hidden onChange={e => e.target.files[0] && subirAnexo(e.target.files[0])} />
                </label>}
            {conDoc('extra_url') && !readOnly && <> <button className="link-btn" onClick={() => notaDoc('extra_url')}>&#128221; nota</button></>}
            {conDoc('extra_url')?.extra_note && <p className="muted small" style={{ textTransform: 'none', margin: '2px 0 0' }}>{conDoc('extra_url').extra_note}</p>}
          </div>
        </div>
        <div className="docs-grid">
          {puedeCorregir && (
            <div className="chg-box" style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 12, fontWeight: 700 }}>🛠 CORRECCIONES (SUPERUSUARIO)</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn-ghost" style={{ fontSize: 12 }} onClick={editarFecha}>📅 CORREGIR FECHA</button>
                {conDoc('voucher_url') && <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => quitarDoc('voucher_url')}>🗑 QUITAR VOUCHER</button>}
                {conDoc('receipt_url') && <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => quitarDoc('receipt_url')}>🗑 QUITAR COMPROBANTE</button>}
                {conDoc('extra_url') && <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => quitarDoc('extra_url')}>🗑 QUITAR ANEXO</button>}
                <button className="btn-ghost" style={{ fontSize: 12, color: '#ff8e7a', borderColor: 'rgba(255,142,122,.5)' }} disabled={busy} onClick={borrarPago}>
                  🗑 ELIMINAR {deposito ? 'PAGO COMPLETO' : 'PAGO'}</button>
              </div>
              <p className="muted" style={{ fontSize: 10 }}>El N° de operación se corrige arriba. Al eliminar un pago de cuotas, esas cuotas vuelven a deber y los pagos siguientes se reparten otra vez en orden.</p>
            </div>
          )}
          {[['VOUCHER DEL CLIENTE', 'voucher_url'], ['COMPROBANTE INTERNO', 'receipt_url']].map(([t, campo]) => {
            const f = conDoc(campo)
            const u = f?.[campo]
            const na = filas.every(x => x[campoNA(campo)])
            return (
              <div key={t} className="doc-panel">
                <p><b>{t}</b>{u && <> | <a href={u} target="_blank" rel="noreferrer">abrir aparte</a></>}
                  {u && !readOnly && <> | <button className="link-btn" onClick={() => notaDoc(campo)}>&#128221; nota</button></>}</p>
                {f?.[campoNota(campo)] && <p className="muted small" style={{ textTransform: 'none', margin: '0 0 4px' }}>{f[campoNota(campo)]}</p>}
                {!u
                  ? na
                    // marcado a proposito: este pago no va a tener este documento
                    ? <>
                        <p className="muted big-alert" style={{ color: '#b9bcc2' }}>NO APLICA</p>
                        <p className="muted small" style={{ textTransform: 'none' }}>{filas.find(x => x[campoNAMotivo(campo)])?.[campoNAMotivo(campo)] || 'sin motivo registrado'}</p>
                        {!readOnly && <button className="btn-ghost" style={{ fontSize: 12 }}
                          onClick={() => noAplica(campo, false)}>&#8634; Volver a pedirlo</button>}
                      </>
                    : <>
                        <p className="bad big-alert">&#9888; NO SUBIDO</p>
                        {!readOnly && naOk && <button className="btn-ghost" style={{ fontSize: 12 }}
                          title="Este pago nunca va a tener este documento (cascada, cuadre, canje). Se pide el motivo y queda en bitácora."
                          onClick={() => noAplica(campo, true)}>No aplica a este pago</button>}
                      </>
                  : <VisorDoc url={u} titulo={t} />}
                {u && campo === 'receipt_url' && !readOnly && role !== 'facturacion' &&
                  <EnviarRecibo key={u} pago={f} filas={filas} total={total} proyecto={(projects || []).find(p => p.id === pidOp)} />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// "Enviar al cliente" la boleta o factura que subió facturación (sql/148): sale
// sola, adjunta, por el WhatsApp del proyecto. Sin descargar nada. Si el proyecto
// no tiene su WhatsApp conectado, se abre el de quien la manda con todo escrito.
const limpio = t => { const d = String(t || '').replace(/\D/g, ''); return d.length === 11 && d.startsWith('51') ? d.slice(2) : d }
function EnviarRecibo({ pago, filas, total, proyecto, enDialogo = false }) {
  const [info, setInfo] = useState(undefined)   // undefined = averiguando · null = no corresponde
  const [tel, setTel] = useState('')
  const [tipo, setTipo] = useState(() => /factura|^\s*F[A-Z0-9]{3}-/i.test(pago.receipt_note || '') ? 'factura' : 'boleta')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const tocado = useRef(false)
  const tipoAMano = useRef(false)
  const [cambiarTipo, setCambiarTipo] = useState(false)
  const cargar = useCallback(() => reciboWspInfo(pago.id).then(i => {
    setInfo(i)
    if (i && !tocado.current) { const t = (i.telefonos || []).map(limpio).find(d => d.length >= 9); if (t) setTel(t) }
    // boleta o factura: lo que leyó la IA (sql/151), mientras nadie lo cambie a mano
    const lt = i?.lectura?.tipo
    if (!tipoAMano.current && (lt === 'boleta' || lt === 'factura')) setTipo(lt)
    return i
  }), [pago.id])
  useEffect(() => { cargar() }, [cargar])
  const envio = info?.envio
  const saliendo = envio?.estado === 'pendiente'
  const lect = info?.lectura
  const leyendo = lect?.estado === 'pendiente' || lect?.estado === 'leyendo'
  // mientras está saliendo (o la IA leyendo) se vuelve a mirar: tarda segundos
  useEffect(() => {
    if (!saliendo && !leyendo) return
    const t = setInterval(cargar, 3000)
    return () => clearInterval(t)
  }, [saliendo, leyendo, cargar])
  if (info?.falta) return <p className="muted" style={{ textTransform: 'none' }}>El envío todavía no está instalado en la base: falta correr sql/148.</p>
  if (!info) return enDialogo && info === null
    ? <p className="muted" style={{ textTransform: 'none' }}>Tu usuario no puede enviar este comprobante (o el pago ya no lo tiene).</p>
    : null

  const registrados = [...new Set((info.telefonos || []).map(limpio).filter(d => d.length >= 9))]
  const que = tipo === 'factura' ? 'la factura' : 'la boleta'
  const numero = () => {
    const d = tel.replace(/\D/g, '')
    if (d.length < 9) { setErr('Escribe el celular: 9 dígitos.'); return null }
    return d
  }
  // el mismo texto que arma el servidor, más el enlace del archivo
  function texto() {
    const cuotas = [...new Set(filas.filter(x => x.income_type === 'cuota' && x.installment).map(x => x.installment.installment_number))].sort((a, b) => a - b)
    const otros = { separacion: 'la separación', inicial: 'la cuota inicial', mora: 'la mora', otro: 'su pago' }
    const partes = []
    if (cuotas.length === 1) partes.push('la cuota N° ' + cuotas[0])
    else if (cuotas.length > 1) partes.push('las cuotas N° ' + cuotas.slice(0, -1).join(', ') + ' y ' + cuotas[cuotas.length - 1])
    for (const t of new Set(filas.filter(x => x.income_type !== 'cuota').map(x => x.income_type))) partes.push(otros[t] || 'su pago')
    const lote = pago.lot ? pago.lot.mz + '-' + pago.lot.lt : null
    const nombre = String(info.cliente || '').trim().toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase())
    const fecha = pago.date ? pago.date.split('-').reverse().join('/') : ''
    const firma = proyecto?.fact_razon_social || proyecto?.name || ''
    return 'Buen día' + (nombre ? ', ' + nombre : '') + '. Le estamos enviando su ' + (tipo === 'factura' ? 'factura' : 'boleta de venta')
      + ' correspondiente a ' + (partes.join(' y ') || 'su pago') + (lote ? ' del lote ' + lote : '') + (proyecto?.name ? ' de ' + proyecto.name : '')
      + ' (pago de ' + soles(total) + (fecha ? ' del ' + fecha : '') + ').'
      + '\n\nPuede verla y descargarla aquí:\n' + pago.receipt_url
      + '\n\nGracias por su pago.' + (firma ? '\n' + firma : '')
  }
  function abrir() {
    setErr('')
    const d = numero()
    if (d) window.open(enlaceWsp(d, texto()), '_blank', 'noopener')
  }
  async function enviar() {
    setErr('')
    const d = numero()
    if (!d) return
    setBusy(true)
    try { await enviarReciboWsp(pago.id, d, tipo); await cargar() } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const demora = saliendo && envio.at && Date.now() - new Date(envio.at).getTime() > 90000
  return (
    <div className="cp-wsp">
      <p className="cp-sub">📲 Enviar {que} al cliente por WhatsApp</p>
      {/* boleta o factura: lo sabe la IA; los botones solo si no se pudo leer o se quiere cambiar */}
      {lect?.estado === 'listo' && ['boleta', 'factura'].includes(lect.tipo) && !cambiarTipo
        ? <p className="muted small cp-wsp-reg" style={{ marginBottom: '.4rem' }}>📄 Es <b>{nombreTipo(tipo)}</b>{lect.serie_numero ? ' ' + lect.serie_numero : ''} (lo leyó la IA). <button type="button" className="link-btn" onClick={() => setCambiarTipo(true)}>cambiar</button></p>
        : <div className="cp-wsp-fila" style={{ marginBottom: '.4rem' }}>
            {[['boleta', 'Es boleta'], ['factura', 'Es factura']].map(([v, t]) => (
              <button key={v} type="button" className={tipo === v ? 'btn-primary' : 'btn-ghost'} style={{ fontSize: 12, padding: '.25rem .7rem' }}
                onClick={() => { tipoAMano.current = true; setTipo(v) }}>{t}</button>
            ))}
            {leyendo && <span className="cp-busca"><span className="cp-gira" /> la IA la está leyendo…</span>}
          </div>}
      {/* la IA encontró algo que no cuadra y facturación todavía no lo revisó: se avisa antes de mandarla */}
      {conAviso(lect) && <div className="cp-aviso">
        <p><b>⚠ Ojo antes de enviarla:</b> la IA encontró diferencias con el pago y facturación todavía no la revisó.</p>
        <ListaValidacion l={{ validacion: lect.validacion.filter(v => v.nivel === 'mal') }} />
      </div>}
      <div className="cp-wsp-fila">
        <input value={tel} inputMode="tel" placeholder="Celular (9 dígitos)" aria-label="Celular al que se envía"
          onChange={e => { tocado.current = true; setTel(e.target.value.replace(/[^\d+ ]/g, '').slice(0, 18)) }}
          onKeyDown={e => { if (e.key === 'Enter') (info.numero_proyecto ? enviar : abrir)() }} />
        {info.numero_proyecto
          ? <button type="button" className="btn-primary" onClick={enviar} disabled={busy || (saliendo && !demora)}>
              {busy ? 'Pidiendo…' : saliendo && !demora ? 'Enviando…' : envio?.estado === 'enviado' ? 'Enviar otra vez' : conAviso(lect) ? 'Enviar igual' : 'Enviar'}
            </button>
          : <button type="button" className="btn-primary" onClick={abrir}>Abrir WhatsApp</button>}
      </div>
      {registrados.length > 0
        ? <p className="muted small cp-wsp-reg">Registrado{registrados.length > 1 ? 's' : ''}: {registrados.map(n => (
            <button type="button" key={n} className={'link-btn' + (tel.replace(/\D/g, '').endsWith(n) ? ' on' : '')} onClick={() => { tocado.current = true; setTel(n) }}>{celularBonito(n)}</button>
          ))} · o escribe otro número.</p>
        : <p className="muted small cp-wsp-reg">El cliente no tiene celular en su ficha: escribe el número.</p>}
      {info.numero_proyecto
        ? <p className="muted small cp-wsp-reg">Sale solo, con el archivo adjunto, por el WhatsApp del proyecto ({celularBonito(info.numero_proyecto) || 'conectado'}). <button type="button" className="link-btn" onClick={abrir}>O mandarlo desde mi WhatsApp</button></p>
        : <p className="muted small cp-wsp-reg">El proyecto no tiene su WhatsApp conectado: se abre el tuyo con el mensaje y el enlace ya escritos, solo falta presionar enviar.</p>}
      {err && <p className="error" style={{ textTransform: 'none', margin: '.3rem 0 0' }}>{err}</p>}
      {!err && saliendo && <p className="cp-busca">{!demora && <span className="cp-gira" />}{demora
        ? 'Está tardando más de lo normal: revisa que el WhatsApp del proyecto esté conectado. Se puede volver a enviar.'
        : 'Enviando a ' + celularBonito(envio.a) + '… sale en unos segundos.'}</p>}
      {!err && envio?.estado === 'enviado' && <p className="cp-busca ok">✓ Enviado a {celularBonito(envio.a)}{envio.enviado_at ? ' · ' + new Date(envio.enviado_at).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</p>}
      {!err && envio?.estado === 'fallido' && <p className="cp-busca no">No se pudo enviar a {celularBonito(envio.a)}: {envio.error || 'sin detalle'}.</p>}
    </div>
  )
}

// El mismo envío, directo desde la tabla (botón "📲 Enviar" al lado del VER del
// comprobante en Pagos y en la ficha del lote): sin abrir el detalle del pago.
//   filas = las partes del depósito (g.items de agruparPagos)
export function DialogoEnviarRecibo({ filas, onClose }) {
  const { pidOp, projects } = useProject()
  const pago = filas.find(x => x.receipt_url)
  const total = r2(filas.reduce((s, x) => s + Number(x.amount || 0), 0))
  if (!pago) return null
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="glass modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{pago.lot ? `MZ ${pago.lot.mz} LT ${pago.lot.lt}` : 'PAGO'} | <span className="accent">{soles(total)}</span></h2>
          <button className="btn-ghost" onClick={onClose}>&#10005;</button>
        </div>
        <p className="muted">{pago.client?.full_name || '-'} | {pago.date ? pago.date.split('-').reverse().join('/') : ''} | <a href={pago.receipt_url} target="_blank" rel="noreferrer">ver el comprobante</a></p>
        <EnviarRecibo pago={pago} filas={filas} total={total} proyecto={(projects || []).find(p => p.id === pidOp)} enDialogo />
      </div>
    </div>
  )
}
