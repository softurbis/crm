import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// LA BOLETA O FACTURA DEL CLIENTE, PÚBLICA: urbisgroupinmobiliaria.com/c/<clave>  (sql/153)
// Es el enlace corto que va en el WhatsApp. No pide sesión, a propósito (como el de
// El Cholao): quien tiene el mensaje tiene derecho a su comprobante. Lo que protege
// es la CLAVE, 22 caracteres al azar; sin clave válida se ve "no existe" y nada más.
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fecha = d => d ? d.split('-').reverse().join('/') : ''
const esImagen = u => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u || '')
const TITULO = { boleta: 'Boleta de venta', factura: 'Factura', nota_credito: 'Nota de crédito', nota_debito: 'Nota de débito' }

function concepto(c) {
  const cu = c.cuotas || []
  const partes = []
  if (cu.length === 1) partes.push('Cuota N° ' + cu[0])
  else if (cu.length > 1) partes.push('Cuotas N° ' + cu.slice(0, -1).join(', ') + ' y ' + cu[cu.length - 1])
  for (const t of c.tipos || []) partes.push({ inicial: 'Inicial', separacion: 'Separación', mora: 'Mora' }[t] || 'Pago')
  return partes.join(' y ')
}

export default function ComprobantePublico() {
  const { token } = useParams()
  const [c, setC] = useState(undefined)   // undefined = cargando · null = no existe
  useEffect(() => {
    supabase.rpc('recibo_publico', { p_token: token }).then(({ data, error }) => setC(error ? null : (data || null)))
  }, [token])
  useEffect(() => { if (c?.proyecto) document.title = (TITULO[c.tipo] || 'Comprobante') + ' · ' + c.proyecto }, [c])

  const color = c?.color || '#2e7d4f'
  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f4', color: '#1d2a22', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', padding: '16px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {c === undefined && <p style={{ textAlign: 'center', marginTop: '30vh', color: '#667' }}>Cargando…</p>}
        {c === null && (
          <div style={{ textAlign: 'center', marginTop: '25vh' }}>
            <h1 style={{ fontSize: 22 }}>Este comprobante no existe</h1>
            <p style={{ color: '#667' }}>Revisa que el enlace esté completo, tal como te llegó por WhatsApp.</p>
          </div>
        )}
        {c && (<>
          <div style={{ background: '#fff', borderRadius: 14, padding: '16px 18px', boxShadow: '0 1px 6px rgba(0,0,0,.08)', borderTop: '5px solid ' + color }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {c.logo && <img src={c.logo} alt="" style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 8 }} />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: '#667' }}>{c.proyecto}</div>
                <h1 style={{ margin: '2px 0 0', fontSize: 20 }}>{TITULO[c.tipo] || 'Comprobante de pago'}{c.serie_numero ? ' ' + c.serie_numero : ''}</h1>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px 16px', marginTop: 14, fontSize: 14 }}>
              {c.cliente && <div><div style={{ color: '#667', fontSize: 12 }}>Cliente</div><b>{c.cliente}</b></div>}
              {concepto(c) && <div><div style={{ color: '#667', fontSize: 12 }}>Concepto</div><b>{concepto(c)}</b></div>}
              <div><div style={{ color: '#667', fontSize: 12 }}>Monto</div><b>{soles(c.total)}</b></div>
              {c.fecha && <div><div style={{ color: '#667', fontSize: 12 }}>Fecha del pago</div><b>{fecha(c.fecha)}</b></div>}
            </div>
            <a href={c.url} target="_blank" rel="noreferrer" download
              style={{ display: 'block', textAlign: 'center', marginTop: 16, padding: '12px', borderRadius: 10, background: color, color: '#fff', fontWeight: 700, textDecoration: 'none' }}>
              ⬇ Descargar {esImagen(c.url) ? 'la imagen' : 'el PDF'}
            </a>
          </div>
          <div style={{ marginTop: 14, background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,.08)' }}>
            {esImagen(c.url)
              ? <img src={c.url} alt="Comprobante" style={{ width: '100%', display: 'block' }} />
              : <iframe src={c.url} title="Comprobante" style={{ width: '100%', height: '75vh', border: 0, display: 'block' }} />}
          </div>
          <p style={{ textAlign: 'center', color: '#889', fontSize: 12, marginTop: 14 }}>Gracias por su pago · {c.proyecto}</p>
        </>)}
      </div>
    </div>
  )
}
