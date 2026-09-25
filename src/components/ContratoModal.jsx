import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Logo from './Logo'
import { soles } from '../lib/pagos'
import { MESES, fechaPe, letras, detalleCuotas, DEFAULT_TEMPLATE, COLS_VENTA_CONTRATO } from '../lib/contrato'

// **negrita** dentro de una linea de la plantilla
const conNegritas = t => t.split(/(\*\*[^*]+\*\*)/g).map((x, i) => (/^\*\*[^*]+\*\*$/.test(x) ? <b key={i}>{x.slice(2, -2)}</b> : x))

// El contrato de UNA venta, armado con la plantilla de su proyecto, listo para
// revisar, corregir a mano e imprimir. Lo abren la pantalla de Contratos y la
// ficha del lote (fase 3): trae todo lo que necesita con el id de la venta.
export default function ContratoModal({ saleId, onClose }) {
  const [gen, setGen] = useState(null)          // la venta
  const [proyecto, setProyecto] = useState(null)
  const [data, setData] = useState(null)
  const [editDoc, setEditDoc] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data: v, error: e } = await supabase.from('sales').select(COLS_VENTA_CONTRATO).eq('id', saleId).single()
      if (!vivo) return
      if (e || !v) { setError('No se pudo cargar la venta: ' + (e?.message || 'no existe')); return }
      const [p, inst, sep, acct] = await Promise.all([
        supabase.from('projects').select('*').eq('id', v.lot.project_id).single(),
        supabase.from('installments').select('installment_number, due_date, amount, status').eq('sale_id', v.id).order('installment_number'),
        v.separation_id
          ? supabase.from('separations').select('amount, date').eq('id', v.separation_id).single()
          : Promise.resolve({ data: null }),
        supabase.from('financial_accounts').select('*').eq('project_id', v.lot.project_id).eq('active', true),
      ])
      if (!vivo) return
      setGen(v); setProyecto(p.data || {})
      setData({ inst: inst.data || [], sep: sep.data, accts: acct.data || [] })
    })()
    return () => { vivo = false }
  }, [saleId])

  if (error || !gen || !data) return (
    <div className="modal-bg" onClick={onClose}>
      <div className="glass modal" onClick={e => e.stopPropagation()}>
        <p className={error ? 'error' : 'muted'}>{error || 'Armando el contrato…'}</p>
        <button className="btn-ghost" onClick={onClose}>Cerrar</button>
      </div>
    </div>
  )

  const hoy = new Date()
  const c = gen.client || {}
  const l = gen.lot || {}
  const p = proyecto || {}
  const b = l.boundaries || {}
  const med = b.medidas || {}
  const col = b.colindancias || {}
  const banco = data.accts.find(a => a.type === 'bank' && a.account_number) || data.accts[0] || {}
  const domicilio = [c.address, c.district, c.province, c.department].filter(Boolean).join(', ') || '____________________'
  const persona = x => `${x.full_name}, de nacionalidad ${String(x.nationality || 'peruana').toLowerCase()}, identificado/a con ${x.doc_type || 'DNI'} N° ${x.doc_number}`
  const compradores = persona(c) + (gen.co_client ? `, y ${persona(gen.co_client)}` : '')

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
    SEPARACION_LETRAS: letras(Number(data.sep?.amount || 0)),
    SEPARACION_FECHA: fechaPe(data.sep?.date),
    INICIAL: soles(gen.initial_amount_paid), INICIAL_LETRAS: letras(Number(gen.initial_amount_paid || 0)),
    FECHA_VENTA: fechaPe(gen.sale_date),
    SALDO: soles(gen.financed_amount), SALDO_LETRAS: letras(Number(gen.financed_amount || 0)),
    NUM_CUOTAS: gen.installments_count,
    CUOTA: soles(gen.monthly_amount), CUOTAS_DETALLE: detalleCuotas(data.inst),
    PRIMERA_CUOTA: fechaPe(data.inst[0]?.due_date),
    PAGADO_FIRMA: soles(Number(data.sep?.amount || 0) + Number(gen.initial_amount_paid || 0)),
    ASESOR: gen.advisor?.full_name || gen.advisor?.code || '__________',
    MORA: Number(p.late_penalty_rate || 1.5).toFixed(2),
    PARTIDA: p.partida_number || '__________',
    DIA: hoy.getDate(), MES: MESES[hoy.getMonth()], ANIO: hoy.getFullYear(),
  }
  const fill = t => t.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] !== undefined ? String(vars[k]) : m)

  const TablaLote = (
    <table className="ctable" key="tl"><tbody>
      <tr><td><b>Manzana</b></td><td>{l.mz}</td></tr>
      <tr><td><b>Lote</b></td><td>{l.lt}</td></tr>
      <tr><td><b>Área aproximada</b></td><td>{l.area_m2} m²</td></tr>
      <tr><td><b>Frente</b></td><td>{med.frente || '-'} colinda con {col.frente || '-'}</td></tr>
      <tr><td><b>Derecha</b></td><td>{med.derecha || '-'} colinda con {col.derecha || '-'}</td></tr>
      <tr><td><b>Izquierda</b></td><td>{med.izquiera || med.izquierda || '-'} colinda con {col.izquiera || col.izquierda || '-'}</td></tr>
      <tr><td><b>Fondo</b></td><td>{med.fondo || '-'} colinda con {col.fondo || '-'}</td></tr>
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
        ______________________________<br /><b>EL COMPRADOR</b><br />{c.full_name}<br />{c.doc_type || 'DNI'}: {c.doc_number}
        {gen.co_client && (<><br /><br />______________________________<br /><b>EL COMPRADOR (2)</b><br />{gen.co_client.full_name}<br />{gen.co_client.doc_type || 'DNI'}: {gen.co_client.doc_number}</>)}
      </td>
      <td style={{ textAlign: 'center', paddingTop: '4em' }}>
        ______________________________<br /><b>EL VENDEDOR</b><br />{vars.VENDEDOR}<br />DNI: {vars.VENDEDOR_DNI}
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
  // el cronograma como en los contratos modelo: cuota, numero, monto, dia, mes y año
  const TablaCronograma = (
    <table className="ctable" key="tcr">
      <thead><tr><th>CUOTA</th><th>Nº</th><th>MONTO</th><th>DÍA</th><th>MES</th><th>AÑO</th></tr></thead>
      <tbody>
        {data.inst.map(i => {
          const [y, m, d] = String(i.due_date || '').split('-')
          return (
            <tr key={i.installment_number}>
              <td>Cuota</td><td>{i.installment_number}</td><td>{soles(i.amount)}</td>
              <td>{Number(d) || '-'}</td><td>{(MESES[Number(m) - 1] || '-').toUpperCase()}</td><td>{y || '-'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
  const SaltoPagina = <div key="sp" style={{ pageBreakBefore: 'always', breakBefore: 'page' }} />
  const BLOQ = { TABLA_LOTE: TablaLote, TABLA_CUENTA: TablaCuenta, TABLA_CRONOGRAMA: TablaCronograma, FIRMAS: Firmas, ANEXO_CRONOGRAMA: Anexo1, ANEXO_FICHA: Anexo2, SALTO_PAGINA: SaltoPagina }

  // Como se lee la plantilla (cada proyecto tiene la suya):
  //   · {{BLOQUE}} solo en su linea        -> tabla automatica o salto de pagina
  //   · lineas que empiezan con "|"        -> tabla escrita en la plantilla
  //     (una fila "|---|---|" marca la de arriba como encabezado)
  //   · {{SI_SEPARACION}} / {{SI_CO_COMPRADOR}} al inicio -> la linea sale
  //     solo si la venta tuvo separacion / co-comprador
  //   · CLAUSULA... / ANEXO...             -> titulo;  **texto** -> negrita
  const tpl = p.contract_template || DEFAULT_TEMPLATE
  const lineas = []
  for (const ln of tpl.split('\n')) {
    let t = ln.trim()
    if (!t) continue
    if (t.startsWith('{{SI_SEPARACION}}')) { if (!data.sep) continue; t = t.slice(17).trim() }
    if (t.startsWith('{{SI_CO_COMPRADOR}}')) { if (!gen.co_client) continue; t = t.slice(19).trim() }
    lineas.push(t)
  }
  const cuerpo = []
  let primera = true
  for (let i = 0; i < lineas.length; i++) {
    const t = lineas[i]
    if (t.startsWith('|')) {
      const filas = []
      while (i < lineas.length && lineas[i].startsWith('|')) filas.push(lineas[i++])
      i--
      const celdas = f => f.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const esSeparador = f => /^\|?\s*:?-{2,}/.test(f)
      const conEncabezado = filas.length > 1 && esSeparador(filas[1])
      const cuerpoT = filas.filter((f, k) => !(conEncabezado && k === 1)).map(celdas)
      const [enc, ...resto] = conEncabezado ? cuerpoT : [null, ...cuerpoT]
      cuerpo.push(
        <table className="ctable" key={'t' + i}>
          {enc && <thead><tr>{enc.map((c, k) => <th key={k}>{conNegritas(fill(c))}</th>)}</tr></thead>}
          <tbody>{resto.map((f, r) => (
            <tr key={r}>{f.map((c, k) => <td key={k}>{k === 0 && !enc ? <b>{conNegritas(fill(c))}</b> : conNegritas(fill(c))}</td>)}</tr>
          ))}</tbody>
        </table>
      )
      continue
    }
    const mb = t.match(/^\{\{(\w+)\}\}$/)
    if (mb && BLOQ[mb[1]]) { cuerpo.push(<div key={i}>{BLOQ[mb[1]]}</div>); continue }
    if (primera) { primera = false; cuerpo.push(<h2 key={i} style={{ textAlign: 'center' }}>{conNegritas(fill(t))}</h2>); continue }
    if (/^(CLAUSULA|CLÁUSULA|ANEXO)/i.test(t)) { cuerpo.push(<h3 key={i}>{conNegritas(fill(t))}</h3>); continue }
    cuerpo.push(<p key={i}>{conNegritas(fill(t))}</p>)
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="glass modal print-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head no-print">
          <h2>Contrato - {c.full_name}</h2>
          <button className="btn-ghost" onClick={() => setEditDoc(!editDoc)}>{editDoc ? '✔ TERMINAR EDICIÓN' : '✎ EDITAR TEXTO'}</button>
          {puedeFirmar && <button className="btn-primary" onClick={() => { setEditDoc(false); setTimeout(() => window.print(), 100) }}>Imprimir / PDF</button>}
          <button className="btn-ghost" onClick={onClose}>&#10005;</button>
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
}
