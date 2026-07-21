import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Logo from '../components/Logo'
import { useProject, ProjectPicker } from '../context/ProjectContext'

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

function letras(num) {
  const U = ['','UNO','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE','DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISEIS','DIECISIETE','DIECIOCHO','DIECINUEVE','VEINTE']
  const D = ['','','VEINTI','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA']
  const C = ['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS']
  function tres(n) {
    if (n === 0) return ''
    if (n === 100) return 'CIEN'
    let s = C[Math.floor(n / 100)]
    const r = n % 100
    if (r === 0) return s
    if (s) s += ' '
    if (r <= 20) return s + U[r]
    const d = Math.floor(r / 10), u = r % 10
    if (d === 2) return s + 'VEINTI' + (u ? U[u] : '')
    return s + D[d] + (u ? ' Y ' + U[u] : '')
  }
  const entero = Math.floor(num)
  const cent = Math.round((num - entero) * 100)
  let out = ''
  const millones = Math.floor(entero / 1000000)
  const miles = Math.floor((entero % 1000000) / 1000)
  const resto = entero % 1000
  if (millones) out += (millones === 1 ? 'UN MILLON' : tres(millones) + ' MILLONES') + ' '
  if (miles) out += (miles === 1 ? 'MIL' : tres(miles) + ' MIL') + ' '
  out += tres(resto)
  if (!out.trim()) out = 'CERO'
  return out.trim() + ' CON ' + String(cent).padStart(2, '0') + '/100'
}

const VARIABLES = ['PROYECTO','VENDEDOR','VENDEDOR_DNI','VENDEDOR_DOMICILIO','COMPRADORES','COMPRADOR_DOMICILIO','MZ','LT','AREA','PRECIO','PRECIO_LETRAS','SEPARACION','SEPARACION_FECHA','INICIAL','FECHA_VENTA','SALDO','NUM_CUOTAS','CUOTA','MORA','PARTIDA','DIA','MES','ANIO']
const BLOQUES = ['TABLA_LOTE','TABLA_CUENTA','FIRMAS','ANEXO_CRONOGRAMA','ANEXO_FICHA']

const DEFAULT_TEMPLATE = `CONTRATO PRIVADO DE COMPROMISO DE COMPRAVENTA DE LOTE EN HABILITACION URBANA PROGRESIVA CON RESERVA DE PROPIEDAD

Conste por el presente instrumento privado el Contrato de Compromiso de Compraventa de Lote en Habilitacion Urbana Progresiva, con Reserva de Propiedad, que celebran de una parte:
EL VENDEDOR: {{VENDEDOR}}, identificada con DNI N. {{VENDEDOR_DNI}}, con domicilio en {{VENDEDOR_DOMICILIO}}, a quien en adelante se denominara EL VENDEDOR; y de la otra parte:
EL COMPRADOR: {{COMPRADORES}}, con domicilio en {{COMPRADOR_DOMICILIO}}, a quien en adelante se denominara EL COMPRADOR.
Las partes celebran el presente contrato bajo los terminos y condiciones siguientes:

CLAUSULA PRIMERA: ANTECEDENTES DEL PREDIO Y DEL PROYECTO
1.1. EL VENDEDOR declara tener derechos suficientes sobre el predio matriz inscrito en la Partida N. {{PARTIDA}} del Registro de Predios, sobre el cual se desarrolla la Habilitacion Urbana Progresiva denominada "{{PROYECTO}}" (en adelante, EL PROYECTO).
1.2. Las partes reconocen que el presente contrato no constituye, por si solo, licencia de habilitacion urbana, titulo individual independizado ni transferencia definitiva inscrita. Su finalidad es reservar y comprometer la futura transferencia del lote descrito en este contrato.

CLAUSULA SEGUNDA: OBJETO DEL CONTRATO Y DESCRIPCION DEL LOTE
2.1. Por el presente contrato, EL VENDEDOR otorga a favor de EL COMPRADOR la separacion, reserva y compromiso de futura transferencia del lote identificado como:
{{TABLA_LOTE}}
2.2. Las medidas y linderos indicados son referenciales y estan sujetos a los ajustes tecnicos, municipales y registrales que resulten del expediente aprobado y de la independizacion definitiva.

CLAUSULA TERCERA: PRECIO Y FORMA DE PAGO
3.1. El precio total del lote se fija en la suma de {{PRECIO}} ({{PRECIO_LETRAS}} SOLES), que EL COMPRADOR pagara asi: Separacion: {{SEPARACION}}, pagada en fecha {{SEPARACION_FECHA}}. Inicial: {{INICIAL}}, pagada en fecha {{FECHA_VENTA}}. Saldo financiado: {{SALDO}}, en {{NUM_CUOTAS}} cuotas mensuales de {{CUOTA}}, conforme al cronograma del Anexo 1.
3.2. Los pagos se realizaran mediante deposito o transferencia a la cuenta designada por EL VENDEDOR:
{{TABLA_CUENTA}}
3.3. EL COMPRADOR se obliga a remitir el comprobante de pago dentro de los tres (3) dias habiles siguientes al deposito, por el canal oficial.

CLAUSULA CUARTA: MORA, COBRANZA Y REPROGRAMACION
4.1. Las cuotas se pagan en las fechas del Anexo 1, con plazo de gracia de cinco (5) dias habiles. Vencido dicho plazo, se devengara una penalidad moratoria de S/ {{MORA}} por cada dia calendario de atraso, hasta la fecha efectiva de pago.

CLAUSULA QUINTA: INCUMPLIMIENTO Y RESOLUCION
5.1. Constituyen causales de incumplimiento grave: no pagar dos (2) cuotas consecutivas o tres (3) acumuladas; negarse a regularizar documentos; realizar construcciones u ocupaciones no autorizadas; ceder o revender derechos sin autorizacion escrita; usar el lote para fines incompatibles. El procedimiento de notificaciones formales y resolucion se rige por el modelo integral del proyecto.

CLAUSULA SEXTA: RESERVA DE PROPIEDAD
6.1. Al amparo del articulo 1583 del Codigo Civil, las partes pactan reserva de propiedad a favor de EL VENDEDOR hasta que EL COMPRADOR haya pagado la totalidad del precio y conceptos pendientes, y se encuentre habilitada la documentacion legal y registral para la transferencia definitiva.

— El presente documento incorpora por referencia las demas clausulas del modelo integral de contrato del proyecto, que las partes declaran conocer. —

CLAUSULA FINAL: ACEPTACION
Leido el presente contrato por las partes y encontrandolo conforme a su voluntad, lo suscriben por duplicado en la ciudad de Pucallpa, a los {{DIA}} dias del mes de {{MES}} de {{ANIO}}.
{{FIRMAS}}

{{ANEXO_CRONOGRAMA}}
{{ANEXO_FICHA}}`

export default function Contracts() {
  const { role } = useAuth()
  const { pidOp } = useProject()
  const [proyecto, setProyecto] = useState(null)
  const [ventas, setVentas] = useState([])
  const [q, setQ] = useState('')
  const [gen, setGen] = useState(null)
  const [editDoc, setEditDoc] = useState(false)
  const [data, setData] = useState(null)
  const [msg, setMsg] = useState(null)
  const [tplOpen, setTplOpen] = useState(false)
  const [tplText, setTplText] = useState('')

  async function load() {
    if (!pidOp) return
    const [v, p] = await Promise.all([
      supabase.from('sales')
        .select('id, total_sale_price, initial_amount_paid, financed_amount, installments_count, monthly_amount, sale_date, status, signed_contract_url, contract_note, extra_docs, separation_id, client:clients!sales_client_id_fkey(*), co_client:clients!sales_co_client_id_fkey(*), lot:lots!inner(id, mz, lt, area_m2, boundaries, project_id)')
        .eq('lot.project_id', pidOp).in('status', ['en_proceso', 'pagado'])
        .order('sale_date', { ascending: false }),
      supabase.from('projects').select('*').eq('id', pidOp).single(),
    ])
    setVentas(v.data || []); setProyecto(p.data || null)
    setTplText((p.data?.contract_template) || DEFAULT_TEMPLATE)
  }
  useEffect(() => { load() }, [pidOp])

  useEffect(() => {
    if (!gen) { setData(null); return }
    async function loadData() {
      const [inst, sep, acct] = await Promise.all([
        supabase.from('installments').select('installment_number, due_date, amount, status').eq('sale_id', gen.id).order('installment_number'),
        gen.separation_id
          ? supabase.from('separations').select('amount, date').eq('id', gen.separation_id).single()
          : Promise.resolve({ data: null }),
        supabase.from('financial_accounts').select('*').eq('project_id', pidOp).eq('active', true),
      ])
      setData({ inst: inst.data || [], sep: sep.data, accts: acct.data || [] })
    }
    loadData()
  }, [gen])

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return ventas
    return ventas.filter(v =>
      (v.client?.full_name || '').toLowerCase().includes(t) ||
      `${v.lot?.mz}-${v.lot?.lt}`.toLowerCase().includes(t))
  }, [ventas, q])

  async function subirFirmado(v, file) {
    // todo documento se sube con su nota/comentario. Si ya habia contrato, esto lo REEMPLAZA.
    const reemplaza = !!v.signed_contract_url
    const nota = prompt(
      (reemplaza ? '⚠ REEMPLAZANDO el contrato firmado actual por este archivo nuevo.\n\n' : '') +
      'Comentario / nota de este contrato (opcional, Enter para saltar):\n\nEj: firmado con poder · falta legalizar · copia escaneada que mando el cliente',
      v.contract_note || '')
    if (nota === null) return   // cancelo: no se sube nada
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
    const path = `contratos/${v.lot.mz}-${v.lot.lt}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('urbis-files').upload(path, file, { upsert: true })
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    const url = supabase.storage.from('urbis-files').getPublicUrl(path).data.publicUrl
    await supabase.from('sales').update({ signed_contract_url: url, contract_note: nota.trim() || null }).eq('id', v.id)
    setMsg({ ok: true, t: 'CONTRATO FIRMADO SUBIDO' }); load()
  }

  // quitar el contrato firmado (superusuario): la venta vuelve a figurar SIN CONTRATO
  async function quitarContrato(v) {
    if (!confirm('¿Quitar el contrato firmado de ' + (v.client?.full_name || 'esta venta') + '?\n\nLa venta volvera a figurar como SIN CONTRATO FIRMADO y podras subir otro. El archivo anterior queda en el almacenamiento.')) return
    const { error } = await supabase.from('sales').update({ signed_contract_url: null, contract_note: null }).eq('id', v.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setMsg({ ok: true, t: 'CONTRATO QUITADO — YA PUEDES SUBIR OTRO' }); load()
  }

  // editar/agregar la nota de un contrato ya subido
  async function notaContrato(v) {
    const nota = prompt('Comentario / nota de este contrato:', v.contract_note || '')
    if (nota === null) return
    const { error } = await supabase.from('sales').update({ contract_note: nota.trim() || null }).eq('id', v.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setMsg({ ok: true, t: 'NOTA DEL CONTRATO GUARDADA' }); load()
  }

  // ---- documentos de respaldo (máx 2 por contrato): traspaso, iniciales, adenda… ----
  const docsDe = v => Array.isArray(v.extra_docs) ? v.extra_docs : []
  async function subirDocExtra(v, file) {
    const docs = docsDe(v)
    if (docs.length >= 2) { setMsg({ ok: false, t: 'MÁXIMO 2 documentos de respaldo por contrato.' }); return }
    const nota = prompt('¿Qué documento es? (etiqueta corta)\n\nEj: TRASPASO · DOCUMENTO DE INICIALES · ADENDA · CARTA DE COMPROMISO', '')
    if (nota === null) return
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
    const path = `contratos/respaldo/${v.lot.mz}-${v.lot.lt}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('urbis-files').upload(path, file, { upsert: true })
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    const url = supabase.storage.from('urbis-files').getPublicUrl(path).data.publicUrl
    const next = [...docs, { url, note: (nota.trim() || 'Documento de respaldo') }]
    const { error: e2 } = await supabase.from('sales').update({ extra_docs: next }).eq('id', v.id)
    if (e2) { setMsg({ ok: false, t: 'ERROR: ' + e2.message }); return }
    setMsg({ ok: true, t: 'DOCUMENTO DE RESPALDO SUBIDO' }); load()
  }
  async function quitarDocExtra(v, idx) {
    const docs = docsDe(v)
    if (!confirm('¿Quitar "' + (docs[idx]?.note || 'este documento') + '"?\n\n(El archivo queda en el almacenamiento.)')) return
    const next = docs.filter((_, i) => i !== idx)
    const { error } = await supabase.from('sales').update({ extra_docs: next }).eq('id', v.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setMsg({ ok: true, t: 'DOCUMENTO QUITADO' }); load()
  }
  async function notaDocExtra(v, idx) {
    const docs = [...docsDe(v)]
    if (!docs[idx]) return
    const nota = prompt('¿Qué documento es? (etiqueta corta)', docs[idx].note || '')
    if (nota === null) return
    docs[idx] = { ...docs[idx], note: (nota.trim() || 'Documento de respaldo') }
    const { error } = await supabase.from('sales').update({ extra_docs: docs }).eq('id', v.id)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setMsg({ ok: true, t: 'ETIQUETA GUARDADA' }); load()
  }

  async function guardarPlantilla() {
    const { error } = await supabase.from('projects').update({ contract_template: tplText }).eq('id', pidOp)
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: 'PLANTILLA GUARDADA PARA ESTE PROYECTO' })
    load()
  }

  const hoy = new Date()
  const sinFirmar = ventas.filter(v => !v.signed_contract_url).length

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Contratos</h1>
        <ProjectPicker />
        {role === 'superuser' && (
          <button className="btn-ghost" onClick={() => setTplOpen(!tplOpen)}>
            {tplOpen ? 'Cerrar plantilla' : 'Plantilla del contrato (superusuario)'}
          </button>
        )}
      </div>

      {tplOpen && role === 'superuser' && (
        <div className="glass form-card" style={{ maxWidth: 'none' }}>
          <p><b>PLANTILLA DEL CONTRATO — {proyecto?.name}</b></p>
          <p className="muted small">
            Cada proyecto tiene su propia plantilla. Escribe el texto libremente y usa variables entre dobles llaves.
            Lineas que empiezan con "CLAUSULA" o "ANEXO" salen como titulos.
          </p>
          <p className="small">VARIABLES: {VARIABLES.map(v => <code key={v} className="tok">{'{{' + v + '}}'}</code>)}</p>
          <p className="small">BLOQUES (tablas automaticas, en linea propia): {BLOQUES.map(v => <code key={v} className="tok tok2">{'{{' + v + '}}'}</code>)}</p>
          <textarea rows="22" value={tplText} spellCheck="false"
            style={{ textTransform: 'none', fontFamily: 'monospace', fontSize: '.85rem' }}
            onChange={e => setTplText(e.target.value)} />
          <div>
            <button className="btn-primary" onClick={guardarPlantilla}>Guardar plantilla</button>{' '}
            <button className="btn-ghost" onClick={() => setTplText(DEFAULT_TEMPLATE)}>Restaurar plantilla base</button>
          </div>
        </div>
      )}

      <div className="toolbar">
        <input className="search" placeholder="Buscar por cliente o lote..." value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {sinFirmar > 0 && <p className="hint"><span className="bad">&#9888; {sinFirmar} venta(s) sin contrato firmado subido.</span></p>}
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Lote</th><th>Cliente</th><th>Precio</th><th>Fecha venta</th><th>Contrato firmado</th><th></th></tr></thead>
          <tbody>
            {filtradas.map(v => (
              <tr key={v.id}>
                <td>{v.lot?.mz}-{v.lot?.lt}</td>
                <td>{v.client?.full_name}{v.co_client ? <span className="muted"> + {v.co_client.full_name}</span> : ''}</td>
                <td>{soles(v.total_sale_price)}</td>
                <td>{v.sale_date}</td>
                <td>
                  {v.signed_contract_url
                    ? <>
                        <a href={v.signed_contract_url} target="_blank" rel="noreferrer" className="ok">VER FIRMADO</a>{' '}
                        <button className="link-btn" onClick={() => notaContrato(v)}>&#128221; nota</button>
                        {role === 'superuser' && (<>
                          {' '}
                          <label className="link-btn" style={{ cursor: 'pointer' }}>&#128260; reemplazar
                            <input type="file" accept="image/*,.pdf" hidden onChange={e => e.target.files[0] && subirFirmado(v, e.target.files[0])} />
                          </label>{' '}
                          <button className="link-btn" onClick={() => quitarContrato(v)}>&#128465; quitar</button>
                        </>)}
                        {v.contract_note && <div className="muted small" style={{ textTransform: 'none' }}>{v.contract_note}</div>}
                      </>
                    : <label className="upload-btn bad">&#9888; subir firmado
                        <input type="file" accept="image/*,.pdf" hidden onChange={e => e.target.files[0] && subirFirmado(v, e.target.files[0])} />
                      </label>}
                  {/* documentos de respaldo del contrato (traspaso, iniciales, adenda…): máx 2 */}
                  <div style={{ marginTop: 6, borderTop: '1px dashed rgba(255,255,255,.12)', paddingTop: 5 }}>
                    {docsDe(v).map((d, i) => (
                      <div key={i} className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', textTransform: 'none', marginBottom: 2 }}>
                        <span>📎</span>
                        <a href={d.url} target="_blank" rel="noreferrer" className="ok">{d.note || 'Respaldo'}</a>
                        <button className="link-btn" title="Editar etiqueta" onClick={() => notaDocExtra(v, i)}>&#9998;</button>
                        {role === 'superuser' && <button className="link-btn" title="Quitar" onClick={() => quitarDocExtra(v, i)}>&#128465;</button>}
                      </div>
                    ))}
                    {docsDe(v).length < 2 && (
                      <label className="link-btn" style={{ cursor: 'pointer' }} title="Traspaso, documento de iniciales, adenda, etc.">
                        &#10133; documento de respaldo
                        <input type="file" accept="image/*,.pdf" hidden onChange={e => e.target.files[0] && subirDocExtra(v, e.target.files[0])} />
                      </label>
                    )}
                  </div>
                </td>
                <td><button className="btn-ghost" onClick={() => setGen(v)}>Generar contrato</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {gen && data && (() => {
        const c = gen.client || {}
        const l = gen.lot || {}
        const p = proyecto || {}
        const b = l.boundaries || {}
        const med = b.medidas || {}
        const col = b.colindancias || {}
        const banco = data.accts.find(a => a.type === 'bank' && a.account_number) || data.accts[0] || {}
        const domicilio = [c.address, c.district, c.province, c.department].filter(Boolean).join(', ') || '____________________'
        const compradores = `${c.full_name}, identificado/a con ${c.doc_type} N. ${c.doc_number}` +
          (gen.co_client ? `, y ${gen.co_client.full_name}, identificado/a con ${gen.co_client.doc_type} N. ${gen.co_client.doc_number}` : '')

        const hoyStr = new Date().toISOString().slice(0, 10)
        const problemas = []
        if (!p.copia_literal_url) problemas.push('FALTA SUBIR LA PARTIDA REGISTRAL (Proyectos > Editar)')
        else if (!p.copia_literal_expiry || p.copia_literal_expiry < hoyStr) problemas.push('LA PARTIDA REGISTRAL ESTA VENCIDA O SIN FECHA DE VIGENCIA')
        if (p.carta_poder_url && (!p.poder_expiry || p.poder_expiry < hoyStr)) problemas.push('LA VIGENCIA DE PODER ESTA VENCIDA O SIN FECHA')
        const puedeFirmar = problemas.length === 0

        const vars = {
          PROYECTO: p.name || '', VENDEDOR: p.titular_name || 'URBIS GROUP',
          VENDEDOR_DNI: p.titular_dni || '__________',
          VENDEDOR_DOMICILIO: p.office_address || '____________________',
          COMPRADORES: compradores, COMPRADOR_DOMICILIO: domicilio,
          MZ: l.mz, LT: l.lt, AREA: l.area_m2,
          PRECIO: soles(gen.total_sale_price), PRECIO_LETRAS: letras(Number(gen.total_sale_price)),
          SEPARACION: data.sep ? soles(data.sep.amount) : 'S/ 0.00',
          SEPARACION_FECHA: data.sep?.date || '-',
          INICIAL: soles(gen.initial_amount_paid), FECHA_VENTA: gen.sale_date,
          SALDO: soles(gen.financed_amount), NUM_CUOTAS: gen.installments_count,
          CUOTA: soles(gen.monthly_amount), MORA: Number(p.late_penalty_rate || 1.5).toFixed(2),
          PARTIDA: p.partida_number || '__________',
          DIA: hoy.getDate(), MES: MESES[hoy.getMonth()], ANIO: hoy.getFullYear(),
        }
        const fill = t => t.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] !== undefined ? String(vars[k]) : m)

        const TablaLote = (
          <table className="ctable" key="tl"><tbody>
            <tr><td><b>Manzana</b></td><td>{l.mz}</td></tr>
            <tr><td><b>Lote</b></td><td>{l.lt}</td></tr>
            <tr><td><b>Area aproximada</b></td><td>{l.area_m2} m2</td></tr>
            <tr><td><b>Frente</b></td><td>{med.frente || '-'} colindando con {col.frente || '-'}</td></tr>
            <tr><td><b>Derecha</b></td><td>{med.derecha || '-'} colindando con {col.derecha || '-'}</td></tr>
            <tr><td><b>Izquierda</b></td><td>{med.izquiera || med.izquierda || '-'} colindando con {col.izquiera || col.izquierda || '-'}</td></tr>
            <tr><td><b>Fondo</b></td><td>{med.fondo || '-'} colindando con {col.fondo || '-'}</td></tr>
          </tbody></table>
        )
        const TablaCuenta = (
          <table className="ctable" key="tc"><tbody>
            <tr><td><b>Banco</b></td><td>{banco.name || '-'}</td></tr>
            <tr><td><b>N. de cuenta</b></td><td>{banco.account_number || '-'}</td></tr>
            <tr><td><b>CCI</b></td><td>{banco.cci || '-'}</td></tr>
            <tr><td><b>Titular</b></td><td>{banco.holder_name || vars.VENDEDOR}</td></tr>
            <tr><td><b>WhatsApp oficial</b></td><td>{p.titular_phone || '-'}</td></tr>
          </tbody></table>
        )
        const Firmas = (
          <table className="ctable firmas" key="fi"><tbody><tr>
            <td style={{ textAlign: 'center', paddingTop: '4em' }}>
              ______________________________<br /><b>EL COMPRADOR</b><br />{c.full_name}<br />{c.doc_type} N. {c.doc_number}
              {gen.co_client && (<><br /><br />______________________________<br /><b>EL COMPRADOR (2)</b><br />{gen.co_client.full_name}<br />{gen.co_client.doc_type} N. {gen.co_client.doc_number}</>)}
            </td>
            <td style={{ textAlign: 'center', paddingTop: '4em' }}>
              ______________________________<br /><b>EL VENDEDOR</b><br />{vars.VENDEDOR}<br />DNI N. {vars.VENDEDOR_DNI}
            </td>
          </tr></tbody></table>
        )
        const Anexo1 = (
          <div key="a1">
            <h3 style={{ pageBreakBefore: 'always' }}>ANEXO 1: CRONOGRAMA DE PAGOS</h3>
            <table className="ctable">
              <thead><tr><th>N.</th><th>Concepto</th><th>Monto</th><th>Vencimiento</th><th>Estado</th></tr></thead>
              <tbody>
                {data.sep && <tr><td>-</td><td>Separacion</td><td>{soles(data.sep.amount)}</td><td>{data.sep.date}</td><td>PAGADA</td></tr>}
                <tr><td>-</td><td>Inicial</td><td>{soles(gen.initial_amount_paid)}</td><td>{gen.sale_date}</td><td>PAGADA</td></tr>
                {data.inst.map(i => (
                  <tr key={i.installment_number}>
                    <td>{i.installment_number}</td>
                    <td>Cuota N. {String(i.installment_number).padStart(2, '0')}</td>
                    <td>{soles(i.amount)}</td>
                    <td>{i.due_date}</td>
                    <td>{i.status === 'pagado' ? 'PAGADA' : '[  ]'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        const Anexo2 = (
          <div key="a2">
            <h3 style={{ pageBreakBefore: 'always' }}>ANEXO 2: FICHA TECNICA DE H.U.P. Y CALIDAD DE OBRAS</h3>
            <table className="ctable">
              <thead><tr><th>Componente</th><th>Estado proyectado</th><th>Condicion</th></tr></thead>
              <tbody>
                <tr><td>Naturaleza del proyecto</td><td>Habilitacion Urbana Progresiva</td><td>Sujeta a expediente y aprobacion municipal</td></tr>
                <tr><td>Modalidad de licencia</td><td>C/D segun expediente</td><td>Determina la autoridad competente</td></tr>
                <tr><td>Tipo de obras</td><td>Tipo E o equivalente tecnico</td><td>No implica asfalto ni vereda completa</td></tr>
                <tr><td>Vias</td><td>Apertura y afirmado/enripiado por etapas</td><td>Conforme al diseno tecnico</td></tr>
                <tr><td>Aceras/veredas</td><td>Diseno o ejecucion progresiva</td><td>Conforme a secciones viales aprobadas</td></tr>
                <tr><td>Solucion sanitaria</td><td>Pozo septico (opcion biodigestor)</td><td>Segun clausula del modelo integral</td></tr>
                <tr><td>Energia electrica</td><td>Publica y domiciliaria</td><td>Conforme a factibilidad</td></tr>
              </tbody>
            </table>
          </div>
        )
        const BLOQ = { TABLA_LOTE: TablaLote, TABLA_CUENTA: TablaCuenta, FIRMAS: Firmas, ANEXO_CRONOGRAMA: Anexo1, ANEXO_FICHA: Anexo2 }

        const tpl = p.contract_template || DEFAULT_TEMPLATE
        const lineas = tpl.split('\n')
        let primera = true
        const cuerpo = lineas.map((ln, i) => {
          const t = ln.trim()
          if (!t) return null
          const mb = t.match(/^\{\{(\w+)\}\}$/)
          if (mb && BLOQ[mb[1]]) return <div key={i}>{BLOQ[mb[1]]}</div>
          if (primera) { primera = false; return <h2 key={i} style={{ textAlign: 'center' }}>{fill(t)}</h2> }
          if (/^(CLAUSULA|CLÁUSULA|ANEXO)/i.test(t)) return <h3 key={i}>{fill(t)}</h3>
          return <p key={i}>{fill(t)}</p>
        })

        return (
          <div className="modal-bg" onClick={() => { setGen(null); setEditDoc(false) }}>
            <div className="glass modal print-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-head no-print">
                <h2>Contrato - {c.full_name}</h2>
                <button className="btn-ghost" onClick={() => setEditDoc(!editDoc)}>{editDoc ? '✔ TERMINAR EDICIÓN' : '✎ EDITAR TEXTO'}</button>
                {puedeFirmar && <button className="btn-primary" onClick={() => { setEditDoc(false); setTimeout(() => window.print(), 100) }}>Imprimir / PDF</button>}
                <button className="btn-ghost" onClick={() => { setGen(null); setEditDoc(false) }}>&#10005;</button>
              </div>
              {!puedeFirmar && (
                <div className="chg-box no-print">
                  <p className="bad"><b>&#9940; NO SE PUEDE FIRMAR ESTE CONTRATO:</b></p>
                  {problemas.map((x, i) => <p key={i} className="bad">&#8226; {x}</p>)}
                  <p className="muted small">Regulariza los documentos legales en PROYECTOS &#8594; EDITAR y vuelve a generar.</p>
                </div>
              )}
              {editDoc && <p className="no-print" style={{ color: '#e0b34c', fontSize: 12, margin: '0 0 8px' }}>✎ MODO EDICIÓN: haz clic sobre el texto y corrige lo que necesites. Los cambios aplican a esta impresión.</p>}
              <div className="print-area contract" contentEditable={editDoc} suppressContentEditableWarning
                style={editDoc ? { outline: '2px dashed #e0b34c', outlineOffset: 4 } : undefined}>
                <div className="contract-head" contentEditable={false}>
                  {p.logo_url
                    ? <img src={p.logo_url} alt="logo" style={{ height: 64, width: 'auto', maxWidth: 180, objectFit: 'contain' }} />
                    : <Logo size={64} />}
                  <div>
                    <div className="ch-name">URBIS GROUP REAL ESTATE</div>
                    <div className="ch-sub">{(p.name || 'GESTIÓN INMOBILIARIA').toUpperCase()} — PUCALLPA, UCAYALI</div>
                  </div>
                </div>
                {cuerpo}
                <p style={{ textAlign: 'center' }}>Pucallpa, Ucayali, Peru — {hoy.getFullYear()}</p>
              </div>
            </div>
          </div>
        )
      })()}
    </>
  )
}
