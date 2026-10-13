import { useState } from 'react'
import VisorDoc from './VisorDoc'
import { estadoGasto, numeroGasto, fechaHora } from './ConstanciaGasto'

// LA FICHA DE UN GASTO (13 oct 2026): todo lo del gasto en una ventana, como el
// detalle de un pago de lote. Solo muestra: no cambia nada. La abren la pantalla de
// Gastos de facturación y Gastos (al tocar el N° de la solicitud).
//   proyecto: { name, expense_approval }   onImprimir(g): abre la constancia para imprimir
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fechaPe = d => d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4) : ''
const ESTADO = {
  confirmado: ['ok', '✔ PAGADO'], rechazado: ['bad', '✖ RECHAZADO'], aprobado: ['ok', '✍ APROBADO'],
  por_firmar: ['warn', '⏳ POR FIRMAR (quien lo pide)'], solicitado: ['warn', '⏳ POR APROBAR'],
}

export default function FichaGasto({ g, proyecto, onCerrar, onImprimir }) {
  const e = estadoGasto(g)
  const porPagar = e === 'aprobado' && !!proyecto?.expense_approval && !g.voucher_url
  const [cls, txt] = porPagar ? ['warn', '💸 POR PAGAR · falta el voucher'] : ESTADO[e]
  const extras = Array.isArray(g.receipt_docs) ? g.receipt_docs : []
  const docs = [
    g.request_doc_url && { url: g.request_doc_url, t: 'Constancia firmada', nota: g.request_doc_note },
    g.receipt_url && { url: g.receipt_url, t: 'RH / factura', nota: g.receipt_note },
    ...extras.map((d, i) => ({ url: d.url, t: 'RH ' + (i + 2), nota: d.note })),
    g.voucher_url && { url: g.voucher_url, t: 'Voucher del pago', nota: g.voucher_note },
    g.reposicion?.voucher_url && { url: g.reposicion.voucher_url, t: 'Reposición', nota: 'a ' + g.reposicion.persona + ' · ' + fechaPe(g.reposicion.fecha) },
  ].filter(Boolean)
  const [doc, setDoc] = useState(docs[0] || null)
  const items = (g.detail || '').split('\n').map(l => l.split('|').map(x => x.trim())).filter(a => a.length >= 2)
  const pidio = g.requester_name || g.pedido_por_nombre

  // el recorrido del gasto, en orden
  const pasos = [
    { t: 'Registrada', cuando: g.created_at, quien: g.registrado_por_nombre },
    g.requester_id && { t: 'Firmó quien lo pide', cuando: g.requester_signed_at, quien: pidio, cod: g.requester_code, espera: 'espera la firma de ' + (pidio || 'quien lo pide') },
    proyecto?.expense_approval && !g.rejected_at && { t: 'Aprobó la socia', cuando: g.approved_at, quien: g.approved_name, cod: g.approval_code, espera: 'espera la aprobación de la socia' },
    g.rejected_at && { t: 'Rechazada', cuando: g.rejected_at, quien: g.rejected_reason, mal: true },
    !g.rejected_at && { t: 'Pagado', cuando: g.confirmed_at, quien: g.pagado_por_nombre, nota: g.voucher_note, espera: porPagar ? 'falta subir el voucher' : 'todavía no se paga' },
    g.adelanto_por && { t: 'Reposición a ' + g.adelanto_por, cuando: g.reposicion?.fecha, nota: g.reposicion?.operacion ? 'OP ' + g.reposicion.operacion : '', espera: 'falta devolverle el dinero' },
  ].filter(Boolean)

  const dato = (t, v) => v ? <div className="fg-dato"><span className="muted small">{t}</span><span>{v}</span></div> : null
  return (
    <div className="modal-bg" onClick={onCerrar}>
      <div className="glass modal fg-modal" onClick={ev => ev.stopPropagation()}>
        <div className="modal-head">
          <h2 style={{ flex: 1 }}>{numeroGasto(g)} <span className={cls + ' small'} style={{ marginLeft: 8 }}>{txt}</span></h2>
          {onImprimir && <button className="btn-ghost" onClick={() => onImprimir(g)}>🖨 Imprimir constancia</button>}
          <button className="btn-ghost" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>

        <div className="fg-cab">
          <div className="fg-monto">{soles(g.amount)}</div>
          <div><b>{g.recipient || '—'}</b>{g.recipient_dni ? <span className="muted"> · DNI {g.recipient_dni}</span> : null}</div>
          <div className="fg-motivo">{g.description || g.type}</div>
          {g.rejected_at && <div className="bad small" style={{ textTransform: 'none' }}>Motivo del rechazo: {g.rejected_reason || '—'}</div>}
        </div>

        <div className="fg-grid">
          <div>
            <p className="fg-sub">Datos</p>
            {dato('Proyecto', proyecto?.name)}
            {dato('Tipo', g.type)}
            {dato('Fecha', fechaPe(g.issue_date || g.reception_date))}
            {dato('Recibe', g.recipient && (g.recipient + (g.recipient_dni ? ' · DNI ' + g.recipient_dni : '')))}
            {dato('Entrega', g.sender && (g.sender + (g.sender_dni ? ' · DNI ' + g.sender_dni : '')))}
            {dato('Se descuenta de', g.discount_from)}
            {dato('Cómo se paga', g.payment_method)}
            {dato('Comprobante que presenta', g.document_type)}
            {dato('Lo adelantó', g.adelanto_por)}
            {items.length > 0 && (
              <table className="fg-detalle"><thead><tr><th>Fecha</th><th>Detalle</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
                <tbody>{items.map((a, i) => <tr key={i}><td>{a[0]}</td><td>{a[1]}</td><td style={{ textAlign: 'right' }}>{a[2] ? soles(a[2]) : ''}</td></tr>)}</tbody>
              </table>
            )}
          </div>
          <div>
            <p className="fg-sub">Recorrido</p>
            <ol className="fg-pasos">
              {pasos.map((p, i) => (
                <li key={i} className={p.mal ? 'mal' : p.cuando ? 'hecho' : 'falta'}>
                  <b>{p.t}</b>
                  {p.cuando
                    ? <span className="small">{String(p.cuando).length > 10 ? fechaHora(p.cuando) : fechaPe(p.cuando)}{p.quien ? ' · ' + p.quien : ''}</span>
                    : <span className="small muted">{p.espera || '—'}</span>}
                  {p.cod && p.cuando && <span className="muted small">código {p.cod}</span>}
                  {p.nota && p.cuando && <span className="muted small">{p.nota}</span>}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <p className="fg-sub">Documentos</p>
        {!docs.length && <p className="muted small">Todavía no tiene documentos.</p>}
        {docs.length > 0 && <>
          <div className="chips" style={{ marginBottom: 6 }}>
            {docs.map(d => <button key={d.url} type="button" className={'chip' + (doc?.url === d.url ? ' on' : '')} onClick={() => setDoc(d)}>{d.t}</button>)}
          </div>
          {doc && <>
            <p className="muted small" style={{ textTransform: 'none', margin: '0 0 4px' }}>{doc.nota ? doc.nota + ' · ' : ''}<a href={doc.url} target="_blank" rel="noreferrer">abrir aparte ↗</a></p>
            <VisorDoc key={doc.url} url={doc.url} titulo={doc.t} alto={460} />
          </>}
        </>}
      </div>
    </div>
  )
}
