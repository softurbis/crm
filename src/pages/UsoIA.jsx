import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { hoyPe } from '../lib/cobros'
import { fechaPe } from '../lib/lotes'

// USO DE LA IA (sql/205, 12 nov 2026): cada llamada que el agente hace a Claude queda
// registrada (origen, modelo, tokens, costo aproximado). Aquí se ve en qué se va el
// saldo de la API: por origen, por día y llamada por llamada.
const ORIGEN = {
  ventas: 'Agente de ventas', cobranza: 'Agente de cobranza', voucher: 'Lectura de voucher',
  dni: 'Lectura de DNI', comprobante: 'Lectura de comprobante', boleta: 'Lectura de boleta', interno: 'Asistente interno',
}
const usd = n => 'USD ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: Number(n || 0) < 1 ? 4 : 2 })
const num = n => Number(n || 0).toLocaleString('en-US')
const horaPe = iso => new Date(new Date(iso).getTime() - 5 * 3600 * 1000).toISOString().slice(11, 19)
const diaPe = iso => new Date(new Date(iso).getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10)
const der = { textAlign: 'right', whiteSpace: 'nowrap' }

export default function UsoIA() {
  const hoy = hoyPe()
  const [desde, setDesde] = useState(hoy.slice(0, 8) + '01')
  const [hasta, setHasta] = useState(hoy)
  const [resumen, setResumen] = useState(null)
  const [ultimas, setUltimas] = useState([])
  const [origen, setOrigen] = useState('todos')
  const [falta, setFalta] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let vivo = true
    setResumen(null); setErr('')
    ;(async () => {
      const r = await supabase.rpc('ia_uso_resumen', { desde, hasta })
      if (!vivo) return
      if (r.error) {
        if (/ia_uso|does not exist|schema cache|PGRST202/i.test(r.error.message + ' ' + (r.error.code || ''))) setFalta(true)
        else setErr(r.error.message)
        setResumen([]); return
      }
      setFalta(false); setResumen(r.data || [])
      // las últimas 300 llamadas del rango (lo fino; los totales vienen sumados de Postgres)
      const u = await supabase.from('ia_uso').select('*')
        .gte('created_at', desde + 'T05:00:00Z').order('created_at', { ascending: false }).limit(300)
      if (vivo) setUltimas((u.data || []).filter(f => diaPe(f.created_at) <= hasta))
    })()
    return () => { vivo = false }
  }, [desde, hasta])

  const filas = useMemo(() => (resumen || []).filter(f => origen === 'todos' || f.origen === origen), [resumen, origen])
  const sumar = (lista, clave) => {
    const m = new Map()
    for (const f of lista) {
      const k = clave(f)
      const x = m.get(k) || { k, llamadas: 0, fallidas: 0, tin: 0, tout: 0, cr: 0, cw: 0, costo: 0 }
      x.llamadas += Number(f.llamadas); x.fallidas += Number(f.fallidas)
      x.tin += Number(f.tokens_in); x.tout += Number(f.tokens_out); x.cr += Number(f.tokens_cache_r); x.cw += Number(f.tokens_cache_w)
      x.costo += Number(f.costo_usd)
      m.set(k, x)
    }
    return [...m.values()]
  }
  const porOrigen = useMemo(() => sumar(resumen || [], f => f.origen + ' · ' + (f.modelo || '—')).sort((a, b) => b.costo - a.costo), [resumen])
  const porDia = useMemo(() => sumar(filas, f => f.dia).sort((a, b) => (a.k < b.k ? 1 : -1)), [filas])
  const total = useMemo(() => sumar(filas, () => 'total')[0] || { llamadas: 0, fallidas: 0, costo: 0 }, [filas])
  const origenes = useMemo(() => [...new Set((resumen || []).map(f => f.origen))], [resumen])
  const verUltimas = ultimas.filter(f => origen === 'todos' || f.origen === origen)

  if (falta) return (
    <>
      <h1>Uso de la IA</h1>
      <p className="hint">Falta correr <b>sql/205_uso_ia.sql</b> en la base. Cuando esté, aquí aparece cada llamada que el sistema hace a Claude.</p>
    </>
  )

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Uso de la IA</h1>
        <label className="small">Desde <input type="date" value={desde} max={hasta} onChange={e => e.target.value && setDesde(e.target.value)} /></label>
        <label className="small">Hasta <input type="date" value={hasta} min={desde} max={hoy} onChange={e => e.target.value && setHasta(e.target.value)} /></label>
      </div>
      <p className="muted small" style={{ margin: '-.4rem 0 .8rem' }}>
        Cada llamada que el sistema hace a Claude, con sus tokens y su costo aproximado. El cobro exacto es el de la consola de Anthropic;
        aquí no aparece lo que se gaste fuera del sistema (por ejemplo, Claude Code o otras claves).
      </p>
      {err && <p className="error">{err}</p>}

      <div className="chips">
        <button className={`chip ${origen === 'todos' ? 'on' : ''}`} onClick={() => setOrigen('todos')}>Todo</button>
        {origenes.map(o => <button key={o} className={`chip ${origen === o ? 'on' : ''}`} onClick={() => setOrigen(o)}>{ORIGEN[o] || o}</button>)}
      </div>

      {resumen === null && <p className="muted">Cargando…</p>}
      {resumen && !resumen.length && <p className="muted">No hay llamadas registradas en esas fechas. El registro empezó el 12/11/2026.</p>}

      {resumen && !!resumen.length && (
        <>
          <p className="hint">
            <b>{num(total.llamadas)}</b> llamada{total.llamadas === 1 ? '' : 's'} · costo aproximado <b>{usd(total.costo)}</b>
            {!!total.fallidas && <> · <b className="bad">{num(total.fallidas)} fallida{total.fallidas === 1 ? '' : 's'}</b></>}
          </p>

          <h3>Por origen y modelo</h3>
          <div className="glass table-wrap">
            <table>
              <thead><tr>
                <th>Origen · modelo</th><th style={der}>Llamadas</th><th style={der}>Fallidas</th>
                <th style={der}>Entrada</th><th style={der}>Caché leída</th><th style={der}>Caché escrita</th><th style={der}>Salida</th><th style={der}>Costo</th>
              </tr></thead>
              <tbody>
                {porOrigen.map(x => {
                  const [o, m] = x.k.split(' · ')
                  return (
                    <tr key={x.k}>
                      <td style={{ textTransform: 'none' }}><b>{ORIGEN[o] || o}</b><div className="muted small">{m}</div></td>
                      <td style={der}>{num(x.llamadas)}</td>
                      <td style={der}>{x.fallidas ? <b className="bad">{num(x.fallidas)}</b> : <span className="muted">—</span>}</td>
                      <td style={der} className="small">{num(x.tin)}</td><td style={der} className="small">{num(x.cr)}</td>
                      <td style={der} className="small">{num(x.cw)}</td><td style={der} className="small">{num(x.tout)}</td>
                      <td style={der}><b>{usd(x.costo)}</b></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <h3>Por día</h3>
          <div className="glass table-wrap">
            <table>
              <thead><tr><th>Día</th><th style={der}>Llamadas</th><th style={der}>Fallidas</th><th style={der}>Costo</th></tr></thead>
              <tbody>
                {porDia.map(x => (
                  <tr key={x.k}>
                    <td>{fechaPe(x.k)}</td><td style={der}>{num(x.llamadas)}</td>
                    <td style={der}>{x.fallidas ? <b className="bad">{num(x.fallidas)}</b> : <span className="muted">—</span>}</td>
                    <td style={der}><b>{usd(x.costo)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Últimas llamadas {verUltimas.length >= 300 && <span className="muted small">(las 300 más recientes)</span>}</h3>
          <div className="glass table-wrap">
            <table>
              <thead><tr>
                <th>Fecha y hora</th><th>Origen</th><th>Modelo</th><th style={der}>Entrada</th><th style={der}>Caché</th><th style={der}>Salida</th>
                <th style={der}>Demora</th><th style={der}>Costo</th><th>Resultado</th>
              </tr></thead>
              <tbody>
                {verUltimas.map(f => (
                  <tr key={f.id}>
                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{fechaPe(diaPe(f.created_at))} {horaPe(f.created_at)}</td>
                    <td style={{ textTransform: 'none' }}>{ORIGEN[f.origen] || f.origen}{f.ref && <div className="muted small">{f.ref}</div>}</td>
                    <td className="small" style={{ textTransform: 'none' }}>{f.modelo || '—'}</td>
                    <td style={der} className="small">{num(f.tokens_in)}</td>
                    <td style={der} className="small">{num(f.tokens_cache_r + f.tokens_cache_w)}</td>
                    <td style={der} className="small">{num(f.tokens_out)}</td>
                    <td style={der} className="small">{f.ms != null ? (f.ms / 1000).toFixed(1) + ' s' : '—'}</td>
                    <td style={der}>{usd(f.costo_usd)}</td>
                    <td className="small" style={{ textTransform: 'none', whiteSpace: 'normal', maxWidth: 280 }}>
                      {f.ok ? <span className="ok">Bien</span> : <span className="bad" title={f.error || ''}>Falló: {(f.error || '').slice(0, 90)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
