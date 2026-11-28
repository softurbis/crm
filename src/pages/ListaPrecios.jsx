import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useProject, ProjectPicker } from '../context/ProjectContext'
import { categoriasDe, categoriaDe, cotizar, soles, textoCuotasVenta } from '../lib/plano'

// LISTA DE PRECIOS PARA ASESORES (28 nov 2026, pedido de gerencia D6): sale del sistema — los
// mismos precios que la ficha, el cotizador y el agente (lots.total_price, redondeado hacia
// arriba, sql/255) — y SIN TOTALES: ni valor del inventario ni cuántos lotes quedan (REGLA de
// gerencia: "ninguna pantalla de asesor ni documento de cliente muestra totales ni datos
// internos"). Por manzana: área, clase, precio, inicial y la cuota mensual, semanal y diaria.
// Se imprime o se guarda en PDF. Solo lo que se ofrece: disponible, sin dueño y no marcado
// "no se ofrece" en el agente de ventas. Lleva los bonos vigentes.
const hoyTxt = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10).split('-').reverse().join('/')

export default function ListaPrecios() {
  const { pidOp } = useProject()
  const [datos, setDatos] = useState(null)
  const [bonos, setBonos] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!pidOp) return
    let vivo = true
    setDatos(null); setError('')
    const hoy = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10)
    Promise.all([
      supabase.rpc('panel_vendedor', { p_proyecto: pidOp }),
      supabase.from('bonos').select('*').eq('project_id', pidOp).eq('activo', true).lte('desde', hoy).or('hasta.is.null,hasta.gte.' + hoy).order('desde'),
    ]).then(([{ data, error: e }, { data: b }]) => {
      if (!vivo) return
      if (e) { setError(e.message); return }
      setDatos(data); setBonos(b || [])
    })
    return () => { vivo = false }
  }, [pidOp])

  const cfg = datos?.config || { cuotas: 48, separacion: 0, no_ofrecer: [] }
  const cats = useMemo(() => categoriasDe(datos?.plano, datos?.lotes || []), [datos])
  const porMz = useMemo(() => {
    const fuera = new Set((cfg.no_ofrecer || []).map(s => String(s).toUpperCase()))
    const libres = (datos?.lotes || []).filter(l => l.status === 'disponible' && !l.associated_to && !fuera.has((l.mz + '-' + l.lt).toUpperCase()))
    const g = {}
    for (const l of libres) (g[l.mz] = g[l.mz] || []).push(l)
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }))
  }, [datos])

  const N = cfg.cuotas || 48
  return (
    <div className="hoja-imprimible">
      <div className="page-head u-d-f u-jc-sb u-ai-c u-fwr u-g-10 no-print">
        <h1>Lista de precios</h1>
        <div className="u-d-f u-g-8 u-ai-c u-fwr">
          <ProjectPicker />
          {datos && <button className="btn" onClick={() => window.print()}>🖨 Imprimir / PDF</button>}
        </div>
      </div>
      {error ? <div className="glass u-p-12"><p className="u-m0" style={{ color: '#ff8e7a' }}>{error}</p></div>
        : !datos ? <p className="muted">Cargando…</p> : (
        <>
          <h2 className="u-m0">{datos.proyecto?.name}</h2>
          <p className="muted u-fs-12 u-mt-4">Precios vigentes al {hoyTxt()} · {N} cuotas sin intereses{Number(cfg.separacion) > 0 ? ' · separa con ' + soles(cfg.separacion) : ''}. Precio = área × precio del m², redondeado hacia arriba.</p>
          {bonos.length > 0 && (
            <div className="glass u-p-8 u-mb-10">
              <b>🎁 Bonos vigentes</b>
              <ul className="u-mb-4 small">{bonos.map(b => <li key={b.id}><b>{b.nombre}</b>{b.condiciones ? ' — ' + b.condiciones : ''}{b.hasta ? ' (hasta el ' + b.hasta.split('-').reverse().join('/') + ')' : ''}</li>)}</ul>
            </div>
          )}
          {!porMz.length ? <p className="muted">No hay lotes para ofrecer en este proyecto.</p> : porMz.map(([mz, ls]) => (
            <div key={mz} className="glass u-p-8 u-mb-10" style={{ breakInside: 'avoid' }}>
              <h3 className="u-m0 u-mb-4">Manzana {mz}</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Lote</th><th>Área</th><th>Clase</th><th>Precio m²</th><th>Precio</th><th>Inicial</th><th>Cuotas</th><th>Semanal</th><th>Diaria</th></tr></thead>
                  <tbody>{ls.sort((a, b) => (parseInt(a.lt) - parseInt(b.lt)) || String(a.lt).localeCompare(String(b.lt))).map(l => {
                    const q = cotizar(l.total_price, l.inicial, N, 0), c = categoriaDe(cats, l)
                    return (
                      <tr key={l.id}>
                        <td><b>{l.mz}-{l.lt}</b></td><td className="u-nw">{Number(l.area_m2).toFixed(2)} m²</td>
                        <td className="u-nw">{c ? <><span className="muestra" style={{ '--c': c.color, display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: c.color, marginRight: 4 }} />{c.nombre}</> : ''}</td>
                        <td className="u-nw">{soles(l.price_per_m2)}</td><td className="u-nw"><b>{soles(q.precio)}</b></td><td className="u-nw">{soles(q.inicial)}</td>
                        <td className="small">{textoCuotasVenta(q)}</td><td className="u-nw">{soles(q.semanal)}</td><td className="u-nw">{soles(q.diaria)}</td>
                      </tr>
                    )
                  })}</tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
