import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { buscarPorDocumento, esPendiente, tieneFotoDni, faltanParaContrato } from '../lib/cobros'

const TIPOS_DOC = ['DNI', 'CE', 'PASAPORTE', 'RUC']
const ESTADOS_CIVILES = ['SOLTERO(A)', 'CASADO(A)', 'CONVIVIENTE', 'DIVORCIADO(A)', 'VIUDO(A)']

// Busca clientes EN EL SERVIDOR por nombre o documento (la lista entera pasa de
// 1000 filas y el servidor la corta). Al elegir, trae la ficha completa.
export function BuscarCliente({ onElegir, excluir = [], placeholder = 'Busca por nombre o DNI (mínimo 3 letras)…' }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState([])
  const [buscando, setBuscando] = useState(false)
  useEffect(() => {
    const t = q.replace(/[,()*%]/g, ' ').trim()
    if (t.length < 3) { setRes([]); return }
    let vivo = true
    setBuscando(true)
    const h = setTimeout(async () => {
      const { data } = await supabase.from('clients').select('id, full_name, doc_type, doc_number, phone')
        .or(`full_name.ilike.*${t}*,doc_number.ilike.*${t}*`).order('full_name').limit(12)
      if (vivo) { setRes((data || []).filter(c => !excluir.includes(c.id))); setBuscando(false) }
    }, 300)
    return () => { vivo = false; clearTimeout(h) }
  }, [q])
  async function elegir(c) {
    const { data } = await supabase.from('clients').select('*').eq('id', c.id).single()
    setQ(''); setRes([])
    onElegir(data || c)
  }
  return (
    <div className="bsc" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <input className="search" value={q} placeholder={placeholder} style={{ textTransform: 'none' }} onChange={e => setQ(e.target.value)} />
      {q.trim().length >= 3 && (
        <div className="bsc-menu glass" style={{ position: 'static', marginTop: 4 }}>
          {buscando && <p className="muted bsc-nada">Buscando…</p>}
          {!buscando && !res.length && <p className="muted bsc-nada">Nadie coincide con «{q}».</p>}
          <div className="bsc-lista">
            {res.map(c => (
              <button type="button" key={c.id} className="bsc-op" onClick={() => elegir(c)}>
                <span className="bsc-lbl">{c.full_name}</span>
                <span className="bsc-sub muted">{esPendiente(c) ? 'DNI pendiente' : `${c.doc_type} ${c.doc_number}`}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Los datos que pide el contrato. La persona puede venir de una separacion
// (solo nombre y celular), de un cliente ya registrado o ser nueva.
export default function FormPersona({ persona, setPersona, archivo, setArchivo, titulo, excluirDoc }) {
  const [otra, setOtra] = useState(null)   // otra ficha con el mismo documento
  const set = (k, v) => setPersona(p => ({ ...p, [k]: v }))
  const tipoDoc = persona.doc_type && persona.doc_type !== 'PEND' ? persona.doc_type : 'DNI'
  const docVisible = persona.doc_type === 'PEND' ? '' : (persona.doc_number || '')
  const falta = faltanParaContrato(persona, archivo)
  const repetidoConTitular = excluirDoc && docVisible && docVisible.toUpperCase() === String(excluirDoc).toUpperCase()

  async function revisarDoc() {
    setOtra(null)
    if (!docVisible.trim()) return
    const c = await buscarPorDocumento(tipoDoc, docVisible)
    if (c && c.id !== persona.id) setOtra(c)
  }

  return (
    <div className="fp">
      {titulo && <p className="fl-lbl" style={{ margin: '0 0 6px' }}>{titulo}</p>}
      <div className="form-grid">
        <label>Tipo de documento
          <select value={tipoDoc} onChange={e => set('doc_type', e.target.value)}>
            {TIPOS_DOC.map(t => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>N° de documento
          <input value={docVisible} inputMode={tipoDoc === 'DNI' ? 'numeric' : undefined} maxLength={tipoDoc === 'DNI' ? 8 : 20}
            onChange={e => setPersona(p => ({ ...p, doc_number: e.target.value.trim(), doc_type: tipoDoc }))} onBlur={revisarDoc} />
        </label>
        <label className="span2">Nombres y apellidos completos
          <input value={persona.full_name || ''} onChange={e => set('full_name', e.target.value)} />
        </label>
        <label>Celular principal
          <input value={persona.phone || ''} inputMode="tel" onChange={e => set('phone', e.target.value)} />
        </label>
        <label>Celular 2 <span className="muted small">(opcional)</span>
          <input value={persona.phone2 || ''} inputMode="tel" onChange={e => set('phone2', e.target.value)} />
        </label>
        <label className="span2">Dirección (domicilio)
          <input value={persona.address || ''} placeholder="Jr. / Av. / AA.HH., Mz, Lt" onChange={e => set('address', e.target.value)} />
        </label>
        <label>Distrito <input value={persona.district || ''} onChange={e => set('district', e.target.value)} /></label>
        <label>Provincia <input value={persona.province || ''} onChange={e => set('province', e.target.value)} /></label>
        <label>Departamento <input value={persona.department || ''} onChange={e => set('department', e.target.value)} /></label>
        <label>Estado civil
          <select value={persona.civil_status || ''} onChange={e => set('civil_status', e.target.value)}>
            <option value="">- elegir -</option>
            {[...new Set([...ESTADOS_CIVILES, ...(persona.civil_status ? [persona.civil_status] : [])])].map(v => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label className="span2">Foto del DNI <span className="muted small">(un solo archivo con las dos caras, o PDF)</span>
          {tieneFotoDni(persona) && !archivo && (
            <span className="ok small" style={{ display: 'block', margin: '2px 0' }}>
              ✓ Ya está subida — <a href={persona.dni_url || persona.dni_front_url} target="_blank" rel="noreferrer">ver</a> (sube otra solo si hay que cambiarla)
            </span>
          )}
          <input type="file" accept="image/*,.pdf" onChange={e => setArchivo(e.target.files[0] || null)} />
        </label>
      </div>
      {otra && (
        <p className="hint small" style={{ margin: '6px 0 0' }}>
          &#128279; Ese documento ya está registrado a nombre de <b>{otra.full_name}</b>. Es la misma persona:
          al registrar se usa esa ficha y se le completan los datos (no queda duplicada).
        </p>
      )}
      {repetidoConTitular && <p className="error small">El co-comprador no puede tener el mismo documento que el titular.</p>}
      {falta.length > 0
        ? <p className="fl-falta">&#9888; Falta para el contrato: {falta.join(', ')}</p>
        : <p className="ok small" style={{ margin: '6px 0 0' }}>✓ Datos completos para el contrato</p>}
    </div>
  )
}
