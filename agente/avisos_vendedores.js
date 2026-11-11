// AVISOS A LOS VENDEDORES (sql/190-191, 10 nov 2026)
//
// Pedido del dueño: los vendedores llevan su seguimiento en el panel (Prospectos) "con
// alertas para cuando ponen recordar en tal día".
//
//  1. RECORDATORIO: llegó la hora del "siguiente paso" de un prospecto (sin hora: 9 a. m.)
//     → a su vendedor. Un solo mensaje con todos los que vencieron en esta vuelta.
//  2. ASIGNACIÓN: alguien le asignó leads → "te asignaron N prospectos".
//  3. RESUMEN de las 8 a. m.: cuántos le tocan hoy y cuántos tiene vencidos (solo si hay).
//
// Todo va SOLO POR TELEGRAM (decisión del dueño: nunca por el WhatsApp de los clientes).
// Quien no tiene Telegram vinculado no recibe el mensaje, pero lo ve igual en el panel:
// por eso el aviso se marca como hecho aunque no haya salido (si no, se reintentaría
// cada minuto durante dos días).
// Qué toca y a quién lo decide la base (recordatorios_por_avisar, asignaciones_por_avisar,
// vendedores_resumen_dia); armar() solo redacta, y se prueba aparte.

const dig = t => String(t || '').replace(/\D/g, '')
const telDe = t => { let d = dig(t); if (d.length === 9 && d.startsWith('9')) d = '51' + d; return d.length >= 11 ? d : '' }
const cel = t => { const d = dig(t); return d.length === 11 && d.startsWith('51') ? d.slice(2).replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : d }
const primerNombre = s => { const n = String(s || '').trim().split(/\s+/)[0] || ''; return n ? n[0].toUpperCase() + n.slice(1).toLowerCase() : '' }
const horaTexto = h => {
  if (!h) return ''
  const [hh, mm] = String(h).split(':').map(Number)
  return ((hh % 12) || 12) + ':' + String(mm).padStart(2, '0') + (hh < 12 ? ' a. m.' : ' p. m.')
}
const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios)
const porVendedor = filas => {
  const m = new Map()
  for (const f of filas || []) { if (!m.has(f.vendedor_id)) m.set(f.vendedor_id, []); m.get(f.vendedor_id).push(f) }
  return m
}

// → [{ vendedorId, vendedor, tel, texto, tipo, leadIds }]
function armar({ recordatorios = [], asignaciones = [], resumenes = [] }, panel) {
  const mensajes = []
  for (const [vid, fs] of porVendedor(recordatorios)) {
    const lineas = fs.map(f => '• *' + f.prospecto + '* · ' + cel(f.celular) + (f.proyecto ? ' · ' + f.proyecto : '') +
      '\n   ' + (f.paso || 'Volver a contactarlo') + (f.hora ? ' · ' + horaTexto(f.hora) : ''))
    mensajes.push({
      vendedorId: vid, vendedor: fs[0].vendedor, tel: telDe(fs[0].tel), tipo: 'recordatorio', leadIds: fs.map(f => f.lead_id),
      texto: '⏰ *' + (fs.length === 1 ? 'RECORDATORIO' : 'TIENES ' + fs.length + ' RECORDATORIOS') + '*\n' + lineas.join('\n') +
        '\n\nCuando lo contactes, anota qué pasó y ponle el siguiente paso: ' + panel,
    })
  }
  for (const [vid, fs] of porVendedor(asignaciones)) {
    const lineas = fs.slice(0, 15).map(f => '• *' + f.prospecto + '* · ' + cel(f.celular) + (f.proyecto ? ' · ' + f.proyecto : ''))
    mensajes.push({
      vendedorId: vid, vendedor: fs[0].vendedor, tel: telDe(fs[0].tel), tipo: 'asignacion', leadIds: fs.map(f => f.lead_id),
      texto: '🎯 *TE ASIGNARON ' + plural(fs.length, 'PROSPECTO', 'PROSPECTOS') + '*\n' + lineas.join('\n') +
        (fs.length > 15 ? '\n… y ' + (fs.length - 15) + ' más' : '') +
        '\n\nContáctalos cuanto antes y anota qué pasó: ' + panel,
    })
  }
  for (const r of resumenes) {
    const hoy = Number(r.hoy || 0), venc = Number(r.vencidos || 0), sin = Number(r.sin_paso || 0)
    if (!hoy && !venc) { mensajes.push({ vendedorId: r.vendedor_id, vendedor: r.vendedor, tel: '', tipo: 'resumen', texto: '' }); continue }
    const partes = [hoy && 'hoy te ' + (hoy === 1 ? 'toca ' : 'tocan ') + plural(hoy, 'prospecto', 'prospectos'), venc && 'tienes ' + plural(venc, 'vencido', 'vencidos')].filter(Boolean)
    mensajes.push({
      vendedorId: r.vendedor_id, vendedor: r.vendedor, tel: telDe(r.tel), tipo: 'resumen',
      texto: '☀️ *Buenos días' + (primerNombre(r.vendedor) ? ', ' + primerNombre(r.vendedor) : '') + '*\n' +
        partes.join(' y ').replace(/^h/, 'H').replace(/^t/, 'T') + '.' +
        (sin ? '\n' + plural(sin, 'prospecto está', 'prospectos están') + ' sin siguiente paso: ponles fecha para no perderlos.' : '') +
        '\n\n' + panel,
    })
  }
  return mensajes
}

function crearAvisosVendedores({ supabase, enviar, log = () => {}, panel }) {
  const PANEL = panel || ((process.env.PANEL_URL || 'https://panel.urbisgroupinmobiliaria.com') + '/prospectos')
  let avisoFalta = false
  const sinTelegram = new Set()

  async function tick() {
    const [r, a, d] = await Promise.all([
      supabase.rpc('recordatorios_por_avisar'), supabase.rpc('asignaciones_por_avisar'), supabase.rpc('vendedores_resumen_dia'),
    ])
    const err = r.error || a.error || d.error
    if (err) { if (!avisoFalta) { log('AVISOS A VENDEDORES (¿falta sql/191?):', err.message); avisoFalta = true } return }
    const mensajes = armar({ recordatorios: r.data, asignaciones: a.data, resumenes: d.data }, PANEL)
    const ahora = new Date().toISOString()
    for (const m of mensajes) {
      let salio = false
      if (m.texto && m.tel) salio = !!(await enviar(m.tel, m.texto, { tipo: 'aviso_admin', soloTelegram: true }).catch(() => false))
      if (m.texto) {
        log('AVISO A VENDEDOR (' + m.tipo + ') a', m.vendedor || m.vendedorId, salio ? '✔ Telegram' : '✗ no salió')
        if (!salio && !sinTelegram.has(m.vendedorId)) {
          sinTelegram.add(m.vendedorId)
          log('  → ' + (m.vendedor || m.vendedorId) + (m.tel ? ' no tiene Telegram vinculado a +' + m.tel : ' no tiene celular en Usuarios') + ': los avisos solo los ve en el panel.')
        }
      }
      // se marca aunque no haya salido: lo ve en el panel, y así no se reintenta cada minuto
      if (m.tipo === 'recordatorio') await supabase.from('leads').update({ aviso_enviado_at: ahora }).in('id', m.leadIds)
      else if (m.tipo === 'asignacion') await supabase.from('leads').update({ asignacion_avisada_at: ahora }).in('id', m.leadIds)
      else await supabase.from('profiles').update({ vend_resumen_dia: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }) }).eq('id', m.vendedorId)
    }
  }

  return { tick }
}

module.exports = { crearAvisosVendedores, armar }
