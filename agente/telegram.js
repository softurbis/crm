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

async function tgApi(metodo, body) {
  if (!activo()) return null
  try {
    const r = await fetch(API(metodo), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const j = await r.json()
    if (!j.ok) return { error: j.description || 'error de Telegram' }
    return j.result
  } catch (e) { return { error: String(e.message || e) } }
}

async function tgEnviar(chatId, texto) {
  const r = await tgApi('sendMessage', {
    chat_id: chatId, text: aHtml(texto), parse_mode: 'HTML', disable_web_page_preview: true,
  })
  return !!(r && !r.error)
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
function escuchar(onMensaje, log = () => {}) {
  if (!activo()) { log('TELEGRAM: sin TELEGRAM_BOT_TOKEN, canal interno desactivado'); return }
  if (escucha.arrancada) { log('TELEGRAM: ya habia una escucha corriendo, no arranco otra'); return }
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
      const ups = await tgApi('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] })
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
        const m = u.message
        if (!m || !m.chat || m.chat.type !== 'private') continue
        const texto = String(m.text || m.caption || '').trim()
        if (!texto) continue
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

module.exports = { activo, tgEnviar, escuchar, crearRegistro, aHtml, estadoEscucha, tgApi }
