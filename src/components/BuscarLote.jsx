import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProject } from '../context/ProjectContext'
import { COLORS, LBL } from '../lib/lotes'

const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const digitos = s => String(s || '').replace(/\D/g, '')

// todas las filas, de a 1000 (el servidor corta ahi sin avisar)
async function todas(hacer) {
  const out = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await hacer().range(desde, desde + 999)
    if (error || !data?.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

// lo que se busca de cada lote: el lote escrito de varias formas y su gente
const conHeno = lotes => lotes.map(lote => ({
  ...lote,
  heno: sinTildes([
    `${lote.mz}${lote.lt} ${lote.mz}-${lote.lt} mz ${lote.mz} lt ${lote.lt}`,
    ...lote.personas.map(p => `${p.full_name} ${p.doc_number || ''} ${digitos(p.phone)}`),
  ].join(' ')),
}))

// ¿Lo escrito es un lote? "a1", "a 1", "a-1", "mz a lt 1", "A1" → { mz: 'a', lt: '1' }.
// Una letra sola es la manzana entera.
function comoLote(t) {
  const m = t.match(/^(?:mz\.?\s*)?([a-z]{1,2})\s*[-.]?\s*(?:(?:lt|lote)\.?\s*)?(\d{1,3})$/)
  if (m) return { mz: m[1], lt: String(Number(m[2])) }
  const sola = t.match(/^(?:mz\.?\s*)?([a-z])$/)
  return sola ? { mz: sola[1], lt: '' } : null
}
const numLt = lt => Number(String(lt).replace(/\D/g, '')) || 0

// Quien esta ligado a cada lote: titular y co-comprador de la venta viva, o quien
// lo separo. Se consulta recien al usar el buscador, no al abrir la pantalla: la
// mayoria de las veces nadie lo toca. Puede ser de uno o de varios proyectos.
async function cargarGente(pids) {
  const [lotes, ventas, seps] = await Promise.all([
    todas(() => supabase.from('lots').select('id, mz, lt, status, project_id').in('project_id', pids).order('id')),
    todas(() => supabase.from('sales')
      .select('lot_id, client:clients!sales_client_id_fkey(full_name, doc_number, phone), co_client:clients!sales_co_client_id_fkey(full_name, doc_number, phone), lot:lots!inner(project_id)')
      .in('lot.project_id', pids).in('status', ['en_proceso', 'pagado']).order('id')),
    todas(() => supabase.from('separations')
      .select('lot_id, client:clients(full_name, doc_number, phone), lot:lots!inner(project_id)')
      .in('lot.project_id', pids).eq('status', 'vigente').order('id')),
  ])
  const l = { data: lotes.sort((a, b) => String(a.mz).localeCompare(String(b.mz)) || String(a.lt).localeCompare(String(b.lt), undefined, { numeric: true })) }
  const v = { data: ventas }, s = { data: seps }
  const gente = new Map()
  const poner = (lotId, c, rol) => {
    if (!c) return
    if (!gente.has(lotId)) gente.set(lotId, [])
    gente.get(lotId).push({ ...c, rol })
  }
  for (const x of (v.data || [])) { poner(x.lot_id, x.client, 'titular'); poner(x.lot_id, x.co_client, 'co-comprador') }
  for (const x of (s.data || [])) poner(x.lot_id, x.client, 'separó')
  return conHeno((l.data || []).map(lote => ({ ...lote, personas: gente.get(lote.id) || [] })))
}


// Buscador de la ficha del lote: se escribe el lote (G7, G-7), un nombre, el DNI
// o el celular, y se cae directo en la ficha. Es la puerta de entrada del dia a
// dia de la secretaria.
//   proyectos = ids donde buscar (en "Hoy" son todos los de la persona); si no
//   llega, busca en el proyecto elegido.
//   cargar = otra fuente de lotes ([{ id, mz, lt, status, project_id, proyecto, personas }]):
//   la usa facturación, que no lee las tablas (sql/146). onElegir = qué hacer al
//   elegir uno (si no llega, se abre la ficha del lote).
export default function BuscarLote({ autoFocus, placeholder = 'Buscar lote (G7), nombre, DNI o celular…', proyectos, cargar, onElegir }) {
  const { pidOp, projects } = useProject()
  const pids = proyectos?.length ? proyectos : (pidOp ? [pidOp] : [])
  const clavePids = pids.join(',')
  const nombreProy = l => l.proyecto || projects.find(x => x.id === l.project_id)?.name || ''
  const irA = useNavigate()
  const [datos, setDatos] = useState(null)       // null = todavia no se consulto
  const [cargando, setCargando] = useState(false)
  const [q, setQ] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [i, setI] = useState(0)
  const caja = useRef(null)
  const lista = useRef(null)

  // otro proyecto = otra gente: se vuelve a consultar cuando se use
  useEffect(() => { setDatos(null) }, [clavePids])

  async function asegurarDatos() {
    if (datos || cargando || (!cargar && !pids.length)) return
    setCargando(true)
    try { setDatos(cargar ? conHeno(await cargar()) : await cargarGente(pids)) } finally { setCargando(false) }
  }
  const varios = cargar ? new Set((datos || []).map(l => l.project_id)).size > 1 : pids.length > 1

  const resultados = useMemo(() => {
    const t = sinTildes(q).trim()
    if (!t || !datos) return []
    // "a 1": el A-1 primero y después los de la A que empiezan con 1 (A-10, A-11…),
    // nunca mezclado con otras manzanas ni con nombres que tengan una "a" (13 oct)
    const lote = comoLote(t)
    if (lote) {
      const deLaMz = datos.filter(l => sinTildes(l.mz) === lote.mz && String(numLt(l.lt)).startsWith(lote.lt))
      if (deLaMz.length) return deLaMz
        .map(l => ({ l, exacto: lote.lt !== '' && String(numLt(l.lt)) === lote.lt }))
        .sort((a, b) => b.exacto - a.exacto || numLt(a.l.lt) - numLt(b.l.lt) || String(a.l.lt).localeCompare(String(b.l.lt)))
        .slice(0, 60).map(x => x.l)
    }
    const partes = t.split(/\s+/)
    const compacto = t.replace(/[\s-]/g, '')
    return datos
      .filter(l => partes.every(p => l.heno.includes(p)))
      .map(l => ({
        l,
        // primero el lote exacto ("g7"), despues DNI o celular exacto, despues el resto
        orden: sinTildes(`${l.mz}${l.lt}`) === compacto ? 0
          : l.personas.some(p => digitos(p.doc_number) === compacto || (compacto.length >= 6 && digitos(p.phone).endsWith(compacto))) ? 1 : 2,
      }))
      .sort((a, b) => a.orden - b.orden)
      .slice(0, 30)
      .map(x => x.l)
  }, [q, datos])

  const exacto = l => { const lo = comoLote(sinTildes(q).trim()); return !!lo && lo.lt !== '' && sinTildes(l.mz) === lo.mz && String(numLt(l.lt)) === lo.lt }
  useEffect(() => { setI(0) }, [q])
  useEffect(() => { lista.current?.children[i]?.scrollIntoView({ block: 'nearest' }) }, [i])
  useEffect(() => {
    if (!abierto) return
    const fuera = e => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  const elegir = l => { setAbierto(false); setQ(''); onElegir ? onElegir(l) : irA('/lotes/' + l.id) }
  const tecla = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(true); setI(x => Math.min(resultados.length - 1, x + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(0, x - 1)) }
    else if (e.key === 'Enter') { if (resultados[i]) { e.preventDefault(); elegir(resultados[i]) } }
    else if (e.key === 'Escape') { setAbierto(false) }
  }

  return (
    <div className="bsc buscar-lote" ref={caja}>
      <input className="bsc-in search" value={q} placeholder={placeholder} autoFocus={autoFocus}
        style={{ textTransform: 'none' }}
        onFocus={() => { asegurarDatos(); setAbierto(true) }}
        onChange={e => { setQ(e.target.value); setAbierto(true) }}
        onKeyDown={tecla} />
      {abierto && q.trim() && (
        <div className="bsc-menu glass">
          {cargando && <p className="muted bsc-nada">Buscando…</p>}
          {!cargando && datos && <div className="bsc-cnt muted">{resultados.length} {resultados.length === 1 ? 'lote' : 'lotes'}</div>}
          <div className="bsc-lista" ref={lista} style={{ maxHeight: 340 }}>
            {resultados.map((l, k) => {
              const p = l.personas[0]
              return (
                <button type="button" key={l.id} className={`bsc-op bl-op ${k === i ? 'foco' : ''}`}
                  onMouseEnter={() => setI(k)} onClick={() => elegir(l)}>
                  <span className="bl-dot" style={{ background: COLORS[l.status] }} />
                  <b className="bl-lote">{l.mz}-{l.lt}</b>
                  {k === 0 && exacto(l) && <span className="bl-exacto">este</span>}
                  <span className="bsc-lbl">
                    {p ? p.full_name : <span className="muted">sin cliente</span>}
                    {l.personas.length > 1 && <span className="muted"> + {l.personas.slice(1).map(x => x.full_name).join(', ')}</span>}
                  </span>
                  <span className="bsc-sub muted">{p?.doc_number && !String(p.doc_number).startsWith('PEND') ? p.doc_number + ' · ' : ''}{LBL[l.status]}{varios ? ' · ' + nombreProy(l) : ''}</span>
                </button>
              )
            })}
            {!cargando && datos && !resultados.length && <p className="muted bsc-nada">Ningún lote coincide con «{q}».</p>}
          </div>
        </div>
      )}
    </div>
  )
}
