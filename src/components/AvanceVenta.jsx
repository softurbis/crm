// LA VENTA EN UNA LÍNEA (28 nov 2026, pedido de gerencia C6, sql/251 → vista ventas_avance):
// separación → contrato generado → firmado y subido → comisión solicitada → hoja firmada →
// comisión pagada, con alerta si lleva más de `alerta` días sin avanzar.
const fechaCorta = ts => ts ? new Date(ts).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', timeZone: 'America/Lima' }) : ''

export function pasosVenta(a) {
  if (!a) return []
  const com = !!a.comision_id
  return [
    { t: 'Separación', hecho: a.venta_directa || !!a.separacion_at, fecha: a.separacion_at, nota: a.venta_directa ? 'venta directa' : '' },
    { t: 'Contrato generado', hecho: !!(a.contrato_generado_at || a.firmado_at), fecha: a.contrato_generado_at },
    { t: 'Firmado y subido', hecho: !!a.firmado_at, fecha: a.firmado_at },
    { t: 'Comisión solicitada', hecho: !com || !!(a.comision_solicitada_at || a.comision_pagada_at), fecha: a.comision_solicitada_at, na: !com },
    { t: 'Hoja firmada', hecho: !com || !!(a.hoja_firmada_at || a.comision_pagada_at), fecha: a.hoja_firmada_at, na: !com },
    { t: 'Comisión pagada', hecho: !com || !!a.comision_pagada_at, fecha: a.comision_pagada_at, na: !com },
  ]
}

// días sin avanzar (solo si falta algún paso); null = completa o sin datos
export function diasDetenida(a) {
  const p = pasosVenta(a)
  if (!p.length || p.every(x => x.hecho) || a.status === 'expropiado') return null
  const ult = a.ultimo_paso_at ? new Date(a.ultimo_paso_at) : null
  return ult ? Math.floor((Date.now() - ult.getTime()) / 86400000) : null
}

export default function AvanceVenta({ a, alerta = 7, compacto = false }) {
  const p = pasosVenta(a)
  if (!p.length) return null
  const dias = diasDetenida(a)
  const sig = p.find(x => !x.hecho)
  const detenida = dias !== null && dias > alerta
  if (compacto) return (
    <span title={p.map(x => (x.hecho ? '✅ ' : '⬜ ') + x.t + (x.na ? ' (sin comisión)' : x.fecha ? ' · ' + fechaCorta(x.fecha) : '')).join('\n') + (sig ? '\n\nSigue: ' + sig.t : '')}
      style={{ whiteSpace: 'nowrap', letterSpacing: 1 }}>
      {p.map((x, i) => <span key={i} style={{ color: x.na ? 'var(--muted)' : x.hecho ? '#6fdd9b' : detenida ? '#ff8e7a' : '#e0b34c' }}>{x.na ? '·' : x.hecho ? '●' : '○'}</span>)}
      {detenida && <span style={{ color: '#ff8e7a', fontSize: 11, marginLeft: 4 }}>⚠️ {dias} d</span>}
    </span>
  )
  return (
    <div className="glass" style={{ padding: '8px 10px', margin: '0 0 10px', borderLeft: '3px solid ' + (detenida ? '#ff8e7a' : sig ? '#e0b34c' : '#6fdd9b') }}>
      <div className="u-d-f u-g-6 u-fwr u-ai-c">
        <b className="u-fs-11">🧾 LA VENTA:</b>
        {p.map((x, i) => (
          <span key={i} className="u-fs-11" title={x.na ? 'Esta venta no tiene comisión registrada' : x.fecha ? fechaCorta(x.fecha) : ''}
            style={{ color: x.na ? 'var(--muted)' : x.hecho ? '#6fdd9b' : '#e0b34c', opacity: x.na ? .6 : 1 }}>
            {x.na ? '·' : x.hecho ? '✅' : '⬜'} {x.t}{x.nota ? ' (' + x.nota + ')' : ''}{i < p.length - 1 ? ' →' : ''}
          </span>
        ))}
      </div>
      {detenida && <p className="u-fs-11 u-m0 u-mt-4" style={{ color: '#ff8e7a' }}>⚠️ Lleva {dias} días sin avanzar. Sigue: <b>{sig.t}</b>.</p>}
    </div>
  )
}
