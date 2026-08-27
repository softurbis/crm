// ============================================================
// CANAL INTERNO POR TELEGRAM — seguimiento y gerencia
// ------------------------------------------------------------
// El equipo (secretarias, gerencia, asesores) recibe y responde por un bot de
// Telegram en vez del WhatsApp del negocio: gratis, ilimitado, sin chip y sin
// riesgo de baneo. La LOGICA no cambia: este modulo es solo el transporte.
// Los mensajes a CLIENTES y LEADS siguen saliendo por WhatsApp.
//
// .env:  TELEGRAM_BOT_TOKEN=...   (lo da @BotFather)
// Tabla: telegram_links (phone -> chat_id), ver sql/48.
// ============================================================
const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || ''
const API = m => `https://api.telegram.org/bot${TOKEN()}/${m}`
const activo = () => !!TOKEN()

// WhatsApp usa *negrita* / _cursiva_; Telegram entiende HTML sin ambiguedades.
function aHtml(texto) {
  const esc = String(texto || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, '$1<i>$2</i>')
}

// el log de la app (lo pone escuchar()); sin el, este modulo era mudo
let _log = () => {}
function setLog(fn) { if (typeof fn === 'function') _log = fn }

// `ms`: sin tope, un fetch colgado deja al bot esperando para siempre. El long
// polling pide mas margen que el resto porque el propio getUpdates espera 50 s.
async function tgApi(metodo, body, ms = 30000) {
  if (!activo()) return null
  try {
    const r = await fetch(API(metodo), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
      signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(ms) : undefined,
    })
    const j = await r.json()
    if (!j.ok) return { error: j.description || ('error ' + r.status + ' de Telegram') }
    return j.result
  } catch (e) { return { error: String(e.message || e) } }
}

// Un envio que falla NO puede ser silencioso: se perdia el mensaje entero sin
// dejar rastro, y como nadie mira el valor de retorno, el bot quedaba mudo.
// Si lo que falla es el formato, va en texto plano antes que no llegar nada.
async function tgEnviar(chatId, texto) {
  let r = await tgApi('sendMessage', {
    chat_id: chatId, text: aHtml(texto), parse_mode: 'HTML', disable_web_page_preview: true,
  })
  if (r && r.error) {
    _log('TELEGRAM: sendMessage a ' + chatId + ' fallo — ' + r.error)
    if (/parse|entit|tag|markup/i.test(r.error)) {
      r = await tgApi('sendMessage', { chat_id: chatId, text: String(texto || ''), disable_web_page_preview: true })
      _log(r && !r.error
        ? 'TELEGRAM: reenviado a ' + chatId + ' en texto plano (el formato era invalido)'
        : 'TELEGRAM: tampoco salio en texto plano — ' + (r && r.error))
    }
  }
  return !!(r && !r.error)
}

// ---- MENSAJES CON BOTONES QUE CAMBIAN DE ESTADO ----
// Un aviso que se repite (la alarma de "sin respuesta", el WhatsApp caido) no
// debe ser una lluvia de mensajes nuevos: es UN mensaje que se EDITA con el
// estado actual, y sus botones disparan acciones sin salir de Telegram.
//
// botones = [[{t:'texto', d:'dato'} | {t:'texto', url:'https://...'}, ...], ...]
// d = accion que vuelve al bot (callback) · url = abre el enlace directamente
const markup = botones => (botones && botones.length)
  ? { inline_keyboard: botones.map(fila => fila.map(b => b.url
      ? { text: b.t, url: b.url }
      : { text: b.t, callback_data: String(b.d).slice(0, 64) })) }
  : undefined

// devuelve el message_id (para poder editarlo despues) o null si fallo
async function tgEnviarBotones(chatId, texto, botones) {
  const r = await tgApi('sendMessage', {
    chat_id: chatId, text: aHtml(texto), parse_mode: 'HTML',
    disable_web_page_preview: true, reply_markup: markup(botones),
  })
  if (r && r.error) { _log('TELEGRAM: sendMessage(botones) a ' + chatId + ' fallo — ' + r.error); return null }
  return r?.message_id || null
}

// borra un mensaje del propio bot (Telegram lo permite hasta 48 h despues).
// Se usa al "re-sonar" un aviso: sale el nuevo y el viejo desaparece — en el
// chat solo vive UNA copia de cada tablero.
async function tgBorrar(chatId, messageId) {
  const r = await tgApi('deleteMessage', { chat_id: chatId, message_id: messageId })
  return !(r && r.error)
}

// edita un mensaje ya mandado (texto y/o botonera). "message is not modified"
// no es un error: significa que el estado no cambio, y eso esta bien.
async function tgEditar(chatId, messageId, texto, botones) {
  const r = await tgApi('editMessageText', {
    chat_id: chatId, message_id: messageId, text: aHtml(texto), parse_mode: 'HTML',
    disable_web_page_preview: true, reply_markup: markup(botones),
  })
  if (r && r.error) {
    if (/not modified/i.test(r.error)) return true
    _log('TELEGRAM: editMessageText ' + chatId + '/' + messageId + ' fallo — ' + r.error)
    return false
  }
  return true
}

// ---- vinculos telefono <-> chat (cache en memoria, refresco cada 60 s) ----
function crearRegistro(supabase, log = () => {}) {
  let porTel = new Map(), porChat = new Map(), cargado = 0
  async function cargar() {
    const { data, error } = await supabase.from('telegram_links').select('phone, chat_id, nombre')
    if (error) { log('TG links:', error.message); return }
    porTel = new Map(); porChat = new Map()
    for (const l of (data || [])) {
      const dig = String(l.phone).replace(/\D/g, '')
      porTel.set(dig.slice(-9), l.chat_id)
      porChat.set(String(l.chat_id), dig)
    }
    cargado = Date.now()
  }
  const fresco = async () => { if (Date.now() - cargado > 60000) await cargar() }
  return {
    cargar,
    // chat de Telegram de un telefono (null si no esta vinculado -> se usa WhatsApp)
    chatDe: async phone => {
      await fresco()
      const dig = String(phone || '').replace(/\D/g, '')
      return dig.length >= 9 ? (porTel.get(dig.slice(-9)) || null) : null
    },
    telDe: async chatId => { await fresco(); return porChat.get(String(chatId)) || null },
    vincular: async (chatId, phone, nombre) => {
      const dig = String(phone).replace(/\D/g, '')
      const { error } = await supabase.from('telegram_links')
        .upsert({ phone: dig, chat_id: chatId, nombre: nombre || null, vinculado_at: new Date().toISOString() }, { onConflict: 'phone' })
      if (error) { log('TG vincular:', error.message); return false }
      await cargar()
      return true
    },
    desvincular: async chatId => {
      await supabase.from('telegram_links').delete().eq('chat_id', chatId)
      await cargar()
    },
  }
}

// ---- recepcion: long polling (no necesita dominio ni webhook) ----
// Estado de la escucha. Existe porque el bot puede quedar SORDO sin caerse: sigue
// mandando el latido "EN LINEA" mientras getUpdates falla en bucle. Paso el
// 20 ago 2026 y nadie se entero por 23 horas. Ahora el latido lo delata.
const escucha = { arrancada: false, ultimoOk: 0, ultimoError: '', fallos: 0 }
function estadoEscucha() { return { ...escucha } }

// onMensaje(chatId, texto, { nombre, usuario })
// onBoton(chatId, dato, messageId, { nombre })  ← pulsaron un boton inline
function escuchar(onMensaje, log = () => {}, onBoton = null) {
  if (!activo()) { log('TELEGRAM: sin TELEGRAM_BOT_TOKEN, canal interno desactivado'); return }
  if (escucha.arrancada) { log('TELEGRAM: ya habia una escucha corriendo, no arranco otra'); return }
  setLog(log)
  escucha.arrancada = true
  let offset = 0, vivo = true
  ;(async () => {
    // Un webhook registrado hace que getUpdates devuelva 409 PARA SIEMPRE. Es la
    // causa mas comun de "manda pero no recibe" y no se arregla reiniciando, asi
    // que se limpia en cada arranque. Si no hay webhook, no hace nada.
    const wh = await tgApi('getWebhookInfo')
    if (wh && wh.url) {
      log('TELEGRAM: habia un webhook puesto (' + wh.url + ') — lo quito para poder recibir')
      await tgApi('deleteWebhook', { drop_pending_updates: false })
    }
    // descartar la cola vieja para no reprocesar mensajes de cuando estaba caido
    const previos = await tgApi('getUpdates', { offset: -1, timeout: 0 })
    if (Array.isArray(previos) && previos.length) offset = previos[previos.length - 1].update_id + 1
    log('TELEGRAM: canal interno escuchando')
    escucha.ultimoOk = Date.now()
    while (vivo) {
      const ups = await tgApi('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 70000)
      if (!Array.isArray(ups)) {
        // antes esto se tragaba el error en silencio y el bucle giraba solo
        escucha.fallos++
        escucha.ultimoError = String(ups?.error || 'sin respuesta de Telegram')
        if (escucha.fallos === 1 || escucha.fallos % 12 === 0) log('TELEGRAM getUpdates falla (' + escucha.fallos + '):', escucha.ultimoError)
        // 409 = otro proceso esta haciendo getUpdates con el mismo token, o volvio
        // a aparecer un webhook. Reintentar mas seguido no ayuda: hay que avisar.
        if (/conflict/i.test(escucha.ultimoError)) {
          const wh2 = await tgApi('getWebhookInfo')
          if (wh2 && wh2.url) { log('TELEGRAM: reapareció un webhook, lo quito'); await tgApi('deleteWebhook', { drop_pending_updates: false }) }
        }
        await new Promise(r => setTimeout(r, Math.min(5000 * Math.min(escucha.fallos, 6), 30000)))
        continue
      }
      escucha.ultimoOk = Date.now(); escucha.fallos = 0; escucha.ultimoError = ''
      for (const u of ups) {
        offset = u.update_id + 1
        // boton pulsado: se confirma a Telegram (quita el relojito del cliente)
        // y se despacha aparte — un boton NO es un mensaje de texto
        if (u.callback_query) {
          const q = u.callback_query
          tgApi('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {})
          if (!onBoton) { log('TELEGRAM <- boton "' + (q.data || '') + '" pero no hay manejador'); continue }
          const nombre = [q.from?.first_name, q.from?.last_name].filter(Boolean).join(' ')
          log('TELEGRAM <- boton de ' + (q.message?.chat?.id || '?') + ': ' + (q.data || ''))
          try { await onBoton(q.message?.chat?.id, String(q.data || ''), q.message?.message_id, { nombre }) }
          catch (e) { log('TG onBoton:', String(e.message || e)) }
          continue
        }
        const m = u.message
        // Se registra TODO lo que llega. El bot anotaba lo que mandaba pero no lo
        // que recibia, y por eso un mensaje que entraba y se descartaba no dejaba
        // rastro en ningun lado.
        if (!m) { log('TELEGRAM <- update sin message (' + Object.keys(u).filter(k => k !== 'update_id').join(',') + '), descartado'); continue }
        if (!m.chat) { log('TELEGRAM <- message sin chat, descartado'); continue }
        if (m.chat.type !== 'private') { log('TELEGRAM <- chat ' + m.chat.id + ' es de tipo "' + m.chat.type + '", descartado'); continue }
        const texto = String(m.text || m.caption || '').trim()
        if (!texto) { log('TELEGRAM <- chat ' + m.chat.id + ' sin texto (' + Object.keys(m).filter(k => !['message_id', 'from', 'chat', 'date'].includes(k)).join(',') + '), descartado'); continue }
        log('TELEGRAM <- chat ' + m.chat.id + ': ' + texto.slice(0, 60))
        const nombre = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ')
        try { await onMensaje(m.chat.id, texto, { nombre, usuario: m.from?.username || null }) }
        catch (e) { log('TG onMensaje:', String(e.message || e)) }
      }
    }
    escucha.arrancada = false
  })().catch(e => {
    // si el bucle se cae entero, que quede registrado y se pueda volver a arrancar
    escucha.arrancada = false
    escucha.ultimoError = 'el bucle de escucha murio: ' + String(e.message || e)
    log('TELEGRAM:', escucha.ultimoError)
  })
  return () => { vivo = false }
}

module.exports = { activo, tgEnviar, tgEnviarBotones, tgEditar, tgBorrar, escuchar, crearRegistro, aHtml, estadoEscucha, tgApi, setLog }
