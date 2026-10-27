// ============================================================================
// TRANSPORTE POR LA API OFICIAL DE META — un "sock" con la cara de Baileys  [27 oct 2026]
// ----------------------------------------------------------------------------
// Decision del dueno (27 oct 2026): Baileys se apaga en TODOS los numeros; todo
// (leads, clientes, panel) sale por el +51 960 487 000, conectado a la Cloud API
// a traves del conector de C-Soft.
//
// index.js tiene 4.500 lineas que hablan con WhatsApp por `S.sock` (Baileys):
// sendMessage, sendPresenceUpdate, onWhatsApp, etiquetas, logout. En vez de
// reescribirlas, este archivo da un objeto con ESOS mismos metodos que por
// debajo llama a la Cloud API (cloudapi.js). Lo que la API no tiene (etiquetas,
// editar un mensaje, mandar una vCard al propio chip) se acepta y no hace nada,
// dejando rastro en el log. Asi el bot de ventas, la consola de pruebas, los
// adjuntos del panel y los avisos internos siguen funcionando igual.
//
// Lo que cambia por ser la API (y no un celular):
//   · texto libre SOLO dentro de las 24 h desde el ultimo mensaje de la persona
//     (Meta contesta 131047 fuera de ventana: el envio queda 'fallido' en el panel)
//   · "escribiendo…" se pinta sobre el ultimo mensaje entrante (hay que recordarlo)
//   · no hay LID ni onWhatsApp: se contesta al numero y listo
// ============================================================================
module.exports = function crearSockAPI({ WA, log = console.log, numero = '' }) {
  const dig = t => String(t || '').replace(/\D/g, '')
  const telDeJid = jid => dig(String(jid || '').split('@')[0])
  const ultimoEntrante = new Map()   // telefono -> wamid del ultimo mensaje que mando (para "escribiendo")
  const resp = r => ({ key: { id: r?.messages?.[0]?.id || ('api-' + Date.now()), fromMe: true }, api: true })
  const noop = (que) => { log('API: ' + que + ' no existe en la Cloud API, se omite'); return { key: { id: 'api-noop-' + Date.now(), fromMe: true }, api: true, omitido: true } }

  async function mandarMedia(to, obj, tipo, caption, fileName, mime) {
    if (obj && obj.url) return WA.enviarMedia(to, obj.url, tipo, caption, fileName)
    const buf = Buffer.isBuffer(obj) ? obj : (obj && Buffer.isBuffer(obj.buffer) ? obj.buffer : null)
    if (!buf) throw new Error('media sin url ni buffer')
    const id = await WA.subirMedia(buf, mime || (tipo === 'image' ? 'image/jpeg' : tipo === 'video' ? 'video/mp4' : 'application/octet-stream'), fileName || tipo)
    return WA.enviarMediaId(to, id, tipo, caption, fileName)
  }

  return {
    user: { id: (numero || '') + ':1@s.whatsapp.net' },
    api: true,
    recordarEntrante(phone, wamid) { if (phone && wamid) ultimoEntrante.set(dig(phone).slice(-9), wamid) },

    async sendMessage(jid, c = {}) {
      const to = telDeJid(jid)
      if (c.edit) return noop('editar un mensaje')
      if (c.contacts) return noop('mandar una vCard')
      if (c.image) return resp(await mandarMedia(to, c.image, 'image', c.caption, null, c.mimetype))
      if (c.video) return resp(await mandarMedia(to, c.video, 'video', c.caption, null, c.mimetype || 'video/mp4'))
      if (c.audio) return resp(await mandarMedia(to, c.audio, 'audio', '', null, c.mimetype || 'audio/mpeg'))
      if (c.document) return resp(await mandarMedia(to, c.document, 'document', c.caption, c.fileName || 'DOCUMENTO', c.mimetype))
      if (c.text !== undefined) return resp(await WA.enviarTexto(to, c.text))
      return noop('ese tipo de mensaje')
    },

    // 'composing' → visto + escribiendo sobre el ultimo mensaje de esa persona.
    // 'paused' / 'recording' → nada (la API lo apaga sola).
    async sendPresenceUpdate(estado, jid) {
      if (estado !== 'composing') return
      const id = ultimoEntrante.get(telDeJid(jid).slice(-9))
      if (!id) return
      try { await WA.marcarLeido(id, true) } catch (e) { /* ya contestado o muy viejo: no importa */ }
    },

    // no hay consulta de existencia en la API: se asume que si, sin LID
    async onWhatsApp(jid) { return [{ exists: true, jid: String(jid) }] },

    // Baileys: etiquetas, cierre, reintentos de media. En la API no existen.
    async addLabel() { return null },
    async addChatLabel() { return null },
    async removeChatLabel() { return null },
    async updateMediaMessage(m) { return m },
    async logout() { log('API: logout no aplica (el numero vive en el panel de C-Soft)') },
    end() { },
  }
}
