import { useState, useEffect, useRef, Suspense } from 'react'
import { NavLink, Outlet, useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useProject, colorProyecto, logoProyecto, gruposPorEmpresa, nombreEmpresa, empresaDe, PID_EMPRESA } from '../context/ProjectContext'
import '../styles/menu.css'
import { supabase } from '../lib/supabase'
import Logo from './Logo'
import Avatar from './Avatar'
import SaveFx from './SaveFx'
import InstalarApp from './InstalarApp'
import Preferencias from './Preferencias'
import DescargarApp from './DescargarApp'
import BarraVendedor from './BarraVendedor'
import SubidasEnCurso from './SubidasEnCurso'
import { SiluetaPagina } from './Silueta'
import Atajos from './Atajos'
import { enApp, avisarApp, escucharApp, avisosNuevos } from '../lib/appEscritorio'
import BuscadorGeneral from './BuscadorGeneral'
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
  // quién recibe avisos de cobranza (clientes y leads) y qué aviso le toca (sql/159)
  // lotes con deuda + Excel de cuotas vencidas (sql/156): la pantalla del facturador, también para el superusuario
  { to: '/facturacion/deudores', label: 'Lotes con deuda', icon: '⏰', admin: true, color: '#e05252', grupo: 'Cobranza' },
  // cartas a los clientes con cuotas vencidas: la secretaria las crea, la socia las firma (sql/155).
  // `siempre`: la ve todo el equipo aunque tenga los paneles recortados (la socia tiene que firmar)
  { to: '/cartas', label: 'Cartas de cobranza', icon: '📨', color: '#e0b23f', proy: true, siempre: true, grupo: 'Cobranza' },

  // precios, iniciales y cuotas de cada lote para cotizar y mandar por WhatsApp (sql/181).
  // `siempre`: lo ve todo el equipo aunque tenga los paneles recortados; el asesor también
  // seguimiento de leads (sql/190): el vendedor ve solo los suyos; el equipo, todos, y los reparte
  { to: '/prospectos', label: 'Prospectos', icon: '🎯', color: '#f08fb0', grupo: 'Ventas' },
  { to: '/vendedor', label: 'Panel del vendedor', icon: '🏷️', color: '#f0c05a', proy: true, siempre: true, grupo: 'Ventas' },
  // ventas y contratos en una sola lista (antes dos pantallas con casi la misma tabla)
  { to: '/ventas', label: 'Ventas y contratos', icon: '📄', color: '#7bb6e0', proy: true, grupo: 'Ventas', tambien: ['/contratos'] },
  { to: '/clientes', label: 'Clientes', icon: '👥', color: '#b792e8', grupo: 'Ventas' },
  { to: '/equipo-ventas', label: 'Vendedores', icon: '🧑‍💼', admin: true, color: '#f08fb0', grupo: 'Ventas' },
  { to: '/comisiones', label: 'Comisiones', icon: '🪙', color: '#e8b04f', proy: true, grupo: 'Ventas' },

  { to: '/gastos', label: 'Gastos', icon: '🧾', color: '#f2785c', proy: true, grupo: 'Gastos', tambien: ['/facturas-gastos'] },

  { to: '/whatsapp', label: 'WhatsApp', icon: '💬', color: '#58c482', grupo: 'Comercial' },   // bandeja para todo el equipo (RLS filtra los chats)
  { to: '/visitas', label: 'Visitas', icon: '📅', color: '#7ba7f7', grupo: 'Comercial' },
  { to: '/secretarias', label: 'Tareas del equipo', icon: '🗓️', color: '#e8a0c8', grupo: 'Comercial' },
  { to: '/campanas', label: 'Campañas', icon: '📣', staff: true, color: '#f0a35c', grupo: 'Comercial' },
  { to: '/corretaje', label: 'Corretaje', icon: '🏘️', staff: true, color: '#6fd1c0', grupo: 'Comercial' },
  // lo que los clientes registran en la web /libro-de-reclamaciones (sql/230). `siempre`: a admin y
  // superusuario no se les recorta por paneles (el plazo legal de respuesta corre igual)
  { to: '/reclamos', label: 'Libro de reclamaciones', icon: '📕', staff: true, siempre: true, color: '#e06c6c', grupo: 'Comercial' },

  { to: '/', label: 'Dashboard', icon: '📊', end: true, color: '#56c7d6', grupo: 'Reportes' },
  // cuánta gente entra a la portada, a cada landing y a los recorridos, y cuántos escriben (sql/231)
  { to: '/visitas-web', label: 'Visitas de la web', icon: '🌐', staff: true, siempre: true, color: '#4a87c9', grupo: 'Reportes' },

  { to: '/proyectos', label: 'Proyectos', icon: '🏗️', color: '#e7c15a', grupo: 'Configuración' },
  // el experimento del agente de ventas IA contra el supervisor (sql/91)
  { to: '/ventas-ia', label: 'Agente de ventas', icon: '🤖', admin: true, color: '#8ab4f8', grupo: 'Configuración' },
  // cada llamada a Claude con su costo (sql/205): en qué se va el saldo de la API
  { to: '/uso-ia', label: 'Uso de la IA', icon: '🧮', admin: true, color: '#8ab4f8', grupo: 'Configuración' },
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
const MENU_FACT_CARTAS = { to: '/facturacion/cartas', label: 'Cartas de cobranza', icon: '📨', color: '#e0b23f' }
const MENU_FACT_DEUDORES = { to: '/facturacion/deudores', label: 'Lotes con deuda', icon: '⏰', color: '#e05252' }
// Los grupos, en orden. Un grupo con un solo ítem visible se muestra como ítem suelto.
const COLOR_TOTAL = '#9aa896'   // el gris de "todos los proyectos", el mismo del selector de las pantallas
// las secciones de la barra (26 nov), en orden; lo que no está aquí va a "Más herramientas"
const ORDEN_PROY = ['/lotes', '/ventas', '/pagos', '/gastos', '/cartas', '/comisiones', '/vendedor']
const ORDEN_DIA = ['/hoy', '/', '/dashboard', '/whatsapp', '/clientes', '/prospectos', '/visitas', '/secretarias', '/cobranza-ia', '/facturacion/deudores']
// la letra del proyecto cuando no tiene logo: "LAS PRADERAS DE CASHIBO" → "P"
const inicialProy = n => (String(n || '').replace(/^(las|los|el|la)\s+/i, '').trim().charAt(0) || '?').toUpperCase()
// Paneles que el superusuario puede habilitar/ocultar por usuario (excluye los solo-superusuario).
// Cobranza IA no va en esta lista: no la abre un panel sino el permiso especial.
// Los que van por permiso especial (la planilla) tampoco: se dan con su propia casilla.
export const PANELS = MENU.filter(m => !m.admin && !m.corrige && !m.cobranza && !m.permiso && !m.siempre && !m.fact && m.to !== '/').map(m => ({ to: m.to, label: m.label, icon: m.icon }))

export default function Layout() {
  const { profile, role, esSuper, puedeCorregir, esJefe, logout } = useAuth()
  const { projects, pid, pidOp, select, esTotal, empresaSel } = useProject()
  const [open, setOpen] = useState(false)
  const [eligiendoProy, setEligiendoProy] = useState(false)   // la lista de proyectos, desplegada
  const [verConectados, setVerConectados] = useState(false)   // la lista de conectados, desplegada
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
      const COLS = 'project_id, requester_id, requester_signed_at, amount, project:projects!inner(name, expense_approval)'
      const consulta = cols => {
        const base = supabase.from('expenses').select(cols)
          .eq('status', 'solicitado').is('approved_at', null).is('rejected_at', null).limit(200)
        return esSocio ? base.eq('project.expense_approval', true) : base.eq('requester_id', profile.id).is('requester_signed_at', null)
      }
      // con la firma en papel (sql/183) no le toca a nadie en el panel; sin ese SQL, como antes
      let { data, error } = await consulta(COLS + ', requester_papel, approval_papel')
      if (error) ({ data, error } = await consulta(COLS))
      if (!vivo || error) return       // sql/74 sin correr: el aviso no aparece y ya
      const m = {}
      for (const r of (data || [])) {
        // al socio no se le cuenta lo que todavia no firmo el solicitante (ni lo que se
        // registró sin solicitante, sql/136): no es su turno, y un contador que no
        // puede bajar deja de significar algo
        if (esSocio && (!r.requester_id || !r.requester_signed_at)) continue
        // una firma en papel se sube con la hoja: no es "te toca firmar" (sql/183)
        if (esSocio ? r.approval_papel : r.requester_papel) continue
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

  // cartas de cobranza que esperan algo de esta persona (sql/155): la socia, las que le
  // toca firmar; las secretarias, las firmadas por entregar y las de plazo vencido;
  // facturación, las que esperan la firma. Sin sql/155 la función no existe y no se ve nada.
  const [pendCartas, setPendCartas] = useState(0)
  useEffect(() => {
    if (!profile?.id || role === 'asesor') return
    let vivo = true
    const contar = () => supabase.rpc('cartas_pendientes').then(({ data, error }) => {
      if (!vivo || error || !data) return
      setPendCartas(role === 'socio' ? data.por_firmar
        : role === 'facturacion' ? data.pendientes_firma_ver
        : (data.por_entregar || 0) + (data.plazo_vencido || 0))
    })
    contar()
    const t = setInterval(() => { if (!document.hidden) contar() }, 60000)
    return () => { vivo = false; clearInterval(t) }
  }, [role, profile?.id])

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
  // "todos los proyectos" (el total del Dashboard y de Clientes) o "Todo Century": no es
  // un proyecto más, así que el menú lo muestra aparte y en gris
  const enTotal = esTotal && projects.length > 1
  // la lista separada por empresa, CENTURY y URBIS (11 nov), si hay más de una
  const gruposEmp = gruposPorEmpresa(projects)
  const conEmpresas = gruposEmp.length > 1
  // El total solo existe en Hoy y en el Dashboard. Las pantallas de UN proyecto
  // (mapa, pagos, ventas, gastos…) trabajan sobre el primero: al entrar a una de
  // ellas el menú pasa a ese proyecto, para no decir "todos" mientras se ve uno.
  const pantallaDeProyecto = MENU.some(m => m.proy && (pathname.startsWith(m.to) || (m.tambien || []).some(t => pathname.startsWith(t))))
  useEffect(() => {
    if (esTotal && pidOp && pantallaDeProyecto) select(pidOp)
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
  // el VENDEDOR: cuántos prospectos le tocan hoy o tiene vencidos (sql/190-191). La base
  // solo le deja ver los suyos, así que basta contar. Cada minuto y al volver a la pestaña.
  const [pendProsp, setPendProsp] = useState(0)
  useEffect(() => {
    if (!profile?.id || role !== 'asesor') return
    let vivo = true
    const contar = () => supabase.from('leads').select('id', { count: 'exact', head: true })
      .in('status', ['nuevo', 'contactado', 'interesado', 'visita_agendada', 'negociacion'])
      .lte('next_action_date', new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }))
      .then(({ count, error }) => { if (vivo && !error) setPendProsp(count || 0) })
    contar()
    const t = setInterval(() => { if (!document.hidden) contar() }, 60000)
    const alVolver = () => { if (!document.hidden) contar() }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('urbis-prospectos', contar)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', alVolver); window.removeEventListener('urbis-prospectos', contar) }
  }, [role, profile?.id])

  // libro de reclamaciones (sql/230): cuántas hojas esperan respuesta. Solo admin y superusuario
  // (la tabla no le deja leer a nadie más). Sin sql/230 la tabla no existe y no se ve nada.
  const [pendReclamos, setPendReclamos] = useState(0)
  useEffect(() => {
    if (!profile?.id || !['admin', 'superuser'].includes(role)) return
    let vivo = true
    const contar = () => supabase.from('libro_reclamaciones').select('id', { count: 'exact', head: true }).is('respuesta_at', null)
      .then(({ count, error }) => { if (vivo && !error) setPendReclamos(count || 0) })
    contar()
    const t = setInterval(() => { if (!document.hidden) contar() }, 120000)
    return () => { vivo = false; clearInterval(t) }
  }, [role, profile?.id, pathname === '/reclamos'])   // eslint-disable-line

  // AVISOS DE WINDOWS (app de escritorio v1.2, lib/appEscritorio.js): lo pendiente que SUBE
  // se le avisa a la app, que lo muestra aunque esté minimizada. En el navegador no hace nada.
  const avisados = useRef(new Map())
  useEffect(() => {
    if (!enApp()) return
    const lista = []
    const cuantas = (n, una, varias) => n + ' ' + (n === 1 ? una : varias)
    porFirmar.forEach(p => lista.push({ clave: 'firma:' + p.id, n: p.n,
      titulo: role === 'socio' ? '✍ Gastos por aprobar' : '✍ Gastos por firmar',
      texto: `${p.name}: ${cuantas(p.n, 'solicitud', 'solicitudes')} por firmar · ${solesMenu(p.total)}`, ir: { a: '/gastos', proyecto: p.id } }))
    porPagar.forEach(p => lista.push({ clave: 'pago:' + p.id, n: p.n, titulo: '💸 Gastos por pagar',
      texto: `${p.name}: ${cuantas(p.n, 'gasto aprobado', 'gastos aprobados')} esperan el voucher · ${solesMenu(p.total)}`, ir: { a: '/gastos', proyecto: p.id } }))
    if (pendCartas > 0) lista.push({ clave: 'cartas', n: pendCartas, titulo: '📨 Cartas de cobranza',
      texto: cuantas(pendCartas, 'carta pendiente', 'cartas pendientes'), ir: { a: esFacturacion ? '/facturacion/cartas' : '/cartas' } })
    if (pendReclamos > 0) lista.push({ clave: 'reclamos', n: pendReclamos, titulo: '📕 Libro de reclamaciones',
      texto: cuantas(pendReclamos, 'reclamo por responder', 'reclamos por responder'), ir: { a: '/reclamos' } })
    if (pendProsp > 0) lista.push({ clave: 'prospectos', n: pendProsp, titulo: '🎯 Prospectos',
      texto: cuantas(pendProsp, 'prospecto para hoy', 'prospectos para hoy'), ir: { a: '/prospectos' } })
    if (esFacturacion && pendFact > 0) lista.push({ clave: 'fact', n: pendFact, titulo: '🧾 Boletas y facturas',
      texto: cuantas(pendFact, 'pago sin comprobante', 'pagos sin comprobante'), ir: { a: '/facturacion' } })
    avisosNuevos(lista, avisados.current).forEach(avisarApp)
  }, [porFirmar, porPagar, pendCartas, pendReclamos, pendProsp, pendFact])   // eslint-disable-line
  // al tocar un aviso, la app pide venir aquí: se elige el proyecto y se abre la pantalla
  useEffect(() => escucharApp(m => {
    if (m.tipo !== 'ir' || !m.a || !String(m.a).startsWith('/')) return
    if (m.proyecto) select(m.proyecto)
    irA(m.a)
  }), [])   // eslint-disable-line

  const visibles = MENU.filter(verItem).map(delRol).map(m => m.to === '/cartas' ? { ...m, badge: pendCartas } : m.to === '/reclamos' ? { ...m, badge: pendReclamos } : m)

  // LA BARRA POR SECCIONES (26 nov): "En este proyecto" (lo que trabaja sobre el proyecto
  // elegido), "Día a día" (lo de todos) y "Más herramientas" (configuración y
  // administración, plegado). Cada quien ve solo lo que su rol y sus paneles le abren.
  const secProy = ORDEN_PROY.map(to => visibles.find(m => m.to === to)).filter(Boolean)
  const secDia = ORDEN_DIA.map(to => visibles.find(m => m.to === to)).filter(Boolean)
  const secMas = visibles.filter(m => !secProy.includes(m) && !secDia.includes(m))
  const [masPref, setMasPref] = useState(() => { try { return localStorage.getItem('urbis.menu.mas') === '1' } catch { return false } })
  const enMas = secMas.some(m => m.to !== '/' && (pathname.startsWith(m.to) || (m.tambien || []).some(t => pathname.startsWith(t))))
  const masAbierto = masPref || enMas
  const cambiarMas = () => setMasPref(a => { const v = !masAbierto; try { localStorage.setItem('urbis.menu.mas', v ? '1' : '0') } catch { /* sin memoria */ } return v })
  const badgeMas = secMas.reduce((s, m) => s + (m.badge || 0), 0)

  // facturación no tiene otra pantalla: cualquier otra dirección la devuelve a la suya
  if (esFacturacion && !pathname.startsWith('/facturacion')) return <Navigate to="/facturacion" replace />

  return (
    <div className={role === 'asesor' ? 'shell shell-vend' : 'shell'}>
      <button className="menu-toggle" onClick={() => setOpen(!open)}>☰</button>
      <aside className={`sidebar glass ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-badge"><Logo size={34} /></span>
          <span><b>URBIS GROUP</b><br /><small>REAL ESTATE</small></span>
        </div>
        {/* el buscador general (components/BuscadorGeneral.jsx): también con Ctrl+K o "/" */}
        {!esFacturacion && role !== 'asesor' && (
          <button type="button" className="buscar-btn" onClick={() => { setOpen(false); window.dispatchEvent(new Event('urbis-buscar')) }}
            title="Buscar lotes, clientes, gastos y pantallas (Ctrl+K)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <span>Buscar…</span><kbd>Ctrl K</kbd>
          </button>
        )}
        <nav onClick={() => setOpen(false)}>
          {/* el VENDEDOR (rol asesor) solo ve sus prospectos, sus chats de WhatsApp y el panel
              de precios y cuotas (sin datos de clientes), nada más del CRM */}
          {role === 'asesor'
            ? ['/prospectos', '/whatsapp', '/vendedor'].map(to => MENU.find(m => m.to === to)).filter(Boolean)
                .map(m => Item(m.to === '/prospectos' ? { ...m, label: 'Mis prospectos', badge: pendProsp } : m))
            : esFacturacion ? <>{Item({ ...MENU_FACTURACION, badge: pendFact })}{Item({ ...MENU_FACT_GASTOS, badge: pendGastos })}{Item({ ...MENU_FACT_CARTAS, badge: pendCartas })}{Item(MENU_FACT_DEUDORES)}</>
            : (<>
                {/* EL PROYECTO, ARRIBA Y GRANDE (26 nov, pedido del dueño: "más cerrado por
                    proyecto"): su logo, su empresa y su nombre. Se elige una vez aquí y las
                    pantallas de "En este proyecto" trabajan sobre él. Dice la verdad de lo que está
                    elegido: si Hoy o el Dashboard están en "todos los proyectos", aquí también. */}
                {proyOp && (
                  <div className={'mn-proy' + (eligiendoProy ? ' open' : '') + (enTotal ? ' total' : '')} style={{ '--pc': enTotal ? COLOR_TOTAL : colorProyecto(proyOp, iOp) }}>
                    <button type="button" className="mn-proy-head" title={projects.length > 1 ? 'Cambiar de proyecto' : proyOp.name}
                      onClick={e => { e.stopPropagation(); if (projects.length > 1) setEligiendoProy(a => !a) }}>
                      {/* la marca: el logo de quien factura si lo tiene (Praderas de Pucallpa = Century) */}
                      <span className="mn-proy-logo">
                        {!enTotal && logoProyecto(proyOp)
                          ? <img src={logoProyecto(proyOp)} alt={proyOp.fact_razon_social || proyOp.name} />
                          : <span>{enTotal ? '∑' : inicialProy(proyOp.name)}</span>}
                      </span>
                      <span className="mn-proy-txt">
                        <small>{enTotal ? 'Vista general' : 'Proyecto · ' + empresaDe(proyOp)}</small>
                        <b title={enTotal ? (empresaSel ? 'Todo ' + nombreEmpresa(empresaSel) : 'Todos los proyectos') : proyOp.name}>
                          {enTotal ? (empresaSel ? 'Todo ' + nombreEmpresa(empresaSel) : 'Todos los proyectos') : proyOp.name}
                        </b>
                      </span>
                      {projects.length > 1 && <span className={'mn-proy-caret' + (eligiendoProy ? ' open' : '')} aria-hidden="true">&#9662;</span>}
                    </button>
                    {/* Los proyectos van AL MISMO NIVEL, sin sangría: cada proyecto es
                        independiente, ninguno cuelga de otro (pedido del dueño, 1 oct). Desde el
                        11 nov se separan por EMPRESA: CENTURY (Praderas de Pucallpa) y URBIS
                        (los demás), cada una con su total si tiene dos o más proyectos. */}
                    {eligiendoProy && (() => {
                      const ir = v => e => { e.stopPropagation(); select(v); setEligiendoProy(false) }
                      const botonProy = (p, i) => (
                        <button type="button" key={p.id} className={'proj-head' + (!enTotal && p.id === pidOp ? ' actual' : '')} style={{ '--pc': colorProyecto(p, i) }}
                          title={p.name} onClick={ir(p.id)}>
                          <span className="proj-dot" />
                          <span className="proj-name">{nombreProy(p.name)}</span>
                          {!enTotal && p.id === pidOp && <span className="proj-check">&#10003;</span>}
                        </button>
                      )
                      const botonTotal = (v, texto, titulo) => pid === v ? null : (
                        <button type="button" key={v} className="proj-head" style={{ '--pc': COLOR_TOTAL }} title={titulo} onClick={ir(v)}>
                          <span className="proj-dot" />
                          <span className="proj-name">{texto}</span>
                        </button>
                      )
                      return (
                        <div className="mn-proy-lista">
                          <p className="menu-section" style={{ margin: '0 0 2px' }}>Cambiar a</p>
                          {conEmpresas
                            ? gruposEmp.map(g => (
                              <div key={g.empresa} className="proj-empresa-grp">
                                <p className="proj-empresa">{g.empresa}</p>
                                {g.items.map(({ p, i }) => botonProy(p, i))}
                                {g.items.length > 1 && botonTotal(PID_EMPRESA + g.empresa, <>Todo <b>{nombreEmpresa(g.empresa)}</b></>,
                                  'Ver el total de los proyectos de ' + nombreEmpresa(g.empresa) + ' (Hoy y Dashboard)')}
                              </div>
                            ))
                            : projects.filter(p => enTotal || p.id !== pidOp).map(p => botonProy(p, projects.indexOf(p)))}
                          {botonTotal('general', <>Todos los <b>proyectos</b></>, 'Ver el total de todos los proyectos (Hoy y Dashboard)')}
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* EN ESTE PROYECTO: lo que trabaja sobre el proyecto de arriba, siempre a la
                    vista y del color del proyecto */}
                {secProy.length > 0 && (
                  <div className="mn-sec mn-sec-proy" style={{ '--pc': enTotal || !proyOp ? COLOR_TOTAL : colorProyecto(proyOp, iOp) }}>
                    <p className="mn-cab"><i />{enTotal ? 'Por proyecto' : 'En este proyecto'}</p>
                    {secProy.map(Item)}
                  </div>
                )}

                {/* DÍA A DÍA: lo de todos los proyectos */}
                {secDia.length > 0 && (
                  <div className="mn-sec">
                    <p className="mn-cab">Día a día</p>
                    {secDia.map(Item)}
                  </div>
                )}

                {/* MÁS HERRAMIENTAS: configuración y administración, plegado (se abre solo si
                    se está en una de sus pantallas) */}
                {secMas.length > 0 && (
                  <div className={'mn-sec mn-mas' + (masAbierto ? ' open' : '')}>
                    <button type="button" className="mn-cab mn-cab-btn" aria-expanded={masAbierto}
                      onClick={e => { e.stopPropagation(); cambiarMas() }}>
                      <span>Más herramientas</span>
                      {!masAbierto && badgeMas > 0 && <span className="nav-badge">{badgeMas}</span>}
                      <span className={'proj-caret' + (masAbierto ? ' open' : '')}>&#9656;</span>
                    </button>
                    {masAbierto && secMas.map(Item)}
                  </div>
                )}
              </>)
          }
        </nav>
        {esAdmin && conectados.length > 0 && (
          // 26 nov: compacto (una fila de caritas) para dejarle el alto al menú; al tocarlo se
          // despliega la lista con nombres. La lista tiene scroll propio y nunca empuja el pie.
          <div className={'mn-conectados' + (verConectados ? ' open' : '')}>
            <button type="button" className="mn-conectados-cab" onClick={() => setVerConectados(v => !v)}
              title={conectados.map(u => u.full_name).filter(Boolean).join(', ')} aria-expanded={verConectados}>
              <span className="mn-punto" />
              <span className="mn-conectados-n">{conectados.length} {conectados.length === 1 ? 'conectado' : 'conectados'}</span>
              {!verConectados && (
                <span className="mn-caritas">
                  {conectados.slice(0, 5).map(u => <Avatar key={u.id} url={u.avatar_url} nombre={u.full_name} size={20} />)}
                  {conectados.length > 5 && <small>+{conectados.length - 5}</small>}
                </span>
              )}
              <span className={'proj-caret' + (verConectados ? ' open' : '')}>&#9656;</span>
            </button>
            {verConectados && <div style={{ overflowY: 'auto', minHeight: 0 }}>
              {conectados.map(u => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '3px 0' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                    <Avatar url={u.avatar_url} nombre={u.full_name} size={20} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.full_name || '—'}</span>
                  </span>
                  <span className="muted" style={{ whiteSpace: 'nowrap' }}>{haceCuanto(u.online_since)}</span>
                </div>
              ))}
            </div>}
          </div>
        )}
        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <Avatar url={profile?.avatar_url} nombre={profile?.full_name} size={30} title={profile?.full_name} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <p className="muted small" style={{ margin: 0, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={profile?.full_name}>{profile?.full_name}</p>
              <p className="muted" style={{ margin: 0, fontSize: 10, opacity: .75 }}>{role === 'superuser' ? 'SUPERUSUARIO' : role === 'operador' ? 'OPERADOR' : role === 'socio' ? 'SOCIO' : role === 'manager' ? 'GERENCIA (solo ver)' : role === 'admin' ? 'ADMINISTRADOR' : role === 'facturacion' ? 'SECRETARIA SOCIA' : role === 'asesor' ? 'VENDEDOR' : 'SECRETARIA'}</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
            {/* sin correo de recuperación (el servidor no puede enviarlo): cada
                quien cambia aquí la contraseña que le dictaron */}
            <a className="btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }}
              href={import.meta.env.BASE_URL + 'reset'} title="Cambiar mi contraseña">🔑 Mi contraseña</a>
            <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }} onClick={logout}>Cerrar sesión</button>
            <Preferencias />
            <DescargarApp />
            <InstalarApp />
          </div>
        </div>
      </aside>
      <main className={'content' + (pathname.startsWith('/whatsapp') ? ' tema-oscuro' : '')} style={{
        '--accent-mod': accentMod,
        ...(colorActivo ? {
          '--accent': colorActivo,
          '--accent-strong': `color-mix(in srgb, ${colorActivo} 62%, #ffffff)`,
        } : {}),
      }}>
        {/* LA FRANJA DEL PROYECTO (26 nov): en las pantallas de un proyecto (mapa, ficha del
            lote, ventas, pagos, gastos…) queda claro DENTRO de cuál se está trabajando */}
        {pantallaDeProyecto && proyOp && !enTotal && (
          <div className="proy-banda" style={{ '--pc': colorProyecto(proyOp, iOp) }}>
            <span className="proy-banda-logo">
              {logoProyecto(proyOp) ? <img src={logoProyecto(proyOp)} alt="" /> : <span>{inicialProy(proyOp.name)}</span>}
            </span>
            <span className="proy-banda-txt">
              <small>{empresaDe(proyOp)}</small>
              <b>{proyOp.name}</b>
            </span>
            {projects.length > 1 && (
              <button type="button" className="proy-banda-cambiar" onClick={() => { setEligiendoProy(true); setOpen(true) }}>Cambiar<span className="pb-largo"> proyecto</span></button>
            )}
          </div>
        )}
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
        <Suspense fallback={<SiluetaPagina />}>
          <Outlet />
        </Suspense>
      </main>
      {role === 'asesor' && <BarraVendedor pendientes={pendProsp} onCuenta={() => setOpen(o => !o)} />}
      <VolverArriba />
      <SubidasEnCurso />
      {!esFacturacion && role !== 'asesor' && <BuscadorGeneral pantallas={visibles} />}
      {!esFacturacion && role !== 'asesor' && <Atajos pantallasProyecto={secProy} />}
      <SaveFx />
    </div>
  )
}
