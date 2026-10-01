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
