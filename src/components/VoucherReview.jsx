import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Revision del voucher: a la izquierda la imagen con un cuadro sobre CADA dato
// que se leyo, a la derecha la lista. Pasando el mouse por un dato se resalta su
// cuadro, y al reves. Asi la secretaria ve "este monto salio de ACA" sin tener
// que conocer el formato de cada banco.
const CAMPOS = [
  { k: 'monto', label: 'Monto', color: '#6fdd9b', fmt: v => 'S/ ' + Number(v).toFixed(2) },
  { k: 'operacion', label: 'N° operación', color: '#7bb6e0', fmt: v => v },
  { k: 'fecha', label: 'Fecha', color: '#e8b04f', fmt: v => v.split('-').reverse().join('/') },
]

export default function VoucherReview({ file, ocr, cuentaSugerida, onAplicar, onAplicarTodo }) {
  const [url, setUrl] = useState(null)
  const [foco, setFoco] = useState(null)      // dato resaltado
  const [render, setRender] = useState({ w: 0, h: 0 })
  const imgRef = useRef(null)

  useEffect(() => {
    if (!file) { setUrl(null); return }
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  // los cuadros van en coordenadas de la imagen ORIGINAL: hay que escalarlos
  // al tamaño en que se ve, y recalcular si la ventana cambia.
  useLayoutEffect(() => {
    const medir = () => {
      const el = imgRef.current
      if (el) setRender({ w: el.clientWidth, h: el.clientHeight })
    }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [url])

  if (!url || !ocr || ocr.vacio || ocr.error) return null
  const esc = ocr.imagen?.w ? render.w / ocr.imagen.w : 0
  const hallados = CAMPOS.filter(c => ocr[c.k] != null && ocr[c.k] !== '')
  const faltan = CAMPOS.filter(c => ocr[c.k] == null || ocr[c.k] === '')

  return (
    <div className="vr span2">
      <div className="vr-img">
        <img ref={imgRef} src={url} alt="voucher" onLoad={e => setRender({ w: e.target.clientWidth, h: e.target.clientHeight })} />
        {esc > 0 && CAMPOS.map(c => {
          const b = ocr.cajas?.[c.k]
          if (!b) return null
          const apagado = foco && foco !== c.k
          return (
            <span key={c.k} className={`vr-box ${apagado ? 'off' : ''} ${foco === c.k ? 'on' : ''}`}
              style={{
                '--bc': c.color,
                left: b.x0 * esc - 3, top: b.y0 * esc - 3,
                width: (b.x1 - b.x0) * esc + 6, height: (b.y1 - b.y0) * esc + 6,
              }}
              onMouseEnter={() => setFoco(c.k)} onMouseLeave={() => setFoco(null)}
              onClick={() => onAplicar(c.k)} title={`${c.label}: ${c.fmt(ocr[c.k])} — clic para usarlo`}>
              <b className="vr-tag" style={{ '--bc': c.color }}>{c.label}</b>
            </span>
          )
        })}
      </div>

      <div className="vr-datos">
        <p className="vr-tit">📸 Leído del voucher <span className="muted small">({ocr.confianza}%)</span></p>

        {hallados.map(c => (
          <button type="button" key={c.k} className="vr-fila"
            style={{ '--bc': c.color }}
            onMouseEnter={() => setFoco(c.k)} onMouseLeave={() => setFoco(null)}
            onClick={() => onAplicar(c.k)}>
            <span className="vr-pin" />
            <span className="vr-lbl">{c.label}</span>
            <b className="vr-val">{c.fmt(ocr[c.k])}</b>
            <span className="vr-usar">usar</span>
          </button>
        ))}

        {ocr.banco && (
          <button type="button" className="vr-fila" style={{ '--bc': '#c58ae0' }}
            onClick={() => cuentaSugerida && onAplicar('cuenta')} disabled={!cuentaSugerida}>
            <span className="vr-pin" />
            <span className="vr-lbl">Banco</span>
            <b className="vr-val">{ocr.banco}{ocr.tipoOperacion ? ` · ${ocr.tipoOperacion}` : ''}</b>
            <span className="vr-usar">{cuentaSugerida ? 'usar cuenta' : 'sin cuenta'}</span>
          </button>
        )}

        {faltan.map(c => (
          <div key={c.k} className="vr-falta">⚠ No encontré <b>{c.label.toLowerCase()}</b> — escríbelo a mano</div>
        ))}

        <button type="button" className="btn-primary vr-todo" onClick={onAplicarTodo}>
          ✓ Aceptar todo lo leído
        </button>
        <p className="muted small vr-nota">Compara con la imagen antes de aceptar. La lectura es automática y puede equivocarse.</p>
      </div>
    </div>
  )
}
