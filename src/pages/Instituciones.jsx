import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { savedFx } from '../lib/saveFx'
import { subirRuta } from '../lib/archivos'
import { avisar, confirmar, pedirDatos } from '../lib/dialogos'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import { rebajaConvenio } from '../lib/convenios'

// INSTITUCIONES Y CONVENIOS (28 nov 2026, pedido de gerencia C8, sql/254). Cada institución con
// su persona a cargo, los datos verificados (fuente y fecha), la carta, la visita y el estado,
// para saber dónde se trabó cada una. Las ventas que llegan por un convenio guardan su
// institución (desde la ficha del lote): la rebaja en la inicial (S/ 100) y lo que se le paga a la
// institución con recibo (S/ 100, DATO INTERNO: no va al contrato). Aquí se ve cuánto se le debe
// a cada una y la lista de precios especial de su bloque, con la rebaja aparte.
export const ESTADOS_INST = [
  ['por_contactar', '⏳ Por contactar', '#9daab6'], ['carta_enviada', '✉ Carta enviada', '#7ba7f7'], ['visitada', '🚗 Visitada', '#7ba7f7'],
  ['negociando', '🤝 Negociando', '#e0b34c'], ['convenio_firmado', '✍ Convenio firmado', '#6fdd9b'], ['activa', '✅ Activa', '#6fdd9b'],
  ['trabada', '⛔ Trabada', '#ff8e7a'], ['descartada', '✖ Descartada', '#9daab6'],
]
const EST = Object.fromEntries(ESTADOS_INST.map(([v, t, c]) => [v, { t, c }]))
const REBAJA = { ninguna: 'Sin precio especial', por_lote: 'S/ menos por lote', por_m2: 'S/ menos por m²', porcentaje: '% menos del precio' }
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const fecha = d => d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-PE') : ''
const cel = s => { const d = String(s || '').replace(/\D/g, ''); return d.length === 11 && d.startsWith('51') ? d.slice(2) : d }
const nat = (a, b) => a.mz.localeCompare(b.mz) || (parseInt(a.lt) - parseInt(b.lt)) || String(a.lt).localeCompare(String(b.lt))

export default function Instituciones() {
  const { role } = useAuth()
  const { projects } = useProject()
  const irA = useNavigate()
  const [filas, setFilas] = useState(null)
  const [ventas, setVentas] = useState([])
  const [fEst, setFEst] = useState('abiertas')
  const [abierta, setAbierta] = useState(null)
  const [lotes, setLotes] = useState([])
  const puedeEditar = ['superuser', 'admin', 'operador', 'secretary'].includes(role)
  const nomProy = id => projects.find(p => p.id === id)?.name || ''

  const cargar = async () => {
    const [{ data, error }, { data: vs }] = await Promise.all([
      supabase.from('instituciones').select('*').order('nombre'),
      supabase.from('sales').select('id, convenio_id, convenio_descuento, convenio_pago, convenio_pagado_at, convenio_recibo_url, precio_lista, total_sale_price, sale_date, status, lot:lots(id, mz, lt, project_id), client:clients!sales_client_id_fkey(full_name)').not('convenio_id', 'is', null),
    ])
    if (error) { avisar('No se pudo cargar: ' + error.message, { tono: 'error' }); setFilas([]); return }
    setFilas(data || []); setVentas(vs || [])
  }
  useEffect(() => { cargar() }, [])

  const inst = (filas || []).find(f => f.id === abierta)
  useEffect(() => {
    setLotes([])
    if (!inst?.project_id) return
    let q = supabase.from('lots').select('id, mz, lt, area_m2, total_price, initial_payment_default, status').eq('project_id', inst.project_id)
    if (inst.manzanas?.length) q = q.in('mz', inst.manzanas)
    q.limit(1000).then(({ data }) => setLotes((data || []).sort(nat)))
  }, [abierta, inst?.project_id, (inst?.manzanas || []).join(',')])

  const campos = (f = {}) => [
    { clave: 'nombre', etiqueta: 'Institución', obligatorio: true, valor: f.nombre || '' },
    { clave: 'tipo', etiqueta: 'Tipo', valor: f.tipo || '', placeholder: 'Asociación, cooperativa, sindicato, colegio profesional, empresa…' },
    { clave: 'proyecto', etiqueta: 'Proyecto', tipo: 'opcion', valor: f.project_id || '', opciones: [{ valor: '', etiqueta: '— Varios / sin proyecto —' }, ...projects.map(p => ({ valor: p.id, etiqueta: p.name }))] },
    { clave: 'contacto', etiqueta: 'Persona a cargo', valor: f.contacto_nombre || '' },
    { clave: 'cargo', etiqueta: 'Cargo', valor: f.contacto_cargo || '' },
    { clave: 'tel', etiqueta: 'Celular', valor: cel(f.contacto_telefono), placeholder: '9XXXXXXXX' },
    { clave: 'fuente', etiqueta: 'Fuente de los datos', valor: f.datos_fuente || '', placeholder: 'Página web, llamada a la oficina, padrón, el presidente en persona…' },
    { clave: 'verif', etiqueta: 'Datos verificados el', tipo: 'fecha', valor: f.datos_verificados || '' },
    { clave: 'carta', etiqueta: 'Carta enviada el', tipo: 'fecha', valor: f.carta_enviada || '' },
    { clave: 'visita', etiqueta: 'Visita el', tipo: 'fecha', valor: f.visita || '' },
    { clave: 'estado', etiqueta: 'Estado', tipo: 'opcion', valor: f.estado || 'por_contactar', opciones: ESTADOS_INST.map(([v, t]) => ({ valor: v, etiqueta: t })) },
    { clave: 'trabada', etiqueta: '¿Dónde se trabó? / siguiente paso', valor: f.trabada_en || '' },
    { clave: 'dto', etiqueta: 'Rebaja en la inicial por venta (S/)', tipo: 'monto', valor: f.descuento_inicial ?? 100 },
    { clave: 'pago', etiqueta: 'Pago a la institución por venta (S/, con recibo, interno)', tipo: 'monto', valor: f.pago_institucion ?? 100 },
    { clave: 'rtipo', etiqueta: 'Precio especial', tipo: 'opcion', valor: f.rebaja_tipo || 'ninguna', opciones: Object.entries(REBAJA).map(([v, t]) => ({ valor: v, etiqueta: t })) },
    { clave: 'rvalor', etiqueta: 'Valor de la rebaja (S/ o %)', tipo: 'monto', valor: f.rebaja_valor || '' },
    { clave: 'mzs', etiqueta: 'Bloque de manzanas (opcional, separadas por coma)', valor: (f.manzanas || []).join(', '), placeholder: 'H, L, P, T' },
    { clave: 'notas', etiqueta: 'Notas', tipo: 'largo', valor: f.notas || '' },
  ]
  const fila = d => {
    let t = String(d.tel || '').replace(/\D/g, ''); if (t.length === 9) t = '51' + t
    const up = s => String(s || '').trim().toUpperCase() || null
    return {
      nombre: up(d.nombre), tipo: up(d.tipo), project_id: d.proyecto || null, contacto_nombre: up(d.contacto), contacto_cargo: up(d.cargo),
      contacto_telefono: t || null, datos_fuente: String(d.fuente || '').trim() || null, datos_verificados: d.verif || null,
      carta_enviada: d.carta || null, visita: d.visita || null, estado: d.estado || 'por_contactar', trabada_en: String(d.trabada || '').trim() || null,
      descuento_inicial: Number(d.dto) || 0, pago_institucion: Number(d.pago) || 0, rebaja_tipo: d.rtipo || 'ninguna', rebaja_valor: Number(d.rvalor) || 0,
      manzanas: String(d.mzs || '').split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean), notas: String(d.notas || '').trim() || null,
      updated_at: new Date().toISOString(),
    }
  }
  async function agregar() {
    const d = await pedirDatos({ titulo: '🏛 INSTITUCIÓN NUEVA', aceptar: 'Agregar', campos: campos() })
    if (!d) return
    const { error } = await supabase.from('instituciones').insert(fila(d))
    if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return }
    savedFx(); cargar()
  }
  async function editar(f) {
    const d = await pedirDatos({ titulo: '✎ ' + f.nombre, aceptar: 'Guardar', campos: campos(f) })
    if (!d) return
    const { error } = await supabase.from('instituciones').update(fila(d)).eq('id', f.id)
    if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return }
    savedFx(); cargar()
  }
  async function estado(f, e) {
    const { error } = await supabase.from('instituciones').update({ estado: e, updated_at: new Date().toISOString() }).eq('id', f.id)
    if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return }
    savedFx(); cargar()
  }
  async function quitar(f) {
    if (ventas.some(v => v.convenio_id === f.id)) { await avisar('Tiene ventas ligadas: márcala como descartada en vez de borrarla.'); return }
    if (!await confirmar('¿Borrar ' + f.nombre + '?', { peligro: true, aceptar: 'Sí, borrar' })) return
    await supabase.from('instituciones').delete().eq('id', f.id); setAbierta(null); cargar()
  }
  async function marcarPagado(v, file) {
    const d = await pedirDatos({ titulo: '💵 Pago a la institución — ' + v.lot?.mz + '-' + v.lot?.lt, aceptar: 'Marcar pagado',
      campos: [{ clave: 'fecha', etiqueta: 'Pagado el', tipo: 'fecha', obligatorio: true, valor: new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10) }] })
    if (!d) return
    let url = v.convenio_recibo_url || null
    if (file) {
      try { url = await subirRuta('convenios/' + v.id + '-' + Date.now() + '.' + ((file.name.split('.').pop() || 'pdf').toLowerCase()), file) }
      catch (e) { await avisar('No se pudo subir el recibo: ' + e.message, { tono: 'error' }); return }
    }
    const { error } = await supabase.from('sales').update({ convenio_pagado_at: d.fecha, convenio_recibo_url: url }).eq('id', v.id)
    if (error) { await avisar('ERROR: ' + error.message, { tono: 'error' }); return }
    savedFx(); cargar()
  }

  const deudaDe = id => ventas.filter(v => v.convenio_id === id && !v.convenio_pagado_at && v.status !== 'anulado').reduce((s, v) => s + Number(v.convenio_pago || 0), 0)
  const cuenta = e => (filas || []).filter(f => f.estado === e).length
  const vis = useMemo(() => (filas || []).filter(f => fEst === 'todas' || (fEst === 'abiertas' ? !['descartada'].includes(f.estado) : f.estado === fEst)), [filas, fEst])
  const totalDeuda = (filas || []).reduce((s, f) => s + deudaDe(f.id), 0)

  async function excel() {
    const { descargarLista } = await import('../lib/excelLista')
    await descargarLista({
      hoja: 'Instituciones', tituloLibro: 'Instituciones y convenios', filas: vis,
      columnas: [
        { t: 'Institución', w: 32, v: f => f.nombre }, { t: 'Tipo', w: 18, v: f => f.tipo }, { t: 'Proyecto', w: 24, v: f => nomProy(f.project_id) },
        { t: 'Persona a cargo', w: 26, v: f => f.contacto_nombre }, { t: 'Cargo', w: 16, v: f => f.contacto_cargo }, { t: 'Celular', w: 12, v: f => cel(f.contacto_telefono) },
        { t: 'Fuente', w: 24, v: f => f.datos_fuente }, { t: 'Verificado', w: 11, f: 'fecha', v: f => f.datos_verificados },
        { t: 'Carta', w: 11, f: 'fecha', v: f => f.carta_enviada }, { t: 'Visita', w: 11, f: 'fecha', v: f => f.visita },
        { t: 'Estado', w: 16, v: f => (EST[f.estado]?.t || f.estado).replace(/^\S+\s/, '') }, { t: 'Dónde se trabó', w: 30, v: f => f.trabada_en },
        { t: 'Ventas', w: 8, f: 'num', v: f => ventas.filter(v => v.convenio_id === f.id).length, total: true },
        { t: 'Se le debe', w: 12, f: 'soles', v: f => deudaDe(f.id), total: true },
      ],
    })
  }

  const vInst = inst ? ventas.filter(v => v.convenio_id === inst.id) : []
  return (
    <div>
      <div className="page-head u-d-f u-jc-sb u-ai-c u-fwr u-g-10">
        <h1>Instituciones y convenios</h1>
        <div className="u-d-f u-g-8 u-ai-c u-fwr">
          {vis.length > 0 && <button className="btn" onClick={excel}>📥 Excel</button>}
          {puedeEditar && <button className="btn-primary" onClick={agregar}>＋ Institución</button>}
        </div>
      </div>
      <p className="muted u-fs-12">Con quién se trabaja un convenio, en qué quedó cada una y cuánto se le debe. La venta guarda su convenio desde la ficha del lote (🤝 Convenio).{totalDeuda > 0 && <b> Se debe a las instituciones: {soles(totalDeuda)}.</b>}</p>
      <div className="u-d-f u-g-6 u-fwr u-mb-10">
        {[['abiertas', 'Vigentes'], ...ESTADOS_INST.map(([v, t]) => [v, t + ' · ' + cuenta(v)]), ['todas', 'Todas']].map(([v, t]) => (
          <button key={v} className={'chip' + (fEst === v ? ' on' : '')} onClick={() => setFEst(v)}>{t}</button>
        ))}
      </div>
      {filas === null ? <p className="muted">Cargando…</p> : !vis.length ? <div className="glass u-p-12"><p className="muted u-m0">No hay instituciones en esta lista.</p></div> : (
        <div className="glass table-wrap">
          <table>
            <thead><tr><th>Institución</th><th>Persona a cargo</th><th>Datos</th><th>Carta / visita</th><th>Estado</th><th>Convenio</th><th>Ventas</th><th></th></tr></thead>
            <tbody>
              {vis.map(f => {
                const n = ventas.filter(v => v.convenio_id === f.id).length, debe = deudaDe(f.id)
                return (
                  <tr key={f.id} style={abierta === f.id ? { background: 'rgba(255,255,255,.05)' } : null}>
                    <td><button className="link-btn" onClick={() => setAbierta(a => a === f.id ? null : f.id)}><b>{f.nombre}</b></button>{f.tipo && <div className="muted small">{f.tipo}</div>}{f.project_id && <div className="muted small">{nomProy(f.project_id)}</div>}</td>
                    <td>{f.contacto_nombre || '—'}{f.contacto_cargo && <div className="muted small">{f.contacto_cargo}</div>}{f.contacto_telefono && <div className="small"><a href={'https://wa.me/' + f.contacto_telefono} target="_blank" rel="noreferrer">{cel(f.contacto_telefono)}</a></div>}</td>
                    <td className="small">{f.datos_verificados ? '✔ ' + fecha(f.datos_verificados) : <span style={{ color: '#e0b34c' }}>sin verificar</span>}{f.datos_fuente && <div className="muted u-tt-n">{f.datos_fuente}</div>}</td>
                    <td className="small u-nw">{f.carta_enviada ? '✉ ' + fecha(f.carta_enviada) : '✉ —'}<div>{f.visita ? '🚗 ' + fecha(f.visita) : '🚗 —'}</div></td>
                    <td>
                      {puedeEditar
                        ? <select value={f.estado} onChange={e => estado(f, e.target.value)} style={{ color: EST[f.estado]?.c }}>{ESTADOS_INST.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
                        : <span style={{ color: EST[f.estado]?.c }}>{EST[f.estado]?.t}</span>}
                      {f.trabada_en && <div className="muted small u-tt-n">{f.trabada_en}</div>}
                    </td>
                    <td className="small u-nw">−{soles(f.descuento_inicial)} inicial<div className="muted">{soles(f.pago_institucion)} a la inst.</div>{f.rebaja_tipo !== 'ninguna' && <div>{REBAJA[f.rebaja_tipo].replace('S/', 'S/ ' + f.rebaja_valor).replace('%', f.rebaja_valor + '%')}{f.manzanas?.length ? ' · Mz ' + f.manzanas.join(', ') : ''}</div>}</td>
                    <td className="u-nw">{n}{debe > 0 && <div className="small" style={{ color: '#e0b34c' }}>debe {soles(debe)}</div>}</td>
                    <td className="u-nw">{puedeEditar && <><button className="link-btn" onClick={() => editar(f)}>✎</button> <button className="link-btn muted" onClick={() => quitar(f)}>✕</button></>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {inst && (
        <div className="glass u-p-12 u-mt-10">
          <div className="u-d-f u-jc-sb u-ai-c u-fwr u-g-8">
            <h3 className="u-m0">🏛 {inst.nombre}</h3>
            <button className="link-btn muted" onClick={() => setAbierta(null)}>cerrar ✕</button>
          </div>
          {inst.notas && <p className="muted small u-tt-n">{inst.notas}</p>}
          <h4 className="u-mb-4">Ventas por este convenio ({vInst.length})</h4>
          {!vInst.length ? <p className="muted small u-m0">Ninguna todavía. Se liga desde la ficha del lote vendido → 🤝 Convenio.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Lote</th><th>Cliente</th><th>Venta</th><th>Precio lista / rebaja</th><th>Rebaja inicial</th><th>A la institución</th><th></th></tr></thead>
                <tbody>{vInst.map(v => (
                  <tr key={v.id}>
                    <td><button className="link-btn" onClick={() => irA('/lotes/' + v.lot?.id)}>{v.lot?.mz}-{v.lot?.lt}</button><div className="muted small">{nomProy(v.lot?.project_id)}</div></td>
                    <td>{v.client?.full_name || '—'}</td>
                    <td className="u-nw">{fecha(v.sale_date)}<div className="muted small">{soles(v.total_sale_price)}</div></td>
                    <td className="u-nw small">{v.precio_lista ? soles(v.precio_lista) + ' − ' + soles(Number(v.precio_lista) - Number(v.total_sale_price)) : '—'}</td>
                    <td className="u-nw">{soles(v.convenio_descuento)}</td>
                    <td className="u-nw">{soles(v.convenio_pago)}<div className="small">{v.convenio_pagado_at ? <span style={{ color: '#6fdd9b' }}>✔ pagado {fecha(v.convenio_pagado_at)}</span> : <span style={{ color: '#e0b34c' }}>por pagar</span>}{v.convenio_recibo_url && <> · <a href={v.convenio_recibo_url} target="_blank" rel="noreferrer">recibo</a></>}</div></td>
                    <td className="u-nw">{puedeEditar && !v.convenio_pagado_at && (
                      <label className="upload-btn">💵 pagado (recibo)
                        <input type="file" accept="image/*,.pdf" hidden onChange={e => { const f = e.target.files[0]; e.target.value = ''; marcarPagado(v, f) }} />
                      </label>)}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {inst.rebaja_tipo !== 'ninguna' && (
            <>
              <h4 className="u-mb-4">Lista de precios del convenio{inst.manzanas?.length ? ' — Mz ' + inst.manzanas.join(', ') : ''}</h4>
              {!inst.project_id ? <p className="muted small u-m0">Elige el proyecto de la institución (✎) para ver su lista.</p> : !lotes.length ? <p className="muted small u-m0">Sin lotes en ese bloque.</p> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Lote</th><th>Área</th><th>Estado</th><th>Precio de lista</th><th>Rebaja</th><th>Precio convenio</th><th>Inicial de lista</th><th>Inicial convenio</th></tr></thead>
                    <tbody>{lotes.map(l => {
                      const r = rebajaConvenio(inst, l), ini = Number(l.initial_payment_default || 0)
                      return (
                        <tr key={l.id}>
                          <td>{l.mz}-{l.lt}</td><td className="u-nw">{Number(l.area_m2).toFixed(2)} m²</td><td className="small">{l.status}</td>
                          <td className="u-nw">{soles(l.total_price)}</td><td className="u-nw" style={{ color: '#6fdd9b' }}>−{soles(r)}</td><td className="u-nw"><b>{soles(Number(l.total_price) - r)}</b></td>
                          <td className="u-nw">{ini ? soles(ini) : '—'}</td><td className="u-nw">{ini ? soles(Math.max(0, ini - Number(inst.descuento_inicial || 0))) : '—'}</td>
                        </tr>
                      )
                    })}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
