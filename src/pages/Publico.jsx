import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Página PÚBLICA (sin login) de propiedades. Lee las vistas seguras pub_propiedades / pub_proyectos
// y el formulario de contacto inserta en corr_consultas (anon solo puede insertar).
const V = '#0f6b4f', VD = '#0b4733', AM = '#ffc644'
const TIPO = { terreno_urbano: 'Terreno urbano', terreno_rural: 'Terreno rural', lote: 'Lote', casa: 'Casa', departamento: 'Departamento', local: 'Local comercial', oficina: 'Oficina', edificio: 'Edificio', almacen: 'Almacén', estacionamiento: 'Estacionamiento', aires: 'Aires', otro: 'Otro' }
const money = (n, m) => n == null ? 'Consultar' : (m === 'PEN' ? 'S/ ' : 'US$ ') + Number(n).toLocaleString('es-PE')
const colorEstado = e => e === 'vendido' ? '#3778c2' : e === 'reservado' ? '#c8901f' : '#0f9d63'
const txtEstado = e => e === 'vendido' ? 'Vendido' : e === 'reservado' ? 'Reservado' : 'Disponible'

export default function Publico() {
  const [tab, setTab] = useState('propiedades')
  const [props, setProps] = useState([])
  const [proys, setProys] = useState([])
  const [fTipo, setFTipo] = useState(''); const [fZona, setFZona] = useState(''); const [q, setQ] = useState('')
  const [lightbox, setLightbox] = useState(null)     // { fotos, i }
  const [form, setForm] = useState(null)             // { tipo, id, titulo }

  useEffect(() => {
    supabase.from('pub_propiedades').select('*').then(({ data }) => setProps(data || []))
    supabase.from('pub_proyectos').select('*').order('orden').then(({ data }) => setProys(data || []))
  }, [])

  const zonas = [...new Set(props.map(p => p.zona).filter(Boolean))]
  const tipos = [...new Set(props.map(p => p.tipo).filter(Boolean))]
  const filtradas = props.filter(p =>
    (!fTipo || p.tipo === fTipo) && (!fZona || p.zona === fZona) &&
    (!q || (p.titulo || '').toLowerCase().includes(q.toLowerCase()) || (p.zona || '').toLowerCase().includes(q.toLowerCase())))

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f5', color: '#1a2420', fontFamily: 'system-ui, sans-serif' }}>
      {/* header */}
      <header style={{ background: V, color: '#fff', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ width: 38, height: 38, borderRadius: 9, background: '#fff', color: V, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 19 }}>U</div>
        <div><div style={{ fontWeight: 800, fontSize: 18 }}>URBIS GROUP</div><div style={{ fontSize: 12, opacity: .85 }}>Propiedades en venta</div></div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {[['propiedades', '🏠 Propiedades'], ['proyectos', '📍 Proyectos']].map(([v, t]) => (
            <button key={v} onClick={() => setTab(v)} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: tab === v ? '#fff' : 'rgba(255,255,255,.18)', color: tab === v ? V : '#fff' }}>{t}</button>
          ))}
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px 40px' }}>
        {tab === 'propiedades' && (<>
          {/* filtros */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <select value={fTipo} onChange={e => setFTipo(e.target.value)} style={selSt}><option value="">Todos los tipos</option>{tipos.map(t => <option key={t} value={t}>{TIPO[t] || t}</option>)}</select>
            <select value={fZona} onChange={e => setFZona(e.target.value)} style={selSt}><option value="">Todas las zonas</option>{zonas.map(z => <option key={z} value={z}>{z}</option>)}</select>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…" style={{ ...selSt, flex: 1, minWidth: 160 }} />
          </div>

          {!filtradas.length && <p style={{ color: '#5b6b63', textAlign: 'center', padding: 40 }}>No hay propiedades que coincidan.</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            {filtradas.map(p => <PropCard key={p.id} p={p} onZoom={(fotos, i) => setLightbox({ fotos, i })} onMas={() => setForm({ tipo: 'propiedad', id: p.id, titulo: p.titulo || TIPO[p.tipo] })} />)}
          </div>

          {/* leyenda */}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 22, paddingTop: 14, borderTop: '1px solid #e2e8e4', fontSize: 12.5, color: '#5b6b63' }}>
            <b style={{ color: '#1a2420' }}>Leyenda:</b>
            {[['Disponible', '#0f9d63'], ['Reservado', '#c8901f'], ['Vendido', '#3778c2']].map(([t, c]) => (
              <span key={t}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: c, marginRight: 5 }} />{t}</span>
            ))}
          </div>
        </>)}

        {tab === 'proyectos' && (<>
          {!proys.length && <p style={{ color: '#5b6b63', textAlign: 'center', padding: 40 }}>Pronto publicaremos nuestros proyectos aquí.</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {proys.map(pr => <ProyCard key={pr.id} pr={pr} onMas={() => setForm({ tipo: 'proyecto', id: pr.id, titulo: pr.nombre })} />)}
          </div>
        </>)}
      </div>

      {lightbox && <Lightbox {...lightbox} onClose={() => setLightbox(null)} onNav={i => setLightbox(l => ({ ...l, i }))} />}
      {form && <FormModal {...form} onClose={() => setForm(null)} />}
    </div>
  )
}

const selSt = { padding: '9px 11px', borderRadius: 9, border: '1.5px solid #d8e2dc', fontSize: 14, background: '#fff', color: '#1a2420' }
const cardSt = { background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 12px rgba(16,40,30,.08)', display: 'flex', flexDirection: 'column' }

function PropCard({ p, onZoom, onMas }) {
  const fotos = p.fotos || []
  const [i, setI] = useState(0)
  const cur = fotos[i]
  const nav = (e, d) => { e.stopPropagation(); setI(x => (x + d + fotos.length) % fotos.length) }
  return (
    <div style={cardSt}>
      <div style={{ position: 'relative', height: 180, background: '#e7ede9', cursor: fotos.length ? 'zoom-in' : 'default' }} onClick={() => fotos.length && onZoom(fotos, i)}>
        {cur ? <img src={cur} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#9fb3a8', fontSize: 40 }}>🏠</div>}
        <span style={{ position: 'absolute', top: 10, left: 10, background: colorEstado(p.estado), color: '#fff', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>{txtEstado(p.estado)}</span>
        {fotos.length > 0 && <span style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 12, padding: '2px 8px', borderRadius: 20 }}>🔍 {fotos.length} 📷</span>}
        {fotos.length > 1 && <>
          <button onClick={e => nav(e, -1)} style={arrowSt('left')}>‹</button>
          <button onClick={e => nav(e, 1)} style={arrowSt('right')}>›</button>
          <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 5 }}>
            {fotos.map((_, k) => <span key={k} style={{ width: 7, height: 7, borderRadius: 4, background: k === i ? '#fff' : 'rgba(255,255,255,.5)' }} />)}
          </div>
        </>}
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <div style={{ fontSize: 12, color: '#5b6b63' }}>{TIPO[p.tipo] || p.tipo}{p.zona ? ' · ' + p.zona : ''}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: VD }}>{money(p.precio, p.moneda)}</div>
        {p.titulo && <div style={{ fontSize: 14, fontWeight: 600 }}>{p.titulo}</div>}
        <div style={{ display: 'flex', gap: 14, fontSize: 13, color: '#5b6b63', flexWrap: 'wrap' }}>
          {p.area != null && <span>📐 {p.area} {p.area_unidad === 'ha' ? 'ha' : 'm²'}</span>}
          {p.dormitorios != null && <span>🛏️ {p.dormitorios} dorm</span>}
          {p.cuota_ref && <span>💳 {p.cuota_ref}</span>}
        </div>
        <button onClick={onMas} style={{ marginTop: 'auto', padding: '9px', borderRadius: 9, border: 'none', background: V, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>Ver más</button>
      </div>
    </div>
  )
}

function ProyCard({ pr, onMas }) {
  return (
    <div style={cardSt}>
      <div style={{ height: 170, background: '#e7ede9' }}>
        {pr.foto_url ? <img src={pr.foto_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#9fb3a8', fontSize: 40 }}>📍</div>}
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: VD }}>{pr.nombre}</div>
        <div style={{ display: 'flex', gap: 12, fontSize: 13, color: '#5b6b63', flexWrap: 'wrap' }}>
          {pr.precio_desde != null && <span>Desde <b style={{ color: '#1a2420' }}>{money(pr.precio_desde, 'PEN')}</b></span>}
          {pr.cuota_desde && <span>💳 {pr.cuota_desde}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip c="#0f9d63" t={`${pr.disponibles || 0} disponibles`} />
          <Chip c="#c8901f" t={`${pr.reservados || 0} reservados`} />
          <Chip c="#3778c2" t={`${pr.vendidos || 0} vendidos`} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
          {pr.pdf_url && <a href={pr.pdf_url} target="_blank" rel="noreferrer" style={{ flex: 1, textAlign: 'center', padding: '9px', borderRadius: 9, border: '1.5px solid ' + V, color: V, fontWeight: 600, textDecoration: 'none', fontSize: 14 }}>📄 Ver plano</a>}
          <button onClick={onMas} style={{ flex: 1, padding: '9px', borderRadius: 9, border: 'none', background: V, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>Más info</button>
        </div>
      </div>
    </div>
  )
}

const Chip = ({ c, t }) => <span style={{ fontSize: 11.5, fontWeight: 600, color: c, background: c + '22', padding: '2px 9px', borderRadius: 20 }}>{t}</span>
const arrowSt = side => ({ position: 'absolute', top: '50%', [side]: 8, transform: 'translateY(-50%)', width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.45)', color: '#fff', fontSize: 20, cursor: 'pointer', lineHeight: 1 })

function Lightbox({ fotos, i, onClose, onNav }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.9)', zIndex: 100, display: 'grid', placeItems: 'center' }}>
      <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 20, background: 'none', border: 'none', color: '#fff', fontSize: 34, cursor: 'pointer' }}>×</button>
      <img src={fotos[i]} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '86vh', objectFit: 'contain', borderRadius: 8 }} />
      {fotos.length > 1 && <>
        <button onClick={e => { e.stopPropagation(); onNav((i - 1 + fotos.length) % fotos.length) }} style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', fontSize: 40, width: 52, height: 52, borderRadius: '50%', cursor: 'pointer' }}>‹</button>
        <button onClick={e => { e.stopPropagation(); onNav((i + 1) % fotos.length) }} style={{ position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', fontSize: 40, width: 52, height: 52, borderRadius: '50%', cursor: 'pointer' }}>›</button>
        <div style={{ position: 'absolute', bottom: 20, color: '#fff', fontSize: 14 }}>{i + 1} / {fotos.length}</div>
      </>}
    </div>
  )
}

function FormModal({ tipo, id, titulo, onClose }) {
  const [nombre, setNombre] = useState(''); const [telefono, setTelefono] = useState(''); const [mensaje, setMensaje] = useState('')
  const [estado, setEstado] = useState('') // '', 'enviando', 'ok', 'error'
  const enviar = async () => {
    if (!nombre.trim() || !telefono.trim()) { setEstado('faltan'); return }
    setEstado('enviando')
    const row = { tipo, nombre: nombre.trim(), telefono: telefono.trim(), mensaje: mensaje.trim() }
    if (tipo === 'propiedad') row.propiedad_id = id; else row.project_id = id
    const { error } = await supabase.from('corr_consultas').insert(row)
    setEstado(error ? 'error' : 'ok')
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,15,.5)', zIndex: 100, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 22, width: 'min(420px, 100%)', color: '#1a2420' }}>
        {estado === 'ok' ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <h3 style={{ margin: '8px 0' }}>¡Gracias!</h3>
            <p style={{ color: '#5b6b63', fontSize: 14 }}>Recibimos tus datos. Un asesor de Urbis te contactará pronto.</p>
            <button onClick={onClose} style={btnV}>Cerrar</button>
          </div>
        ) : (<>
          <h3 style={{ margin: '0 0 4px' }}>Quiero más información</h3>
          <p style={{ color: '#5b6b63', fontSize: 13, margin: '0 0 14px' }}>Sobre: <b>{titulo}</b></p>
          <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Tu nombre *" style={inSt} />
          <input value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="Tu WhatsApp / teléfono *" style={inSt} />
          <textarea value={mensaje} onChange={e => setMensaje(e.target.value)} placeholder="Mensaje (opcional)" style={{ ...inSt, minHeight: 70 }} />
          {estado === 'faltan' && <p style={{ color: '#c0392b', fontSize: 13, margin: '4px 0' }}>Completa tu nombre y teléfono.</p>}
          {estado === 'error' && <p style={{ color: '#c0392b', fontSize: 13, margin: '4px 0' }}>No se pudo enviar. Intenta de nuevo.</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={onClose} style={{ ...btnV, flex: 1, background: '#eef3f0', color: V }}>Cancelar</button>
            <button onClick={enviar} disabled={estado === 'enviando'} style={{ ...btnV, flex: 2 }}>{estado === 'enviando' ? 'Enviando…' : 'Enviar'}</button>
          </div>
        </>)}
      </div>
    </div>
  )
}

const inSt = { width: '100%', padding: '10px 12px', borderRadius: 9, border: '1.5px solid #d8e2dc', fontSize: 14, marginBottom: 9, boxSizing: 'border-box' }
const btnV = { padding: '11px', borderRadius: 9, border: 'none', background: V, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14, marginTop: 6 }
