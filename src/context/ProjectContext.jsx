import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const Ctx = createContext(null)

export function ProjectProvider({ children }) {
  const { profile, role } = useAuth()
  const [projects, setProjects] = useState([])
  const [pid, setPid] = useState(localStorage.getItem('urbis.pid') || 'general')

  useEffect(() => {
    if (!profile) return
    async function load() {
      if (role === 'admin') {
        const { data } = await supabase.from('projects').select('id, name').order('created_at')
        setProjects(data || [])
      } else {
        const { data } = await supabase.from('project_assignments')
          .select('project:projects(id, name)').eq('user_id', profile.id)
        let list = (data || []).map(x => x.project).filter(Boolean)
        if (!list.length) { // sin asignaciones: ve todos (compatibilidad)
          const { data: all } = await supabase.from('projects').select('id, name').order('created_at')
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

  return <Ctx.Provider value={{ projects, pid, pidOp, select, current }}>{children}</Ctx.Provider>
}

export const useProject = () => useContext(Ctx)

// selector reutilizable
export function ProjectPicker({ withGeneral = false, generalLabel = 'GENERAL (todos)' }) {
  const { projects, pid, pidOp, select } = useProject()
  const value = withGeneral ? pid : (pid !== 'general' ? pid : pidOp || '')
  if (!projects.length) return null
  return (
    <select className="project-picker" value={value || ''} onChange={e => select(e.target.value)}>
      {withGeneral && <option value="general">{generalLabel}</option>}
      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  )
}
