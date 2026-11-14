// AVISO DE HOJA NUEVA EN EL LIBRO DE RECLAMACIONES (sql/230, 14 nov 2026)
//
// Un cliente llenó una hoja en urbisgroupinmobiliaria.com/libro-de-reclamaciones →
// un Telegram al DUEÑO (el ADMIN de bot_settings.admin_phone), SOLO por Telegram
// (decisión del dueño, 14 nov). Hay 15 días hábiles para responder: el mensaje dice
// hasta cuándo y lleva el enlace a la bandeja del panel (/reclamos).
// Si Telegram no lo entrega se reintenta en la vuelta siguiente (cada minuto) hasta
// 5 veces; después se marca igual, para no insistir sin fin: la hoja se ve en el panel
// con su contador en el menú.

const MAX_INTENTOS = 5
const fecha = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''
const corto = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const bonito = s => String(s || '').toLowerCase().split(/\s+/).filter(Boolean)
  .map((w, i) => (i > 0 && ['de', 'del', 'la', 'las', 'los', 'y'].includes(w)) ? w : w[0].toUpperCase() + w.slice(1)).join(' ')

function armar(r, panel) {
  return '📕 *LIBRO DE RECLAMACIONES · HOJA N° ' + r.numero + '*\n'
    + (r.tipo === 'queja' ? 'QUEJA' : 'RECLAMO') + ' · ' + bonito(r.proyecto) + '\n'
    + r.empresa_razon_social + ' (RUC ' + r.empresa_ruc + ')\n\n'
    + '👤 ' + r.nombre + ' · ' + r.doc_tipo + ' ' + r.doc_numero + ' · ' + r.telefono + '\n'
    + '📝 ' + corto(r.detalle, 350) + '\n'
    + '🙏 Pide: ' + corto(r.pedido, 200) + '\n\n'
    + '⏳ Responder hasta el *' + fecha(r.vence) + '* (15 días hábiles), por '
    + ({ correo: 'correo', whatsapp: 'WhatsApp', domicilio: 'carta a su domicilio' }[r.respuesta_medio] || r.respuesta_medio) + '.\n'
    + 'Responde aquí: ' + panel
}

function crearAvisosReclamos({ supabase, enviar, admin, log = () => {}, panel }) {
  const PANEL = panel || ((process.env.PANEL_URL || 'https://panel.urbisgroupinmobiliaria.com') + '/reclamos')
  const intentos = new Map()
  let falta = false

  async function tick() {
    const { data, error } = await supabase.from('libro_reclamaciones')
      .select('id, numero, tipo, proyecto, empresa_razon_social, empresa_ruc, nombre, doc_tipo, doc_numero, telefono, detalle, pedido, vence, respuesta_medio')
      .is('avisado_at', null).order('fecha').limit(20)
    if (error) { if (!falta) { log('AVISOS DEL LIBRO DE RECLAMACIONES (¿falta sql/230?):', error.message); falta = true } return }
    falta = false
    const tel = String((typeof admin === 'function' ? admin() : admin) || '').replace(/\D/g, '')
    for (const r of data || []) {
      let ok = false
      if (tel) ok = await enviar(tel, armar(r, PANEL), { tipo: 'aviso_admin', soloTelegram: true }).catch(() => false)
      const n = (intentos.get(r.id) || 0) + 1
      intentos.set(r.id, n)
      log('AVISO LIBRO DE RECLAMACIONES N°', r.numero, ok ? '✔ Telegram' : '✗ (intento ' + n + (tel ? '' : ', sin ADMIN') + ')')
      if (ok || n >= MAX_INTENTOS) {
        await supabase.from('libro_reclamaciones').update({ avisado_at: new Date().toISOString() }).eq('id', r.id)
        intentos.delete(r.id)
      }
    }
  }

  return { tick }
}

module.exports = { crearAvisosReclamos, armar }
