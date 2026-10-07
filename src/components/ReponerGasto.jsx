import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { upload } from '../lib/archivos'

// REPOSICIÓN (sql/125): devolverle el dinero a quien adelantó uno o varios gastos.
// Se elige a quién, qué gastos cubre la transferencia y se sube su voucher. El
// monto es la suma de los gastos elegidos: la reposición no es un gasto nuevo.
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
const norm = t => String(t || '').toUpperCase().replace(/\s+/g, ' ').trim()
const numeroDe = g => g.request_number ? 'SOL-' + String(g.request_number).padStart(5, '0') : '—'

export default function ReponerGasto({ pidOp, gastos, inicial, opcionesPersonas, onCerrar, onHecho }) {
  const [persona, setPersona] = useState(inicial?.persona || '')
  const [sel, setSel] = useState(() => new Set(inicial?.ids || []))
  const [verTodos, setVerTodos] = useState(false)
  const [fecha, setFecha] = useState(hoy())
  const [operacion, setOperacion] = useState('')
  const [nota, setNota] = useState('')
  const [archivo, setArchivo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // se pueden reponer los gastos sin reposición y no rechazados; primero los que
  // esa persona adelantó, después (a pedido) el resto
  const libres = useMemo(() => gastos.filter(g => !g.reposicion_id && !g.rejected_at), [gastos])
  const p = norm(persona)
  const suyos = libres.filter(g => p && norm(g.adelanto_por) === p)
  const otros = libres.filter(g => !(p && norm(g.adelanto_por) === p))
  const visibles = [...suyos, ...otros.filter(g => verTodos || sel.has(g.id))]
  const elegidos = libres.filter(g => sel.has(g.id))
  const total = elegidos.reduce((s, g) => s + Number(g.amount || 0), 0)

  function cambiarPersona(v) {
    setPersona(v)
    // al elegir a alguien, se marcan solos todos los gastos que esa persona adelantó
    const q = norm(v)
    const deEl = libres.filter(g => q && norm(g.adelanto_por) === q).map(g => g.id)
    if (deEl.length) setSel(new Set([...(inicial?.ids || []), ...deEl]))
  }
  const alternar = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function registrar() {
    setErr('')
    if (p.length < 3) { setErr('Escribe a quién se le devuelve el dinero.'); return }
    if (!elegidos.length) { setErr('Marca al menos un gasto.'); return }
    if (!archivo) { setErr('Falta el voucher de la reposición.'); return }
    setBusy(true)
    try {
      const url = await upload('gastos/reposiciones/' + pidOp, archivo)
      const { data, error } = await supabase.rpc('registrar_reposicion', {
        pid: pidOp, persona: p, fecha, gastos: elegidos.map(g => g.id), url,
        nota: nota.trim() || null, operacion: operacion.trim() || null,
      })
      if (error) throw new Error(/registrar_reposicion|schema cache|Could not find/i.test(error.message) ? 'Falta correr sql/125 en la base.' : error.message)
      onHecho('REPOSICIÓN REGISTRADA: ' + soles(data?.monto ?? total) + ' a ' + p + (elegidos.length > 1 ? ' (' + elegidos.length + ' gastos)' : '') + '.')
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="modal-bg" onClick={busy ? undefined : onCerrar}>
      <div className="glass modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720, width: '96%', maxHeight: '92vh', overflowY: 'auto', textTransform: 'none' }}>
        <div className="modal-head">
          <b style={{ flex: 1 }}>💸 Reposición — devolver el dinero a quien lo adelantó</b>
          <button className="btn-ghost" onClick={onCerrar} disabled={busy} aria-label="Cerrar">&#10005;</button>
        </div>

        <div className="form-grid">
          <label className="span2">¿A quién se le devuelve?
            <input list="personas-reposicion" value={persona} autoFocus={!persona} style={{ textTransform: 'uppercase' }}
              placeholder="quien pagó con su dinero" onChange={e => cambiarPersona(e.target.value)} />
            <datalist id="personas-reposicion">
              {opcionesPersonas.map(([n]) => <option key={n} value={n} />)}
            </datalist>
          </label>
        </div>

        <p className="cp-sub" style={{ margin: '.8rem 0 .3rem', fontWeight: 700 }}>Gastos que cubre esta transferencia</p>
        {!visibles.length && <p className="muted small">{p ? 'Esta persona no tiene gastos por reponer. ' : ''}Usa "ver los demás gastos" para elegir.</p>}
        <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
          {visibles.map(g => (
            <label key={g.id} style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-start', textAlign: 'left', gap: 8, alignItems: 'center', padding: '.4rem .6rem', margin: 0, borderBottom: '1px solid var(--line)', cursor: 'pointer', fontWeight: 400 }}>
              <input type="checkbox" checked={sel.has(g.id)} onChange={() => alternar(g.id)} style={{ width: 'auto', margin: 0, flex: 'none' }} />
              <b style={{ minWidth: 82 }}>{numeroDe(g)}</b>
              <span className="muted small" style={{ minWidth: 76 }}>{g.issue_date || ''}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.description || ''}>
                {g.recipient || '—'} · {(g.description || g.type || '').slice(0, 60)}
                {g.adelanto_por && norm(g.adelanto_por) !== p && <span className="warn small"> · adelantó {g.adelanto_por}</span>}
              </span>
              <b style={{ whiteSpace: 'nowrap' }}>{soles(g.amount)}</b>
            </label>
          ))}
        </div>
        {otros.length > 0 && (
          <button type="button" className="link-btn small" style={{ marginTop: 4 }} onClick={() => setVerTodos(v => !v)}>
            {verTodos ? 'ocultar los demás gastos' : 'ver los demás gastos sin reposición (' + otros.length + ')'}
          </button>
        )}
        <p style={{ margin: '.6rem 0' }}><b>Total a reponer: {soles(total)}</b>{elegidos.length > 1 ? <span className="muted"> · {elegidos.length} gastos</span> : null}</p>

        <div className="form-grid">
          <label>Fecha de la transferencia
            <input type="date" value={fecha} max={hoy()} onChange={e => setFecha(e.target.value)} />
          </label>
          <label>N° de operación <span className="muted small">(opcional)</span>
            <input value={operacion} onChange={e => setOperacion(e.target.value)} />
          </label>
          <label className="span2">Voucher de la reposición
            <input type="file" accept="image/*,.pdf" onChange={e => setArchivo(e.target.files[0] || null)} />
          </label>
          <label className="span2">Nota <span className="muted small">(opcional)</span>
            <input value={nota} onChange={e => setNota(e.target.value)} placeholder="ej. transferencia desde la cuenta de la socia" style={{ textTransform: 'none' }} />
          </label>
        </div>

        {err && <p className="error" style={{ textTransform: 'none' }}>{err}</p>}
        <div className="acc-row" style={{ marginTop: 12 }}>
          <button className="btn-primary" onClick={registrar} disabled={busy || !elegidos.length}>
            {busy ? 'Guardando…' : 'Registrar reposición por ' + soles(total)}
          </button>
          <button className="btn-ghost" onClick={onCerrar} disabled={busy}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
