// ============================================================================
// QUIEN ESCRIBE AL 960: ¿cliente o lead?  — la regla del reparto   [27 oct 2026]
// ----------------------------------------------------------------------------
// El +51 960 487 000 (Praderas de Cashibo) es desde el 27 oct el numero unico de
// cobranza y consultas de TODOS los proyectos, conectado en COEXISTENCIA: cada
// mensaje le llega dos veces, por Baileys (index.js / leads_api.js) y por la API
// oficial de Meta (cobranza.js, reenviada por el conector de C-Soft).
//
// Decision del dueno (27 oct 2026): NUNCA contestan los dos.
//   · El telefono esta en la ficha de un cliente de CUALQUIER proyecto
//     (clients.phone o clients.phone2, validado o no)  → contesta el agente de
//     cobranza por la API; Baileys se calla en ese chat.
//   · No esta en ninguna ficha                           → es lead: lo atiende el
//     bot de ventas por Baileys; la API lo ignora.
//
// Los dos lados usan ESTA funcion, para que la frontera sea una sola. Si la
// ficha tiene el celular pero sin validar, igual es territorio del agente: el
// agente contesta con su texto fijo (NO_REGISTRADO) y pasa el chat a la
// secretaria; Baileys no dice nada. Lo que se valida aqui es la pertenencia,
// no el permiso de dar datos (eso sigue en clientesDelTelefono de cobranza.js).
// ============================================================================
const nueve = t => String(t || '').replace(/\D/g, '').slice(-9)

// Fichas (id, nombre) cuyo celular principal o secundario termina en estos 9 digitos.
async function clientesRegistrados(supabase, phone) {
  const p9 = nueve(phone)
  if (p9.length < 9) return []
  const { data, error } = await supabase.from('clients')
    .select('id, full_name, phone, phone2')
    .or(`phone.ilike.%${p9}%,phone2.ilike.%${p9}%`).limit(20)
  if (error) throw new Error('clientes: ' + error.message)
  return (data || []).filter(c => nueve(c.phone) === p9 || nueve(c.phone2) === p9)
}

// true = territorio del agente de cobranza (API); false = lead, territorio de Baileys.
// Ante un error de la base devuelve false: mejor que lo atienda el bot de ventas a
// que nadie conteste (el agente, por su lado, tambien lo ignora en ese caso).
async function esClienteRegistrado(supabase, phone) {
  try { return (await clientesRegistrados(supabase, phone)).length > 0 }
  catch (e) { return false }
}

module.exports = { clientesRegistrados, esClienteRegistrado, nueve }
