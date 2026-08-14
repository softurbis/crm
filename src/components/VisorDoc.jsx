// ============================================================================
// VISOR DE DOCUMENTOS
// ----------------------------------------------------------------------------
// El panel mostraba las imágenes con <img> y los PDF con <iframe>, pero un Word
// no se ve con ninguno de los dos: quedaba como un enlace ciego. Y en las
// migraciones llegan muchos .docx (constancias, contratos, vouchers pegados).
//
// Aquí el Word se convierte a la vista EN EL NAVEGADOR, con el archivo que ya
// está descargado. No se manda a ningún servicio de terceros: los contratos y
// los DNI de los clientes no salen de la sesión del usuario.
//
// El conversor (mammoth) se carga solo cuando hace falta abrir un Word, así no
// pesa en el arranque del panel.
// ============================================================================
import { useEffect, useState } from 'react'

const esImagen = u => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u || '')
const esPdf = u => /\.pdf(\?|$)/i.test(u || '')
const esWord = u => /\.(docx?|dotx)(\?|$)/i.test(u || '')

export default function VisorDoc({ url, titulo = 'documento', alto = 420 }) {
  const [word, setWord] = useState(null)   // { html } | { error }
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    setWord(null)
    if (!url || !esWord(url)) return
    let vivo = true
    setCargando(true)
    ;(async () => {
      try {
        const [{ default: mammoth }, respuesta] = await Promise.all([
          import('mammoth/mammoth.browser.js'),
          fetch(url),
        ])
        if (!respuesta.ok) throw new Error('no se pudo descargar (' + respuesta.status + ')')
        const buffer = await respuesta.arrayBuffer()
        const r = await mammoth.convertToHtml({ arrayBuffer: buffer })
        if (vivo) setWord({ html: r.value || '<p>(el documento está vacío)</p>' })
      } catch (e) {
        if (vivo) setWord({ error: e.message || String(e) })
      } finally { if (vivo) setCargando(false) }
    })()
    return () => { vivo = false }
  }, [url])

  if (!url) return <p className="bad big-alert">&#9888; NO SUBIDO</p>

  if (esImagen(url)) return <img src={url} alt={titulo} />
  if (esPdf(url)) return <iframe src={url} title={titulo} />

  if (esWord(url)) {
    return (
      <div>
        {cargando && <p className="muted">Abriendo el Word…</p>}
        {word?.error && (
          <p className="warn small" style={{ textTransform: 'none' }}>
            No pude mostrarlo aquí ({word.error}). <a href={url} target="_blank" rel="noreferrer">Descargar el archivo</a>
          </p>
        )}
        {word?.html && (
          <>
            <p className="muted small" style={{ margin: '0 0 4px', textTransform: 'none' }}>
              Word convertido para verlo aquí. Para guardarlo en PDF: <b>Ctrl + P</b> → destino <b>Guardar como PDF</b>.
            </p>
            <div className="doc-word" style={{ maxHeight: alto }} dangerouslySetInnerHTML={{ __html: word.html }} />
          </>
        )}
      </div>
    )
  }

  return (
    <p className="muted" style={{ textTransform: 'none' }}>
      Este tipo de archivo no se puede ver aquí. <a href={url} target="_blank" rel="noreferrer">Abrir o descargar</a>
    </p>
  )
}
