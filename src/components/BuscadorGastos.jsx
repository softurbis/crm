import { useMemo } from 'react'
import { motivosDe, rangoDe, hayFiltro, FILTRO_VACIO } from '../lib/buscarGastos'

// EL PANEL DE BÚSQUEDA DE GASTOS (13 oct 2026): el mismo en Gastos y en la pantalla de
// facturación. `base` = los gastos sobre los que se busca (para contar los motivos);
// `f` / `setF` = { q, motivo, desde, hasta } (lib/buscarGastos).
const ATAJOS_FECHA = [['mes', 'Este mes'], ['mes_ant', 'Mes pasado'], ['anio', 'Este año'], ['', 'Todas las fechas']]

export default function BuscadorGastos({ base, f, setF }) {
  const motivos = useMemo(() => motivosDe(base), [base])
  const atajo = ATAJOS_FECHA.find(([k]) => { const r = rangoDe(k); return r.desde === f.desde && r.hasta === f.hasta })?.[0]
  const poner = cambios => setF(x => ({ ...x, ...cambios }))
  return (
    <div className="glass bg-panel">
      <div className="bg-fila">
        <input className="search bg-q" value={f.q} onChange={e => poner({ q: e.target.value })}
          placeholder="Buscar: motivo, quién recibe, SOL, lote (G4), monto… (varias palabras)" />
        {hayFiltro(f) && <button type="button" className="fx-clear" onClick={() => setF(FILTRO_VACIO)} title="Quitar la búsqueda y los filtros">✕ Limpiar</button>}
      </div>
      {motivos.length > 1 && (
        <div className="bg-chips">
          <span className="muted small bg-lbl">Motivo</span>
          {motivos.map(m => (
            <button type="button" key={m.k} className={'chip' + (f.motivo === m.k ? ' on' : '')}
              onClick={() => poner({ motivo: f.motivo === m.k ? '' : m.k })}>{m.t} <span className="bg-n">{m.n}</span></button>
          ))}
        </div>
      )}
      <div className="bg-chips">
        <span className="muted small bg-lbl">Fecha</span>
        {ATAJOS_FECHA.map(([k, t]) => (
          <button type="button" key={k || 'todo'} className={'chip' + (atajo === k ? ' on' : '')} onClick={() => poner(rangoDe(k))}>{t}</button>
        ))}
        <label className="bg-fecha">desde <input type="date" value={f.desde} onChange={e => poner({ desde: e.target.value })} /></label>
        <label className="bg-fecha">hasta <input type="date" value={f.hasta} onChange={e => poner({ hasta: e.target.value })} /></label>
      </div>
    </div>
  )
}
