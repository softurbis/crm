import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { upload } from '../lib/archivos'
import { useMsg, savedFx } from '../lib/saveFx'
import { pedir } from '../lib/dialogos'
import { useAuth } from '../context/AuthContext'
import { hoyPe } from '../lib/cobros'
import { fechaPe } from '../lib/lotes'
import VisorDoc from '../components/VisorDoc'

// COMPROBANTES POR SUBIR (sql/133-134, 9 oct 2026): la pantalla del rol FACTURACIÓN,
// la secretaria de la otra empresa que hace las boletas y facturas en su propio
// sistema. Ve SOLO los pagos de los proyectos que el superusuario le asignó, con
// su voucher, y lo único que hace es subir el comprobante de cada pago (uno por
// pago). No lee tablas directo: todo pasa por facturacion_pagos / facturacion_subir.
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const finDeMes = m => { const [y, mm] = m.split('-').map(Number); return m + '-' + String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, '0') }
const TIPO = { cuota: 'CUOTA', inicial: 'INICIAL', separacion: 'SEPARACIÓN', mora: 'MORA', otro: 'OTRO' }

// las partes de un mismo depósito (una cascada lo reparte en varias cuotas): un pago
export function agruparDepositos(filas) {
  const m = new Map()
  for (const f of filas || []) {
    const op = String(f.operation_number || '').trim().toUpperCase()
    const k = !op || op === 'SIN-REF' ? 'fila:' + f.id : [f.project_id, f.date, op, f.financial_account_id || ''].join('|')
    if (!m.has(k)) m.set(k, { key: k, items: [] })
    m.get(k).items.push(f)
  }
  return [...m.values()].map(g => {
    const r = g.items[0]
    const cuotas = g.items.filter(x => x.tipo === 'cuota' && x.cuota).map(x => x.cuota).sort((a, b) => a - b)
    const tipos = [...new Set(g.items.map(x => x.tipo))]
    return {
      ...g, r,
      total: Math.round(g.items.reduce((s, x) => s + Number(x.amount || 0), 0) * 100) / 100,
      concepto: cuotas.length === g.items.length ? (cuotas.length > 1 ? 'CUOTAS N ' + cuotas.join(' + ') : 'CUOTA N ' + cuotas[0]) : tipos.map(t => TIPO[t] || t.toUpperCase()).join(' + '),
      pendiente: g.items.some(x => x.pendiente),
      comprobante: g.items.find(x => x.receipt_url) || null,
      electronico: g.items.find(x => x.ce_estado && !['rechazado', 'anulado', 'error'].includes(x.ce_estado)) || null,
      noAplica: g.items.every(x => x.receipt_na),
      esMio: g.items.some(x => x.es_mio),
    }
  })
}

export default function Facturacion() {
  const { profile } = useAuth()
  const [msg, setMsg] = useMsg(null)
  const [vista, setVista] = useState('pendientes')
  const [mes, setMes] = useState(() => hoyPe().slice(0, 7))
  const [proy, setProy] = useState('todos')
  const [filas, setFilas] = useState(null)
  const [verDoc, setVerDoc] = useState(null)
  const [subiendo, setSubiendo] = useState(null)

  async function cargar() {
    setFilas(null)
    const args = vista === 'pendientes' ? { p_solo_pendientes: true } : { p_desde: mes + '-01', p_hasta: finDeMes(mes) }
    const { data, error } = await supabase.rpc('facturacion_pagos', args)
    if (error) { setMsg({ ok: false, t: /facturacion_pagos/.test(error.message) ? 'Falta correr sql/134 en el servidor.' : error.message }); setFilas([]); return }
    setFilas(data || [])
  }
  useEffect(() => { cargar() }, [vista, mes])

  const grupos = useMemo(() => agruparDepositos(filas), [filas])
  const proyectos = useMemo(() => [...new Set(grupos.map(g => g.r.proyecto))].sort(), [grupos])
  const vistaGrupos = grupos.filter(g => proy === 'todos' || g.r.proyecto === proy)
  const pendPorProy = useMemo(() => {
    const m = {}
    for (const g of grupos) if (g.pendiente) m[g.r.proyecto] = (m[g.r.proyecto] || 0) + 1
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [grupos])

  async function subir(g, file) {
    const nota = await pedir('N° de la boleta o factura (opcional, ej: B001-123):', { valor: '' })
    if (nota === null) return
    setSubiendo(g.key)
    try {
      const url = await upload('comprobantes/' + g.items[0].id, file)
      const { error } = await supabase.rpc('facturacion_subir', { p_ids: g.items.map(x => x.id), p_url: url, p_nota: nota.trim().toUpperCase() || null })
      if (error) throw error
      setMsg({ ok: true, t: 'COMPROBANTE SUBIDO: ' + g.r.proyecto + ' · ' + (g.r.mz ? 'MZ ' + g.r.mz + ' LT ' + g.r.lt + ' · ' : '') + soles(g.total) })
      savedFx(); cargar()
    } catch (e) { setMsg({ ok: false, t: e.message || String(e) }) }
    setSubiendo(null)
  }

  const meses = useMemo(() => {
    const out = [], d = new Date(Date.UTC(Number(hoyPe().slice(0, 4)), Number(hoyPe().slice(5, 7)) - 1, 1))
    for (let i = 0; i < 18; i++) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() - 1) }
    return out
  }, [])
  const totalPend = pendPorProy.reduce((s, [, n]) => s + n, 0)

  return (
    <>
      <div className="toolbar"><h1 style={{ margin: 0, flex: 1 }}>Comprobantes por subir</h1></div>
      <p className="muted small" style={{ margin: '-.4rem 0 .8rem' }}>
        Los pagos de tus proyectos. A cada pago súbele su boleta o factura (una por pago). {profile?.full_name ? 'Usuario: ' + profile.full_name + '.' : ''}
      </p>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      <div className="chips">
        <button className={`chip ${vista === 'pendientes' ? 'on' : ''}`} onClick={() => setVista('pendientes')}>⏳ Pendientes{vista === 'pendientes' && filas ? ' (' + totalPend + ')' : ''}</button>
        <button className={`chip ${vista === 'mes' ? 'on' : ''}`} onClick={() => setVista('mes')}>📅 Todos los pagos del mes</button>
        {vista === 'mes' && (
          <select value={mes} onChange={e => setMes(e.target.value)}>
            {meses.map(m => <option key={m} value={m}>{m.slice(5, 7)}/{m.slice(0, 4)}</option>)}
          </select>
        )}
        {proyectos.length > 1 && (
          <select value={proy} onChange={e => setProy(e.target.value)}>
            <option value="todos">Todos los proyectos</option>
            {proyectos.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
      </div>

      {vista === 'pendientes' && filas && (totalPend
        ? <p className="hint">⏳ Tienes <b>{totalPend}</b> pago(s) sin boleta o factura: {pendPorProy.map(([p, n]) => p + ' ' + n).join(' · ')}.</p>
        : <p className="ok">✅ No tienes pagos pendientes de comprobante.</p>)}

      {filas === null && <p className="muted">Cargando…</p>}
      {filas && !vistaGrupos.length && vista === 'mes' && <p className="muted">No hay pagos en ese mes.</p>}
      {!!vistaGrupos.length && (
        <div className="glass table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Proyecto · lote</th><th>Cliente</th><th>Concepto</th><th style={{ textAlign: 'right' }}>Monto</th><th>Operación</th><th>Voucher</th><th>Boleta / factura</th></tr></thead>
            <tbody>
              {vistaGrupos.map(g => (
                <tr key={g.key}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fechaPe(g.r.date)}</td>
                  <td className="small">{g.r.proyecto}<div><b>{g.r.mz ? 'MZ ' + g.r.mz + ' LT ' + g.r.lt : '—'}</b></div></td>
                  <td className="small" style={{ textTransform: 'none' }}>{g.r.cliente || '—'}
                    {g.r.doc_number && <div className="muted">{g.r.doc_type || 'DOC'} {g.r.doc_number}</div>}</td>
                  <td className="small">{g.concepto}{g.r.venta_estado === 'expropiado' && <div className="warn">venta expropiada</div>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><b>{soles(g.total)}</b></td>
                  <td className="small" style={{ textTransform: 'none' }}>{g.r.operation_number}<div className="muted">{g.r.banco || ''}</div></td>
                  <td>{g.r.voucher_url
                    ? <button className="link-btn" onClick={() => setVerDoc({ url: g.items.find(x => x.voucher_url).voucher_url, titulo: 'Voucher · ' + fechaPe(g.r.date) + ' · ' + soles(g.total) })}>VER</button>
                    : <span className="muted small">sin voucher</span>}</td>
                  <td>
                    {g.comprobante ? (<>
                      <button className="link-btn" onClick={() => setVerDoc({ url: g.comprobante.receipt_url, titulo: 'Comprobante · ' + (g.comprobante.receipt_note || fechaPe(g.r.date)) })}>VER</button>
                      {g.comprobante.receipt_note && <span className="muted small"> {g.comprobante.receipt_note}</span>}
                      {g.esMio && <label className="link-btn small" style={{ marginLeft: 6 }}>cambiar
                        <input type="file" accept="image/*,.pdf" hidden onChange={e => e.target.files[0] && subir(g, e.target.files[0])} /></label>}
                    </>) : g.electronico ? (
                      g.electronico.ce_pdf
                        ? <button className="link-btn" onClick={() => setVerDoc({ url: g.electronico.ce_pdf, titulo: g.electronico.ce_serie + '-' + (g.electronico.ce_numero || '') })}>{g.electronico.ce_serie}-{g.electronico.ce_numero || '…'}</button>
                        : <span className="muted small">{g.electronico.ce_serie} en proceso</span>
                    ) : g.noAplica ? <span className="muted small">no aplica</span>
                      : <label className={'upload-btn ' + (subiendo === g.key ? '' : 'warn')}>{subiendo === g.key ? 'Subiendo…' : '⬆ Subir'}
                          <input type="file" accept="image/*,.pdf" hidden disabled={!!subiendo} onChange={e => e.target.files[0] && subir(g, e.target.files[0])} /></label>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {verDoc && (
        <div className="modal-bg" onClick={() => setVerDoc(null)}>
          <div className="glass modal docs-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h2>{verDoc.titulo}</h2><button className="btn-ghost" onClick={() => setVerDoc(null)}>&#10005;</button></div>
            <p className="muted small"><a href={verDoc.url} target="_blank" rel="noreferrer">abrir aparte</a></p>
            <VisorDoc url={verDoc.url} titulo={verDoc.titulo} />
          </div>
        </div>
      )}
    </>
  )
}
