import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const Ctx = createContext(null)

// Paleta por defecto: si un proyecto no tiene color elegido, toma uno por su orden.
// Asi nunca se ve gris aunque no lo hayan configurado todavia.
export const PALETA_PROYECTOS = [
  '#8fd16f', '#7bb6e0', '#e8b04f', '#c58ae0',
  '#6fd1c0', '#f2785c', '#e8a0c8', '#56c7d6',
]
export const colorProyecto = (p, i = 0) => p?.color || PALETA_PROYECTOS[i % PALETA_PROYECTOS.length]

export function ProjectProvider({ children }) {
  const { profile, role } = useAuth()
  const [projects, setProjects] = useState([])
  const [pid, setPid] = useState(localStorage.getItem('urbis.pid') || 'general')

  useEffect(() => {
    if (!profile) return
    async function load() {
      if (role === 'admin' || role === 'superuser') {
        const { data } = await supabase.from('projects').select('id, name, color').order('created_at')
        setProjects(data || [])
      } else {
        const { data } = await supabase.from('project_assignments')
          .select('project:projects(id, name, color)').eq('user_id', profile.id)
        let list = (data || []).map(x => x.project).filter(Boolean)
        if (!list.length) { // sin asignaciones: ve todos (compatibilidad)
          const { data: all } = await supabase.from('projects').select('id, name, color').order('created_at')
          list = all || []
        }
        setProjects(list)
      }
    }
    load()
  }, [profile, role])

  useEffect(() => {
    if (pid !== 'general' && projects.length && !projects.some(p => p.id === pid)) {
      select(projects[0]?.id || 'general')
    }
  }, [projects]) // eslint-disable-line

  function select(v) { setPid(v); localStorage.setItem('urbis.pid', v) }
  const current = projects.find(p => p.id === pid) || null
  // proyecto efectivo para paginas operativas (nunca 'general')
  const pidOp = pid !== 'general' ? pid : (projects[0]?.id || null)
  // color del proyecto por id, respetando su posicion en la paleta
  const colorDe = id => {
    const i = projects.findIndex(p => p.id === id)
    return i < 0 ? null : colorProyecto(projects[i], i)
  }

  return <Ctx.Provider value={{ projects, pid, pidOp, select, current, colorDe }}>{children}</Ctx.Provider>
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

  const valor = withGeneral ? pid : (pid !== 'general' ? pid : pidOp || '')
  const idx = projects.findIndex(p => p.id === valor)
  const sel = idx >= 0 ? projects[idx] : null
  const colorSel = sel ? colorProyecto(sel, idx) : '#9aa896'
  const etiqueta = sel ? sel.name : (withGeneral ? generalLabel : '- elegir -')

  const elegir = v => { select(v); setOpen(false) }

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
          {withGeneral && (
            <button type="button" className={`pp-item ${pid === 'general' ? 'on' : ''}`} style={{ '--pc': '#9aa896' }}
              onClick={() => elegir('general')}>
              <span className="pp-dot" /> <span className="pp-label">{generalLabel}</span>
            </button>
          )}
          {projects.map((p, i) => (
            <button type="button" key={p.id} className={`pp-item ${p.id === valor ? 'on' : ''}`}
              style={{ '--pc': colorProyecto(p, i) }} onClick={() => elegir(p.id)}>
              <span className="pp-dot" /> <span className="pp-label">{p.name}</span>
              {p.id === valor && <span className="pp-check">&#10003;</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
