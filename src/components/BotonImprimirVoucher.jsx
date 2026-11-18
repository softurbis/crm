import { useState } from 'react'
import { avisar } from '../lib/dialogos'

// 🖨 al lado del VER de un voucher: abre su hoja A4 con la referencia arriba
// (proyecto, Mz y lote, cliente, concepto, monto, operación) lista para imprimir.
// Lo usan Pagos, la ficha del lote y el detalle del pago. `items` son las filas del
// pago que cubre ESTE voucher (lib/imprimirVoucher.js arma la hoja).
export default function BotonImprimirVoucher({ url, nota, items, conTexto }) {
  const [busy, setBusy] = useState(false)
  async function imprimir() {
    if (busy) return
    // la pestaña se abre con el clic, antes de cualquier espera (si no, se bloquea)
    const w = window.open('', '_blank')
    if (w) w.document.write('<title>Voucher</title><p style="font:16px system-ui;margin:2rem">Armando la hoja del voucher…</p>')
    setBusy(true)
    try {
      const { imprimirVoucher } = await import('../lib/imprimirVoucher')
      await imprimirVoucher({ url, nota, items, ventana: w })
    } catch (e) {
      if (w && !w.closed) w.close()
      avisar('No se pudo armar la hoja del voucher: ' + (e?.message || e) + '\n\nPuedes abrirlo con VER e imprimirlo desde ahí.', { tono: 'error' })
    } finally { setBusy(false) }
  }
  return (
    <button type="button" className="link-btn voucher-imp" disabled={busy} onClick={imprimir}
      title="Imprimir el voucher en hoja A4, con su referencia arriba (lote, cliente, concepto, monto y N° de operación)">
      {busy ? '⏳' : '🖨'}{conTexto && (busy ? ' armando…' : ' imprimir A4')}
    </button>
  )
}
