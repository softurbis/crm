import { supabase } from '../lib/supabase'
import { subirRuta } from '../lib/archivos'
import { useAuth } from '../context/AuthContext'
import { subirContratoFirmado } from '../lib/contrato'

// El contrato firmado de UNA venta y sus documentos de respaldo: ver, subir,
// reemplazar, nota y quitar. Antes vivía completo solo en la pantalla Contratos; la
// ficha del lote tenía una versión recortada (sin nota, sin respaldo, sin quitar) y
// había que salir de la ficha para lo demás. Ahora las dos usan esta pieza
// (revisión del 1 oct 2026).
//   venta       { id, signed_contract_url, contract_note, extra_docs, client, lot: { mz, lt } }
//   alCambiar   se llama con el aviso tras cada cambio (para mostrarlo y recargar)
//   alFallar    se llama con el error
//   puedeEditar false = solo mirar (gerencia, socio)
export default function ContratoDeVenta({ venta: v, alCambiar, alFallar, puedeEditar = true }) {
  const { role } = useAuth()
  const docs = Array.isArray(v.extra_docs) ? v.extra_docs : []
  const hecho = t => alCambiar?.(t)
  const fallo = e => alFallar?.('ERROR: ' + (e?.message || e))
  const guardar = async (cambios, aviso) => {
    const { error } = await supabase.from('sales').update(cambios).eq('id', v.id)
    if (error) fallo(error); else hecho(aviso)
  }

  async function subirFirmado(file) {
    try {
      const t = await subirContratoFirmado(v, file)   // lib/contrato: pide la nota y reemplaza si ya había
      if (t) hecho(t)
    } catch (e) { fallo(e) }
  }
  // quitar el contrato firmado (superusuario): la venta vuelve a figurar SIN CONTRATO
  function quitar() {
    if (!confirm('¿Quitar el contrato firmado de ' + (v.client?.full_name || 'esta venta') + '?\n\nLa venta volverá a figurar como SIN CONTRATO FIRMADO y podrás subir otro o generar uno nuevo. El archivo anterior queda en el almacenamiento.')) return
    guardar({ signed_contract_url: null, contract_note: null }, 'CONTRATO QUITADO — YA PUEDES SUBIR OTRO')
  }
  function nota() {
    const t = prompt('Comentario / nota de este contrato:', v.contract_note || '')
    if (t === null) return
    guardar({ contract_note: t.trim() || null }, 'NOTA DEL CONTRATO GUARDADA')
  }

  // ---- documentos de respaldo (máx. 2 por contrato): traspaso, iniciales, adenda… ----
  async function subirRespaldo(file) {
    if (docs.length >= 2) { fallo('MÁXIMO 2 documentos de respaldo por contrato.'); return }
    const etiqueta = prompt('¿Qué documento es? (etiqueta corta)\n\nEj: TRASPASO · DOCUMENTO DE INICIALES · ADENDA · CARTA DE COMPROMISO', '')
    if (etiqueta === null) return
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
    let url
    try { url = await subirRuta(`contratos/respaldo/${v.lot?.mz}-${v.lot?.lt}-${Date.now()}.${ext}`, file) }
    catch (e) { fallo(e); return }
    guardar({ extra_docs: [...docs, { url, note: etiqueta.trim() || 'Documento de respaldo' }] }, 'DOCUMENTO DE RESPALDO SUBIDO')
  }
  function quitarRespaldo(i) {
    if (!confirm('¿Quitar "' + (docs[i]?.note || 'este documento') + '"?\n\n(El archivo queda en el almacenamiento.)')) return
    guardar({ extra_docs: docs.filter((_, k) => k !== i) }, 'DOCUMENTO QUITADO')
  }
  function etiquetarRespaldo(i) {
    const etiqueta = prompt('¿Qué documento es? (etiqueta corta)', docs[i]?.note || '')
    if (etiqueta === null) return
    guardar({ extra_docs: docs.map((d, k) => (k === i ? { ...d, note: etiqueta.trim() || 'Documento de respaldo' } : d)) }, 'ETIQUETA GUARDADA')
  }

  const elegir = alElegir => e => { const f = e.target.files[0]; e.target.value = ''; if (f) alElegir(f) }

  return (
    <div>
      {v.signed_contract_url
        ? <>
            <a href={v.signed_contract_url} target="_blank" rel="noreferrer" className="ok">VER FIRMADO</a>
            {puedeEditar && <>{' '}<button type="button" className="link-btn" onClick={nota}>&#128221; nota</button></>}
            {/* reemplazar o quitar uno ya subido queda para el superusuario */}
            {puedeEditar && role === 'superuser' && (<>
              {' '}
              <label className="link-btn" style={{ cursor: 'pointer' }}>&#128260; reemplazar
                <input type="file" accept="image/*,.pdf" hidden onChange={elegir(subirFirmado)} />
              </label>{' '}
              <button type="button" className="link-btn" onClick={quitar}>&#128465; quitar</button>
            </>)}
            {v.contract_note && <div className="muted small" style={{ textTransform: 'none' }}>{v.contract_note}</div>}
          </>
        : puedeEditar
          ? <label className="upload-btn bad">&#9888; subir firmado
              <input type="file" accept="image/*,.pdf" hidden onChange={elegir(subirFirmado)} />
            </label>
          : <span className="warn">sin contrato firmado</span>}
      {/* documentos de respaldo del contrato (traspaso, iniciales, adenda…): máx. 2 */}
      {(docs.length > 0 || puedeEditar) && (
        <div style={{ marginTop: 6, borderTop: '1px dashed rgba(255,255,255,.12)', paddingTop: 5 }}>
          {docs.map((d, i) => (
            <div key={i} className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', textTransform: 'none', marginBottom: 2 }}>
              <span>📎</span>
              <a href={d.url} target="_blank" rel="noreferrer" className="ok">{d.note || 'Respaldo'}</a>
              {puedeEditar && <button type="button" className="link-btn" title="Editar etiqueta" onClick={() => etiquetarRespaldo(i)}>&#9998;</button>}
              {puedeEditar && role === 'superuser' && <button type="button" className="link-btn" title="Quitar" onClick={() => quitarRespaldo(i)}>&#128465;</button>}
            </div>
          ))}
          {puedeEditar && docs.length < 2 && (
            <label className="link-btn" style={{ cursor: 'pointer' }} title="Traspaso, documento de iniciales, adenda, etc.">
              &#10133; documento de respaldo
              <input type="file" accept="image/*,.pdf" hidden onChange={elegir(subirRespaldo)} />
            </label>
          )}
        </div>
      )}
    </div>
  )
}
