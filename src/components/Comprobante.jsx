import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { soles } from '../lib/pagos'
import { fechaPe } from '../lib/lotes'
import { pedir, avisar } from '../lib/dialogos'
import { useAuth } from '../context/AuthContext'
import { logoProyecto } from '../context/ProjectContext'
import { consultarDoc, rucConProblema } from '../lib/consultaDoc'
import {
  ESTADOS, COLS_COMPROBANTE, TIPO_DOC, nombreComprobante, esPrueba, estaVivo, enCamino, rucValido, descripcionPago,
  pedirComprobante, anularComprobante, reintentarComprobante, emisorDelServidor, emisorVisto,
  enviarComprobanteWsp, envioWsp, celularesDe, celularBonito, wspDelProyecto, textoComprobanteWsp, enlaceWsp,
} from '../lib/comprobantes'

// La boleta o factura electrónica de un cobro (sql/113). Tres piezas:
//   <ComprobanteChip>     el estado, en la fila del pago
//   <EmitirComprobante>   el diálogo para pedirla (boleta con DNI / factura con RUC)
//   <ComprobanteDetalle>  lo que pasó con ella: PDF, XML, constancia, anular

// Quién factura: su logo y su nombre. Cada proyecto con su marca.
export function MarcaEmisor({ proyecto, emisor, chico = false }) {
  const logo = logoProyecto(proyecto)
  return (
    <div className={'cp-marca' + (chico ? ' chico' : '')} style={{ '--cp': proyecto?.fact_color || 'var(--accent)' }}>
      {logo && <img src={logo} alt="" />}
      <div>
        <b>{proyecto?.fact_razon_social || proyecto?.name}</b>
        <span>RUC {proyecto?.fact_ruc || '—'}{emisor?.ambiente === 'beta' && emisorVisto(emisor) ? ' · ambiente de PRUEBAS' : ''}</span>
      </div>
    </div>
  )
}

export function ComprobanteChip({ c, onClick }) {
  if (!c) return null
  const e = ESTADOS[c.estado] || ESTADOS.pendiente
  return (
    <button type="button" className={'cp-chip ' + e.c} onClick={onClick}
      title={(c.tipo === 'factura' ? 'Factura ' : 'Boleta ') + nombreComprobante(c) + ' — ' + e.ayuda + (c.mensaje ? '\n' + c.mensaje : '')}>
      {enCamino(c) && <span className="cp-gira" />}
      <b>{c.numero != null ? nombreComprobante(c) : c.tipo}</b> {e.t}{esPrueba(c) && estaVivo(c) ? ' · prueba' : ''}
    </button>
  )
}

// ---------------------------------------------------------------- enviar
// Mandarle el PDF al cliente por WhatsApp (sql/123): a su celular registrado o a
// otro. Si el proyecto tiene SU WhatsApp conectado en el sistema, sale solo desde
// el servidor en unos segundos. Si no, se abre el WhatsApp de quien cobra con el
// mensaje y el enlace del PDF ya escritos (nunca sale por el número de otro proyecto).
export function EnviarWsp({ c, proyecto }) {
  const [numeroProyecto, setNumeroProyecto] = useState(undefined)   // undefined = averiguando · null = no tiene
  const [tel, setTel] = useState('')
  const [registrados, setRegistrados] = useState([])
  const [envio, setEnvio] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const tocado = useRef(false)
  const sirve = estaVivo(c) && !enCamino(c) && !!c.pdf_url && !esPrueba(c) && !c.motivo_baja

  useEffect(() => {
    if (!sirve) return
    let vivo = true
    celularesDe(c).then(l => { if (!vivo) return; setRegistrados(l); if (!tocado.current && l[0]) setTel(l[0]) })
    envioWsp(c.id).then(e => { if (vivo && e) setEnvio(e) })
    wspDelProyecto(c.project_id).then(n => { if (vivo) setNumeroProyecto(n) })
    return () => { vivo = false }
  }, [c.id, sirve])   // eslint-disable-line
  // mientras está saliendo se vuelve a mirar (el servidor lo manda en menos de medio minuto)
  const saliendo = envio?.wsp_estado === 'pendiente'
  useEffect(() => {
    if (!saliendo) return
    const t = setInterval(async () => { const e = await envioWsp(c.id); if (e) setEnvio(e) }, 3000)
    return () => clearInterval(t)
  }, [saliendo, c.id])
  if (!sirve) return null

  const numero = () => {
    const d = tel.replace(/\D/g, '')
    if (d.length < 9) { setErr('Escribe el celular: 9 dígitos.'); return null }
    return d
  }
  // desde el WhatsApp de quien cobra: se abre con el número, el mensaje y el enlace listos
  function abrir() {
    setErr('')
    const d = numero()
    if (d) window.open(enlaceWsp(d, textoComprobanteWsp(c, proyecto)), '_blank', 'noopener')
  }
  async function enviar() {
    setErr('')
    const d = numero()
    if (!d) return
    setBusy(true)
    try {
      const a = await enviarComprobanteWsp(c.id, d)
      setEnvio({ wsp_a: a, wsp_at: new Date().toISOString(), wsp_estado: 'pendiente', wsp_error: null })
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const demora = saliendo && envio.wsp_at && Date.now() - new Date(envio.wsp_at).getTime() > 90000
  const que = c.tipo === 'factura' ? 'la factura' : 'la boleta'
  return (
    <div className="cp-wsp">
      <p className="cp-sub">📲 Enviar {que} al cliente por WhatsApp</p>
      <div className="cp-wsp-fila">
        <input value={tel} inputMode="tel" placeholder="Celular (9 dígitos)" aria-label="Celular al que se envía"
          onChange={e => { tocado.current = true; setTel(e.target.value.replace(/[^\d+ ]/g, '').slice(0, 18)) }}
          onKeyDown={e => { if (e.key === 'Enter' && numeroProyecto !== undefined) (numeroProyecto ? enviar : abrir)() }} />
        {numeroProyecto
          ? <button type="button" className="btn-primary" onClick={enviar} disabled={busy || (saliendo && !demora)}>
              {busy ? 'Pidiendo…' : saliendo && !demora ? 'Enviando…' : envio?.wsp_estado === 'enviado' ? 'Enviar otra vez' : 'Enviar'}
            </button>
          : numeroProyecto === null && <button type="button" className="btn-primary" onClick={abrir}>Abrir WhatsApp</button>}
      </div>
      {registrados.length > 0
        ? <p className="muted small cp-wsp-reg">Registrado{registrados.length > 1 ? 's' : ''}: {registrados.map(n => (
            <button type="button" key={n} className={'link-btn' + (tel.replace(/\D/g, '').endsWith(n) ? ' on' : '')} onClick={() => { tocado.current = true; setTel(n) }}>{celularBonito(n)}</button>
          ))} · o escribe otro número.</p>
        : <p className="muted small cp-wsp-reg">El cliente no tiene celular en su ficha: escribe el número.</p>}
      {numeroProyecto
        ? <p className="muted small cp-wsp-reg">Sale solo, con el PDF adjunto, por el WhatsApp del proyecto ({celularBonito(numeroProyecto) || 'conectado'}). <button type="button" className="link-btn" onClick={abrir}>O mandarlo desde mi WhatsApp</button></p>
        : numeroProyecto === null && <p className="muted small cp-wsp-reg">Se abre tu WhatsApp con el mensaje y el enlace {c.tipo === 'factura' ? 'de la factura' : 'de la boleta'} ya escritos: solo falta presionar enviar.</p>}
      {err && <p className="error" style={{ textTransform: 'none', margin: '.3rem 0 0' }}>{err}</p>}
      {!err && saliendo && <p className="cp-busca">{!demora && <span className="cp-gira" />}{demora
        ? 'Está tardando más de lo normal: revisa que el WhatsApp del proyecto esté conectado. Se puede volver a enviar.'
        : 'Enviando a ' + celularBonito(envio.wsp_a) + '… sale en unos segundos.'}</p>}
      {!err && envio?.wsp_estado === 'enviado' && <p className="cp-busca ok">✓ Enviado a {celularBonito(envio.wsp_a)}{envio.wsp_at ? ' · ' + new Date(envio.wsp_at).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</p>}
      {!err && envio?.wsp_estado === 'fallido' && <p className="cp-busca no">No se pudo enviar a {celularBonito(envio.wsp_a)}: {envio.wsp_error || 'sin detalle'}.</p>}
    </div>
  )
}

// ---------------------------------------------------------------- emitir
// `grupo` es un depósito tal como lo arma agruparPagos (una cascada = varias
// cuotas con un voucher → una sola boleta con una línea por cuota).
export function EmitirComprobante({ grupo, proyecto, cliente, lote, totalCuotas, ventaId, onCerrar, onListo }) {
  const [tipo, setTipo] = useState('boleta')
  const docInicial = /^\d{8}$/.test(String(cliente?.doc_number || '')) ? '1' : cliente?.doc_type === 'CE' ? '4' : cliente?.doc_type === 'PASAPORTE' ? '7' : '0'
  const [b, setB] = useState({
    tipo_doc: docInicial, numero: docInicial === '0' ? '' : String(cliente?.doc_number || ''),
    nombre: cliente?.full_name || '', direccion: [cliente?.address, cliente?.district].filter(Boolean).join(', '),
  })
  const [f, setF] = useState({ numero: '', nombre: '', direccion: '' })
  const [lineas, setLineas] = useState(() => Object.fromEntries(grupo.items.map(p => [p.id, descripcionPago(p, lote, proyecto, totalCuotas)])))
  const [emisor, setEmisor] = useState(undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [pedido, setPedido] = useState(null)     // el comprobante, una vez pedido
  // el nombre que se trae solo al escribir el DNI (b) o el RUC (f)
  const [busca, setBusca] = useState({ b: null, f: null })
  const turnos = useRef({ b: 0, f: 0 })
  // ¿el nombre lo escribió la persona a mano? Si no (vino de la ficha o de una
  // consulta), al cambiar el documento se borra: que nunca quede el DNI de uno con
  // el nombre de otro.
  const aMano = useRef({ b: false, f: false })
  const total = grupo.items.reduce((s, p) => s + Number(p.amount || 0), 0)
  const items = useMemo(() => [...grupo.items].sort((x, y) => (x.installment?.installment_number || 0) - (y.installment?.installment_number || 0)), [grupo])

  useEffect(() => { emisorDelServidor(proyecto?.fact_ruc).then(setEmisor) }, [proyecto?.fact_ruc])

  // Desde la pantalla Pagos no viene la ficha del cliente: se busca por la venta y
  // se llena lo que la secretaria todavía no haya tocado.
  useEffect(() => {
    if (cliente || !ventaId) return
    let vivo = true
    Promise.all([
      supabase.from('sales').select('client:clients!sales_client_id_fkey(full_name, doc_type, doc_number, address, district)').eq('id', ventaId).maybeSingle(),
      supabase.from('installments').select('installment_number').eq('sale_id', ventaId).order('installment_number', { ascending: false }).limit(1),
    ]).then(([v, q]) => {
      if (!vivo) return
      const c = v.data?.client
      if (c) setB(x => x.numero || x.tipo_doc !== '0' ? x : {
        tipo_doc: /^\d{8}$/.test(String(c.doc_number || '')) ? '1' : c.doc_type === 'CE' ? '4' : '0',
        numero: /^PEND/i.test(String(c.doc_number || '')) ? '' : String(c.doc_number || ''),
        nombre: x.nombre || c.full_name || '', direccion: x.direccion || [c.address, c.district].filter(Boolean).join(', '),
      })
      const n = q.data?.[0]?.installment_number
      if (n) setLineas(x => Object.fromEntries(grupo.items.map(p => [p.id, x[p.id] === descripcionPago(p, lote, proyecto, null) ? descripcionPago(p, lote, proyecto, n) : x[p.id]])))
    })
    return () => { vivo = false }
  }, [ventaId])   // eslint-disable-line

  // Se escribe el DNI o el RUC y el nombre (o la razón social y el domicilio
  // fiscal) se llena solo. Si no se puede, queda para escribirlo a mano.
  async function traerNombre(cual, doc) {
    const turno = ++turnos.current[cual]
    const poner = cual === 'b' ? setB : setF
    setBusca(x => ({ ...x, [cual]: { estado: 'buscando' } }))
    const r = await consultarDoc(doc, { vivo: () => turnos.current[cual] === turno })
    if (turnos.current[cual] !== turno) return   // ya se escribió otro número
    if (r.ok) {
      // solo si el número sigue siendo el que se consultó
      poner(x => x.numero === doc ? { ...x, nombre: r.nombre, direccion: r.direccion || '' } : x)
      aMano.current[cual] = false
      setBusca(x => ({ ...x, [cual]: { estado: 'ok', fuente: r.fuente, situacion: r.situacion } }))
    } else setBusca(x => ({ ...x, [cual]: r.mensaje ? { estado: 'no', mensaje: r.mensaje } : null }))
  }
  function cambiarDni(valor) {
    const v = b.tipo_doc === '1' ? valor.replace(/\D/g, '').slice(0, 8) : valor
    setB(x => ({ ...x, numero: v, ...(v !== x.numero && !aMano.current.b ? { nombre: '', direccion: '' } : {}) }))
    turnos.current.b++
    if (b.tipo_doc === '1' && v.length === 8 && v !== b.numero) traerNombre('b', v)
    else setBusca(x => ({ ...x, b: null }))
  }
  function cambiarRuc(valor) {
    const v = valor.replace(/\D/g, '').slice(0, 11)
    setF(x => ({ ...x, numero: v, ...(v !== x.numero && !aMano.current.f ? { nombre: '', direccion: '' } : {}) }))
    turnos.current.f++
    if (rucValido(v) && v !== f.numero) traerNombre('f', v)
    else setBusca(x => ({ ...x, f: v.length === 11 && !rucValido(v) ? { estado: 'no', mensaje: 'Ese RUC no es válido: revisa los dígitos.' } : null }))
  }
  const buscando = busca.b?.estado === 'buscando' || busca.f?.estado === 'buscando'
  const notaBusqueda = q => !q ? null
    : q.estado === 'buscando' ? <span className="cp-busca"><span className="cp-gira" /> Buscando el nombre…</span>
    : q.estado === 'ok' ? <span className="cp-busca ok">✓ {q.fuente === 'cliente' ? 'Ya es cliente: datos de su ficha' : 'Datos de ' + q.fuente}</span>
    : <span className="cp-busca no">{q.mensaje}</span>

  // ya pedido: se mira hasta que salga (el servidor lo toma en segundos). El PDF se
  // arma un instante DESPUÉS de que SUNAT acepta: se sigue mirando un poco más para
  // que aparezca "Ver / imprimir" sin tener que cerrar y volver a abrir.
  const sinPdf = useRef(0)
  useEffect(() => {
    if (!pedido) return
    const faltaPdf = estaVivo(pedido) && !pedido.pdf_url && sinPdf.current < 20
    if (!enCamino(pedido) && !faltaPdf) return
    const t = setInterval(async () => {
      if (!enCamino(pedido)) sinPdf.current++
      const { data } = await supabase.from('comprobantes').select(COLS_COMPROBANTE).eq('id', pedido.id).maybeSingle()
      if (data) setPedido(data)
    }, 2000)
    return () => clearInterval(t)
  }, [pedido])
  useEffect(() => { if (pedido) onListo?.(pedido) }, [pedido?.estado, pedido?.pdf_url])   // eslint-disable-line

  function revisar() {
    if (tipo === 'factura') {
      if (!rucValido(f.numero)) return 'El RUC del cliente no es válido (11 dígitos).'
      if (f.nombre.trim().length < 3) return 'Falta la razón social del cliente.'
      return ''
    }
    if (b.nombre.trim().length < 3) return 'Falta el nombre del cliente.'
    if (b.tipo_doc === '1' && !/^\d{8}$/.test(b.numero.trim())) return 'El DNI tiene 8 dígitos.'
    if (['4', '7'].includes(b.tipo_doc) && b.numero.trim().length < 4) return 'Falta el número del documento.'
    if (b.tipo_doc === '0' && total > 700) return 'Una boleta de más de S/ 700 lleva el documento del cliente.'
    if (Object.values(lineas).some(t => !t.trim())) return 'Ninguna línea puede quedar sin descripción.'
    return ''
  }

  async function emitir() {
    const falta = revisar()
    setErr(falta)
    if (falta) return
    setBusy(true)
    try {
      const cli = tipo === 'factura'
        ? { tipo_doc: '6', numero: f.numero.trim(), nombre: f.nombre, direccion: f.direccion }
        : { tipo_doc: b.tipo_doc, numero: b.tipo_doc === '0' ? '' : b.numero.trim(), nombre: b.nombre, direccion: b.direccion }
      const id = await pedirComprobante({ pagos: grupo.items.map(p => p.id), tipo, cliente: cli, descripciones: lineas })
      const { data } = await supabase.from('comprobantes').select(COLS_COMPROBANTE).eq('id', id).maybeSingle()
      setPedido(data || { id, estado: 'pendiente', tipo, serie: '', numero: null })
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const sinServidor = emisor !== undefined && !emisorVisto(emisor)
  const enPrueba = emisorVisto(emisor) && emisor.ambiente === 'beta'
  const est = pedido ? (ESTADOS[pedido.estado] || ESTADOS.pendiente) : null

  return (
    <div className="modal-bg" onClick={busy ? undefined : onCerrar}>
      <div className="glass modal cp-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <b style={{ flex: 1 }}>🧾 {pedido ? 'Comprobante' : 'Emitir comprobante'} — {soles(total)}</b>
          <button className="btn-ghost" onClick={onCerrar} disabled={busy} aria-label="Cerrar">&#10005;</button>
        </div>
        <MarcaEmisor proyecto={proyecto} emisor={emisor} />

        {pedido ? (
          <div className="cp-resultado">
            <p className={'cp-grande ' + est.c}>
              {enCamino(pedido) && <span className="cp-gira" />}
              {pedido.tipo === 'factura' ? 'Factura' : 'Boleta'} {nombreComprobante(pedido)} — {est.t}
            </p>
            <p className="muted">{pedido.mensaje || est.ayuda}</p>
            {esPrueba(pedido) && <p className="cp-nota">Salió por el ambiente de <b>pruebas</b> de SUNAT: no tiene valor y no se pone como boleta del pago.</p>}
            <div className="acc-row" style={{ marginTop: 12 }}>
              {pedido.pdf_url && <a className="btn-primary btn-link" href={pedido.pdf_url} target="_blank" rel="noreferrer">📄 Ver / imprimir</a>}
              <button className="btn-ghost" onClick={onCerrar}>{enCamino(pedido) ? 'Cerrar (sigue saliendo solo)' : 'Cerrar'}</button>
            </div>
            <EnviarWsp c={pedido} proyecto={proyecto} />
          </div>
        ) : (
          <>
            {sinServidor && <p className="cp-nota">El facturador del servidor no está contestando{emisor?.error ? ' (' + emisor.error + ')' : emisor ? '' : ' o este RUC todavía no está cargado ahí'}. Puedes pedir el comprobante igual: queda en cola y sale solo cuando esté listo.</p>}
            {enPrueba && <p className="cp-nota">Este RUC está en el ambiente de <b>pruebas</b> de SUNAT: lo que se emita no tiene valor.</p>}

            <div className="cp-tipo">
              <button type="button" className={tipo === 'boleta' ? 'on' : ''} onClick={() => setTipo('boleta')}>Boleta<small>persona, con DNI</small></button>
              <button type="button" className={tipo === 'factura' ? 'on' : ''} onClick={() => setTipo('factura')}>Factura<small>empresa, con RUC</small></button>
            </div>

            {tipo === 'boleta' ? (
              <div className="form-grid">
                <label>Documento
                  <select value={b.tipo_doc} onChange={e => setB(x => ({ ...x, tipo_doc: e.target.value }))}>
                    {['1', '4', '7', '0'].map(k => <option key={k} value={k}>{TIPO_DOC[k]}</option>)}
                  </select>
                </label>
                <label>Número
                  <input value={b.tipo_doc === '0' ? '' : b.numero} disabled={b.tipo_doc === '0'} inputMode={b.tipo_doc === '1' ? 'numeric' : 'text'}
                    onChange={e => cambiarDni(e.target.value)} />
                  {notaBusqueda(busca.b)}
                </label>
                <label className="span2">A nombre de
                  <input value={b.nombre} onChange={e => { aMano.current.b = true; setB(x => ({ ...x, nombre: e.target.value })) }} />
                </label>
                <label className="span2">Dirección <span className="muted small">(opcional)</span>
                  <input value={b.direccion} onChange={e => setB(x => ({ ...x, direccion: e.target.value }))} />
                </label>
              </div>
            ) : (
              <div className="form-grid">
                <label>RUC del cliente
                  <input value={f.numero} inputMode="numeric" maxLength={11} placeholder="11 dígitos"
                    onChange={e => cambiarRuc(e.target.value)} />
                  {notaBusqueda(busca.f)}
                </label>
                <label>Razón social
                  <input value={f.nombre} onChange={e => { aMano.current.f = true; setF(x => ({ ...x, nombre: e.target.value })) }} />
                </label>
                <label className="span2">Domicilio fiscal <span className="muted small">(opcional)</span>
                  <input value={f.direccion} onChange={e => setF(x => ({ ...x, direccion: e.target.value }))} />
                </label>
                {busca.f?.estado === 'ok' && rucConProblema(busca.f.situacion) && (
                  <p className="cp-nota span2" style={{ margin: 0 }}>SUNAT tiene a este RUC como <b>{busca.f.situacion}</b>: una factura a su nombre puede salir rechazada.</p>
                )}
              </div>
            )}

            <p className="cp-sub">Detalle <span className="muted small">(así sale en el comprobante; se puede corregir)</span></p>
            {items.map(p => (
              <div className="cp-linea" key={p.id}>
                <input value={lineas[p.id] || ''} maxLength={240} onChange={e => setLineas(x => ({ ...x, [p.id]: e.target.value }))} />
                <b>{soles(p.amount)}</b>
              </div>
            ))}
            <div className="cp-linea cp-total"><span>Total, sin IGV</span><b>{soles(total)}</b></div>

            {err && <p className="error" style={{ textTransform: 'none' }}>{err}</p>}
            <div className="acc-row" style={{ marginTop: 12 }}>
              <button className="btn-primary" onClick={emitir} disabled={busy || buscando}>
                {busy ? 'Pidiendo…' : buscando ? 'Buscando el nombre…' : 'Emitir ' + tipo + ' por ' + soles(total)}
              </button>
              <button type="button" className="btn-ghost" onClick={onCerrar} disabled={busy}>Cancelar</button>
            </div>
            <p className="muted small" style={{ marginTop: 8, textTransform: 'none' }}>
              Una vez emitida no se corrige: si algo quedó mal, se anula y se emite otra.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- detalle
export function ComprobanteDetalle({ comprobante: inicial, proyecto, onCerrar, onCambio }) {
  const { esJefe } = useAuth()
  const [c, setC] = useState(inicial)
  const [busy, setBusy] = useState(false)
  const e = ESTADOS[c.estado] || ESTADOS.pendiente

  async function releer() {
    const { data } = await supabase.from('comprobantes').select(COLS_COMPROBANTE).eq('id', c.id).maybeSingle()
    if (data) { setC(data); onCambio?.(data) }
  }
  useEffect(() => {
    if (!enCamino(c)) return
    const t = setInterval(releer, 3000)
    return () => clearInterval(t)
  }, [c.estado])   // eslint-disable-line

  async function anular() {
    const motivo = await pedir('¿Por qué se anula ' + (c.tipo === 'factura' ? 'la factura ' : 'la boleta ') + nombreComprobante(c) + '?\n\n' +
      'El motivo va a SUNAT. Ejemplo: "error en el documento del cliente". El pago NO se borra: queda sin comprobante para emitirle otro.',
      { titulo: 'Anular comprobante', tipo: 'largo', obligatorio: true, peligro: true, aceptar: 'Anular' })
    if (motivo === null) return
    setBusy(true)
    try {
      const r = await anularComprobante(c.id, motivo)
      await releer()
      avisar(r === 'pedido' ? 'Anulación pedida. El servidor le informa la baja a SUNAT; en unos minutos (la boleta, con el resumen del día) figura como anulada.' : 'Comprobante anulado.', { tono: 'ok' })
    } catch (err) { avisar(err.message, { tono: 'error' }) }
    setBusy(false)
  }
  async function reintentar() {
    setBusy(true)
    try { await reintentarComprobante(c.id); await releer() } catch (err) { avisar(err.message, { tono: 'error' }) }
    setBusy(false)
  }

  // El pago (o los pagos, si fue una cascada) de este comprobante. Anular no borra el
  // pago: lo deja sin comprobante, libre para emitirle otro.
  const [pagos, setPagos] = useState(null)
  useEffect(() => {
    const ids = (c.items || []).map(i => i.pago_id).filter(Boolean)
    if (!ids.length) { setPagos([]); return }
    let vivo = true
    supabase.from('daily_income').select('id, date, amount, operation_number, voucher_url, lot:lots(id, mz, lt)').in('id', ids).order('date')
      .then(({ data }) => { if (vivo) setPagos(data || []) })
    return () => { vivo = false }
  }, [c.id])   // eslint-disable-line
  const lotePago = pagos?.find(p => p.lot)?.lot || null
  const sinValor = !estaVivo(c)

  const puedeAnular = esJefe && estaVivo(c) && !['emitiendo', 'por_anular'].includes(c.estado) && !c.motivo_baja
  return (
    <div className="modal-bg" onClick={busy ? undefined : onCerrar}>
      <div className="glass modal cp-modal" onClick={ev => ev.stopPropagation()}>
        <div className="modal-head">
          <b style={{ flex: 1 }}>🧾 {c.tipo === 'factura' ? 'Factura' : 'Boleta'} {nombreComprobante(c)}</b>
          <button className="btn-ghost" onClick={onCerrar} disabled={busy} aria-label="Cerrar">&#10005;</button>
        </div>
        {proyecto && <MarcaEmisor proyecto={proyecto} />}
        <p className={'cp-grande ' + e.c}>{enCamino(c) && <span className="cp-gira" />}{e.t}{esPrueba(c) ? ' · PRUEBA sin valor' : ''}</p>
        <p className="muted" style={{ textTransform: 'none' }}>{c.mensaje || e.ayuda}</p>
        {c.motivo_baja && c.estado !== 'anulado' && <p className="cp-nota">Anulación pedida: “{c.motivo_baja}”.</p>}
        <div className="cp-datos">
          <span>Fecha</span><b>{fechaPe(c.fecha_emision)}</b>
          <span>A nombre de</span><b>{c.cliente_nombre}</b>
          <span>{TIPO_DOC[c.cliente_tipo_doc] || 'Documento'}</span><b>{c.cliente_numero || '—'}</b>
          <span>Total</span><b>{soles(c.total)}</b>
        </div>
        {(c.items || []).map((it, i) => (
          <div className="cp-linea" key={i}><span>{it.descripcion}</span><b>{soles(it.monto)}</b></div>
        ))}
        {pagos && (
          <div className="cp-pago">
            <p className="cp-sub">💵 El pago de {c.tipo === 'factura' ? 'esta factura' : 'esta boleta'}{lotePago ? ' · lote ' + lotePago.mz + '-' + lotePago.lt : ''}</p>
            {pagos.length === 0
              ? <p className="muted small">El pago ya no está en el sistema (fue borrado).</p>
              : pagos.map(p => (
                <div className="cp-linea" key={p.id}>
                  <span>{fechaPe(p.date)} · operación {p.operation_number || '—'}{p.voucher_url && <> · <a href={p.voucher_url} target="_blank" rel="noreferrer">voucher</a></>}</span>
                  <b>{soles(p.amount)}</b>
                </div>
              ))}
            <p className="muted small" style={{ margin: '.4rem 0 0' }}>
              {c.estado === 'por_anular' || (c.motivo_baja && c.estado !== 'anulado')
                ? 'Se está anulando. Cuando SUNAT confirme la baja, el pago queda sin comprobante y se le puede emitir otro.'
                : sinValor
                  ? 'Este comprobante ya no vale: el pago quedó sin comprobante y se le puede emitir otro.'
                  : 'Si se anula, el pago NO se borra: queda sin comprobante y se le emite otro. Mientras tenga comprobante, el pago no se puede borrar ni cambiar de monto.'}
              {lotePago && <> <Link to={'/lotes/' + lotePago.id + '?tab=pagos'} onClick={onCerrar}>{sinValor ? 'Emitir otro desde la ficha del lote' : 'Ver el pago en la ficha del lote'} →</Link></>}
            </p>
          </div>
        )}
        <div className="acc-row" style={{ marginTop: 14 }}>
          {c.pdf_url && <a className="btn-primary btn-link" href={c.pdf_url} target="_blank" rel="noreferrer">📄 Ver / imprimir</a>}
          {c.xml_url && <a className="btn-ghost btn-link" href={c.xml_url} target="_blank" rel="noreferrer" title="El archivo firmado: es el comprobante de verdad">XML</a>}
          {c.cdr_url && <a className="btn-ghost btn-link" href={c.cdr_url} target="_blank" rel="noreferrer" title="La constancia de recepción de SUNAT">Constancia</a>}
          {c.estado === 'error' && <button className="btn-ghost" onClick={reintentar} disabled={busy}>↻ Reintentar ahora</button>}
          {puedeAnular && <button className="btn-ghost cp-anular" onClick={anular} disabled={busy}>Anular</button>}
        </div>
        <EnviarWsp c={c} proyecto={proyecto} />
      </div>
    </div>
  )
}
