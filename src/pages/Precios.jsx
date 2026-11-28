import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { savedFx } from '../lib/saveFx'
import { avisar, confirmar, pedirDatos } from '../lib/dialogos'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'
import { categoriasDe, categoriaDe, soles } from '../lib/plano'
import { COLORS, LBL, esLote } from '../lib/lotes'

// PRECIOS, BONOS E INVENTARIO (28 nov 2026, pedido de gerencia bloque D, sql/255). Todo en una
// pantalla por proyecto:
//   D5 el estado del proyecto (preventa que no se reabre, en venta, agotado, en espera), sus
//      etapas y su estado legal
//   D1 los lotes por estado en TODOS los proyectos (el conteo sale solo)
//   D2 la lista vigente por clase y los bonos / campañas con vigencia
//   D6 la lista de precios para asesores, sin totales (/lista-precios)
//   D3 las subidas programadas (por fecha o por meta de obra), las listas con su vigencia y el
//      historial de cada cambio de precio
//   D4 la tabla de equivalencias del plano
const ESTADOS_P = [['preventa', '🌱 Preventa'], ['en_venta', '🟢 En venta'], ['agotado', '⛔ Agotado'], ['en_espera', '⏸ En espera']]
const LEGAL = [['', '—'], ['no_inscrito', 'No inscrito'], ['inscrito', 'Inscrito'], ['titulacion_en_proceso', 'Titulación en proceso'], ['titulado', 'Titulado']]
const TIPO_BONO = [['descuento_total', 'S/ menos en el precio'], ['descuento_inicial', 'S/ menos en la inicial'], ['descuento_m2', 'S/ menos por m²'], ['porcentaje', '% menos del precio'], ['regalo', 'Regalo / beneficio (sin monto)']]
const TB = Object.fromEntries(TIPO_BONO)
const hoy = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10)
const fecha = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—'
const vigente = b => b.activo && b.desde <= hoy() && (!b.hasta || b.hasta >= hoy())

export default function Precios() {
  const { role } = useAuth()
  const { pidOp, projects, recargarProyectos } = useProject()
  const [proy, setProy] = useState(null)
  const [lotes, setLotes] = useState([])
  const [todos, setTodos] = useState([])
  const [bonos, setBonos] = useState([])
  const [subidas, setSubidas] = useState([])
  const [listas, setListas] = useState([])
  const [cambios, setCambios] = useState([])
  const [equiv, setEquiv] = useState([])
  const [etapas, setEtapas] = useState([])
  const edita = ['superuser', 'operador'].includes(role)

  const cargar = async () => {
    if (!pidOp) return
    const traer = async (armar) => { const out = []; for (let d = 0; ; d += 1000) { const { data } = await armar().range(d, d + 999); out.push(...(data || [])); if (!data || data.length < 1000) break } return out }
    const [p, ls, tl, b, s, li, ca, eq, et] = await Promise.all([
      supabase.from('projects').select('id, name, plano, estado_comercial, preventa_cerrada_at, estado_legal, legal_nota').eq('id', pidOp).maybeSingle(),
      traer(() => supabase.from('lots').select('id, mz, lt, area_m2, price_per_m2, total_price, initial_payment_default, status, associated_to').eq('project_id', pidOp).order('id')),
      traer(() => supabase.from('lots').select('project_id, status').order('id')),
      supabase.from('bonos').select('*').eq('project_id', pidOp).order('desde', { ascending: false }),
      supabase.from('subidas_precio').select('*').eq('project_id', pidOp).order('created_at', { ascending: false }),
      supabase.from('listas_precios').select('*').eq('project_id', pidOp).order('vigente_desde', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('lote_precios').select('*, lot:lots(mz, lt)').eq('project_id', pidOp).order('created_at', { ascending: false }).limit(60),
      supabase.from('lote_equivalencias').select('*').eq('project_id', pidOp).order('fecha', { ascending: false }),
      supabase.from('proyecto_etapas').select('*').eq('project_id', pidOp).order('orden'),
    ])
    setProy(p.data || null); setLotes(ls); setTodos(tl); setBonos(b.data || []); setSubidas(s.data || [])
    setListas(li.data || []); setCambios(ca.data || []); setEquiv(eq.data || []); setEtapas(et.data || [])
  }
  useEffect(() => { cargar() }, [pidOp])

  const cats = useMemo(() => categoriasDe(proy?.plano, lotes), [proy, lotes])
  // lo que se vende hoy, por precio del m² (= clase en los planos por precio)
  const clases = useMemo(() => {
    const g = new Map()
    for (const l of lotes.filter(l => ['disponible', 'reservado'].includes(l.status) || (l.status === 'separado' && /^URBIS/i.test(l.associated_to || '')))) {
      const k = Number(l.price_per_m2).toFixed(2) + '|' + Number(l.initial_payment_default || 0)
      const x = g.get(k) || { ppm2: Number(l.price_per_m2), ini: Number(l.initial_payment_default || 0), n: 0, min: Infinity, max: 0, c: categoriaDe(cats, l) }
      x.n++; x.min = Math.min(x.min, Number(l.total_price)); x.max = Math.max(x.max, Number(l.total_price)); g.set(k, x)
    }
    return [...g.values()].sort((a, b) => b.ppm2 - a.ppm2)
  }, [lotes, cats])
  const precios = useMemo(() => [...new Set(clases.map(c => c.ppm2))].sort((a, b) => b - a), [clases])

  async function guardarProyecto(cambio) {
    const { error } = await supabase.from('projects').update(cambio).eq('id', pidOp)
    if (error) { await avisar(error.message, { tono: 'error' }); return }
    savedFx(); cargar(); recargarProyectos?.()
  }
  async function etapa(e) {
    const d = await pedirDatos({ titulo: e ? '✎ ' + e.nombre : '＋ ETAPA', aceptar: 'Guardar', campos: [
      { clave: 'nombre', etiqueta: 'Etapa', obligatorio: true, valor: e?.nombre || '', placeholder: 'Etapa 1' },
      { clave: 'orden', etiqueta: 'Orden', tipo: 'numero', valor: e?.orden ?? etapas.length + 1 },
      { clave: 'estado', etiqueta: 'Estado', tipo: 'opcion', valor: e?.estado || 'en_venta', opciones: ESTADOS_P.map(([v, t]) => ({ valor: v, etiqueta: t })) },
      { clave: 'mzs', etiqueta: 'Manzanas (separadas por coma)', valor: (e?.manzanas || []).join(', ') },
      { clave: 'legal', etiqueta: 'Estado legal', tipo: 'opcion', valor: e?.estado_legal || '', opciones: LEGAL.map(([v, t]) => ({ valor: v, etiqueta: t })) },
      { clave: 'nota', etiqueta: 'Nota', valor: e?.nota || '' },
    ] })
    if (!d) return
    const fila = { project_id: pidOp, nombre: d.nombre.trim().toUpperCase(), orden: parseInt(d.orden) || 1, estado: d.estado, estado_legal: d.legal || null, nota: d.nota || null,
      manzanas: String(d.mzs || '').split(/[,\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean) }
    const { error } = e ? await supabase.from('proyecto_etapas').update(fila).eq('id', e.id) : await supabase.from('proyecto_etapas').insert(fila)
    if (error) { await avisar(error.message, { tono: 'error' }); return }
    savedFx(); cargar()
  }

  async function bono(b) {
    const d = await pedirDatos({ titulo: b ? '✎ ' + b.nombre : '🎁 BONO O CAMPAÑA', aceptar: 'Guardar', campos: [
      { clave: 'nombre', etiqueta: 'Nombre', obligatorio: true, valor: b?.nombre || '', placeholder: 'Campaña navideña' },
      { clave: 'tipo', etiqueta: 'Qué da', tipo: 'opcion', valor: b?.tipo || 'descuento_total', opciones: TIPO_BONO.map(([v, t]) => ({ valor: v, etiqueta: t })) },
      { clave: 'valor', etiqueta: 'Valor (S/ o %)', tipo: 'monto', valor: b?.valor ?? '' },
      { clave: 'desde', etiqueta: 'Desde', tipo: 'fecha', obligatorio: true, valor: b?.desde || hoy() },
      { clave: 'hasta', etiqueta: 'Hasta (vacío = sin fin)', tipo: 'fecha', valor: b?.hasta || '' },
      { clave: 'clases', etiqueta: 'Solo para los m² de (vacío = todos)', valor: (b?.precios_m2 || []).join(', '), placeholder: precios.slice(0, 4).join(', ') },
      { clave: 'cond', etiqueta: 'Condiciones (las lee el asesor y el agente)', tipo: 'largo', valor: b?.condiciones || '', placeholder: 'Separando hasta el 31/12, con la inicial completa…' },
    ] })
    if (!d) return
    if (d.hasta && d.hasta < d.desde) { await avisar('La fecha "hasta" es antes de "desde".'); return }
    const fila = { project_id: pidOp, nombre: d.nombre.trim().toUpperCase(), tipo: d.tipo, valor: Number(d.valor) || 0, desde: d.desde, hasta: d.hasta || null,
      precios_m2: String(d.clases || '').split(/[,\s]+/).map(Number).filter(n => n > 0), condiciones: String(d.cond || '').trim() || null }
    const { error } = b ? await supabase.from('bonos').update(fila).eq('id', b.id) : await supabase.from('bonos').insert(fila)
    if (error) { await avisar(error.message, { tono: 'error' }); return }
    savedFx(); cargar()
  }
  async function activarBono(b) { await supabase.from('bonos').update({ activo: !b.activo }).eq('id', b.id); savedFx(); cargar() }

  async function nuevaSubida() {
    const porClase = precios.length <= 8
    const d = await pedirDatos({ titulo: '📈 SUBIDA DE PRECIOS PROGRAMADA', aceptar: 'Programar',
      mensaje: 'Se aplica a lo que se vende: disponibles, reservados y los separados de URBIS GROUP sin cliente. Lo vendido conserva su precio.',
      campos: [
        { clave: 'nombre', etiqueta: 'Nombre', obligatorio: true, placeholder: 'Subida por el afirmado de vías' },
        { clave: 'cond', etiqueta: 'Cuándo', tipo: 'opcion', valor: 'fecha', opciones: [{ valor: 'fecha', etiqueta: 'En una fecha (la aplica el agente ese día)' }, { valor: 'meta_obra', etiqueta: 'Al cumplir una meta de obra (botón "Aplicar")' }] },
        { clave: 'fecha', etiqueta: 'Fecha (si es por fecha)', tipo: 'fecha' },
        { clave: 'meta', etiqueta: 'Meta de obra (si es por meta)', placeholder: 'Afirmado de la Av. principal terminado' },
        { clave: 'modo', etiqueta: 'Cómo sube', tipo: 'opcion', valor: porClase ? 'clase' : 'porcentaje', opciones: [...(porClase ? [{ valor: 'clase', etiqueta: 'Precio nuevo por clase (abajo)' }] : []), { valor: 'porcentaje', etiqueta: '% a todos' }, { valor: 'mas_m2', etiqueta: 'S/ más por m² a todos' }] },
        { clave: 'valor', etiqueta: '% o S/ por m² (si es a todos)', tipo: 'monto' },
        ...(porClase ? precios.flatMap((p, i) => [
          { clave: 'm2_' + i, etiqueta: 'Clase S/ ' + p + ' el m² → nuevo m²', tipo: 'monto', placeholder: 'vacío = no cambia' },
          { clave: 'ini_' + i, etiqueta: '… y su inicial nueva', tipo: 'monto', placeholder: 'vacío = la misma' },
        ]) : []),
      ] })
    if (!d) return
    if (d.cond === 'fecha' && !d.fecha) { await avisar('Falta la fecha.'); return }
    if (d.cond === 'meta_obra' && !String(d.meta || '').trim()) { await avisar('Falta la meta de obra.'); return }
    let reglas = []
    if (d.modo === 'clase') reglas = precios.map((p, i) => ({ precio_m2_actual: p, nuevo_m2: d['m2_' + i] || null, inicial: d['ini_' + i] || null })).filter(r => r.nuevo_m2 || r.inicial)
    else if (Number(d.valor) > 0) reglas = [{ [d.modo === 'porcentaje' ? 'porcentaje' : 'mas_m2']: Number(d.valor) }]
    if (!reglas.length) { await avisar('No pusiste ningún precio nuevo.'); return }
    const { error } = await supabase.from('subidas_precio').insert({ project_id: pidOp, nombre: d.nombre.trim().toUpperCase(), condicion: d.cond, fecha: d.cond === 'fecha' ? d.fecha : null, meta: d.cond === 'meta_obra' ? d.meta.trim() : null, reglas })
    if (error) { await avisar(error.message, { tono: 'error' }); return }
    savedFx(); cargar()
  }
  async function aplicar(s) {
    if (!await confirmar('¿Aplicar ahora "' + s.nombre + '"? Cambia el precio de los lotes que se venden y queda en el historial.', { aceptar: 'Sí, aplicar' })) return
    const { data, error } = await supabase.rpc('aplicar_subida', { p_subida: s.id })
    if (error) { await avisar('No se pudo: ' + error.message, { tono: 'error' }); return }
    await avisar('Listo: ' + (data?.lotes ?? 0) + ' lote(s) con el precio nuevo.'); savedFx(); cargar()
  }
  async function cancelar(s) {
    if (!await confirmar('¿Cancelar "' + s.nombre + '"?', { peligro: true, aceptar: 'Sí, cancelar' })) return
    await supabase.from('subidas_precio').update({ estado: 'cancelada' }).eq('id', s.id); savedFx(); cargar()
  }
  const reglaTxt = r => [r.precio_m2_actual ? 'S/ ' + r.precio_m2_actual + ' m²' : 'todos', r.nuevo_m2 ? '→ S/ ' + r.nuevo_m2 + ' m²' : '', r.mas_m2 ? '+S/ ' + r.mas_m2 + ' m²' : '', r.porcentaje ? '+' + r.porcentaje + '%' : '', r.inicial ? 'inicial S/ ' + r.inicial : ''].filter(Boolean).join(' ')

  // D1: lotes por estado en todos los proyectos
  const EST = ['disponible', 'reservado', 'separado', 'vendido', 'entregado', 'invadido', 'aporte']
  const resumen = projects.map(p => { const ls = todos.filter(l => l.project_id === p.id && esLote(l)); return { p, n: ls.length, c: Object.fromEntries(EST.map(e => [e, ls.filter(l => l.status === e).length])) } }).filter(x => x.n)

  return (
    <div>
      <div className="page-head u-d-f u-jc-sb u-ai-c u-fwr u-g-10">
        <h1>Precios, bonos e inventario</h1>
        <div className="u-d-f u-g-8 u-ai-c u-fwr">
          <ProjectPicker />
          <Link className="btn" to="/lista-precios">🖨 Lista para asesores</Link>
        </div>
      </div>
      {!proy ? <p className="muted">Cargando…</p> : (
        <>
          {/* D5 */}
          <div className="glass u-p-12 u-mb-10">
            <h3 className="u-m0 u-mb-8">🏗 Estado del proyecto</h3>
            <div className="u-d-f u-fwr u-g-10 u-ai-c">
              <label className="small">Comercial{' '}
                <select value={proy.estado_comercial || 'en_venta'} disabled={!edita} onChange={e => guardarProyecto({ estado_comercial: e.target.value })}>
                  {ESTADOS_P.map(([v, t]) => <option key={v} value={v} disabled={v === 'preventa' && !!proy.preventa_cerrada_at && proy.estado_comercial !== 'preventa'}>{t}</option>)}
                </select></label>
              <label className="small">Legal{' '}
                <select value={proy.estado_legal || ''} disabled={!edita} onChange={e => guardarProyecto({ estado_legal: e.target.value || null })}>
                  {LEGAL.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select></label>
              {edita && <button className="link-btn" onClick={async () => { const t = await pedirDatos({ titulo: 'Nota legal', aceptar: 'Guardar', campos: [{ clave: 'n', etiqueta: 'Partida, resolución, en qué va la titulación…', tipo: 'largo', valor: proy.legal_nota || '' }] }); if (t) guardarProyecto({ legal_nota: t.n || null }) }}>✎ nota legal</button>}
            </div>
            {proy.preventa_cerrada_at && <p className="muted small u-mb-4">La preventa se cerró el {fecha(new Date(new Date(proy.preventa_cerrada_at).getTime() - 5 * 3600e3).toISOString())}: no se reabre.</p>}
            {proy.legal_nota && <p className="small u-mb-4 u-tt-n">{proy.legal_nota}</p>}
            <div className="u-mt-8">
              <b className="small">Etapas</b>{edita && <button className="link-btn u-ml-6" onClick={() => etapa(null)}>＋ etapa</button>}
              {!etapas.length ? <p className="muted small u-m0">Sin etapas: el proyecto se vende como uno solo.</p> : (
                <ul className="small u-mb-4">{etapas.map(e => <li key={e.id}><b>{e.nombre}</b> · {ESTADOS_P.find(x => x[0] === e.estado)?.[1]}{e.manzanas?.length ? ' · Mz ' + e.manzanas.join(', ') : ''}{e.estado_legal ? ' · ' + LEGAL.find(x => x[0] === e.estado_legal)?.[1] : ''}{e.nota ? ' · ' + e.nota : ''} {edita && <button className="link-btn" onClick={() => etapa(e)}>✎</button>}</li>)}</ul>
              )}
            </div>
          </div>

          {/* D2 / D6: lo que se vende hoy */}
          <div className="glass u-p-12 u-mb-10">
            <h3 className="u-m0 u-mb-8">🏷 Lista vigente por clase</h3>
            <p className="muted small u-mt-4">Precio = área × m² redondeado hacia arriba (igual en el sistema, la lista y el agente). Cuenta disponibles, reservados y los separados de URBIS GROUP sin cliente.</p>
            {!clases.length ? <p className="muted small">No hay lotes a la venta.</p> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Clase</th><th>Precio m²</th><th>Inicial</th><th>Lotes</th><th>Precios</th></tr></thead>
                <tbody>{clases.map(c => (
                  <tr key={c.ppm2 + '|' + c.ini}><td className="u-nw">{c.c ? <><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: c.c.color, marginRight: 4 }} />{c.c.nombre}</> : '—'}</td>
                    <td>{soles(c.ppm2)}</td><td>{soles(c.ini)}</td><td>{c.n}</td><td className="u-nw small">{soles(c.min)} a {soles(c.max)}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </div>

          <div className="glass u-p-12 u-mb-10">
            <div className="u-d-f u-jc-sb u-ai-c"><h3 className="u-m0">🎁 Bonos y campañas</h3>{edita && <button className="btn-primary" onClick={() => bono(null)}>＋ Bono</button>}</div>
            <p className="muted small u-mt-4">Solo se aplican los vigentes (activos y dentro de sus fechas): esos ven el asesor en su cotizador y la lista, y el agente de ventas.</p>
            {!bonos.length ? <p className="muted small u-m0">Sin bonos.</p> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Bono</th><th>Qué da</th><th>Vigencia</th><th>Para</th><th>Estado</th><th></th></tr></thead>
                <tbody>{bonos.map(b => (
                  <tr key={b.id}><td><b>{b.nombre}</b>{b.condiciones && <div className="muted small u-tt-n">{b.condiciones}</div>}</td>
                    <td className="small">{TB[b.tipo]}{b.tipo !== 'regalo' ? ': ' + (b.tipo === 'porcentaje' ? b.valor + '%' : soles(b.valor)) : ''}</td>
                    <td className="u-nw small">{fecha(b.desde)} → {b.hasta ? fecha(b.hasta) : 'sin fin'}</td>
                    <td className="small">{b.precios_m2?.length ? 'm² de ' + b.precios_m2.map(p => 'S/ ' + p).join(', ') : 'todos'}</td>
                    <td>{vigente(b) ? <span className="st-chip st-ok">VIGENTE</span> : <span className="st-chip">{!b.activo ? 'APAGADO' : b.desde > hoy() ? 'POR EMPEZAR' : 'VENCIDO'}</span>}</td>
                    <td className="u-nw">{edita && <><button className="link-btn" onClick={() => bono(b)}>✎</button> <button className="link-btn" onClick={() => activarBono(b)}>{b.activo ? 'apagar' : 'prender'}</button></>}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </div>

          {/* D3 */}
          <div className="glass u-p-12 u-mb-10">
            <div className="u-d-f u-jc-sb u-ai-c"><h3 className="u-m0">📈 Subidas programadas</h3>{edita && <button className="btn-primary" onClick={nuevaSubida}>＋ Subida</button>}</div>
            <p className="muted small u-mt-4">Por fecha, el agente la aplica sola ese día a las 00:05 y avisa por Telegram; por meta de obra, se aplica con el botón cuando la meta se cumple.</p>
            {!subidas.length ? <p className="muted small u-m0">Ninguna programada.</p> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Subida</th><th>Cuándo</th><th>Reglas</th><th>Estado</th><th></th></tr></thead>
                <tbody>{subidas.map(s => (
                  <tr key={s.id}><td><b>{s.nombre}</b></td><td className="small">{s.condicion === 'fecha' ? '📅 ' + fecha(s.fecha) : '🚧 ' + s.meta}</td>
                    <td className="small">{(s.reglas || []).map((r, i) => <div key={i}>{reglaTxt(r)}</div>)}</td>
                    <td className="small">{s.estado === 'aplicada' ? '✅ aplicada ' + fecha(s.aplicada_at) + ' · ' + (s.resultado?.lotes ?? '?') + ' lotes' : s.estado === 'cancelada' ? '✖ cancelada' : '⏳ programada'}</td>
                    <td className="u-nw">{edita && s.estado === 'programada' && <><button className="link-btn" onClick={() => aplicar(s)}>▶ aplicar</button> <button className="link-btn muted" onClick={() => cancelar(s)}>✕</button></>}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </div>

          <div className="glass u-p-12 u-mb-10">
            <h3 className="u-m0 u-mb-8">🗂 Listas de precios con su vigencia</h3>
            {!listas.length ? <p className="muted small u-m0">Sin listas.</p> : (
              <ul className="small u-m0">{listas.map(l => (
                <li key={l.id}><b>{fecha(l.vigente_desde)}</b> · {l.nombre} <span className="muted">({l.origen})</span>
                  <div className="muted">{(l.detalle || []).map(x => 'S/ ' + x.precio_m2 + ' m² · inicial S/ ' + x.inicial).join(' | ')}</div></li>
              ))}</ul>
            )}
            <details className="u-mt-8">
              <summary className="muted small" style={{ cursor: 'pointer' }}>Últimos cambios de precio de lotes ({cambios.length})</summary>
              <div className="table-wrap"><table>
                <thead><tr><th>Fecha</th><th>Lote</th><th>Antes</th><th>Ahora</th><th>Motivo</th></tr></thead>
                <tbody>{cambios.map(c => (
                  <tr key={c.id}><td className="u-nw small">{fecha(c.created_at)}</td><td>{c.lot ? c.lot.mz + '-' + c.lot.lt : '—'}</td>
                    <td className="u-nw small">{soles(c.total_antes)}{Number(c.ppm2_antes) !== Number(c.ppm2_despues) ? ' (' + soles(c.ppm2_antes) + ' m²)' : ''}</td>
                    <td className="u-nw small"><b>{soles(c.total_despues)}</b>{Number(c.ppm2_antes) !== Number(c.ppm2_despues) ? ' (' + soles(c.ppm2_despues) + ' m²)' : ''}</td>
                    <td className="small">{c.motivo || '—'}</td></tr>
                ))}</tbody>
              </table></div>
            </details>
          </div>

          {/* D4 */}
          <div className="glass u-p-12 u-mb-10">
            <h3 className="u-m0 u-mb-8">🔁 Equivalencias del plano</h3>
            <p className="muted small u-mt-4">Los lotes renombrados por un plano nuevo. Se renombra desde la ficha del lote (superusuario): la venta, la separación y los pagos siguen con el lote.</p>
            {!equiv.length ? <p className="muted small u-m0">Ningún lote renombrado.</p> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Antes</th><th>Ahora</th><th>Plano</th><th>Fecha</th><th>Motivo</th></tr></thead>
                <tbody>{equiv.map(e => <tr key={e.id}><td>{e.antes}</td><td><b>{e.despues}</b></td><td className="small">{e.version || '—'}</td><td className="small u-nw">{fecha(e.fecha)}</td><td className="small">{e.motivo || ''}</td></tr>)}</tbody>
              </table></div>
            )}
          </div>

          {/* D1 */}
          <div className="glass u-p-12 u-mb-10">
            <h3 className="u-m0 u-mb-8">📊 Lotes por estado en todos los proyectos</h3>
            <div className="table-wrap"><table>
              <thead><tr><th>Proyecto</th>{EST.map(e => <th key={e} style={{ color: COLORS[e] }}>{LBL[e]}</th>)}<th>Total</th></tr></thead>
              <tbody>{resumen.map(x => <tr key={x.p.id}><td>{x.p.name}</td>{EST.map(e => <td key={e}>{x.c[e] || ''}</td>)}<td><b>{x.n}</b></td></tr>)}</tbody>
            </table></div>
            <p className="muted small u-mb-4">Por manzana: Mapa de lotes → 📊 Por manzana.</p>
          </div>
        </>
      )}
    </div>
  )
}
