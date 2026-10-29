// AVISOS DE LAS CARTAS DE COBRANZA (sql/155, 21 oct 2026)
//
// Mismo estilo que los avisos de firma de gastos (avisos_firma.js):
//  1. Carta nueva → a la SOCIA del proyecto: "tienes una carta por firmar".
//  2. Cada 4 horas, de día o de noche, mientras siga por firmar: un solo mensaje por
//     socia con todas sus cartas pendientes. El reloj es cartas.aviso_socia_at.
//  3. La socia firmó → a quien la creó: "ya está firmada, imprímela y entrégala".
// Todo por WhatsApp Y por Telegram (si lo tiene vinculado).

const CADA_MS = 4 * 3600 * 1000
const dig = t => String(t || '').replace(/\D/g, '')
// el celular de avisos y, si no sirve, el de firmar (igual que avisos_firma.js)
const celularDe = p => {
  for (const t of [p?.phone, p?.firma_phone]) {
    let d = dig(t)
    if (d.length === 9 && d.startsWith('9')) d = '51' + d
    if (d.length >= 11) return d
  }
  return ''
}
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const linea = k => 'N° ' + k.numero + ' · lote ' + (k.sale?.lot ? k.sale.lot.mz + '-' + k.sale.lot.lt : '?')
  + ' · ' + (k.sale?.client?.full_name || '') + ' · ' + k.cuotas_vencidas + ' vencidas · ' + soles(k.deuda)

function crearAvisosCartas({ supabase, enviar, log = () => {}, panel }) {
  const PANEL = panel || ((process.env.PANEL_URL || 'https://panel.urbisgroupinmobiliaria.com') + '/cartas')
  let falta = false
  const sinCelularVisto = new Set()

  async function porLosDos(tel, texto) {
    const wsp = await enviar(tel, texto, { tipo: 'aviso_admin', canal: 'whatsapp' }).catch(() => false)
    const tg = await enviar(tel, texto, { tipo: 'aviso_admin', soloTelegram: true }).catch(() => false)
    return { wsp: !!wsp, tg: !!tg }
  }

  async function decir(p, texto) {
    const tel = celularDe(p)
    if (!tel) {
      if (!sinCelularVisto.has(p.id)) { sinCelularVisto.add(p.id); log('AVISO DE CARTA ✗ ' + p.full_name + ' no tiene celular válido en Usuarios') }
      return false
    }
    const r = await porLosDos(tel, texto)
    log('AVISO DE CARTA a', p.full_name, '· WhatsApp', r.wsp ? '✔' : '✗', '· Telegram', r.tg ? '✔' : '✗')
    return r.wsp || r.tg
  }

  async function tick() {
    const { data: cartas, error } = await supabase.from('cartas')
      .select('id, numero, estado, project_id, cuotas_vencidas, deuda, creado_por, aviso_socia_at, aviso_firmada_at, firmado_nombre, project:projects(name), sale:sales(client:clients!sales_client_id_fkey(full_name), lot:lots(mz, lt))')
      .in('estado', ['por_firmar', 'firmada']).limit(300)
    if (error) { if (!falta) { log('AVISOS DE CARTAS (¿falta sql/155?):', error.message); falta = true } return }
    falta = false
    if (!cartas?.length) return
    const ahora = Date.now()

    // ---- 1 y 2: a la socia de cada proyecto, lo que tiene por firmar ----
    const porFirmar = cartas.filter(k => k.estado === 'por_firmar')
    const proyectos = [...new Set(porFirmar.map(k => k.project_id))]
    const { data: asig } = proyectos.length
      ? await supabase.from('project_assignments').select('user_id, project_id').in('project_id', proyectos) : { data: [] }
    const ids = [...new Set([...(asig || []).map(a => a.user_id), ...cartas.map(k => k.creado_por).filter(Boolean)])]
    const { data: perf } = ids.length
      ? await supabase.from('profiles').select('id, full_name, phone, firma_phone, role, active').in('id', ids) : { data: [] }
    const perfiles = new Map((perf || []).map(p => [p.id, p]))
    const socias = new Map()            // socia → sus cartas por firmar
    for (const a of (asig || [])) {
      const p = perfiles.get(a.user_id)
      if (!p || p.role !== 'socio' || p.active === false) continue
      for (const k of porFirmar.filter(x => x.project_id === a.project_id)) {
        if (!socias.has(p.id)) socias.set(p.id, [])
        socias.get(p.id).push(k)
      }
    }
    const avisadas = new Set()
    for (const [sid, suyas] of socias) {
      const p = perfiles.get(sid)
      const nuevas = suyas.filter(k => !k.aviso_socia_at)
      // el recordatorio: si alguna lleva 4 horas sin aviso, va TODO lo pendiente en un mensaje
      const toca = nuevas.length || suyas.some(k => ahora - new Date(k.aviso_socia_at).getTime() >= CADA_MS)
      if (!toca) continue
      const nombre = String(p.full_name || '').trim().split(/\s+/)[0] || ''
      const texto = nuevas.length === suyas.length
        ? '📨 *CARTA' + (suyas.length > 1 ? 'S' : '') + ' DE COBRANZA PARA TU FIRMA*\n'
          + suyas.map(k => (k.project?.name || '') + ' · ' + linea(k)).join('\n')
          + '\n\nRevísala y fírmala aquí: ' + PANEL
        : '⏰ ' + nombre + ', tienes *' + suyas.length + ' carta' + (suyas.length > 1 ? 's' : '') + ' de cobranza* por firmar:\n'
          + suyas.map(k => (k.project?.name || '') + ' · ' + linea(k)).join('\n')
          + '\n\nFírmalas aquí: ' + PANEL + '\n(te lo recuerdo cada 4 horas)'
      if (await decir(p, texto)) suyas.forEach(k => avisadas.add(k.id))
    }
    if (avisadas.size) await supabase.from('cartas').update({ aviso_socia_at: new Date().toISOString() }).in('id', [...avisadas])

    // ---- 3: firmada → a quien la creó ----
    for (const k of cartas.filter(x => x.estado === 'firmada' && !x.aviso_firmada_at)) {
      const p = perfiles.get(k.creado_por)
      let ok = false
      if (p) ok = await decir(p, '✅ *CARTA DE COBRANZA FIRMADA*\n' + (k.project?.name || '') + ' · ' + linea(k)
        + '\nLa firmó ' + (k.firmado_nombre || 'la socia') + '. Ya se puede imprimir y entregar (en papel o por WhatsApp): ' + PANEL)
      // sin a quién avisar (o sin celular) no se insiste: se marca igual
      if (ok || !p || !celularDe(p)) await supabase.from('cartas').update({ aviso_firmada_at: new Date().toISOString() }).eq('id', k.id)
    }
  }

  return { tick }
}

module.exports = { crearAvisosCartas }
