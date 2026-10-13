// BUSCAR GASTOS (13 oct 2026, pedido del dueño: "una búsqueda en las solicitudes más
// práctica, por motivo, en todos los usuarios"). La usan Gastos (todos los roles) y
// la pantalla de Gastos de facturación. Todo en el navegador: los gastos ya están cargados.
//
//   · varias palabras a la vez (todas tienen que estar): motivo, quién recibe, SOL,
//     el lote ("G4", "G-4", "G 4" o "MZ G LT 4" encuentran "MZ G LT 4") o el monto
//   · motivos: grupos armados con las palabras con que de verdad se escriben los gastos
//   · fechas: este mes, el pasado, este año, o desde / hasta

export const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const hoyLima = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10)
export const fechaGasto = g => String(g.issue_date || g.reception_date || '').slice(0, 10)

// los grupos de motivos, en el orden en que se muestran (solo salen los que tienen gastos)
export const MOTIVOS = [
  { k: 'comision', t: '🤝 Comisiones', re: /COMISION/ },
  { k: 'personal', t: '👥 Sueldos y personal', re: /SUELDO|REMUNERACION|QUINCEN|PLANILLA|HONORARIO|SECRETARI|SUPERVISOR|VENDEDOR|PERSONAL/ },
  { k: 'oficina', t: '🏢 Alquiler y servicios', re: /ALQUILER|OFICINA|\bAGUA\b|\bLUZ\b|INTERNET|SERVICIOS BASICOS|TELEFON/ },
  { k: 'publicidad', t: '📣 Publicidad y diseño', re: /PUBLICIDAD|\bADS\b|FACEBOOK|MARKETING|DISENADOR|EDITOR|EDICION|ROLL ?SCREEN|BANNER|LANZAMIENTO|DIGITAL|VOLANTE|PERIFONEO|GIGANTOGRAFIA|VIDEO|DRON/ },
  { k: 'topografia', t: '📐 Topografía y planos', re: /TOPOGRAF|PLANO|LEVANTAMIENTO|LOTIZACION|INGENIER|ARQUITECT|PERITO/ },
  { k: 'obra', t: '🚜 Obra y maquinaria', re: /EXCAVADORA|MAQUINA|CALLE|\bOBRA|MATERIAL|CEMENTO|LIMPIEZA|DESBROCE|FUMIGA|HITO|ESTACA|TRACTOR|VOLQUETE|AFIRMADO|CERCO|POSTE/ },
  { k: 'movilidad', t: '🚗 Movilidad y viáticos', re: /MOVILIDAD|PASAJE|VIATICO|COMBUSTIBLE|GASOLINA|PETROLEO|TRANSPORTE|FLETE|ALIMENTACION|ALMUERZO/ },
  { k: 'tramites', t: '📜 Trámites y legales', re: /NOTARI|SUNARP|REGISTR|MUNICIPAL|LICENCIA|TRAMITE|ABOGAD|LEGAL|PARTIDA|CERTIFICADO|IMPUESTO|ARBITRIO/ },
]
const OTROS = { k: 'otros', t: '📦 Otros' }

// lo que se busca de cada gasto, armado una sola vez por gasto
const cache = new WeakMap()
function indice(g) {
  let x = cache.get(g)
  if (x) return x
  const motivo = sinTildes([g.description, g.type, g.detail].join(' ')).toUpperCase()
  // los lotes que nombra el gasto, como "g4": MZ G LT 4 · MZ. G LT. 4 · LOTE G-4 · G-4 · G4
  const lotes = new Set()
  const pon = (m, l) => lotes.add(m.toLowerCase() + String(Number(l)))
  for (const m of motivo.matchAll(/\bMZ\.?\s*([A-Z]{1,2})\s*[,-]?\s*(?:LT|LOTE)\.?\s*N?°?\s*(\d{1,3})\b/g)) pon(m[1], m[2])
  for (const m of motivo.matchAll(/\bLOTE\s+([A-Z]{1,2})\s*-?\s*([1-9]\d{0,2})\b/g)) pon(m[1], m[2])
  for (const m of motivo.matchAll(/\b([A-Z])\s*-\s*([1-9]\d{0,2})\b/g)) pon(m[1], m[2])
  for (const m of motivo.matchAll(/\b([A-Z])([1-9]\d{0,2})\b/g)) pon(m[1], m[2])
  const sol = g.request_number ? String(g.request_number) : ''
  const texto = sinTildes([
    sol && 'sol-' + sol.padStart(5, '0'), g.recipient, g.recipient_dni, g.sender, g.adelanto_por, g.description, g.type, g.detail,
    g.document_type, g.payment_method, g.voucher_note, g.receipt_note, g.request_doc_note, g.requester_name, g.approved_name,
  ].filter(Boolean).join(' · '))
  const motivos = MOTIVOS.filter(m => m.re.test(motivo)).map(m => m.k)
  x = { texto, lotes, sol, monto: Number(g.amount || 0), motivos: motivos.length ? motivos : [OTROS.k] }
  cache.set(g, x)
  return x
}

// "mz g lt 4", "g-4" y "g 4" se buscan como el lote g4
function palabras(q) {
  return sinTildes(q)
    .replace(/\bmz\.?\s*([a-z]{1,2})\s*[,-]?\s*(?:lt|lote)\.?\s*(\d{1,3})\b/g, '$1$2')
    .replace(/\blote\s+([a-z]{1,2})\s*-?\s*(\d{1,3})\b/g, '$1$2')
    .replace(/\b([a-z]{1,2})\s*-\s*(\d{1,3})\b/g, '$1$2')
    .replace(/(^|\s)([a-z])\s+(\d{1,3})(?=\s|$)/g, '$1$2$3')
    .split(/\s+/).filter(Boolean)
}

function coincide(x, w) {
  // una letra sola es una manzana: "comision g" = las comisiones de lotes de la G
  if (/^[a-z]$/.test(w)) return [...x.lotes].some(l => l[0] === w && /\d/.test(l[1]))
  // un lote: tiene que ser ESE lote (g4 no es g40 ni g41)
  if (/^[a-z]{1,2}\d{1,3}$/.test(w)) {
    const lote = w.replace(/\d+$/, n => String(Number(n)))
    return x.lotes.has(lote) || new RegExp('\\b' + w + '\\b').test(x.texto)
  }
  // un número: el monto exacto, el número de solicitud, o que aparezca en el texto (DNI, operación…)
  if (/^\d+([.,]\d{1,2})?$/.test(w)) {
    const n = Number(w.replace(',', '.'))
    if (Math.abs(n - x.monto) < 0.005 || (x.sol && Number(x.sol) === n)) return true
    return /^\d{3,}$/.test(w) && x.texto.includes(w)
  }
  return x.texto.includes(w)
}

export const FILTRO_VACIO = { q: '', motivo: '', desde: '', hasta: '' }
export const hayFiltro = f => !!(f.q.trim() || f.motivo || f.desde || f.hasta)

export function filtrarGastos(lista, f) {
  const ws = palabras(f.q)
  return lista.filter(g => {
    const fe = fechaGasto(g)
    if (f.desde && (!fe || fe < f.desde)) return false
    if (f.hasta && (!fe || fe > f.hasta)) return false
    const x = indice(g)
    if (f.motivo && !x.motivos.includes(f.motivo)) return false
    return ws.every(w => coincide(x, w))
  })
}

// los grupos de motivos que tiene esta lista, con cuántos gastos hay en cada uno
export function motivosDe(lista) {
  const n = {}
  for (const g of lista) for (const k of indice(g).motivos) n[k] = (n[k] || 0) + 1
  return [...MOTIVOS, OTROS].filter(m => n[m.k]).map(m => ({ ...m, n: n[m.k] }))
}

// atajos de fecha
export function rangoDe(cual) {
  const h = hoyLima(), y = Number(h.slice(0, 4)), m = Number(h.slice(5, 7))
  const ultimo = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  const ym = (yy, mm) => yy + '-' + String(mm).padStart(2, '0')
  if (cual === 'mes') return { desde: ym(y, m) + '-01', hasta: ym(y, m) + '-' + ultimo(y, m) }
  if (cual === 'mes_ant') { const yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1; return { desde: ym(yy, mm) + '-01', hasta: ym(yy, mm) + '-' + ultimo(yy, mm) } }
  if (cual === 'anio') return { desde: y + '-01-01', hasta: y + '-12-31' }
  return { desde: '', hasta: '' }
}
