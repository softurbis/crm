import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useProject, ProjectPicker } from '../context/ProjectContext'

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

// numero a letras (soles)
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

export default function Contracts() {
  const { pidOp, current, projects } = useProject()
  const proj = current || projects.find(p => p.id === pidOp)
  const [ventas, setVentas] = useState([])
  const [q, setQ] = useState('')
  const [gen, setGen] = useState(null)   // venta a generar
  const [data, setData] = useState(null) // datos completos del contrato
  const [msg, setMsg] = useState(null)

  async function load() {
    if (!pidOp) return
    const { data } = await supabase.from('sales')
      .select('id, total_sale_price, initial_amount_paid, financed_amount, installments_count, monthly_amount, sale_date, status, signed_contract_url, separation_id, client:clients!sales_client_id_fkey(*), co_client:clients!sales_co_client_id_fkey(*), lot:lots!inner(id, mz, lt, area_m2, boundaries, project_id)')
      .eq('lot.project_id', pidOp).in('status', ['en_proceso', 'pagado'])
      .order('sale_date', { ascending: false })
    setVentas(data || [])
  }
  useEffect(() => { load() }, [pidOp])

  useEffect(() => {
    if (!gen) { setData(null); return }
    async function loadData() {
      const [inst, sep, acct, pr] = await Promise.all([
        supabase.from('installments').select('installment_number, due_date, amount, status').eq('sale_id', gen.id).order('installment_number'),
        gen.separation_id
          ? supabase.from('separations').select('amount, date').eq('id', gen.separation_id).single()
          : Promise.resolve({ data: null }),
        supabase.from('financial_accounts').select('*').eq('project_id', pidOp).eq('active', true),
        supabase.from('projects').select('*').eq('id', pidOp).single(),
      ])
      setData({ inst: inst.data || [], sep: sep.data, accts: acct.data || [], proyecto: pr.data })
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
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
    const path = `contratos/${v.lot.mz}-${v.lot.lt}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('urbis-files').upload(path, file, { upsert: true })
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    const url = supabase.storage.from('urbis-files').getPublicUrl(path).data.publicUrl
    await supabase.from('sales').update({ signed_contract_url: url }).eq('id', v.id)
    setMsg({ ok: true, t: 'CONTRATO FIRMADO SUBIDO' }); load()
  }

  const hoy = new Date()
  const sinFirmar = ventas.filter(v => !v.signed_contract_url).length

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Contratos</h1>
        <ProjectPicker />
      </div>

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
                    ? <a href={v.signed_contract_url} target="_blank" rel="noreferrer" className="ok">VER FIRMADO</a>
                    : <label className="upload-btn bad">&#9888; subir firmado
                        <input type="file" accept="image/*,.pdf" hidden onChange={e => e.target.files[0] && subirFirmado(v, e.target.files[0])} />
                      </label>}
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
        const p = data.proyecto || {}
        const b = l.boundaries || {}
        const med = b.medidas || {}
        const col = b.colindancias || {}
        const banco = data.accts.find(a => a.type === 'bank' && a.account_number) || data.accts[0] || {}
        const domicilio = [c.address, c.district, c.province, c.department].filter(Boolean).join(', ') || '____________________'
        const sepMonto = data.sep ? soles(data.sep.amount) : 'S/ 0.00'
        const sepFecha = data.sep?.date || '-'
        const vendNombre = p.titular_name || 'URBIS GROUP'
        const vendDni = p.titular_dni || '__________'
        const vendDom = p.office_address || 'Jr. Progreso N. 163, distrito de Calleria, provincia de Coronel Portillo, departamento de Ucayali'
        const nProy = p.name || 'LAS PRADERAS DE CASHIBO'
        const hoyStr = new Date().toISOString().slice(0, 10)
        const problemas = []
        if (!p.copia_literal_url) problemas.push('FALTA SUBIR LA PARTIDA REGISTRAL (Proyectos > Editar)')
        else if (!p.copia_literal_expiry || p.copia_literal_expiry < hoyStr) problemas.push('LA PARTIDA REGISTRAL ESTA VENCIDA O SIN FECHA DE VIGENCIA')
        if (p.carta_poder_url && (!p.poder_expiry || p.poder_expiry < hoyStr)) problemas.push('LA VIGENCIA DE PODER ESTA VENCIDA O SIN FECHA')
        const puedeFirmar = problemas.length === 0
        return (
          <div className="modal-bg" onClick={() => setGen(null)}>
            <div className="glass modal print-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-head no-print">
                <h2>Contrato - {c.full_name}</h2>
                {puedeFirmar && <button className="btn-primary" onClick={() => window.print()}>Imprimir / PDF</button>}
                <button className="btn-ghost" onClick={() => setGen(null)}>&#10005;</button>
              </div>

              {!puedeFirmar && (
                <div className="chg-box no-print">
                  <p className="bad"><b>&#9940; NO SE PUEDE FIRMAR ESTE CONTRATO:</b></p>
                  {problemas.map((x, i) => <p key={i} className="bad">&#8226; {x}</p>)}
                  <p className="muted small">Regulariza los documentos legales en PROYECTOS &#8594; EDITAR y vuelve a generar.</p>
                </div>
              )}
              <div className="print-area contract">
                <h2 style={{ textAlign: 'center' }}>CONTRATO PRIVADO DE COMPROMISO DE COMPRAVENTA DE LOTE EN HABILITACIÓN URBANA PROGRESIVA CON RESERVA DE PROPIEDAD</h2>
                <p>Conste por el presente instrumento privado el Contrato de Compromiso de Compraventa de Lote en Habilitación Urbana Progresiva, con Reserva de Propiedad, que celebran de una parte:</p>
                <p><b>EL VENDEDOR:</b> {vendNombre}, identificada con DNI N.° {vendDni}, con domicilio en {vendDom}, a quien en adelante se denominará EL VENDEDOR; y de la otra parte:</p>
                <p><b>EL COMPRADOR:</b> {c.full_name}, identificado/a con {c.doc_type} N.° {c.doc_number}{gen.co_client ? <>, y {gen.co_client.full_name}, identificado/a con {gen.co_client.doc_type} N.° {gen.co_client.doc_number}</> : null}, con domicilio en {domicilio}, a quien{gen.co_client ? 'es' : ''} en adelante se {gen.co_client ? 'les denominará conjuntamente' : 'denominará'} EL COMPRADOR.</p>
                <p>Las partes celebran el presente contrato bajo los términos y condiciones siguientes:</p>

                <h3>CLÁUSULA PRIMERA: ANTECEDENTES DEL PREDIO Y DEL PROYECTO</h3>
                <p>1.1. EL VENDEDOR declara tener derechos suficientes sobre el predio matriz denominado "FINCA NATALIA", Sector Cashibo Cocha, UU.CC. 037936, con un área matriz aproximada de 8.2544 hectáreas (82,544 m²), ubicado en el distrito de Yarinacocha, provincia de Coronel Portillo, departamento de Ucayali, inscrito en la Partida N.° 11139962 del Registro de Predios de la Zona Registral N.° VI – Sede Pucallpa.</p>
                <p>1.2. Sobre el predio matriz se viene desarrollando la Habilitación Urbana Progresiva denominada "{nProy}" (en adelante, EL PROYECTO), la cual comprende la lotización, apertura de vías, ejecución progresiva de obras de habilitación urbana, obtención de autorizaciones, recepción de obras, independización y futura transferencia de lotes resultantes, conforme a la normativa aplicable.</p>
                <p>1.3. Las partes reconocen que el presente contrato no constituye, por sí solo, licencia de habilitación urbana, título individual independizado ni transferencia definitiva inscrita. Su finalidad es reservar y comprometer la futura transferencia del lote descrito en este contrato, dentro del proceso de formalización y ejecución de EL PROYECTO.</p>

                <h3>CLÁUSULA CUARTA: OBJETO DEL CONTRATO Y DESCRIPCIÓN DEL LOTE</h3>
                <p>4.1. Por el presente contrato, EL VENDEDOR otorga a favor de EL COMPRADOR la separación, reserva y compromiso de futura transferencia del lote identificado como:</p>
                <table className="ctable">
                  <tbody>
                    <tr><td><b>Manzana</b></td><td>{l.mz}</td></tr>
                    <tr><td><b>Lote</b></td><td>{l.lt}</td></tr>
                    <tr><td><b>Área aproximada</b></td><td>{l.area_m2} m²</td></tr>
                    <tr><td><b>Frente</b></td><td>{med.frente || '-'} colindando con {col.frente || '-'}</td></tr>
                    <tr><td><b>Derecha</b></td><td>{med.derecha || '-'} colindando con {col.derecha || '-'}</td></tr>
                    <tr><td><b>Izquierda</b></td><td>{med.izquiera || med.izquierda || '-'} colindando con {col.izquiera || col.izquierda || '-'}</td></tr>
                    <tr><td><b>Fondo</b></td><td>{med.fondo || '-'} colindando con {col.fondo || '-'}</td></tr>
                  </tbody>
                </table>
                <p>4.2. Las medidas y linderos indicados son referenciales y están sujetos a los ajustes técnicos, municipales y registrales que resulten del expediente aprobado y de la independización definitiva.</p>

                <h3>CLÁUSULA QUINTA: PRECIO, FORMA DE PAGO Y DESTINO DE LOS INGRESOS</h3>
                <p>5.1. El precio total del lote materia del presente contrato se fija en la suma de {soles(gen.total_sale_price)} ({letras(Number(gen.total_sale_price))} SOLES), que EL COMPRADOR pagará de la siguiente manera:</p>
                <p style={{ marginLeft: '2em' }}>
                  • Separación: {sepMonto}, pagada en fecha {sepFecha}.<br />
                  • Inicial: {soles(gen.initial_amount_paid)}, pagada en fecha {gen.sale_date}.<br />
                  • Saldo financiado: {soles(gen.financed_amount)}, en {gen.installments_count} cuotas mensuales de {soles(gen.monthly_amount)}, conforme al cronograma del Anexo 1.
                </p>
                <p>5.2. Los pagos se realizarán mediante depósito o transferencia bancaria a la cuenta designada por EL VENDEDOR:</p>
                <table className="ctable">
                  <tbody>
                    <tr><td><b>Banco</b></td><td>{banco.name || '-'}</td></tr>
                    <tr><td><b>N.° de cuenta</b></td><td>{banco.account_number || '-'}</td></tr>
                    <tr><td><b>CCI</b></td><td>{banco.cci || '-'}</td></tr>
                    <tr><td><b>Titular</b></td><td>{banco.holder_name || vendNombre}</td></tr>
                    <tr><td><b>WhatsApp oficial</b></td><td>{p.titular_phone || '-'}</td></tr>
                  </tbody>
                </table>
                <p>5.3. EL COMPRADOR se obliga a remitir el comprobante de pago dentro de los tres (3) días hábiles siguientes al depósito o transferencia mediante el canal oficial.</p>

                <h3>CLÁUSULA SEXTA: MORA, COBRANZA Y REPROGRAMACIÓN</h3>
                <p>6.1. Las cuotas deberán pagarse en las fechas establecidas en el Anexo 1. EL COMPRADOR tendrá un plazo de gracia de cinco (5) días hábiles. Vencido dicho plazo, se devengará una penalidad moratoria de S/ {Number(p.late_penalty_rate || 1.5).toFixed(2)} por cada día calendario de atraso, hasta la fecha efectiva de pago.</p>

                <h3>CLÁUSULA SÉPTIMA: INCUMPLIMIENTO Y RESOLUCIÓN</h3>
                <p>7.1. Constituyen causales de incumplimiento grave: no pagar dos (2) cuotas consecutivas o tres (3) acumuladas; negarse a regularizar documentos; realizar construcciones u ocupaciones no autorizadas; ceder o revender derechos sin autorización escrita; usar el lote para fines incompatibles. El procedimiento de notificaciones formales y resolución se rige por el modelo integral del proyecto.</p>

                <h3>CLÁUSULA OCTAVA: RESERVA DE PROPIEDAD</h3>
                <p>8.1. Al amparo del artículo 1583 del Código Civil, las partes pactan reserva de propiedad a favor de EL VENDEDOR hasta que EL COMPRADOR haya pagado la totalidad del precio y conceptos pendientes, y se encuentre habilitada la documentación legal y registral para la transferencia definitiva.</p>

                <p className="muted-print">— El presente resumen impreso incorpora por referencia las cláusulas segunda, tercera, novena a decimonovena del modelo integral de contrato del proyecto, que las partes declaran conocer. —</p>

                <h3>CLÁUSULA VIGÉSIMA: ACEPTACIÓN FINAL</h3>
                <p>Leído que fue el presente contrato por las partes y encontrándolo conforme a su voluntad, lo suscriben por duplicado en la ciudad de Pucallpa, a los {hoy.getDate()} días del mes de {MESES[hoy.getMonth()]} de {hoy.getFullYear()}.</p>

                <table className="ctable firmas">
                  <tbody>
                    <tr>
                      <td style={{ textAlign: 'center', paddingTop: '4em' }}>
                        ______________________________<br />
                        <b>EL COMPRADOR</b><br />
                        {c.full_name}<br />
                        {c.doc_type} N.° {c.doc_number}
                        {gen.co_client && (<><br /><br />______________________________<br />
                        <b>EL COMPRADOR (2)</b><br />
                        {gen.co_client.full_name}<br />
                        {gen.co_client.doc_type} N.° {gen.co_client.doc_number}</>)}
                      </td>
                      <td style={{ textAlign: 'center', paddingTop: '4em' }}>
                        ______________________________<br />
                        <b>EL VENDEDOR</b><br />
                        {vendNombre}<br />
                        DNI N.° {vendDni}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p style={{ textAlign: 'center' }}>Pucallpa, Ucayali, Perú — {hoy.getFullYear()}</p>

                <h3 style={{ pageBreakBefore: 'always' }}>ANEXO 1: CRONOGRAMA DE PAGOS</h3>
                <table className="ctable">
                  <thead><tr><th>N.°</th><th>Concepto</th><th>Monto</th><th>Vencimiento</th><th>Estado</th></tr></thead>
                  <tbody>
                    {data.sep && <tr><td>-</td><td>Separación</td><td>{sepMonto}</td><td>{sepFecha}</td><td>PAGADA</td></tr>}
                    <tr><td>-</td><td>Inicial</td><td>{soles(gen.initial_amount_paid)}</td><td>{gen.sale_date}</td><td>PAGADA</td></tr>
                    {data.inst.map(i => (
                      <tr key={i.installment_number}>
                        <td>{i.installment_number}</td>
                        <td>Cuota N.° {String(i.installment_number).padStart(2, '0')}</td>
                        <td>{soles(i.amount)}</td>
                        <td>{i.due_date}</td>
                        <td>{i.status === 'pagado' ? 'PAGADA' : '[  ]'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <h3 style={{ pageBreakBefore: 'always' }}>ANEXO 2: FICHA TÉCNICA DE H.U.P. Y CALIDAD DE OBRAS</h3>
                <table className="ctable">
                  <thead><tr><th>Componente</th><th>Estado proyectado</th><th>Condición</th></tr></thead>
                  <tbody>
                    <tr><td>Naturaleza del proyecto</td><td>Habilitación Urbana Progresiva</td><td>Sujeta a expediente y aprobación municipal</td></tr>
                    <tr><td>Modalidad de licencia</td><td>C/D según expediente</td><td>Determina la autoridad competente</td></tr>
                    <tr><td>Tipo de obras</td><td>Tipo E o equivalente técnico</td><td>No implica asfalto ni vereda completa</td></tr>
                    <tr><td>Vías</td><td>Apertura y afirmado/enripiado por etapas</td><td>Conforme al diseño técnico</td></tr>
                    <tr><td>Aceras/veredas</td><td>Diseño o ejecución progresiva</td><td>Conforme a secciones viales aprobadas</td></tr>
                    <tr><td>Solución sanitaria</td><td>Pozo séptico (opción biodigestor)</td><td>Según cláusula décima del modelo integral</td></tr>
                    <tr><td>Energía eléctrica</td><td>Pública y domiciliaria</td><td>Conforme a factibilidad</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )
      })()}
    </>
  )
}
