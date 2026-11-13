import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useMsg } from '../lib/saveFx'
import { confirmar, pedir } from '../lib/dialogos'
import { correoDeCelular, soloCelular, mostrarUsuario, esCorreoDeCelular } from '../lib/celular'

// VENDEDORES (12 nov 2026, pedido del dueño: "un panel de usuarios aparte, con un ingreso más
// fácil"). Aquí se da de alta a un vendedor EN UN SOLO PASO: nombre + celular. Antes eran
// cuatro en Usuarios (correo y contraseña, rol, enlazar la ficha, celular de avisos).
// El vendedor entra por /vendedores con su celular y su clave (lib/celular.js). No hay SQL
// nuevo: usa lo de sql/190 (vendedor_enlazar) y sql/83 (cambiar_password). Solo el superusuario.
const signupClient = createClient(
  import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'urbis-alta-vendedor' } }
)
const claveNueva = () => 'Urbis' + Math.floor(1000 + Math.random() * 9000)
const DIRECCION = () => window.location.origin + import.meta.env.BASE_URL + 'vendedores'
const VACIO = { nombre: '', cel: '', clave: '', proys: [] }

export default function EquipoVentas() {
  const { esSuper } = useAuth()
  const [fichas, setFichas] = useState([])
  const [perfiles, setPerfiles] = useState({})
  const [projects, setProjects] = useState([])
  const [asig, setAsig] = useState([])
  const [msg, setMsg] = useMsg(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(null)        // null = cerrado · { ...VACIO, ficha } = alta o dar acceso
  const [entrega, setEntrega] = useState(null)  // lo que hay que dictarle al vendedor
  const [verInactivos, setVerInactivos] = useState(false)

  async function load() {
    const [a, p, pr, pa] = await Promise.all([
      supabase.from('advisors').select('*').order('full_name'),
      supabase.from('profiles').select('id, full_name, email, phone, active, role'),
      supabase.from('projects').select('id, name').order('created_at'),
      supabase.from('project_assignments').select('user_id, project_id'),
    ])
    setFichas(a.data || [])
    setPerfiles(Object.fromEntries((p.data || []).map(x => [x.id, x])))
    setProjects(pr.data || []); setAsig(pa.data || [])
  }
  useEffect(() => { if (esSuper) load() }, [esSuper])

  if (!esSuper) return <p className="error">Solo el SUPERUSUARIO gestiona los vendedores.</p>

  const abrir = ficha => {
    setMsg(null); setEntrega(null)
    setForm({ ...VACIO, clave: claveNueva(), ficha: ficha || null, nombre: ficha?.full_name || '', cel: soloCelular(ficha?.phone) })
  }

  // código corto único para una ficha nueva: iniciales, y si ya existe, con número
  function codigoPara(nombre) {
    const base = nombre.split(/\s+/).filter(Boolean).map(x => x[0]).join('').slice(0, 3).toUpperCase() || 'V'
    const usados = new Set(fichas.map(f => f.code))
    let cod = base, n = 2
    while (usados.has(cod)) cod = base + n++
    return cod
  }

  async function guardar(e) {
    e.preventDefault()
    const nombre = form.nombre.trim().replace(/\s+/g, ' ').toUpperCase()
    const cel = soloCelular(form.cel)
    const clave = form.clave.trim()
    if (nombre.length < 3) return setMsg({ ok: false, t: 'ESCRIBE EL NOMBRE COMPLETO DEL VENDEDOR' })
    if (!cel) return setMsg({ ok: false, t: 'EL CELULAR TIENE 9 DÍGITOS Y EMPIEZA CON 9' })
    if (clave.length < 8) return setMsg({ ok: false, t: 'LA CLAVE DEBE TENER AL MENOS 8 CARACTERES' })
    setBusy(true); setMsg(null)
    try {
      // 1. la cuenta: su celular es su usuario
      const { data, error } = await signupClient.auth.signUp({
        email: correoDeCelular(cel), password: clave, options: { data: { full_name: nombre } },
      })
      if (error && /already registered|already been registered/i.test(error.message)) {
        throw new Error('ESE CELULAR YA TIENE USUARIO. Búscalo en la lista de abajo; si olvidó su clave, usa "Clave nueva".')
      }
      if (error) throw new Error(error.message)
      const uid = data.user?.id
      if (!uid) throw new Error('No se pudo crear la cuenta.')
      // 2. rol VENDEDOR + nombre + celular de avisos (Telegram)
      const tel = '51' + cel
      const { error: e2 } = await supabase.from('profiles').update({ role: 'asesor', full_name: nombre, phone: tel }).eq('id', uid)
      if (e2) throw new Error('La cuenta se creó, pero no se le pudo poner el rol VENDEDOR: ' + e2.message + '. Corrígelo en Usuarios.')
      // su número no es un cliente: que el bot no lo trate como lead (igual que en Usuarios)
      await supabase.from('whatsapp_numbers').upsert({ phone: tel, tipo: 'desactivado', note: 'VENDEDOR: ' + nombre })
      // 3. su ficha de vendedor (la de siempre, con sus ventas y comisiones, o una nueva)
      const { data: aid, error: e3 } = await supabase.rpc('vendedor_enlazar',
        form.ficha ? { p_uid: uid, p_advisor: form.ficha.id } : { p_uid: uid, p_codigo: codigoPara(nombre) })
      if (e3) throw new Error('La cuenta se creó, pero no se enlazó su ficha: ' + e3.message + '. Enlázala en Usuarios.')
      if (aid) await supabase.from('advisors').update({ phone: tel, full_name: nombre }).eq('id', aid)
      // 4. proyectos (sin marcar ninguno ve todos)
      if (form.proys.length) await supabase.from('project_assignments').insert(form.proys.map(pid => ({ user_id: uid, project_id: pid })))
      setEntrega({ nombre, cel, clave })
      setMsg({ ok: true, t: 'VENDEDOR LISTO: ' + nombre })
      setForm(null); load()
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + err.message }) }
    setBusy(false)
  }

  async function claveOtra(f, p) {
    const nueva = await pedir('Clave nueva para ' + f.full_name + '\n\nMínimo 8 caracteres. Se le cerrará la sesión en su celular y entra con esta.',
      { valor: claveNueva(), titulo: 'Clave nueva' })
    if (!nueva) return
    setBusy(true)
    const { error } = await supabase.rpc('cambiar_password', { uid: p.id, nueva })
    setBusy(false)
    if (error) return setMsg({ ok: false, t: 'ERROR: ' + error.message })
    setEntrega({ nombre: f.full_name, cel: mostrarUsuario(p.email).replace(/\s/g, ''), clave: nueva.trim(), soloClave: !esCorreoDeCelular(p.email) && p.email })
    setMsg({ ok: true, t: 'CLAVE CAMBIADA' })
  }

  async function activar(f, p, on) {
    if (!on && !await confirmar('¿Desactivar a ' + f.full_name + '?\n\nYa no podrá entrar ni aparecerá al elegir vendedor. Sus ventas, comisiones y prospectos NO se borran, y se le puede reactivar cuando quieras.',
      { peligro: true, aceptar: 'Sí, desactivar' })) return
    const { error } = await supabase.from('advisors').update({ active: on }).eq('id', f.id)
    // solo si su usuario es de VENDEDOR: una ficha enlazada a un jefe no le apaga el panel
    if (!error && p?.role === 'asesor') await supabase.from('profiles').update({ active: on }).eq('id', p.id)
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: f.full_name + (on ? ' REACTIVADO' : ' DESACTIVADO') })
    load()
  }

  async function renombrar(f, p) {
    const n = await pedir('Nombre completo del vendedor', { valor: f.full_name, titulo: 'Corregir nombre', obligatorio: true })
    if (!n || n.trim().toUpperCase() === f.full_name) return
    const nombre = n.trim().replace(/\s+/g, ' ').toUpperCase()
    const { error } = await supabase.from('advisors').update({ full_name: nombre }).eq('id', f.id)
    if (!error && p?.role === 'asesor') await supabase.from('profiles').update({ full_name: nombre }).eq('id', p.id)
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: 'NOMBRE CORREGIDO' })
    load()
  }

  async function toggleProy(p, pid, on) {
    if (on) await supabase.from('project_assignments').insert({ user_id: p.id, project_id: pid })
    else await supabase.from('project_assignments').delete().eq('user_id', p.id).eq('project_id', pid)
    load()
  }

  const copiar = async t => { try { await navigator.clipboard.writeText(t); setMsg({ ok: true, t: 'COPIADO' }) } catch { /* se copia a mano */ } }
  const textoEntrega = e => `Hola ${e.nombre.split(' ')[0]}, este es tu acceso al panel de vendedores de Urbis:\n\n${DIRECCION()}\n\n` +
    (e.soloClave ? `Usuario: ${e.soloClave}` : `Celular: ${e.cel}`) + `\nClave: ${e.clave}\n\nLa primera vez te pedirá crear un PIN de 4 dígitos: después solo escribes el PIN.`

  const conAcceso = fichas.filter(f => f.active && perfiles[f.profile_id])
  const sinAcceso = fichas.filter(f => f.active && !perfiles[f.profile_id])
  const inactivos = fichas.filter(f => !f.active)

  const Fila = f => {
    const p = perfiles[f.profile_id]
    const suyos = p ? asig.filter(a => a.user_id === p.id).map(a => a.project_id) : []
    return (
      <div key={f.id} className="glass vend-fila" style={{ opacity: f.active ? 1 : .6 }}>
        <div style={{ minWidth: 0, flex: '1 1 220px' }}>
          <b>{f.full_name}</b> <span className="chip" style={{ fontSize: 10 }}>{f.code}</span>
          <div className="muted" style={{ fontSize: 12, textTransform: 'none' }}>
            {p ? <>Entra con: <b>{mostrarUsuario(p.email)}</b>{p.active === false && ' · usuario desactivado'}</>
              : 'Sin acceso al sistema'}
          </div>
          {p && f.active && projects.length > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }} title="Proyectos que ve. Sin marcar ninguno, ve todos.">
              {projects.map(pr => (
                <button key={pr.id} type="button" className={'chip' + (suyos.includes(pr.id) ? ' on' : '')} style={{ fontSize: 10 }}
                  onClick={() => toggleProy(p, pr.id, !suyos.includes(pr.id))}>{pr.name}</button>
              ))}
              {!suyos.length && <span className="muted" style={{ fontSize: 11, textTransform: 'none' }}>ve todos los proyectos</span>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {f.active && !p && <button className="btn-primary" style={{ fontSize: 12 }} disabled={busy} onClick={() => abrir(f)}>Dar acceso</button>}
          {f.active && p && <button className="btn-ghost" style={{ fontSize: 12 }} disabled={busy} onClick={() => claveOtra(f, p)}>Clave nueva</button>}
          <button className="btn-ghost" style={{ fontSize: 12 }} disabled={busy} onClick={() => renombrar(f, p)}>Corregir nombre</button>
          <button className="btn-ghost" style={{ fontSize: 12 }} disabled={busy} onClick={() => activar(f, p, !f.active)}>{f.active ? 'Desactivar' : 'Reactivar'}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="vend-admin">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <h1 style={{ margin: 0, flex: 1 }}>Vendedores</h1>
        <button className="btn-primary" onClick={() => abrir(null)}>+ Nuevo vendedor</button>
      </div>
      <p className="muted" style={{ textTransform: 'none', marginTop: 0 }}>
        Cada vendedor entra desde su celular en <b>{DIRECCION().replace(/^https?:\/\//, '')}</b> con su número y su clave, y ve solo sus prospectos, sus chats y el plano con precios.
      </p>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      {entrega && (
        <div className="glass" style={{ padding: 16, marginBottom: 14, borderLeft: '4px solid #6fdd9b' }}>
          <b>Pásale esto a {entrega.nombre}</b>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', textTransform: 'none', margin: '8px 0' }}>{textoEntrega(entrega)}</pre>
          <p className="muted" style={{ fontSize: 12, textTransform: 'none', margin: '0 0 8px' }}>
            La clave no se guarda en ningún lado: cópiala ahora. Para sus recordatorios, que escriba a @UrbisAgenteBot en Telegram y toque "Compartir mi número".
          </p>
          <button className="btn-primary" onClick={() => copiar(textoEntrega(entrega))}>Copiar mensaje</button>{' '}
          <button className="btn-ghost" onClick={() => setEntrega(null)}>Listo</button>
        </div>
      )}

      {form && (
        <form className="glass" style={{ padding: 16, marginBottom: 14, display: 'grid', gap: 10, maxWidth: 520 }} onSubmit={guardar}>
          <b>{form.ficha ? 'Dar acceso a ' + form.ficha.full_name : 'Nuevo vendedor'}</b>
          <label>Nombre completo
            <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} required autoFocus={!form.ficha} />
          </label>
          <label>Celular (será su usuario)
            <input type="tel" inputMode="numeric" placeholder="987 654 321" value={form.cel}
              onChange={e => setForm({ ...form, cel: e.target.value })} required autoFocus={!!form.ficha} />
          </label>
          <label>Clave para empezar (él la puede cambiar)
            <input value={form.clave} style={{ textTransform: 'none' }} onChange={e => setForm({ ...form, clave: e.target.value })} required />
          </label>
          {projects.length > 1 && (
            <div>
              <span className="muted" style={{ fontSize: '.9rem' }}>Proyectos que vende (sin marcar = todos)</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {projects.map(pr => (
                  <button key={pr.id} type="button" className={'chip' + (form.proys.includes(pr.id) ? ' on' : '')}
                    onClick={() => setForm({ ...form, proys: form.proys.includes(pr.id) ? form.proys.filter(x => x !== pr.id) : [...form.proys, pr.id] })}>{pr.name}</button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" disabled={busy}>{busy ? 'Creando…' : form.ficha ? 'Dar acceso' : 'Crear vendedor'}</button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <h2 className="sub">Con acceso ({conAcceso.length})</h2>
      {conAcceso.length ? conAcceso.map(Fila) : <p className="muted" style={{ textTransform: 'none' }}>Todavía ningún vendedor tiene acceso. Usa "Dar acceso" en su fila o crea uno nuevo.</p>}

      <h2 className="sub" style={{ marginTop: 18 }}>Sin acceso ({sinAcceso.length})</h2>
      <p className="muted" style={{ fontSize: 12, textTransform: 'none', marginTop: 0 }}>Tienen ventas o comisiones registradas, pero no entran al sistema.</p>
      {sinAcceso.map(Fila)}

      {inactivos.length > 0 && (
        <>
          <button className="link-btn muted" style={{ marginTop: 18 }} onClick={() => setVerInactivos(v => !v)}>
            {verInactivos ? 'Ocultar' : 'Ver'} desactivados ({inactivos.length})
          </button>
          {verInactivos && inactivos.map(Fila)}
        </>
      )}
    </div>
  )
}
