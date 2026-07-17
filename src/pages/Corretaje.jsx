import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const TIPOS = [
  ['terreno_urbano', 'Terreno urbano'], ['terreno_rural', 'Terreno rural (ha)'], ['lote', 'Lote'],
  ['casa', 'Casa'], ['departamento', 'Departamento'], ['local', 'Local comercial'], ['oficina', 'Oficina'],
  ['edificio', 'Edificio / multifamiliar'], ['almacen', 'Almacén / industrial'],
  ['estacionamiento', 'Estacionamiento'], ['aires', 'Aires (azotea)'], ['otro', 'Otro'],
]
const ESTADOS = [['disponible', 'Disponible'], ['reservado', 'Reservado'], ['vendido', 'Vendido']]
const MONEDAS = [['USD', 'US$'], ['PEN', 'S/']]
const nombreTipo = t => (TIPOS.find(x => x[0] === t) || [, t])[1]
const simbolo = m => (m === 'PEN' ? 'S/' : 'US$')

async function subir(file, carpeta) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  const path = `corretaje/${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('urbis-files').upload(path, file, { upsert: true })
  if (error) throw new Error(error.message)
  return supabase.storage.from('urbis-files').getPublicUrl(path).data.publicUrl
}

const diasPara = fecha => fecha ? Math.ceil((new Date(fecha) - new Date()) / 86400000) : null

export default function Corretaje() {
  const { role } = useAuth()
  const puede = ['superuser', 'admin'].includes(role)
  const [lista, setLista] = useState([])
  const [sel, setSel] = useState(null)          // propiedad en edición (o null = lista)
  const [msg, setMsg] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [fotos, setFotos] = useState([])
  const [gastos, setGastos] = useState([])
  const [docs, setDocs] = useState([])
  const [plantilla, setPlantilla] = useState('')
  const [vista, setVista] = useState('propiedades')
  const [projs, setProjs] = useState([])
  const [consultas, setConsultas] = useState([])
  const [nombresProp, setNombresProp] = useState({})
  const [nombresProy, setNombresProy] = useState({})

  // link de la página pública (fuera del login) para compartir
  const LINK_PUBLICO = window.location.origin + import.meta.env.BASE_URL + 'propiedades'
  const copiarLinkPublico = async () => {
    try { await navigator.clipboard.writeText(LINK_PUBLICO); alert('✅ Link público copiado:\n\n' + LINK_PUBLICO + '\n\nPégalo en WhatsApp, redes o donde quieras.') }
    catch { window.prompt('Copia este link público:', LINK_PUBLICO) }
  }

  const cargarLista = async () => {
    const { data } = await supabase.from('corr_propiedades')
      .select('id, codigo, tipo, titulo, estado, precio, moneda, publicado, zona, copia_literal_vence, cri_vence, excl_fin')
      .order('updated_at', { ascending: false })
    const props = data || []
    // foto de portada = la primera (orden asc) de cada propiedad, para la tarjeta
    const ids = props.map(p => p.id)
    const portadas = {}
    if (ids.length) {
      const { data: fs } = await supabase.from('corr_fotos').select('propiedad_id, url, orden').in('propiedad_id', ids).order('orden')
      for (const f of (fs || [])) if (!(f.propiedad_id in portadas)) portadas[f.propiedad_id] = f.url
    }
    setLista(props.map(p => ({ ...p, portada: portadas[p.id] || null })))
  }

  useEffect(() => { cargarLista() }, [])
  useEffect(() => {
    supabase.from('corr_config').select('content').eq('key', 'contrato_exclusividad').maybeSingle()
      .then(({ data }) => setPlantilla(data?.content || ''))
  }, [])

  useEffect(() => {
    Promise.all([
      supabase.from('projects').select('id, name, photo_url').order('name'),
      supabase.from('corr_proyectos_pub').select('*'),
    ]).then(([pr, cp]) => {
      const m = {}; (cp.data || []).forEach(x => { m[x.project_id] = x })
      setProjs((pr.data || []).map(p => ({ ...p, pub: m[p.id] || { publicado: false, cuota_desde: '', pdf_url: '', foto_url: '', orden: 0 } })))
    })
    recargarConsultas()
  }, [])

  // cargar sub-tablas al abrir una propiedad
  useEffect(() => {
    if (!sel?.id) { setFotos([]); setGastos([]); setDocs([]); return }
    supabase.from('corr_fotos').select('*').eq('propiedad_id', sel.id).order('orden').then(({ data }) => setFotos(data || []))
    supabase.from('corr_gastos').select('*').eq('propiedad_id', sel.id).order('fecha', { ascending: false }).then(({ data }) => setGastos(data || []))
    supabase.from('corr_documentos').select('*').eq('propiedad_id', sel.id).order('created_at').then(({ data }) => setDocs(data || []))
  }, [sel?.id])

  const set = (campo, valor) => setSel(s => ({ ...s, [campo]: valor }))

  const nuevo = () => setSel({ tipo: 'terreno_urbano', estado: 'disponible', moneda: 'USD', area_unidad: 'm2', tenencia: 'titulo', comision_tipo: 'porcentaje', publicado: false })

  const guardar = async () => {
    setMsg('Guardando…')
    const p = { ...sel }
    ;['precio', 'comision_valor', 'area', 'dormitorios', 'banos', 'frente', 'fondo', 'lat', 'lng'].forEach(k => {
      p[k] = p[k] === '' || p[k] == null ? null : Number(p[k])
    })
    p.updated_at = new Date().toISOString()
    let error, id = sel.id
    if (id) { ({ error } = await supabase.from('corr_propiedades').update(p).eq('id', id)) }
    else { const r = await supabase.from('corr_propiedades').insert(p).select('id').single(); error = r.error; id = r.data?.id }
    if (error) { setMsg('ERROR: ' + error.message); return }
    setMsg('✅ Guardado')
    if (!sel.id && id) setSel(s => ({ ...s, id }))
    cargarLista()
  }

  const borrar = async prop => {
    if (!window.confirm('¿Eliminar esta propiedad y sus fotos/gastos/documentos?')) return
    await supabase.from('corr_propiedades').delete().eq('id', prop.id)
    if (sel?.id === prop.id) setSel(null)
    cargarLista()
  }

  const togglePublicado = async prop => {
    await supabase.from('corr_propiedades').update({ publicado: !prop.publicado }).eq('id', prop.id)
    cargarLista(); if (sel?.id === prop.id) set('publicado', !prop.publicado)
  }

  // fotos
  const subirFotos = async e => {
    if (!sel?.id) { alert('Guarda primero la propiedad para subir fotos.'); return }
    setSubiendo(true)
    try {
      for (const file of Array.from(e.target.files || [])) {
        const url = await subir(file, sel.id)
        await supabase.from('corr_fotos').insert({ propiedad_id: sel.id, url, orden: fotos.length })
      }
      const { data } = await supabase.from('corr_fotos').select('*').eq('propiedad_id', sel.id).order('orden')
      setFotos(data || [])
    } catch (err) { alert('No se pudo subir: ' + err.message) }
    setSubiendo(false)
  }
  const borrarFoto = async id => { await supabase.from('corr_fotos').delete().eq('id', id); setFotos(f => f.filter(x => x.id !== id)) }

  // gastos
  const addGasto = async () => {
    if (!sel?.id) { alert('Guarda primero la propiedad.'); return }
    await supabase.from('corr_gastos').insert({ propiedad_id: sel.id, categoria: '', monto: 0, moneda: 'PEN' })
    const { data } = await supabase.from('corr_gastos').select('*').eq('propiedad_id', sel.id).order('fecha', { ascending: false }); setGastos(data || [])
  }
  const setGasto = (id, patch) => setGastos(gs => gs.map(g => g.id === id ? { ...g, ...patch } : g))
  const guardarGasto = async g => { await supabase.from('corr_gastos').update({ categoria: g.categoria, monto: Number(g.monto) || 0, moneda: g.moneda, fecha: g.fecha, descripcion: g.descripcion }).eq('id', g.id) }
  const borrarGasto = async id => { await supabase.from('corr_gastos').delete().eq('id', id); setGastos(gs => gs.filter(g => g.id !== id)) }

  // documentos
  const subirDoc = async e => {
    if (!sel?.id) { alert('Guarda primero la propiedad.'); return }
    setSubiendo(true)
    try {
      const file = e.target.files?.[0]; if (!file) return
      const url = await subir(file, sel.id + '/docs')
      await supabase.from('corr_documentos').insert({ propiedad_id: sel.id, nombre: file.name, url, tipo: 'documento' })
      const { data } = await supabase.from('corr_documentos').select('*').eq('propiedad_id', sel.id).order('created_at'); setDocs(data || [])
    } catch (err) { alert('No se pudo subir: ' + err.message) }
    setSubiendo(false)
  }
  const borrarDoc = async id => { await supabase.from('corr_documentos').delete().eq('id', id); setDocs(d => d.filter(x => x.id !== id)) }

  // --- proyectos públicos / consultas / contrato ---
  const recargarConsultas = async () => {
    const { data } = await supabase.from('corr_consultas').select('*').order('created_at', { ascending: false })
    setConsultas(data || [])
    const propIds = [...new Set((data || []).filter(c => c.propiedad_id).map(c => c.propiedad_id))]
    const proyIds = [...new Set((data || []).filter(c => c.project_id).map(c => c.project_id))]
    if (propIds.length) { const { data: pp } = await supabase.from('corr_propiedades').select('id, titulo').in('id', propIds); const m = {}; (pp || []).forEach(x => { m[x.id] = x.titulo }); setNombresProp(m) }
    if (proyIds.length) { const { data: pj } = await supabase.from('projects').select('id, name').in('id', proyIds); const m = {}; (pj || []).forEach(x => { m[x.id] = x.name }); setNombresProy(m) }
  }
  const toggleAtendido = async c => { await supabase.from('corr_consultas').update({ atendido: !c.atendido }).eq('id', c.id); setConsultas(cs => cs.map(x => x.id === c.id ? { ...x, atendido: !c.atendido } : x)) }
  const setProjPub = (id, patch) => setProjs(ps => ps.map(p => p.id === id ? { ...p, pub: { ...p.pub, ...patch } } : p))
  const guardarProy = async id => {
    const p = projs.find(x => x.id === id); if (!p) return
    const { error } = await supabase.from('corr_proyectos_pub').upsert({ project_id: id, publicado: !!p.pub.publicado, cuota_desde: p.pub.cuota_desde || null, pdf_url: p.pub.pdf_url || null, foto_url: p.pub.foto_url || null, orden: Number(p.pub.orden) || 0, updated_at: new Date().toISOString() })
    setMsg(error ? 'ERROR: ' + error.message : '✅ Proyecto guardado')
  }
  const subirProy = async (id, campo, e) => {
    const file = e.target.files?.[0]; if (!file) return
    setSubiendo(true)
    try { const url = await subir(file, 'proyectos/' + id); setProjPub(id, { [campo]: url }); await supabase.from('corr_proyectos_pub').upsert({ project_id: id, [campo]: url }) }
    catch (err) { alert('No se pudo subir: ' + err.message) }
    setSubiendo(false)
  }
  const guardarContrato = async () => {
    setMsg('Guardando…')
    const { error } = await supabase.from('corr_config').update({ content: plantilla, updated_at: new Date().toISOString() }).eq('key', 'contrato_exclusividad')
    setMsg(error ? 'ERROR: ' + error.message : '✅ Plantilla guardada')
  }

  const generarContrato = () => {
    const vars = {
      propietario: sel.propietario || '____', propietario_dni: sel.propietario_dni || '____',
      titulo: sel.titulo || '____', direccion: sel.direccion || '____',
      area: sel.area || '____', area_unidad: sel.area_unidad || 'm2', partida: sel.partida || '____',
      excl_inicio: sel.excl_inicio || '____', excl_fin: sel.excl_fin || '____',
      moneda: simbolo(sel.moneda), precio: sel.precio || '____',
      comision_valor: sel.comision_valor != null ? sel.comision_valor + (sel.comision_tipo === 'porcentaje' ? '%' : '') : '____',
      comision_tipo: sel.comision_tipo === 'porcentaje' ? 'porcentaje' : 'monto fijo',
    }
    let txt = plantilla
    Object.entries(vars).forEach(([k, v]) => { txt = txt.split('{' + k + '}').join(String(v)) })
    set('excl_contrato', txt)
  }

  if (!puede) return <div className="page"><p className="muted">Solo administradores.</p></div>

  // --- alertas de vencimiento (lista) ---
  const alertas = lista.flatMap(p => {
    const a = []
    ;[['copia_literal_vence', 'copia literal'], ['cri_vence', 'CRI'], ['excl_fin', 'exclusividad']].forEach(([campo, etq]) => {
      const d = diasPara(p[campo]); if (d != null && d <= 15) a.push({ p, etq, d })
    })
    return a
  }).sort((x, y) => x.d - y.d)

  // ---------------- LISTA ----------------
  if (!sel) return (
    <div className="page">
      <div className="page-head" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>🏠 Corretaje</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['propiedades', 'Propiedades'], ['proyectos', 'Proyectos'], ['consultas', 'Consultas'], ['contrato', 'Contrato']].map(([v, t]) => (
            <button key={v} className={vista === v ? 'btn' : 'btn-ghost'} onClick={() => setVista(v)}>{t}</button>
          ))}
        </div>
        <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={copiarLinkPublico} title="Copia el link de la página pública para compartir por WhatsApp, redes, etc.">🔗 Link público</button>
        <a className="btn-ghost" href={LINK_PUBLICO} target="_blank" rel="noreferrer" title="Ver la página pública">👁️ Ver</a>
        {vista === 'propiedades' && <button className="btn" onClick={nuevo}>➕ Nueva propiedad</button>}
      </div>

      {vista === 'propiedades' && (<>
      {alertas.length > 0 && (
        <div className="glass" style={{ padding: 10, marginBottom: 10, border: '1px solid rgba(240,160,160,.4)' }}>
          <b style={{ color: '#f0a0a0', fontSize: 13 }}>⏰ Vencimientos próximos</b>
          {alertas.map((a, i) => (
            <div key={i} style={{ fontSize: 12.5, marginTop: 3 }}>
              <a onClick={() => setSel(lista.find(x => x.id === a.p.id))} style={{ cursor: 'pointer', color: '#7ec8e3' }}>{a.p.titulo || nombreTipo(a.p.tipo)}</a>
              {' — '}{a.etq} vence en <b>{a.d} día{a.d === 1 ? '' : 's'}</b>{a.d < 0 ? ' (vencida)' : ''}
            </div>
          ))}
        </div>
      )}

      {!lista.length && <div className="glass" style={{ padding: 8 }}><p className="muted" style={{ padding: 10 }}>Aún no hay propiedades. Crea la primera con “➕ Nueva propiedad”.</p></div>}
      <div className="corr-cards">
        {lista.map(p => (
          <div key={p.id} className="corr-card">
            <div className="corr-card-img" onClick={() => setSel(p)} title="Editar">
              {p.portada
                ? <img src={p.portada} alt={p.titulo || ''} loading="lazy" />
                : <div className="corr-noimg"><span style={{ fontSize: 34 }}>🏠</span><span>sin foto</span></div>}
              <span className={`corr-estado est-${p.estado}`}>{ESTADOS.find(e => e[0] === p.estado)?.[1] || p.estado}</span>
              <span className={`corr-pub ${p.publicado ? 'on' : ''}`}>{p.publicado ? '🌐 Pública' : '🔒 Oculta'}</span>
            </div>
            <div className="corr-card-body">
              <b className="corr-titulo">{p.titulo || '(sin título)'}</b>
              <span className="muted corr-sub">{nombreTipo(p.tipo)}{p.zona ? ' · ' + p.zona : ''}</span>
              <div className="corr-precio">{p.precio != null ? simbolo(p.moneda) + ' ' + Number(p.precio).toLocaleString('es-PE') : '—'}</div>
              <div className="corr-acc">
                <button className="btn-ghost" title={p.publicado ? 'Publicada (clic para ocultar)' : 'Oculta (clic para publicar)'} onClick={() => togglePublicado(p)}>{p.publicado ? '🌐' : '🔒'}</button>
                <button className="btn-ghost" onClick={() => setSel(p)}>✏️ Editar</button>
                <button className="btn-ghost" onClick={() => borrar(p)}>🗑️</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      </>)}

      {vista === 'proyectos' && (
        <div className="glass" style={{ padding: 12 }}>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Marca qué proyectos salen en el link público y su info. Los contadores (disponibles/vendidos/reservados) se calculan solos de tus lotes.</p>
          {!projs.length && <p className="muted" style={{ fontSize: 12 }}>No hay proyectos.</p>}
          {projs.map(pr => (
            <div key={pr.id} style={{ borderBottom: '1px solid rgba(255,255,255,.08)', padding: '10px 0' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                  <input type="checkbox" checked={!!pr.pub.publicado} onChange={e => setProjPub(pr.id, { publicado: e.target.checked })} /> {pr.name}
                </label>
                <input placeholder="Cuota desde (ej. S/ 300/mes)" value={pr.pub.cuota_desde || ''} onChange={e => setProjPub(pr.id, { cuota_desde: e.target.value })} style={{ flex: '1 1 170px', textTransform: 'none' }} />
                <input type="number" placeholder="orden" value={pr.pub.orden ?? ''} onChange={e => setProjPub(pr.id, { orden: e.target.value })} style={{ width: 64 }} />
                <button className="btn-ghost" onClick={() => guardarProy(pr.id)}>💾 Guardar</button>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6, flexWrap: 'wrap', fontSize: 12 }}>
                <label className="btn-ghost" style={{ cursor: 'pointer' }}>📄 PDF (plano/brochure)<input type="file" accept="application/pdf" onChange={e => subirProy(pr.id, 'pdf_url', e)} style={{ display: 'none' }} /></label>
                {pr.pub.pdf_url && <a href={pr.pub.pdf_url} target="_blank" rel="noreferrer" style={{ color: '#7ec8e3' }}>ver PDF</a>}
                <label className="btn-ghost" style={{ cursor: 'pointer' }}>🖼️ Foto de portada<input type="file" accept="image/*" onChange={e => subirProy(pr.id, 'foto_url', e)} style={{ display: 'none' }} /></label>
                {(pr.pub.foto_url || pr.photo_url) && <img src={pr.pub.foto_url || pr.photo_url} alt="" style={{ width: 60, height: 40, objectFit: 'cover', borderRadius: 4 }} />}
              </div>
            </div>
          ))}
          {subiendo && <span style={{ fontSize: 11 }}>subiendo…</span>}
        </div>
      )}

      {vista === 'consultas' && (
        <div className="glass" style={{ padding: 12 }}>
          {!consultas.length && <p className="muted" style={{ fontSize: 12 }}>Aún no hay consultas del formulario público.</p>}
          {consultas.map(c => (
            <div key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,.08)', padding: '8px 0', opacity: c.atendido ? .55 : 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <b style={{ fontSize: 13 }}>{c.nombre || '—'}</b>
                <a href={'https://wa.me/' + (c.telefono || '').replace(/\D/g, '')} target="_blank" rel="noreferrer" style={{ color: '#6fdd9b', fontSize: 13 }}>📱 {c.telefono}</a>
                <span className="muted" style={{ fontSize: 12 }}>{c.tipo === 'proyecto' ? 'Proyecto: ' + (nombresProy[c.project_id] || '—') : 'Propiedad: ' + (nombresProp[c.propiedad_id] || '—')}</span>
                <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>{new Date(c.created_at).toLocaleString('es-PE')}</span>
                <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={!!c.atendido} onChange={() => toggleAtendido(c)} /> atendido</label>
              </div>
              {c.mensaje && <div style={{ fontSize: 13, marginTop: 3 }} className="muted">{c.mensaje}</div>}
            </div>
          ))}
        </div>
      )}

      {vista === 'contrato' && (
        <div className="glass" style={{ padding: 12 }}>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Plantilla del contrato de exclusividad. Variables (se reemplazan al generar el contrato en cada propiedad): {'{propietario} {propietario_dni} {titulo} {direccion} {area} {area_unidad} {partida} {excl_inicio} {excl_fin} {moneda} {precio} {comision_valor} {comision_tipo}'}.</p>
          <textarea value={plantilla} onChange={e => setPlantilla(e.target.value)} style={{ width: '100%', minHeight: 'calc(100vh - 300px)', textTransform: 'none', fontSize: 12.5, fontFamily: 'monospace', lineHeight: 1.5 }} />
          <div style={{ marginTop: 8 }}><button className="btn" onClick={guardarContrato}>💾 Guardar plantilla</button>{msg && <span style={{ fontSize: 12, marginLeft: 8 }}>{msg}</span>}</div>
        </div>
      )}
    </div>
  )

  // ---------------- EDITOR ----------------
  const totalGastos = gastos.reduce((s, g) => s + (Number(g.monto) || 0), 0)
  const inp = (campo, extra = {}) => <input value={sel[campo] ?? ''} onChange={e => set(campo, e.target.value)} style={{ textTransform: 'none' }} {...extra} />

  return (
    <div className="page">
      <div className="page-head" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn-ghost" onClick={() => { setSel(null); cargarLista() }}>← Volver</button>
        <h1 style={{ margin: 0, fontSize: 20 }}>{sel.id ? 'Editar propiedad' : 'Nueva propiedad'}</h1>
        <label style={{ marginLeft: 'auto', fontSize: 12, display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!sel.publicado} onChange={e => set('publicado', e.target.checked)} /> 🌐 Publicada en el link público
        </label>
        <button className="btn" onClick={guardar}>💾 Guardar</button>
        {msg && <span style={{ fontSize: 12 }}>{msg}</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Seccion titulo="🏷️ Comercial (público)">
          <Campo label="Título comercial"><input value={sel.titulo ?? ''} onChange={e => set('titulo', e.target.value)} placeholder="Casa 2 pisos en Yarinacocha" style={{ textTransform: 'none' }} /></Campo>
          <Campo label="Código">{inp('codigo')}</Campo>
          <Campo label="Tipo"><select value={sel.tipo} onChange={e => set('tipo', e.target.value)}>{TIPOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Campo>
          <Campo label="Estado"><select value={sel.estado} onChange={e => set('estado', e.target.value)}>{ESTADOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Campo>
          <Campo label="Precio">{inp('precio', { type: 'number' })}</Campo>
          <Campo label="Moneda"><select value={sel.moneda} onChange={e => set('moneda', e.target.value)}>{MONEDAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Campo>
          <Campo label="Cuota (referencial)">{inp('cuota_ref')}</Campo>
          <Campo label="Comisión">
            <div style={{ display: 'flex', gap: 4 }}>
              <select value={sel.comision_tipo} onChange={e => set('comision_tipo', e.target.value)}><option value="porcentaje">%</option><option value="fijo">Monto fijo</option></select>
              <input value={sel.comision_valor ?? ''} onChange={e => set('comision_valor', e.target.value)} type="number" style={{ width: 80 }} />
            </div>
          </Campo>
          <Campo label="WhatsApp que recibe el lead">{inp('whatsapp_lead', { placeholder: '51 + número' })}</Campo>
          <Campo label="Condiciones">{inp('condiciones')}</Campo>
        </Seccion>

        <Seccion titulo="📍 Ubicación">
          <Campo label="Dirección">{inp('direccion')}</Campo>
          <Campo label="Zona / urbanización">{inp('zona')}</Campo>
          <Campo label="Distrito">{inp('distrito')}</Campo>
          <Campo label="Provincia">{inp('provincia')}</Campo>
          <Campo label="Departamento">{inp('departamento')}</Campo>
          <Campo label="Referencias">{inp('referencias')}</Campo>
        </Seccion>

        <Seccion titulo="📐 Física">
          <Campo label="Área">{inp('area', { type: 'number' })}</Campo>
          <Campo label="Unidad"><select value={sel.area_unidad} onChange={e => set('area_unidad', e.target.value)}><option value="m2">m²</option><option value="ha">hectáreas</option></select></Campo>
          <Campo label="Dormitorios">{inp('dormitorios', { type: 'number' })}</Campo>
          <Campo label="Baños">{inp('banos', { type: 'number' })}</Campo>
          <Campo label="Frente (m)">{inp('frente', { type: 'number' })}</Campo>
          <Campo label="Fondo (m)">{inp('fondo', { type: 'number' })}</Campo>
        </Seccion>

        <Seccion titulo="⚖️ Legal (privado — nunca público)">
          <Campo label="Tenencia"><select value={sel.tenencia} onChange={e => set('tenencia', e.target.value)}><option value="titulo">Título inscrito</option><option value="posesion">Constancia de posesión</option></select></Campo>
          <Campo label="N° de partida (SUNARP)">{inp('partida')}</Campo>
          <Campo label="Titular registral">{inp('titular')}</Campo>
          <Campo label="DNI titular">{inp('titular_dni')}</Campo>
          <Campo label="Estado civil">{inp('titular_estado_civil')}</Campo>
          <Campo label="Cargas / gravámenes">{inp('cargas')}</Campo>
          <Campo label="Copia literal — fecha">{inp('copia_literal_fecha', { type: 'date' })}</Campo>
          <Campo label="Copia literal — vence">{inp('copia_literal_vence', { type: 'date' })}</Campo>
          <Campo label="CRI — fecha">{inp('cri_fecha', { type: 'date' })}</Campo>
          <Campo label="CRI — vence">{inp('cri_vence', { type: 'date' })}</Campo>
        </Seccion>

        <Seccion titulo="👤 Propietario (privado)">
          <Campo label="Nombre">{inp('propietario')}</Campo>
          <Campo label="DNI">{inp('propietario_dni')}</Campo>
          <Campo label="Contacto">{inp('propietario_contacto')}</Campo>
        </Seccion>

        <Seccion titulo="📝 Exclusividad">
          <Campo label="Inicio">{inp('excl_inicio', { type: 'date' })}</Campo>
          <Campo label="Fin (mín. 6 meses)">{inp('excl_fin', { type: 'date' })}</Campo>
          <div style={{ flexBasis: '100%', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-ghost" onClick={generarContrato}>📄 Generar contrato (desde plantilla)</button>
            <span className="muted" style={{ fontSize: 11 }}>Rellena los datos con la propiedad; puedes editarlo abajo. La plantilla se edita en Configuración.</span>
          </div>
          <textarea value={sel.excl_contrato ?? ''} onChange={e => set('excl_contrato', e.target.value)} placeholder="El contrato generado aparece aquí (editable)…" style={{ flexBasis: '100%', minHeight: 200, textTransform: 'none', fontSize: 12.5, fontFamily: 'monospace' }} />
        </Seccion>

        <Seccion titulo={`📷 Fotos (galería pública) — ${fotos.length}`}>
          <div style={{ flexBasis: '100%' }}>
            <label className="btn-ghost" style={{ cursor: 'pointer' }}>🖼️ Subir fotos<input type="file" accept="image/*" multiple onChange={subirFotos} style={{ display: 'none' }} /></label>
            {subiendo && <span style={{ fontSize: 11, marginLeft: 8 }}>subiendo…</span>}
            {!sel.id && <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>(guarda la propiedad primero)</span>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {fotos.map(f => (
                <div key={f.id} style={{ position: 'relative' }}>
                  <img src={f.url} alt="" style={{ width: 90, height: 68, objectFit: 'cover', borderRadius: 6, border: '1px solid rgba(255,255,255,.15)' }} />
                  <button className="btn-ghost" onClick={() => borrarFoto(f.id)} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,.5)', padding: '0 5px' }}>✕</button>
                </div>
              ))}
            </div>
          </div>
        </Seccion>

        <Seccion titulo={`🧾 Gastos (Urbis, para control) — total: S/ ${totalGastos.toLocaleString('es-PE')}`}>
          <div style={{ flexBasis: '100%' }}>
            {gastos.map(g => (
              <div key={g.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5, flexWrap: 'wrap' }}>
                <input value={g.categoria ?? ''} placeholder="categoría (ads, letreros, otros…)" onChange={e => setGasto(g.id, { categoria: e.target.value })} onBlur={() => guardarGasto(g)} style={{ flex: '1 1 150px', textTransform: 'none' }} />
                <input type="number" value={g.monto ?? ''} onChange={e => setGasto(g.id, { monto: e.target.value })} onBlur={() => guardarGasto(g)} style={{ width: 90 }} />
                <select value={g.moneda} onChange={e => { setGasto(g.id, { moneda: e.target.value }); }} onBlur={() => guardarGasto(g)}><option value="PEN">S/</option><option value="USD">US$</option></select>
                <input type="date" value={g.fecha ?? ''} onChange={e => setGasto(g.id, { fecha: e.target.value })} onBlur={() => guardarGasto(g)} />
                <input value={g.descripcion ?? ''} placeholder="detalle" onChange={e => setGasto(g.id, { descripcion: e.target.value })} onBlur={() => guardarGasto(g)} style={{ flex: '1 1 120px', textTransform: 'none' }} />
                <button className="btn-ghost" onClick={() => borrarGasto(g.id)}>✕</button>
              </div>
            ))}
            <button className="btn-ghost" onClick={addGasto}>+ Gasto</button>
          </div>
        </Seccion>

        <Seccion titulo={`📎 Documentos (privado) — ${docs.length}`}>
          <div style={{ flexBasis: '100%' }}>
            <label className="btn-ghost" style={{ cursor: 'pointer' }}>📄 Subir documento<input type="file" onChange={subirDoc} style={{ display: 'none' }} /></label>
            {docs.map(d => (
              <div key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 5, fontSize: 12 }}>
                <a href={d.url} target="_blank" rel="noreferrer" style={{ color: '#7ec8e3' }}>{d.nombre || 'documento'}</a>
                <button className="btn-ghost" onClick={() => borrarDoc(d.id)}>✕</button>
              </div>
            ))}
          </div>
        </Seccion>
      </div>
    </div>
  )
}

function Campo({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, flex: '1 1 160px' }}>
      <span className="muted">{label}</span>{children}
    </label>
  )
}

function Seccion({ titulo, children }) {
  return (
    <div className="glass" style={{ padding: 12 }}>
      <b style={{ fontSize: 13, color: 'var(--accent-strong)' }}>{titulo}</b>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>{children}</div>
    </div>
  )
}
