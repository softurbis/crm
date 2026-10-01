import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProject } from '../context/ProjectContext'
import Paginador, { usePaginacion } from '../components/Paginador'
import LoteLink from '../components/LoteLink'
import { soles } from '../lib/pagos'
import { fechaPe } from '../lib/lotes'
import { useComprobantes, ESTADOS, nombreComprobante, esPrueba, emisorDelServidor, emisorVisto } from '../lib/comprobantes'
import { ComprobanteDetalle, MarcaEmisor } from '../components/Comprobante'

// COMPROBANTES: las boletas y facturas electrónicas del proyecto (sql/113), con lo
// que le pasó a cada una. Se emiten desde el pago (ficha del lote o Pagos); aquí
// se ve la bandeja completa: lo que está por informarse, lo rechazado, lo anulado.
const FILTROS = [
  ['todos', 'Todos', () => true],
  ['camino', 'En cola', c => ['pendiente', 'emitiendo', 'error', 'por_anular'].includes(c.estado)],
  ['porinformar', 'Por informar a SUNAT', c => ['firmado', 'en_sunat'].includes(c.estado)],
  ['aceptado', 'Aceptados', c => c.estado === 'aceptado'],
  ['rechazado', 'Rechazados', c => c.estado === 'rechazado'],
  ['anulado', 'Anulados', c => c.estado === 'anulado'],
]

export default function Comprobantes() {
  const { pidOp, projects } = useProject()
  const proyecto = projects.find(p => p.id === pidOp)
  const hayBase = !!proyecto && 'fact_activo' in proyecto
  const { lista, cargando, recargar } = useComprobantes({ projectId: pidOp }, hayBase)
  const [filtro, setFiltro] = useState('todos')
  const [q, setQ] = useState('')
  const [ver, setVer] = useState(null)
  const [emisor, setEmisor] = useState(undefined)
  const [envios, setEnvios] = useState([])
  const [lotes, setLotes] = useState({})

  useEffect(() => { setEmisor(undefined); emisorDelServidor(proyecto?.fact_ruc).then(setEmisor) }, [proyecto?.fact_ruc])
  // los resúmenes diarios y las bajas de este RUC (lo que viaja a SUNAT con ticket)
  useEffect(() => {
    if (!proyecto?.fact_ruc) { setEnvios([]); return }
    supabase.from('fact_envios').select('id, tipo, identificador, fecha_referencia, cantidad, estado, mensaje, creado_at')
      .eq('ruc', proyecto.fact_ruc).order('creado_at', { ascending: false }).limit(15)
      .then(({ data }) => setEnvios(data || []))
  }, [proyecto?.fact_ruc, lista.length])
  // manzana y lote de cada comprobante, para llegar a su ficha
  useEffect(() => {
    const ids = [...new Set(lista.map(c => c.lot_id).filter(Boolean))].filter(id => !lotes[id])
    if (!ids.length) return
    supabase.from('lots').select('id, mz, lt').in('id', ids).then(({ data }) =>
      setLotes(x => ({ ...x, ...Object.fromEntries((data || []).map(l => [l.id, l])) })))
  }, [lista])   // eslint-disable-line

  const cuenta = useMemo(() => Object.fromEntries(FILTROS.map(([k, , f]) => [k, lista.filter(f).length])), [lista])
  const visibles = useMemo(() => {
    const f = FILTROS.find(x => x[0] === filtro)[2]
    const t = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return lista.filter(c => f(c) && t.every(w =>
      [nombreComprobante(c), c.cliente_nombre, c.cliente_numero, fechaPe(c.fecha_emision), lotes[c.lot_id] ? lotes[c.lot_id].mz + '-' + lotes[c.lot_id].lt : '']
        .join(' ').toLowerCase().includes(w)))
  }, [lista, filtro, q, lotes])
  const pag = usePaginacion(visibles, 50)
  const validos = lista.filter(c => ['firmado', 'en_sunat', 'aceptado', 'por_anular'].includes(c.estado) && !esPrueba(c))
  const totalValido = validos.reduce((s, c) => s + Number(c.total || 0), 0)

  if (!proyecto) return <p className="muted">Elige un proyecto.</p>
  if (!hayBase || !proyecto.fact_activo) return (
    <>
      <div className="page-head"><h1>Comprobantes</h1></div>
      <div className="glass form-card" style={{ maxWidth: 'none' }}>
        <p><b>{proyecto.name}</b> no tiene prendido el facturador.</p>
        <p className="muted" style={{ textTransform: 'none' }}>
          Mientras esté apagado, la boleta de cada cobro se sigue subiendo a mano como hasta ahora.
          Se prende en <Link to="/proyectos">Proyectos</Link>, en la ficha del proyecto, con el RUC de quien factura.
        </p>
        {lista.length > 0 && <p className="muted small">Hay {lista.length} comprobante(s) emitidos antes de apagarlo.</p>}
      </div>
    </>
  )

  const visto = emisorVisto(emisor)
  return (
    <>
      <div className="page-head">
        <h1>Comprobantes</h1>
        <button className="btn-ghost" onClick={recargar} disabled={cargando}>↻ Actualizar</button>
      </div>

      <div className="glass cp-cabecera">
        <MarcaEmisor proyecto={proyecto} />
        <div className="cp-estado-emisor">
          {emisor === undefined ? <span className="muted">…</span>
            : !emisor ? <span className="cp-chip cp-aviso">Este RUC todavía no está cargado en el servidor</span>
            : emisor.error ? <span className="cp-chip cp-mal" title={emisor.error}>El servidor no pudo cargar este RUC</span>
            : !visto ? <span className="cp-chip cp-aviso">El facturador del servidor no contesta</span>
            : emisor.ambiente === 'produccion' ? <span className="cp-chip cp-ok">Emitiendo en real</span>
            : <span className="cp-chip cp-aviso">Ambiente de PRUEBAS: nada tiene valor</span>}
          {visto && emisor?.certificado_dias != null && (
            <span className={'muted small' + (emisor.certificado_dias <= 30 ? ' bad' : '')}>
              Certificado digital: vence en {emisor.certificado_dias} días ({fechaPe(emisor.certificado_vence)})
            </span>
          )}
          <span className="muted small">Series {proyecto.fact_serie_boleta} · {proyecto.fact_serie_factura}</span>
        </div>
        <div className="cp-kpi"><span>Emitido con valor</span><b>{soles(totalValido)}</b><small>{validos.length} comprobante(s)</small></div>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Buscar por número, cliente, documento o lote…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="chips">
        {FILTROS.map(([k, t]) => (
          <button key={k} className={'chip' + (filtro === k ? ' on' : '')} onClick={() => setFiltro(k)}>
            {t}{cuenta[k] ? ' · ' + cuenta[k] : ''}
          </button>
        ))}
      </div>

      {!lista.length && !cargando && (
        <div className="glass form-card" style={{ maxWidth: 'none' }}>
          <p>Todavía no se emitió ningún comprobante en {proyecto.name}.</p>
          <p className="muted" style={{ textTransform: 'none' }}>Se emiten desde el pago: en la ficha del lote o en Pagos, columna “Comprobante”, botón <b>🧾 Emitir</b>.</p>
        </div>
      )}
      {!!lista.length && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Comprobante</th><th>Cliente</th><th>Lote</th><th style={{ textAlign: 'right' }}>Total</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {pag.pagina.map(c => (
                <tr key={c.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fechaPe(c.fecha_emision)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}><button className="link-btn" onClick={() => setVer(c)}>
                    {c.tipo === 'factura' ? 'Factura' : 'Boleta'} <b>{c.numero != null ? nombreComprobante(c) : '(sin número aún)'}</b></button></td>
                  <td>{c.cliente_nombre}<div className="muted small" style={{ textTransform: 'none' }}>{c.cliente_numero || 'sin documento'}</div></td>
                  <td>{lotes[c.lot_id] ? <LoteLink lot={lotes[c.lot_id]} /> : '-'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><b>{soles(c.total)}</b></td>
                  <td><button type="button" className={'cp-chip ' + (ESTADOS[c.estado] || ESTADOS.pendiente).c} title={(ESTADOS[c.estado] || ESTADOS.pendiente).ayuda}
                    onClick={() => setVer(c)}>{(ESTADOS[c.estado] || ESTADOS.pendiente).t}{esPrueba(c) ? ' · prueba' : ''}</button>
                    {['rechazado', 'error'].includes(c.estado) && c.mensaje && <div className="muted small" style={{ textTransform: 'none', maxWidth: 320 }}>{c.mensaje}</div>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{c.pdf_url && <a href={c.pdf_url} target="_blank" rel="noreferrer">PDF</a>}</td>
                </tr>
              ))}
              {!visibles.length && <tr><td colSpan={7} className="muted">Ningún comprobante coincide con el filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <Paginador {...pag} />

      {!!envios.length && (
        <details className="glass cp-envios">
          <summary>Lo informado a SUNAT por lotes: resúmenes diarios de boletas y bajas ({envios.length})</summary>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Enviado</th><th>Documento</th><th>Del día</th><th>Comprobantes</th><th>Estado</th></tr></thead>
              <tbody>
                {envios.map(e => (
                  <tr key={e.id}>
                    <td>{fechaPe(String(e.creado_at).slice(0, 10))}</td>
                    <td style={{ textTransform: 'none' }}>{e.identificador || (e.tipo === 'baja' ? 'baja' : 'resumen')}</td>
                    <td>{fechaPe(e.fecha_referencia)}</td>
                    <td>{e.cantidad}</td>
                    <td><span className={'cp-chip ' + (e.estado === 'aceptado' ? 'cp-ok' : e.estado === 'rechazado' ? 'cp-mal' : 'cp-aviso')} title={e.mensaje || ''}>
                      {e.estado === 'esperando' ? 'SUNAT lo está procesando' : e.estado === 'error' ? 'no llegó, se reintenta' : e.estado}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {ver && <ComprobanteDetalle comprobante={ver} proyecto={proyecto} onCerrar={() => { setVer(null); recargar() }} onCambio={recargar} />}
    </>
  )
}
