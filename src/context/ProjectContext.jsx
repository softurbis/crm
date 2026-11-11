import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import '../styles/empresas.css'

const Ctx = createContext(null)

// Paleta por defecto: si un proyecto no tiene color elegido, toma uno por su orden.
// Asi nunca se ve gris aunque no lo hayan configurado todavia.
export const PALETA_PROYECTOS = [
  '#8fd16f', '#7bb6e0', '#e8b04f', '#c58ae0',
  '#6fd1c0', '#f2785c', '#e8a0c8', '#56c7d6',
]
export const colorProyecto = (p, i = 0) => p?.color || PALETA_PROYECTOS[i % PALETA_PROYECTOS.length]

// La MARCA de cada proyecto: su logo y, si usa el facturador, quién factura (logo,
// color, RUC). Va en una consulta aparte y tolerante: si la base todavía no tiene
// las columnas del facturador (sql/113 sin correr) se queda solo con el logo, y si
// ni eso, el panel sigue igual que antes. Nunca deja al menú sin proyectos.
const COLS_FACT = 'id, logo_url, fact_activo, fact_ruc, fact_razon_social, fact_direccion, fact_serie_boleta, fact_serie_factura, fact_logo_url, fact_color'
async function marcaDe(ids) {
  if (!ids.length) return {}
  // la empresa (sql/200) y el registro directo de gastos viajan con la marca; sin el 197, sin ellos
  let { data, error } = await supabase.from('projects').select(COLS_FACT + ', empresa, gasto_directo').in('id', ids)
  if (error) ({ data, error } = await supabase.from('projects').select(COLS_FACT).in('id', ids))
  if (error) ({ data } = await supabase.from('projects').select('id, logo_url').in('id', ids))
  return Object.fromEntries((data || []).map(x => [x.id, x]))
}
// el logo que identifica al proyecto en el panel: el de quien factura si lo tiene
// (Las Praderas de Pucallpa = Century), si no el del proyecto
export const logoProyecto = p => p?.fact_logo_url || p?.logo_url || null

// ---- EMPRESAS (11 nov 2026, pedido del dueño) ----
// La lista de proyectos se separa por empresa: CENTURY (Las Praderas de Pucallpa) y
// URBIS (los demás). Cada proyecto sigue siendo independiente (al mismo nivel dentro de
// su empresa); "Todo Century" / "Todo Urbis" suman los de esa empresa en Hoy y el
// Dashboard. La empresa sale de projects.empresa (sql/200); sin el 197, de quien factura.
export const empresaDe = p => p?.empresa || (/century/i.test(p?.fact_razon_social || '') ? 'CENTURY' : 'URBIS')
const ORDEN_EMPRESA = { CENTURY: 0, URBIS: 1 }
export const nombreEmpresa = e => (e || '').charAt(0) + (e || '').slice(1).toLowerCase()
// el valor del selector para "todo <empresa>"
export const PID_EMPRESA = 'emp:'
export const esPidTotal = v => v === 'general' || String(v || '').startsWith(PID_EMPRESA)
// los proyectos agrupados por empresa, en orden; cada uno con su posición en la lista
// completa (de ella sale su color de paleta)
export function gruposPorEmpresa(projects) {
  const m = new Map()
  projects.forEach((p, i) => {
    const e = empresaDe(p)
    if (!m.has(e)) m.set(e, [])
    m.get(e).push({ p, i })
  })
  return [...m.entries()]
    .sort(([a], [b]) => (ORDEN_EMPRESA[a] ?? 9) - (ORDEN_EMPRESA[b] ?? 9) || a.localeCompare(b))
    .map(([empresa, items]) => ({ empresa, items }))
}

export function ProjectProvider({ children }) {
  const { profile, role, esJefe } = useAuth()
  const [projects, setProjects] = useState([])
  const [vuelta, setVuelta] = useState(0)   // se sube para volver a leer los proyectos
  const [pid, setPid] = useState(localStorage.getItem('urbis.pid') || 'general')

  useEffect(() => {
    if (!profile) return
    // facturación no lee tablas (sql/134): sus proyectos vienen en su propia pantalla
    if (role === 'facturacion') { setProjects([]); return }
    async function load() {
      let lista = []
      // administrador, superusuario y operador ven todos los proyectos
      if (esJefe) {
        const { data } = await supabase.from('projects').select('id, name, color').order('created_at')
        lista = data || []
      } else {
        const { data } = await supabase.from('project_assignments')
          .select('project:projects(id, name, color)').eq('user_id', profile.id)
        let list = (data || []).map(x => x.project).filter(Boolean)
        // sin asignaciones: ve todos (compatibilidad con el equipo de siempre)...
        // salvo el SOCIO: un socio sin proyectos asignados no ve NADA. Si heredara
        // "todos", un socio de un consorcio veria las cuentas de otro (sql/73).
        if (!list.length && role !== 'socio') {
          const { data: all } = await supabase.from('projects').select('id, name, color').order('created_at')
          list = all || []
        }
        lista = list
      }
      setProjects(lista)
      const marca = await marcaDe(lista.map(p => p.id))
      setProjects(lista.map(p => ({ ...p, ...marca[p.id] })))
    }
    load()
  }, [profile, role, vuelta])

  // los proyectos que suma la selección: todos ('general'), los de una empresa ('emp:CENTURY')
  // o el proyecto elegido
  const empresaSel = String(pid || '').startsWith(PID_EMPRESA) ? pid.slice(PID_EMPRESA.length) : null
  const esTotal = esPidTotal(pid)
  const idsSel = pid === 'general' ? projects.map(p => p.id)
    : empresaSel ? projects.filter(p => empresaDe(p) === empresaSel).map(p => p.id)
    : (pid ? [pid] : [])

  useEffect(() => {
    if (!projects.length) return
    // un proyecto que ya no está, o una empresa sin proyectos de este usuario
    if (!esTotal && !projects.some(p => p.id === pid)) select(projects[0]?.id || 'general')
    else if (empresaSel && !idsSel.length) select('general')
  }, [projects]) // eslint-disable-line

  function select(v) { setPid(v); localStorage.setItem('urbis.pid', v) }
  const current = projects.find(p => p.id === pid) || null
  // proyecto efectivo para paginas operativas (nunca un total): con "Todo Century", el
  // primero de Century
  const pidOp = !esTotal ? pid : (idsSel[0] || projects[0]?.id || null)
  // color del proyecto por id, respetando su posicion en la paleta
  const colorDe = id => {
    const i = projects.findIndex(p => p.id === id)
    return i < 0 ? null : colorProyecto(projects[i], i)
  }

  const recargarProyectos = () => setVuelta(v => v + 1)

  return <Ctx.Provider value={{ projects, pid, pidOp, select, current, colorDe, recargarProyectos, esTotal, idsSel, empresaSel }}>{children}</Ctx.Provider>
}

export const useProject = () => useContext(Ctx)

// Selector de proyecto: desplegable propio (no <select> nativo) para poder
// pintar cada proyecto con su color. El nativo no deja dar estilo a <option>.
export function ProjectPicker({ withGeneral = false, generalLabel = 'GENERAL (todos)' }) {
  const { projects, pid, pidOp, select } = useProject()
  const [open, setOpen] = useState(false)
  const caja = useRef(null)

  // cerrar al hacer click fuera o con Escape
  useEffect(() => {
    if (!open) return
    const fuera = e => { if (caja.current && !caja.current.contains(e.target)) setOpen(false) }
    const esc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc) }
  }, [open])

  if (!projects.length) return null

  const valor = withGeneral ? pid : (!esPidTotal(pid) ? pid : pidOp || '')
  const idx = projects.findIndex(p => p.id === valor)
  const sel = idx >= 0 ? projects[idx] : null
  const colorSel = sel ? colorProyecto(sel, idx) : '#9aa896'
  const empTotal = String(valor || '').startsWith(PID_EMPRESA) ? valor.slice(PID_EMPRESA.length) : null
  const etiqueta = sel ? sel.name : empTotal ? 'TODO ' + empTotal : (withGeneral ? generalLabel : '- elegir -')
  // separados por empresa (CENTURY / URBIS) solo si hay más de una
  const grupos = gruposPorEmpresa(projects)
  const conGrupos = grupos.length > 1

  const elegir = v => { select(v); setOpen(false) }
  const itemTotal = (v, texto) => (
    <button type="button" key={v} className={`pp-item ${valor === v ? 'on' : ''}`} style={{ '--pc': '#9aa896' }}
      onClick={() => elegir(v)}>
      <span className="pp-dot" /> <span className="pp-label">{texto}</span>
      {valor === v && <span className="pp-check">&#10003;</span>}
    </button>
  )
  const itemProy = ({ p, i }) => (
    <button type="button" key={p.id} className={`pp-item ${p.id === valor ? 'on' : ''}`}
      style={{ '--pc': colorProyecto(p, i) }} onClick={() => elegir(p.id)}>
      <span className="pp-dot" /> <span className="pp-label">{p.name}</span>
      {p.id === valor && <span className="pp-check">&#10003;</span>}
    </button>
  )

  return (
    <div className="pp" ref={caja}>
      <button type="button" className={`pp-trigger ${open ? 'open' : ''}`} style={{ '--pc': colorSel }}
        onClick={() => setOpen(o => !o)} title="Cambiar de proyecto">
        <span className="pp-dot" />
        <span className="pp-label">{etiqueta}</span>
        <span className={`pp-caret ${open ? 'open' : ''}`}>&#9662;</span>
      </button>
      {open && (
        <div className="pp-menu glass">
          {withGeneral && itemTotal('general', generalLabel)}
          {conGrupos
            ? grupos.map(g => (
              <div key={g.empresa} className="pp-grupo">
                <div className="pp-empresa">{g.empresa}</div>
                {/* "Todo Century": solo con dos o más proyectos (con uno es el mismo proyecto) */}
                {withGeneral && g.items.length > 1 && itemTotal(PID_EMPRESA + g.empresa, 'TODO ' + g.empresa)}
                {g.items.map(itemProy)}
              </div>
            ))
            : projects.map((p, i) => itemProy({ p, i }))}
        </div>
      )}
    </div>
  )
}
