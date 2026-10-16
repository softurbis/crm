import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pedir } from '../lib/dialogos'

// LA LECTURA CON IA DE LA BOLETA O FACTURA SUBIDA (sql/151, agente/lector_boletas.js)
// Al subirla, el servidor la lee con Claude y la compara con el pago: total, RUC,
// cliente, número repetido, lote y cuota. Aquí se muestra:
//   ✓ IA       todo cuadra
//   ⚠ revisar  algo no cuadra (y nadie marcó "Lo revisé")
//   ✓ revisada tenía ⚠ y facturación o la administración la revisó
// La ven facturación, las secretarias y la administración (lo decide la base).

// las lecturas de varias boletas a la vez: { url: lectura }. Mientras alguna se
// está leyendo se vuelve a mirar cada 4 s; si no, ni una consulta de más.
export function useLecturasBoleta(urls) {
  const [porUrl, setPorUrl] = useState({})
  const clave = [...new Set((urls || []).filter(Boolean))].sort().join('\n')
  const turno = useRef(0)
  const cargar = useCallback(async () => {
    const lista = clave ? clave.split('\n') : []
    if (!lista.length) { setPorUrl({}); return }
    const t = ++turno.current
    const out = {}
    for (let i = 0; i < lista.length; i += 150) {
      const { data, error } = await supabase.rpc('recibo_lecturas_de', { p_urls: lista.slice(i, i + 150) })
      if (error) return   // sql/151 sin correr o sin permiso: no se muestra nada
      for (const r of data || []) out[r.url] = r
    }
    if (t === turno.current) setPorUrl(out)
  }, [clave])
  useEffect(() => { cargar() }, [cargar])
  const leyendo = Object.values(porUrl).some(l => l.estado === 'pendiente' || l.estado === 'leyendo')
  useEffect(() => {
    if (!leyendo) return
    const t = setInterval(cargar, 4000)
    return () => clearInterval(t)
  }, [leyendo, cargar])
  return { porUrl, recargar: cargar }
}

export const nombreTipo = t => ({ boleta: 'boleta', factura: 'factura', nota_credito: 'nota de crédito', nota_debito: 'nota de débito' }[t] || 'comprobante')
export const conAviso = l => l?.estado === 'listo' && l.alertas > 0 && !l.revisado

// el chip, al lado del VER. Clic: el detalle, con "Lo revisé" / "Leer otra vez"
export function ChipLectura({ l, puedeRevisar = false, onCambio }) {
  const [abierto, setAbierto] = useState(false)
  if (!l) return null
  const leyendo = l.estado === 'pendiente' || l.estado === 'leyendo'
  const [txt, cls, tit] = leyendo ? ['⏳ leyendo', 'cp-lect', 'La IA está leyendo la boleta']
    : l.estado === 'error' ? ['⚠ sin leer', 'cp-lect no', 'La IA no pudo leerla: ' + (l.error || '')]
    : conAviso(l) ? ['⚠ revisar', 'cp-lect no', (l.validacion || []).filter(x => x.nivel === 'mal').map(x => x.texto).join('\n')]
    : l.alertas > 0 ? ['✓ revisada', 'cp-lect ok', 'Tenía diferencias y la revisó ' + (l.revisado_por || 'alguien')]
    : ['✓ IA', 'cp-lect ok', 'La IA la leyó y cuadra con el pago' + (l.serie_numero ? ' · ' + l.serie_numero : '')]
  return (
    <>
      <button type="button" className={cls} title={tit} onClick={e => { e.stopPropagation(); setAbierto(true) }}>{txt}</button>
      {abierto && <DetalleLectura l={l} puedeRevisar={puedeRevisar} onCerrar={() => setAbierto(false)} onCambio={onCambio} />}
    </>
  )
}

// la lista de lo que se comparó: ✓ / ? / ✗
export function ListaValidacion({ l }) {
  if (!l?.validacion?.length) return null
  const ico = { ok: '✓', duda: '?', mal: '✗' }
  return (
    <ul className="cp-valid">
      {l.validacion.map((v, i) => <li key={i} className={v.nivel}><b>{ico[v.nivel]}</b> {v.texto}</li>)}
    </ul>
  )
}

function DetalleLectura({ l, puedeRevisar, onCerrar, onCambio }) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function revisar() {
    const nota = await pedir('¿Qué revisaste? (opcional, Enter para saltar)\n\nEj: el monto es correcto, la boleta cubre también la mora', { tipo: 'largo', valor: '' })
    if (nota === null) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('recibo_revisado', { p_url: l.url, p_nota: nota })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onCambio?.(); onCerrar()
  }
  async function releer() {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('recibo_releer', { p_url: l.url })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onCambio?.(); onCerrar()
  }
  return (
    <div className="modal-bg" onClick={e => { e.stopPropagation(); onCerrar() }}>
      <div className="glass modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Lectura con IA{l.serie_numero ? ' · ' + nombreTipo(l.tipo).toUpperCase() + ' ' + l.serie_numero : ''}</h2>
          <button className="btn-ghost" onClick={onCerrar}>&#10005;</button>
        </div>
        {(l.estado === 'pendiente' || l.estado === 'leyendo') && <p className="cp-busca"><span className="cp-gira" /> La IA la está leyendo… tarda unos segundos.</p>}
        {l.estado === 'error' && <p className="cp-busca no">No se pudo leer: {l.error || 'sin detalle'}.</p>}
        <ListaValidacion l={l} />
        {l.revisado && <p className="muted small" style={{ textTransform: 'none' }}>✓ Revisada por {l.revisado_por || '—'}{l.revisado_at ? ' el ' + new Date(l.revisado_at).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}{l.revisado_nota ? ': ' + l.revisado_nota : ''}</p>}
        {conAviso(l) && <p className="muted small" style={{ textTransform: 'none' }}>
          {puedeRevisar
            ? 'Si la boleta está bien de todas formas (la IA leyó mal, o el pago se corrigió), márcala como revisada. Si es la boleta equivocada, súbela de nuevo.'
            : 'Facturación tiene que revisarla: o la corrige, o marca que está bien.'}</p>}
        {err && <p className="error" style={{ textTransform: 'none' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {conAviso(l) && puedeRevisar && <button className="btn-primary" disabled={busy} onClick={revisar}>✓ Lo revisé, está bien</button>}
          {(l.estado === 'listo' || l.estado === 'error') && <button className="btn-ghost" disabled={busy} onClick={releer}>↻ Leer otra vez</button>}
        </div>
      </div>
    </div>
  )
}
