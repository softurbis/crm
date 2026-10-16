import { supabase } from '../lib/supabase'
import { subirRuta } from '../lib/archivos'
import { useAuth } from '../context/AuthContext'
import { subirContratoFirmado } from '../lib/contrato'
import { confirmar, pedir } from '../lib/dialogos'

// El contrato firmado de UNA venta y sus documentos de respaldo: ver, subir,
// reemplazar, nota y quitar. Antes vivía completo solo en la pantalla Contratos; la
// ficha del lote tenía una versión recortada (sin nota, sin respaldo, sin quitar) y
// había que salir de la ficha para lo demás. Ahora las dos usan esta pieza
// (revisión del 1 oct 2026).
//   venta       { id, signed_contract_url, contract_note, extra_docs, client, lot: { mz, lt } }
//   alCambiar   se llama con el aviso tras cada cambio (para mostrarlo y recargar)
//   alFallar    se llama con el error
//   puedeEditar false = solo mirar (gerencia, socio)
//   alGenerar   abre el contrato para armarlo (Word/PDF); con uno ya firmado arma el NUEVO
// Cada acción es un botón aparte (16 oct: "los botones están tan juntos que no se pueden usar").
export default function ContratoDeVenta({ venta: v, alCambiar, alFallar, puedeEditar = true, alGenerar }) {
  const { puedeCorregir } = useAuth()   // superusuario u operador: reemplazar y quitar
  const docs = Array.isArray(v.extra_docs) ? v.extra_docs : []
  // los firmados que fueron reemplazados o quitados (sql/150), el último primero
  const anteriores = (Array.isArray(v.contratos_anteriores) ? v.contratos_anteriores : []).slice().reverse()
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
  async function quitar() {
    if (!await confirmar('¿Quitar el contrato firmado de ' + (v.client?.full_name || 'esta venta') + '?\n\nLa venta volverá a figurar como SIN CONTRATO FIRMADO y podrás subir otro o generar uno nuevo. El archivo quitado queda en "contratos anteriores".', { peligro: true, aceptar: 'Sí, quitar' })) return
    guardar({ signed_contract_url: null, contract_note: null }, 'CONTRATO QUITADO — YA PUEDES SUBIR OTRO')
  }
  async function nota() {
    const t = await pedir('Comentario / nota de este contrato:', { tipo: 'largo', valor: v.contract_note || '' })
    if (t === null) return
    guardar({ contract_note: t.trim() || null }, 'NOTA DEL CONTRATO GUARDADA')
  }

  // ---- documentos de respaldo (máx. 2 por contrato): traspaso, iniciales, adenda… ----
  async function subirRespaldo(file) {
    if (docs.length >= 2) { fallo('MÁXIMO 2 documentos de respaldo por contrato.'); return }
    const etiqueta = await pedir('¿Qué documento es? (etiqueta corta)\n\nEj: TRASPASO · DOCUMENTO DE INICIALES · ADENDA · CARTA DE COMPROMISO')
    if (etiqueta === null) return
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
    let url
    try { url = await subirRuta(`contratos/respaldo/${v.lot?.mz}-${v.lot?.lt}-${Date.now()}.${ext}`, file) }
    catch (e) { fallo(e); return }
    guardar({ extra_docs: [...docs, { url, note: etiqueta.trim() || 'Documento de respaldo' }] }, 'DOCUMENTO DE RESPALDO SUBIDO')
  }
  async function quitarRespaldo(i) {
    if (!await confirmar('¿Quitar "' + (docs[i]?.note || 'este documento') + '"?\n\n(El archivo queda en el almacenamiento.)', { peligro: true, aceptar: 'Sí, quitar' })) return
    guardar({ extra_docs: docs.filter((_, k) => k !== i) }, 'DOCUMENTO QUITADO')
  }
  async function etiquetarRespaldo(i) {
    const etiqueta = await pedir('¿Qué documento es? (etiqueta corta)', { valor: docs[i]?.note || '' })
    if (etiqueta === null) return
    guardar({ extra_docs: docs.map((d, k) => (k === i ? { ...d, note: etiqueta.trim() || 'Documento de respaldo' } : d)) }, 'ETIQUETA GUARDADA')
  }

  // Lo que dice cada botón al pasar el mouse (pedido del 16 oct: "un texto muy detallado")
  const AYUDA = {
    ver: 'VER FIRMADO\nAbre en otra pestaña el contrato firmado que está vigente hoy (el escaneo o la foto que se subió). Solo lo muestra: no cambia nada.',
    nota: 'NOTA\nEscribe o corrige un comentario sobre este contrato. Ej.: "firmado con poder", "falta legalizar", "copia escaneada que mandó el cliente". La nota se ve debajo de los botones.',
    quitar: 'QUITAR EL CONTRATO FIRMADO\nLa venta vuelve a figurar SIN CONTRATO FIRMADO. El archivo NO se borra: queda guardado en "contratos anteriores" con la fecha y quién lo quitó.\nÚsalo solo si se subió un archivo equivocado. Para cambiarlo por un contrato nuevo, usa el recuadro "Contrato nuevo".',
    generarNuevo: 'PASO 1 · GENERAR EL CONTRATO NUEVO\nArma el contrato con los datos de HOY: el lote y sus medidas del plano nuevo, el precio, la inicial, el cronograma y el cliente.\nEn Neshuya primero eliges el formato: el de siempre (firma la titular) o CON PODER (firma el apoderado).\nLo descargas en Word o PDF para imprimir y que el cliente firme. Generar NO cambia nada en el sistema: el firmado de ahora sigue vigente hasta el paso 2.',
    subirNuevo: 'PASO 2 · SUBIR EL CONTRATO NUEVO YA FIRMADO\nElige el escaneo o la foto (PDF o imagen) del contrato nuevo con las firmas.\nAl subirlo, ese pasa a ser el contrato VIGENTE y el firmado de antes NO se pierde: queda en "contratos anteriores", con la fecha y quién lo cambió.\nTe pedirá una nota opcional.',
    generar: 'GENERAR CONTRATO\nArma el contrato de esta venta con sus datos: cliente, lote, medidas, precio, inicial y cronograma.\nEn Neshuya primero eliges el formato: el de siempre (firma la titular) o CON PODER (firma el apoderado).\nLo descargas en Word o PDF para imprimir y firmar. Después sube el firmado con "Subir firmado".',
    subir: 'SUBIR FIRMADO\nEsta venta todavía NO tiene contrato firmado en el sistema.\nElige el escaneo o la foto (PDF o imagen) del contrato con las firmas del cliente y del vendedor. Te pedirá una nota opcional.',
    anteriores: 'CONTRATOS ANTERIORES\nLos contratos firmados que se cambiaron por uno nuevo o que se quitaron. Solo se consultan: no se pueden borrar ni cambiar.\nCada uno dice cuándo y quién lo cambió.',
    respaldo: 'DOCUMENTO DE RESPALDO\nSube un papel que acompaña al contrato pero NO lo reemplaza: traspaso, documento de iniciales, adenda, carta de compromiso, etc.\nMáximo 2 por contrato. Te pedirá una etiqueta corta para reconocerlo.',
    etiqueta: 'CAMBIAR LA ETIQUETA\nCorrige el nombre con que se ve este documento de respaldo (ej.: TRASPASO, ADENDA). El archivo no cambia.',
    quitarRespaldo: 'QUITAR ESTE DOCUMENTO DE RESPALDO\nDeja de verse en el contrato. El archivo queda guardado en el almacenamiento.',
  }

  const elegir = alElegir => e => { const f = e.target.files[0]; e.target.value = ''; if (f) alElegir(f) }

  return (
    <div className="cv">
      {v.signed_contract_url
        ? <>
            <div className="cv-fila">
              <a href={v.signed_contract_url} target="_blank" rel="noreferrer" className="cv-btn ok" title={AYUDA.ver}>&#128065; Ver firmado</a>
              {puedeEditar && <button type="button" className="cv-btn" onClick={nota} title={AYUDA.nota}>&#128221; Nota</button>}
              {puedeEditar && puedeCorregir && <button type="button" className="cv-btn peligro" onClick={quitar} title={AYUDA.quitar}>&#128465;</button>}
            </div>
            {v.contract_note && <div className="muted small" style={{ textTransform: 'none' }}>{v.contract_note}</div>}
            {/* contrato NUEVO que reemplaza al firmado: lo hace quien corrige, en dos pasos */}
            {puedeEditar && puedeCorregir && (
              <div className="cv-nuevo">
                <span className="cv-titulo">Contrato nuevo</span>
                <div className="cv-fila">
                  {alGenerar && <button type="button" className="cv-btn" onClick={alGenerar} title={AYUDA.generarNuevo}>1 · &#128196; Generar</button>}
                  <label className="cv-btn" title={AYUDA.subirNuevo}>{alGenerar ? '2 · ' : ''}&#11014; Subir firmado
                    <input type="file" accept="image/*,.pdf" hidden onChange={elegir(subirFirmado)} />
                  </label>
                </div>
              </div>
            )}
          </>
        : puedeEditar
          ? <div className="cv-fila">
              {alGenerar && <button type="button" className="cv-btn" onClick={alGenerar} title={AYUDA.generar}>&#128196; Generar contrato</button>}
              <label className="cv-btn malo" title={AYUDA.subir}>&#9888; Subir firmado
                <input type="file" accept="image/*,.pdf" hidden onChange={elegir(subirFirmado)} />
              </label>
            </div>
          : <span className="warn">sin contrato firmado</span>}
      {/* los contratos firmados de antes (reemplazados por uno nuevo o quitados): solo se consultan */}
      {anteriores.length > 0 && (
        <details className="small" style={{ marginTop: 4, textTransform: 'none' }}>
          <summary style={{ cursor: 'pointer' }} title={AYUDA.anteriores}>&#128220; contratos anteriores ({anteriores.length})</summary>
          {anteriores.map((a, i) => (
            <div key={i} style={{ margin: '2px 0 2px 14px' }}>
              <a href={a.url} target="_blank" rel="noreferrer" className="muted" title="Abre en otra pestaña este contrato anterior. Ya no es el vigente: queda solo como historial.">ver</a>
              {' '}<span className="muted">{a.como === 'quitado' ? 'quitado' : 'reemplazado'} el {String(a.hasta || '').slice(0, 10).split('-').reverse().join('/')}{a.por ? ' por ' + a.por : ''}</span>
              {a.nota && <div className="muted" style={{ marginLeft: 26 }}>{a.nota}</div>}
            </div>
          ))}
        </details>
      )}
      {/* documentos de respaldo del contrato (traspaso, iniciales, adenda…): máx. 2 */}
      {(docs.length > 0 || puedeEditar) && (
        <div className="cv-respaldo">
          {docs.map((d, i) => (
            <div key={i} className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', textTransform: 'none', marginBottom: 2 }}>
              <span>📎</span>
              <a href={d.url} target="_blank" rel="noreferrer" className="ok" title="Abre en otra pestaña este documento de respaldo del contrato.">{d.note || 'Respaldo'}</a>
              {puedeEditar && <button type="button" className="link-btn" title={AYUDA.etiqueta} onClick={() => etiquetarRespaldo(i)}>&#9998;</button>}
              {puedeEditar && puedeCorregir && <button type="button" className="link-btn" title={AYUDA.quitarRespaldo} onClick={() => quitarRespaldo(i)}>&#128465;</button>}
            </div>
          ))}
          {puedeEditar && docs.length < 2 && (
            <label className="cv-btn" title={AYUDA.respaldo}>
              &#10133; Documento de respaldo
              <input type="file" accept="image/*,.pdf" hidden onChange={elegir(subirRespaldo)} />
            </label>
          )}
        </div>
      )}
    </div>
  )
}
