import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { savedFx } from '../lib/saveFx'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'
import BuscarLote from '../components/BuscarLote'
import { COLORS, LBL, esLote, EN_CARTERA, saldoCuota, TOLERANCIA_CUOTA } from '../lib/lotes'
import { useEsCelular } from '../lib/useEsCelular'

// El mapa del proyecto. Cada lote abre su ficha a pantalla completa
// (pages/FichaLote.jsx), donde esta todo lo del dia a dia.
export default function Lots() {
  const { esJefe } = useAuth()   // administrador, superusuario y operador
  const { pidOp } = useProject()
  const irA = useNavigate()
  const esCelular = useEsCelular()   // en el celular no se abre el teclado solo
  const [lots, setLots] = useState([])
  const [vencidos, setVencidos] = useState(new Map())   // lote → cuántas cuotas vencidas tiene
  const [expropiados, setExpropiados] = useState(new Map())
  const [contactosLote, setContactosLote] = useState(new Map())
  const [searchParams, setSearchParams] = useSearchParams()
  // el filtro vive en la URL (?estado=...): se llega asi desde el dashboard, y al
  // volver de la ficha de un lote el mapa aparece con el mismo filtro
  const filter = searchParams.get('estado') || 'todos'
  const setFilter = e => setSearchParams(e === 'todos' ? {} : { estado: e }, { replace: true })
  // ?lote=G-9 abre la ficha de ese lote directo (se llega asi desde el dashboard,
  // haciendo clic en un deudor: el numero por si solo no sirve, hay que poder
  // caer en la persona)
  useEffect(() => {
    const l = searchParams.get('lote')
    if (!l || !lots.length) return
    const [mz, lt] = String(l).split('-')
    const encontrado = lots.find(x => String(x.mz).toUpperCase() === String(mz).toUpperCase() && String(x.lt) === String(lt))
    if (encontrado) irA('/lotes/' + encontrado.id, { replace: true })
  }, [searchParams, lots])
  const [vista, setVista] = useState(() => { try { return localStorage.getItem('urbis.mapa.vista') || 'plano' } catch { return 'plano' } })
  const cambiarVista = v => { setVista(v); try { localStorage.setItem('urbis.mapa.vista', v) } catch { /* sin almacenamiento: no pasa nada */ } }

  // creacion masiva de lotes (admin)
  const [crear, setCrear] = useState(false)
  const [cf, setCf] = useState({ mz: '', desde: 1, hasta: 10, area: '', ppm2: '', inicial: 500 })
  const [cBusy, setCBusy] = useState(false)
  const [cMsg, setCMsg] = useState(null)

  async function loadLots() {
    if (!pidOp) return
    const { data } = await supabase.from('lots').select('*').eq('project_id', pidOp).order('mz').order('lt')
    setLots(data || [])
  }
  useEffect(() => {
    // sin proyecto todavia (recien cargan) no se consulta: eran 4 pedidos que el
    // servidor rechazaba con project_id=null en cada apertura del mapa
    if (!pidOp) return
    loadLots()
    // "vencida" se calcula EN VIVO (fecha ya pasada + no pagada + con saldo), no por el
    // estado guardado, para que el mapa nunca quede desactualizado si nadie tocó la cuota.
    const hoyVenc = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10)   // fecha Perú (UTC-5)
    // Filtra POR PROYECTO y por venta activa EN EL SERVIDOR. Antes bajaba las
    // cuotas vencidas de TODOS los proyectos y las filtraba aqui: miles de filas
    // de mas en cada apertura del mapa, en un servidor de 1 CPU.
    supabase.from('installments').select('amount, amount_paid, sales!inner(lot_id, status, lot:lots!inner(project_id))')
      .neq('status', 'pagado').lt('due_date', hoyVenc)
      .eq('sales.status', 'en_proceso').eq('sales.lot.project_id', pidOp)
      .then(({ data }) => {
        const m = new Map()
        for (const r of (data || [])) {
          if (saldoCuota(r) <= TOLERANCIA_CUOTA) continue   // misma regla que la ficha (lib/lotes)
          m.set(r.sales.lot_id, (m.get(r.sales.lot_id) || 0) + 1)
        }
        setVencidos(m)
      })
    // lotes con historial de EXPROPIACION (cuantas veces) — aparte del estado actual del lote
    supabase.from('sales').select('lot_id, lot:lots!inner(project_id)').eq('status', 'expropiado').eq('lot.project_id', pidOp)
      .then(({ data }) => { const m = new Map(); for (const r of (data || [])) m.set(r.lot_id, (m.get(r.lot_id) || 0) + 1); setExpropiados(m) })

    // Datos breves para el mapa: se cargan en bloque, no al pasar por cada lote.
    // La prioridad es venta activa/pagada, luego separación vigente y finalmente
    // la última expropiación para que el historial sea visible sin abrir la ficha.
    Promise.all([
      supabase.from('sales')
        .select('lot_id, status, sale_date, client:clients!sales_client_id_fkey(full_name, phone, doc_number), lot:lots!inner(project_id)')
        .eq('lot.project_id', pidOp)
        .in('status', ['en_proceso', 'pagado', 'expropiado'])
        .order('sale_date', { ascending: false }),
      supabase.from('separations')
        .select('lot_id, client:clients(full_name, phone, doc_number), lot:lots!inner(project_id)')
        .eq('lot.project_id', pidOp)
        .eq('status', 'vigente'),
    ]).then(([ventas, separaciones]) => {
      const m = new Map()
      for (const v of (ventas.data || [])) {
        if (!v.client || m.has(v.lot_id)) continue
        m.set(v.lot_id, { ...v.client, tipo: v.status === 'expropiado' ? 'Historial expropiado' : 'Titular' })
      }
      for (const s of (separaciones.data || [])) {
        if (!s.client || m.has(s.lot_id)) continue
        m.set(s.lot_id, { ...s.client, tipo: 'Separación vigente' })
      }
      setContactosLote(m)
    })
  }, [pidOp])

  function tituloLote(l) {
    const contacto = contactosLote.get(l.id)
    const base = `Mz ${l.mz} Lt ${l.lt} — ${LBL[l.status]} — ${l.area_m2} m²`
    const nv = vencidos.get(l.id) || 0
    const alerta = nv ? ' — ' + nv + (nv === 1 ? ' CUOTA VENCIDA' : ' CUOTAS VENCIDAS') : ''
    if (!contacto) return base + alerta
    return `${base}${alerta}\n${contacto.tipo}: ${contacto.full_name}\nCelular: ${contacto.phone || 'sin celular'}\nDocumento: ${contacto.doc_number || 'sin documento'}`
  }

  // lotes que SI existen (los eliminados solo se ven con su propio filtro)
  const activos = useMemo(() => lots.filter(esLote), [lots])

  const byMz = useMemo(() => {
    const g = {}
    const base = filter === 'eliminado' ? lots.filter(l => !esLote(l)) : activos
    for (const l of base) {
      if (filter === 'vencidas') { if (!vencidos.has(l.id)) continue }
      else if (filter === 'expropiado') { if (!expropiados.has(l.id)) continue }
      else if (filter === 'cartera') { if (!EN_CARTERA.includes(l.status)) continue }
      else if (!['todos', 'eliminado'].includes(filter) && l.status !== filter) continue
      ;(g[l.mz] = g[l.mz] || []).push(l)
    }
    for (const k in g) g[k].sort((a, b) => Number(a.lt) - Number(b.lt) || String(a.lt).localeCompare(String(b.lt)))
    return g
  }, [lots, activos, filter, vencidos, expropiados])

  const counts = useMemo(() => {
    const vivos = new Set(activos.map(l => l.id))
    const c = { todos: activos.length }
    for (const l of activos) c[l.status] = (c[l.status] || 0) + 1
    // los históricos también se cuentan solo sobre lotes que existen, para que el
    // número del chip coincida con lo que aparece al hacerle clic
    c.vencidas = [...vencidos.keys()].filter(id => vivos.has(id)).length
    c.expropiado = [...expropiados.keys()].filter(id => vivos.has(id)).length
    c.cartera = EN_CARTERA.reduce((s, st) => s + (c[st] || 0), 0)
    c.eliminado = lots.length - activos.length
    return c
  }, [lots, activos, vencidos, expropiados])

  // desde el mapa se vuelve con "atras" (mismo filtro); la ficha lo sabe por el state
  const abrirLote = l => irA('/lotes/' + l.id, { state: { desdeMapa: true } })

  // creacion masiva de lotes (admin)
  async function crearLotes(e) {
    e.preventDefault()
    const mz = cf.mz.trim().toUpperCase()
    const d = parseInt(cf.desde), h = parseInt(cf.hasta)
    if (!mz || isNaN(d) || isNaN(h) || h < d) { setCMsg('ERROR: REVISA MANZANA Y RANGO (DESDE <= HASTA).'); return }
    if (h - d + 1 > 200) { setCMsg('ERROR: MAXIMO 200 LOTES POR TANDA.'); return }
    const existentes = new Set(lots.filter(l => String(l.mz).toUpperCase() === mz).map(l => String(l.lt)))
    const rows = []
    const saltados = []
    for (let n = d; n <= h; n++) {
      if (existentes.has(String(n))) { saltados.push(n); continue }
      rows.push({
        project_id: pidOp, mz, lt: String(n), status: 'disponible',
        area_m2: Number(cf.area), price_per_m2: Number(cf.ppm2),
        initial_payment_default: Number(cf.inicial || 0),
      })
    }
    if (!rows.length) { setCMsg('ERROR: TODOS ESOS LOTES YA EXISTEN EN LA MZ ' + mz + '.'); return }
    setCBusy(true); setCMsg(null)
    const { data, error } = await supabase.from('lots').insert(rows).select('id, total_price, area_m2, price_per_m2')
    if (error) { setCMsg('ERROR: ' + error.message); setCBusy(false); return }
    const sinTotal = (data || []).filter(r => r.total_price === null || r.total_price === undefined)
    for (const r of sinTotal) {
      await supabase.from('lots').update({ total_price: Number(r.area_m2) * Number(r.price_per_m2) }).eq('id', r.id)
    }
    setCMsg('OK: ' + rows.length + ' LOTES CREADOS EN MZ ' + mz + (saltados.length ? ' | YA EXISTIAN (saltados): ' + saltados.join(', ') : '')); savedFx()
    setCBusy(false)
    loadLots()
  }

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Mapa de lotes</h1>
        {/* la puerta de entrada del dia a dia: se escribe y se cae en la ficha del lote */}
        <div className="mapa-buscar"><BuscarLote autoFocus={!esCelular} /></div>
        <ProjectPicker />
        {esJefe && (
          <button className="btn-ghost" onClick={() => { setCrear(true); setCMsg(null) }}>➕ Crear lotes</button>
        )}
      </div>

      <div className="chips">
        {['todos', 'disponible', 'separado', 'vendido', 'entregado', 'invadido'].map(s => (
          <button key={s} className={`chip ${filter === s ? 'on' : ''}`}
            style={s !== 'todos' ? { '--dot': COLORS[s] } : {}}
            onClick={() => setFilter(s)}>
            {s !== 'todos' && <span className="dot" />}
            {s === 'todos' ? 'Todos' : LBL[s]} ({counts[s] || 0})
          </button>
        ))}
        {/* vendidos y entregados juntos: los dos ya son de un cliente y siguen en cobranza.
            El punto lleva los dos colores para no perder la distincion del mapa. */}
        <button className={`chip ${filter === 'cartera' ? 'on' : ''}`}
          style={{ '--dot': `linear-gradient(90deg, ${COLORS.vendido} 50%, ${COLORS.entregado} 50%)` }}
          title="Vendidos + entregados: lotes que ya tienen dueño y siguen en gestión de cobranza"
          onClick={() => setFilter('cartera')}>
          <span className="dot" /> En cartera ({counts.cartera || 0})
        </button>
        <span className="muted small" style={{ alignSelf: 'center', margin: '0 .3rem', opacity: .6 }}>| histórico:</span>
        <button className={`chip ${filter === 'vencidas' ? 'on' : ''}`} style={{ '--dot': '#e05252' }}
          onClick={() => setFilter('vencidas')}>
          <span className="dot" /> Con vencidas ({counts.vencidas})
        </button>
        <button className={`chip ${filter === 'expropiado' ? 'on' : ''}`} style={{ '--dot': COLORS.expropiado }}
          onClick={() => setFilter('expropiado')}>
          <span className="dot" /> Expropiados ({counts.expropiado || 0})
        </button>
        {counts.eliminado > 0 && (
          <button className={`chip ${filter === 'eliminado' ? 'on' : ''}`} style={{ '--dot': COLORS.eliminado }}
            title="Lotes que ya no existen en el terreno. No cuentan en el total del proyecto, pero conservan sus pagos para auditoría."
            onClick={() => setFilter('eliminado')}>
            <span className="dot" /> Eliminados ({counts.eliminado})
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className={`chip ${vista === 'plano' ? 'on' : ''}`} onClick={() => cambiarVista('plano')}>🗺️ Plano</button>
        <button className={`chip ${vista === 'lista' ? 'on' : ''}`} onClick={() => cambiarVista('lista')}>☰ Lista</button>
      </div>

      {filter === 'eliminado' && (
        <p className="hint" style={{ margin: '-.7rem 0 1rem' }}>
          &#9888; Estos lotes <b>ya no existen</b> en el terreno, por eso no cuentan en el total del
          proyecto ({counts.todos} lotes). No se pueden borrar porque arrastran ventas y pagos reales:
          su plata sigue registrada en caja y en el estado de cuenta del cliente.
        </p>
      )}
      {filter === 'cartera' && (
        <p className="hint" style={{ margin: '-.7rem 0 1rem' }}>
          &#128203; <b>En cartera</b> = vendidos ({counts.vendido || 0}) + entregados ({counts.entregado || 0}).
          Todos tienen dueño y siguen en gestión de cobranza; cada uno conserva su color en el mapa.
        </p>
      )}

      {vista === 'plano' ? (
        <div className="plano-wrap">
          {Object.entries(byMz).map(([mz, arr]) => {
            const mitad = arr.length > 4 ? Math.ceil(arr.length / 2) : arr.length
            const filas = [arr.slice(0, mitad), arr.slice(mitad).reverse()].filter(f => f.length)
            return (
              <section key={mz} className="mz-plano">
                <span className="mz-tag">Mz. {mz}</span>
                {filas.map((fila, i) => (
                  <div key={i} className="fila-lotes">
                    {fila.map(l => (
                      <button key={l.id} className={`parcela ${vencidos.has(l.id) ? 'venc' : ''}`}
                        data-venc={vencidos.get(l.id) || undefined}
                        style={{ '--st': COLORS[l.status] }}
                        title={tituloLote(l)}
                        onClick={() => abrirLote(l)}>
                        <b>{l.lt}</b>
                        <small>{Math.round(l.area_m2)} m²</small>
                      </button>
                    ))}
                  </div>
                ))}
              </section>
            )
          })}
        </div>
      ) : (
        Object.entries(byMz).map(([mz, arr]) => (
          <section key={mz} className="mz-block">
            <h3>Manzana {mz}</h3>
            <div className="lot-grid">
              {arr.map(l => (
                <button key={l.id} className={`lot-cell ${vencidos.has(l.id) ? 'venc' : ''}`}
                  data-venc={vencidos.get(l.id) || undefined}
                  style={{ background: COLORS[l.status] }}
                  title={tituloLote(l)}
                  onClick={() => abrirLote(l)}>
                  {l.lt}
                </button>
              ))}
            </div>
          </section>
        ))
      )}

      {crear && (
        <div className="modal-bg" onClick={() => setCrear(false)}>
          <form className="glass modal" onClick={e => e.stopPropagation()} onSubmit={crearLotes}>
            <div className="modal-head">
              <h2>Crear lotes por manzana</h2>
              <button type="button" className="btn-ghost" onClick={() => setCrear(false)}>&#10005;</button>
            </div>
            <p className="muted small">Crea los lotes en tanda para el proyecto actual. Los numeros que ya existan en la manzana se saltan. Luego puedes editar area/precio de cada lote individual.</p>
            <div className="form-grid">
              <label>Manzana <input value={cf.mz} onChange={e => setCf(f => ({ ...f, mz: e.target.value }))} placeholder="A" required /></label>
              <label>Lote desde <input type="number" min="1" value={cf.desde} onChange={e => setCf(f => ({ ...f, desde: e.target.value }))} required /></label>
              <label>Lote hasta <input type="number" min="1" value={cf.hasta} onChange={e => setCf(f => ({ ...f, hasta: e.target.value }))} required /></label>
              <label>Area (m2) <input type="number" step="0.01" min="1" value={cf.area} onChange={e => setCf(f => ({ ...f, area: e.target.value }))} required /></label>
              <label>Precio por m2 (S/) <input type="number" step="0.01" min="0.01" value={cf.ppm2} onChange={e => setCf(f => ({ ...f, ppm2: e.target.value }))} required /></label>
              <label>Pago inicial por defecto (S/) <input type="number" step="0.01" min="0" value={cf.inicial} onChange={e => setCf(f => ({ ...f, inicial: e.target.value }))} /></label>
            </div>
            {cf.area && cf.ppm2 && (
              <p className="hint">Cada lote: {Number(cf.area)} m2 x S/ {Number(cf.ppm2).toFixed(2)} = <b>S/ {(Number(cf.area) * Number(cf.ppm2)).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</b>
                {' '}| Se crearan <b>{Math.max(0, (parseInt(cf.hasta) || 0) - (parseInt(cf.desde) || 0) + 1)}</b> lotes en la Mz {cf.mz.toUpperCase() || '?'}</p>
            )}
            {cMsg && <p className={cMsg.startsWith('OK') ? 'ok' : 'error'}>{cMsg}</p>}
            <button className="btn-primary" disabled={cBusy}>{cBusy ? 'Creando...' : 'Crear lotes'}</button>
          </form>
        </div>
      )}


    </>
  )
}
