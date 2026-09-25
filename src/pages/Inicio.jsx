import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useProject, ProjectPicker } from '../context/ProjectContext'
import BuscarLote from '../components/BuscarLote'
import { useEsCelular } from '../lib/useEsCelular'
import { soles } from '../lib/pagos'
import { hoyPeru, fechaPe } from '../lib/lotes'

const r2 = n => Math.round(Number(n) * 100) / 100
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre']
const masDias = (f, n) => { const d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)

async function todas(hacer) {
  const out = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await hacer().range(desde, desde + 999)
    if (error) { out.fallo = error.message; break }
    if (!data?.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

// WhatsApp de cobro de una deuda vencida (el mismo tono que el de la ficha)
function waCobro({ nombre, phone, lote, n, deuda }) {
  const tel = String(phone || '').replace(/\D/g, '')
  if (tel.length < 9) return null
  const primer = String(nombre || '').split(' ')[0] || ''
  const texto = `Hola ${primer}, le saludamos de Urbis Group. Su lote *${lote}* tiene *${n} cuota${n > 1 ? 's' : ''} vencida${n > 1 ? 's' : ''}* por *${soles(deuda)}*. Puede pagar por transferencia o depósito y enviarnos el voucher por aquí. ¡Gracias!`
  return `https://wa.me/${tel.length === 9 ? '51' + tel : tel}?text=${encodeURIComponent(texto)}`
}

// "Hoy" (fase 3, 25 sep 2026): donde entra la secretaria. Arriba el buscador
// para atender a quien llega; abajo lo urgente del dia, cada cosa con un clic a
// su ficha: separaciones por vencer, cuotas vencidas y por vencer, pagos a los
// que les falta la boleta o el voucher, y sus tareas.
export default function Inicio() {
  const { profile } = useAuth()
  const { projects, pid } = useProject()
  const irA = useNavigate()
  const esCelular = useEsCelular()
  const hoy = hoyPeru()
  const ids = useMemo(() => (pid === 'general' ? projects.map(p => p.id) : [pid]).filter(Boolean), [pid, projects])
  const clave = ids.join(',')
  const nombreProy = id => projects.find(p => p.id === id)?.name || ''
  const varios = ids.length > 1
  const [d, setD] = useState(null)
  const [ver, setVer] = useState({ vencidas: false, docs: false })

  useEffect(() => {
    if (!ids.length) return
    let vivo = true
    setD(null)
    ;(async () => {
      const en3 = masDias(hoy, 3), hace45 = masDias(hoy, -45)
      const [seps, venc, prox, sinDoc, nSinComp, nSinVou, sec] = await Promise.all([
        todas(() => supabase.from('separations')
          .select('id, amount, date, expiration_date, extended_until, lot_id, client:clients(full_name, phone), lot:lots!inner(mz, lt, project_id)')
          .in('lot.project_id', ids).eq('status', 'vigente').order('id')),
        todas(() => supabase.from('installments')
          .select('id, installment_number, amount, amount_paid, due_date, sale_id, sales!inner(status, lot_id, client:clients!sales_client_id_fkey(full_name, phone), lot:lots!inner(mz, lt, project_id))')
          .neq('status', 'pagado').lt('due_date', hoy).eq('sales.status', 'en_proceso').in('sales.lot.project_id', ids).order('id')),
        todas(() => supabase.from('installments')
          .select('id, installment_number, amount, amount_paid, due_date, sales!inner(status, lot_id, client:clients!sales_client_id_fkey(full_name, phone), lot:lots!inner(mz, lt, project_id))')
          .neq('status', 'pagado').gte('due_date', hoy).lte('due_date', en3).eq('sales.status', 'en_proceso').in('sales.lot.project_id', ids).order('id')),
        // pagos de las ultimas 6 semanas a los que les falta un documento
        supabase.from('daily_income')
          .select('id, date, amount, income_type, lot_id, voucher_url, receipt_url, voucher_na, receipt_na, operation_number, lot:lots(mz, lt), client:clients(full_name), installment:installments(installment_number)')
          .in('project_id', ids).gte('date', hace45).or('receipt_url.is.null,voucher_url.is.null')
          .order('date', { ascending: false }).limit(300),
        supabase.from('daily_income').select('id', { count: 'exact', head: true })
          .in('project_id', ids).is('receipt_url', null).or('receipt_na.is.null,receipt_na.eq.false'),
        supabase.from('daily_income').select('id', { count: 'exact', head: true })
          .in('project_id', ids).is('voucher_url', null).or('voucher_na.is.null,voucher_na.eq.false'),
        supabase.from('secretaries').select('id').eq('user_id', profile?.id || '').maybeSingle(),
      ])
      let tareas = []
      if (sec.data?.id) {
        const { data } = await supabase.from('secretary_tasks').select('id, title, time, slot, status, cancelada')
          .eq('secretary_id', sec.data.id).eq('date', hoy).order('time', { nullsFirst: true })
        tareas = (data || []).filter(t => !t.cancelada && !['hecha', 'no_hecha'].includes(t.status))
      }
      if (!vivo) return

      // separaciones: vencidas y las que vencen en 3 dias
      const separaciones = seps.map(s => {
        const lim = s.extended_until || s.expiration_date
        return { ...s, lim, dias: lim ? diasEntre(hoy, lim) : null }
      }).filter(s => s.dias !== null && s.dias <= 3).sort((a, b) => a.dias - b.dias)

      // cuotas vencidas EN VIVO (fecha pasada + saldo), agrupadas por venta
      const porVenta = new Map()
      for (const q of venc) {
        const debe = r2(Number(q.amount) - Number(q.amount_paid))
        if (debe <= 2) continue
        const v = porVenta.get(q.sale_id) || { sale_id: q.sale_id, lot_id: q.sales.lot_id, lot: q.sales.lot, client: q.sales.client, n: 0, deuda: 0, desde: q.due_date }
        v.n++; v.deuda = r2(v.deuda + debe); if (q.due_date < v.desde) v.desde = q.due_date
        porVenta.set(q.sale_id, v)
      }
      const vencidas = [...porVenta.values()].map(v => ({ ...v, atraso: diasEntre(v.desde, hoy) }))
        .sort((a, b) => b.atraso - a.atraso)

      const proximas = prox.map(q => ({ ...q, debe: r2(Number(q.amount) - Number(q.amount_paid)) }))
        .filter(q => q.debe > 0.009).sort((a, b) => a.due_date.localeCompare(b.due_date))

      const docs = (sinDoc.data || [])
        .map(p => ({ ...p, faltaVoucher: !p.voucher_url && !p.voucher_na, faltaComp: !p.receipt_url && !p.receipt_na }))
        .filter(p => p.faltaVoucher || p.faltaComp)

      setD({
        separaciones, vencidas, proximas, docs, tareas,
        deudaTotal: r2(vencidas.reduce((s, v) => s + v.deuda, 0)),
        nSinComp: nSinComp.count ?? null, nSinVou: nSinVou.count ?? null,
        incompleto: [venc, prox, seps].some(x => x.fallo) || !!sinDoc.error,
      })
    })()
    return () => { vivo = false }
  }, [clave])

  const fecha = new Date(hoy + 'T12:00:00')
  const titulo = `${DIAS[fecha.getDay()]} ${fecha.getDate()} de ${MESES[fecha.getMonth()]}`
  const loteTxt = (lot, pidLote) => `Mz ${lot?.mz} Lt ${lot?.lt}${varios && pidLote ? ' · ' + nombreProy(pidLote) : ''}`
  const LIM = 12

  return (
    <div className="hoy">
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Hoy <span className="muted hoy-fecha">· {titulo}</span></h1>
        <ProjectPicker withGeneral generalLabel="TODOS MIS PROYECTOS" />
      </div>

      {/* ---- la puerta de entrada: a quien se atiende ---- */}
      <div className="glass hoy-buscar">
        <p className="fl-lbl" style={{ margin: '0 0 6px' }}>¿A quién atiendes? Escribe el lote, el nombre, el DNI o el celular</p>
        <BuscarLote autoFocus={!esCelular} proyectos={ids} placeholder="Ej: G7 · Juan Pérez · 45678912 · 987654321" />
        <p className="small" style={{ margin: '8px 0 0' }}><Link to="/lotes">&#128506; Abrir el mapa de lotes</Link></p>
      </div>

      {!d && <p className="muted">Buscando lo urgente del día…</p>}
      {d?.incompleto && <p className="warn small">&#9888; Parte de la información no llegó (el servidor tardó). Recarga la página.</p>}

      {d && (
        <div className="hoy-grid">
          {/* ---- separaciones ---- */}
          <div className="glass fl-card">
            <h3>&#128278; Separaciones que vencen <span className="hoy-n">{d.separaciones.length}</span></h3>
            {!d.separaciones.length && <p className="muted small">Ninguna vence en los próximos 3 días.</p>}
            {d.separaciones.map(s => (
              <button key={s.id} className="hoy-fila" onClick={() => irA('/lotes/' + s.lot_id)}>
                <span className="hoy-lote">{loteTxt(s.lot, s.lot.project_id)}</span>
                <span className="hoy-quien">{s.client?.full_name || '—'} · separó {soles(s.amount)}</span>
                <span className={s.dias < 0 ? 'bad' : s.dias <= 1 ? 'warn' : 'muted'}>
                  {s.dias < 0 ? `VENCIDA hace ${-s.dias} día${s.dias < -1 ? 's' : ''}` : s.dias === 0 ? 'vence HOY' : `vence en ${s.dias} día${s.dias > 1 ? 's' : ''}`}
                </span>
              </button>
            ))}
          </div>

          {/* ---- cuotas por vencer ---- */}
          <div className="glass fl-card">
            <h3>&#128197; Cuotas que vencen hoy y en 3 días <span className="hoy-n">{d.proximas.length}</span></h3>
            {!d.proximas.length && <p className="muted small">No vence ninguna cuota en estos días.</p>}
            {d.proximas.slice(0, LIM).map(q => (
              <button key={q.id} className="hoy-fila" onClick={() => irA('/lotes/' + q.sales.lot_id + '?tab=cuotas')}>
                <span className="hoy-lote">{loteTxt(q.sales.lot, q.sales.lot.project_id)}</span>
                <span className="hoy-quien">{q.sales.client?.full_name || '—'} · cuota N° {q.installment_number}</span>
                <span className={q.due_date === hoy ? 'warn' : 'muted'}>{soles(q.debe)} · {q.due_date === hoy ? 'HOY' : fechaPe(q.due_date)}</span>
              </button>
            ))}
            {d.proximas.length > LIM && <p className="muted small">… y {d.proximas.length - LIM} más.</p>}
          </div>

          {/* ---- cuotas vencidas ---- */}
          <div className="glass fl-card hoy-ancho">
            <h3>&#9888; Clientes con cuotas vencidas <span className="hoy-n bad">{d.vencidas.length}</span>
              {d.vencidas.length > 0 && <span className="muted small" style={{ fontWeight: 400 }}> · deuda vencida {soles(d.deudaTotal)}</span>}</h3>
            {!d.vencidas.length && <p className="ok small">Nadie tiene cuotas vencidas. 🎉</p>}
            {(ver.vencidas ? d.vencidas : d.vencidas.slice(0, LIM)).map(v => {
              const wa = waCobro({ nombre: v.client?.full_name, phone: v.client?.phone, lote: `Mz ${v.lot?.mz} Lt ${v.lot?.lt}`, n: v.n, deuda: v.deuda })
              return (
                <div key={v.sale_id} className="hoy-fila hoy-fila-acc">
                  <button className="hoy-fila-main" onClick={() => irA('/lotes/' + v.lot_id + '?tab=cuotas')}>
                    <span className="hoy-lote">{loteTxt(v.lot, v.lot.project_id)}</span>
                    <span className="hoy-quien">{v.client?.full_name || '—'}{v.client?.phone ? ' · ' + v.client.phone : ''}</span>
                    <span className="bad">{v.n} vencida{v.n > 1 ? 's' : ''} · {soles(v.deuda)} · {v.atraso} día{v.atraso > 1 ? 's' : ''} de atraso</span>
                  </button>
                  {wa && <a className="btn-act alt hoy-wa" href={wa} target="_blank" rel="noreferrer" title="Mensaje de cobro por WhatsApp">&#128172;</a>}
                </div>
              )
            })}
            {d.vencidas.length > LIM && (
              <button className="link-btn" onClick={() => setVer(x => ({ ...x, vencidas: !x.vencidas }))}>
                {ver.vencidas ? 'ver menos' : `ver los ${d.vencidas.length}`}
              </button>
            )}
          </div>

          {/* ---- documentos que faltan ---- */}
          <div className="glass fl-card">
            <h3>&#128206; Pagos sin documentos <span className="hoy-n">{d.docs.length}</span></h3>
            <p className="muted small" style={{ margin: '0 0 6px' }}>
              De las últimas 6 semanas. En total faltan {d.nSinComp ?? '?'} comprobantes y {d.nSinVou ?? '?'} vouchers (<Link to="/pagos">ver en Cuotas</Link>).
            </p>
            {!d.docs.length && <p className="ok small">Todos los pagos recientes tienen sus documentos.</p>}
            {(ver.docs ? d.docs : d.docs.slice(0, LIM)).map(p => (
              <button key={p.id} className="hoy-fila" onClick={() => irA('/lotes/' + p.lot_id + '?tab=pagos')}>
                <span className="hoy-lote">{p.lot ? `Mz ${p.lot.mz} Lt ${p.lot.lt}` : '—'}</span>
                <span className="hoy-quien">{p.client?.full_name || '—'} · {p.income_type === 'cuota' && p.installment ? 'cuota N° ' + p.installment.installment_number : p.income_type} · {soles(p.amount)} · {fechaPe(p.date)}</span>
                <span className="warn">falta {[p.faltaVoucher && 'voucher', p.faltaComp && 'comprobante'].filter(Boolean).join(' y ')}</span>
              </button>
            ))}
            {d.docs.length > LIM && (
              <button className="link-btn" onClick={() => setVer(x => ({ ...x, docs: !x.docs }))}>
                {ver.docs ? 'ver menos' : `ver los ${d.docs.length}`}
              </button>
            )}
          </div>

          {/* ---- mis tareas ---- */}
          <div className="glass fl-card">
            <h3>&#9745; Mis tareas de hoy <span className="hoy-n">{d.tareas.length}</span></h3>
            {!d.tareas.length && <p className="muted small">No tienes tareas pendientes anotadas para hoy.</p>}
            {d.tareas.map(t => (
              <p key={t.id} className="small" style={{ margin: '4px 0' }}>
                {t.time ? <b>{String(t.time).slice(0, 5)} </b> : null}{t.title}
              </p>
            ))}
            <p className="small" style={{ margin: '8px 0 0' }}><Link to="/secretarias">Ver mi seguimiento completo</Link></p>
          </div>
        </div>
      )}
    </div>
  )
}
