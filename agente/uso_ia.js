// REGISTRO DE USO DE LA IA (sql/205, 12 nov 2026)
// Envuelve un cliente de Anthropic para que CADA llamada (salga bien o mal) deje una
// fila en la tabla ia_uso: origen, modelo, tokens y costo aproximado.
// Regla: registrar NUNCA rompe ni demora la llamada. Si la tabla no existe todavía
// (sql/205 sin correr) o la base falla, se avisa una vez en el log y se sigue.

// USD por millón de tokens: [entrada, salida]. Caché: lectura 0.1x, escritura 1.25x.
// Es una tarifa aproximada; la cuenta exacta es la de la consola de Anthropic.
const TARIFAS = [['opus', 5, 25], ['sonnet', 2, 10], ['haiku', 1, 5]]

function costoUsd(modelo, u) {
  const t = TARIFAS.find(x => String(modelo || '').includes(x[0])) || TARIFAS[0]
  const usd = (u.in * t[1] + u.out * t[2] + u.cacheR * t[1] * 0.1 + u.cacheW * t[1] * 1.25) / 1e6
  return Math.round(usd * 1e6) / 1e6
}

function leerUso(usage) {
  return {
    in: usage?.input_tokens || 0,
    out: usage?.output_tokens || 0,
    cacheR: usage?.cache_read_input_tokens || 0,
    cacheW: usage?.cache_creation_input_tokens || 0,
  }
}

let avisado = false
async function registrar({ supabase, log }, f) {
  try {
    const u = leerUso(f.usage)
    const { error } = await supabase.from('ia_uso').insert({
      origen: f.origen, modelo: f.modelo || null,
      tokens_in: u.in, tokens_out: u.out, tokens_cache_r: u.cacheR, tokens_cache_w: u.cacheW,
      costo_usd: costoUsd(f.modelo, u), ms: f.ms ?? null,
      ok: !f.error, error: f.error ? String(f.error).slice(0, 300) : null,
      ref: f.ref ? String(f.ref).slice(0, 120) : null,
    })
    if (error && !avisado) { avisado = true; log && log('USO IA: no se pudo registrar (¿falta sql/205?):', error.message) }
  } catch (e) {
    if (!avisado) { avisado = true; log && log('USO IA: no se pudo registrar:', String(e.message || e)) }
  }
}

// Envuelve ia.messages.create e ia.beta.messages.create. Devuelve el mismo cliente.
function envolver(ia, { supabase, log, origen }) {
  if (!ia || ia.__usoIA) return ia
  const poner = recurso => {
    if (!recurso || typeof recurso.create !== 'function') return
    const original = recurso.create.bind(recurso)
    recurso.create = (params, ...resto) => {
      const t0 = Date.now()
      const p = original(params, ...resto)
      // se cuelga un observador aparte: la promesa que recibe quien llama es la original
      Promise.resolve(p).then(
        r => { if (r && r.usage) registrar({ supabase, log }, { origen, modelo: r.model || params?.model, usage: r.usage, ms: Date.now() - t0 }) },
        e => registrar({ supabase, log }, { origen, modelo: params?.model, ms: Date.now() - t0, error: e?.message || e })
      ).catch(() => {})
      return p
    }
  }
  poner(ia.messages)
  poner(ia.beta && ia.beta.messages)
  ia.__usoIA = true
  return ia
}

module.exports = { envolver, registrar, costoUsd }
