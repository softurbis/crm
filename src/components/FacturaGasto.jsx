import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { soles } from '../lib/pagos'
import { fechaPe } from '../lib/lotes'
import {
  ESTADOS, COLS_FACTURA_GASTO, nombreComprobante, enCamino, esPrueba, emisorDelServidor, emisorVisto,
  descripcionGasto, numeroDeGasto, pedirFacturaGasto,
} from '../lib/comprobantes'

// LA FACTURA DEL GASTO (sql/233, 18 nov 2026). Pedido del dueño: con el gasto creado
// (desde sql/235 no espera firmas ni pago), la secretaria de la oficina elige quién lo factura —Victor o Alex, con su
// RUC 10— y la factura sale sola a SUNAT a nombre del DUEÑO DEL PROYECTO, exonerada.
// Una factura puede cubrir un gasto o varios del mismo proyecto. Si el comprobante es
// un RH o la factura de otra persona, se sigue SUBIENDO como siempre.

const hoyLima = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
const sumarDias = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const nombreDia = (f, hoy) => f === hoy ? 'Hoy' : f === sumarDias(hoy, -1) ? 'Ayer' : f === sumarDias(hoy, -2) ? 'Anteayer' : fechaPe(f)
const centavos = v => Math.round(Number(v || 0) * 100)

// Un gasto al que se le puede sacar factura: no rechazado, sin RH/factura y sin factura
// viva. Desde sql/235 (23 nov) no espera las firmas ni el pago: se emite apenas se crea.
// El RH/factura subido a mano (por ejemplo la factura sacada por el PORTAL de SUNAT)
// cierra la puerta: así no salen dos facturas del mismo gasto.
export const gastoFacturable = (g, facturas) => !g.rejected_at && !g.receipt_url
  && !(g.comprobante_id && facturas?.[g.comprobante_id] && !['rechazado', 'anulado'].includes(facturas[g.comprobante_id].estado))

// el emisor que corresponde de entrada: si el gasto se le pagó a Victor o a Alex, ese
const emisorSugerido = (g, emisores) => {
  const quien = String(g?.recipient || '').toUpperCase()
  return emisores.find(e => quien && (quien.includes(e.nombre) || e.razon_social.includes(quien)))?.ruc || ''
}

export function EmitirFacturaGasto({ gasto, candidatos, proyecto, emisores, onCerrar, onListo }) {
  const activos = useMemo(() => (emisores || []).filter(e => e.activo), [emisores])
  const [ruc, setRuc] = useState(() => emisorSugerido(gasto, activos) || (activos.length === 1 ? activos[0].ruc : ''))
  const [servidor, setServidor] = useState(undefined)
  // los otros gastos del proyecto que pueden ir en la MISMA factura
  const otros = useMemo(() => (candidatos || []).filter(x => x.id !== gasto.id), [candidatos, gasto.id])
  const [juntos, setJuntos] = useState(() => new Set())
  const elegidos = useMemo(() => [gasto, ...otros.filter(x => juntos.has(x.id))], [gasto, otros, juntos])
  const total = elegidos.reduce((s, x) => s + centavos(x.amount), 0) / 100
  const [textos, setTextos] = useState({})             // id -> texto editado
  const textoDe = x => textos[x.id] ?? descripcionGasto(x, proyecto)
  const [modo, setModo] = useState('auto')             // auto = una línea por gasto · una = una sola línea
  const [una, setUna] = useState('')
  const hoy = hoyLima()
  const fechas = [hoy, sumarDias(hoy, -1), sumarDias(hoy, -2)]
  const [fecha, setFecha] = useState(hoy)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [pedida, setPedida] = useState(null)           // la factura, una vez pedida

  useEffect(() => { setServidor(undefined); if (ruc) emisorDelServidor(ruc).then(setServidor) }, [ruc])
  // con un solo gasto no hay "una sola línea"
  useEffect(() => { if (elegidos.length < 2 && modo === 'una') setModo('auto') }, [elegidos.length, modo])
  const textoUna = una || ('SERVICIO DE GESTIÓN DEL PROYECTO ' + (proyecto?.name || '') + ' - ' + elegidos.map(numeroDeGasto).join(', ')).toUpperCase().slice(0, 240)

  // mientras SUNAT no contesta, se sigue mirando
  useEffect(() => {
    if (!pedida || !enCamino(pedida)) return
    const t = setInterval(async () => {
      const { data } = await supabase.from('comprobantes').select(COLS_FACTURA_GASTO).eq('id', pedida.id).maybeSingle()
      if (data) setPedida(data)
    }, 3000)
    return () => clearInterval(t)
  }, [pedida])

  const marcar = (id, si) => setJuntos(s => { const n = new Set(s); if (si) n.add(id); else n.delete(id); return n })
  const mismoVoucher = gasto.voucher_grupo ? otros.filter(x => x.voucher_grupo === gasto.voucher_grupo) : []
  const em = activos.find(e => e.ruc === ruc)
  const sinDueno = !proyecto?.fact_ruc || !proyecto?.fact_razon_social

  async function emitir() {
    setErr('')
    if (!ruc) { setErr('Elige quién emite la factura.'); return }
    const lineas = modo === 'una'
      ? [{ descripcion: textoUna.trim(), monto: total.toFixed(2) }]
      : elegidos.map(x => ({ descripcion: String(textoDe(x)).trim(), monto: (centavos(x.amount) / 100).toFixed(2) }))
    if (lineas.some(l => !l.descripcion)) { setErr('Cada línea de la factura necesita su texto.'); return }
    setBusy(true)
    try {
      const id = await pedirFacturaGasto({ gastos: elegidos.map(x => x.id), emisor: ruc, lineas, fecha: fecha === hoy ? null : fecha })
      const { data } = await supabase.from('comprobantes').select(COLS_FACTURA_GASTO).eq('id', id).maybeSingle()
      setPedida(data || { id, estado: 'pendiente', serie: em?.serie, total })
      onListo?.()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const est = pedida ? (ESTADOS[pedida.estado] || ESTADOS.pendiente) : null
  return (
    <div className="modal-bg" onClick={busy ? undefined : onCerrar}>
      <div className="glass modal cp-modal" onClick={ev => ev.stopPropagation()}>
        <div className="modal-head">
          <b className="u-f1">🧾 Factura del gasto</b>
          <button className="btn-ghost" onClick={onCerrar} disabled={busy} aria-label="Cerrar">&#10005;</button>
        </div>

        {pedida ? (
          <div>
            <p className={'cp-grande ' + est.c}>{enCamino(pedida) && <span className="cp-gira" />}Factura {nombreComprobante(pedida)} · {est.t}{esPrueba(pedida) ? ' · PRUEBA sin valor' : ''}</p>
            <p className="muted u-tt-n">
              {pedida.estado === 'aceptado'
                ? (esPrueba(pedida) ? 'Aceptada en el ambiente de PRUEBAS de SUNAT: no tiene valor y no queda en el gasto.' : 'Aceptada por SUNAT. El PDF queda solo en el gasto como su factura.')
                : pedida.mensaje || est.ayuda}
            </p>
            <div className="acc-row u-mt-12">
              {pedida.pdf_url && <a className="btn-primary btn-link" href={pedida.pdf_url} target="_blank" rel="noreferrer">📄 Ver / imprimir</a>}
              <button type="button" className="btn-ghost" onClick={onCerrar}>Cerrar</button>
            </div>
          </div>
        ) : !activos.length ? (
          <p className="cp-nota">Todavía no hay nadie habilitado para facturar gastos. El superusuario registra a Victor y a Alex en <b>Gastos → Facturas de gastos</b>.</p>
        ) : sinDueno ? (
          <p className="cp-nota">El proyecto <b>{proyecto?.name}</b> no tiene el RUC y la razón social de su dueño, que es a nombre de quien sale la factura. Se ponen en Proyectos, en el facturador del proyecto.</p>
        ) : (
          <>
            <p className="cp-sub">¿Quién emite la factura?</p>
            <div className="cp-tipo" role="radiogroup" aria-label="Quién emite la factura">
              {activos.map(e => (
                <button type="button" key={e.ruc} role="radio" aria-checked={ruc === e.ruc} className={ruc === e.ruc ? 'on' : ''} onClick={() => setRuc(e.ruc)}>
                  {e.nombre}<small>RUC {e.ruc}</small>
                </button>
              ))}
            </div>
            {ruc && servidor !== undefined && (
              !servidor || !emisorVisto(servidor)
                ? <p className="cp-nota">El RUC de {em?.nombre} todavía no está cargado en el facturador del servidor (o el servidor no contesta). Se puede pedir igual: queda en cola y sale sola cuando esté listo.</p>
                : servidor.ambiente !== 'produccion'
                  ? <p className="cp-nota">{em?.nombre} está en el ambiente de <b>pruebas</b> de SUNAT: lo que se emita no tiene valor.</p>
                  : null
            )}

            <p className="cp-nota">
              ¿Ya la sacaste por el <b>portal de SUNAT</b>? Entonces no la emitas aquí: cierra esto y sube ese PDF en <b>RH / factura</b> del gasto.
              Con el PDF subido el sistema ya no deja emitir otra, y así no sale dos veces.
            </p>

            <div className="cp-datos">
              <span>A nombre de</span><b>{proyecto.fact_razon_social}</b>
              <span>RUC</span><b>{proyecto.fact_ruc}</b>
              <span>IGV</span><b>exonerada (Amazonía)</b>
            </div>

            {otros.length > 0 && (
              <details className="fg-juntar" open={juntos.size > 0}>
                <summary>Juntar otros gastos del proyecto en esta misma factura ({otros.length} sin factura)</summary>
                {mismoVoucher.length > 0 && (
                  <button type="button" className="link-btn small" onClick={() => setJuntos(s => new Set([...s, ...mismoVoucher.map(x => x.id)]))}>
                    {mismoVoucher.length === 1 ? '+ el otro gasto del mismo voucher' : '+ los otros ' + mismoVoucher.length + ' gastos del mismo voucher'}
                  </button>
                )}
                {otros.map(x => (
                  <label key={x.id} className="fg-otro">
                    <input type="checkbox" checked={juntos.has(x.id)} onChange={e => marcar(x.id, e.target.checked)} />
                    <span>{numeroDeGasto(x)} · {fechaPe(x.issue_date)} · {x.description || x.type}{x.recipient ? ' · ' + x.recipient : ''}</span>
                    <b>{soles(x.amount)}</b>
                  </label>
                ))}
              </details>
            )}

            <div className="form-grid">
              <label>Fecha de emisión
                <select value={fecha} onChange={e => setFecha(e.target.value)}>
                  {fechas.map(f => <option key={f} value={f}>{nombreDia(f, hoy)} · {fechaPe(f)}</option>)}
                </select>
              </label>
              <p className="muted small span2" style={{ margin: 0, textTransform: 'none', alignSelf: 'end' }}>
                Hoy, ayer o anteayer: SUNAT recibe la factura hasta 3 días después de su fecha.
              </p>
            </div>

            <p className="cp-sub">Detalle <span className="muted small">(así sale en la factura; se puede corregir)</span></p>
            {elegidos.length > 1 && (
              <div className="cp-tipo cp-modo" role="radiogroup" aria-label="Cómo salen las líneas de la factura">
                <button type="button" role="radio" aria-checked={modo === 'auto'} className={modo === 'auto' ? 'on' : ''} onClick={() => setModo('auto')}>
                  Una por gasto<small>{elegidos.length} líneas</small></button>
                <button type="button" role="radio" aria-checked={modo === 'una'} className={modo === 'una' ? 'on' : ''} onClick={() => setModo('una')}>
                  Una sola línea<small>por {soles(total)}, texto libre</small></button>
              </div>
            )}
            {modo === 'auto' ? elegidos.map(x => (
              <div className="cp-linea" key={x.id}>
                <input value={textoDe(x)} maxLength={240} aria-label={'Texto de la línea del gasto ' + numeroDeGasto(x)}
                  onChange={e => setTextos(t => ({ ...t, [x.id]: e.target.value }))} />
                <b>{soles(x.amount)}</b>
              </div>
            )) : (
              <div className="cp-linea">
                <input value={textoUna} maxLength={240} aria-label="Texto de la única línea" onChange={e => setUna(e.target.value)} />
                <b>{soles(total)}</b>
              </div>
            )}
            <div className="cp-linea cp-total"><span>Total, sin IGV</span><b>{soles(total)}</b></div>

            {err && <p className="error u-tt-n">{err}</p>}
            <div className="acc-row u-mt-12">
              <button className="btn-primary" onClick={emitir} disabled={busy || !ruc}>
                {busy ? 'Pidiendo…' : !ruc ? 'Elige quién emite' : 'Emitir factura de ' + em?.nombre + ' por ' + soles(total)}
              </button>
              <button type="button" className="btn-ghost" onClick={onCerrar} disabled={busy}>Cancelar</button>
            </div>
            <p className="muted small u-mt-8 u-tt-n">
              Una vez emitida no se corrige: si algo quedó mal, se anula y se emite otra. Si el comprobante es un RH o la factura de otra persona, ciérrala y usa “subir”.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
