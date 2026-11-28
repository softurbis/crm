import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { savedFx } from '../lib/saveFx'
import { avisar } from '../lib/dialogos'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'

// RESULTADO POR CANAL Y CAMPAÑA (28 nov 2026, pedido de gerencia C10, sql/254): por cada canal
// (el origen del lead) y por cada campaña, desde el PRIMER lead: leads, contactados, visitas,
// separaciones, ventas, gasto, costo por lead y costo por venta. "Para medir antes de fijar
// metas por canal". Todo sale de resultados_canal() (sin el tope de 1000 filas).
// El gasto es el de los gastos marcados con su canal o su campaña: abajo están los gastos que
// parecen de publicidad y todavía no tienen canal, para marcarlos aquí mismo.
export const CANALES = [['ads', 'Anuncio'], ['red_social', 'Red social'], ['web', 'Página web'], ['whatsapp', 'WhatsApp'], ['letrero', 'Letrero'], ['volanteo', 'Volanteo'],
  ['perifoneo', 'Perifoneo'], ['radio', 'Radio'], ['activacion', 'Activación'], ['convenio', 'Convenio'], ['referido', 'Referido'], ['lista_espera', 'Lista de espera'],
  ['feria', 'Feria'], ['walk_in', 'Vino a la oficina'], ['otro', 'Otro']]
const CANAL = Object.fromEntries(CANALES)
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—'
const fecha = d => d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-PE') : '—'
const PUBLICIDAD = ['*public*', '*anunc*', '*facebook*', '*instagram*', '*tiktok*', '*volante*', '*perifon*', '*radio*', '*letrero*', '*banner*', '*gigantograf*', '*marketing*', '*pauta*', '*afiche*']

export default function ResultadosCanal() {
  const { role } = useAuth()
  const { projects } = useProject()
  const [proy, setProy] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [filas, setFilas] = useState(null)
  const [sinCanal, setSinCanal] = useState([])
  const [campanas, setCampanas] = useState([])
  const puedeMarcar = ['superuser', 'admin', 'operador'].includes(role)

  const cargar = async () => {
    setFilas(null)
    const { data, error } = await supabase.rpc('resultados_canal', { p_project: proy || null, p_desde: desde || null, p_hasta: hasta || null })
    if (error) { avisar('No se pudo calcular: ' + error.message, { tono: 'error' }); setFilas([]); return }
    setFilas(data || [])
    let q = supabase.from('expenses').select('id, project_id, amount, issue_date, description, detail, type, recipient').is('canal', null).is('campaign_id', null).is('rejected_at', null)
      .or(PUBLICIDAD.flatMap(p => ['description.ilike.' + p, 'detail.ilike.' + p]).join(',')).order('issue_date', { ascending: false }).limit(200)
    if (proy) q = q.eq('project_id', proy)
    const [{ data: g }, { data: c }] = await Promise.all([q, supabase.from('campaigns').select('id, name, project_id').order('created_at', { ascending: false })])
    setSinCanal(g || []); setCampanas(c || [])
  }
  useEffect(() => { cargar() }, [proy, desde, hasta])

  async function marcar(g, campo, valor) {
    const { error } = await supabase.from('expenses').update({ [campo]: valor || null }).eq('id', g.id)
    if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return }
    savedFx(); cargar()
  }

  const canales = (filas || []).filter(f => f.grupo === 'canal' && (f.leads || f.gasto)).sort((a, b) => b.leads - a.leads)
  const camps = (filas || []).filter(f => f.grupo === 'campana')
  const tot = canales.reduce((t, f) => { for (const k of ['leads', 'contactados', 'visitas_agendadas', 'visitas_realizadas', 'separaciones', 'ventas', 'gasto']) t[k] = (t[k] || 0) + Number(f[k] || 0); return t }, {})

  const Tabla = ({ rows, nombre, total }) => (
    <div className="glass table-wrap">
      <table>
        <thead><tr><th>{nombre}</th><th>Desde</th><th>Leads</th><th>Contactados</th><th>Visitas (agend. / realiz.)</th><th>Separaciones</th><th>Ventas</th><th>Gasto</th><th>Costo por lead</th><th>Costo por venta</th></tr></thead>
        <tbody>
          {rows.map(f => (
            <tr key={f.grupo + f.clave}>
              <td><b>{f.grupo === 'canal' ? (CANAL[f.clave] || f.clave || 'SIN CANAL') : f.nombre}</b>{f.presupuesto ? <div className="muted small">presupuesto {soles(f.presupuesto)}</div> : null}</td>
              <td className="u-nw small">{fecha(f.primer_lead)}</td>
              <td>{f.leads}</td>
              <td className="u-nw">{f.contactados} <span className="muted small">{pct(f.contactados, f.leads)}</span></td>
              <td className="u-nw">{f.visitas_agendadas} / {f.visitas_realizadas}</td>
              <td>{f.separaciones}</td>
              <td className="u-nw"><b>{f.ventas}</b> <span className="muted small">{pct(f.ventas, f.leads)}</span></td>
              <td className="u-nw">{Number(f.gasto) ? soles(f.gasto) : <span className="muted">—</span>}</td>
              <td className="u-nw">{Number(f.gasto) && f.leads ? soles(f.gasto / f.leads) : '—'}</td>
              <td className="u-nw">{Number(f.gasto) && f.ventas ? soles(f.gasto / f.ventas) : '—'}</td>
            </tr>
          ))}
          {total && rows.length > 1 && (
            <tr style={{ fontWeight: 700, borderTop: '1px solid rgba(255,255,255,.2)' }}>
              <td>TOTAL</td><td></td><td>{total.leads}</td><td>{total.contactados} <span className="muted small">{pct(total.contactados, total.leads)}</span></td>
              <td>{total.visitas_agendadas} / {total.visitas_realizadas}</td><td>{total.separaciones}</td><td>{total.ventas} <span className="muted small">{pct(total.ventas, total.leads)}</span></td>
              <td>{total.gasto ? soles(total.gasto) : '—'}</td><td>{total.gasto && total.leads ? soles(total.gasto / total.leads) : '—'}</td><td>{total.gasto && total.ventas ? soles(total.gasto / total.ventas) : '—'}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )

  async function excel() {
    const { descargarLista } = await import('../lib/excelLista')
    await descargarLista({
      hoja: 'Por canal', tituloLibro: 'Resultado por canal y campaña', filas: [...canales, ...camps],
      sub: (proy ? projects.find(p => p.id === proy)?.name : 'Todos los proyectos') + ' · ' + (desde || hasta ? (fecha(desde) + ' al ' + fecha(hasta)) : 'desde el primer lead'),
      columnas: [
        { t: 'Tipo', w: 9, v: f => f.grupo === 'canal' ? 'CANAL' : 'CAMPAÑA' }, { t: 'Canal / campaña', w: 26, v: f => f.grupo === 'canal' ? (CANAL[f.clave] || f.clave) : f.nombre },
        { t: 'Desde', w: 11, f: 'fecha', v: f => f.primer_lead }, { t: 'Leads', w: 8, f: 'num', v: f => f.leads }, { t: 'Contactados', w: 11, f: 'num', v: f => f.contactados },
        { t: 'Visitas agendadas', w: 10, f: 'num', v: f => f.visitas_agendadas }, { t: 'Visitas realizadas', w: 10, f: 'num', v: f => f.visitas_realizadas },
        { t: 'Separaciones', w: 11, f: 'num', v: f => f.separaciones }, { t: 'Ventas', w: 8, f: 'num', v: f => f.ventas },
        { t: 'Gasto', w: 12, f: 'soles', v: f => f.gasto }, { t: 'Costo por lead', w: 12, f: 'soles', v: f => Number(f.gasto) && f.leads ? f.gasto / f.leads : null },
        { t: 'Costo por venta', w: 12, f: 'soles', v: f => Number(f.gasto) && f.ventas ? f.gasto / f.ventas : null },
      ],
    })
  }

  return (
    <div>
      <div className="page-head u-d-f u-jc-sb u-ai-c u-fwr u-g-10">
        <h1>Resultado por canal</h1>
        <div className="u-d-f u-g-8 u-ai-c u-fwr">
          <select value={proy} onChange={e => setProy(e.target.value)}>
            <option value="">Todos los proyectos</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} title="Desde (vacío = desde el primer lead)" />
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} title="Hasta" />
          {(desde || hasta) && <button className="link-btn" onClick={() => { setDesde(''); setHasta('') }}>desde el primer lead</button>}
          {filas?.length > 0 && <button className="btn" onClick={excel}>📥 Excel</button>}
        </div>
      </div>
      <p className="muted u-fs-12">Cada lead cuenta en el canal por donde entró (su origen) y en su campaña. Visitas, separaciones y ventas se cruzan por el cliente ligado o su mismo celular. El gasto sale de los gastos marcados con su canal o campaña.</p>
      {filas === null ? <p className="muted">Calculando…</p> : (
        <>
          <h3>Por canal</h3>
          {!canales.length ? <div className="glass u-p-12"><p className="muted u-m0">Sin leads en este rango.</p></div> : <Tabla rows={canales} nombre="Canal" total={tot} />}
          {canales.length > 0 && canales[0].clave === 'whatsapp' && <p className="muted small">La mayoría entra como "WhatsApp" porque el bot no sabe de qué anuncio vino: al registrar o filtrar el lead, ponle su origen real (Prospectos → ficha) o usa una campaña con frase clave.</p>}
          <h3 className="u-mt-10">Por campaña</h3>
          {!camps.length ? <div className="glass u-p-12"><p className="muted u-m0">Todavía no hay campañas. Se crean en Comercial → Campañas (cada una con su frase clave en el anuncio).</p></div> : <Tabla rows={camps} nombre="Campaña" />}
          <h3 className="u-mt-10">Gastos de publicidad sin canal ({sinCanal.length})</h3>
          {!sinCanal.length ? <p className="muted small">Ninguno: todos los gastos que parecen de publicidad tienen su canal.</p> : (
            <div className="glass table-wrap">
              <table>
                <thead><tr><th>Fecha</th><th>Proyecto</th><th>Gasto</th><th>Monto</th><th>Canal</th><th>Campaña</th></tr></thead>
                <tbody>{sinCanal.map(g => (
                  <tr key={g.id}>
                    <td className="u-nw small">{fecha(g.issue_date)}</td>
                    <td className="small">{projects.find(p => p.id === g.project_id)?.name || '—'}</td>
                    <td className="small">{g.description || g.detail}{g.recipient && <div className="muted">{g.recipient}</div>}</td>
                    <td className="u-nw">{soles(g.amount)}</td>
                    <td>{puedeMarcar ? <select value="" onChange={e => marcar(g, 'canal', e.target.value)}><option value="">— elegir —</option>{CANALES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select> : '—'}</td>
                    <td>{puedeMarcar && campanas.filter(c => !g.project_id || c.project_id === g.project_id).length > 0
                      ? <select value="" onChange={e => marcar(g, 'campaign_id', e.target.value)}><option value="">— elegir —</option>{campanas.filter(c => !g.project_id || c.project_id === g.project_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
