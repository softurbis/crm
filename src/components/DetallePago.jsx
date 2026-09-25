import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { upload } from '../lib/archivos'
import { useMsg } from '../lib/saveFx'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import VisorDoc from './VisorDoc'
import {
  soles, estadoDe, campoNA, campoNAMotivo, campoNota, filasDelPago, marcarNoAplica, quitarNoAplica,
} from '../lib/pagos'

export const EstadoChip = ({ r }) => {
  const e = estadoDe(r)
  const cls = e === 'EXPROPIADO' ? 'st-exp' : e === 'PERDIDA' ? 'st-per' : 'st-ok'
  return <span className={'st-chip ' + cls}>{e}</span>
}

// Detalle de UN pago: sus documentos a la vista (voucher del cliente y
// comprobante), la nota de cada uno, el anexo y las correcciones del
// superusuario. Lo abren la pantalla de Cuotas y la ficha del lote.
//   pagos     = los pagos que se estan mirando (para ver los del mismo deposito)
//   accounts  = cuentas del proyecto; si no llegan y hace falta, se consultan
//   onCambio  = el padre recarga su lista despues de cada cambio
export default function DetallePago({ pago, pagos = [], accounts: cuentasPadre, naOk = true, onClose, onCambio }) {
  const { profile, role } = useAuth()
  const { pidOp } = useProject()
  const readOnly = ['manager', 'socio'].includes(role)
  const [view, setView] = useState(pago)
  const [msg, setMsg] = useMsg(null)
  const [obsEdit, setObsEdit] = useState(pago.observation || '')
  const [opEdit, setOpEdit] = useState(pago.operation_number || '')
  const [accEdit, setAccEdit] = useState(pago.financial_account_id || '')
  const [amtEdit, setAmtEdit] = useState(pago.amount)
  const [cuentas, setCuentas] = useState(cuentasPadre || [])

  useEffect(() => {
    if (cuentasPadre) { setCuentas(cuentasPadre); return }
    if (role !== 'superuser' || !pidOp) return
    supabase.from('financial_accounts').select('id, name').eq('active', true).eq('project_id', pidOp)
      .then(({ data }) => setCuentas(data || []))
  }, [cuentasPadre, role, pidOp])

  const cambio = patch => { setView(v => ({ ...v, ...patch })); onCambio?.() }
  const lote = view.lot ? view.lot.mz + '-' + view.lot.lt : null
  const log = details => supabase.from('activity_log').insert({
    action: 'UPDATE', entity_type: 'daily_income', user_email: profile?.email || null,
    details: { ...details, project_id: pidOp },
  })

  async function guardarObs() {
    const { error } = await supabase.from('daily_income').update({ observation: obsEdit.toUpperCase() }).eq('id', view.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setMsg({ ok: true, t: 'OBSERVACION GUARDADA' })
    cambio({ observation: obsEdit.toUpperCase() })
  }

  async function subirAnexo(file) {
    try {
      const nota = prompt('Comentario / nota de este anexo (opcional, Enter para saltar):')
      if (nota === null) return
      const url = await upload(`anexos/${view.id}`, file)
      await supabase.from('daily_income').update({ extra_url: url, extra_note: nota.trim() || null }).eq('id', view.id)
      setMsg({ ok: true, t: 'ANEXO SUBIDO' })
      cambio({ extra_url: url, extra_note: nota.trim() || null })
    } catch (err) { setMsg({ ok: false, t: err.message }) }
  }

  // editar/agregar la nota de un documento ya subido
  async function notaDoc(campo) {
    const kn = campoNota(campo)
    const nota = prompt('Comentario / nota de este documento:', view[kn] || '')
    if (nota === null) return
    const { error } = await supabase.from('daily_income').update({ [kn]: nota.trim() || null }).eq('id', view.id)
    if (error) { setMsg({ ok: false, t: error.message }); return }
    setMsg({ ok: true, t: 'NOTA GUARDADA' })
    cambio({ [kn]: nota.trim() || null })
  }

  async function noAplica(campo, marcar) {
    const filas = filasDelPago(view, pagos.length ? pagos : [view])
    const r = marcar
      ? await marcarNoAplica(filas, campo, { email: profile?.email, pidOp })
      : await quitarNoAplica(filas, campo, { email: profile?.email, pidOp })
    if (!r) return
    setMsg(r)
    if (r.ok) cambio({ [campoNA(campo)]: marcar, [campoNAMotivo(campo)]: marcar ? r.motivo : null })
  }

  // ---- correcciones del SUPERUSUARIO ----
  async function quitarDoc(campo) {
    if (!confirm('¿Quitar este documento del pago? (podrás subir otro)')) return
    const { error } = await supabase.from('daily_income').update({ [campo]: null, [campoNota(campo)]: null }).eq('id', view.id)
    if (error) { setMsg({ ok: false, t: error.message }); return }
    setMsg({ ok: true, t: 'DOCUMENTO QUITADO' })
    cambio({ [campo]: null, [campoNota(campo)]: null })
  }
  async function editarFecha() {
    const nueva = prompt('NUEVA FECHA del pago (AAAA-MM-DD):', view.date)
    if (!nueva || !/^\d{4}-\d{2}-\d{2}$/.test(nueva)) { if (nueva !== null) alert('Formato inválido. Ej: 2026-06-15'); return }
    const observation = ((view.observation || '') + ' | FECHA CORREGIDA POR SUPERUSUARIO (antes ' + view.date + ')').slice(0, 400)
    const { error } = await supabase.from('daily_income').update({ date: nueva, observation }).eq('id', view.id)
    if (error) { setMsg({ ok: false, t: error.message }); return }
    setMsg({ ok: true, t: 'FECHA CORREGIDA' }); cambio({ date: nueva, observation })
  }
  async function borrarPago() {
    if (!confirm('¿ELIMINAR ESTE PAGO de ' + soles(view.amount) + '?\n\nSi está aplicado a una cuota, la cuota se revierte (vuelve a deber ese monto). Esta acción no se puede deshacer.')) return
    if (view.installment_id) {
      const { data: q } = await supabase.from('installments').select('id, amount, amount_paid').eq('id', view.installment_id).maybeSingle()
      if (q) {
        const nuevoPagado = Math.max(0, Number(q.amount_paid) - Number(view.amount))
        await supabase.from('installments').update({
          amount_paid: nuevoPagado,
          status: nuevoPagado <= 0.01 ? 'pendiente' : (Number(q.amount) - nuevoPagado) <= 2 ? 'pagado' : 'pendiente',
          paid_date: nuevoPagado <= 0.01 ? null : undefined,
        }).eq('id', q.id)
      }
    }
    const { error } = await supabase.from('daily_income').delete().eq('id', view.id)
    if (error) { setMsg({ ok: false, t: error.message }); return }
    setMsg({ ok: true, t: 'PAGO ELIMINADO Y CUOTA REVERTIDA' })
    onCambio?.(); onClose()
  }
  async function guardarNroOp() {
    const nuevo = (opEdit || '').trim().toUpperCase() || 'SIN-REF'
    const anterior = view.operation_number
    if (nuevo === anterior) { setMsg({ ok: true, t: 'SIN CAMBIOS EN EL N DE OPERACION' }); return }
    const { error } = await supabase.from('daily_income').update({ operation_number: nuevo }).eq('id', view.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    await log({ cambio: 'operation_number', antes: anterior, despues: nuevo, lote, monto: view.amount })
    setMsg({ ok: true, t: 'N DE OPERACION CORREGIDO: ' + anterior + ' -> ' + nuevo + ' (QUEDA EN BITACORA)' })
    cambio({ operation_number: nuevo })
  }
  async function guardarBanco() {
    const nuevo = accEdit || null
    const anterior = view.financial_account_id || null
    if (nuevo === anterior) { setMsg({ ok: true, t: 'SIN CAMBIOS EN EL BANCO/CUENTA' }); return }
    const { error } = await supabase.from('daily_income').update({ financial_account_id: nuevo }).eq('id', view.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    const nombreNuevo = cuentas.find(a => a.id === nuevo)?.name || '(sin cuenta)'
    await log({ cambio: 'financial_account', antes: view.account?.name || null, despues: nombreNuevo, lote, monto: view.amount })
    setMsg({ ok: true, t: 'BANCO/CUENTA CORREGIDO -> ' + nombreNuevo + ' (QUEDA EN BITACORA)' })
    cambio({ financial_account_id: nuevo, account: { name: nombreNuevo } })
  }
  async function guardarMonto() {
    const nuevo = Math.round(Number(amtEdit) * 100) / 100
    const anterior = Number(view.amount)
    if (!nuevo || nuevo <= 0) { setMsg({ ok: false, t: 'MONTO INVALIDO' }); return }
    if (nuevo === anterior) { setMsg({ ok: true, t: 'SIN CAMBIOS EN EL MONTO' }); return }
    if (!confirm('¿Corregir el monto de ' + soles(anterior) + ' a ' + soles(nuevo) + '?\nSi el pago está aplicado a una cuota, su saldo se recalcula automáticamente.')) return
    const obs = ((view.observation || '') + ' | MONTO CORREGIDO POR SUPERUSUARIO (antes ' + soles(anterior) + ')').slice(0, 400)
    const { error } = await supabase.from('daily_income').update({ amount: nuevo, observation: obs }).eq('id', view.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    await log({ cambio: 'amount', antes: anterior, despues: nuevo, lote })
    setMsg({ ok: true, t: 'MONTO CORREGIDO: ' + soles(anterior) + ' -> ' + soles(nuevo) + ' (CUOTA RECALCULADA, QUEDA EN BITACORA)' })
    cambio({ amount: nuevo, observation: obs })
  }

  const hermanos = pagos.filter(x => x.id !== view.id && x.operation_number === view.operation_number && x.operation_number !== 'SIN-REF')

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="glass modal docs-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            {view.lot ? `MZ ${view.lot.mz} LT ${view.lot.lt}` : ''} |{' '}
            {view.income_type === 'cuota' && view.installment ? `CUOTA N ${view.installment.installment_number}` : view.income_type} |{' '}
            <span className="accent">{soles(view.amount)}</span>
          </h2>
          <button className="btn-ghost" onClick={onClose}>&#10005;</button>
        </div>
        <p className="muted">{view.client?.full_name || '-'} | {view.date} | N OP: {view.operation_number} | {view.account?.name || '-'} | <EstadoChip r={view} /></p>
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
          {readOnly && view.observation && <p className="muted span2" style={{ margin: 0 }}>OBS: {view.observation}</p>}
          {role === 'superuser' && (<>
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
            <label className="span2">Monto del pago (corregir si no coincide con el voucher - recalcula la cuota, queda en bitacora)
              <span style={{ display: 'flex', gap: '.4rem' }}>
                <input type="number" step="0.01" min="0" value={amtEdit} onChange={e => setAmtEdit(e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="btn-ghost" onClick={guardarMonto}>Corregir monto</button>
              </span>
            </label>
          </>)}
          {!readOnly && <div>
            <button type="button" className="btn-ghost" onClick={guardarObs}>Guardar observacion</button>
          </div>}
          <div>
            {view.extra_url
              ? <a href={view.extra_url} target="_blank" rel="noreferrer">VER ANEXO ADICIONAL</a>
              : readOnly ? null
              : <label className="upload-btn">+ Adjuntar anexo adicional (2do voucher, boleta, etc.)
                  <input type="file" accept="image/*,.pdf" hidden onChange={e => e.target.files[0] && subirAnexo(e.target.files[0])} />
                </label>}
            {view.extra_url && !readOnly && <> <button className="link-btn" onClick={() => notaDoc('extra_url')}>&#128221; nota</button></>}
            {view.extra_note && <p className="muted small" style={{ textTransform: 'none', margin: '2px 0 0' }}>{view.extra_note}</p>}
          </div>
        </div>
        <div className="docs-grid">
          {role === 'superuser' && (
            <div className="chg-box" style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 12, fontWeight: 700 }}>🛠 CORRECCIONES (SUPERUSUARIO)</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn-ghost" style={{ fontSize: 12 }} onClick={editarFecha}>📅 CORREGIR FECHA</button>
                {view.voucher_url && <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => quitarDoc('voucher_url')}>🗑 QUITAR VOUCHER</button>}
                {view.receipt_url && <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => quitarDoc('receipt_url')}>🗑 QUITAR COMPROBANTE</button>}
                {view.extra_url && <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => quitarDoc('extra_url')}>🗑 QUITAR ANEXO</button>}
                <button className="btn-ghost" style={{ fontSize: 12, color: '#ff8e7a', borderColor: 'rgba(255,142,122,.5)' }} onClick={borrarPago}>🗑 ELIMINAR PAGO</button>
              </div>
              <p className="muted" style={{ fontSize: 10 }}>El N° de operación se corrige arriba. Al eliminar un pago de cuota, la cuota vuelve a deber ese monto.</p>
            </div>
          )}
          {[['VOUCHER DEL CLIENTE', view.voucher_url, 'voucher_url'], ['COMPROBANTE INTERNO', view.receipt_url, 'receipt_url']].map(([t, u, campo]) => (
            <div key={t} className="doc-panel">
              <p><b>{t}</b>{u && <> | <a href={u} target="_blank" rel="noreferrer">abrir aparte</a></>}
                {u && !readOnly && <> | <button className="link-btn" onClick={() => notaDoc(campo)}>&#128221; nota</button></>}</p>
              {view[campoNota(campo)] && <p className="muted small" style={{ textTransform: 'none', margin: '0 0 4px' }}>{view[campoNota(campo)]}</p>}
              {!u
                ? view[campoNA(campo)]
                  // marcado a proposito: este pago no va a tener este documento
                  ? <>
                      <p className="muted big-alert" style={{ color: '#b9bcc2' }}>NO APLICA</p>
                      <p className="muted small" style={{ textTransform: 'none' }}>{view[campoNAMotivo(campo)] || 'sin motivo registrado'}</p>
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
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
