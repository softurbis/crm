// BOLETAS Y FACTURAS ELECTRÓNICAS DE LOS COBROS (sql/113)
// El panel nunca habla con SUNAT: pide el comprobante (pedir_comprobante) y lo emite
// el servidor con el RUC del proyecto. Aquí está lo que comparten la ficha del
// lote, Pagos y la pantalla Comprobantes: leerlos, saber en qué van y pedirlos.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

export const COLS_COMPROBANTE = 'id, project_id, lot_id, sale_id, client_id, tipo, ruc, serie, numero, ambiente, fecha_emision, cliente_tipo_doc, cliente_numero, cliente_nombre, cliente_direccion, items, total, estado, codigo, mensaje, firma, pdf_url, xml_url, cdr_url, motivo_baja, intentos, proximo_intento, creado_at, emitido_at'

// En qué va un comprobante, dicho para quien cobra (no para un contador)
export const ESTADOS = {
  pendiente:  { t: 'en cola',       c: 'cp-espera', ayuda: 'El servidor lo está por emitir.' },
  emitiendo:  { t: 'emitiendo…',    c: 'cp-espera', ayuda: 'Se está firmando y enviando.' },
  error:      { t: 'reintentando',  c: 'cp-aviso',  ayuda: 'No salió todavía. Se reintenta solo.' },
  firmado:    { t: 'emitida',       c: 'cp-ok',     ayuda: 'Boleta firmada y válida. Se informa a SUNAT en el resumen del día siguiente.' },
  en_sunat:   { t: 'en SUNAT',      c: 'cp-ok',     ayuda: 'Viaja en el resumen diario; SUNAT está por contestar.' },
  aceptado:   { t: 'aceptada',      c: 'cp-ok',     ayuda: 'Aceptada por SUNAT.' },
  por_anular: { t: 'anulando…',     c: 'cp-aviso',  ayuda: 'Se pidió anular: el servidor le informa la baja a SUNAT.' },
  anulado:    { t: 'anulada',       c: 'cp-gris',   ayuda: 'Dada de baja. El pago puede llevar otro comprobante.' },
  rechazado:  { t: 'rechazada',     c: 'cp-mal',    ayuda: 'SUNAT la rechazó: no vale. Hay que emitir otra.' },
}
// "vivo" = el pago ya tiene comprobante (o está saliendo): no se le emite otro
export const estaVivo = c => !!c && !['rechazado', 'anulado'].includes(c.estado)
// todavía puede cambiar solo: conviene seguir mirando
export const enCamino = c => !!c && ['pendiente', 'emitiendo', 'error', 'por_anular'].includes(c.estado)
export const nombreComprobante = c => c ? c.serie + (c.numero != null ? '-' + c.numero : '') : ''
export const esPrueba = c => !!c && c.ambiente === 'beta'
export const TIPO_DOC = { 1: 'DNI', 4: 'Carné de extranjería', 7: 'Pasaporte', 6: 'RUC', 0: 'Sin documento' }

// RUC peruano: 11 dígitos, empieza con 10, 15, 17 o 20 y el último es verificador
export function rucValido(ruc) {
  const r = String(ruc || '').trim()
  if (!/^(10|15|17|20)\d{9}$/.test(r)) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((s, p, i) => s + p * Number(r[i]), 0)
  const resto = 11 - (suma % 11)
  return (resto === 10 ? 0 : resto === 11 ? 1 : resto) === Number(r[10])
}

// La línea del comprobante que se propone para un pago (la secretaria la puede
// cambiar). Es la misma que arma la base si no se le manda ninguna.
export function descripcionPago(p, lote, proyecto, totalCuotas) {
  const n = p.installment?.installment_number
  const concepto = p.income_type === 'cuota' ? 'CUOTA N° ' + (n ?? '') + (totalCuotas ? ' DE ' + totalCuotas : '')
    : p.income_type === 'inicial' ? 'CUOTA INICIAL'
    : p.income_type === 'separacion' ? 'SEPARACIÓN'
    : p.income_type === 'mora' ? 'MORA' : 'PAGO'
  const l = lote || p.lot
  return (concepto + (l ? ' - LOTE ' + l.lt + ' MZ ' + l.mz : '') + (proyecto?.name ? ' - ' + proyecto.name : '')).toUpperCase()
}

// De una lista de comprobantes, cuál le toca a cada pago: el vivo si lo hay, si no
// el último (para mostrar "rechazada" o "anulada" con su motivo).
export function comprobantePorPago(lista) {
  const m = new Map()
  for (const c of [...(lista || [])].sort((a, b) => String(a.creado_at).localeCompare(String(b.creado_at)))) {
    for (const it of (c.items || [])) {
      const antes = m.get(it.pago_id)
      if (!antes || !estaVivo(antes) || estaVivo(c)) m.set(it.pago_id, c)
    }
  }
  return m
}
export const comprobanteDeGrupo = (mapa, g) => {
  let ultimo = null
  for (const p of (g?.items || [])) {
    const c = mapa.get(p.id)
    if (estaVivo(c)) return c
    if (c) ultimo = c
  }
  return ultimo
}

const amable = e => {
  const m = String(e?.message || e || '')
  if (/PGRST20[25]|schema cache|does not exist|Could not find/i.test(m)) return 'El facturador todavía no está instalado en la base (falta correr sql/113).'
  return m
}

export async function pedirComprobante({ pagos, tipo, cliente, descripciones }) {
  const { data, error } = await supabase.rpc('pedir_comprobante', {
    p_pagos: pagos, p_tipo: tipo, p_cliente: cliente, p_descripciones: descripciones || null,
  })
  if (error) throw new Error(amable(error))
  return data
}
export async function anularComprobante(id, motivo) {
  const { data, error } = await supabase.rpc('anular_comprobante', { p_id: id, p_motivo: motivo })
  if (error) throw new Error(amable(error))
  return data   // 'cancelado' | 'anulado' | 'pedido'
}
export async function reintentarComprobante(id) {
  const { error } = await supabase.rpc('reintentar_comprobante', { p_id: id })
  if (error) throw new Error(amable(error))
}

// ---- mandárselo al cliente por WhatsApp (sql/123) ----
// Dos caminos. Si el proyecto tiene SU WhatsApp conectado en el sistema, el panel
// solo lo pide y el PDF sale solo, desde el servidor. Si no lo tiene, se abre el
// WhatsApp de quien cobra con el mensaje y el enlace del PDF ya escritos. Nunca
// sale por el número de otro proyecto: cada proyecto es independiente.
export async function wspDelProyecto(projectId) {
  if (!projectId) return null
  const { data, error } = await supabase.rpc('wsp_del_proyecto', { p_project: projectId })
  return error ? null : (data || null)   // el número del proyecto, o null (también si sql/123 no está)
}
export function textoComprobanteWsp(c, proyecto) {
  const items = (c.items || []).map(i => i.descripcion).filter(Boolean)
  const detalle = items.slice(0, 3).join('; ') + (items.length > 3 ? ' y ' + (items.length - 3) + ' más' : '')
  const firma = proyecto?.fact_razon_social || proyecto?.name || ''
  return 'Buen día. Le enviamos su ' + (c.tipo === 'factura' ? 'factura electrónica ' : 'boleta de venta electrónica ')
    + c.serie + '-' + c.numero + ' por S/ ' + Number(c.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    + (detalle ? '\n' + detalle : '')
    + '\n\nPuede verla y descargarla aquí:\n' + c.pdf_url
    + '\n\nGracias por su pago.' + (firma ? '\n' + firma : '')
}
export const enlaceWsp = (tel, texto) => {
  const d = String(tel || '').replace(/\D/g, '')
  return 'https://wa.me/' + (d.length === 9 ? '51' + d : d) + '?text=' + encodeURIComponent(texto)
}
export async function enviarComprobanteWsp(id, telefono) {
  const { data, error } = await supabase.rpc('enviar_comprobante_wsp', { p_id: id, p_telefono: telefono })
  if (error) {
    const m = String(error.message || '')
    if (/PGRST20[25]|schema cache|does not exist|Could not find/i.test(m)) throw new Error('El envío por WhatsApp todavía no está instalado en la base (falta correr sql/123).')
    throw new Error(m)
  }
  return data   // el número al que va, ya con el código del país
}
// En qué va el envío. Se lee aparte de COLS_COMPROBANTE: si sql/123 no está
// corrido, esto devuelve null y el resto del panel sigue igual.
export async function envioWsp(id) {
  const { data, error } = await supabase.from('comprobantes').select('wsp_a, wsp_at, wsp_estado, wsp_error').eq('id', id).maybeSingle()
  return error ? null : data
}
// Los celulares registrados de a quien se le emitió (el de la ficha del cliente)
export async function celularesDe(c) {
  let cli = null
  if (c?.client_id) cli = (await supabase.from('clients').select('phone, phone2').eq('id', c.client_id).maybeSingle()).data
  if (!cli && c?.sale_id) cli = (await supabase.from('sales').select('client:clients!sales_client_id_fkey(phone, phone2)').eq('id', c.sale_id).maybeSingle()).data?.client
  const limpio = t => { const d = String(t || '').replace(/\D/g, ''); return d.length === 11 && d.startsWith('51') ? d.slice(2) : d }
  return [...new Set([cli?.phone, cli?.phone2].map(limpio).filter(d => d.length >= 9))]
}
export const celularBonito = t => {
  const d = String(t || '').replace(/\D/g, '')
  const n = d.length === 11 && d.startsWith('51') ? d.slice(2) : d
  return n.length === 9 ? n.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : (d ? '+' + d : '')
}

// Los comprobantes de un lote o de un proyecto. Mientras alguno esté en camino se
// vuelve a mirar cada 3 segundos; si no, no se gasta ni una consulta de más.
// `filtro`: { lotId } o { projectId, desde }. Sin facturador en el proyecto, no consulta.
export function useComprobantes(filtro, activo = true) {
  const [lista, setLista] = useState([])
  const [cargando, setCargando] = useState(false)
  const clave = JSON.stringify(filtro || {})
  const vivo = useRef(true)
  const cargar = useCallback(async () => {
    const f = JSON.parse(clave)
    if (!activo || (!f.lotId && !f.projectId)) { setLista([]); return [] }
    let q = supabase.from('comprobantes').select(COLS_COMPROBANTE).order('creado_at', { ascending: false }).limit(f.limite || 1000)
    if (f.lotId) q = q.eq('lot_id', f.lotId)
    if (f.projectId) q = q.eq('project_id', f.projectId)
    if (f.desde) q = q.gte('fecha_emision', f.desde)
    const { data, error } = await q
    if (error || !vivo.current) return []   // sql/113 sin correr: como si no hubiera ninguno
    setLista(data || [])
    return data || []
  }, [clave, activo])
  useEffect(() => {
    vivo.current = true
    setCargando(true)
    cargar().finally(() => vivo.current && setCargando(false))
    return () => { vivo.current = false }
  }, [cargar])
  const hayEnCamino = lista.some(enCamino)
  useEffect(() => {
    if (!hayEnCamino) return
    const t = setInterval(() => { if (!document.hidden) cargar() }, 3000)
    return () => clearInterval(t)
  }, [hayEnCamino, cargar])
  return { lista, cargando, recargar: cargar, porPago: comprobantePorPago(lista) }
}

// Lo que el servidor reporta de cada RUC cargado: ambiente (pruebas / real),
// cuándo vence el certificado y cuándo se le vio por última vez.
export async function emisorDelServidor(ruc) {
  if (!ruc) return null
  const { data, error } = await supabase.from('fact_emisores').select('*').eq('ruc', ruc).maybeSingle()
  if (error) return null
  return data
}
// más de 4 minutos sin noticias = el facturador del servidor no está corriendo
export const emisorVisto = e => !!e && (Date.now() - new Date(e.visto_at).getTime()) < 4 * 60000
