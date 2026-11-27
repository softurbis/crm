import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProject, colorProyecto } from '../context/ProjectContext'
import { numeroGasto } from './ConstanciaGasto'
import '../styles/buscador.css'

// ============================================================
// BUSCADOR GENERAL — Ctrl+K (o "/") desde cualquier pantalla (26 nov 2026)
// ------------------------------------------------------------
// Antes, para llegar a un lote, un cliente o un gasto había que entrar a la pantalla
// correcta y buscar ahí. Aquí se escribe y se salta directo:
//   · pantallas del menú ("gastos", "pagos")       → la pantalla
//   · lotes ("G-12", "g12", "mz g lt 12")          → la ficha del lote
//   · clientes (nombre, DNI, celular)              → la ficha de su lote (o Clientes)
//   · gastos ("SOL-424", "424", a quién, para qué) → Gastos con la ficha abierta
// Al abrir algo de otro proyecto, el panel pasa a ESE proyecto. La base (RLS) decide
// qué ve cada quien: el buscador no muestra nada que la persona no pueda abrir.
// ============================================================
const RECIENTES = 'urbis.buscador.recientes'
const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
// lo que PostgREST no deja meter en un filtro .or() (comas, paréntesis, comodines)
const limpio = s => String(s || '').replace(/[,()%*\\:"']/g, ' ').replace(/\s+/g, ' ').trim()
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ESTADO_LOTE = { disponible: 'Disponible', separado: 'Separado', vendido: 'Vendido', entregado: 'Entregado', invadido: 'Invadido', expropiado: 'Expropiado' }
const estadoLote = s => ESTADO_LOTE[s] || (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')
// "LAS PRADERAS DE CASHIBO" → "Praderas de Cashibo"; "EL TRIUNFO DE NESHUYA" → "Triunfo de Neshuya"
const nombreCorto = n => String(n || '').trim().replace(/^(las|los|el|la)\s+/i, '').toLowerCase()
  .replace(/(^|\s)(\S)/g, (m, e, c) => e + c.toUpperCase()).replace(/\s(De|Del|La|Las|Los|El|Y)(?=\s)/g, m => m.toLowerCase())

// "G-12", "g12", "G 12", "mz G lt 12", "manzana g lote 12" → { mz: 'G', lt: '12' }
function comoLote(q) {
  const t = sinTildes(q).replace(/\b(mz|manzana)\.?\s*/g, '').replace(/\b(lt|lote)\.?\s*/g, ' ').trim()
  const m = t.match(/^([a-zñ]{1,3})\s*-?\s*(\d{1,3})$/)
  return m ? { mz: m[1].toUpperCase(), lt: String(Number(m[2])) } : null
}
// "SOL-00424", "sol 424", "GAS-00012" (registro directo), "424" → 424
function comoSolicitud(q) {
  const m = sinTildes(q).match(/^(?:(?:sol|gas)\s*-?\s*)?0*(\d{1,6})$/)
  return m ? Number(m[1]) : null
}

// "B001-16", "f001 5", "BP01-00007" → { serie: 'B001', numero: 16 }
function comoComprobante(q) {
  const m = String(q || '').trim().toUpperCase().match(/^([BF][A-Z0-9]{3})\s*-?\s*0*(\d{1,8})$/)
  return m ? { serie: m[1], numero: Number(m[2]) } : null
}
const TIPOS = { factura: 'Factura', boleta: 'Boleta', nota_credito: 'Nota de crédito', nota_debito: 'Nota de débito' }
const nombreTipo = c => TIPOS[c.tipo] || (/^F/.test(c.serie) ? 'Factura' : 'Boleta')
const fechaCorta = f => f ? String(f).slice(0, 10).split('-').reverse().join('/') : ''

function leerRecientes() { try { const v = JSON.parse(localStorage.getItem(RECIENTES) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }

export default function BuscadorGeneral({ pantallas = [] }) {
  const nav = useNavigate()
  const { projects, select } = useProject()
  const [abierto, setAbierto] = useState(false)
  const [q, setQ] = useState('')
  const [res, setRes] = useState({ lotes: [], clientes: [], gastos: [] })
  const [buscando, setBuscando] = useState(false)
  const [activo, setActivo] = useState(0)
  const [recientes, setRecientes] = useState(leerRecientes)
  const entrada = useRef(null)
  const lista = useRef(null)
  const vuelta = useRef(0)

  // abrir: Ctrl+K / Cmd+K en cualquier lado; "/" si no se está escribiendo; o el botón del menú
  useEffect(() => {
    const tecla = e => {
      const k = e.key?.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); setAbierto(a => !a); return }
      if (k === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const el = document.activeElement
        const escribiendo = el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))
        if (!escribiendo) { e.preventDefault(); setAbierto(true) }
      }
    }
    const pedir = () => setAbierto(true)
    window.addEventListener('keydown', tecla)
    window.addEventListener('urbis-buscar', pedir)
    return () => { window.removeEventListener('keydown', tecla); window.removeEventListener('urbis-buscar', pedir) }
  }, [])

  useEffect(() => {
    if (!abierto) return
    setQ(''); setRes({ lotes: [], clientes: [], gastos: [] }); setActivo(0); setRecientes(leerRecientes())
    setTimeout(() => entrada.current?.focus(), 0)
  }, [abierto])

  const proyecto = id => {
    const i = projects.findIndex(p => p.id === id)
    return i >= 0 ? { nombre: projects[i].name, corto: nombreCorto(projects[i].name), color: colorProyecto(projects[i], i) } : null
  }

  // ---- la búsqueda en la base (con una pausa corta mientras se escribe) ----
  useEffect(() => {
    if (!abierto) return
    const texto = q.trim()
    const yo = ++vuelta.current
    if (texto.length < 2) { setRes({ lotes: [], clientes: [], gastos: [] }); setBuscando(false); return }
    setBuscando(true)
    const t = setTimeout(async () => {
      const lote = comoLote(texto)
      const sol = comoSolicitud(texto)
      const s = limpio(texto)
      const soloNumeros = /^\d+$/.test(s.replace(/\s/g, ''))
      const comodin = '%' + s.replace(/\s+/g, '%') + '%'
      const pedidos = []

      // lotes
      pedidos.push(lote
        ? supabase.from('lots').select('id, mz, lt, status, project_id').ilike('mz', lote.mz).eq('lt', lote.lt).neq('status', 'eliminado').limit(8)
        : Promise.resolve({ data: [] }))
      // clientes (y sus lotes)
      pedidos.push(s.length >= 3
        ? supabase.from('clients').select('id, full_name, doc_number, phone')
            .or(soloNumeros ? `doc_number.ilike.${s.replace(/\s/g, '')}%,phone.ilike.%${s.replace(/\s/g, '')}%` : `full_name.ilike.${comodin}`)
            .order('full_name').limit(6)
        : Promise.resolve({ data: [] }))
      // gastos: por número de solicitud y por a quién / para qué
      const cols = 'id, project_id, request_number, voucher_grupo, recipient, description, amount, issue_date, status'
      pedidos.push(sol != null
        ? supabase.from('expenses').select(cols).eq('request_number', sol).limit(5)
        : Promise.resolve({ data: [] }))
      pedidos.push(s.length >= 3 && !soloNumeros
        ? supabase.from('expenses').select(cols).or(`recipient.ilike.${comodin},description.ilike.${comodin}`).order('issue_date', { ascending: false }).limit(6)
        : Promise.resolve({ data: [] }))
      // pagos por número de operación del voucher (¿ya se registró?). En la base suelen ir con
      // ceros adelante ("000001316"): se busca lo que CONTIENE los dígitos escritos
      const digitos = s.replace(/\D/g, '')
      pedidos.push(soloNumeros && digitos.length >= 4
        ? supabase.from('daily_income').select('id, project_id, lot_id, date, amount, operation_number, lot:lots(mz, lt)')
            .ilike('operation_number', '%' + digitos + '%').order('date', { ascending: false }).limit(5)
        : Promise.resolve({ data: [] }))
      // boletas y facturas: "B001-16", "F001 5", "BP01-7"
      const comp = comoComprobante(texto)
      pedidos.push(comp
        ? supabase.from('comprobantes').select('id, project_id, lot_id, tipo, serie, numero, total, cliente_nombre, estado, lot:lots(mz, lt)')
            .eq('serie', comp.serie).eq('numero', comp.numero).limit(5)
        : Promise.resolve({ data: [] }))

      const nada = { data: [] }
      const [l, c, g1, g2, pg, cp] = await Promise.all(pedidos.map(p => p.then(r => r, () => nada)))
      const clientes = c.data || []
      const lotes = l.data || []
      // segunda vuelta, en paralelo: los lotes de esos clientes (comprador o co-comprador)
      // y de quién es cada lote encontrado (su venta o, si no hay, la separación vigente)
      const idsC = clientes.map(x => x.id).join(',')
      const idsL = lotes.map(x => x.id)
      const [vc, vl, sl] = await Promise.all([
        clientes.length
          ? supabase.from('sales').select('client_id, co_client_id, status, lot:lots(id, mz, lt, project_id)')
              .or(`client_id.in.(${idsC}),co_client_id.in.(${idsC})`).limit(40).then(r => r, () => nada)
          : nada,
        idsL.length
          ? supabase.from('sales').select('lot_id, status, sale_date, client:clients!sales_client_id_fkey(full_name)').in('lot_id', idsL).then(r => r, () => nada)
          : nada,
        idsL.length
          ? supabase.from('separations').select('lot_id, client:clients(full_name)').in('lot_id', idsL).eq('status', 'vigente').then(r => r, () => nada)
          : nada,
      ])
      if (yo !== vuelta.current) return             // ya se escribió otra cosa
      // el dueño de cada lote: la venta que no fue expropiada (la más nueva); si solo hay
      // expropiadas, la última; si no hay venta, quien lo separó
      const duenoDe = id => {
        const vs = (vl.data || []).filter(v => v.lot_id === id && v.client)
          .sort((a, b) => (a.status === 'expropiado') - (b.status === 'expropiado') || String(b.sale_date || '').localeCompare(String(a.sale_date || '')))
        if (vs.length) return { nombre: vs[0].client.full_name, expropiado: vs[0].status === 'expropiado' }
        const s = (sl.data || []).find(x => x.lot_id === id && x.client)
        return s ? { nombre: s.client.full_name, separado: true } : null
      }
      const gastos = [...(g1.data || []), ...(g2.data || []).filter(x => !(g1.data || []).some(y => y.id === x.id))]
      setRes({
        lotes: lotes.map(x => ({ ...x, dueno: duenoDe(x.id) }))
          .sort((a, b) => (proyecto(a.project_id)?.nombre || '').localeCompare(proyecto(b.project_id)?.nombre || '')),
        clientes: clientes.map(x => ({
          ...x,
          lotes: (vc.data || []).filter(v => v.lot && (v.client_id === x.id || v.co_client_id === x.id))
            .map(v => ({ ...v.lot, expropiado: v.status === 'expropiado' })),
        })),
        gastos,
        pagos: pg.data || [],
        comprobantes: cp.data || [],
      })
      setBuscando(false)
      setActivo(0)
    }, 220)
    return () => clearTimeout(t)
  }, [q, abierto])    

  // ---- todo lo que se puede elegir, en el orden en que se ve ----
  const items = useMemo(() => {
    const texto = sinTildes(q)
    const out = []
    if (!texto) {
      recientes.forEach(r => out.push({ ...r, grupo: 'Recientes' }))
      return out
    }
    pantallas.filter(p => sinTildes(p.label).includes(texto)).slice(0, 5).forEach(p => out.push({
      grupo: 'Pantallas', clave: 'p' + p.to, icono: p.icon, titulo: p.label, sub: 'Ir a la pantalla', ir: { a: p.to },
    }))
    // el lote: su proyecto, su estado y, si tiene dueño, a nombre de quién
    res.lotes.forEach(l => {
      // "Vendido a MARITZA…", "Separado por JUAN…", "Expropiado · antes de PEDRO…"
      const d = l.dueno, est = estadoLote(l.status)
      const sub = !d ? est
        : d.expropiado ? est + ' · antes de ' + d.nombre
        : (d.separado || l.status === 'separado') ? est + ' por ' + d.nombre
        : ['vendido', 'entregado'].includes(l.status) ? est + ' a ' + d.nombre
        : est + ' · ' + d.nombre
      out.push({
        grupo: 'Lotes', clave: 'l' + l.id, icono: '🗺️', titulo: `Lote ${l.mz}-${l.lt}`, sub,
        proyecto: l.project_id, ir: { a: `/lotes/${l.id}`, proyecto: l.project_id },
      })
    })
    // el cliente: con UN lote, abrirlo lleva a la ficha de ese lote; con varios, a Clientes.
    // Cada lote va como botón con su proyecto, y lleva a su ficha.
    res.clientes.forEach(c => {
      const vivos = c.lotes.filter(x => !x.expropiado)
      const uno = vivos.length === 1 ? vivos[0] : c.lotes.length === 1 ? c.lotes[0] : null
      out.push({
        grupo: 'Clientes', clave: 'c' + c.id, icono: '👤', titulo: c.full_name,
        sub: [c.doc_number && 'DNI ' + c.doc_number, !c.lotes.length && 'Sin lote'].filter(Boolean).join(' · '),
        ir: uno ? { a: `/lotes/${uno.id}`, proyecto: uno.project_id } : { a: `/clientes?cliente=${c.id}` },
        lotes: c.lotes.length ? c.lotes : null,
      })
    })
    res.gastos.forEach(g => out.push({
      grupo: 'Gastos', clave: 'g' + g.id, icono: '🧾',
      titulo: (g.request_number ? numeroGasto(g) + ' · ' : '') + (g.recipient || 'Gasto'),
      sub: [soles(g.amount), g.description].filter(Boolean).join(' · '),
      proyecto: g.project_id, ir: { a: `/gastos?gasto=${g.id}`, proyecto: g.project_id },
    }))
    // pagos (por número de operación): lleva a la ficha de su lote, donde está el pago
    ;(res.pagos || []).forEach(p => out.push({
      grupo: 'Pagos', clave: 'pg' + p.id, icono: '💵',
      titulo: soles(p.amount) + (p.lot ? ` · Lote ${p.lot.mz}-${p.lot.lt}` : ''),
      sub: ['Op. ' + p.operation_number, fechaCorta(p.date)].filter(Boolean).join(' · '),
      proyecto: p.project_id,
      ir: p.lot_id ? { a: `/lotes/${p.lot_id}`, proyecto: p.project_id } : { a: '/pagos', proyecto: p.project_id },
    }))
    // boletas y facturas: a la ficha del lote (o a la lista de comprobantes)
    ;(res.comprobantes || []).forEach(x => out.push({
      grupo: 'Boletas y facturas', clave: 'cp' + x.id, icono: '🧾',
      titulo: `${nombreTipo(x)} ${x.serie}-${x.numero}` + (x.lot ? ` · Lote ${x.lot.mz}-${x.lot.lt}` : ''),
      sub: [soles(x.total), x.cliente_nombre, x.estado].filter(Boolean).join(' · '),
      proyecto: x.project_id,
      ir: x.lot_id ? { a: `/lotes/${x.lot_id}`, proyecto: x.project_id } : { a: '/comprobantes', proyecto: x.project_id },
    }))
    return out
  }, [q, res, pantallas, recientes])    

  function abrir(item, destino = item?.ir) {
    if (!item || !destino) return
    if (destino.proyecto) select(destino.proyecto)
    nav(destino.a)
    setAbierto(false)
    // los últimos 6 abiertos, para la próxima vez
    const guardado = { clave: item.clave, icono: item.icono, titulo: item.titulo, sub: item.sub, proyecto: item.proyecto || null, ir: destino }
    const lista = [guardado, ...leerRecientes().filter(r => r.clave !== item.clave)].slice(0, 6)
    try { localStorage.setItem(RECIENTES, JSON.stringify(lista)) } catch { /* sin memoria */ }
  }

  function teclas(e) {
    if (e.key === 'Escape') { e.preventDefault(); setAbierto(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActivo(a => Math.min(items.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo(a => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); abrir(items[activo]) }
  }
  useEffect(() => { lista.current?.querySelector('.bus-item.on')?.scrollIntoView({ block: 'nearest' }) }, [activo])

  if (!abierto) return null
  let grupoAnterior = null
  return (
    <div className="bus-fondo" onMouseDown={e => { if (e.target === e.currentTarget) setAbierto(false) }}>
      <div className="bus-caja" role="dialog" aria-label="Buscar en el panel">
        <div className="bus-entrada">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input ref={entrada} value={q} onChange={e => setQ(e.target.value)} onKeyDown={teclas} spellCheck={false} autoComplete="off"
            placeholder="Lote (G-12), cliente, DNI, gasto (SOL-424), N° de operación, boleta (B001-16) o pantalla…" />
          {buscando ? <span className="bus-giro" aria-label="Buscando" /> : <kbd onClick={() => setAbierto(false)}>Esc</kbd>}
        </div>
        <div className="bus-lista" ref={lista}>
          {!items.length && q.trim().length < 2 && (
            <div className="bus-vacio">
              <b>¿Qué quieres encontrar?</b>
              <span>Prueba con <code>G-12</code>, el nombre o el DNI de un cliente, <code>SOL-424</code>, el número de operación de un voucher, <code>B001-16</code> o el nombre de una pantalla.</span>
            </div>
          )}
          {!items.length && q.trim().length >= 2 && !buscando && (
            <div className="bus-vacio"><b>Sin resultados para «{q.trim()}»</b><span>Revisa cómo está escrito, o prueba con el DNI o el número del lote.</span></div>
          )}
          {items.map((it, i) => {
            const cabecera = it.grupo !== grupoAnterior ? <div className="bus-grupo" key={'h' + it.grupo}>{it.grupo}</div> : null
            grupoAnterior = it.grupo
            const p = it.proyecto ? proyecto(it.proyecto) : null
            return [cabecera, (
              <div key={it.clave} className={'bus-item' + (i === activo ? ' on' : '')} onMouseMove={() => setActivo(i)} onClick={() => abrir(it)}>
                <span className="bus-ico" aria-hidden="true">{it.icono}</span>
                <span className="bus-txt">
                  <b>{it.titulo}</b>
                  {(p || it.sub) && (
                    <small>
                      {p && <span className="bus-p" style={{ '--pc': p.color }} title={p.nombre}><i />{p.corto}</span>}
                      {p && it.sub && ' · '}{it.sub}
                    </small>
                  )}
                  {it.lotes && (
                    <span className="bus-lotes">
                      {it.lotes.map(l => {
                        const pl = proyecto(l.project_id)
                        return (
                          <button type="button" key={l.id} className={l.expropiado ? 'expr' : undefined} style={pl ? { '--pc': pl.color } : undefined}
                            onClick={e => { e.stopPropagation(); abrir(it, { a: `/lotes/${l.id}`, proyecto: l.project_id }) }}
                            title={'Abrir la ficha del lote ' + l.mz + '-' + l.lt + (pl ? ' de ' + pl.nombre : '') + (l.expropiado ? ' (expropiado)' : '')}>
                            <i /><b>{l.mz}-{l.lt}</b>{pl && <span>{pl.corto}</span>}{l.expropiado && <em>expropiado</em>}
                          </button>
                        )
                      })}
                    </span>
                  )}
                </span>
                {i === activo && <span className="bus-enter" aria-hidden="true">↵</span>}
              </div>
            )]
          })}
        </div>
        <div className="bus-pie">
          <span><kbd>↑</kbd><kbd>↓</kbd> moverse</span>
          <span><kbd>Enter</kbd> abrir</span>
          <span><kbd>Esc</kbd> cerrar</span>
          <span className="bus-pie-der"><kbd>?</kbd> todos los atajos</span>
        </div>
      </div>
    </div>
  )
}
