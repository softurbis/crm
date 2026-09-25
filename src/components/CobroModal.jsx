import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { savedFx } from '../lib/saveFx'
import { useAuth } from '../context/AuthContext'
import DatosPago from './DatosPago'
import FormPersona, { BuscarCliente } from './FormPersona'
import { soles } from '../lib/pagos'
import { fechaPe } from '../lib/lotes'
import { repartirCuotas, textoCuotas } from '../lib/cronograma'
import {
  hoyPe, sumarDias, sumarMeses, digitos, celularValido, esPendiente, faltanParaContrato,
  buscarPorCelular, guardarPersona, validarPago, planCascada, subirVoucher,
  registrarSeparacion, registrarInicial, registrarCuota, registrarCuadre,
} from '../lib/cobros'

const r2 = n => Math.round(Number(n) * 100) / 100
// el bot a veces guarda como "nombre" del lead el primer mensaje entero: eso no se copia
const pareceNombre = t => { const x = String(t || '').trim(); return x.length >= 5 && x.length <= 60 && !/\d/.test(x) && x.split(/\s+/).length <= 6 }
const TITULO = { separacion: 'Separar', inicial: 'Cobrar inicial', directa: 'Vender directo', cuota: 'Cobrar cuota', cuadre: 'Cuadre de inicial / separación' }

// Cobrar desde la ficha del lote (fase 2, 24 sep 2026): separacion, inicial
// (con o sin separacion previa), cuota y cuadre del superusuario. Todo en una
// ventana, con los pasos a la vista. La escritura vive en lib/cobros.js.
export default function CobroModal({ tipo, lote, detail, onClose, onListo }) {
  const { profile, role } = useAuth()
  const pidOp = lote.project_id
  const sep = detail.sep
  const sale = detail.sale
  const modo = tipo === 'inicial' && !sep ? 'directa' : tipo
  const esInicial = modo === 'inicial' || modo === 'directa'

  const [cuentas, setCuentas] = useState([])
  const [asesores, setAsesores] = useState([])
  const [secs, setSecs] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [hecho, setHecho] = useState(null)   // { titulo, texto, saleId, avisos }

  // ---- cuotas pendientes (cuota) ----
  const pendientes = useMemo(() => (sale ? detail.inst : [])
    .filter(q => q.status !== 'pagado' && Number(q.amount) - Number(q.amount_paid) > 0.004)
    .sort((a, b) => a.installment_number - b.installment_number), [sale, detail])
  const primera = pendientes[0] || null
  const debePrimera = primera ? r2(Number(primera.amount) - Number(primera.amount_paid)) : null

  const [pago, setPago] = useState(() => ({
    file: null, nota: '', fecha: hoyPe(), nroOp: '', cuentaId: '', opTipo: 'TRANSFERENCIA', obs: '',
    monto: modo === 'cuota' && debePrimera ? debePrimera.toFixed(2) : esInicial ? String(lote.initial_payment_default ?? '') : '',
  }))

  // ---- separacion ----
  const [cel, setCel] = useState('')
  const [nombre, setNombre] = useState('')
  const [hallado, setHallado] = useState(null)       // { clientes, lead }
  const [clienteSel, setClienteSel] = useState('nuevo')
  const [vence, setVence] = useState(sumarDias(hoyPe(), 7))
  const [advisorId, setAdvisorId] = useState(sep?.advisor_id || '')
  const [recordarA, setRecordarA] = useState([])

  // ---- inicial ----
  const [titular, setTitular] = useState(() => (sep?.client ? { ...sep.client } : null))
  const [archTit, setArchTit] = useState(null)
  const [co, setCo] = useState(null)                 // null = sin co-comprador
  const [buscandoCo, setBuscandoCo] = useState(false)
  const [archCo, setArchCo] = useState(null)
  const [precio, setPrecio] = useState(String(lote.total_price ?? ''))
  const [meses, setMeses] = useState(48)
  const [primeraCuota, setPrimeraCuota] = useState(sumarMeses(hoyPe(), 1))
  const [comision, setComision] = useState('')
  const [comUrbis, setComUrbis] = useState('')

  // ---- cuadre ----
  const [cuadreTipo, setCuadreTipo] = useState('inicial')

  useEffect(() => {
    supabase.from('financial_accounts').select('id, name').eq('active', true).eq('project_id', pidOp)
      .then(({ data }) => setCuentas(data || []))
    if (modo === 'separacion' || esInicial) cargarAsesores()
    if (modo === 'separacion') supabase.from('secretaries').select('id, full_name, user_id, tipo').eq('active', true).order('full_name')
      .then(({ data }) => setSecs(data || []))
  }, [])

  function cargarAsesores() {
    return supabase.from('advisors').select('id, code, full_name').eq('active', true).order('code')
      .then(({ data }) => setAsesores(data || []))
  }
  async function nuevoAsesor() {
    const code = (prompt('CODIGO corto del vendedor (ej. JUAN):') || '').trim().toUpperCase()
    if (!code) return
    const nom = (prompt('Nombre completo (opcional, Enter para saltar):') || '').trim().toUpperCase()
    const { data, error } = await supabase.from('advisors').insert({ code, full_name: nom || code, active: true }).select().single()
    if (error) { setErr('No se pudo crear el vendedor: ' + error.message); return }
    await cargarAsesores()
    setAdvisorId(data.id)
  }

  // separacion: con el celular completo se busca si ya es cliente o es un lead
  useEffect(() => {
    if (modo !== 'separacion') return
    if (digitos(cel).length < 9) { setHallado(null); setClienteSel('nuevo'); return }
    let vivo = true
    const t = setTimeout(async () => {
      const r = await buscarPorCelular(cel, pidOp)
      if (!vivo) return
      setHallado(r)
      setClienteSel(r.clientes[0]?.id || 'nuevo')
      if (r.lead && !nombre.trim() && pareceNombre(r.lead.full_name)) setNombre(r.lead.full_name)
    }, 400)
    return () => { vivo = false; clearTimeout(t) }
  }, [cel])

  // ---- numeros de la inicial ----
  const sepMonto = sep ? Number(sep.amount) : 0
  const financiado = r2(Number(precio || 0) - Number(pago.monto || 0) - sepMonto)
  const nMeses = parseInt(meses) || 0
  const montos = esInicial && financiado > 0 && nMeses >= 1 && nMeses <= 120 ? repartirCuotas(financiado, nMeses) : []
  const plan = useMemo(() => (modo === 'cuota' ? planCascada(pendientes, pago.monto) : null), [modo, pendientes, pago.monto])

  const tocado = !!(pago.file || cel || nombre || archTit || co)
  const cerrar = () => {
    if (hecho) { onListo(); return }
    if (tocado && !confirm('¿Cerrar sin registrar? Se pierde lo que llenaste.')) return
    onClose()
  }

  function validar() {
    const ePago = validarPago(pago, { voucherObligatorio: modo !== 'cuadre' })
    if (modo === 'separacion') {
      if (!celularValido(cel)) return 'Escribe un celular válido (9 dígitos).'
      if (clienteSel === 'nuevo' && nombre.trim().length < 5) return 'Escribe el nombre completo de quien separa.'
      if (ePago) return ePago
      if (!vence || vence < pago.fecha) return 'La fecha de vencimiento no puede ser antes del pago.'
      if (!advisorId) return 'Elige el vendedor (asesor).'
    }
    if (esInicial) {
      if (!titular) return 'Elige o registra al titular.'
      const ft = faltanParaContrato(titular, archTit)
      if (ft.length) return 'Faltan datos del titular para el contrato: ' + ft.join(', ') + '.'
      if (co) {
        const fc = faltanParaContrato(co, archCo)
        if (fc.length) return 'Faltan datos del co-comprador: ' + fc.join(', ') + '.'
        if (String(co.doc_number).toUpperCase() === String(titular.doc_number).toUpperCase()) return 'El co-comprador no puede tener el mismo documento que el titular.'
      }
      if (ePago) return ePago
      if (!(Number(precio) > 0)) return 'Revisa el precio de venta.'
      if (!(nMeses >= 1 && nMeses <= 120)) return 'Número de cuotas inválido (1 a 120).'
      if (!(financiado > 0)) return 'No queda saldo por financiar: revisa precio, inicial y separación.'
      if (!/^\d{4}-\d{2}-\d{2}$/.test(primeraCuota) || primeraCuota <= pago.fecha) return 'La primera cuota tiene que vencer después de la fecha de la inicial.'
      if (!advisorId) return 'Elige el vendedor (asesor).'
    }
    if (modo === 'cuota') {
      if (ePago) return ePago
      if (!plan?.parts.length) return 'Monto inválido.'
      if (plan.sobra > 0.01) return 'El monto pasa lo que debe el lote en ' + soles(plan.sobra) + '.'
    }
    if (modo === 'cuadre' && ePago) return ePago
    return null
  }

  async function registrar() {
    setErr(null)
    const e = validar()
    if (e) { setErr(e); return }
    setBusy(true)
    try {
      // el lote pudo cambiar mientras se llenaba (otra secretaria lo separo)
      const { data: ahora } = await supabase.from('lots').select('status').eq('id', lote.id).single()
      if (modo === 'separacion' && ahora?.status !== 'disponible') throw new Error('Este lote ya no está disponible (ahora figura ' + (ahora?.status || '?').toUpperCase() + '). Recarga la ficha.')
      if (esInicial && !['disponible', 'separado'].includes(ahora?.status)) throw new Error('Este lote ya no se puede vender (ahora figura ' + (ahora?.status || '?').toUpperCase() + '). Recarga la ficha.')

      if (modo === 'separacion') {
        await registrarSeparacion({
          pidOp, lote, pago, vence, advisorId, recordarA, secs, profile, leadId: hallado?.lead?.id,
          clienteId: clienteSel !== 'nuevo' ? clienteSel : null,
          nuevaPersona: clienteSel === 'nuevo' ? { nombre, celular: cel } : null,
        })
        setHecho({ titulo: 'Separación registrada', texto: `MZ ${lote.mz} LT ${lote.lt} queda SEPARADO hasta el ${fechaPe(vence)}. Los datos del contrato (DNI, dirección…) se piden al cobrar la inicial.` })
      }
      if (esInicial) {
        // el voucher primero: si no sube, no se toca ninguna ficha ni se crea la venta
        const subida = await subirVoucher(pago)
        const { cliente } = await guardarPersona(titular, archTit)
        const coCli = co ? (await guardarPersona(co, archCo)).cliente : null
        const r = await registrarInicial({
          pidOp, lote, sep, clienteId: cliente.id,
          clientePendienteId: sep && sep.client_id !== cliente.id ? sep.client_id : null,
          coClienteId: coCli?.id || null, pago, subida, precio, meses: nMeses, primeraCuota,
          advisorId, comision, comUrbis, profile, telefonos: [cliente.phone, cliente.phone2],
        })
        setHecho({
          titulo: 'Venta registrada', saleId: r.sale.id, avisos: r.avisos,
          texto: `${cliente.full_name}${coCli ? ' y ' + coCli.full_name : ''} · MZ ${lote.mz} LT ${lote.lt} · ${textoCuotas(montos)}, desde el ${fechaPe(primeraCuota)}.`,
        })
      }
      if (modo === 'cuota') {
        await registrarCuota({ pidOp, lote, sale, pago, plan, profile })
        setHecho({ titulo: 'Pago registrado', texto: plan.parts.map(p => `Cuota N° ${p.q.installment_number}: ${soles(p.take)}${p.resto > 0.004 ? ' (queda debiendo ' + soles(p.resto) + ')' : ' — pagada'}`).join(' · ') })
      }
      if (modo === 'cuadre') {
        await registrarCuadre({ pidOp, lote, sale, pago, tipo: cuadreTipo, profile })
        setHecho({ titulo: 'Cuadre registrado', texto: `${cuadreTipo === 'inicial' ? 'Inicial' : 'Separación'} de ${soles(pago.monto)}: ya suma en lo pagado del lote.` })
      }
      savedFx()
    } catch (x) { setErr(x.message || String(x)) }
    setBusy(false)
  }

  const Vendedor = (
    <label>Vendedor (asesor) <button type="button" className="link-btn" onClick={nuevoAsesor} title="Registrar un vendedor nuevo, también externo">+ nuevo</button>
      <select value={advisorId} onChange={e => setAdvisorId(e.target.value)}>
        <option value="">- elegir -</option>
        {asesores.map(a => <option key={a.id} value={a.id}>{a.code}{a.full_name && a.full_name !== a.code ? ' - ' + a.full_name : ''}</option>)}
      </select>
    </label>
  )

  return (
    <div className="modal-bg">
      <div className="glass modal cobro-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{TITULO[modo]} · Mz {lote.mz} Lt {lote.lt}</h2>
          <button className="btn-ghost" onClick={cerrar} title="Cerrar">&#10005;</button>
        </div>

        {hecho ? (
          <div className="cobro-hecho">
            <p className="ok cobro-hecho-t">✓ {hecho.titulo}</p>
            <p>{hecho.texto}</p>
            {(hecho.avisos || []).map((a, i) => <p key={i} className="warn">{a}</p>)}
            <p className="muted small">Cuando emitas la boleta o factura SUNAT, súbela en la pestaña <b>Pagos y documentos</b> de la ficha.</p>
            <div className="acc-row" style={{ marginTop: 10 }}>
              {hecho.saleId && <Link className="btn-primary" to={`/contratos?venta=${hecho.saleId}`}>&#128196; Generar contrato</Link>}
              <button className="btn-ghost" onClick={onListo}>Volver a la ficha</button>
            </div>
          </div>
        ) : (
          <form className="form-compact" onSubmit={e => { e.preventDefault(); registrar() }}>
            {/* ======================= SEPARACION ======================= */}
            {modo === 'separacion' && (<>
              <div className={`paso ${celularValido(cel) && (clienteSel !== 'nuevo' || nombre.trim()) ? 'listo' : ''}`}>
                <span className="paso-n">1</span><span className="paso-t">¿Quién separa? Solo nombre y celular: el DNI se pide en la inicial</span>
              </div>
              <div className="form-grid">
                <label>Celular <input value={cel} inputMode="tel" autoFocus placeholder="9 dígitos" onChange={e => setCel(e.target.value)} /></label>
                {clienteSel === 'nuevo'
                  ? <label>Nombre completo <input value={nombre} onChange={e => setNombre(e.target.value)} /></label>
                  : <label>Nombre <div className="dato-fijo"><span className="dato-pin" /><b>{hallado?.clientes.find(c => c.id === clienteSel)?.full_name}</b></div></label>}
              </div>
              {hallado?.clientes.length > 0 && (
                <div className="cobro-caja">
                  <p className="small" style={{ margin: '0 0 4px' }}>Ese celular ya está registrado. ¿Es esta persona?</p>
                  {hallado.clientes.map(c => (
                    <label key={c.id} className="cobro-opcion">
                      <input type="radio" name="clisep" checked={clienteSel === c.id} onChange={() => setClienteSel(c.id)} />
                      <b>{c.full_name}</b> <span className="muted small">{esPendiente(c) ? 'DNI pendiente' : `${c.doc_type} ${c.doc_number}`}</span>
                    </label>
                  ))}
                  <label className="cobro-opcion">
                    <input type="radio" name="clisep" checked={clienteSel === 'nuevo'} onChange={() => setClienteSel('nuevo')} />
                    Es otra persona (usa el mismo celular)
                  </label>
                </div>
              )}
              {hallado?.lead && (
                <p className="hint small">&#128227; Es un lead de WhatsApp: <b>{hallado.lead.full_name}</b> ({String(hallado.lead.status).replace('_', ' ')}). Al separar pasa a <b>en negociación</b> y Campañas lo cuenta.</p>
              )}
              <DatosPago pago={pago} setPago={setPago} cuentas={cuentas} paso={2}>
                <label>Vence el <input type="date" value={vence} onChange={e => setVence(e.target.value)} /></label>
                {Vendedor}
                {secs.length > 0 && (
                  <div className="span2">
                    <span className="muted small">RECORDAR EL VENCIMIENTO A (va a su control de actividades; tu registro se agrega solo):</span><br />
                    {secs.map(s => (
                      <label key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 14, fontWeight: 400 }}>
                        <input type="checkbox" checked={recordarA.includes(s.id)}
                          onChange={e => setRecordarA(ids => e.target.checked ? [...ids, s.id] : ids.filter(x => x !== s.id))} />
                        {s.tipo === 'gerencia' ? '\u{1F454} ' : ''}{s.full_name}{s.user_id === profile?.id ? ' (tú)' : ''}
                      </label>
                    ))}
                  </div>
                )}
              </DatosPago>
            </>)}

            {/* ======================= INICIAL ======================= */}
            {esInicial && (<>
              <div className={`paso ${titular && !faltanParaContrato(titular, archTit).length ? 'listo' : ''}`}>
                <span className="paso-n">1</span>
                <span className="paso-t">{sep ? 'Titular: la misma persona que separó. Completa los datos del contrato' : '¿Quién compra? Datos del contrato'}</span>
              </div>
              {sep && <p className="hint small" style={{ margin: '0 0 6px' }}>Separó el {fechaPe(sep.date)} con {soles(sep.amount)} (se descuenta del saldo).</p>}
              {!titular ? (
                <div className="cobro-caja">
                  <BuscarCliente onElegir={c => setTitular(c)} />
                  <p className="small" style={{ margin: '6px 0 0' }}>¿No está registrado? <button type="button" className="link-btn" onClick={() => setTitular({ doc_type: 'DNI' })}>+ Persona nueva</button></p>
                </div>
              ) : (
                <div className="cobro-caja">
                  <FormPersona persona={titular} setPersona={setTitular} archivo={archTit} setArchivo={setArchTit} titulo="Titular" />
                  {!sep && <button type="button" className="link-btn small" onClick={() => { setTitular(null); setArchTit(null) }}>cambiar de persona</button>}
                </div>
              )}

              <div className="cobro-caja">
                {!co && !buscandoCo && <button type="button" className="link-btn" onClick={() => setBuscandoCo(true)}>+ Agregar co-comprador (firma también el contrato)</button>}
                {!co && buscandoCo && (<>
                  <p className="fl-lbl" style={{ margin: '0 0 4px' }}>Co-comprador</p>
                  <BuscarCliente onElegir={c => { setCo(c); setBuscandoCo(false) }} excluir={titular?.id ? [titular.id] : []} />
                  <p className="small" style={{ margin: '6px 0 0' }}>
                    <button type="button" className="link-btn" onClick={() => { setCo({ doc_type: 'DNI' }); setBuscandoCo(false) }}>+ Persona nueva</button>
                    {' · '}<button type="button" className="link-btn" onClick={() => setBuscandoCo(false)}>cancelar</button>
                  </p>
                </>)}
                {co && (<>
                  <FormPersona persona={co} setPersona={setCo} archivo={archCo} setArchivo={setArchCo} titulo="Co-comprador" excluirDoc={titular?.doc_number} />
                  <button type="button" className="link-btn small" onClick={() => { setCo(null); setArchCo(null) }}>quitar co-comprador</button>
                </>)}
              </div>

              <DatosPago pago={pago} setPago={setPago} cuentas={cuentas} paso={2}>
                <label>Precio de venta S/ <input type="number" step="0.01" value={precio} onChange={e => setPrecio(e.target.value)} /></label>
                <label>N° de cuotas <input type="number" min="1" max="120" value={meses} onChange={e => setMeses(e.target.value)} /></label>
                <label>Primera cuota vence el <input type="date" value={primeraCuota} onChange={e => setPrimeraCuota(e.target.value)} /></label>
                {Vendedor}
                <label>Comisión asesor S/ <input type="number" step="0.01" min="0" value={comision} onChange={e => setComision(e.target.value)} placeholder="0.00" /></label>
                <label>Comisión Urbis S/ <input type="number" step="0.01" min="0" value={comUrbis} onChange={e => setComUrbis(e.target.value)} placeholder="0.00" /></label>
              </DatosPago>
              <div className="cobro-resumen">
                <p style={{ margin: 0 }}>
                  Precio {soles(precio)}{sep ? <> − separación {soles(sepMonto)}</> : null} − inicial {soles(pago.monto)} = <b>{soles(financiado)}</b> a financiar
                </p>
                {montos.length > 0
                  ? <p style={{ margin: '4px 0 0' }}>&#128197; <b>{textoCuotas(montos)}</b>, del {fechaPe(primeraCuota)} al {fechaPe(sumarMeses(primeraCuota, montos.length - 1))}. <span className="muted small">(cuotas redondeadas al sol; la última absorbe la diferencia)</span></p>
                  : <p className="warn" style={{ margin: '4px 0 0' }}>Completa precio, inicial y cuotas para ver el cronograma.</p>}
              </div>
            </>)}

            {/* ======================= CUOTA ======================= */}
            {modo === 'cuota' && (<>
              <p className="muted small" style={{ margin: '0 0 6px' }}>
                Cliente: <b>{sale.client?.full_name}</b>
                {primera ? <> · toca la cuota N° {primera.installment_number}: <b>{soles(debePrimera)}</b>, vence {fechaPe(primera.due_date)}</> : ' · no tiene cuotas pendientes'}
              </p>
              <DatosPago pago={pago} setPago={setPago} cuentas={cuentas} paso={1}
                esperado={primera ? { monto: debePrimera, n: primera.installment_number } : null} />
              {plan?.parts.length > 0 && (
                <div className="cobro-resumen">
                  <p style={{ margin: '0 0 4px' }}>Se aplicará así (de la cuota más antigua a la más nueva):</p>
                  {plan.parts.map(p => (
                    <p key={p.q.id} style={{ margin: '2px 0' }}>
                      &#8594; Cuota N° {p.q.installment_number} (vence {fechaPe(p.q.due_date)}): {soles(p.take)}
                      {p.resto > 0.004 ? <b className="warn"> — quedará debiendo {soles(p.resto)}</b> : <b className="ok"> — queda pagada</b>}
                    </p>
                  ))}
                  {plan.sobra > 0.01 && <p className="error">Sobran {soles(plan.sobra)}: pasa lo que debe el lote.</p>}
                </div>
              )}
            </>)}

            {/* ======================= CUADRE (superusuario) ======================= */}
            {modo === 'cuadre' && role === 'superuser' && (<>
              <div className="cobro-caja" style={{ borderLeft: '3px solid #e0b34c' }}>
                <p className="small" style={{ margin: 0 }}>Registra una <b>inicial</b> o <b>separación</b> que no se cargó en la migración, sobre esta venta. Entra a caja ligada a la venta y suma en lo pagado. <b>No crea venta ni toca el cronograma.</b></p>
                <div className="acc-row" style={{ marginTop: 6 }}>
                  {[['inicial', 'Inicial'], ['separacion', 'Separación']].map(([v, l]) => (
                    <button type="button" key={v} className={`chip ${cuadreTipo === v ? 'on' : ''}`} style={{ margin: 0 }} onClick={() => setCuadreTipo(v)}>{l}</button>
                  ))}
                </div>
                <p className="hint small" style={{ margin: '6px 0 0' }}>
                  Ya registrado en caja: inicial {soles(detail.iniPagado)} · separación {soles(detail.sepPagado)}.
                  {cuadreTipo === 'inicial' && detail.iniPagado > 0 && <b className="bad"> Ojo: ya tiene inicial, no la dupliques.</b>}
                  {cuadreTipo === 'separacion' && detail.sepPagado > 0 && <b className="bad"> Ojo: ya tiene separación, no la dupliques.</b>}
                </p>
              </div>
              <DatosPago pago={pago} setPago={setPago} cuentas={cuentas} paso={1} voucherObligatorio={false} />
            </>)}

            {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
            <div className="acc-row" style={{ marginTop: 12 }}>
              <button className="btn-primary" disabled={busy || (modo === 'cuota' && plan?.sobra > 0.01)}>
                {busy ? 'Registrando…' : modo === 'separacion' ? 'Registrar separación' : esInicial ? 'Registrar venta e inicial' : modo === 'cuadre' ? 'Registrar cuadre' : 'Registrar pago'}
              </button>
              <button type="button" className="btn-ghost" onClick={cerrar} disabled={busy}>Cancelar</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
