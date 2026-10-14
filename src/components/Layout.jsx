import { useState, useEffect, Suspense } from 'react'
import { NavLink, Outlet, useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useProject, colorProyecto, logoProyecto } from '../context/ProjectContext'
import { supabase } from '../lib/supabase'
import Logo from './Logo'
import Avatar from './Avatar'
import SaveFx from './SaveFx'
import InstalarApp from './InstalarApp'
import { useTablasAlAlto } from '../lib/tablasAlAlto'
import { useNavigate as usarNavegacion } from 'react-router-dom'

// Boton flotante "volver arriba": aparece al bajar y desaparece arriba del todo.
// En listas largas (clientes, cuotas, contratos) evita tener que scrollear a mano.
function VolverArriba() {
  const [ver, setVer] = useState(false)
  useEffect(() => {
    const onScroll = () => setVer(window.scrollY > 400)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <button className={`to-top ${ver ? 'show' : ''}`} title="Volver arriba" aria-label="Volver arriba"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>&#8593;</button>
  )
}

// Resalta la ULTIMA palabra del nombre, que suele ser la que distingue proyectos
// parecidos: "LAS PRADERAS DE **CASHIBO**" vs "LAS PRADERAS DE **PUCALLPA**".
const nombreProy = n => {
  const p = String(n || '').trim().split(/\s+/)
  if (p.length < 2) return n
  return <>{p.slice(0, -1).join(' ')} <b>{p[p.length - 1]}</b></>
}

const haceCuanto = desde => {
  if (!desde) return ''
  const m = Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 60000))
  if (m < 1) return 'recién'
  if (m < 60) return m + ' min'
  const h = Math.floor(m / 60)
  return h + 'h ' + (m % 60) + 'm'
}

// EL MENÚ, ORDENADO POR LO QUE SE HACE (1 oct 2026, pedido del dueño: "más fácil de
// manejar"). Antes eran 15 ítems generales más 6 repetidos debajo de CADA proyecto.
// Ahora hay un solo selector de proyecto arriba y una sola lista: las pantallas
// marcadas con `proy` trabajan sobre el proyecto elegido.
//   siempre  = no depende de los paneles del usuario
//   staff    = admin y superusuario · admin = SOLO superusuario
//   corrige  = superusuario y OPERADOR. El operador ve el menú del superusuario
//              menos lo marcado `admin` o `staff` (usuarios, bitácora, corretaje,
//              campañas, agentes IA, probar bot)
//   cobranza = la abre el permiso especial de cobranza (sql/76), no un rol
const MENU = [
  // el buscador y lo urgente del día
  { to: '/hoy', label: 'Hoy', icon: '☀️', siempre: true, color: '#9ccb86' },
  { to: '/lotes', label: 'Mapa de lotes', icon: '🗺️', color: '#8fd16f', proy: true },

  // Pagos y sus boletas/facturas electrónicas (sql/113) son una sola entrada: dentro
  // hay dos pestañas (components/PagosTabs). Un comprobante siempre es de un pago.
  { to: '/pagos', label: 'Pagos y comprobantes', icon: '💵', color: '#4fc3a1', proy: true, grupo: 'Cobranza', tambien: ['/comprobantes'] },
  { to: '/cobranza-ia', label: 'Cobranza IA', icon: '🤝', cobranza: true, color: '#5fd38d', grupo: 'Cobranza' },

  // ventas y contratos en una sola lista (antes dos pantallas con casi la misma tabla)
  { to: '/ventas', label: 'Ventas y contratos', icon: '📄', color: '#7bb6e0', proy: true, grupo: 'Ventas', tambien: ['/contratos'] },
  { to: '/clientes', label: 'Clientes', icon: '👥', color: '#b792e8', grupo: 'Ventas' },
  { to: '/comisiones', label: 'Comisiones', icon: '🪙', color: '#e8b04f', proy: true, grupo: 'Ventas' },

  { to: '/gastos', label: 'Gastos', icon: '🧾', color: '#f2785c', proy: true, grupo: 'Gastos' },

  { to: '/whatsapp', label: 'WhatsApp', icon: '💬', color: '#58c482', grupo: 'Comercial' },   // bandeja para todo el equipo (RLS filtra los chats)
  { to: '/visitas', label: 'Visitas', icon: '📅', color: '#7ba7f7', grupo: 'Comercial' },
  { to: '/secretarias', label: 'Tareas del equipo', icon: '🗓️', color: '#e8a0c8', grupo: 'Comercial' },
  { to: '/campanas', label: 'Campañas', icon: '📣', staff: true, color: '#f0a35c', grupo: 'Comercial' },
  { to: '/corretaje', label: 'Corretaje', icon: '🏘️', staff: true, color: '#6fd1c0', grupo: 'Comercial' },

  { to: '/', label: 'Dashboard', icon: '📊', end: true, color: '#56c7d6', grupo: 'Reportes' },

  { to: '/proyectos', label: 'Proyectos', icon: '🏗️', color: '#e7c15a', grupo: 'Configuración' },
  // el experimento del agente de ventas IA contra el supervisor (sql/91)
  { to: '/ventas-ia', label: 'Agente de ventas', icon: '🤖', admin: true, color: '#8ab4f8', grupo: 'Configuración' },
  { to: '/probar-bot', label: 'Probar Bot', icon: '🧪', staff: true, color: '#c58ae0', grupo: 'Configuración' },
  { to: '/usuarios', label: 'Usuarios', icon: '🔐', admin: true, color: '#f08080', grupo: 'Configuración' },
  // sueldos, adelantos, descuentos y tardanzas (sql/131): de todo Urbis, no de un proyecto.
  // La ve el superusuario y a quien él le dé el permiso 'planilla' en Usuarios (sql/132).
  { to: '/planilla', label: 'Planilla', icon: '👷', permiso: 'planilla', color: '#e0a96d', grupo: 'Configuración' },
  { to: '/bitacora', label: 'Bitácora', icon: '📋', admin: true, color: '#9daab6', grupo: 'Configuración' },
  // carga masiva de vouchers/contratos/DNI cuando entra un proyecto nuevo
  { to: '/migracion', label: 'Migración', icon: '📥', corrige: true, color: '#7fb0d8', grupo: 'Configuración' },
]
const solesMenu = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Al entrar al sistema: lo que le toca firmar o pagar en Gastos, por proyecto, con el
// total arriba. Cada tarjeta lleva a Gastos con ese proyecto ya elegido (10 oct).
function TarjetasPendientes({ porFirmar, porPagar, esSocia, onIr }) {
  const suma = l => l.reduce((s, p) => s + p.total, 0)
  const cuenta = l => l.reduce((s, p) => s + p.n, 0)
  const tarjeta = (p, tipo) => (
    <button key={tipo + p.id} type="button" className={'tp-card ' + tipo} onClick={() => onIr(p.id)}>
      <span className="tp-tipo">{tipo === 'firma' ? (esSocia ? '✍ Por aprobar y firmar' : '✍ Tus solicitudes por firmar') : '💸 Por pagar · subir el voucher'}</span>
      <b className="tp-proy">{p.name}</b>
      <span className="tp-monto">{solesMenu(p.total)}</span>
      <span className="tp-n">{p.n} {tipo === 'firma' ? (p.n === 1 ? 'solicitud' : 'solicitudes') : (p.n === 1 ? 'gasto aprobado' : 'gastos aprobados')}</span>
      <span className="tp-ir">{tipo === 'firma' ? 'Firmar ahora →' : 'Subir voucher →'}</span>
    </button>
  )
  return (
    <div className="glass tp">
      <div className="tp-cab">
        <b>📌 Te toca en Gastos</b>
        {porFirmar.length > 0 && <span>Por firmar: <b>{solesMenu(suma(porFirmar))}</b> ({cuenta(porFirmar)})</span>}
        {porPagar.length > 0 && <span>Por pagar: <b>{solesMenu(suma(porPagar))}</b> ({cuenta(porPagar)})</span>}
      </div>
      <div className="tp-grid">
        {porFirmar.map(p => tarjeta(p, 'firma'))}
        {porPagar.map(p => tarjeta(p, 'pago'))}
      </div>
    </div>
  )
}

// El rol FACTURACIÓN (la secretaria de la otra empresa, sql/134) ve SOLO esto: no está
// en MENU para que nadie más lo tenga en su menú. Desde el 13 oct también Gastos
// (sql/145): lo ve todo, imprime y sube el voucher de los pagos de la socia.
const MENU_FACTURACION = { to: '/facturacion', end: true, label: 'Boletas y facturas', icon: '🧾', color: '#4fc3a1' }
const MENU_FACT_GASTOS = { to: '/facturacion/gastos', label: 'Gastos', icon: '💸', color: '#e0b23f' }
// Los grupos, en orden. Un grupo con un solo ítem visible se muestra como ítem suelto.
const COLOR_TOTAL = '#9aa896'   // el gris de "todos los proyectos", el mismo del selector de las pantallas
const ORDEN_GRUPOS = ['Cobranza', 'Ventas', 'Gastos', 'Comercial', 'Reportes', 'Configuración']
const ICONO_GRUPO = { Cobranza: '💰', Ventas: '🏷️', Gastos: '🧾', Comercial: '📢', Reportes: '📈', 'Configuración': '⚙️' }
// Paneles que el superusuario puede habilitar/ocultar por usuario (excluye los solo-superusuario).
// Cobranza IA no va en esta lista: no la abre un panel sino el permiso especial.
// Los que van por permiso especial (la planilla) tampoco: se dan con su propia casilla.
export const PANELS = MENU.filter(m => !m.admin && !m.corrige && !m.cobranza && !m.permiso && !m.siempre && !m.fact && m.to !== '/').map(m => ({ to: m.to, label: m.label, icon: m.icon }))

export default function Layout() {
  const { profile, role, esSuper, puedeCorregir, esJefe, logout } = useAuth()
  const { projects, pid, pidOp, select } = useProject()
  const [open, setOpen] = useState(false)
  const [eligiendoProy, setEligiendoProy] = useState(false)   // la lista de proyectos, desplegada
  const [gruposCerrados, setGruposCerrados] = useState({})   // grupos plegados (por defecto todos abiertos)
  const [conectados, setConectados] = useState([])
  // Solicitudes de gasto que esperan MI firma, por proyecto. Se ve en cualquier
  // pantalla: el objetivo es que nadie tenga que acordarse de revisar.
  //   · socio  → las que le toca aprobar (sql/73)
  //   · quien pidio el gasto → las que le toca firmar como solicitante (sql/74)
  const [porFirmar, setPorFirmar] = useState([])
  //   · socio → además, los pagos aprobados que esperan su comprobante (sql/101)
  const [porPagar, setPorPagar] = useState([])
  const irA = usarNavegacion()
  useEffect(() => {
    // facturación no lee la tabla (el candado de sql/134): cuenta lo suyo por su función
    if (!profile?.id || role === 'facturacion') return
    const esSocio = role === 'socio'
    let vivo = true
    // por proyecto: cuántas y cuánto suman (las tarjetas muestran el total, 10 oct)
    const sumar = (m, r) => {
      m[r.project_id] = m[r.project_id] || { id: r.project_id, name: r.project?.name, n: 0, total: 0 }
      m[r.project_id].n++; m[r.project_id].total += Number(r.amount || 0)
    }
    const contarPagos = async () => {
      if (!esSocio) return
      const { data, error } = await supabase.from('expenses')
        .select('project_id, requester_id, amount, project:projects!inner(name, expense_approval)')
        .eq('status', 'solicitado').not('approved_at', 'is', null).is('rejected_at', null)
        .eq('project.expense_approval', true).limit(200)
      if (!vivo || error) return
      const m = {}
      for (const r of (data || [])) {
        if (r.requester_id === profile.id) continue      // quien pidió el gasto no registra su pago
        sumar(m, r)
      }
      setPorPagar(Object.values(m))
    }
    const contar = async () => {
      contarPagos()
      const base = supabase.from('expenses')
        .select('project_id, requester_id, requester_signed_at, amount, project:projects!inner(name, expense_approval)')
        .eq('status', 'solicitado').is('approved_at', null).is('rejected_at', null).limit(200)
      const { data, error } = esSocio
        ? await base.eq('project.expense_approval', true)
        : await base.eq('requester_id', profile.id).is('requester_signed_at', null)
      if (!vivo || error) return       // sql/74 sin correr: el aviso no aparece y ya
      const m = {}
      for (const r of (data || [])) {
        // al socio no se le cuenta lo que todavia no firmo el solicitante (ni lo que se
        // registró sin solicitante, sql/136): no es su turno, y un contador que no
        // puede bajar deja de significar algo
        if (esSocio && (!r.requester_id || !r.requester_signed_at)) continue
        sumar(m, r)
      }
      setPorFirmar(Object.values(m))
    }
    contar()
    // con la pestaña escondida no se pregunta: cada pestaña olvidada abierta
    // era una consulta mas por minuto al servidor. Al volver se cuenta de una.
    const t = setInterval(() => { if (!document.hidden) contar() }, 60000)
    const alVolver = () => { if (!document.hidden) contar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [role, profile?.id])
  const esAdmin = esJefe   // administrador, superusuario y operador: ven quién está conectado
  // Paneles habilitados por usuario (null = según su rol, sin restricción extra). El superusuario
  // y el operador ven todo lo de su rol: a ellos los paneles por usuario no les recortan nada.
  const panelsUser = Array.isArray(profile?.panels) ? profile.panels : null
  // `tambien`: quien tenía habilitado el panel viejo de Contratos ve "Ventas y contratos"
  // Comprobantes va con Pagos: quien cobra es quien emite la boleta
  const enPanel = m => puedeCorregir || m.to === '/' || m.siempre || m.admin || m.corrige || m.cobranza || m.permiso || !panelsUser || panelsUser.includes(m.fact ? '/pagos' : m.to) || (m.tambien || []).some(t => panelsUser.includes(t))
  // Cobranza IA la abre el permiso especial (sql/76), no el rol ni los paneles.
  // El administrador la ve para consultar; la pantalla le quita los botones.
  // El OPERADOR no entra en esta lista: solo la ve si se le dio el permiso especial.
  const tieneCobranza = ['admin', 'superuser'].includes(role) || (profile?.permisos || []).includes('cobranza')
  // ¿este ítem es visible para el usuario? (mismo criterio que tenía el menú plano)
  // `staff` NO incluye al operador a propósito: campañas, corretaje y probar bot no son suyos.
  const hayFacturador = projects.some(p => p.fact_activo)
  // `permiso`: el superusuario y quien tenga ese permiso especial en Usuarios (la planilla, sql/132)
  const tienePermiso = p => esSuper || (profile?.permisos || []).includes(p)
  const verItem = m => !!m && (!m.admin || esSuper) && (!m.corrige || puedeCorregir) && (!m.permiso || tienePermiso(m.permiso)) && (!m.staff || ['admin', 'superuser'].includes(role)) && (!m.cobranza || tieneCobranza) && (!m.fact || hayFacturador) && enPanel(m)
  const grupoAbierto = g => !gruposCerrados[g]
  const toggleGrupo = g => setGruposCerrados(s => ({ ...s, [g]: !s[g] }))

  // latido de presencia del usuario actual (cada 45s)
  useEffect(() => {
    if (!profile?.id) return
    const now = () => new Date().toISOString()
    supabase.from('profiles').update({ last_seen: now(), online_since: now() }).eq('id', profile.id).then(() => {}, () => {})
    const t = setInterval(() => { supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', profile.id).then(() => {}, () => {}) }, 45000)
    return () => clearInterval(t)
  }, [profile?.id])

  // lista de conectados (solo admin/superuser), refresca cada 20s
  useEffect(() => {
    if (!esAdmin) return
    const cargar = () => {
      // select('*') a proposito: si se nombra avatar_url y la columna aun no existe
      // (sql/26 sin correr), PostgREST rechaza el query entero y la lista de
      // conectados desaparece. Con '*' simplemente no hay foto y se ven las iniciales.
      supabase.from('profiles').select('*').gte('last_seen', new Date(Date.now() - 130000).toISOString()).order('online_since')
        .then(({ data }) => setConectados(data || []))
    }
    cargar()
    const t = setInterval(() => { if (!document.hidden) cargar() }, 20000)
    return () => clearInterval(t)
  }, [esAdmin])

  // facturación: cuántos pagos le faltan y cuántos gastos esperan su voucher, en el
  // menú (se cuenta cada minuto, con la pestaña a la vista)
  const esFacturacion = role === 'facturacion'
  const [pendFact, setPendFact] = useState(0)
  const [pendGastos, setPendGastos] = useState(0)
  useEffect(() => {
    if (!esFacturacion) return
    let vivo = true
    const contar = () => supabase.rpc('facturacion_pagos', { p_solo_pendientes: true }).then(({ data, error }) => {
      if (!vivo || error) return
      const deps = new Set((data || []).map(f => {
        const op = String(f.operation_number || '').trim().toUpperCase()
        return !op || op === 'SIN-REF' ? f.id : [f.project_id, f.date, op, f.financial_account_id || ''].join('|')
      }))
      setPendFact(deps.size)
    })
    const contarGastos = () => supabase.rpc('facturacion_gastos', { p_por_pagar: true }).then(({ data, error }) => {
      if (vivo && !error) setPendGastos((data?.gastos || []).length)
    })
    contar(); contarGastos()
    const t = setInterval(() => { if (!document.hidden) { contar(); contarGastos() } }, 60000)
    return () => { vivo = false; clearInterval(t) }
  }, [esFacturacion])

  const _loc = useLocation()
  const pathname = _loc.pathname
  // cada tabla, del alto que queda en la pantalla: su barra de costado siempre a la vista (14 oct)
  useTablasAlAlto(pathname)
  const accentMod = MENU.find(m => m.to === '/' ? pathname === '/' : (pathname.startsWith(m.to) || (m.tambien || []).some(t => pathname.startsWith(t))))?.color

  // Color del proyecto activo: se inyecta como --accent en el contenido, asi los
  // botones, chips y el paginador se tiñen con el color de ESE proyecto. El menu
  // izquierdo no se toca (cada modulo conserva su propio color).
  const iProy = projects.findIndex(p => p.id === pid)
  const colorActivo = iProy >= 0 ? colorProyecto(projects[iProy], iProy) : null
  // el proyecto sobre el que trabajan las pantallas del menú (nunca "general")
  const iOp = projects.findIndex(p => p.id === pidOp)
  const proyOp = iOp >= 0 ? projects[iOp] : null
  // "todos los proyectos" (el total del Dashboard y de Clientes): no es un proyecto
  // más, así que el menú lo muestra aparte y en gris
  const enTotal = pid === 'general' && projects.length > 1
  // El total solo existe en Hoy y en el Dashboard. Las pantallas de UN proyecto
  // (mapa, pagos, ventas, gastos…) trabajan sobre el primero: al entrar a una de
  // ellas el menú pasa a ese proyecto, para no decir "todos" mientras se ve uno.
  const pantallaDeProyecto = MENU.some(m => m.proy && (pathname.startsWith(m.to) || (m.tambien || []).some(t => pathname.startsWith(t))))
  useEffect(() => {
    if (pid === 'general' && pidOp && pantallaDeProyecto) select(pidOp)
  }, [pid, pidOp, pantallaDeProyecto])   // eslint-disable-line

  const Item = m => (
    // "Ventas y contratos" también queda marcado cuando se está en /contratos
    <NavLink key={m.to} to={m.to} end={m.end} style={{ '--mi': m.color }}
      className={({ isActive }) => (isActive || (m.tambien || []).some(t => pathname.startsWith(t))) ? 'nav-item active' : 'nav-item'}>
      <span>{m.icon}</span> {m.label}{m.badge > 0 && <span className="nav-badge">{m.badge}</span>}
    </NavLink>
  )
  // la secretaria entra a Hoy (App.jsx): su Dashboard vive en /dashboard
  const delRol = m => (m.to === '/' && role === 'secretary' ? { ...m, to: '/dashboard', end: false } : m)
  const visibles = MENU.filter(verItem).map(delRol)

  // facturación no tiene otra pantalla: cualquier otra dirección la devuelve a la suya
  if (esFacturacion && !pathname.startsWith('/facturacion')) return <Navigate to="/facturacion" replace />

  return (
    <div className="shell">
      <button className="menu-toggle" onClick={() => setOpen(!open)}>☰</button>
      <aside className={`sidebar glass ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-badge"><Logo size={34} /></span>
          <span><b>URBIS GROUP</b><br /><small>REAL ESTATE</small></span>
        </div>
        <nav onClick={() => setOpen(false)}>
          {/* el rol ASESOR solo ve su chat de WhatsApp, nada más del CRM */}
          {role === 'asesor'
            ? MENU.filter(m => m.to === '/whatsapp').map(Item)
            : esFacturacion ? <>{Item({ ...MENU_FACTURACION, badge: pendFact })}{Item({ ...MENU_FACT_GASTOS, badge: pendGastos })}</>
            : (<>
                {/* EL PROYECTO: se elige una vez aquí y todas las pantallas de abajo
                    (lotes, pagos, ventas, gastos, comisiones) trabajan sobre él */}
                {proyOp && (
                  <div className={`proj-grp ${eligiendoProy ? 'open' : ''}`} style={{ '--pc': enTotal ? COLOR_TOTAL : colorProyecto(proyOp, iOp), marginBottom: 6 }}>
                    <p className="menu-section" style={{ marginTop: 0 }}>Proyecto</p>
                    {/* Dice la verdad de lo que está elegido: si Hoy o el Dashboard están en
                        "todos los proyectos", aquí también (antes seguía mostrando el primero) */}
                    <button type="button" className="proj-head on" title={projects.length > 1 ? 'Cambiar de proyecto' : proyOp.name}
                      onClick={e => { e.stopPropagation(); if (projects.length > 1) setEligiendoProy(a => !a) }}>
                      <span className="proj-dot" />
                      <span className="proj-name" title={enTotal ? 'Todos los proyectos' : proyOp.name}>{enTotal ? <>Todos los <b>proyectos</b></> : nombreProy(proyOp.name)}</span>
                      {projects.length > 1 && <span className={`proj-caret ${eligiendoProy ? 'open' : ''}`}>&#9656;</span>}
                    </button>
                    {/* la marca del proyecto elegido: cada uno se identifica con su logo
                        (el de quien factura si lo tiene: Praderas de Pucallpa = Century) */}
                    {!enTotal && logoProyecto(proyOp) && !eligiendoProy && (
                      <div className="proj-marca" title={proyOp.fact_razon_social || proyOp.name}>
                        <img src={logoProyecto(proyOp)} alt={proyOp.fact_razon_social || proyOp.name} />
                      </div>
                    )}
                    {/* Los demás proyectos van AL MISMO NIVEL, sin sangría: cada proyecto es
                        independiente, ninguno cuelga de otro (pedido del dueño, 1 oct). */}
                    {eligiendoProy && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
                        <p className="menu-section" style={{ margin: '0 0 2px' }}>Cambiar a</p>
                        {projects.filter(p => enTotal || p.id !== pidOp).map(p => {
                          const i = projects.indexOf(p)
                          return (
                            <button type="button" key={p.id} className="proj-head" style={{ '--pc': colorProyecto(p, i) }}
                              title={p.name} onClick={e => { e.stopPropagation(); select(p.id); setEligiendoProy(false) }}>
                              <span className="proj-dot" />
                              <span className="proj-name">{nombreProy(p.name)}</span>
                            </button>
                          )
                        })}
                        {!enTotal && (
                          <button type="button" className="proj-head" style={{ '--pc': COLOR_TOTAL }}
                            title="Ver el total de todos los proyectos (Hoy y Dashboard)"
                            onClick={e => { e.stopPropagation(); select('general'); setEligiendoProy(false) }}>
                            <span className="proj-dot" />
                            <span className="proj-name">Todos los <b>proyectos</b></span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* sueltos arriba: Hoy y el mapa de lotes */}
                {visibles.filter(m => !m.grupo).map(Item)}

                {ORDEN_GRUPOS.map(g => {
                  const hijos = visibles.filter(m => m.grupo === g)
                  if (!hijos.length) return null
                  // un grupo con una sola pantalla (Gastos, Reportes) va como ítem suelto
                  if (hijos.length === 1) return Item(hijos[0])
                  return (
                    <div key={g} className={`proj-grp ${grupoAbierto(g) ? 'open' : ''}`} style={{ '--pc': '#8a93a0' }}>
                      <button type="button" className="proj-head" onClick={e => { e.stopPropagation(); toggleGrupo(g) }}>
                        <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{ICONO_GRUPO[g]}</span>
                        <span className="proj-name">{g}</span>
                        <span className={`proj-caret ${grupoAbierto(g) ? 'open' : ''}`}>&#9656;</span>
                      </button>
                      {grupoAbierto(g) && <div className="proj-items">{hijos.map(Item)}</div>}
                    </div>
                  )
                })}
              </>)
          }
        </nav>
        {esAdmin && conectados.length > 0 && (
          // lista con scroll propio: aunque haya muchos conectados, nunca empuja el pie fuera de vista
          <div style={{ padding: '6px 14px', borderTop: '1px solid rgba(255,255,255,.08)', fontSize: 11, display: 'flex', flexDirection: 'column', maxHeight: '32vh', minHeight: 0 }}>
            <p className="muted" style={{ fontWeight: 700, letterSpacing: '.5px', margin: '0 0 4px', flexShrink: 0 }}>🟢 CONECTADOS ({conectados.length})</p>
            <div style={{ overflowY: 'auto', minHeight: 0 }}>
              {conectados.map(u => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '3px 0' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                    <Avatar url={u.avatar_url} nombre={u.full_name} size={20} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.full_name || '—'}</span>
                  </span>
                  <span className="muted" style={{ whiteSpace: 'nowrap' }}>{haceCuanto(u.online_since)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <Avatar url={profile?.avatar_url} nombre={profile?.full_name} size={30} title={profile?.full_name} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <p className="muted small" style={{ margin: 0, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={profile?.full_name}>{profile?.full_name}</p>
              <p className="muted" style={{ margin: 0, fontSize: 10, opacity: .75 }}>{role === 'superuser' ? 'SUPERUSUARIO' : role === 'operador' ? 'OPERADOR' : role === 'socio' ? 'SOCIO' : role === 'manager' ? 'GERENCIA (solo ver)' : role === 'admin' ? 'ADMINISTRADOR' : role === 'facturacion' ? 'FACTURACIÓN' : role === 'asesor' ? 'ASESOR' : 'SECRETARIA'}</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
            {/* sin correo de recuperación (el servidor no puede enviarlo): cada
                quien cambia aquí la contraseña que le dictaron */}
            <a className="btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }}
              href={import.meta.env.BASE_URL + 'reset'} title="Cambiar mi contraseña">🔑 Mi contraseña</a>
            <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }} onClick={logout}>Cerrar sesión</button>
            <InstalarApp />
          </div>
        </div>
      </aside>
      <main className="content" style={{
        '--accent-mod': accentMod,
        ...(colorActivo ? {
          '--accent': colorActivo,
          '--accent-strong': `color-mix(in srgb, ${colorActivo} 62%, #ffffff)`,
        } : {}),
      }}>
        {/* LO QUE ESPERA A ESTA PERSONA EN GASTOS (10 oct, pedido del dueño): al entrar
            al sistema, tarjetas con el total por firmar y por pagar; cada una lleva a
            Gastos del proyecto, ya elegido. En las demás pantallas, la franja corta. En
            Gastos no va: ahí está "Te toca" con sus botones. */}
        {(porFirmar.length > 0 || porPagar.length > 0) && !pathname.startsWith('/gastos') && (
          ['/', '/hoy', '/dashboard'].includes(pathname)
            ? <TarjetasPendientes porFirmar={porFirmar} porPagar={porPagar} esSocia={role === 'socio'}
                onIr={pidIr => { select(pidIr); irA('/gastos') }} />
            : <>
                {porFirmar.length > 0 && (
                  <div className="glass" style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderLeft: '4px solid #e8b04f' }}>
                    <b>✍ Esperan tu firma:</b>
                    {porFirmar.map(p => (
                      <button key={p.id} className="btn-primary" style={{ fontSize: 12 }}
                        onClick={() => { select(p.id); irA('/gastos') }}>{p.name} · {p.n} · {solesMenu(p.total)}</button>
                    ))}
                  </div>
                )}
                {porPagar.length > 0 && (
                  <div className="glass" style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderLeft: '4px solid #6fdd9b' }}>
                    <b>💸 Por pagar · sube el voucher:</b>
                    {porPagar.map(p => (
                      <button key={p.id} className="btn-primary" style={{ fontSize: 12 }}
                        onClick={() => { select(p.id); irA('/gastos') }}>{p.name} · {p.n} · {solesMenu(p.total)}</button>
                    ))}
                  </div>
                )}
              </>
        )}
        {/* cada pantalla se baja al abrirla (App.jsx): mientras llega, el menu queda quieto */}
        <Suspense fallback={<p className="muted" style={{ padding: '1rem 0' }}>Cargando…</p>}>
          <Outlet />
        </Suspense>
      </main>
      <VolverArriba />
      <SaveFx />
    </div>
  )
}
