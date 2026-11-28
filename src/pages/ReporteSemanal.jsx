import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// REPORTE SEMANAL (28 nov 2026, pedido de gerencia B3, sql/254): lo de la reunión del lunes.
// Cumplimiento por persona, tareas arrastradas 3+ veces, embudo comercial por proyecto y por
// asesor, cobranza y gastos por proyecto. El agente manda lo mismo por Telegram el domingo en la
// noche (sec_semanal_hora, 20:00); aquí se ve cualquier semana y se imprime o guarda en PDF.
// REGLA DEL DUEÑO: el superusuario ve todas las tareas; los demás, solo las del equipo.
const soles = n => 'S/ ' + Math.round(Number(n || 0)).toLocaleString('es-PE')
const iso = d => d.toISOString().slice(0, 10)
const lunesDe = s => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d) }
const masDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d) }
const fecha = s => new Date(s + 'T12:00:00').toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: '2-digit' })
// por defecto la última semana cerrada (lunes a domingo); el domingo en la noche, esta misma
const semanaPorDefecto = () => {
  const hoy = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10)
  return new Date(hoy + 'T12:00:00').getDay() === 0 ? lunesDe(hoy) : masDias(lunesDe(hoy), -7)
}

export default function ReporteSemanal() {
  const { role } = useAuth()
  const [lunes, setLunes] = useState(semanaPorDefecto())
  const [r, setR] = useState(null)
  const [err, setErr] = useState('')
  const domingo = masDias(lunes, 6)

  useEffect(() => {
    setR(null); setErr('')
    supabase.rpc('reporte_semanal', { p_desde: lunes, p_hasta: domingo }).then(({ data, error }) => {
      if (error) setErr(error.message); else setR(data)
    })
  }, [lunes])

  const arr = (r?.arrastradas || []).filter(t => role === 'superuser' || !t.visibilidad || t.visibilidad === 'equipo')
  const Caja = ({ t, children }) => <div className="glass u-p-12 u-mb-10"><h3 className="u-m0 u-mb-8">{t}</h3>{children}</div>
  const tot = (lista, k) => (lista || []).reduce((s, x) => s + Number(x[k] || 0), 0)

  return (
    <div className="reporte-semanal">
      <div className="page-head u-d-f u-jc-sb u-ai-c u-fwr u-g-10">
        <h1>Reporte semanal</h1>
        <div className="u-d-f u-g-8 u-ai-c u-fwr no-print">
          <button className="btn" onClick={() => setLunes(masDias(lunes, -7))}>◀</button>
          <input type="date" value={lunes} onChange={e => e.target.value && setLunes(lunesDe(e.target.value))} />
          <button className="btn" onClick={() => setLunes(masDias(lunes, 7))}>▶</button>
          <button className="btn" onClick={() => window.print()}>🖨 Imprimir / PDF</button>
        </div>
      </div>
      <p className="muted u-fs-12">Semana del {fecha(lunes)} al {fecha(domingo)}. El domingo a las 20:00 el agente manda este resumen por Telegram a gerencia.</p>
      {err ? <div className="glass u-p-12"><p className="u-m0" style={{ color: '#ff8e7a' }}>{/permiso/i.test(err) ? 'El reporte semanal es solo para gerencia.' : err}</p></div>
        : !r ? <p className="muted">Armando el reporte…</p> : (
        <>
          <Caja t="✅ Cumplimiento por persona">
            {!r.tareas.length ? <p className="muted u-m0">Sin tareas esta semana.</p> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Persona</th><th>Cumplidas</th><th>%</th><th>Pausadas</th><th>Extras</th></tr></thead>
                <tbody>{r.tareas.map(t => (
                  <tr key={t.id}><td>{t.persona}</td><td>{t.hechas} de {t.total}</td>
                    <td><b style={{ color: !t.total ? undefined : t.hechas / t.total >= 0.8 ? '#6fdd9b' : t.hechas / t.total >= 0.5 ? '#e0b34c' : '#ff8e7a' }}>{t.total ? Math.round(t.hechas / t.total * 100) + '%' : '—'}</b></td>
                    <td>{t.pausadas || ''}</td><td>{t.extras || ''}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Caja>
          <Caja t={'↪ Arrastradas 3 veces o más (' + arr.length + ')'}>
            {!arr.length ? <p className="muted u-m0">Ninguna. 👍</p> : <ul className="u-m0">{arr.map(t => <li key={t.id}><b>{t.persona.split(' ')[0]}</b>: {t.title} <span className="muted">↪×{t.arrastres}</span></li>)}</ul>}
          </Caja>
          <Caja t="💼 Embudo comercial por proyecto">
            {!r.embudo_proyecto.length ? <p className="muted u-m0">Sin movimiento comercial esta semana.</p> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Proyecto</th><th>Leads nuevos</th><th>Con seguimiento</th><th>Visitas</th><th>Separaciones</th><th>Ventas</th></tr></thead>
                <tbody>{r.embudo_proyecto.map(p => <tr key={p.proyecto}><td>{p.proyecto}</td><td>{p.leads}</td><td>{p.contactados}</td><td>{p.visitas}</td><td>{p.separaciones}</td><td><b>{p.ventas}</b></td></tr>)}
                  {r.embudo_proyecto.length > 1 && <tr style={{ fontWeight: 700 }}><td>TOTAL</td>{['leads', 'contactados', 'visitas', 'separaciones', 'ventas'].map(k => <td key={k}>{tot(r.embudo_proyecto, k)}</td>)}</tr>}
                </tbody>
              </table></div>
            )}
          </Caja>
          <Caja t="🧑‍💼 Embudo por asesor">
            {!r.embudo_asesor.length ? <p className="muted u-m0">Ningún asesor con movimiento esta semana.</p> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Asesor</th><th>Leads asignados</th><th>Seguimientos</th><th>Separaciones</th><th>Ventas</th></tr></thead>
                <tbody>{r.embudo_asesor.map(a => <tr key={a.asesor}><td>{a.asesor}</td><td>{a.asignados}</td><td>{a.seguimientos}</td><td>{a.separaciones}</td><td><b>{a.ventas}</b></td></tr>)}</tbody>
              </table></div>
            )}
          </Caja>
          <Caja t="💵 Cobranza">
            {!r.cobranza.length ? <p className="muted u-m0">Sin cobros ni morosos.</p> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Proyecto</th><th>Cobrado en la semana</th><th>Clientes con cuotas vencidas</th><th>Vencido al {fecha(domingo)}</th></tr></thead>
                <tbody>{r.cobranza.map(c => <tr key={c.proyecto}><td>{c.proyecto}</td><td>{soles(c.cobrado)}</td><td>{c.morosos}</td><td style={{ color: c.vencido > 0 ? '#ff8e7a' : undefined }}>{soles(c.vencido)}</td></tr>)}
                  {r.cobranza.length > 1 && <tr style={{ fontWeight: 700 }}><td>TOTAL</td><td>{soles(tot(r.cobranza, 'cobrado'))}</td><td>{tot(r.cobranza, 'morosos')}</td><td>{soles(tot(r.cobranza, 'vencido'))}</td></tr>}
                </tbody>
              </table></div>
            )}
          </Caja>
          <Caja t="🧾 Gastos por proyecto">
            {!r.gastos.length ? <p className="muted u-m0">Sin gastos pagados ni por aprobar.</p> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Proyecto</th><th>Pagado en la semana</th><th>N° de gastos</th><th>Por aprobar (hoy)</th></tr></thead>
                <tbody>{r.gastos.map(g => <tr key={g.proyecto}><td>{g.proyecto}</td><td>{soles(g.pagado)}</td><td>{g.n_pagados}</td><td>{g.por_aprobar || ''}</td></tr>)}
                  {r.gastos.length > 1 && <tr style={{ fontWeight: 700 }}><td>TOTAL</td><td>{soles(tot(r.gastos, 'pagado'))}</td><td>{tot(r.gastos, 'n_pagados')}</td><td>{tot(r.gastos, 'por_aprobar')}</td></tr>}
                </tbody>
              </table></div>
            )}
          </Caja>
          <p className="muted small">Avance de obras: entra cuando exista el módulo de obras (fase 4 del pedido).</p>
        </>
      )}
    </div>
  )
}
