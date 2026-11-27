import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMsg } from '../lib/saveFx'
import { hoyPe } from '../lib/cobros'
import { linkPublico } from '../lib/sitios'
import { TIPOS, MEDIOS, DOCS, PLAZO_DIAS, bonito, soles, fechaPe, fechaHoraPe, fechaSolaPe, descargarHoja } from '../lib/libroReclamaciones'

// BANDEJA DEL LIBRO DE RECLAMACIONES (sql/230, 14 nov 2026). Solo admin y superusuario
// (la política de la tabla y libro_responder lo exigen; la ruta y el menú también).
// Cada hoja la llena el cliente en urbisgroupinmobiliaria.com/libro-de-reclamaciones; al dueño
// le llega un Telegram. Aquí se lee, se responde y se le hace llegar la respuesta por el medio
// que eligió el cliente (WhatsApp, correo o carta impresa). La respuesta también aparece en el
// enlace de su hoja. El plazo legal es de 15 días hábiles improrrogables (Ley 31435).

const diasEntre = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000)
const celular = t => { let d = String(t || '').replace(/\D/g, ''); if (d.length === 9 && d.startsWith('9')) d = '51' + d; return d }

// la fila de la tabla → la forma de libro_hoja() (para el PDF y la vista)
const comoHoja = r => ({
  token: r.token, numero: r.numero, fecha: r.fecha, proyecto: bonito(r.proyecto),
  empresa: { razon_social: r.empresa_razon_social, ruc: r.empresa_ruc, direccion: r.empresa_direccion, atencion: r.atencion_direccion },
  consumidor: { nombre: r.nombre, doc_tipo: r.doc_tipo, doc_numero: r.doc_numero, domicilio: r.domicilio, telefono: r.telefono,
    correo: r.correo, menor_de_edad: r.menor_de_edad, apoderado_nombre: r.apoderado_nombre, apoderado_doc: r.apoderado_doc },
  bien: { tipo: r.bien_tipo, descripcion: r.bien_descripcion, monto: r.monto },
  tipo: r.tipo, detalle: r.detalle, pedido: r.pedido, respuesta_medio: r.respuesta_medio, plazo_dias: PLAZO_DIAS,
  respuesta: r.respuesta, respuesta_at: r.respuesta_at,
})

function Plazo({ r, hoy }) {
  if (r.respuesta_at) return <span className="ok">Respondida {fechaPe(r.respuesta_at)}</span>
  const d = diasEntre(hoy, r.vence)
  if (d < 0) return <b className="bad">VENCIDA hace {-d} día{d === -1 ? '' : 's'}</b>
  if (d <= 4) return <b className="bad">Vence {fechaSolaPe(r.vence)} ({d === 0 ? 'hoy' : 'en ' + d + ' día' + (d === 1 ? '' : 's')})</b>
  return <span className="warn">Vence {fechaSolaPe(r.vence)} (en {d} días)</span>
}

export default function Reclamos() {
  const hoy = hoyPe()
  const [filas, setFilas] = useState(null)
  const [falta, setFalta] = useState(false)
  const [err, setErr] = useState('')
  const [ver, setVer] = useState('pendientes')
  const [abiertaId, setAbiertaId] = useState(null)

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('libro_reclamaciones')
      .select('*, quien:profiles!libro_reclamaciones_respondido_por_fkey(full_name)')
      .order('fecha', { ascending: false }).limit(500)
    if (error) {
      if (/libro_reclamaciones|does not exist|schema cache|PGRST20/i.test(error.message + ' ' + (error.code || ''))) setFalta(true)
      else setErr(error.message)
      setFilas([]); return
    }
    setFalta(false); setErr(''); setFilas(data || [])
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const abierta = useMemo(() => (filas || []).find(r => r.id === abiertaId) || null, [filas, abiertaId])
  const pend = useMemo(() => (filas || []).filter(r => !r.respuesta_at), [filas])
  const lista = useMemo(() => {
    const l = ver === 'pendientes' ? pend : ver === 'respondidas' ? (filas || []).filter(r => r.respuesta_at) : (filas || [])
    // las pendientes, la que vence primero arriba
    return ver === 'pendientes' ? [...l].sort((a, b) => (a.vence < b.vence ? -1 : a.vence > b.vence ? 1 : 0)) : l
  }, [filas, pend, ver])

  if (falta) return (
    <>
      <h1>Libro de reclamaciones</h1>
      <p className="hint">Falta correr <b>sql/230_libro_reclamaciones.sql</b> en la base. Cuando esté, aquí aparece cada hoja que llenen los clientes en la web.</p>
    </>
  )

  return (
    <>
      <div className="toolbar">
        <h1 className="u-m0 u-f1">Libro de reclamaciones</h1>
        <a className="btn-ghost" href={linkPublico('libro-de-reclamaciones')} target="_blank" rel="noreferrer">Ver el formulario público ↗</a>
      </div>
      <p className="muted small" style={{ margin: '-.4rem 0 .8rem', textTransform: 'none' }}>
        Lo que los clientes registran en la web. Hay que responder cada hoja en un plazo no mayor a <b>{PLAZO_DIAS} días hábiles</b> (Ley 31435),
        por el medio que eligió el cliente. Cada hoja va a nombre de la empresa de su proyecto y se numera por RUC y año.
      </p>
      {err && <p className="error u-tt-n">{err}</p>}

      <div className="chips">
        <button className={`chip ${ver === 'pendientes' ? 'on' : ''}`} onClick={() => setVer('pendientes')}>Por responder ({pend.length})</button>
        <button className={`chip ${ver === 'respondidas' ? 'on' : ''}`} onClick={() => setVer('respondidas')}>Respondidas</button>
        <button className={`chip ${ver === 'todas' ? 'on' : ''}`} onClick={() => setVer('todas')}>Todas</button>
      </div>

      {filas === null && <p className="muted">Cargando…</p>}
      {filas && !lista.length && <p className="muted">{ver === 'pendientes' ? 'No hay hojas por responder.' : 'Todavía no hay hojas.'}</p>}

      {!!lista.length && (
        <div className="glass table-wrap">
          <table>
            <thead><tr><th>N°</th><th>Fecha</th><th>Proyecto · empresa</th><th>Cliente</th><th>Tipo</th><th>Plazo</th><th></th></tr></thead>
            <tbody>
              {lista.map(r => (
                <tr className="u-cp" key={r.id} onClick={() => setAbiertaId(r.id)}>
                  <td className="u-nw"><b>{r.numero}</b></td>
                  <td className="small u-nw">{fechaHoraPe(r.fecha)}</td>
                  <td className="u-tt-n">{bonito(r.proyecto)}<div className="muted small">{r.empresa_razon_social} · RUC {r.empresa_ruc}</div></td>
                  <td>{r.nombre}<div className="muted small">{r.doc_tipo} {r.doc_numero} · {r.telefono}</div></td>
                  <td>{TIPOS[r.tipo]?.t || r.tipo}</td>
                  <td className="small u-tt-n"><Plazo r={r} hoy={hoy} /></td>
                  <td><button className="btn-ghost" onClick={e => { e.stopPropagation(); setAbiertaId(r.id) }}>{r.respuesta_at ? 'Ver' : 'Responder'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {abierta && <Hoja key={abierta.id} r={abierta} hoy={hoy} onCerrar={() => setAbiertaId(null)} onRespondida={cargar} />}
    </>
  )
}

function Hoja({ r, hoy, onCerrar, onRespondida }) {
  const [texto, setTexto] = useState(r.respuesta || '')
  const [editar, setEditar] = useState(!r.respuesta)
  const [guardando, setGuardando] = useState(false)
  const [bajando, setBajando] = useState(false)
  const [msg, setMsg] = useMsg(null)
  const h = comoHoja(r)
  const enlace = linkPublico('libro-de-reclamaciones/' + r.token)

  async function guardar() {
    if (texto.trim().length < 5) { setMsg({ ok: false, t: 'Escribe la respuesta.' }); return }
    setGuardando(true)
    const { error } = await supabase.rpc('libro_responder', { p_id: r.id, p_respuesta: texto })
    setGuardando(false)
    if (error) { setMsg({ ok: false, t: error.message }); return }
    setMsg({ ok: true, t: '✅ Respuesta guardada. Ya se ve en el enlace de su hoja. Ahora hazle llegar la respuesta ' + ({ correo: 'por correo', whatsapp: 'por WhatsApp', domicilio: 'en carta a su domicilio' }[r.respuesta_medio] || '') + '.' })
    setEditar(false)
    await onRespondida()
  }
  const bajar = async () => { setBajando(true); try { await descargarHoja(h) } finally { setBajando(false) } }

  const saludo = 'Estimado(a) ' + bonito(r.nombre) + ':\n\nEn atención a su hoja de reclamación N° ' + r.numero + ' del ' + fechaPe(r.fecha)
    + ' (' + r.empresa_razon_social + ', RUC ' + r.empresa_ruc + '), le respondemos:\n\n'
  const cuerpo = saludo + (r.respuesta || texto).trim() + '\n\nPuede ver su hoja y esta respuesta aquí: ' + enlace + '\n\nAtentamente,\n' + r.empresa_razon_social
  const wa = 'https://wa.me/' + celular(r.telefono) + '?text=' + encodeURIComponent(cuerpo)
  const correo = r.correo ? 'mailto:' + r.correo + '?subject=' + encodeURIComponent('Respuesta a su hoja de reclamación N° ' + r.numero) + '&body=' + encodeURIComponent(cuerpo) : ''
  const historial = Array.isArray(r.respuesta_historial) ? r.respuesta_historial : []
  const dato = (t, v) => <div style={{ minWidth: 0 }}><div className="muted small">{t}</div><div style={{ textTransform: 'none', overflowWrap: 'anywhere' }}>{v || '—'}</div></div>
  const caja = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '8px 16px', margin: '6px 0 12px' }
  const largo = { whiteSpace: 'pre-wrap', textTransform: 'none', background: 'rgba(255,255,255,.04)', borderRadius: 8, padding: '8px 10px', margin: '4px 0 10px' }

  return (
    <div className="modal-bg" onClick={onCerrar}>
      <div className="glass modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 860, width: '96%', maxHeight: '94vh', overflowY: 'auto' }}>
        <div className="modal-head">
          <b>📕 HOJA N° {r.numero} · {TIPOS[r.tipo]?.t?.toUpperCase()}</b>
          <button className="btn-ghost" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        <p className="small u-tt-n u-m-006">
          {fechaHoraPe(r.fecha)} · <Plazo r={r} hoy={hoy} /> · {bonito(r.proyecto)}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '6px 0 10px' }}>
          <button className="btn-ghost" onClick={bajar} disabled={bajando}>{bajando ? 'Preparando…' : '⬇ PDF de la hoja'}</button>
          <a className="btn-ghost" href={enlace} target="_blank" rel="noreferrer">Ver como la ve el cliente ↗</a>
        </div>

        <h3 style={{ margin: '8px 0 2px' }}>Proveedor</h3>
        <div style={caja}>{dato('Razón social', r.empresa_razon_social)}{dato('RUC', r.empresa_ruc)}{dato('Domicilio fiscal', r.empresa_direccion)}</div>
        <h3 style={{ margin: '8px 0 2px' }}>1. Consumidor</h3>
        <div style={caja}>
          {dato('Nombre', r.nombre)}{dato(DOCS[r.doc_tipo] || 'Documento', r.doc_numero)}{dato('Teléfono', r.telefono)}
          {dato('Correo', r.correo)}{dato('Domicilio', r.domicilio)}
          {r.menor_de_edad && dato('Padre, madre o apoderado', r.apoderado_nombre + (r.apoderado_doc ? ' · ' + r.apoderado_doc : ''))}
        </div>
        <h3 style={{ margin: '8px 0 2px' }}>2. Bien contratado</h3>
        <div style={caja}>{dato('Tipo', r.bien_tipo === 'servicio' ? 'Servicio' : 'Producto')}{dato('Monto reclamado', soles(r.monto))}{dato('Descripción', r.bien_descripcion)}</div>
        <h3 style={{ margin: '8px 0 2px' }}>3. Detalle y pedido</h3>
        <div className="muted small">Detalle</div><div style={largo}>{r.detalle}</div>
        <div className="muted small">Pedido</div><div style={largo}>{r.pedido}</div>
        <p className="small u-tt-n">Quiere la respuesta por: <b>{MEDIOS[r.respuesta_medio]}</b></p>

        <h3 style={{ margin: '12px 0 4px' }}>4. Respuesta</h3>
        {r.respuesta && !editar ? (
          <>
            <div style={largo}>{r.respuesta}</div>
            <p className="muted small u-tt-n">Respondida el {fechaHoraPe(r.respuesta_at)}{r.quien?.full_name ? ' por ' + r.quien.full_name : ''}.</p>
            <div className="u-d-f u-g-8 u-fwr">
              {r.respuesta_medio === 'whatsapp' && <a className="btn-primary" href={wa} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>}
              {r.respuesta_medio === 'correo' && correo && <a className="btn-primary" href={correo}>Enviar por correo</a>}
              {r.respuesta_medio === 'domicilio' && <button className="btn-primary" onClick={bajar}>Imprimir la carta (PDF con la respuesta)</button>}
              {r.respuesta_medio !== 'whatsapp' && <a className="btn-ghost" href={wa} target="_blank" rel="noreferrer">También por WhatsApp</a>}
              {r.respuesta_medio !== 'correo' && correo && <a className="btn-ghost" href={correo}>También por correo</a>}
              <button className="btn-ghost" onClick={() => { setTexto(r.respuesta); setEditar(true) }}>Corregir la respuesta</button>
            </div>
          </>
        ) : (
          <>
            <textarea className="u-w-100 u-tt-n" value={texto} onChange={e => setTexto(e.target.value)} rows={7} maxLength={6000}
              placeholder="Qué se revisó, qué se decidió y qué acciones se tomaron. Esto lo ve el cliente en su hoja." />
            <div className="u-d-f u-g-8 u-fwr u-mt-8">
              <button className="btn-primary" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar respuesta'}</button>
              {r.respuesta && <button className="btn-ghost" onClick={() => { setTexto(r.respuesta); setEditar(false) }}>Cancelar</button>}
            </div>
            {r.respuesta && <p className="muted small u-tt-n">La respuesta anterior queda guardada en el historial.</p>}
          </>
        )}
        {msg && <p className={msg.ok ? 'ok' : 'error'} style={{ textTransform: 'none' }}>{msg.t}</p>}
        {!!historial.length && (
          <details className="u-mt-10">
            <summary className="muted small">Respuestas anteriores ({historial.length})</summary>
            {historial.map((x, i) => <div key={i} style={largo}><div className="muted small">{fechaHoraPe(x.respuesta_at)}</div>{x.respuesta}</div>)}
          </details>
        )}
      </div>
    </div>
  )
}
