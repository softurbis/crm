import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { savedFx } from '../lib/saveFx'
import { avisar, confirmar, pedirDatos } from '../lib/dialogos'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'

// LISTA DE ESPERA DE UNA PREVENTA (28 nov 2026, pedido de gerencia C5, sql/251): quién espera
// el lanzamiento de un proyecto, qué lote le interesa y qué bono se le ofreció a cada uno,
// para no perder a nadie y cumplir lo que se prometió cuando salga la venta.
const ESTADOS = [['esperando', '⏳ Esperando', '#e0b34c'], ['contactado', '📞 Contactado', '#7ba7f7'], ['compro', '✅ Compró', '#6fdd9b'], ['retirado', '✖ Se retiró', '#9daab6']]
const EST = Object.fromEntries(ESTADOS.map(([v, t, c]) => [v, { t, c }]))
const soles = n => n == null || n === '' ? '' : 'S/ ' + Number(n).toLocaleString('es-PE')
const cel = s => { const d = String(s || '').replace(/\D/g, ''); return d.length === 11 && d.startsWith('51') ? d.slice(2) : d }

export default function ListaEspera() {
  const { pidOp } = useProject()
  const { role } = useAuth()
  const [filas, setFilas] = useState(null)
  const [fEst, setFEst] = useState('abiertos')
  const puedeEditar = ['superuser', 'admin', 'operador', 'secretary', 'asesor'].includes(role)

  const cargar = async () => {
    if (!pidOp) return
    const { data, error } = await supabase.from('lista_espera').select('*').eq('project_id', pidOp).order('created_at')
    if (error) { avisar('No se pudo cargar: ' + error.message, { tono: 'error' }); setFilas([]); return }
    setFilas(data || [])
  }
  useEffect(() => { cargar() }, [pidOp])

  const campos = (f = {}) => [
    { clave: 'nombre', etiqueta: 'Nombre', obligatorio: true, valor: f.nombre || '' },
    { clave: 'telefono', etiqueta: 'Celular', valor: cel(f.telefono), placeholder: '9XXXXXXXX' },
    { clave: 'dni', etiqueta: 'DNI (opcional)', valor: f.dni || '' },
    { clave: 'lote', etiqueta: 'Lote o zona que le interesa', valor: f.lote_interes || '' },
    { clave: 'bono', etiqueta: 'Bono que se le ofreció', valor: f.bono_ofrecido || '', placeholder: 'Precio de preventa, S/ 1,000 menos en la inicial…' },
    { clave: 'monto', etiqueta: 'Monto del bono (S/, opcional)', tipo: 'monto', valor: f.bono_monto ?? '' },
    { clave: 'notas', etiqueta: 'Notas', tipo: 'largo', valor: f.notas || '' },
  ]
  const fila = d => {
    let t = String(d.telefono || '').replace(/\D/g, ''); if (t.length === 9) t = '51' + t
    return {
      nombre: String(d.nombre).trim().toUpperCase(), telefono: t || null, dni: String(d.dni || '').trim() || null,
      lote_interes: String(d.lote || '').trim().toUpperCase() || null, bono_ofrecido: String(d.bono || '').trim().toUpperCase() || null,
      bono_monto: d.monto === '' || d.monto == null ? null : Number(d.monto), notas: String(d.notas || '').trim() || null,
    }
  }
  async function agregar() {
    const d = await pedirDatos({ titulo: '📝 A LA LISTA DE ESPERA', aceptar: 'Agregar', campos: campos() })
    if (!d) return
    const { error } = await supabase.from('lista_espera').insert({ project_id: pidOp, ...fila(d) })
    if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return }
    savedFx(); cargar()
  }
  async function editar(f) {
    const d = await pedirDatos({ titulo: '✎ ' + f.nombre, aceptar: 'Guardar', campos: campos(f) })
    if (!d) return
    const { error } = await supabase.from('lista_espera').update(fila(d)).eq('id', f.id)
    if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return }
    savedFx(); cargar()
  }
  async function estado(f, e) {
    const { error } = await supabase.from('lista_espera').update({ estado: e }).eq('id', f.id)
    if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return }
    savedFx(); cargar()
  }
  async function quitar(f) {
    if (!await confirmar('¿Quitar a ' + f.nombre + ' de la lista?', { peligro: true, aceptar: 'Sí, quitar' })) return
    await supabase.from('lista_espera').delete().eq('id', f.id); cargar()
  }

  const vis = (filas || []).filter(f => fEst === 'todos' || (fEst === 'abiertos' ? ['esperando', 'contactado'].includes(f.estado) : f.estado === fEst))
  const cuenta = e => (filas || []).filter(f => f.estado === e).length

  return (
    <div>
      <div className="page-head u-d-f u-jc-sb u-ai-c u-fwr u-g-10">
        <h1>Lista de espera</h1>
        <div className="u-d-f u-g-8 u-ai-c u-fwr">
          <ProjectPicker />
          {puedeEditar && pidOp && <button className="btn-primary" onClick={agregar}>＋ Agregar persona</button>}
        </div>
      </div>
      <p className="muted u-fs-12">Quién espera la preventa, qué le interesa y el bono que se le ofreció: cuando salga la venta, se le cumple lo prometido.</p>
      <div className="u-d-f u-g-6 u-fwr u-mb-10">
        {[['abiertos', 'Por atender · ' + (cuenta('esperando') + cuenta('contactado'))], ...ESTADOS.map(([v, t]) => [v, t + ' · ' + cuenta(v)]), ['todos', 'Todos']].map(([v, t]) => (
          <button key={v} className={'chip' + (fEst === v ? ' on' : '')} onClick={() => setFEst(v)}>{t}</button>
        ))}
      </div>
      {!pidOp ? <p className="muted">Elige un proyecto.</p> : filas === null ? <p className="muted">Cargando…</p> : !vis.length ? <div className="glass u-p-12"><p className="muted u-m0">Nadie en esta lista.</p></div> : (
        <div className="glass table-wrap">
          <table>
            <thead><tr><th>#</th><th>Nombre</th><th>Celular</th><th>Le interesa</th><th>Bono ofrecido</th><th>Estado</th><th>Desde</th><th></th></tr></thead>
            <tbody>
              {vis.map((f, i) => (
                <tr key={f.id}>
                  <td className="muted">{i + 1}</td>
                  <td><b>{f.nombre}</b>{f.dni ? <div className="muted small">DNI {f.dni}</div> : null}{f.notas ? <div className="muted small u-tt-n">{f.notas}</div> : null}</td>
                  <td className="u-nw">{f.telefono ? <a href={'https://wa.me/' + f.telefono} target="_blank" rel="noreferrer">{cel(f.telefono)}</a> : '—'}</td>
                  <td>{f.lote_interes || '—'}</td>
                  <td>{f.bono_ofrecido || '—'}{f.bono_monto != null ? <div className="muted small">{soles(f.bono_monto)}</div> : null}</td>
                  <td>
                    {puedeEditar
                      ? <select value={f.estado} onChange={e => estado(f, e.target.value)} style={{ color: EST[f.estado]?.c }}>{ESTADOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
                      : <span style={{ color: EST[f.estado]?.c }}>{EST[f.estado]?.t}</span>}
                  </td>
                  <td className="u-nw muted small">{new Date(f.created_at).toLocaleDateString('es-PE', { timeZone: 'America/Lima' })}</td>
                  <td className="u-nw">{puedeEditar && <><button className="link-btn" onClick={() => editar(f)}>✎</button> <button className="link-btn muted" onClick={() => quitar(f)}>✕</button></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
