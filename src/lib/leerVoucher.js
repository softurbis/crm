// ============================================================================
// Lectura del voucher (OCR en el navegador con Tesseract).
//
// Objetivo: ADELANTAR trabajo, no reemplazar al que registra. Lo que se detecta
// se muestra como SUGERENCIA y la persona decide si la usa. Nunca se pisa lo que
// ya escribio a mano.
//
// Motor: tesseract.js. Corre 100% en el navegador (gratis, sin backend y sin
// exponer ninguna clave). Baja el idioma (~2MB) del CDN la primera vez y lo
// deja en cache. En capturas limpias de Yape/Plin/banca lee bien; en fotos
// torcidas o borrosas puede fallar — por eso SIEMPRE se valida a mano.
//
// Si algun dia la precision no alcanza, se reemplaza SOLO este archivo por una
// llamada a Claude Vision (Edge Function): el formulario no se entera.
// ============================================================================

let _worker = null

async function worker() {
  if (_worker) return _worker
  const { createWorker } = await import('tesseract.js')
  _worker = await createWorker('spa')
  return _worker
}

// "1,234.56" | "1.234,56" | "1234.5" -> 1234.56
function aNumero(txt) {
  let s = String(txt).replace(/\s/g, '')
  const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.')
  if (coma > -1 && punto > -1) {
    // el ultimo separador manda: es el decimal
    if (coma > punto) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (coma > -1) {
    // una sola coma: decimal si deja 1-2 digitos detras, si no es de miles
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, set: 9, sep: 9, oct: 10, nov: 11, dic: 12 }

function buscarFecha(t) {
  // 15/07/2026 · 15-07-2026 · 15.07.26
  let m = t.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/)
  if (m) {
    const [, d, mes, a] = m
    const anio = a.length === 2 ? 2000 + Number(a) : Number(a)
    if (Number(mes) >= 1 && Number(mes) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }
  // 15 jul 2026 · 15 de julio del 2026
  m = t.match(/\b(\d{1,2})\s*(?:de\s+)?([a-záéíóú]{3})[a-záéíóú]*\.?\s*(?:de[l]?\s+)?(\d{4})\b/i)
  if (m) {
    const mes = MESES[m[2].toLowerCase()]
    if (mes) return `${m[3]}-${String(mes).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`
  }
  return null
}

function buscarMonto(t) {
  // 1) lo mas confiable: un numero pegado al simbolo de soles
  const conSimbolo = [...t.matchAll(/S\s*\/\s*\.?\s*([\d.,]{1,15})/gi)]
    .map(m => aNumero(m[1])).filter(n => n && n > 0)
  if (conSimbolo.length) return Math.max(...conSimbolo)

  // 2) si no hay simbolo, un numero junto a la palabra monto/importe/total/pago
  const m = t.match(/(?:monto|importe|total|pagaste|pago)\D{0,12}([\d.,]{1,15})/i)
  if (m) { const n = aNumero(m[1]); if (n && n > 0) return n }

  // 3) ultimo recurso: algo con decimales explicitos (evita agarrar el N° de operacion)
  const dec = [...t.matchAll(/\b(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\b/g)]
    .map(x => aNumero(x[1])).filter(n => n && n > 0)
  return dec.length ? Math.max(...dec) : null
}

// Bancos y billeteras del Peru. 'claves' son las palabras que aparecen en el
// voucher; 'nombre' es como lo mostramos. El orden importa: primero las
// billeteras, porque un voucher de Yape tambien puede decir "BCP".
const BANCOS = [
  { nombre: 'YAPE', tipo: 'BILLETERA DIGITAL', claves: ['yape', 'yapeaste', 'yapeo'] },
  { nombre: 'PLIN', tipo: 'BILLETERA DIGITAL', claves: ['plin'] },
  { nombre: 'AGORA', tipo: 'BILLETERA DIGITAL', claves: ['agora', 'ágora'] },
  { nombre: 'TUNKI', tipo: 'BILLETERA DIGITAL', claves: ['tunki'] },
  { nombre: 'BCP', tipo: null, claves: ['bcp', 'banco de credito', 'credito del peru', 'viabcp'] },
  { nombre: 'BBVA', tipo: null, claves: ['bbva', 'continental'] },
  { nombre: 'INTERBANK', tipo: null, claves: ['interbank'] },
  { nombre: 'SCOTIABANK', tipo: null, claves: ['scotiabank', 'scotia'] },
  { nombre: 'BANBIF', tipo: null, claves: ['banbif', 'interamericano de finanzas'] },
  { nombre: 'PICHINCHA', tipo: null, claves: ['pichincha'] },
  { nombre: 'MIBANCO', tipo: null, claves: ['mibanco', 'mi banco'] },
  { nombre: 'FALABELLA', tipo: null, claves: ['falabella'] },
  { nombre: 'RIPLEY', tipo: null, claves: ['ripley'] },
  { nombre: 'GNB', tipo: null, claves: ['gnb'] },
  { nombre: 'CAJA PIURA', tipo: null, claves: ['caja piura'] },
  { nombre: 'CAJA HUANCAYO', tipo: null, claves: ['caja huancayo'] },
  { nombre: 'CAJA AREQUIPA', tipo: null, claves: ['caja arequipa'] },
  { nombre: 'CAJA TRUJILLO', tipo: null, claves: ['caja trujillo'] },
  { nombre: 'CAJA CUSCO', tipo: null, claves: ['caja cusco'] },
  { nombre: 'CAJA SULLANA', tipo: null, claves: ['caja sullana'] },
  { nombre: 'COMPARTAMOS', tipo: null, claves: ['compartamos'] },
  { nombre: 'BANCO DE LA NACION', tipo: null, claves: ['banco de la nacion', 'nacion'] },
]

function buscarBanco(t) {
  const b = t.toLowerCase()
  for (const x of BANCOS) if (x.claves.some(k => b.includes(k))) return x
  return null
}

// Los 4 tipos que maneja el formulario: TRANSFERENCIA | DEPOSITO | BILLETERA DIGITAL | EFECTIVO
function buscarTipoOperacion(t, banco) {
  const b = t.toLowerCase()
  if (/dep[oó]sito|depositaste|deposito en efectivo/.test(b)) return 'DEPOSITO'
  if (/transferencia|transferiste|transferido|interbancaria|cci/.test(b)) return 'TRANSFERENCIA'
  if (/efectivo|ventanilla|agente/.test(b)) return 'EFECTIVO'
  if (banco?.tipo) return banco.tipo          // Yape/Plin => BILLETERA DIGITAL
  if (/yapeaste|enviaste|pagaste/.test(b)) return 'BILLETERA DIGITAL'
  return null
}

function buscarOperacion(t) {
  // el numero que sigue a "operacion" / "nro de operacion" / "codigo de operacion"
  const etiquetas = [
    /(?:n[°ºo.]?\s*(?:de\s*)?)?operaci[oó]n\D{0,15}(\d{4,20})/i,
    /(?:c[oó]digo|constancia|comprobante)\D{0,15}(\d{6,20})/i,
    /\bnro\.?\s*\D{0,10}(\d{6,20})/i,
  ]
  for (const re of etiquetas) { const m = t.match(re); if (m) return m[1] }
  return null
}

/**
 * Lee un voucher y devuelve lo que pudo detectar.
 * @returns {{monto:number|null, operacion:string|null, fecha:string|null, texto:string, confianza:number}}
 */
// ---- coordenadas: para poder dibujar el cuadro sobre el voucher ----
// Tesseract entrega cada palabra con su bbox. Segun la version vienen en
// data.words o anidadas en blocks > paragraphs > lines > words.
function palabrasDe(data) {
  if (data?.words?.length) return data.words
  return (data?.blocks || []).flatMap(b =>
    (b.paragraphs || []).flatMap(p => (p.lines || []).flatMap(l => l.words || [])))
}
const soloDigitos = s => String(s || '').replace(/\D/g, '')
const unirCajas = cs => cs.length ? {
  x0: Math.min(...cs.map(b => b.x0)), y0: Math.min(...cs.map(b => b.y0)),
  x1: Math.max(...cs.map(b => b.x1)), y1: Math.max(...cs.map(b => b.y1)),
} : null

// TODOS los montos que aparecen en el voucher, con su caja. Sirve para que la
// persona elija el correcto con un clic: hay vouchers con "monto + comision =
// total" y el que entra a caja NO siempre es el mas alto.
export function candidatosMonto(words) {
  const out = []
  for (const w of words) {
    const limpio = String(w.text || '').replace(/[^\d.,]/g, '')
    if (!/\d/.test(limpio)) continue
    // que parezca dinero: con decimales (270.80) o con separador de miles (1,270)
    const pareceDinero = /[.,]\d{1,2}$/.test(limpio) || /^\d{1,3}(?:[.,]\d{3})+([.,]\d{1,2})?$/.test(limpio)
    if (!pareceDinero) continue
    const n = aNumero(limpio)
    if (n == null || n <= 0 || n > 10000000) continue
    if (out.some(o => Math.abs(o.valor - n) < 0.005)) continue   // sin repetidos
    out.push({ valor: n, bbox: w.bbox || null, texto: String(w.text || '') })
  }
  return out
}

// el monto: la palabra cuyo numero coincide con lo detectado
function cajaMonto(words, monto) {
  if (monto == null) return null
  for (const w of words) {
    const limpio = String(w.text || '').replace(/[^\d.,]/g, '')
    if (!limpio) continue
    const n = aNumero(limpio)
    if (n != null && Math.abs(n - monto) < 0.005) return w.bbox || null
  }
  return null
}
// la operacion: la palabra con exactamente esos digitos
function cajaDigitos(words, valor) {
  const d = soloDigitos(valor)
  if (!d) return null
  for (const w of words) if (soloDigitos(w.text) === d) return w.bbox || null
  return null
}
// la fecha puede venir partida ("15 jul. 2026"): se unen las palabras del dia y el año
function cajaFecha(words, iso) {
  if (!iso) return null
  const [a, m, d] = iso.split('-')
  const junta = words.filter(w => /\d/.test(w.text || '') && soloDigitos(w.text).length >= 4 && (w.text || '').includes(a))
  const dia = words.filter(w => soloDigitos(w.text) === String(Number(d)) || soloDigitos(w.text) === d)
  const completa = words.filter(w => { const t = soloDigitos(w.text); return t.length >= 6 && t.includes(a.slice(2)) })
  const cs = [...junta, ...dia, ...completa].map(w => w.bbox).filter(Boolean)
  // solo se unen si estan en la misma linea (evita un cuadro gigante cruzando el voucher)
  if (!cs.length) return null
  const base = cs[0]
  const mismaLinea = cs.filter(b => Math.abs(b.y0 - base.y0) < (base.y1 - base.y0) * 1.2)
  return unirCajas(mismaLinea)
}

// Tamaño real de la imagen. NO se puede sacar de data.imageColor: ahi no viene
// (devuelve 0x0) y la escala de los cuadros quedaria rota. Se mide del archivo.
async function tamImagen(file) {
  try {
    const bmp = await createImageBitmap(file)
    const t = { w: bmp.width, h: bmp.height }
    bmp.close?.()
    return t
  } catch { return { w: 0, h: 0 } }
}

export async function leerVoucher(file) {
  const w = await worker()
  // blocks:true => vienen las palabras con coordenadas
  const { data } = await w.recognize(file, {}, { blocks: true, text: true })
  const texto = data?.text || ''
  // se normaliza para que los regex no dependan de tildes ni de saltos raros
  const t = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')
  const banco = buscarBanco(t)
  const monto = buscarMonto(t)
  const operacion = buscarOperacion(t)
  const fecha = buscarFecha(t)
  const words = palabrasDe(data)

  return {
    monto, operacion, fecha,
    banco: banco?.nombre || null,
    tipoOperacion: buscarTipoOperacion(t, banco),
    texto,
    confianza: Math.round(data?.confidence || 0),
    // de donde salio cada dato, para marcarlo sobre la imagen
    cajas: {
      monto: cajaMonto(words, monto),
      operacion: cajaDigitos(words, operacion),
      fecha: cajaFecha(words, fecha),
    },
    // todos los montos del voucher: la persona elige el correcto con un clic.
    // Hace falta porque el automatico toma el MAS ALTO, y en un voucher con
    // "monto + comision = total" el que entra a caja es el menor.
    candidatos: candidatosMonto(words),
    imagen: await tamImagen(file),
  }
}

// Solo se lee lo que es imagen. Un PDF se sube igual, pero sin analizar.
export const esImagen = file => !!file && /^image\//.test(file.type || '')
