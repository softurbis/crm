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

export default function VoucherReview({ file, ocr, cuentaSugerida, montoActual, onAplicar, onAplicarTodo, onElegirMonto }) {
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

        {/* Todo monto del voucher es clickeable: si el automatico agarro el que
            no era (ej. el total con comision), se elige el correcto con un clic. */}
        {esc > 0 && (ocr.candidatos || []).map((m, i) => {
          if (!m.bbox) return null
          const elegido = montoActual != null && Math.abs(Number(montoActual) - m.valor) < 0.005
          if (elegido) return null   // ese ya lo dibuja el cuadro verde del monto
          return (
            <span key={'c' + i} className="vr-alt"
              style={{
                left: m.bbox.x0 * esc - 2, top: m.bbox.y0 * esc - 2,
                width: (m.bbox.x1 - m.bbox.x0) * esc + 4, height: (m.bbox.y1 - m.bbox.y0) * esc + 4,
              }}
              onClick={() => onElegirMonto(m.valor)}
              title={`Usar S/ ${m.valor.toFixed(2)} como monto`}>
              <b className="vr-alt-tag">S/ {m.valor.toFixed(2)}</b>
            </span>
          )
        })}

        {esc > 0 && CAMPOS.map(c => {
          let b = ocr.cajas?.[c.k]
          // si eligieron otro monto del voucher, el cuadro se mueve a ese
          if (c.k === 'monto' && montoActual != null) {
            const sel = (ocr.candidatos || []).find(m => Math.abs(m.valor - Number(montoActual)) < 0.005)
            if (sel?.bbox) b = sel.bbox
          }
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

        {/* Aviso clave: en vouchers con comision hay varios montos y el automatico
            toma el mas alto, que suele ser el total y NO lo que entra a caja. */}
        {(ocr.candidatos || []).length > 1 && (
          <div className="vr-multi">
            Hay <b>{ocr.candidatos.length} montos</b> en este voucher (¿comisión?).
            Si tomé el que no era, <b>haz clic sobre el correcto</b> en la imagen.
          </div>
        )}

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
