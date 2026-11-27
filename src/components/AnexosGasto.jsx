import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { upload } from '../lib/archivos'
import { confirmar } from '../lib/dialogos'
import VisorDoc from './VisorDoc'

// ANEXOS DE UN GASTO (sql/234, 21 nov 2026, pedido del dueño: "que todo gasto tenga un
// anexo no obligatorio"). Varios archivos (foto, PDF o Word), cada uno con una nota corta.
// Se suben al registrar o después, en cualquier estado del gasto, y NO entran en las
// firmas: agregar o quitar un anexo no pide volver a firmar.
//   expenses.anexos = [{ url, note, por, por_nombre, at }]
// Se escribe solo por funciones (agregar_anexo_gasto / quitar_anexo_gasto): así también
// suben la socia y la secretaria socia, que no escriben en la tabla.

export const anexosDe = g => (Array.isArray(g?.anexos) ? g.anexos : [])
export const esImagenAnexo = u => /\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(u || '')
const faltaSql = m => /agregar_anexo_gasto|quitar_anexo_gasto|schema cache|PGRST202|Could not find/i.test(m || '')
const fechaCorta = s => s ? new Date(s).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

// subir un archivo como anexo de un gasto que ya existe (también lo usa el formulario
// al registrar: primero se crea el gasto y después se le cuelgan sus anexos)
export async function subirAnexo(gid, file, nota) {
  const url = await upload(`gastos/anexos/${gid}`, file)
  const { error } = await supabase.rpc('agregar_anexo_gasto', { p_eid: gid, p_url: url, p_nota: (nota || '').trim() || null })
  if (error) throw new Error(faltaSql(error.message) ? 'Falta correr sql/234 en la base (anexos de los gastos).' : error.message)
}

// el botón de la tabla y de las tarjetas: cuántos tiene, o "+ anexo" si se puede agregar
export function AnexosChip({ g, puedeAgregar, onClick }) {
  const n = anexosDe(g).length
  if (!n && !puedeAgregar) return null
  return (
    <button type="button" className={'link-btn small' + (n ? '' : ' muted')} style={{ textTransform: 'none' }}
      title={n ? anexosDe(g).map((a, i) => (i + 1) + '. ' + (a.note || 'sin nota')).join('\n') : 'Agregar un anexo (opcional)'}
      onClick={onClick}>📎 {n ? n + (n === 1 ? ' anexo' : ' anexos') : '+ anexo'}</button>
  )
}

// La lista en la constancia impresa: "ANEXOS (2): 1. boletas · 2. fotos del trabajo", y las
// fotos cada una en su hoja después de la constancia. Los PDF y Word se ven en el panel.
export function AnexosImpresos({ g }) {
  const lista = anexosDe(g)
  if (!lista.length) return null
  return <>
    <p className="small u-mt-14 u-tt-n">
      <b>ANEXOS ({lista.length}):</b> {lista.map((a, i) => (i + 1) + '. ' + (a.note || (esImagenAnexo(a.url) ? 'foto' : 'documento'))).join(' · ')}
    </p>
    {lista.map((a, i) => esImagenAnexo(a.url) && (
      <div key={a.url} style={{ breakBefore: 'page', pageBreakBefore: 'always', textAlign: 'center', paddingTop: 10 }}>
        <p className="u-m-008"><b>ANEXO {i + 1}</b>{a.note ? ' — ' + a.note : ''}</p>
        <img src={a.url} alt={'Anexo ' + (i + 1)} style={{ maxWidth: '100%', maxHeight: '24cm', objectFit: 'contain' }} />
      </div>
    ))}
  </>
}

// La ventana: ver, agregar (varios a la vez, con una nota) y quitar.
//   puedeAgregar: oficina, facturación o la socia   puedeQuitarTodo: superusuario/admin/operador
//   (quien subió un anexo siempre puede quitar el suyo)
export default function AnexosGasto({ g, numero, puedeAgregar, puedeQuitarTodo, miId, onCerrar, onCambio }) {
  const [ver, setVer] = useState(null)
  const [nota, setNota] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const lista = anexosDe(g)
  if (!g) return null

  async function agregar(files) {
    if (!files.length) return
    setErr('')
    let hechos = 0
    try {
      for (const file of files) {
        setBusy('Subiendo ' + (hechos + 1) + ' de ' + files.length + '…')
        await subirAnexo(g.id, file, nota)
        hechos++
      }
      setNota('')
    } catch (e) { setErr((hechos ? hechos + ' subido(s); el resto no: ' : '') + e.message) }
    setBusy('')
    if (hechos) onCambio?.()
  }

  async function quitar(a) {
    if (!await confirmar('¿Quitar este anexo' + (a.note ? ' (' + a.note + ')' : '') + '?\n\nEl archivo queda guardado; solo se desliga del gasto y queda en la bitácora.', { peligro: true, aceptar: 'Sí, quitar' })) return
    setErr(''); setBusy('Quitando…')
    const { error } = await supabase.rpc('quitar_anexo_gasto', { p_eid: g.id, p_url: a.url })
    setBusy('')
    if (error) { setErr(faltaSql(error.message) ? 'Falta correr sql/234 en la base.' : error.message); return }
    if (ver?.url === a.url) setVer(null)
    onCambio?.()
  }

  return (
    <div className="modal-bg" onClick={busy ? undefined : onCerrar}>
      <div className="glass modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 760, width: '96%', maxHeight: '92vh', overflowY: 'auto', textTransform: 'none' }}>
        <div className="modal-head">
          <b className="u-f1">📎 Anexos {numero ? 'de la ' + numero : 'del gasto'}</b>
          <button className="btn-ghost" onClick={onCerrar} disabled={!!busy} aria-label="Cerrar">&#10005;</button>
        </div>
        <p className="muted small u-m-0010">
          {(g.description || g.type || '').slice(0, 90)}{g.recipient ? ' · ' + g.recipient : ''}
          <br />Opcionales: fotos, boletas, cotizaciones, lo que respalde el gasto. No cambian las firmas.
        </p>

        {!lista.length && <p className="muted">Este gasto todavía no tiene anexos.</p>}
        {lista.length > 0 && (
          <table className="ctable u-fs-13 u-mb-10">
            <tbody>
              {lista.map((a, i) => {
                const mio = miId && a.por === miId
                return (
                  <tr key={a.url} className={ver?.url === a.url ? 'sel' : ''}>
                    <td style={{ width: 28 }}><b>{i + 1}</b></td>
                    <td>
                      {a.note || <span className="muted">{esImagenAnexo(a.url) ? 'foto' : 'documento'} sin nota</span>}
                      <div className="muted small">{a.por_nombre || ''}{a.at ? ' · ' + fechaCorta(a.at) : ''}</div>
                    </td>
                    <td className="u-nw u-ta-r">
                      <button type="button" className="link-btn" onClick={() => setVer(ver?.url === a.url ? null : { url: a.url, titulo: 'Anexo ' + (i + 1) })}>{ver?.url === a.url ? 'OCULTAR' : 'VER'}</button>
                      {' '}<a href={a.url} target="_blank" rel="noreferrer" className="muted small" title="abrir en otra pestaña">↗</a>
                      {(puedeQuitarTodo || mio) && <>{' '}<button type="button" className="link-btn" title="Quitar este anexo (queda en la bitácora)" disabled={!!busy} onClick={() => quitar(a)}>&#128465;</button></>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {ver && <div className="u-mb-12"><VisorDoc key={ver.url} url={ver.url} titulo={ver.titulo} alto={460} /></div>}

        {puedeAgregar && (
          <div className="form-grid" style={{ alignItems: 'end' }}>
            <label className="span2">Nota del anexo <span className="muted small">(opcional: de qué es, ej. "boletas de gasolina")</span>
              <input value={nota} onChange={e => setNota(e.target.value)} disabled={!!busy} maxLength={140} />
            </label>
            <label className={'upload-btn' + (busy ? ' disabled' : '')} style={{ cursor: busy ? 'wait' : 'pointer' }}>
              {busy || '📎 Elegir archivo(s)'}
              <input type="file" accept="image/*,.pdf,.docx,.doc,.xlsx" multiple hidden disabled={!!busy}
                onChange={e => { const fs = [...e.target.files]; e.target.value = ''; agregar(fs) }} />
            </label>
          </div>
        )}
        {err && <p className="error u-m-1000">{err}</p>}
      </div>
    </div>
  )
}
