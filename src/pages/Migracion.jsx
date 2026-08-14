// ============================================================================
// CARGA DE ARCHIVOS DE MIGRACIÓN
// ----------------------------------------------------------------------------
// Los proyectos que entran al sistema traen años de vouchers, boletas, contratos
// y DNI guardados en Drive, organizados por lote:
//
//   EL TRIUNFO DE NESHUYA/
//     MZ A LT 10-LUCERO ZAVALETA/
//       VOUCHERS/    CUOTA 01.jpg · INICIAL.jpg · SEPARACION.jpeg
//       BOLETAS/     CUOTA 01.pdf
//       DOCUMENTOS/  CONTRATO ... .pdf
//       DNI/         dni.jpg
//
// Subirlos a mano es imposible (cientos de archivos). Esta pantalla lee la
// carpeta bajada del Drive, deduce del NOMBRE a qué pago corresponde cada
// archivo, muestra el plan para que lo revises ANTES de tocar nada, y recién
// entonces sube y engancha todo. Usa tu propia sesión: no hay llaves ni
// secretos que manejar.
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { subirRuta } from '../lib/archivos'
import { useMsg } from '../lib/saveFx'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'

const CARPETAS = { VOUCHERS: 'voucher', BOLETAS: 'comprobante', DOCUMENTOS: 'contrato', DNI: 'dni' }
const DESTINO_LBL = {
  voucher: 'Voucher del cliente', comprobante: 'Comprobante interno', contrato: 'Contrato firmado', dni: 'DNI del cliente',
  'gasto-constancia': 'Constancia del gasto', 'gasto-sustento': 'Sustento del gasto (RxH / factura)',
}
// Los documentos de EGRESOS no viven en la carpeta del lote sino en
// DOCUMENTOS ADMINISTRATIVOS, ordenados por año y mes. Cada gasto tiene dos
// espacios en el sistema: la constancia firmada y el sustento (RxH o factura).
const CARPETAS_GASTO = [
  [/CONSTANCIAS?\s+DE\s+RECEPCION/, 'gasto-constancia'],
  [/ESCANEO\s+DE\s+CONSTANCIAS/, 'gasto-constancia'],
  [/RXH\s*Y\s*FAC|RXH|FACTURAS?/, 'gasto-sustento'],
  [/VOUCHER\s+DE\s+DEPOSITOS/, 'gasto-sustento'],
]
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SETIEMBRE', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']
const MES_NUM = { ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SETIEMBRE: 9, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 }

// Todos los lotes que menciona un texto. Aguanta las formas reales que usa la
// secretaria: "MZ B LT 16", "MZ. D LT. 04", "MZ A LT 8 Y 9" (dos lotes) y hasta
// "MZ 7 LT B", que está al revés.
function lotesEn(texto) {
  const t = sinTildes(texto).replace(/\./g, ' ')
  const out = []
  for (const m of t.matchAll(/MZ\s*([A-Z0-9]+)\s+LT\s*([A-Z0-9]+((?:\s+Y\s+\d+)*))/g)) {
    let mz = m[1], resto = m[2]
    const nums = [...resto.matchAll(/\d+/g)].map(x => String(Number(x[0])))
    const letra = /^[A-Z]$/.test(mz) ? mz : (resto.match(/^[A-Z]$/) ? resto : null)
    if (/^[A-Z]$/.test(mz)) { for (const n of nums) out.push(mz + '-' + n) }
    else if (letra) out.push(letra + '-' + String(Number(mz)))   // venía al revés
  }
  return [...new Set(out)]
}
const CONCEPTOS = [
  [/COMISION/, 'PAGO DE COMISION'],
  [/TOPOGRAF|RETROEXCAVADORA|LEVANTAMIENTO|ESPECIALISTA|DESARROLLO/, 'GASTOS DE DESARROLLO'],
  [/ADMINISTRATIV|VIATICO|COMIDA|COMBUSTIBLE|SUELDO|MOVILIDAD/, 'GASTOS ADMINISTRATIVOS'],
]
const conceptoDe = txt => (CONCEPTOS.find(([re]) => re.test(sinTildes(txt))) || [])[1] || null
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
const limpio = s => sinTildes(s).replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()

// De la ruta del archivo saca el lote, la carpeta y el nombre.
// "…/MZ A LT 10-LUCERO/VOUCHERS/CUOTA 01.jpg" -> { mz:'A', lt:'10', carpeta:'voucher', nombre:'CUOTA 01.jpg' }
function leerRuta(ruta) {
  const partes = String(ruta).split('/').filter(Boolean)
  const nombre = partes[partes.length - 1]
  let lote = null, carpeta = null, gasto = null, anio = null, mes = null
  for (const p of partes.slice(0, -1)) {
    const s = sinTildes(p).trim()
    const m = s.match(/MZ\s*([A-Z]+)\s*LT\s*0*(\d+)/)
    if (m && !lote) lote = { mz: m[1], lt: m[2] }
    const c = CARPETAS[s]
    if (c) carpeta = c
    for (const [re, tipo] of CARPETAS_GASTO) if (!gasto && re.test(s)) gasto = tipo
    const a = s.match(/\b(20\d\d)\b/); if (a) anio = Number(a[1])
    const mm = MESES.find(x => s.includes(x)); if (mm) mes = MES_NUM[mm]
  }
  return { lote, carpeta, gasto, anio, mes, nombre }
}

// Qué pago cubre este archivo, según cómo lo nombró la secretaria.
function leerNombre(nombre) {
  const n = sinTildes(nombre)
  if (/^IMPRIMIR/.test(n)) return { tipo: 'ignorar', motivo: 'es la hoja para imprimir, no un voucher' }
  if (/CONTRATO/.test(n)) return { tipo: 'contrato' }
  if (/SEPARACION/.test(n)) return { tipo: 'separacion' }
  if (/CUOTA/.test(n)) {
    const cuotas = [...n.matchAll(/(\d+)/g)].map(x => Number(x[1])).filter(x => x >= 1 && x <= 120)
    return cuotas.length ? { tipo: 'cuota', cuotas } : { tipo: 'desconocido' }
  }
  if (/INICIAL|INICIA\b/.test(n)) return { tipo: 'inicial' }
  if (/DNI|DOCUMENTO/.test(n)) return { tipo: 'dni' }
  return { tipo: 'desconocido' }
}

export default function Migracion() {
  const { role, profile } = useAuth()
  const { pidOp, projects } = useProject()
  const [datos, setDatos] = useState(null)
  const [archivos, setArchivos] = useState([])
  const [reemplazar, setReemplazar] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [progreso, setProgreso] = useState({ hechos: 0, total: 0, actual: '' })
  const [errores, setErrores] = useState([])
  const [listo, setListo] = useState(null)
  const [ver, setVer] = useState('listos')
  const [manual, setManual] = useState({})   // ruta del archivo -> id del gasto elegido a mano
  const [msg, setMsg] = useMsg(null)

  const nombreProyecto = projects?.find(p => p.id === pidOp)?.name || 'el proyecto'

  useEffect(() => {
    if (!pidOp) return
    setDatos(null); setArchivos([]); setListo(null)
    async function cargar() {
      const [lotes, ventas, pagos, gastos] = await Promise.all([
        supabase.from('lots').select('id, mz, lt').eq('project_id', pidOp),
        supabase.from('sales').select('id, lot_id, client_id, status, signed_contract_url, client:clients!sales_client_id_fkey(id, full_name, dni_front_url, dni_back_url)')
          .in('status', ['en_proceso', 'pagado', 'expropiado']),
        supabase.from('daily_income')
          .select('id, date, amount, income_type, voucher_url, receipt_url, lot_id, installment:installments(installment_number)')
          .eq('project_id', pidOp).order('date'),
        supabase.from('expenses')
          .select('id, type, issue_date, reception_date, amount, description, recipient, voucher_url, request_doc_url')
          .eq('project_id', pidOp).order('issue_date'),
      ])
      const míos = new Set((lotes.data || []).map(l => l.id))
      setDatos({
        lotes: lotes.data || [],
        ventas: (ventas.data || []).filter(v => míos.has(v.lot_id)),
        pagos: pagos.data || [],
        gastos: gastos.data || [],
      })
    }
    cargar()
  }, [pidOp])

  // ---- EL PLAN: qué archivo va a qué, antes de tocar nada ----
  const plan = useMemo(() => {
    if (!datos || !archivos.length) return []
    const porLote = new Map()
    for (const l of datos.lotes) porLote.set(l.mz.toUpperCase() + '-' + String(Number(l.lt)), l)
    const ventaDe = id => datos.ventas.find(v => v.lot_id === id)
    const filas = []

    // se agrupan por lote+carpeta+tipo para poder emparejar en orden cuando hay varios
    const grupos = new Map()
    for (const f of archivos) {
      const { lote, carpeta, gasto, anio, mes, nombre } = leerRuta(f.webkitRelativePath || f.name)
      const info = leerNombre(nombre)
      const base = { file: f, nombre, ruta: f.webkitRelativePath || f.name, kb: Math.round(f.size / 1024) }

      // ---- DOCUMENTOS DE GASTOS (constancias, RxH, facturas, vouchers de depósito) ----
      if (gasto) {
        if (info.tipo === 'ignorar') { filas.push({ ...base, estado: 'ignorar', detalle: info.motivo }); continue }
        const campo = gasto === 'gasto-constancia' ? 'request_doc_url' : 'voucher_url'
        const lotesArch = lotesEn(nombre)
        const concepto = conceptoDe(nombre)
        // se puntúa a cada gasto: el lote es la señal fuerte, después el concepto,
        // después el mes. Nada se sube sin que el número calce o tú lo confirmes.
        const puntuados = (datos.gastos || []).map(g => {
          const lotesG = lotesEn(g.description || '')
          let p = 0
          if (lotesArch.length && lotesG.some(x => lotesArch.includes(x))) p += 10
          if (concepto && g.type === concepto) p += 4
          const fg = g.issue_date || g.reception_date || ''
          if (anio && fg.slice(0, 4) === String(anio)) p += 2
          if (mes && Number(fg.slice(5, 7)) === mes) p += 3
          return { g, p }
        }).filter(x => x.p > 0).sort((a, b) => b.p - a.p)
        const elegido = manual[base.ruta] ? (datos.gastos || []).find(g => g.id === manual[base.ruta]) : puntuados[0]?.g
        const seguro = !manual[base.ruta] && puntuados[0] && puntuados[0].p >= 10 &&
          (!puntuados[1] || puntuados[1].p < puntuados[0].p)
        if (!elegido) {
          filas.push({ ...base, estado: 'sin-destino', destino: gasto, gasto: true, campo,
            candidatos: datos.gastos || [],
            detalle: `no encontré a qué gasto corresponde${lotesArch.length ? ' (menciona ' + lotesArch.join(', ') + ')' : ''} — elígelo tú` })
          continue
        }
        const yaTiene = elegido[campo]
        filas.push({
          ...base, estado: yaTiene && !reemplazar ? 'ya-tiene' : (seguro ? 'listo' : 'revisar'),
          destino: gasto, gasto: true, campo, tabla: 'expenses', id: elegido.id, candidatos: datos.gastos || [],
          etiqueta: (elegido.issue_date || '').slice(0, 7),
          detalle: `${elegido.type} · ${soles(elegido.amount)} · ${elegido.issue_date || 's/f'} · ${(elegido.description || '').slice(0, 60)}` +
            (seguro ? '' : ' — CONFIRMA que es el correcto'),
        })
        continue
      }

      if (!lote) { filas.push({ ...base, estado: 'sin-destino', detalle: 'no pude leer la manzana y el lote de la ruta' }); continue }
      const l = porLote.get(lote.mz + '-' + String(Number(lote.lt)))
      if (!l) { filas.push({ ...base, estado: 'sin-destino', detalle: `el lote MZ ${lote.mz} LT ${lote.lt} no existe en ${nombreProyecto}` }); continue }
      if (!carpeta) { filas.push({ ...base, estado: 'sin-destino', detalle: 'no está dentro de VOUCHERS, BOLETAS, DOCUMENTOS ni DNI' }); continue }
      if (info.tipo === 'ignorar') { filas.push({ ...base, estado: 'ignorar', detalle: info.motivo }); continue }
      const clave = `${l.id}|${carpeta}|${info.tipo}|${(info.cuotas || []).join(',')}`
      if (!grupos.has(clave)) grupos.set(clave, { lote: l, carpeta, info, items: [] })
      grupos.get(clave).items.push(base)
    }

    for (const g of grupos.values()) {
      const { lote, carpeta, info } = g
      const etiqueta = `MZ ${lote.mz} LT ${lote.lt}`
      const venta = ventaDe(lote.id)
      const archivosOrden = g.items.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))

      // --- contrato de la venta ---
      if (carpeta === 'contrato') {
        if (!venta) { archivosOrden.forEach(a => filas.push({ ...a, estado: 'sin-destino', detalle: `${etiqueta} no tiene venta registrada` })); continue }
        archivosOrden.forEach((a, i) => filas.push({
          ...a, estado: i === 0 ? (venta.signed_contract_url && !reemplazar ? 'ya-tiene' : 'listo') : 'extra',
          destino: 'contrato', etiqueta, tabla: 'sales', id: venta.id, campo: 'signed_contract_url',
          detalle: i === 0 ? `contrato de la venta de ${venta.client?.full_name || '—'}` : 'ya se toma otro archivo como contrato de esta venta',
        }))
        continue
      }

      // --- DNI del cliente ---
      if (carpeta === 'dni') {
        if (!venta?.client) { archivosOrden.forEach(a => filas.push({ ...a, estado: 'sin-destino', detalle: `${etiqueta} no tiene cliente con venta` })); continue }
        archivosOrden.forEach((a, i) => {
          const campo = i === 0 ? 'dni_front_url' : i === 1 ? 'dni_back_url' : null
          if (!campo) { filas.push({ ...a, estado: 'extra', detalle: 'el DNI solo tiene dos caras' }); return }
          const yaTiene = venta.client[campo]
          filas.push({
            ...a, estado: yaTiene && !reemplazar ? 'ya-tiene' : 'listo', destino: 'dni', etiqueta,
            tabla: 'clients', id: venta.client.id, campo,
            detalle: `${i === 0 ? 'anverso' : 'reverso'} del DNI de ${venta.client.full_name}`,
          })
        })
        continue
      }

      // --- voucher / comprobante: hay que encontrar los PAGOS que cubre ---
      const campo = carpeta === 'voucher' ? 'voucher_url' : 'receipt_url'
      let pagos = datos.pagos.filter(p => p.lot_id === lote.id)
      if (info.tipo === 'separacion') pagos = pagos.filter(p => p.income_type === 'separacion')
      else if (info.tipo === 'inicial') pagos = pagos.filter(p => p.income_type === 'inicial')
      else if (info.tipo === 'cuota') pagos = pagos.filter(p => p.income_type === 'cuota' && info.cuotas.includes(p.installment?.installment_number))
      else pagos = []

      if (!pagos.length) {
        archivosOrden.forEach(a => filas.push({
          ...a, estado: 'sin-destino', etiqueta,
          detalle: info.tipo === 'desconocido'
            ? 'el nombre no dice a qué pago corresponde'
            : `${etiqueta} no tiene un pago de tipo ${info.tipo.toUpperCase()}${info.cuotas ? ' N° ' + info.cuotas.join('/') : ''} registrado`,
        }))
        continue
      }
      pagos = pagos.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))

      // un archivo y varios pagos = un solo depósito que cubrió varias cuotas (cascada):
      // el mismo voucher va en todos. Si hay tantos archivos como pagos, van en orden.
      if (archivosOrden.length === 1) {
        const a = archivosOrden[0]
        const faltan = pagos.filter(p => reemplazar || !p[campo])
        filas.push({
          ...a, estado: faltan.length ? 'listo' : 'ya-tiene', destino: carpeta, etiqueta,
          tabla: 'daily_income', ids: faltan.map(p => p.id), campo,
          detalle: pagos.length === 1
            ? `${DESTINO_LBL[carpeta]} de ${info.tipo.toUpperCase()}${info.cuotas ? ' N° ' + info.cuotas.join('/') : ''} · ${soles(pagos[0].amount)}`
            : `cubre ${pagos.length} pagos del mismo depósito (${soles(pagos.reduce((s, p) => s + Number(p.amount), 0))}) — el mismo archivo va en todos`,
        })
      } else {
        archivosOrden.forEach((a, i) => {
          const p = pagos[i]
          if (!p) { filas.push({ ...a, estado: 'extra', etiqueta, detalle: `sobran archivos: ${etiqueta} tiene ${pagos.length} pago(s) de ese tipo` }); return }
          filas.push({
            ...a, estado: (p[campo] && !reemplazar) ? 'ya-tiene' : 'revisar', destino: carpeta, etiqueta,
            tabla: 'daily_income', ids: [p.id], campo,
            detalle: `${archivosOrden.length} archivos para ${pagos.length} pagos: este se empareja con el del ${p.date} (${soles(p.amount)}) — revísalo`,
          })
        })
      }
    }
    return filas
  }, [datos, archivos, reemplazar, nombreProyecto, manual])

  const cuenta = useMemo(() => {
    const c = { listos: 0, revisar: 0, 'ya-tiene': 0, 'sin-destino': 0, ignorar: 0, extra: 0 }
    for (const f of plan) c[f.estado === 'listo' ? 'listos' : f.estado]++
    return c
  }, [plan])

  const aSubir = useMemo(() => plan.filter(f => f.estado === 'listo' || f.estado === 'revisar'), [plan])
  const visibles = useMemo(() => {
    if (ver === 'todos') return plan
    if (ver === 'listos') return plan.filter(f => f.estado === 'listo' || f.estado === 'revisar')
    return plan.filter(f => f.estado === ver)
  }, [plan, ver])

  async function subirTodo() {
    if (!aSubir.length) return
    if (!confirm(`Se van a subir ${aSubir.length} archivos y engancharlos a ${nombreProyecto}.\n\n` +
      `${cuenta.revisar ? '⚠ ' + cuenta.revisar + ' están marcados "revisar" (había más de un archivo para el mismo tipo de pago).\n\n' : ''}` +
      'Los archivos originales del Drive no se tocan. ¿Continuar?')) return
    setSubiendo(true); setErrores([]); setProgreso({ hechos: 0, total: aSubir.length, actual: '' })
    const fallos = []
    let ok = 0
    for (let i = 0; i < aSubir.length; i++) {
      const f = aSubir[i]
      setProgreso({ hechos: i, total: aSubir.length, actual: `${f.etiqueta} · ${f.nombre}` })
      try {
        const ext = (f.nombre.split('.').pop() || 'bin').toLowerCase()
        const carpetaR2 = f.destino === 'voucher' ? 'vouchers' : f.destino === 'comprobante' ? 'comprobantes'
          : f.destino === 'contrato' ? 'contratos' : f.destino === 'dni' ? 'dni' : 'comprobantes/gastos'
        const ruta = `${carpetaR2}/${limpio(nombreProyecto)}/${f.etiqueta ? limpio(f.etiqueta) : 'sin-lote'}/${limpio(f.nombre.replace(/\.[^.]+$/, ''))}.${ext}`
        const url = await subirRuta(ruta, f.file)
        if (f.tabla === 'daily_income') {
          const patch = { [f.campo]: url }
          if (f.campo === 'voucher_url') { patch.voucher_na = false; patch.voucher_na_reason = null }
          else { patch.receipt_na = false; patch.receipt_na_reason = null }
          const { error } = await supabase.from('daily_income').update(patch).in('id', f.ids)
          if (error) throw error
        } else {
          const { error } = await supabase.from(f.tabla).update({ [f.campo]: url }).eq('id', f.id)
          if (error) throw error
        }
        ok++
      } catch (e) {
        fallos.push({ nombre: f.ruta, error: e.message || String(e) })
      }
    }
    setProgreso({ hechos: aSubir.length, total: aSubir.length, actual: '' })
    await supabase.from('activity_log').insert({
      user_id: profile?.id, user_email: profile?.email, action: 'INSERT', entity_type: 'daily_income',
      details: {
        cambio: 'carga_archivos_migracion', proyecto: nombreProyecto, project_id: pidOp,
        subidos: ok, fallidos: fallos.length, revisar: cuenta.revisar,
        sin_destino: cuenta['sin-destino'], ya_tenian: cuenta['ya-tiene'],
      },
    })
    setErrores(fallos)
    setListo({ ok, fallos: fallos.length })
    setMsg({ ok: fallos.length === 0, t: `SE SUBIERON ${ok} ARCHIVOS${fallos.length ? ' · ' + fallos.length + ' FALLARON' : ''}` })
    setSubiendo(false)
  }

  if (role !== 'superuser') return <p className="error">Solo el SUPERUSUARIO puede cargar archivos de migración.</p>

  const CHIP = [
    ['listos', 'Listos para subir', cuenta.listos + cuenta.revisar],
    ['ya-tiene', 'Ya tenían archivo', cuenta['ya-tiene']],
    ['sin-destino', 'Sin destino', cuenta['sin-destino']],
    ['ignorar', 'Descartados', cuenta.ignorar],
    ['extra', 'Sobrantes', cuenta.extra],
    ['todos', 'Todos', plan.length],
  ]

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Cargar archivos de migración</h1>
        <ProjectPicker />
      </div>

      <div className="glass" style={{ padding: '12px 16px', marginBottom: 14, borderLeft: '3px solid var(--accent)' }}>
        <p style={{ margin: '0 0 6px' }}><b>Cómo se usa</b></p>
        <p className="muted small" style={{ margin: 0, textTransform: 'none' }}>
          1. En Drive, abre la carpeta del proyecto → botón derecho → <b>Descargar</b> (te la baja en un ZIP).<br />
          2. Descomprime el ZIP en tu PC.<br />
          3. Aquí abajo elige esa carpeta. <b>Nada se sube todavía</b>: primero ves el plan.<br />
          4. Revisa el plan y recién entonces dale a subir.
        </p>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          <b>De los lotes:</b> se reconocen por su nombre — <b>SEPARACION</b>, <b>INICIAL</b>, <b>CUOTA 07</b> (o
          <b> CUOTA 02,03,04</b> si un depósito pagó varias). Las carpetas <b>VOUCHERS</b>, <b>BOLETAS</b>,
          <b> DOCUMENTOS</b> y <b>DNI</b> deciden a dónde va cada uno. Los <b>IMPRIMIR.docx</b> se descartan solos.
        </p>
        <p className="hint" style={{ margin: '6px 0 0' }}>
          <b>De los gastos:</b> también entran los de <b>DOCUMENTOS ADMINISTRATIVOS</b> — las constancias de
          recepción van al espacio de <b>constancia</b> del gasto y los RxH / facturas / vouchers de depósito
          al de <b>sustento</b>. Se emparejan por el lote que nombran, el concepto y el mes. Los que nombran el
          lote salen como <b>listos</b>; los genéricos (viáticos, sueldos, administrativos) salen como
          <b> revisar</b> con un desplegable para que elijas el gasto exacto — eso no lo adivino.
        </p>
      </div>

      <div className="glass form-card">
        <div className="form-grid">
          <label className="span2">Carpeta del proyecto (bajada del Drive)
            <input type="file" webkitdirectory="" directory="" multiple disabled={subiendo}
              onChange={e => { setArchivos([...e.target.files]); setListo(null); setErrores([]) }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
            <input type="checkbox" checked={reemplazar} disabled={subiendo} onChange={e => setReemplazar(e.target.checked)} />
            Reemplazar los que ya tienen archivo
          </label>
        </div>
        {!datos && pidOp && <p className="muted">Cargando lotes y pagos del proyecto…</p>}
        {datos && (
          <p className="muted small">
            {nombreProyecto}: {datos.lotes.length} lotes · {datos.ventas.length} ventas · {datos.pagos.length} pagos · {datos.gastos.length} gastos registrados.
            {!datos.pagos.length && <b className="bad"> Ojo: este proyecto todavía no tiene pagos cargados, así que no hay a qué enganchar los vouchers.</b>}
          </p>
        )}
        {!!archivos.length && (
          <p><b>{archivos.length}</b> archivos leídos de la carpeta ({Math.round(archivos.reduce((s, f) => s + f.size, 0) / 1048576)} MB en total).</p>
        )}
        {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
        {!!aSubir.length && !subiendo && (
          <button className="btn-primary" onClick={subirTodo}>
            Subir {aSubir.length} archivos y engancharlos
          </button>
        )}
        {subiendo && (
          <div>
            <p><b>Subiendo…</b> {progreso.hechos} de {progreso.total}</p>
            <div style={{ height: 8, background: 'rgba(255,255,255,.1)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: (progreso.hechos / Math.max(1, progreso.total) * 100) + '%', height: '100%', background: 'var(--accent)', transition: 'width .2s' }} />
            </div>
            <p className="muted small" style={{ textTransform: 'none' }}>{progreso.actual}</p>
          </div>
        )}
        {listo && (
          <p className={listo.fallos ? 'warn' : 'ok'}>
            Terminó: <b>{listo.ok}</b> archivos enganchados{listo.fallos ? ` · ${listo.fallos} fallaron (abajo el detalle)` : ' · sin errores'}.
            Queda registrado en la bitácora.
          </p>
        )}
        {!!errores.length && (
          <div className="hint" style={{ maxHeight: 160, overflowY: 'auto' }}>
            {errores.map((e, i) => <p key={i} className="small" style={{ margin: 0, textTransform: 'none' }}>✕ {e.nombre}: {e.error}</p>)}
          </div>
        )}
      </div>

      {!!plan.length && (
        <>
          <div className="chips" style={{ marginTop: 14 }}>
            {CHIP.map(([k, l, n]) => (
              <button key={k} className={`chip ${ver === k ? 'on' : ''}`} onClick={() => setVer(k)}>{l} ({n})</button>
            ))}
          </div>
          {cuenta.revisar > 0 && ver === 'listos' && (
            <p className="hint" style={{ margin: '0 0 8px' }}>
              &#9888; {cuenta.revisar} archivos quedaron marcados <b>revisar</b>: había más de un archivo para el mismo
              tipo de pago, así que se emparejaron por orden de nombre y fecha. Míralos antes de subir.
            </p>
          )}
          <div className="glass table-wrap">
            <table>
              <thead><tr><th>Archivo</th><th>Lote</th><th>Va a</th><th>Estado</th><th>Detalle</th></tr></thead>
              <tbody>
                {visibles.slice(0, 400).map((f, i) => (
                  <tr key={i}>
                    <td style={{ textTransform: 'none' }}>{f.nombre} <span className="muted small">({f.kb} KB)</span></td>
                    <td>{f.etiqueta || '—'}</td>
                    <td>{f.destino ? DESTINO_LBL[f.destino] : '—'}</td>
                    <td>
                      {f.estado === 'listo' && <span className="st-chip st-ok">listo</span>}
                      {f.estado === 'revisar' && <span className="st-chip" style={{ background: 'rgba(224,178,63,.18)', color: '#e0b23f' }}>revisar</span>}
                      {f.estado === 'ya-tiene' && <span className="st-chip st-na">ya tenía</span>}
                      {f.estado === 'sin-destino' && <span className="st-chip st-per">sin destino</span>}
                      {f.estado === 'ignorar' && <span className="st-chip st-na">descartado</span>}
                      {f.estado === 'extra' && <span className="st-chip st-na">sobrante</span>}
                    </td>
                    <td className="muted small" style={{ textTransform: 'none' }}>
                      {f.detalle}
                      {/* en los documentos de gasto se puede elegir a mano a cuál va */}
                      {f.gasto && !subiendo && (
                        <select value={f.id || ''} style={{ display: 'block', marginTop: 3, maxWidth: 420, fontSize: 11 }}
                          onChange={e => setManual(m => ({ ...m, [f.ruta]: e.target.value }))}>
                          <option value="">— elegir el gasto —</option>
                          {(f.candidatos || []).map(g => (
                            <option key={g.id} value={g.id}>
                              {(g.issue_date || 's/f')} · {soles(g.amount)} · {g.type} · {(g.description || '').slice(0, 45)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibles.length > 400 && <p className="muted small">Se muestran los primeros 400 de {visibles.length}.</p>}
        </>
      )}
    </>
  )
}
