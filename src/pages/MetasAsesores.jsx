import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { savedFx } from '../lib/saveFx'
import { avisar, confirmar, pedirDatos } from '../lib/dialogos'
import { useAuth } from '../context/AuthContext'

// METAS DE LOS ASESORES (28 nov 2026, pedido de gerencia C9, sql/254): cada asesor con su meta
// del mes y su avance, su comisión, sus viáticos y el bono según lo cobrado. Todo sale de
// avance_asesores(): el ASESOR ve solo lo suyo (desde su celular, menú "Mi meta"); gerencia ve a
// todos y fija metas, viáticos y bonos pagados.
// Regla del bono (la fija gerencia en cada meta): bono_monto al cumplir la meta de ventas
// (cuentan las ventas del mes con la inicial cobrada) + un % de lo cobrado de sus ventas en el mes.
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const mesHoy = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 7)
const nombreMes = m => new Date(m + '-15T12:00:00').toLocaleDateString('es-PE', { month: 'long', year: 'numeric' }).toUpperCase()
const TIPOS = { viatico: '🚌 Viático', bono: '🏆 Bono', adelanto: '💸 Adelanto', otro: 'Otro' }

function Barra({ hecho, meta }) {
  if (!meta) return <span className="muted small">sin meta</span>
  const pct = Math.min(100, Math.round(hecho / meta * 100))
  return (
    <div title={hecho + ' de ' + meta}>
      <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,.12)', overflow: 'hidden', minWidth: 90 }}>
        <div style={{ width: pct + '%', height: '100%', background: pct >= 100 ? '#6fdd9b' : pct >= 60 ? '#e0b34c' : '#ff8e7a' }} />
      </div>
      <div className="small muted">{hecho} de {meta} · {pct}%</div>
    </div>
  )
}

export default function MetasAsesores() {
  const { role } = useAuth()
  const [mes, setMes] = useState(mesHoy())
  const [filas, setFilas] = useState(null)
  const [movs, setMovs] = useState([])
  const [err, setErr] = useState('')
  const esAsesor = role === 'asesor'
  const puedeEditar = ['superuser', 'admin', 'operador'].includes(role)

  const cargar = async () => {
    setErr('')
    const { data, error } = await supabase.rpc('avance_asesores', { p_mes: mes + '-01' })
    if (error) { setErr(error.message); setFilas([]); return }
    setFilas(data || [])
    const d2 = new Date(mes + '-01T12:00:00'); d2.setMonth(d2.getMonth() + 1)
    const { data: m } = await supabase.from('asesor_movimientos').select('*').gte('fecha', mes + '-01').lt('fecha', d2.toISOString().slice(0, 10)).order('fecha', { ascending: false })
    setMovs(m || [])
  }
  useEffect(() => { cargar() }, [mes])

  async function editarMeta(f) {
    const d = await pedirDatos({
      titulo: '🎯 Meta de ' + f.full_name + ' — ' + nombreMes(mes), aceptar: 'Guardar',
      campos: [
        { clave: 'ventas', etiqueta: 'Meta de ventas (cantidad de lotes)', tipo: 'numero', valor: f.meta_ventas || '', obligatorio: true },
        { clave: 'monto', etiqueta: 'Meta en soles vendidos (opcional)', tipo: 'monto', valor: f.meta_monto ?? '' },
        { clave: 'bono', etiqueta: 'Bono al cumplir la meta (S/)', tipo: 'monto', valor: f.bono_monto || '', ayuda: 'Cuentan las ventas del mes con la inicial cobrada.' },
        { clave: 'pct', etiqueta: '% de lo cobrado de sus ventas en el mes (opcional)', tipo: 'numero', valor: f.bono_pct_cobrado || '' },
      ],
    })
    if (!d) return
    const { error } = await supabase.from('asesor_metas').upsert({
      advisor_id: f.advisor_id, mes: mes + '-01', meta_ventas: parseInt(d.ventas) || 0,
      meta_monto: d.monto === '' ? null : Number(d.monto), bono_monto: Number(d.bono) || 0, bono_pct_cobrado: Number(d.pct) || 0,
    }, { onConflict: 'advisor_id,mes' })
    if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return }
    savedFx(); cargar()
  }
  async function pagar(f, tipo) {
    const d = await pedirDatos({
      titulo: TIPOS[tipo] + ' pagado a ' + f.full_name, aceptar: 'Registrar',
      campos: [
        { clave: 'monto', etiqueta: 'Monto (S/)', tipo: 'monto', obligatorio: true, valor: tipo === 'bono' && Number(f.bono_ganado) > Number(f.bonos_pagados) ? String(Number(f.bono_ganado) - Number(f.bonos_pagados)) : '' },
        { clave: 'fecha', etiqueta: 'Fecha', tipo: 'fecha', obligatorio: true, valor: new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10) },
        { clave: 'concepto', etiqueta: 'Concepto', valor: '', placeholder: tipo === 'viatico' ? 'Movilidad a Campo Verde, almuerzo de la feria…' : '' },
      ],
    })
    if (!d) return
    const { error } = await supabase.from('asesor_movimientos').insert({ advisor_id: f.advisor_id, tipo, monto: Number(d.monto), fecha: d.fecha, concepto: String(d.concepto || '').trim().toUpperCase() || null })
    if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return }
    savedFx(); cargar()
  }
  async function quitarMov(m) {
    if (!await confirmar('¿Quitar este ' + (TIPOS[m.tipo] || m.tipo).toLowerCase() + ' de ' + soles(m.monto) + '?', { peligro: true, aceptar: 'Sí, quitar' })) return
    await supabase.from('asesor_movimientos').delete().eq('id', m.id); cargar()
  }
  async function excel() {
    const { descargarLista } = await import('../lib/excelLista')
    await descargarLista({
      hoja: 'Metas ' + mes, tituloLibro: 'Metas de los asesores — ' + nombreMes(mes), filas: filas || [],
      columnas: [
        { t: 'Asesor', w: 30, v: f => f.full_name }, { t: 'Código', w: 12, v: f => f.code },
        { t: 'Meta (lotes)', w: 10, f: 'num', v: f => f.meta_ventas }, { t: 'Ventas', w: 9, f: 'num', v: f => f.ventas, total: true },
        { t: 'Con inicial cobrada', w: 11, f: 'num', v: f => f.ventas_con_inicial, total: true },
        { t: 'Vendido', w: 14, f: 'soles', v: f => f.ventas_monto, total: true }, { t: 'Cobrado del mes', w: 14, f: 'soles', v: f => f.cobrado, total: true },
        { t: 'Comisión pendiente', w: 14, f: 'soles', v: f => f.comision_pendiente, total: true }, { t: 'Comisión pagada (mes)', w: 14, f: 'soles', v: f => f.comision_pagada_mes, total: true },
        { t: 'Viáticos', w: 12, f: 'soles', v: f => f.viaticos, total: true }, { t: 'Bono ganado', w: 12, f: 'soles', v: f => f.bono_ganado, total: true },
        { t: 'Bono pagado', w: 12, f: 'soles', v: f => f.bonos_pagados, total: true },
      ],
    })
  }

  const vis = (filas || []).filter(f => esAsesor || f.meta_ventas || f.ventas || f.cobrado || f.comision_pendiente || f.viaticos || f.bonos_pagados)
  const movsDe = id => movs.filter(m => m.advisor_id === id)

  return (
    <div>
      <div className="page-head u-d-f u-jc-sb u-ai-c u-fwr u-g-10">
        <h1>{esAsesor ? 'Mi meta del mes' : 'Metas de los asesores'}</h1>
        <div className="u-d-f u-g-8 u-ai-c u-fwr">
          <input type="month" value={mes} onChange={e => e.target.value && setMes(e.target.value)} />
          {!esAsesor && filas?.length > 0 && <button className="btn" onClick={excel}>📥 Excel</button>}
        </div>
      </div>
      <p className="muted u-fs-12">
        {esAsesor ? 'Tu meta, lo que llevas vendido y cobrado, tu comisión, tus viáticos y tu bono de ' : 'Meta, avance, comisión, viáticos y bono de cada asesor en '}{nombreMes(mes)}.
        {' '}El bono se gana al cumplir la meta (cuentan las ventas con la inicial cobrada) y, si se fijó, con un % de lo cobrado.
      </p>
      {err && <div className="glass u-p-12"><p className="u-m0" style={{ color: '#ff8e7a' }}>{/permiso/i.test(err) ? (esAsesor ? 'Tu usuario todavía no está enlazado a tu ficha de asesor: pídeselo a gerencia.' : err) : err}</p></div>}
      {filas === null ? <p className="muted">Cargando…</p> : esAsesor ? (
        vis.map(f => (
          <div key={f.advisor_id} className="glass u-p-12 u-mb-10">
            <h3 className="u-m0">{f.full_name}</h3>
            <div className="u-mt-8"><Barra hecho={f.ventas_con_inicial} meta={f.meta_ventas} /></div>
            <div className="u-d-f u-fwr u-g-10 u-mt-8">
              {[['Ventas del mes', f.ventas + ' (' + soles(f.ventas_monto) + ')'], ['Cobrado de tus ventas', soles(f.cobrado)], ['Comisión por cobrar', soles(f.comision_pendiente)],
                ['Comisión pagada este mes', soles(f.comision_pagada_mes)], ['Viáticos recibidos', soles(f.viaticos)],
                ['Bono ganado', soles(f.bono_ganado)], ['Bono pagado', soles(f.bonos_pagados)]].map(([t, v]) => (
                <div key={t} className="glass u-p-8" style={{ minWidth: 140 }}><div className="muted small">{t}</div><b>{v}</b></div>
              ))}
            </div>
            {f.bono_monto > 0 && <p className="muted small u-mb-4">Bono de {soles(f.bono_monto)} al llegar a {f.meta_ventas} venta(s){f.bono_pct_cobrado > 0 ? ' + ' + f.bono_pct_cobrado + '% de lo cobrado' : ''}.</p>}
            {movsDe(f.advisor_id).length > 0 && (
              <ul className="small u-mb-4">{movsDe(f.advisor_id).map(m => <li key={m.id}>{new Date(m.fecha + 'T12:00:00').toLocaleDateString('es-PE')} · {TIPOS[m.tipo]} · {soles(m.monto)}{m.concepto ? ' · ' + m.concepto : ''}</li>)}</ul>
            )}
          </div>
        ))
      ) : !vis.length ? <div className="glass u-p-12"><p className="muted u-m0">Ningún asesor tiene meta ni movimiento este mes. {puedeEditar ? 'Pon la meta desde la lista de abajo.' : ''}</p></div> : (
        <div className="glass table-wrap">
          <table>
            <thead><tr><th>Asesor</th><th>Meta</th><th>Ventas</th><th>Cobrado</th><th>Comisión</th><th>Viáticos</th><th>Bono</th><th></th></tr></thead>
            <tbody>
              {vis.map(f => (
                <tr key={f.advisor_id}>
                  <td><b>{f.full_name}</b> <span className="muted small">{f.code}</span>{!f.tiene_cuenta && <div className="muted small">sin cuenta propia</div>}</td>
                  <td><Barra hecho={f.ventas_con_inicial} meta={f.meta_ventas} /></td>
                  <td className="u-nw">{f.ventas}<div className="muted small">{soles(f.ventas_monto)}</div></td>
                  <td className="u-nw">{soles(f.cobrado)}</td>
                  <td className="u-nw">{soles(f.comision_pendiente)} <span className="muted small">pend.</span><div className="muted small">{soles(f.comision_pagada_mes)} pagada</div></td>
                  <td className="u-nw">{soles(f.viaticos)}{movsDe(f.advisor_id).filter(m => m.tipo === 'viatico').length > 0 && <div className="muted small">{movsDe(f.advisor_id).filter(m => m.tipo === 'viatico').length} pago(s)</div>}</td>
                  <td className="u-nw">{soles(f.bono_ganado)} <span className="muted small">ganado</span><div className="muted small">{soles(f.bonos_pagados)} pagado</div></td>
                  <td className="u-nw">{puedeEditar && <>
                    <button className="link-btn" onClick={() => editarMeta(f)}>🎯 meta</button>{' '}
                    <button className="link-btn" onClick={() => pagar(f, 'viatico')}>＋ viático</button>{' '}
                    <button className="link-btn" onClick={() => pagar(f, 'bono')}>＋ bono</button>
                  </>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!esAsesor && puedeEditar && (filas || []).length > vis.length && (
        <details className="u-mt-10">
          <summary className="muted">Asesores sin meta este mes ({(filas || []).length - vis.length})</summary>
          <div className="u-d-f u-fwr u-g-6 u-mt-8">
            {(filas || []).filter(f => !vis.includes(f)).map(f => <button key={f.advisor_id} className="chip" onClick={() => editarMeta(f)}>🎯 {f.full_name}</button>)}
          </div>
        </details>
      )}
      {!esAsesor && movs.length > 0 && (
        <details className="u-mt-10">
          <summary className="muted">Viáticos, bonos y adelantos del mes ({movs.length})</summary>
          <div className="glass table-wrap u-mt-8">
            <table>
              <thead><tr><th>Fecha</th><th>Asesor</th><th>Tipo</th><th>Monto</th><th>Concepto</th><th></th></tr></thead>
              <tbody>{movs.map(m => (
                <tr key={m.id}>
                  <td className="u-nw">{new Date(m.fecha + 'T12:00:00').toLocaleDateString('es-PE')}</td>
                  <td>{(filas || []).find(f => f.advisor_id === m.advisor_id)?.full_name || '—'}</td>
                  <td>{TIPOS[m.tipo]}</td><td className="u-nw">{soles(m.monto)}</td><td>{m.concepto || ''}</td>
                  <td>{puedeEditar && <button className="link-btn muted" onClick={() => quitarMov(m)}>✕</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}
