// Diálogos propios del panel, en lugar de las ventanas del navegador (alert,
// confirm y prompt): se veían feas, las fechas había que escribirlas a mano como
// AAAA-MM-DD y en algunos celulares el navegador las bloqueaba ("no permitir que
// esta página cree más diálogos") y la acción moría callada.
//
// Es una API suelta, sin hooks: se llama igual desde un componente que desde un
// archivo de lib/. Todas devuelven una promesa, así el reemplazo es casi mecánico:
//   alert(x)            →  await avisar(x)
//   if (!confirm(x))    →  if (!await confirmar(x))
//   const v = prompt(x) →  const v = await pedir(x)     (null si se cancela, igual que prompt)
// OJO: sin el `await`, `if (confirmar(x))` es SIEMPRE verdadero (una promesa).
//
// Quien dibuja es components/Dialogos.jsx, montado una sola vez en main.jsx. Los
// pedidos van EN COLA: si llegan dos seguidos se muestran uno tras otro.

const cola = []
const subs = new Set()
let serie = 0

const emitir = () => subs.forEach(fn => { try { fn(cola[0] || null) } catch {} })

// El anfitrión se suscribe y recibe el diálogo que toca mostrar (o null si no hay).
export const onDialogo = fn => { subs.add(fn); fn(cola[0] || null); return () => subs.delete(fn) }

// El anfitrión avisa cómo terminó: `valores` = lo escrito en los campos si se
// aceptó, o null si se canceló (Escape, clic afuera o el botón Cancelar).
export function cerrarDialogo(id, valores) {
  const d = cola[0]
  if (!d || d.id !== id) return
  cola.shift()
  d.resolver(valores === null ? d.siCancela : d.siAcepta(valores))
  emitir()
}

const encolar = d => new Promise(resolver => {
  cola.push({ ...d, id: ++serie, resolver })
  if (cola.length === 1) emitir()
})

// ¿El texto es claramente un error? ("ERROR: …", "No se pudo…", "Fecha inválida…",
// "MOTIVO OBLIGATORIO", "Falta la firma…"). Así los avisos viejos salen en rojo sin
// tocarlos uno por uno; el que no calce se marca con { tono } al llamarlo.
const pareceError = m => /^\s*(error|motivo obligatorio|falta)/i.test(m) ||
  /(inv[aá]lid[oa]|\bno (se )?(pudo|puede|pudieron|pueden)\b|\bno procede\b)/i.test(m.slice(0, 80))
const pareceOk = m => /^\s*(✅|✔|🧹|📇)/.test(m)

// Reemplaza alert(). Opciones: { titulo, tono: 'info' | 'ok' | 'error', aceptar }.
export function avisar(mensaje, o = {}) {
  const texto = String(mensaje ?? '')
  const tono = o.tono || (pareceError(texto) ? 'error' : pareceOk(texto) ? 'ok' : 'info')
  return encolar({
    clase: 'aviso', mensaje: texto, tono, campos: [],
    titulo: o.titulo || { info: 'Aviso', ok: 'Listo', error: 'Atención' }[tono],
    aceptar: o.aceptar || 'Entendido',
    siAcepta: () => undefined, siCancela: undefined,
  })
}

// Reemplaza confirm(): true si acepta, false si cancela.
// Opciones: { titulo, aceptar: 'Sí, borrar', cancelar, peligro: true } — `peligro`
// pinta el botón de rojo (borrar, anular, quitar).
export function confirmar(mensaje, o = {}) {
  return encolar({
    clase: 'confirma', mensaje: String(mensaje ?? ''), campos: [],
    titulo: o.titulo || 'Confirmar', peligro: !!o.peligro,
    aceptar: o.aceptar || 'Aceptar', cancelar: o.cancelar || 'Cancelar',
    siAcepta: () => true, siCancela: false,
  })
}

// Reemplaza prompt() con EL MISMO contrato: null si se cancela, el texto si se
// acepta (tal cual se escribió; '' si se aceptó vacío y no era obligatorio).
// Opciones: { titulo, valor, tipo, obligatorio, ayuda, placeholder, aceptar, cancelar, peligro }
//   tipo 'texto' (por defecto) · 'largo' (textarea: motivos, notas) ·
//        'fecha' (calendario; devuelve 'AAAA-MM-DD') · 'monto' / 'numero' (teclado numérico)
export function pedir(mensaje, o = {}) {
  return encolar({
    clase: 'pide', mensaje: String(mensaje ?? ''), titulo: o.titulo || '', peligro: !!o.peligro,
    campos: [{ clave: 'v', tipo: o.tipo || 'texto', valor: o.valor, obligatorio: !!o.obligatorio, ayuda: o.ayuda, placeholder: o.placeholder }],
    aceptar: o.aceptar || 'Aceptar', cancelar: o.cancelar || 'Cancelar',
    siAcepta: vals => vals.v, siCancela: null,
  })
}

// Varios datos en UN solo diálogo, para lo que antes eran dos o más prompt()
// seguidos (fecha y después motivo…). Devuelve { clave: texto } o null si se cancela.
//   campos: [{ clave, etiqueta, tipo, valor, obligatorio, ayuda, placeholder, opciones }]
//   tipo 'opcion' con opciones: [{ valor, etiqueta }] es una lista desplegable.
export function pedirDatos({ titulo, mensaje, campos, aceptar, cancelar, peligro } = {}) {
  return encolar({
    clase: 'datos', mensaje: String(mensaje ?? ''), titulo: titulo || '', peligro: !!peligro,
    campos: (campos || []).map(c => ({ ...c, tipo: c.tipo || 'texto' })),
    aceptar: aceptar || 'Aceptar', cancelar: cancelar || 'Cancelar',
    siAcepta: vals => ({ ...vals }), siCancela: null,
  })
}
