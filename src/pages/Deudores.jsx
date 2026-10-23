import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMsg } from '../lib/saveFx'
import { useAuth } from '../context/AuthContext'
import { fechaPe } from '../lib/lotes'
import EstadoCuentaLote from '../components/EstadoCuentaLote'
import { descargarExcelDeudores } from '../lib/excelDeudores'

// LOTES CON DEUDA (sql/156, 22 oct 2026): para el rol FACTURACIÓN (y el superusuario).
// Una fila por venta vigente con cuotas vencidas, con los datos del cliente; tocar el
// lote abre su estado de cuenta, y el botón de Excel baja el informe completo por
// proyecto (resumen + lotes + cada cuota vencida). Todo por función, sin leer tablas.
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function Deudores() {
  const { profile } = useAuth()
  const [msg, setMsg] = useMsg(null)
  const [filas, setFilas] = useState(null)
  const [proy, setProy] = useState('todos')
  const [minimo, setMinimo] = useState(1)
  const [q, setQ] = useState('')
  const [loteVer, setLoteVer] = useState(null)
  const [bajando, setBajando] = useState(false)

  async function cargar() {
    setFilas(null)
    const { data, error } = await supabase.rpc('facturacion_deudores')
    if (error) { setMsg({ ok: false, t: /facturacion_deudores/.test(error.message) ? 'Falta correr sql/156 en el servidor.' : error.message }); setFilas([]); return }
    setFilas(data || [])
  }
  useEffect(() => { cargar() }, [])

  const proyectos = useMemo(() => [...new Set((filas || []).map(f => f.proyecto))].sort(), [filas])
  const vista = useMemo(() => {
    const t = sinTildes(q.trim())
    return (filas || []).filter(f => (proy === 'todos' || f.proyecto === proy)
      && Number(f.n_vencidas) >= minimo
      && (!t || sinTildes([f.lote, f.mz + f.lt, 'mz ' + f.mz + ' lt ' + f.lt, f.cliente, f.doc_number, f.co_cliente, f.telefono].join(' ')).includes(t)))
  }, [filas, proy, minimo, q])

  const tot = useMemo(() => ({
    lotes: vista.length,
    cuotas: vista.reduce((s, f) => s + Number(f.n_vencidas), 0),
    deuda: vista.reduce((s, f) => s + Number(f.deuda_vencida), 0),
    saldo: vista.reduce((s, f) => s + Number(f.saldo || 0), 0),
  }), [vista])
  const porProy = useMemo(() => {
    const m = {}
    for (const f of filas || []) { const x = m[f.proyecto] ||= { n: 0, deuda: 0 }; x.n++; x.deuda += Number(f.deuda_vencida) }
    return Object.entries(m).sort((a, b) => b[1].deuda - a[1].deuda)
  }, [filas])

  async function excel() {
    if (!vista.length) return
    setBajando(true)
    try {
      await descargarExcelDeudores(vista, { usuario: profile?.full_name || '', titulo: 'Cuotas vencidas' + (proy !== 'todos' ? ' · ' + proy : '') })
      setMsg({ ok: true, t: 'INFORME DESCARGADO: ' + vista.length + ' lotes · ' + tot.cuotas + ' cuotas vencidas' })
    } catch (e) { setMsg({ ok: false, t: 'No se pudo armar el Excel: ' + (e.message || e) }) }
    setBajando(false)
  }

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Lotes con deuda</h1>
        <button className="btn-primary" disabled={bajando || !vista.length} onClick={excel} title="Baja un Excel con el resumen por proyecto, los lotes con deuda y cada cuota vencida con los datos del cliente">
          {bajando ? 'Armando…' : '📥 Informe Excel'}
        </button>
      </div>
      <p className="muted small" style={{ margin: '-.4rem 0 .8rem' }}>
        Las ventas vigentes de tus proyectos con cuotas vencidas (fecha pasada y saldo de más de S/ 2), con los datos del cliente. Toca el lote para ver su estado de cuenta.
      </p>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      <div className="chips">
        {[1, 2, 3].map(n => <button key={n} className={`chip ${minimo === n ? 'on' : ''}`} onClick={() => setMinimo(n)}>{n}{n === 3 ? '+' : ''} {n === 1 ? 'o más cuotas' : 'o más cuotas'}</button>)}
        {proyectos.length > 1 && (
          <select value={proy} onChange={e => setProy(e.target.value)}>
            <option value="todos">Todos los proyectos</option>
            {proyectos.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Lote (A1, G-7), nombre, DNI o celular…" style={{ flex: '1 1 220px', maxWidth: 360 }} />
      </div>

      {filas === null && <p className="muted">Cargando…</p>}
      {filas && !filas.length && <p className="ok">✅ Nadie tiene cuotas vencidas en tus proyectos.</p>}
      {!!filas?.length && (
        <p className="hint">
          <b>{tot.lotes}</b> lote{tot.lotes === 1 ? '' : 's'} · <b>{tot.cuotas}</b> cuota{tot.cuotas === 1 ? '' : 's'} vencida{tot.cuotas === 1 ? '' : 's'} · deuda vencida <b className="bad">{soles(tot.deuda)}</b> · saldo por cobrar {soles(tot.saldo)}
          {proy === 'todos' && porProy.length > 1 && <span className="muted"> · {porProy.map(([p, x]) => p + ' ' + x.n).join(' · ')}</span>}
        </p>
      )}
      {filas && !!filas.length && !vista.length && <p className="muted">Nada con ese filtro.</p>}

      {!!vista.length && (
        <div className="glass table-wrap">
          <table>
            <thead><tr>
              <th>Proyecto · lote</th><th>Cliente</th><th>Celular</th><th>Dirección</th>
              <th style={{ textAlign: 'right' }}>Vencidas</th><th>Desde</th><th style={{ textAlign: 'right' }}>Deuda vencida</th>
              <th style={{ textAlign: 'right' }}>Cuota</th><th style={{ textAlign: 'right' }}>Pagadas</th><th style={{ textAlign: 'right' }}>Saldo total</th>
            </tr></thead>
            <tbody>
              {vista.map(f => (
                <tr key={f.sale_id}>
                  <td className="small" style={{ whiteSpace: 'normal', minWidth: 130 }}>{f.proyecto}
                    <div><button className="link-btn" title="Ver el estado de cuenta de este lote" onClick={() => setLoteVer(f.lot_id)}><b>MZ {f.mz} LT {f.lt}</b></button></div></td>
                  <td className="small" style={{ textTransform: 'none', whiteSpace: 'normal', minWidth: 170 }}><b>{f.cliente}</b>
                    <div className="muted">{f.doc_type || 'DNI'} {f.doc_number}</div>
                    {f.co_cliente && <div className="muted">+ {f.co_cliente}</div>}</td>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{f.telefono || <span className="muted">—</span>}{f.telefono2 && <div className="muted">{f.telefono2}</div>}</td>
                  <td className="small" style={{ textTransform: 'none', whiteSpace: 'normal', minWidth: 160, maxWidth: 260 }}>{f.direccion || <span className="muted">—</span>}</td>
                  <td style={{ textAlign: 'right' }}><b className="bad">{f.n_vencidas}</b><div className="muted small">de {f.n_cuotas}</div></td>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{fechaPe(f.vencida_desde)}<div className="muted">{f.dias_atraso} días</div></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><b className="bad">{soles(f.deuda_vencida)}</b></td>
                  <td className="small" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{soles(f.cuota_mensual)}</td>
                  <td className="small" style={{ textAlign: 'right' }}>{f.n_pagadas}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{soles(f.saldo)}<div className="muted small">de {soles(f.precio)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loteVer && <EstadoCuentaLote lotId={loteVer} onCerrar={() => setLoteVer(null)} />}
    </>
  )
}
