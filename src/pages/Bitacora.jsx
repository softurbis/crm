import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Bitacora() {
  const { role } = useAuth()
  const [rows, setRows] = useState([])
  const [fq, setFq] = useState('')
  const [fact, setFact] = useState('todos')
  const [ftab, setFtab] = useState('todos')
  const [det, setDet] = useState(null)

  useEffect(() => {
    if (role !== 'admin') return
    supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(400)
      .then(({ data }) => setRows(data || []))
  }, [role])

  const tablas = useMemo(() => [...new Set(rows.map(r => r.entity_type))].sort(), [rows])
  const filtradas = useMemo(() => {
    const t = fq.trim().toLowerCase()
    return rows.filter(r => {
      if (fact !== 'todos' && r.action !== fact) return false
      if (ftab !== 'todos' && r.entity_type !== ftab) return false
      if (!t) return true
      return (r.user_email || '').toLowerCase().includes(t) ||
        (r.entity_id || '').toLowerCase().includes(t) ||
        JSON.stringify(r.details || {}).toLowerCase().includes(t)
    })
  }, [rows, fq, fact, ftab])

  if (role !== 'admin') return <p className="error">Solo el administrador puede ver la bitacora.</p>

  return (
    <>
      <h1>Bitacora de actividades</h1>
      <p className="muted small">Registro inalterable de todo lo que se hace en el sistema. Solo lectura.</p>

      <div className="toolbar">
        <input className="search" placeholder="Buscar por usuario, id o contenido..."
          value={fq} onChange={e => setFq(e.target.value)} />
        <select value={fact} onChange={e => setFact(e.target.value)}>
          <option value="todos">TODAS LAS ACCIONES</option>
          <option value="INSERT">CREACION</option>
          <option value="UPDATE">MODIFICACION</option>
          <option value="DELETE">ELIMINACION</option>
        </select>
        <select value={ftab} onChange={e => setFtab(e.target.value)}>
          <option value="todos">TODAS LAS TABLAS</option>
          {tablas.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Accion</th><th>Tabla</th><th></th></tr></thead>
          <tbody>
            {filtradas.slice(0, 200).map(r => (
              <tr key={r.id}>
                <td>{new Date(r.created_at).toLocaleString('es-PE')}</td>
                <td>{r.user_email || 'SISTEMA'}</td>
                <td className={r.action === 'DELETE' ? 'bad' : r.action === 'UPDATE' ? 'warn' : 'ok'}>{r.action}</td>
                <td>{r.entity_type}</td>
                <td><button className="link-btn" onClick={() => setDet(r)}>detalle</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {det && (
        <div className="modal-bg" onClick={() => setDet(null)}>
          <div className="glass modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{det.action} en {det.entity_type}</h2>
              <button className="btn-ghost" onClick={() => setDet(null)}>&#10005;</button>
            </div>
            <p className="muted small">{new Date(det.created_at).toLocaleString('es-PE')} | {det.user_email || 'SISTEMA'}</p>
            <pre className="json-box">{JSON.stringify(det.details, null, 2)}</pre>
          </div>
        </div>
      )}
    </>
  )
}
