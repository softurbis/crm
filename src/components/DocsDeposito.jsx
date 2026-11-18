import { Fragment } from 'react'
import BotonImprimirVoucher from './BotonImprimirVoucher'

// El voucher o el comprobante de un DEPÓSITO en el historial de pagos (Pagos y la
// ficha del lote). Un documento basta para todo el depósito aunque se haya repartido
// en varias cuotas (12 oct: salía "VER + falta"). Si se subió uno por cuota, salen
// todos, cada uno con su cuota. "+ otro" sube uno distinto para una sola cuota.
// El voucher lleva además 🖨: su hoja A4 con lote, cliente y monto (18 nov).
export default function DocsDeposito({ g, docs, campo, readOnly, onOtro }) {
  const varias = g.items.length > 1
  const esVoucher = campo === 'voucher_url'
  const que = esVoucher ? 'Voucher' : 'Comprobante'
  // uno solo vale por todo el depósito; con varios, cada uno por sus cuotas
  const itemsDe = d => docs.length > 1 ? g.items.filter(p => d.ids.includes(p.id)) : g.items
  return (
    <span className="docs-dep">
      {docs.map((d, i) => (
        <Fragment key={d.url}>
          {i > 0 && <span className="muted"> · </span>}
          <a href={d.url} target="_blank" rel="noreferrer"
            title={que + (d.cuotas.length ? ' de la' + (d.cuotas.length > 1 ? 's cuotas ' : ' cuota ') + d.cuotas.join(' y ') : '') + (d.nota ? '\n' + d.nota : '')}>
            VER{docs.length > 1 && <small> {d.cuotas.length ? 'C' + d.cuotas.join('+') : i + 1}</small>}
          </a>
          {esVoucher && <BotonImprimirVoucher url={d.url} nota={d.nota} items={itemsDe(d)} />}
        </Fragment>
      ))}
      {!readOnly && varias && onOtro && (
        <label className="link-btn small docs-otro" title={'Basta uno para todo el depósito. Sube otro solo si una cuota tiene su propio ' + que.toLowerCase() + '.'}>
          + otro
          <input type="file" accept="image/*,.pdf" hidden
            onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) onOtro(f) }} />
        </label>
      )}
    </span>
  )
}
