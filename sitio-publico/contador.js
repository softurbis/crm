/* ============================================================================
 * CONTADOR DE VISITAS de urbisgroupinmobiliaria.com (sql/231, 15 nov 2026)
 * ----------------------------------------------------------------------------
 * Un solo archivo para TODA la web pública: lo carga publico.html (portada,
 * landings, propiedades, libro) y cada página suelta de /recorrido/.
 * scripts/sitio-publicado.mjs le pone la dirección de la API y la clave pública
 * al publicar (aquí van %%…%%). Sin ellas, o en localhost, no envía nada
 * (en localhost lo muestra en la consola, para probar).
 *
 * Cuenta solo:
 *   · 'vista'  al abrir cada página (también al pasar de una a otra sin recargar);
 *   · los clics en enlaces de WhatsApp, teléfono, Google Maps, redes y recorridos;
 *   · lo que la página avisa con  window.urbisContador.evento(tipo, detalle)
 *     ('formulario', 'plano', 'recorrido').
 * NO guarda la IP ni nada de la persona: el "visitante" es un número al azar que
 * este navegador inventa y recuerda. El personal se excluye abriendo una vez la
 * web con ?nocontar=1 (y ?contar=1 lo deshace).
 * ========================================================================== */
(function () {
  'use strict'
  var API = '%%SUPABASE_URL%%', CLAVE = '%%ANON_KEY%%'
  var w = window, d = document, nav = navigator
  if (w.urbisContador) return

  // ---- memoria del navegador (si está bloqueada, vale solo mientras dure la página) ----
  var mem = {}
  function leer(k) { try { return w.localStorage.getItem(k) } catch (e) { return mem[k] || null } }
  function guardar(k, v) { try { w.localStorage.setItem(k, v) } catch (e) { mem[k] = v } }

  var q = new URLSearchParams(location.search)
  if (q.has('nocontar')) guardar('urbis_nocontar', '1')
  if (q.has('contar')) guardar('urbis_nocontar', '')
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
  var ua = nav.userAgent || ''
  var apagado = leer('urbis_nocontar') === '1' || nav.webdriver ||
    /bot|crawl|spider|slurp|headless|lighthouse|facebookexternalhit|whatsapp\/|preview/i.test(ua) ||
    (!LOCAL && API.indexOf('https://') !== 0)
  var incrustado = false
  try { incrustado = w.top !== w.self } catch (e) { incrustado = true }

  function azar() {
    try { if (w.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '') } catch (e) { /* sigue */ }
    return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  }
  var visitante = leer('urbis_v')
  if (!visitante) { visitante = azar(); guardar('urbis_v', visitante) }

  var dispositivo = (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ||
    (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)) ? 'tablet'
    : /Mobi|iPhone|iPod|Android|IEMobile|Opera Mini/i.test(ua) ? 'celular' : 'computadora'

  // ---- de dónde llegó (solo al cargar: al pasar de página dentro de la web no cambia) ----
  function llegada() {
    var ref = ''
    try { ref = d.referrer ? new URL(d.referrer).hostname.toLowerCase().replace(/^www\./, '') : '' } catch (e) { ref = '' }
    var aqui = location.hostname.toLowerCase().replace(/^www\./, '')
    if (ref === aqui) ref = ''                                   // vino de otra página de la misma web
    var src = (q.get('utm_source') || '').toLowerCase()
    var campana = (q.get('utm_campaign') || '').slice(0, 60)
    var f = ''
    if (src) {
      f = /^(fb|facebook)/.test(src) ? 'facebook' : /^(ig|instagram)/.test(src) ? 'instagram'
        : /tiktok/.test(src) ? 'tiktok' : /google/.test(src) ? 'google'
        : /whats|^wsp|^wa$/.test(src) ? 'whatsapp' : src.slice(0, 30)
    }
    else if (/(^|\.)instagram\.com$/.test(ref) || /Instagram/.test(ua)) f = 'instagram'
    else if (/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/.test(ref) || /FBAN|FBAV|FB_IAB/.test(ua) || q.has('fbclid')) f = 'facebook'
    else if (/tiktok/.test(ref) || /musical_ly|BytedanceWebview|TikTok/i.test(ua)) f = 'tiktok'
    else if (q.has('gclid') || q.has('gbraid') || q.has('wbraid') || /(^|\.)google\./.test(ref)) f = 'google'
    else if (/whatsapp/.test(ref) || /WhatsApp/i.test(ua)) f = 'whatsapp'
    else if (/youtube\.com$|youtu\.be$/.test(ref)) f = 'youtube'
    else if (/(^|\.)(bing\.com|yahoo\.com|duckduckgo\.com|ecosia\.org)$/.test(ref)) f = 'otros buscadores'
    else if (/(^|\.)urbisgroupinmobiliaria\.com$/.test(ref)) f = 'panel'   // desde el panel (el personal)
    else if (ref) f = 'otra web'
    return f ? { fuente: f, campana: campana, referente: ref } : null
  }
  var vino = llegada()

  // una VISITA = sesión: se renueva tras 30 min sin actividad, o si vuelve desde otro anuncio/red
  function sesion() {
    var s = null
    try { s = JSON.parse(leer('urbis_s') || 'null') } catch (e) { s = null }
    var ahora = Date.now()
    if (!s || !s.id || ahora - (s.t || 0) > 30 * 60 * 1000 || (vino && (vino.fuente !== s.f || vino.campana !== s.c))) {
      s = { id: azar(), f: vino ? vino.fuente : 'directo', c: vino ? vino.campana : '', r: vino ? vino.referente : '' }
    }
    vino = null                                                  // la llegada se usa una sola vez
    s.t = ahora
    guardar('urbis_s', JSON.stringify(s))
    return s
  }

  function enviar(tipo, detalle, ruta) {
    if (apagado) return
    var s = sesion()
    var datos = {
      visitante: visitante, sesion: s.id, tipo: tipo, ruta: ruta || location.pathname,
      fuente: s.f, campana: s.c || null, referente: s.r || null, dispositivo: dispositivo,
      detalle: detalle == null ? null : String(detalle).slice(0, 80),
    }
    if (LOCAL) { try { console.info('[contador]', datos) } catch (e) { /* nada */ } return }
    try {
      fetch(API + '/rest/v1/rpc/web_evento', {
        method: 'POST', keepalive: true, mode: 'cors', credentials: 'omit',
        headers: { 'Content-Type': 'application/json', apikey: CLAVE, Authorization: 'Bearer ' + CLAVE },
        body: JSON.stringify({ p: datos }),
      }).catch(function () { /* que no se note */ })
    } catch (e) { /* que no se note */ }
  }

  // ---- vistas: al cargar y en cada cambio de página (la web es una SPA) ----
  var ultima = null
  function vista() {
    var r = location.pathname
    if (r === ultima) return                                     // el #… de los recorridos no cuenta
    ultima = r
    if (/^\/c\//.test(r)) return                                 // la boleta del cliente no es marketing
    if (incrustado) return                                       // el recorrido dentro del landing ya cuenta como 'recorrido'
    enviar('vista', null, r)
  }
  ;['pushState', 'replaceState'].forEach(function (m) {
    var original = history[m]
    if (typeof original !== 'function') return
    history[m] = function () { var x = original.apply(this, arguments); setTimeout(vista, 0); return x }
  })
  w.addEventListener('popstate', function () { setTimeout(vista, 0) })
  setTimeout(vista, 300)                                         // deja que la página haga su redirección, si la tiene

  // ---- clics en enlaces ----
  d.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null
    if (!a || a.closest('[data-no-contar]')) return
    var h = a.href || '', m
    if (/^https?:\/\/(wa\.me|(api|web|www)\.whatsapp\.com|whatsapp\.com)\//i.test(h)) {
      m = h.match(/wa\.me\/(\d+)/i) || h.match(/[?&]phone=(\d+)/i)
      enviar('whatsapp', m ? m[1] : null)
    } else if (/^tel:/i.test(h)) {
      enviar('llamada', h.slice(4).replace(/[^\d+]/g, ''))
    } else if (/google\.[a-z.]+\/maps|maps\.google\.|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(h)) {
      enviar('mapa', null)
    } else if (/^https?:\/\/([a-z]+\.)?(facebook\.com|instagram\.com|tiktok\.com|youtube\.com)\//i.test(h)) {
      m = h.match(/^https?:\/\/(?:[a-z]+\.)?([a-z]+)\.com\/([^/?#]*)/i)
      enviar('redes', m ? (m[1] + '/' + m[2]).toLowerCase() : null)
    } else if (a.host === location.host && /^\/recorrido\//.test(a.pathname) && !/^\/recorrido\//.test(location.pathname)) {
      enviar('recorrido', a.pathname)
    }
  }, true)

  // ---- lo que avisa la página (formulario enviado, lote tocado, recorrido abierto) ----
  w.urbisContador = { evento: function (tipo, detalle) { enviar(tipo, detalle) } }
})()
