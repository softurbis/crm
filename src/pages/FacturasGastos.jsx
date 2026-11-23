import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import { soles } from '../lib/pagos'
import { fechaPe } from '../lib/lotes'
import { avisar } from '../lib/dialogos'
import {
  ESTADOS, COLS_FACTURA_GASTO, nombreComprobante, nombreTipo, esPrueba, enCamino, rucValido,
  emisoresGasto, guardarEmisorGasto, gastosDeComprobante, emisorVisto,
} from '../lib/comprobantes'
import { ComprobanteDetalle } from '../components/Comprobante'

// FACTURAS DE GASTOS (sql/233, 18 nov 2026): las que Victor y Alex le emiten al dueño
// de cada proyecto por los gastos que Urbis hace por él. Se piden desde Gastos (botón
// "emitir factura" en la columna RH/Factura); aquí se ven todas, de todos los
// proyectos, por mes y por emisor, con el Excel para su contador. El superusuario
// registra aquí quién puede emitirlas.

const mesActual = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 7)
const siguienteMes = m => { const [a, n] = m.split('-').map(Number); return n === 12 ? (a + 1) + '-01' : a + '-' + String(n + 1).padStart(2, '0') }
// con valor = lo que se declara. La anulada con nota de crédito cuenta (la nota, en
// negativo, la deshace); la anulada con baja no
const conValor = c => !esPrueba(c) && (['aceptado', 'firmado', 'en_sunat', 'por_anular'].includes(c.estado) || (c.estado === 'anulado' && !!c.nota_id))
const VACIO = { ruc: '', nombre: '', razon_social: '', direccion: '', serie: 'F001', activo: true }

export default function FacturasGastos() {
  const { esSuper } = useAuth()
  const { projects } = useProject()
  const nombreProyecto = useMemo(() => Object.fromEntries((projects || []).map(p => [p.id, p.name])), [projects])
  const [emisores, setEmisores] = useState(undefined)   // undefined = cargando · null = sql/233 sin correr
  const [servidor, setServidor] = useState({})           // ruc -> lo que reporta el facturador del servidor
  const [mes, setMes] = useState(mesActual())
  const [quien, setQuien] = useState('todos')
  const [lista, setLista] = useState([])
  const [cargando, setCargando] = useState(false)
  const [ver, setVer] = useState(null)
  const [form, setForm] = useState(null)                 // el emisor que se está agregando o cambiando
  const [busy, setBusy] = useState(false)
  const [bajando, setBajando] = useState(false)

  async function cargarEmisores() {
    const e = await emisoresGasto()
    setEmisores(e)
    if (e?.length) {
      const { data } = await supabase.from('fact_emisores').select('*').in('ruc', e.map(x => x.ruc))
      setServidor(Object.fromEntries((data || []).map(x => [x.ruc, x])))
    }
  }
  async function cargar() {
    setCargando(true)
    const { data, error } = await supabase.from('comprobantes').select(COLS_FACTURA_GASTO).eq('origen', 'gasto')
      .gte('fecha_emision', mes + '-01').lt('fecha_emision', siguienteMes(mes) + '-01')
      .order('fecha_emision', { ascending: false }).order('creado_at', { ascending: false }).limit(1000)
    setLista(error ? [] : (data || []))
    setCargando(false)
  }
  useEffect(() => { cargarEmisores() }, [])
  useEffect(() => { cargar() }, [mes])   // eslint-disable-line
  // mientras alguna esté saliendo, se vuelve a mirar
  const hayEnCamino = lista.some(enCamino)
  useEffect(() => {
    if (!hayEnCamino) return
    const t = setInterval(() => { if (!document.hidden) cargar() }, 4000)
    return () => clearInterval(t)
  }, [hayEnCamino, mes])   // eslint-disable-line

  const visibles = quien === 'todos' ? lista : lista.filter(c => c.ruc === quien)
  const nombreEmisor = ruc => emisores?.find(e => e.ruc === ruc)?.nombre || ruc
  const resumen = useMemo(() => (emisores || []).map(e => {
    const suyas = lista.filter(c => c.ruc === e.ruc && conValor(c))
    const total = suyas.reduce((s, c) => s + (c.tipo === 'nota_credito' ? -1 : 1) * Number(c.total || 0), 0)
    return { ...e, n: suyas.filter(c => c.tipo !== 'nota_credito').length, total }
  }), [emisores, lista])

  async function excel() {
    setBajando(true)
    try {
      const { descargarExcelFacturasGasto } = await import('../lib/excelFacturasGasto')
      await descargarExcelFacturasGasto(visibles, { emisores: emisores || [], proyectos: nombreProyecto, mes })
    } catch (e) { avisar('No se pudo armar el Excel: ' + e.message, { tono: 'error' }) }
    setBajando(false)
  }

  async function guardar() {
    const ruc = String(form.ruc || '').replace(/\D/g, '')
    if (!rucValido(ruc)) { avisar('Revisa el RUC: no es un RUC válido (11 dígitos y el último es el verificador).', { tono: 'error' }); return }
    setBusy(true)
    try {
      await guardarEmisorGasto({ ...form, ruc })
      setForm(null)
      await cargarEmisores()
      avisar('Guardado. Para que sus facturas salgan, su RUC tiene que estar cargado en el facturador del servidor (agregar-emisor.sh).', { tono: 'ok' })
    } catch (e) { avisar(e.message, { tono: 'error' }) }
    setBusy(false)
  }

  if (emisores === null) return (
    <>
      <div className="page-head"><h1>Facturas de gastos</h1></div>
      <p className="cp-nota">Falta instalar la factura de gastos en la base (sql/233).</p>
    </>
  )

  return (
    <>
      <div className="page-head">
        <h1>Facturas de gastos</h1>
        <button className="btn-ghost" onClick={cargar} disabled={cargando}>↻ Actualizar</button>
      </div>
      <p><Link to="/gastos">← Volver a Gastos</Link></p>
      <p className="hint" style={{ textTransform: 'none' }}>
        Las facturas que Victor o Alex le emiten al dueño de cada proyecto por un gasto. Se piden en <b>Gastos</b>, columna RH/Factura,
        botón <b>🧾 emitir factura</b>, apenas se crea el gasto (no espera las firmas). Si la factura salió por el portal de SUNAT, se sube su PDF en el gasto y el sistema ya no deja emitir otra. Si el comprobante es un RH o la factura de otra persona, se sigue subiendo.
      </p>

      <div className="fg-emisores">
        {(emisores || []).map(e => {
          const s = servidor[e.ruc]
          const r = resumen.find(x => x.ruc === e.ruc)
          return (
            <div key={e.ruc} className={'glass fg-emisor' + (e.activo ? '' : ' apagado')}>
              <b>{e.nombre}</b>
              <span className="muted small">{e.razon_social} · RUC {e.ruc} · serie {e.serie}</span>
              <span>{!e.activo ? <span className="cp-chip cp-gris">apagado</span>
                : !s ? <span className="cp-chip cp-aviso">falta cargarlo en el servidor</span>
                : s.error ? <span className="cp-chip cp-mal" title={s.error}>el servidor no pudo cargarlo</span>
                : !emisorVisto(s) ? <span className="cp-chip cp-aviso">el facturador no contesta</span>
                : s.ambiente === 'produccion' ? <span className="cp-chip cp-ok">emitiendo en real</span>
                : <span className="cp-chip cp-aviso">en PRUEBAS</span>}</span>
              <span className="small">Este mes: <b>{soles(r?.total || 0)}</b> · {r?.n || 0} factura(s)</span>
              {esSuper && <button type="button" className="link-btn small" onClick={() => setForm({ ...VACIO, ...e })}>cambiar</button>}
            </div>
          )
        })}
        {esSuper && <button type="button" className="btn-ghost" onClick={() => setForm({ ...VACIO })}>+ Quién factura gastos</button>}
        {!emisores?.length && !esSuper && <p className="muted">Todavía no hay nadie registrado para facturar gastos (lo hace el superusuario).</p>}
      </div>

      {form && (
        <div className="glass form-card" style={{ maxWidth: 640 }}>
          <p><b>{emisores?.some(e => e.ruc === form.ruc) ? 'Cambiar a ' + form.nombre : 'Agregar quién factura gastos'}</b></p>
          <div className="form-grid">
            <label>RUC <input value={form.ruc} inputMode="numeric" maxLength={11} disabled={emisores?.some(e => e.ruc === form.ruc)}
              onChange={e => setForm(f => ({ ...f, ruc: e.target.value.replace(/\D/g, '') }))} /></label>
            <label>Nombre corto <span className="muted small">(el del botón)</span>
              <input value={form.nombre} placeholder="VICTOR" onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} /></label>
            <label className="span2">Razón social <span className="muted small">(tal cual la ficha RUC)</span>
              <input value={form.razon_social} onChange={e => setForm(f => ({ ...f, razon_social: e.target.value }))} /></label>
            <label className="span2">Domicilio fiscal <span className="muted small">(tal cual la ficha RUC)</span>
              <input value={form.direccion || ''} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} /></label>
            <label>Serie de factura <input value={form.serie} maxLength={4} onChange={e => setForm(f => ({ ...f, serie: e.target.value.toUpperCase() }))} /></label>
            <label className="inline-check" style={{ alignSelf: 'end' }}>
              <input type="checkbox" checked={!!form.activo} onChange={e => setForm(f => ({ ...f, activo: e.target.checked }))} /> Puede emitir</label>
          </div>
          <p className="muted small" style={{ textTransform: 'none' }}>
            La razón social y el domicilio tienen que decir lo mismo que el archivo de su RUC en el servidor: eso es lo que viaja a SUNAT. Aquí es lo que se ve en el panel y en el PDF.
          </p>
          <div className="acc-row">
            <button className="btn-primary" onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
            <button className="btn-ghost" onClick={() => setForm(null)} disabled={busy}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="toolbar">
        <label className="inline-check">Mes <input type="month" value={mes} max={mesActual()} onChange={e => e.target.value && setMes(e.target.value)} /></label>
        <select value={quien} onChange={e => setQuien(e.target.value)}>
          <option value="todos">TODOS LOS EMISORES</option>
          {(emisores || []).map(e => <option key={e.ruc} value={e.ruc}>{e.nombre}</option>)}
        </select>
        <button className="btn-ghost" onClick={excel} disabled={bajando || !visibles.length} title="Una hoja por emisor: fecha, número, cliente, RUC, proyecto, detalle y montos (sin documentos)">
          {bajando ? 'Armando…' : '⬇ Excel del mes'}</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Factura</th><th>Emite</th><th>A nombre de</th><th>Proyecto</th><th>Gastos</th><th style={{ textAlign: 'right' }}>Total</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {visibles.map(c => {
              const e = ESTADOS[c.estado] || ESTADOS.pendiente
              return (
                <tr key={c.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fechaPe(c.fecha_emision)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}><button className="link-btn" onClick={() => setVer(c)}>{nombreTipo(c)} <b>{c.numero != null ? nombreComprobante(c) : '(sin número aún)'}</b></button>
                    {c.tipo === 'nota_credito' && <div className="muted small" style={{ textTransform: 'none' }}>anula la factura {c.ref_serie}-{c.ref_numero}</div>}</td>
                  <td>{nombreEmisor(c.ruc)}</td>
                  <td>{c.cliente_nombre}<div className="muted small">{c.cliente_numero}</div></td>
                  <td>{nombreProyecto[c.project_id] || '-'}</td>
                  <td>{gastosDeComprobante(c).length}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><b>{c.tipo === 'nota_credito' ? '−' : ''}{soles(c.total)}</b></td>
                  <td><button type="button" className={'cp-chip ' + e.c} title={e.ayuda} onClick={() => setVer(c)}>{e.t}{esPrueba(c) ? ' · prueba' : ''}</button>
                    {['rechazado', 'error'].includes(c.estado) && c.mensaje && <div className="muted small" style={{ textTransform: 'none', maxWidth: 320 }}>{c.mensaje}</div>}</td>
                  <td>{c.pdf_url && <a className="cp-pdf" href={c.pdf_url} target="_blank" rel="noreferrer">PDF</a>}</td>
                </tr>
              )
            })}
            {!visibles.length && <tr><td colSpan={9} className="muted">{cargando ? 'Cargando…' : 'No hay facturas de gastos en este mes.'}</td></tr>}
          </tbody>
        </table>
      </div>

      {ver && <ComprobanteDetalle comprobante={ver} onCerrar={() => { setVer(null); cargar() }} onCambio={cargar} />}
    </>
  )
}
