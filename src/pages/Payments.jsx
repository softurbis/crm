import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMsg } from '../lib/saveFx'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'
import Paginador, { usePaginacion } from '../components/Paginador'
import DetallePago, { EstadoChip } from '../components/DetallePago'
import BuscarLote from '../components/BuscarLote'
import {
  soles, estadoDe, conceptoPago, agruparPagos, COLS_PAGO as COLS, COLS_PAGO_NA as COLS_NA,
  subirDocPago, marcarNoAplica as marcarNA, quitarNoAplica as quitarNA,
} from '../lib/pagos'


export default function Payments() {
  const { profile, role } = useAuth()
  const { pidOp } = useProject()
  // Desde la fase 2 (24 sep 2026) se cobra en la ficha del lote (CobroModal):
  // esta pantalla queda como historial y reporte de todos los pagos del
  // proyecto, con sus documentos y las correcciones.
  const [accounts, setAccounts] = useState([])
  const [pagos, setPagos] = useState([])
  const [msg, setMsg] = useMsg(null)

  const [fq, setFq] = useState('')
  const [ftipo, setFtipo] = useState('todos')
  const [fdoc, setFdoc] = useState('todos') // todos | sin_voucher | sin_comprobante
  const [fest, setFest] = useState('todos')
  const [view, setView] = useState(null)
  const [gruposAbiertos, setGruposAbiertos] = useState(new Set())
  const [repartoEdit, setRepartoEdit] = useState(null)
  const [repartoBusy, setRepartoBusy] = useState(false)
  const [naOk, setNaOk] = useState(true)   // false = sql/49 sin correr: sin "no aplica"
  const readOnly = ['manager', 'socio'].includes(role)

  // Trae TODOS los pagos del proyecto por paginas. Supabase corta en 1000 filas
  // por request, asi que sin esto en proyectos grandes (Pucallpa ~2200) el
  // historial salia incompleto: los mas antiguos (iniciales, lotes entregados)
  // se perdian y los filtros parecian rotos.
  // Pinta en cuanto llega la PRIMERA pagina y sigue trayendo el resto por
  // detras. Antes esperaba las 2.288 filas de Pucallpa (12 s con el servidor
  // solo, 62 s con cuatro secretarias a la vez) antes de mostrar nada — eso era
  // "la pantalla se queda sin cargar". `alPintar` recibe lo acumulado tras cada
  // pagina; el que llama decide que hacer con ello.
  async function traerPagos(alPintar) {
    const paso = 1000
    let desde = 0, todo = []
    // 1) camino rapido: una sola consulta en Postgres con los joins ya hechos
    //    (sql/71). Si la funcion no existe todavia, cae al camino de siempre.
    let rapido = true
    for (let guard = 0; guard < 60 && rapido; guard++) {
      const { data, error } = await supabase.rpc('pagos_proyecto', { pid: pidOp, lim: paso, offs: desde })
      if (error) { rapido = false; break }
      const filas = Array.isArray(data) ? data : []
      todo = todo.concat(filas)
      if (alPintar) alPintar(todo)
      if (filas.length < paso) return todo
      desde += paso
    }
    // 2) camino de siempre (PostgREST con las 5 tablas enlazadas)
    desde = 0; todo = []
    let cols = COLS + COLS_NA
    for (let guard = 0; guard < 60; guard++) {
      const { data, error } = await supabase.from('daily_income').select(cols)
        .eq('project_id', pidOp).order('date', { ascending: false }).order('created_at', { ascending: false })
        .range(desde, desde + paso - 1)
      // sql/49 todavia sin correr: se reintenta sin las columnas de "no aplica"
      // para que el historial siga funcionando (los botones se ocultan solos).
      if (error && cols !== COLS) { cols = COLS; setNaOk(false); continue }
      if (error || !data?.length) break
      todo = todo.concat(data)
      if (alPintar) alPintar(todo)
      if (data.length < paso) break
      desde += paso
    }
    return todo
  }

  async function loadBase() {
    // las cuentas van en paralelo con los pagos; los pagos se pintan pagina a
    // pagina (la primera aparece en ~1 s aunque el resto siga bajando)
    const [a] = await Promise.all([
      supabase.from('financial_accounts').select('id, name').eq('active', true).eq('project_id', pidOp),
      traerPagos(parcial => setPagos(parcial)),
    ])
    setAccounts(a.data || [])
  }
  useEffect(() => { if (pidOp) loadBase() }, [pidOp])

  async function subirDoc(row, file, campo) {
    try {
      const t = await subirDocPago(row, file, campo, naOk)
      if (!t) return   // cancelo la nota: no se sube nada
      setMsg({ ok: true, t })
      loadBase()
    } catch (err) { setMsg({ ok: false, t: err.message }) }
  }

  // `filas` son todas las aplicaciones del mismo deposito: se marcan juntas (lib/pagos)
  async function marcarNoAplica(filas, campo) {
    const r = await marcarNA(filas, campo, { email: profile?.email, pidOp })
    if (!r) return
    setMsg(r)
    if (r.ok) loadBase()
  }

  async function quitarNoAplica(filas, campo) {
    const r = await quitarNA(filas, campo, { email: profile?.email, pidOp })
    if (!r) return
    setMsg(r)
    if (r.ok) loadBase()
  }

  function editarReparto(g) {
    setRepartoEdit({ key: g.key, valores: Object.fromEntries(g.items.map(p => [p.id, String(p.amount)])) })
    setGruposAbiertos(prev => new Set(prev).add(g.key))
  }

  async function guardarReparto(g) {
    if (role !== 'superuser' || repartoEdit?.key !== g.key) return
    const cambios = g.items.map(p => ({ ...p, nuevo: Math.round(Number(repartoEdit.valores[p.id]) * 100) / 100 }))
    if (cambios.some(p => !Number.isFinite(p.nuevo) || p.nuevo < 0)) {
      setMsg({ ok: false, t: 'CADA APLICACIÓN DEBE TENER UN MONTO VÁLIDO MAYOR O IGUAL A CERO.' }); return
    }
    const totalNuevo = Math.round(cambios.reduce((s, p) => s + p.nuevo, 0) * 100) / 100
    if (Math.abs(totalNuevo - Number(g.total)) > 0.009) {
      setMsg({ ok: false, t: `EL REPARTO SUMA ${soles(totalNuevo)} Y DEBE SEGUIR SUMANDO ${soles(g.total)}, QUE ES EL MONTO DEL VOUCHER.` }); return
    }
    const deltas = new Map()
    for (const p of cambios) deltas.set(p.installment_id, (deltas.get(p.installment_id) || 0) + p.nuevo - Number(p.amount))
    const cuotaIds = [...deltas.keys()].filter(Boolean)
    setRepartoBusy(true); setMsg(null)
    try {
      const { data: cuotas, error: e0 } = await supabase.from('installments')
        .select('id, amount, amount_paid, status, paid_date').in('id', cuotaIds)
      if (e0) throw e0
      for (const q of (cuotas || [])) {
        const nuevoPagado = Math.round((Number(q.amount_paid) + (deltas.get(q.id) || 0)) * 100) / 100
        if (nuevoPagado < -0.009 || nuevoPagado > Number(q.amount) + 0.009) throw new Error('EL REPARTO EXCEDE O DEJA NEGATIVA UNA CUOTA.')
      }
      for (const p of cambios) {
        const { error } = await supabase.from('daily_income').update({ amount: p.nuevo }).eq('id', p.id)
        if (error) throw error
      }
      for (const q of (cuotas || [])) {
        const nuevoPagado = Math.max(0, Math.round((Number(q.amount_paid) + (deltas.get(q.id) || 0)) * 100) / 100)
        const pagada = nuevoPagado >= Number(q.amount) - 0.009
        const { error } = await supabase.from('installments').update({
          amount_paid: nuevoPagado,
          status: pagada ? 'pagado' : (q.status === 'vencido' ? 'vencido' : 'pendiente'),
          paid_date: pagada ? (q.paid_date || g.referencia.date) : null,
        }).eq('id', q.id)
        if (error) throw error
      }
      await supabase.from('activity_log').insert({
        action: 'UPDATE', entity_type: 'daily_income', user_email: profile?.email || null,
        details: { cambio: 'reparto_voucher', operacion: g.referencia.operation_number, lote: g.lotes, monto_voucher: g.total,
          antes: cambios.map(p => ({ cuota: p.installment?.installment_number, monto: p.amount })),
          despues: cambios.map(p => ({ cuota: p.installment?.installment_number, monto: p.nuevo })), project_id: pidOp },
      })
      setMsg({ ok: true, t: 'REPARTO ACTUALIZADO. EL MONTO TOTAL DEL VOUCHER SE CONSERVÓ.' })
      setRepartoEdit(null)
      await loadBase()
    } catch (err) {
      setMsg({ ok: false, t: 'NO SE PUDO ACTUALIZAR EL REPARTO: ' + (err.message || err) })
    } finally { setRepartoBusy(false) }
  }

  // Rehace la cascada desde un voucher: conserva cada monto/voucher, pero vuelve
  // a repartirlo de la cuota más antigua pendiente hacia adelante. Sirve cuando
  // se corrigió un reparto antiguo y los pagos posteriores quedaron desfasados.
  async function recalcularCascadaDesde(g) {
    if (role !== 'superuser' || !g.referencia.sale_id) return
    if (!confirm(`¿Recalcular la cascada desde la operación ${g.referencia.operation_number}?\n\nSe conservarán los vouchers y sus montos; se corregirá únicamente a qué cuotas se aplican este pago y los posteriores.`)) return
    setRepartoBusy(true); setMsg(null)
    try {
      const [cuotasR, pagosR] = await Promise.all([
        supabase.from('installments').select('id, installment_number, amount, status, paid_date').eq('sale_id', g.referencia.sale_id).order('installment_number'),
        supabase.from('daily_income').select('*').eq('sale_id', g.referencia.sale_id).eq('income_type', 'cuota').order('date').order('created_at'),
      ])
      if (cuotasR.error) throw cuotasR.error
      if (pagosR.error) throw pagosR.error
      const cuotas = cuotasR.data || []
      const grupos = agruparPagos(pagosR.data || [])
      const desde = grupos.findIndex(x => x.items.some(p => p.id === g.referencia.id))
      if (desde < 0) throw new Error('NO ENCONTRÉ EL PAGO A RECALCULAR.')

      const anteriores = grupos.slice(0, desde).flatMap(x => x.items)
      const pagado = new Map(cuotas.map(q => [q.id, 0]))
      for (const p of anteriores) pagado.set(p.installment_id, (pagado.get(p.installment_id) || 0) + Number(p.amount || 0))
      const nuevos = []
      const borrarIds = grupos.slice(desde).flatMap(x => x.items.map(p => p.id))

      for (const grupo of grupos.slice(desde)) {
        let restante = Math.round(Number(grupo.total) * 100) / 100
        const fuente = grupo.items[0]
        const conVoucher = grupo.items.find(p => p.voucher_url) || fuente
        const conComprobante = grupo.items.find(p => p.receipt_url) || fuente
        for (const cuota of cuotas) {
          if (restante <= 0.004) break
          const debe = Math.max(0, Math.round((Number(cuota.amount) - (pagado.get(cuota.id) || 0)) * 100) / 100)
          if (debe <= 0.004) continue
          const toma = Math.min(restante, debe)
          const { id, created_at, ...base } = fuente
          nuevos.push({
            ...base, amount: Math.round(toma * 100) / 100, installment_id: cuota.id,
            voucher_url: conVoucher.voucher_url || null, voucher_note: conVoucher.voucher_note || null,
            receipt_url: conComprobante.receipt_url || null, receipt_note: conComprobante.receipt_note || null,
          })
          pagado.set(cuota.id, (pagado.get(cuota.id) || 0) + toma)
          restante = Math.round((restante - toma) * 100) / 100
        }
        if (restante > 0.01) throw new Error(`LA OPERACIÓN ${grupo.referencia.operation_number} EXCEDE LA DEUDA DE LAS CUOTAS EN ${soles(restante)}.`)
      }

      if (borrarIds.length) {
        const { error } = await supabase.from('daily_income').delete().in('id', borrarIds)
        if (error) throw error
      }
      if (nuevos.length) {
        const { error } = await supabase.from('daily_income').insert(nuevos)
        if (error) throw error
      }
      for (const cuota of cuotas) {
        const montoPagado = Math.round((pagado.get(cuota.id) || 0) * 100) / 100
        const pagada = montoPagado >= Number(cuota.amount) - 0.009
        const { error } = await supabase.from('installments').update({
          amount_paid: montoPagado,
          status: pagada ? 'pagado' : (cuota.status === 'vencido' ? 'vencido' : 'pendiente'),
          paid_date: pagada ? cuota.paid_date || g.referencia.date : null,
        }).eq('id', cuota.id)
        if (error) throw error
      }
      await supabase.from('activity_log').insert({
        action: 'UPDATE', entity_type: 'daily_income', user_email: profile?.email || null,
        details: { cambio: 'recalculo_cascada', desde_operacion: g.referencia.operation_number, lote: g.lotes, project_id: pidOp },
      })
      setRepartoEdit(null)
      setMsg({ ok: true, t: 'CASCADA RECALCULADA DESDE ESTE VOUCHER.' })
      await loadBase()
    } catch (err) {
      setMsg({ ok: false, t: 'NO SE PUDO RECALCULAR LA CASCADA: ' + (err.message || err) })
    } finally { setRepartoBusy(false) }
  }

  const pagosFiltrados = useMemo(() => {
    // busqueda avanzada: cada palabra puede ir en cualquier orden y contra
    // cualquier dato (lote, cliente, N operacion, concepto). "nilsson g7" o
    // "g7 cuota" encuentran igual.
    const terms = fq.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return pagos.filter(p => {
      if (ftipo !== 'todos' && p.income_type !== ftipo) return false
      // los marcados "no aplica" ya no son faltantes: no salen en estos filtros
      if (fdoc === 'sin_voucher' && (p.voucher_url || p.voucher_na)) return false
      if (fdoc === 'sin_comprobante' && (p.receipt_url || p.receipt_na)) return false
      if (fdoc === 'no_aplica' && !p.voucher_na && !p.receipt_na) return false
      if (fest !== 'todos' && estadoDe(p) !== fest) return false
      if (!terms.length) return true
      const heno = [
        p.lot ? `${p.lot.mz}${p.lot.lt} ${p.lot.mz}-${p.lot.lt} mz ${p.lot.mz} lt ${p.lot.lt}` : '',
        p.client?.full_name || '', p.operation_number || '',
        p.income_type || '', p.installment ? 'cuota ' + p.installment.installment_number : '',
      ].join(' ').toLowerCase()
      return terms.every(w => heno.includes(w))
    })
  }, [pagos, fq, ftipo, fdoc, fest])   // fest FALTABA: por eso el filtro de estado no reaccionaba
  const gruposHistorial = useMemo(() => agruparPagos(pagosFiltrados), [pagosFiltrados])
  const gruposTotales = useMemo(() => agruparPagos(pagos), [pagos])
  const pag = usePaginacion(gruposHistorial, 50)   // 50 depósitos por pagina, sin recargar

  const totalFiltrado = pagosFiltrados.reduce((s, p) => s + Number(p.amount), 0)
  const sinVoucher = gruposTotales.filter(g => !g.voucherUrl && !g.voucherNA).length
  const sinComprobante = gruposTotales.filter(g => !g.comprobanteUrl && !g.comprobanteNA).length
  const noAplica = gruposTotales.filter(g => g.voucherNA || g.comprobanteNA).length
  const hayFiltro = !!fq || ftipo !== 'todos' || fdoc !== 'todos' || fest !== 'todos'
  const limpiarFiltros = () => { setFq(''); setFtipo('todos'); setFdoc('todos'); setFest('todos') }
  const abrirPago = r => setView(r)
  // Celda de VOUCHER / COMPROBANTE del historial: el documento, o el boton para
  // subirlo, o la marca "no aplica" cuando ese pago no va a tener documento.
  function celdaDoc(g, campo) {
    const esVoucher = campo === 'voucher_url'
    const url = esVoucher ? g.voucherUrl : g.comprobanteUrl
    const na = esVoucher ? g.voucherNA : g.comprobanteNA
    const motivo = esVoucher ? g.voucherNAMotivo : g.comprobanteNAMotivo
    const falta = esVoucher ? g.voucherFaltante : g.comprobanteFaltante
    if (url) return <><a href={url} target="_blank" rel="noreferrer">VER</a>{falta && <span className="warn small"> + falta</span>}</>
    if (na) return (
      <span className="st-chip st-na" title={'NO APLICA' + (motivo ? ' — ' + motivo : '')}>
        no aplica
        {!readOnly && <button className="link-btn" style={{ marginLeft: 4, fontSize: 11 }}
          title="Volver a pedir este documento" onClick={() => quitarNoAplica(g.items, campo)}>&#8634;</button>}
      </span>
    )
    if (readOnly) return <span className="muted">-</span>
    return (
      <>
        <label className={'upload-btn ' + (esVoucher ? 'warn' : 'bad')}>{esVoucher ? 'subir' : '⚠ falta'}
          <input type="file" accept="image/*,.pdf" hidden
            onChange={e => e.target.files[0] && subirDoc(g.referencia, e.target.files[0], campo)} />
        </label>
        {naOk && <button className="link-btn" style={{ display: 'block', fontSize: 10, marginTop: 2 }}
          title="Este pago nunca va a tener este documento (cascada, cuadre, canje). Se pide el motivo."
          onClick={() => marcarNoAplica(g.items, campo)}>no aplica</button>}
      </>
    )
  }

  const alternarGrupo = key => setGruposAbiertos(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Cuotas mensuales</h1>
        <ProjectPicker />
      </div>

      {!readOnly && (
        <div className="glass" style={{ padding: '12px 14px', margin: '0 0 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderLeft: '4px solid var(--accent)' }}>
          <span style={{ flex: '1 1 260px' }}>&#128181; <b>Para cobrar</b> (separación, inicial o cuota) abre la <b>ficha del lote</b>: ahí están el cronograma, los pagos y los documentos juntos.</span>
          <div style={{ flex: '1 1 320px', maxWidth: 460 }}><BuscarLote placeholder="Lote (G7), nombre, DNI o celular…" /></div>
        </div>
      )}

      {msg && <p className={msg.ok ? 'ok' : 'error'} style={{ margin: '0 0 8px' }}>{msg.t}</p>}
      <h2 className="sub">
        Historial ({gruposHistorial.length} pagos / {pagosFiltrados.length} aplicaciones de {pagos.length} | {soles(totalFiltrado)})
        {!readOnly && sinVoucher > 0 && <span className="warn"> | SIN VOUCHER: {sinVoucher}</span>}
        {!readOnly && sinComprobante > 0 && <span className="bad"> | FALTA COMPROBANTE: {sinComprobante}</span>}
        {!readOnly && noAplica > 0 && <span className="muted" style={{ fontWeight: 400 }}> | NO APLICA: {noAplica}</span>}
      </h2>
      <div className="filtros">
        <input className="search fx-search" placeholder="Buscar: lote (G7), cliente, N° operación… (varias palabras)"
          value={fq} onChange={e => setFq(e.target.value)} />
        <select className={`fx-sel ${ftipo !== 'todos' ? 'on' : ''}`} value={ftipo} onChange={e => setFtipo(e.target.value)}>
          <option value="todos">🔖 Tipo: todos</option>
          <option value="cuota">Cuotas</option>
          <option value="inicial">Iniciales</option>
          <option value="separacion">Separaciones</option>
        </select>
        <select className={`fx-sel ${fdoc !== 'todos' ? 'on' : ''}`} value={fdoc} onChange={e => setFdoc(e.target.value)}>
          <option value="todos">📎 Docs: todos</option>
          <option value="sin_voucher">Sin voucher</option>
          <option value="sin_comprobante">Sin comprobante</option>
          {noAplica > 0 && <option value="no_aplica">Marcados "no aplica" ({noAplica})</option>}
        </select>
        <select className={`fx-sel ${fest !== 'todos' ? 'on' : ''}`} value={fest} onChange={e => setFest(e.target.value)}>
          <option value="todos">● Estado: todos</option>
          <option value="ACEPTADO">Aceptados</option>
          <option value="EXPROPIADO">Expropiados</option>
          <option value="PERDIDA">Pérdidas</option>
        </select>
        {hayFiltro && <button className="fx-clear" onClick={limpiarFiltros} title="Quitar todos los filtros">✕ Limpiar</button>}
      </div>

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Lote</th><th>Concepto</th><th>Estado</th><th>Monto</th><th>Voucher</th><th>Comprobante</th><th>Cliente</th><th>N Op.</th><th>Banco</th></tr></thead>
          <tbody>
            {pag.pagina.map(g => {
              const expandible = g.items.length > 1
              const abierto = gruposAbiertos.has(g.key)
              const editando = repartoEdit?.key === g.key
              const puedeEditarReparto = role === 'superuser' && g.items.every(p => p.installment_id)
              const totalEditado = editando
                ? Math.round(g.items.reduce((s, p) => s + Number(repartoEdit.valores[p.id] || 0), 0) * 100) / 100
                : g.total
              const r = g.referencia
              return (
                <Fragment key={g.key}>
                  <tr key={g.key} className={'row-' + estadoDe(r).toLowerCase()}>
                    <td>{r.date}</td>
                    <td>{g.lotes}</td>
                    <td><button className="link-btn" title={expandible ? 'Ver cómo se distribuyó el pago' : 'Ver documentos'} onClick={() => expandible ? alternarGrupo(g.key) : abrirPago(r)}>
                      {expandible && (abierto ? '▾ ' : '▸ ')}{g.concepto}
                    </button></td>
                    <td><EstadoChip r={r} /></td>
                    <td><b>{soles(g.total)}</b>{expandible && <span className="muted small"> ({g.items.length} cuotas)</span>}
                      {puedeEditarReparto && <button className="link-btn" style={{ marginLeft: 6, fontSize: 11 }} title="Corregir directamente cómo se repartió este voucher" onClick={() => editando ? setRepartoEdit(null) : editarReparto(g)}>
                        {editando ? 'Cancelar edición' : '✎ Editar reparto'}
                      </button>}
                      {puedeEditarReparto && <button className="link-btn" style={{ marginLeft: 6, fontSize: 11 }} disabled={repartoBusy}
                        title="Reparte de nuevo este voucher y los posteriores, respetando el monto de cada cuota"
                        onClick={() => recalcularCascadaDesde(g)}>↻ Recalcular cascada</button>}
                    </td>
                    <td>{celdaDoc(g, 'voucher_url')}</td>
                    <td>{celdaDoc(g, 'receipt_url')}</td>
                    <td>{g.clientes}</td>
                    <td>{r.operation_number}</td>
                    <td>{r.account?.name || '-'}</td>
                  </tr>
                  {abierto && g.items.map((p, i) => (
                    <tr key={p.id} style={{ background: 'rgba(255,255,255,.025)' }}>
                      <td></td>
                      <td>{p.lot ? `${p.lot.mz}-${p.lot.lt}` : '-'}</td>
                      <td><button className="link-btn muted" title="Ver detalle de esta aplicación" onClick={() => abrirPago(p)}>↳ {conceptoPago(p)}</button></td>
                      <td><span className="muted small">aplicación</span></td>
                      <td>{editando
                        ? <input type="number" step="0.01" min="0" value={repartoEdit.valores[p.id] ?? ''} autoFocus={i === 0}
                            onChange={e => setRepartoEdit(x => ({ ...x, valores: { ...x.valores, [p.id]: e.target.value } }))}
                            style={{ width: 92, padding: '3px 5px' }} />
                        : soles(p.amount)}</td>
                      <td colSpan="5" className="muted small">{editando && i === g.items.length - 1 ? <>
                        Reparto: <b className={Math.abs(totalEditado - Number(g.total)) <= 0.009 ? 'ok' : 'bad'}>{soles(totalEditado)} de {soles(g.total)}</b>{' '}
                        <button className="btn-ghost" style={{ fontSize: 11 }} disabled={repartoBusy || Math.abs(totalEditado - Number(g.total)) > 0.009} onClick={() => guardarReparto(g)}>{repartoBusy ? 'Guardando...' : 'Guardar reparto'}</button>
                      </> : <>Parte del pago S/ {soles(g.total)} · operación {r.operation_number}</>}</td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <Paginador {...pag} />

      {view && (
        <DetallePago key={view.id} pago={view} pagos={pagos} accounts={accounts} naOk={naOk}
          onClose={() => setView(null)} onCambio={loadBase} />
      )}
    </>
  )
}
