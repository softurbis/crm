// AVISOS DE FIRMA DE GASTOS (sql/135, 9 oct 2026)
//
// Pedido del dueño: "que le alerte a su Telegram cada vez que se solicita el gasto, y
// a los dos —quien solicita y la socia— al WhatsApp y al Telegram, que tienen un
// pendiente de firma; cada 4 horas, sea cual sea la hora".
// Decisiones: a los DOS desde que se registra la solicitud (la socia con la nota
// "primero firma X, después te toca": la base no la deja aprobar antes, sql/74); y el
// recordatorio es UN mensaje por persona con todo lo que tiene por firmar.
//
//  1. Solicitud nueva → a quien la pide ("para tu firma") y a los socios del proyecto
//     si el proyecto exige su firma (projects.expense_approval).
//  2. Quien pidió ya firmó → a los socios: "ya puedes firmar".
//  3. Cada 4 horas, de día o de noche, a cada persona que sigue con algo por firmar:
//     un resumen con todas sus solicitudes. El reloj es por persona
//     (profiles.firma_aviso_at): un aviso inmediato también lo reinicia.
// Todo sale por WhatsApp Y por Telegram (si lo tiene vinculado). Se deja de avisar
// cuando firma, cuando la solicitud se rechaza o cuando deja de estar "solicitado".
//
// planificar() decide qué mandar sin tocar nada (se prueba aparte); tick() lee, manda
// y anota.

const CADA_MS = 4 * 3600 * 1000
const dig = t => String(t || '').replace(/\D/g, '')
const sol = g => g.request_number ? 'SOL-' + String(g.request_number).padStart(5, '0') : 'solicitud'
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const primerNombre = s => String(s || '').trim().split(/\s+/)[0] || ''
const haceCuanto = (desde, ahora) => {
  const h = Math.floor((ahora - new Date(desde).getTime()) / 3600000)
  return h < 1 ? 'hace menos de 1 hora' : h < 48 ? 'hace ' + h + ' h' : 'hace ' + Math.floor(h / 24) + ' días'
}

// gastos: los "solicitado" sin rechazo, con su proyecto { name, expense_approval }
// sociosDe: project_id → [perfil] · perfiles: id → perfil { id, full_name, phone, firma_aviso_at }
function planificar({ gastos, sociosDe, perfiles }, ahora, panel) {
  const mensajes = []          // { userId, tel, texto }
  const gastosUpd = []         // { id, campos }
  const avisados = new Set()   // a quién se le avisó en esta vuelta (su reloj vuelve a cero)
  const nombreSolicitante = g => g.requester_name || perfiles.get(g.requester_id)?.full_name || 'quien la pidió'
  const cab = g => (g.project?.name || '') + ' · ' + sol(g) + '\n' + soles(g.amount) + ' → ' + (g.recipient || '-') + (g.description ? '\n' + g.description : '')
  const decir = (userId, texto) => {
    const p = perfiles.get(userId)
    if (!p || dig(p.phone).length < 11) return
    mensajes.push({ userId, tel: dig(p.phone), texto })
    avisados.add(userId)
  }
  const falta = g => g.requester_id && !g.requester_signed_at          // la firma de quien la pide
  const socioToca = g => g.project?.expense_approval && !g.approved_at  // la firma del socio

  for (const g of gastos) {
    const socios = socioToca(g) ? (sociosDe.get(g.project_id) || []) : []
    // 1. solicitud nueva: a los dos
    if (!g.requester_notified_at) {
      if (falta(g)) decir(g.requester_id, '✍ *SOLICITUD DE GASTO PARA TU FIRMA*\n' + cab(g) + '\n\nFírmala aquí: ' + panel + '\n(te lo recuerdo cada 4 horas hasta que la firmes)')
      for (const s of socios) {
        decir(s.id, falta(g)
          ? '📝 *SOLICITUD DE GASTO — PENDIENTE DE TU FIRMA*\n' + cab(g) + '\n\nPrimero la firma ' + nombreSolicitante(g) + '; apenas firme te aviso para que la apruebes. ' + panel
          : '✍ *SOLICITUD DE GASTO POR APROBAR*\n' + cab(g) + (g.requester_name ? '\nYa la firmó ' + g.requester_name : '') + '\n\nRevísala y fírmala aquí: ' + panel)
      }
      const campos = { requester_notified_at: new Date(ahora).toISOString() }
      if (socios.length && !falta(g)) campos.approval_notified_at = campos.requester_notified_at   // ya se le dijo "puedes firmar"
      gastosUpd.push({ id: g.id, campos })
      continue
    }
    // 2. quien la pidió ya firmó: a los socios, "ya puedes firmar"
    if (socioToca(g) && !falta(g) && !g.approval_notified_at) {
      for (const s of socios) {
        decir(s.id, '✍ *YA PUEDES FIRMAR — SOLICITUD DE GASTO*\n' + cab(g) + '\nYa la firmó ' + nombreSolicitante(g) + '.\n\nRevísala y fírmala aquí: ' + panel)
      }
      gastosUpd.push({ id: g.id, campos: { approval_notified_at: new Date(ahora).toISOString() } })
    }
  }

  // 3. recordatorio cada 4 horas: lo pendiente de cada persona, en un solo mensaje
  const pend = new Map()   // userId → [{ g, puede, espera }]
  const sumar = (uid, item) => { if (!pend.has(uid)) pend.set(uid, []); pend.get(uid).push(item) }
  for (const g of gastos) {
    if (falta(g)) sumar(g.requester_id, { g, puede: true })
    if (socioToca(g)) for (const s of (sociosDe.get(g.project_id) || [])) sumar(s.id, { g, puede: !falta(g), espera: falta(g) ? nombreSolicitante(g) : null })
  }
  for (const [uid, items] of pend) {
    if (avisados.has(uid)) continue
    const p = perfiles.get(uid)
    if (!p) continue
    const ultimo = p.firma_aviso_at ? new Date(p.firma_aviso_at).getTime() : 0
    if (ahora - ultimo < CADA_MS) continue
    const ya = items.filter(x => x.puede).length
    const lineas = items
      .sort((a, b) => new Date(a.g.created_at) - new Date(b.g.created_at))
      .map(x => '• ' + (x.g.project?.name || '') + ' · ' + sol(x.g) + ' · ' + soles(x.g.amount) + ' → ' + (x.g.recipient || '-') +
        '\n   ' + (x.puede ? '✍ te toca firmar' : '⏳ espera la firma de ' + primerNombre(x.espera)) + ' · pedida ' + haceCuanto(x.g.created_at, ahora))
    decir(uid, '⏰ *' + (primerNombre(p.full_name) ? primerNombre(p.full_name) + ', tienes ' : 'Tienes ') + items.length +
      (items.length === 1 ? ' solicitud de gasto pendiente de firma*' : ' solicitudes de gasto pendientes de firma*') +
      (ya === items.length ? '' : ya === 0 ? ' (todavía no te toca: falta la firma de quien las pidió)' : ' (' + ya + ' ya para firmar)') + '\n\n' + lineas.join('\n') +
      '\n\nFírmalas aquí: ' + panel + '\n(te lo recuerdo cada 4 horas hasta que estén firmadas)')
  }
  return { mensajes, gastosUpd, avisados }
}

function crearAvisosFirma({ supabase, enviar, log = () => {}, panel }) {
  const PANEL = panel || ((process.env.PANEL_URL || 'https://panel.urbisgroupinmobiliaria.com') + '/gastos')
  let avisoFalta = false

  // por WhatsApp Y por Telegram: enviar() elige uno solo, así que se le pide cada uno
  async function porLosDos(tel, texto) {
    const wsp = await enviar(tel, texto, { tipo: 'aviso_admin', canal: 'whatsapp' }).catch(() => false)
    const tg = await enviar(tel, texto, { tipo: 'aviso_admin', soloTelegram: true }).catch(() => false)
    return { wsp: !!wsp, tg: !!tg }
  }

  async function tick() {
    const { data: gastos, error } = await supabase.from('expenses')
      .select('id, request_number, amount, recipient, description, requester_id, requester_name, requester_signed_at, approved_at, project_id, created_at, requester_notified_at, approval_notified_at, project:projects(name, expense_approval)')
      .eq('status', 'solicitado').is('rejected_at', null).limit(300)
    if (error) { if (!avisoFalta) { log('AVISOS DE FIRMA:', error.message); avisoFalta = true } return }
    if (!gastos?.length) return
    const proyectos = [...new Set(gastos.filter(g => g.project?.expense_approval).map(g => g.project_id))]
    const { data: asig } = proyectos.length
      ? await supabase.from('project_assignments').select('user_id, project_id').in('project_id', proyectos)
      : { data: [] }
    const ids = [...new Set([...(asig || []).map(a => a.user_id), ...gastos.map(g => g.requester_id).filter(Boolean)])]
    const { data: perf, error: e2 } = ids.length
      ? await supabase.from('profiles').select('id, full_name, phone, role, active, firma_aviso_at').in('id', ids)
      : { data: [] }
    if (e2) { if (!avisoFalta) { log('AVISOS DE FIRMA (¿falta sql/135?):', e2.message); avisoFalta = true } return }
    const perfiles = new Map((perf || []).map(p => [p.id, p]))
    const sociosDe = new Map()
    for (const a of (asig || [])) {
      const p = perfiles.get(a.user_id)
      if (!p || p.role !== 'socio' || p.active === false) continue
      if (!sociosDe.has(a.project_id)) sociosDe.set(a.project_id, [])
      sociosDe.get(a.project_id).push(p)
    }
    const plan = planificar({ gastos, sociosDe, perfiles }, Date.now(), PANEL)
    for (const m of plan.mensajes) {
      const r = await porLosDos(m.tel, m.texto)
      log('AVISO DE FIRMA a', perfiles.get(m.userId)?.full_name || m.userId, '· WhatsApp', r.wsp ? '✔' : '✗', '· Telegram', r.tg ? '✔' : '✗')
    }
    for (const u of plan.gastosUpd) await supabase.from('expenses').update(u.campos).eq('id', u.id)
    if (plan.avisados.size) await supabase.from('profiles').update({ firma_aviso_at: new Date().toISOString() }).in('id', [...plan.avisados])
  }

  return { tick }
}

module.exports = { crearAvisosFirma, planificar, CADA_MS }
