import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'
import { LBL } from '../lib/lotes'
import PlanoReal from '../components/PlanoReal'
import { tienePlano, categoriasDe, categoriaDe, cotizar, soles, textoCuotasVenta } from '../lib/plano'

// PANEL DEL VENDEDOR (5 nov 2026, pedido del dueño): ver de un vistazo la inicial y la
// cuota de cada lote de cualquier proyecto, cotizar uno y mandarle la cotización al
// cliente. Todo sale de panel_vendedor() (sql/181): lotes, precios, plano y reglas de
// venta del proyecto, sin datos de clientes (por eso lo puede ver el asesor).
// Las cuotas van en SOLES ENTEROS y la última absorbe la diferencia, igual que el
// contrato que después arma el sistema: "47 cuotas de S/ 458 y la cuota 48 de S/ 412.52".
const PLAZOS = [12, 24, 36, 48, 60, 72]
const LIBRE = ['disponible']
const nombreLote = l => l.mz + '-' + l.lt
const frenteA = t => String(t || '').replace(/^(LA|EL)\s+/i, '')

function textoWhatsApp(proy, l, q, cfg) {
  const med = l.medidas || {}
  const lineas = [
    '*' + proy.name + '*',
    'Lote ' + nombreLote(l) + ' (Mz ' + l.mz + ' Lt ' + l.lt + ')',
    'Área: ' + Number(l.area_m2).toFixed(2) + ' m²' + (med.frente && med.fondo ? ' (' + med.frente.replace(' ml', '') + ' × ' + (med.derecha || med.fondo).replace(' ml', '') + ' m)' : '') + (l.frente ? ' · frente a ' + frenteA(l.frente) : ''),
    '',
    'Precio: ' + soles(q.precio),
    'Inicial: ' + soles(q.inicial),
    q.n ? q.n + ' meses sin intereses: ' + textoCuotasVenta(q) : '',
    q.n ? '(más o menos ' + soles(q.semanal) + ' por semana o ' + soles(q.diaria) + ' por día)' : '',
    q.contado ? 'Al contado: ' + soles(q.contado) + ' (' + q.dto + '% de descuento pagando todo de una vez)' : '',
    Number(cfg.separacion) > 0 ? 'Separa tu lote con ' + soles(cfg.separacion) + '.' : '',
    proy.oficina ? 'Oficina: ' + proy.oficina : '',
  ]
  return lineas.filter((x, i) => x !== '' || i === 3).join('\n')
}

export default function Vendedor() {
  const { role } = useAuth()
  const { pidOp } = useProject()
  const irA = useNavigate()
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [plazo, setPlazo] = useState(null)
  const [cat, setCat] = useState('todas')
  const [mz, setMz] = useState('todas')
  const [buscar, setBuscar] = useState('')
  const [tope, setTope] = useState('')
  const [soloLibres, setSoloLibres] = useState(true)
  const [orden, setOrden] = useState('cuota')
  const [sel, setSel] = useState(null)
  const [inicial, setInicial] = useState('')
  const [cuantos, setCuantos] = useState(60)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    if (!pidOp) return
    let vivo = true
    setDatos(null); setError(''); setSel(null); setCat('todas'); setMz('todas')
    supabase.rpc('panel_vendedor', { p_proyecto: pidOp }).then(({ data, error }) => {
      if (!vivo) return
      if (error) {
        setError(/panel_vendedor/.test(error.message) && /function|exist|schema cache/i.test(error.message)
          ? 'Falta correr sql/181_campo_verde_lotes_y_plano.sql en la base.' : error.message)
        return
      }
      setDatos(data)
      setPlazo(p => p && p <= (data.config?.cuotas || 48) ? p : (data.config?.cuotas || 48))
    })
    return () => { vivo = false }
  }, [pidOp])

  const cfg = datos?.config || { cuotas: 48, separacion: 0, descuento_contado: 0, no_ofrecer: [] }
  const lotes = datos?.lotes || []
  const noOfrecer = useMemo(() => new Set((cfg.no_ofrecer || []).map(s => String(s).toUpperCase())), [datos])   
  const libre = l => LIBRE.includes(l.status) && !l.associated_to && !noOfrecer.has(nombreLote(l).toUpperCase())
  const cats = useMemo(() => categoriasDe(datos?.plano, lotes), [datos])   
  const colorDe = l => categoriaDe(cats, l)?.color || '#9aa896'
  const meses = Math.min(plazo || cfg.cuotas || 48, cfg.cuotas || 48)
  const plazos = [...new Set([...PLAZOS.filter(p => p < (cfg.cuotas || 48)), cfg.cuotas || 48])]
  const qDe = (l, ini = l.inicial) => cotizar(l.total_price, ini, meses, cfg.descuento_contado)
  const manzanas = useMemo(() => [...new Set(lotes.map(l => l.mz))], [lotes])

  // los lotes de la lista, con los filtros de arriba
  const lista = useMemo(() => {
    const b = buscar.trim().toUpperCase().replace(/MZ|LT|LOTE|MANZANA|\s|\./g, '')
    const t = Number(tope) || 0
    let r = lotes.filter(l => {
      if (soloLibres && !libre(l)) return false
      if (cat !== 'todas' && String(categoriaDe(cats, l)?.precio_m2) !== cat) return false
      if (mz !== 'todas' && l.mz !== mz) return false
      if (b && !(l.mz + l.lt).toUpperCase().startsWith(b) && nombreLote(l).toUpperCase().replace('-', '') !== b) return false
      if (t && qDe(l).cuota > t) return false
      return true
    }).map(l => ({ l, q: qDe(l) }))
    const nat = (a, b) => a.l.mz.localeCompare(b.l.mz) || (parseInt(a.l.lt) - parseInt(b.l.lt)) || String(a.l.lt).localeCompare(String(b.l.lt))
    r.sort(orden === 'cuota' ? ((a, b) => a.q.cuota - b.q.cuota || nat(a, b)) : orden === 'precio_desc' ? ((a, b) => b.q.precio - a.q.precio || nat(a, b)) : nat)
    return r
  }, [lotes, buscar, tope, soloLibres, cat, mz, orden, meses, cats])   

  const elegir = l => {
    setSel(l); setInicial(String(l.inicial ?? '')); setCopiado(false)
    if (window.innerWidth < 900) setTimeout(() => document.getElementById('pv-cot')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  const qSel = sel ? qDe(sel, inicial === '' ? sel.inicial : Number(inicial)) : null
  const enLista = new Set(lista.map(x => x.l.id))
  const hayPlano = tienePlano(datos?.plano, lotes)

  async function copiar() {
    const t = textoWhatsApp(datos.proyecto, sel, qSel, cfg)
    try { await navigator.clipboard.writeText(t); setCopiado(true); setTimeout(() => setCopiado(false), 2500) }
    catch { window.prompt('Copia la cotización:', t) }
  }
  const whatsapp = () => window.open('https://wa.me/?text=' + encodeURIComponent(textoWhatsApp(datos.proyecto, sel, qSel, cfg)), '_blank', 'noopener')

  const libres = lotes.filter(libre)
  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Panel del vendedor</h1>
        <ProjectPicker />
      </div>
      {error && <p className="error">{error}</p>}
      {!datos && !error && <p className="muted">Cargando precios…</p>}
      {datos && !lotes.length && <p className="hint">Este proyecto todavía no tiene lotes cargados.</p>}

      {datos && lotes.length > 0 && <>
        {/* un vistazo por color de precio: cuántos quedan, la inicial y desde cuánto es la cuota */}
        <div className="pv-cats">
          {cats.map(c => {
            const delColor = lotes.filter(l => categoriaDe(cats, l) === c)
            const quedan = delColor.filter(libre)
            const qs = quedan.map(l => qDe(l))
            const ini = [...new Set(quedan.map(l => Number(l.inicial)))].sort((a, b) => a - b)
            const on = cat === String(c.precio_m2)
            return (
              <button key={c.precio_m2} type="button" className={'glass pv-cat' + (on ? ' on' : '')} style={{ '--cc': c.color }}
                onClick={() => setCat(on ? 'todas' : String(c.precio_m2))}>
                <span className="pv-cat-n"><i />{c.nombre}</span>
                <b>{soles(c.precio_m2)} el m²</b>
                <span>{quedan.length} disponibles de {delColor.length}</span>
                {qs.length > 0 && <span>Inicial {ini.map(n => soles(n)).join(' / ')}</span>}
                {qs.length > 0 && <span>Cuota desde <b>{soles(Math.min(...qs.map(q => q.cuota)))}</b> en {meses} meses</span>}
              </button>
            )
          })}
        </div>

        <div className="pv-ctrl glass">
          <div className="pv-plazos">
            <span className="muted small">Plazo</span>
            {plazos.map(p => (
              <button key={p} type="button" className={'chip' + (meses === p ? ' on' : '')} onClick={() => setPlazo(p)}>{p} meses</button>
            ))}
          </div>
          <label>Lote <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="A-12" /></label>
          <label>Manzana
            <select value={mz} onChange={e => setMz(e.target.value)}>
              <option value="todas">Todas</option>
              {manzanas.map(m => <option key={m} value={m}>Mz {m}</option>)}
            </select>
          </label>
          <label title="Lo que el cliente puede pagar al mes">Paga al mes hasta S/ <input type="number" min="0" value={tope} onChange={e => setTope(e.target.value)} placeholder="ej. 300" /></label>
          <label>Ordenar
            <select value={orden} onChange={e => setOrden(e.target.value)}>
              <option value="cuota">Cuota más baja</option>
              <option value="precio_desc">Precio más alto</option>
              <option value="lote">Manzana y lote</option>
            </select>
          </label>
          <label className="pv-check"><input type="checkbox" checked={soloLibres} onChange={e => setSoloLibres(e.target.checked)} /> Solo disponibles</label>
        </div>

        <div className={'pv-grid' + (hayPlano ? '' : ' sin-plano')}>
          {hayPlano && (
            <div className="pv-mapa">
              <PlanoReal plano={datos.plano} lotes={lotes} alto="64vh"
                relleno={l => libre(l) ? colorDe(l) : '#5b625d'}
                atenuado={l => !enLista.has(l.id)}
                titulo={l => nombreLote(l) + ' · ' + Number(l.area_m2).toFixed(2) + ' m²' + (libre(l) ? ' · ' + soles(l.total_price) + ' · cuota ' + soles(qDe(l).cuota) : ' · ' + (LBL[l.status] || l.status).toUpperCase())}
                onLote={elegir} elegido={sel?.id} />
              <p className="muted small" style={{ margin: '.4rem 0 0' }}>
                En color, los disponibles (el color es su precio); en gris, los separados y vendidos. Toca un lote para cotizarlo.
              </p>
            </div>
          )}

          <div className="pv-lado" id="pv-cot">
            {!sel && <div className="glass pv-cot"><p className="muted">Toca un lote {hayPlano ? 'en el plano o ' : ''}en la lista para cotizarlo.</p>
              <p className="muted small" style={{ marginTop: '.6rem' }}>{libres.length} lotes disponibles de {lotes.length}. Plazo máximo {cfg.cuotas} meses sin intereses{Number(cfg.descuento_contado) > 0 ? ' · ' + cfg.descuento_contado + '% de descuento al contado' : ''}.</p></div>}
            {sel && qSel && (
              <div className="glass pv-cot" style={{ '--cc': colorDe(sel) }}>
                <div className="pv-cot-cab">
                  <span className="pv-cot-lote">{nombreLote(sel)}</span>
                  <span className="pv-cot-cat">{categoriaDe(cats, sel)?.nombre || ''}</span>
                  {!libre(sel) && <span className="chip-legal bad">{noOfrecer.has(nombreLote(sel).toUpperCase()) ? 'NO OFRECER' : (LBL[sel.status] || sel.status).toUpperCase()}</span>}
                  <button type="button" className="btn-ghost pv-x" onClick={() => setSel(null)} title="Cerrar">✕</button>
                </div>
                <p className="muted small">
                  {Number(sel.area_m2).toFixed(2)} m² · {soles(sel.price_per_m2)} el m²
                  {sel.medidas?.frente ? ' · frente ' + sel.medidas.frente : ''}{sel.frente ? ' a ' + frenteA(sel.frente) : ''}
                </p>
                <div className="pv-cifras">
                  <div><span>Precio</span><b>{soles(qSel.precio)}</b></div>
                  <div><span>Inicial</span>
                    <input type="number" min="0" step="1" value={inicial} onChange={e => setInicial(e.target.value)} />
                  </div>
                  <div><span>Saldo</span><b>{soles(qSel.saldo)}</b></div>
                </div>
                <div className="pv-cuota">
                  <span>{qSel.n} meses sin intereses</span>
                  <b>{soles(qSel.cuota)} <small>al mes</small></b>
                  <em>{textoCuotasVenta(qSel)}</em>
                  <span className="muted small">≈ {soles(qSel.semanal)} por semana · {soles(qSel.diaria)} por día</span>
                </div>
                {qSel.contado && <p className="pv-contado">Al contado: <b>{soles(qSel.contado)}</b> ({qSel.dto}% de descuento)</p>}
                {Number(cfg.separacion) > 0 && <p className="muted small">Separa con {soles(cfg.separacion)}.</p>}
                {Number(inicial) < Number(sel.inicial) && <p className="error small">La inicial de lista de este lote es {soles(sel.inicial)}.</p>}
                <div className="pv-botones">
                  <button type="button" className="btn-primary" onClick={whatsapp}>Enviar por WhatsApp</button>
                  <button type="button" className="btn-ghost" onClick={copiar}>{copiado ? '✓ Copiado' : 'Copiar cotización'}</button>
                  {role !== 'asesor' && <button type="button" className="btn-ghost" onClick={() => irA('/lotes/' + sel.id)}>Abrir ficha</button>}
                </div>
              </div>
            )}
          </div>
        </div>

        <h3 className="pv-titulo">{lista.length} {lista.length === 1 ? 'lote' : 'lotes'} {soloLibres ? 'disponibles' : ''} · cuotas a {meses} meses</h3>
        <div className="pv-lista">
          {lista.slice(0, cuantos).map(({ l, q }) => (
            <button key={l.id} type="button" className={'glass pv-lote' + (sel?.id === l.id ? ' on' : '') + (libre(l) ? '' : ' ocupado')}
              style={{ '--cc': libre(l) ? colorDe(l) : '#5b625d' }} onClick={() => elegir(l)}>
              <span className="pv-lote-n">{nombreLote(l)}</span>
              <span className="pv-lote-a">{Number(l.area_m2).toFixed(2)} m²{l.frente ? ' · ' + frenteA(l.frente) : ''}</span>
              <span className="pv-lote-p">{soles(q.precio)}</span>
              <span className="pv-lote-i">Inicial {soles(q.inicial)}</span>
              <b className="pv-lote-c">{soles(q.cuota)} <small>/ mes</small></b>
              {Math.abs(q.ultima - q.cuota) >= 0.005 && <span className="pv-lote-u">cuota {q.n}: {soles(q.ultima)}</span>}
              {!libre(l) && <span className="pv-lote-e">{(LBL[l.status] || l.status).toUpperCase()}</span>}
            </button>
          ))}
        </div>
        {lista.length > cuantos && (
          <button type="button" className="btn-ghost" style={{ margin: '1rem auto', display: 'block' }} onClick={() => setCuantos(c => c + 60)}>
            Ver {Math.min(60, lista.length - cuantos)} más
          </button>
        )}
      </>}
    </>
  )
}
