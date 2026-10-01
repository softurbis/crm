import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { subirRuta } from '../lib/archivos'
import { fechaPe } from '../lib/lotes'
import { rucValido, emisorDelServidor, emisorVisto } from '../lib/comprobantes'
import { logoProyecto } from '../context/ProjectContext'

// FACTURACIÓN ELECTRÓNICA DEL PROYECTO (sql/113). Cada proyecto factura con el RUC
// de SU dueño y con su marca: Las Praderas de Pucallpa sale a nombre de Century,
// El Triunfo a nombre del suyo. Aquí se dice quién factura, con qué series, con qué
// logo y color sale el comprobante, y se prende o apaga el facturador.
//
// Las claves (certificado digital y clave SOL) NO van aquí ni en la base: se cargan
// en el servidor con su asistente. Esta ficha solo muestra si ese RUC ya está allá.

const COLORES = ['#D71920', '#1F6FB2', '#2E8B57', '#E08A1E', '#7A4FB5', '#3A3A3A']

// El logo del comprobante se guarda en PNG sobre fondo blanco y de tamaño moderado:
// es lo que el servidor sabe pegar en el PDF (no abre WebP) y lo que entra liviano.
// Además se le RECORTA el margen blanco: los logos suelen venir en un cuadrado con
// mucho aire alrededor (el de Century ocupaba la mitad de su imagen) y así salían
// diminutos en la boleta y en el menú.
export async function aPng(file, maxLado = 900) {
  const bmp = await createImageBitmap(file)
  const k0 = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const base = document.createElement('canvas')
  base.width = Math.round(bmp.width * k0); base.height = Math.round(bmp.height * k0)
  const c0 = base.getContext('2d', { willReadFrequently: true })
  c0.fillStyle = '#fff'; c0.fillRect(0, 0, base.width, base.height)
  c0.drawImage(bmp, 0, 0, base.width, base.height)
  bmp.close?.()

  // la caja de lo que NO es blanco (con un poco de tolerancia para el JPG)
  let x0 = base.width, y0 = base.height, x1 = -1, y1 = -1
  try {
    const px = c0.getImageData(0, 0, base.width, base.height).data
    for (let y = 0; y < base.height; y++) {
      for (let x = 0; x < base.width; x++) {
        const i = (y * base.width + x) * 4
        if (px[i] < 238 || px[i + 1] < 238 || px[i + 2] < 238) {
          if (x < x0) x0 = x; if (x > x1) x1 = x
          if (y < y0) y0 = y; if (y > y1) y1 = y
        }
      }
    }
  } catch { x1 = -1 }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = base.width - 1; y1 = base.height - 1 }   // imagen toda blanca o ilegible: tal cual
  const aire = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03)
  x0 = Math.max(0, x0 - aire); y0 = Math.max(0, y0 - aire)
  x1 = Math.min(base.width - 1, x1 + aire); y1 = Math.min(base.height - 1, y1 + aire)
  const w = x1 - x0 + 1, h = y1 - y0 + 1

  const k = Math.min(1, maxLado / Math.max(w, h))
  const lienzo = document.createElement('canvas')
  lienzo.width = Math.round(w * k); lienzo.height = Math.round(h * k)
  const ctx = lienzo.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, lienzo.width, lienzo.height)
  ctx.drawImage(base, x0, y0, w, h, 0, 0, lienzo.width, lienzo.height)
  const blob = await new Promise(r => lienzo.toBlob(r, 'image/png'))
  if (!blob) throw new Error('No se pudo leer la imagen del logo.')
  return new File([blob], 'logo.png', { type: 'image/png' })
}

export default function FacturadorProyecto({ proyecto: p, puedeEditar, onGuardado, setMsg }) {
  const hayBase = 'fact_activo' in p
  const [abierto, setAbierto] = useState(false)
  const [f, setF] = useState(null)
  const [logo, setLogo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [emisor, setEmisor] = useState(undefined)

  useEffect(() => { if (hayBase) emisorDelServidor(p.fact_ruc).then(setEmisor) }, [p.fact_ruc, hayBase])

  function abrir() {
    setF({
      fact_activo: !!p.fact_activo, fact_ruc: p.fact_ruc || '', fact_razon_social: p.fact_razon_social || '',
      fact_direccion: p.fact_direccion || '', fact_serie_boleta: p.fact_serie_boleta || 'B001',
      fact_serie_factura: p.fact_serie_factura || 'F001', fact_color: p.fact_color || '',
    })
    setLogo(null); setErr(''); setAbierto(true)
  }

  async function guardar(e) {
    e.preventDefault()
    setErr('')
    const ruc = f.fact_ruc.trim(), razon = f.fact_razon_social.trim().toUpperCase()
    const sb = f.fact_serie_boleta.trim().toUpperCase(), sf = f.fact_serie_factura.trim().toUpperCase()
    if (ruc && !rucValido(ruc)) return setErr('El RUC no es válido: son 11 dígitos y el último es verificador.')
    if (f.fact_activo && (!ruc || razon.length < 3)) return setErr('Para prender el facturador hacen falta el RUC y la razón social de quien factura.')
    if (!/^B[A-Z0-9]{3}$/.test(sb)) return setErr('La serie de boletas empieza con B y tiene 4 caracteres (B001).')
    if (!/^F[A-Z0-9]{3}$/.test(sf)) return setErr('La serie de facturas empieza con F y tiene 4 caracteres (F001).')
    setBusy(true)
    try {
      const payload = {
        fact_activo: f.fact_activo, fact_ruc: ruc || null, fact_razon_social: razon || null,
        fact_direccion: f.fact_direccion.trim().toUpperCase() || null,
        fact_serie_boleta: sb, fact_serie_factura: sf, fact_color: f.fact_color || null,
      }
      if (logo) payload.fact_logo_url = await subirRuta(`brand/factura-${p.id}-${Date.now()}.png`, await aPng(logo))
      const { error } = await supabase.from('projects').update(payload).eq('id', p.id)
      if (error) throw new Error(/fact_|schema cache/i.test(error.message) ? 'La base todavía no tiene el facturador (falta correr sql/113).' : error.message)
      setAbierto(false)
      setMsg?.({ ok: true, t: 'FACTURACIÓN DE ' + p.name + ' GUARDADA' })
      onGuardado?.()
    } catch (e2) { setErr(e2.message) }
    setBusy(false)
  }

  if (!hayBase) return null   // sql/113 sin correr: la sección no aparece
  const visto = emisorVisto(emisor)
  const logoActual = logoProyecto(p)

  return (
    <div className="cp-proyecto" style={{ '--cp': p.fact_color || 'var(--accent)' }}>
      <div className="cp-proyecto-fila">
        {logoActual && <img className="cp-proyecto-logo" src={logoActual} alt="" />}
        <div style={{ flex: 1, minWidth: 180 }}>
          <b>🧾 Boletas y facturas electrónicas</b>
          <div className="muted small" style={{ textTransform: 'none' }}>
            {p.fact_ruc
              ? <>Factura <b>{p.fact_razon_social}</b> · RUC {p.fact_ruc} · series {p.fact_serie_boleta} y {p.fact_serie_factura}</>
              : 'Todavía no se dijo quién factura los cobros de este proyecto.'}
          </div>
        </div>
        <span className={'cp-chip ' + (p.fact_activo ? 'cp-ok' : 'cp-gris')}>{p.fact_activo ? 'Prendido' : 'Apagado'}</span>
        {p.fact_ruc && (emisor === undefined ? null
          : !emisor ? <span className="cp-chip cp-aviso" title="Falta cargar el certificado y la clave SOL de este RUC en el servidor (agregar-emisor.sh)">Falta cargarlo en el servidor</span>
          : emisor.error ? <span className="cp-chip cp-mal" title={emisor.error}>El servidor no lo pudo cargar</span>
          : !visto ? <span className="cp-chip cp-aviso">El servidor no contesta</span>
          : emisor.ambiente === 'produccion' ? <span className="cp-chip cp-ok" title={'Certificado vigente hasta el ' + fechaPe(emisor.certificado_vence)}>En real</span>
          : <span className="cp-chip cp-aviso" title="Lo que se emita sale por el ambiente de pruebas de SUNAT: no tiene valor">En pruebas</span>)}
        {puedeEditar && <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => abierto ? setAbierto(false) : abrir()}>{abierto ? 'Cerrar' : 'Configurar'}</button>}
      </div>

      {abierto && f && (
        <form onSubmit={guardar} style={{ marginTop: 10 }}>
          <label className="cp-interruptor">
            <input type="checkbox" checked={f.fact_activo} onChange={e => setF(x => ({ ...x, fact_activo: e.target.checked }))} />
            <span><b>Usar el facturador en este proyecto.</b> Apagado, la boleta de cada cobro se sigue subiendo a mano como hasta ahora.</span>
          </label>
          <div className="form-grid">
            <label>RUC de quien factura
              <input value={f.fact_ruc} inputMode="numeric" maxLength={11} placeholder="11 dígitos"
                onChange={e => setF(x => ({ ...x, fact_ruc: e.target.value.replace(/\D/g, '') }))} />
            </label>
            <label>Razón social (como en la ficha RUC)
              <input value={f.fact_razon_social} onChange={e => setF(x => ({ ...x, fact_razon_social: e.target.value }))} />
            </label>
            <label className="span2">Domicilio fiscal <span className="muted small">(sale impreso en el comprobante)</span>
              <input value={f.fact_direccion} onChange={e => setF(x => ({ ...x, fact_direccion: e.target.value }))} />
            </label>
            <label>Serie de boletas
              <input value={f.fact_serie_boleta} maxLength={4} onChange={e => setF(x => ({ ...x, fact_serie_boleta: e.target.value }))} />
            </label>
            <label>Serie de facturas
              <input value={f.fact_serie_factura} maxLength={4} onChange={e => setF(x => ({ ...x, fact_serie_factura: e.target.value }))} />
            </label>
            <label>Logo de quien factura {p.fact_logo_url && <a href={p.fact_logo_url} target="_blank" rel="noreferrer" style={{ textTransform: 'none' }}>ver actual</a>}
              <input type="file" accept="image/*" onChange={e => setLogo(e.target.files[0] || null)} />
              <span className="muted small" style={{ textTransform: 'none' }}>Sale en la boleta y en el panel. Si no se sube, se usa el logo del proyecto.</span>
            </label>
            <label>Color de la marca
              <div className="color-pick">
                {COLORES.map(c => (
                  <button type="button" key={c} title={c} className={`color-op ${(f.fact_color || '').toLowerCase() === c.toLowerCase() ? 'on' : ''}`}
                    style={{ '--co': c }} onClick={() => setF(x => ({ ...x, fact_color: c }))} />
                ))}
                <input type="color" value={f.fact_color || '#D71920'} title="Otro color" className="color-libre"
                  onChange={e => setF(x => ({ ...x, fact_color: e.target.value }))} />
                {f.fact_color && <button type="button" className="link-btn" onClick={() => setF(x => ({ ...x, fact_color: '' }))}>quitar</button>}
              </div>
            </label>
          </div>
          <p className="muted small" style={{ textTransform: 'none' }}>
            Las series son nuevas para este sistema (las que empiezan con E son del portal de SUNAT y no sirven aquí).
            El certificado digital y la clave SOL de este RUC no se escriben aquí: se cargan una vez en el servidor.
          </p>
          {err && <p className="error" style={{ textTransform: 'none' }}>{err}</p>}
          <div className="acc-row">
            <button className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar facturación'}</button>
            <button type="button" className="btn-ghost" onClick={() => setAbierto(false)} disabled={busy}>Cancelar</button>
          </div>
        </form>
      )}
    </div>
  )
}
