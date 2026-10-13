import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import VisorDoc from './VisorDoc'

// ESTADO DE CUENTA DE UN LOTE, SOLO LEER (sql/146, 13 oct 2026): para la secretaria de
// facturación, que no tiene la ficha del lote. Lo que necesita para emitir la boleta o
// la factura con los datos correctos: el cliente (nombre, documento, dirección), la
// venta, el cronograma y los pagos con sus documentos. Sin celulares ni fotos del DNI.
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fechaPe = d => d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4) : '—'
const TIPO = { cuota: 'CUOTA', inicial: 'INICIAL', separacion: 'SEPARACIÓN', mora: 'MORA', otro: 'OTRO' }
const ESTADO_LOTE = { disponible: 'DISPONIBLE', separado: 'SEPARADO', vendido: 'VENDIDO', invadido: 'INVADIDO', expropiado: 'EXPROPIADO', entregado: 'ENTREGADO' }

export default function EstadoCuentaLote({ lotId, onCerrar }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [ver, setVer] = useState(null)
  useEffect(() => {
    supabase.rpc('facturacion_estado_lote', { p_lot: lotId }).then(({ data, error }) => {
      if (error) setErr(/facturacion_estado_lote/.test(error.message) ? 'Falta correr sql/146 en el servidor.' : error.message)
      else setD(data)
    })
  }, [lotId])

  const v = d?.venta, c = d?.cliente
  const pagosVenta = (d?.pagos || []).filter(p => p.de_esta_venta)
  const pagado = pagosVenta.reduce((s, p) => s + Number(p.monto || 0), 0)
  const vencidas = (d?.cuotas || []).filter(q => q.vencida)
  const debeVencido = vencidas.reduce((s, q) => s + Number(q.monto) - Number(q.pagado || 0), 0)
  const cuotasPagadas = (d?.cuotas || []).filter(q => Number(q.pagado) >= Number(q.monto) - 0.009).length
  const direccion = c && [c.address, c.district, c.province, c.department].filter(Boolean).join(', ')

  return (
    <div className="modal-bg" onClick={onCerrar}>
      <div className="glass modal fg-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2 style={{ flex: 1 }}>{d ? d.lote.proyecto + ' · MZ ' + d.lote.mz + ' LT ' + d.lote.lt : 'Estado de cuenta'}
            {d && <span className="muted small" style={{ marginLeft: 8 }}>{ESTADO_LOTE[d.lote.status] || d.lote.status}</span>}</h2>
          <button className="btn-ghost" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        {err && <p className="error">{err}</p>}
        {!d && !err && <p className="muted">Cargando…</p>}
        {d && <>
          <div className="fg-grid">
            <div>
              <p className="fg-sub">Cliente</p>
              {c ? <>
                <div className="fg-dato"><span className="muted small">Nombre</span><span><b>{c.full_name}</b></span></div>
                <div className="fg-dato"><span className="muted small">Documento</span><span>{c.doc_type} {c.doc_number}</span></div>
                <div className="fg-dato"><span className="muted small">Dirección</span><span>{direccion || '—'}</span></div>
                {d.co_cliente && <div className="fg-dato"><span className="muted small">Co-comprador</span><span>{d.co_cliente.full_name} · {d.co_cliente.doc_type} {d.co_cliente.doc_number}</span></div>}
              </> : d.separacion ? <>
                <div className="fg-dato"><span className="muted small">Separó</span><span><b>{d.separacion.cliente}</b> · DNI {d.separacion.doc_number}</span></div>
                <div className="fg-dato"><span className="muted small">Separación</span><span>{soles(d.separacion.monto)} el {fechaPe(d.separacion.fecha)} · vence {fechaPe(d.separacion.vence)}</span></div>
              </> : <p className="muted small">Este lote no tiene venta ni separación.</p>}
            </div>
            <div>
              <p className="fg-sub">Venta</p>
              {v ? <>
                <div className="fg-dato"><span className="muted small">Fecha</span><span>{fechaPe(v.fecha)}{v.estado !== 'en_proceso' ? ' · ' + v.estado.toUpperCase() : ''}</span></div>
                <div className="fg-dato"><span className="muted small">Precio</span><span><b>{soles(v.precio)}</b></span></div>
                <div className="fg-dato"><span className="muted small">Inicial</span><span>{soles(v.inicial)}</span></div>
                <div className="fg-dato"><span className="muted small">Cuotas</span><span>{v.n_cuotas} × {soles(v.cuota_mensual)} · {cuotasPagadas} pagadas</span></div>
                <div className="fg-dato"><span className="muted small">Pagado hasta hoy</span><span className="ok"><b>{soles(pagado)}</b></span></div>
                <div className="fg-dato"><span className="muted small">Saldo</span><span><b>{soles(Math.max(0, Number(v.precio) - pagado))}</b></span></div>
                {vencidas.length > 0 && <div className="fg-dato"><span className="muted small">Vencido</span><span className="bad"><b>{vencidas.length} cuota{vencidas.length > 1 ? 's' : ''} · {soles(debeVencido)}</b></span></div>}
              </> : <p className="muted small">Sin venta.</p>}
            </div>
          </div>

          <p className="fg-sub">Pagos ({d.pagos.length})</p>
          {d.pagos.length ? (
            <div className="table-wrap" style={{ marginBottom: '.8rem' }}>
              <table>
                <thead><tr><th>Fecha</th><th>Concepto</th><th style={{ textAlign: 'right' }}>Monto</th><th>Operación</th><th>Voucher</th><th>Boleta / factura</th></tr></thead>
                <tbody>
                  {[...d.pagos].reverse().map(p => (
                    <tr key={p.id} style={p.de_esta_venta ? undefined : { opacity: .6 }}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fechaPe(p.fecha)}</td>
                      <td className="small">{TIPO[p.tipo] || p.tipo}{p.cuota ? ' N ' + p.cuota : ''}{!p.de_esta_venta && <div className="muted">de una venta anterior</div>}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{soles(p.monto)}</td>
                      <td className="small" style={{ textTransform: 'none' }}>{p.operacion}<div className="muted">{p.banco || ''}</div></td>
                      <td>{p.voucher_url ? <button className="link-btn" onClick={() => setVer({ url: p.voucher_url, t: 'Voucher · ' + fechaPe(p.fecha) })}>VER</button> : <span className="muted small">—</span>}</td>
                      <td>{p.receipt_url ? <><button className="link-btn" onClick={() => setVer({ url: p.receipt_url, t: 'Comprobante · ' + (p.receipt_note || fechaPe(p.fecha)) })}>VER</button>{p.receipt_note && <span className="muted small"> {p.receipt_note}</span>}</>
                        : p.ce_serie && !['rechazado', 'anulado', 'error'].includes(p.ce_estado) ? (p.ce_pdf ? <button className="link-btn" onClick={() => setVer({ url: p.ce_pdf, t: p.ce_serie + '-' + (p.ce_numero || '') })}>{p.ce_serie}-{p.ce_numero || '…'}</button> : <span className="muted small">{p.ce_serie} en proceso</span>)
                        : p.receipt_na ? <span className="muted small">no aplica</span> : <span className="warn small">falta</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted small">Sin pagos.</p>}

          {d.cuotas.length > 0 && <>
            <p className="fg-sub">Cronograma ({d.cuotas.length} cuotas)</p>
            <div className="table-wrap" style={{ maxHeight: 320 }}>
              <table>
                <thead><tr><th>N°</th><th>Vence</th><th style={{ textAlign: 'right' }}>Cuota</th><th style={{ textAlign: 'right' }}>Pagado</th><th>Estado</th></tr></thead>
                <tbody>
                  {d.cuotas.map(q => {
                    const pagada = Number(q.pagado) >= Number(q.monto) - 0.009
                    return (
                      <tr key={q.n}>
                        <td>{q.n}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fechaPe(q.vence)}</td>
                        <td style={{ textAlign: 'right' }}>{soles(q.monto)}</td>
                        <td style={{ textAlign: 'right' }}>{Number(q.pagado) > 0 ? soles(q.pagado) : '—'}</td>
                        <td className="small">{pagada ? <span className="ok">✔ pagada{q.fecha_pago ? ' ' + fechaPe(q.fecha_pago) : ''}</span>
                          : q.vencida ? <span className="bad">vencida{Number(q.pagado) > 0 ? ' (parcial)' : ''}</span>
                          : Number(q.pagado) > 0 ? <span className="warn">parcial</span> : <span className="muted">por vencer</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>}
        </>}

        {ver && (
          <div className="modal-bg" onClick={() => setVer(null)}>
            <div className="glass modal docs-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-head"><h2>{ver.t}</h2><button className="btn-ghost" onClick={() => setVer(null)}>✕</button></div>
              <p className="muted small"><a href={ver.url} target="_blank" rel="noreferrer">abrir aparte</a></p>
              <VisorDoc url={ver.url} titulo={ver.t} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
