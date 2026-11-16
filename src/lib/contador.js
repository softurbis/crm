// Avisos al contador de visitas de la web (sql/231). El contador es un archivo suelto
// (sitio-publico/contador.js) que solo carga la web pública: en el panel (vista previa
// de un landing en borrador) window.urbisContador no existe y esto no hace nada, así
// el personal no se cuenta. Las vistas y los clics en WhatsApp/teléfono/mapa/redes los
// cuenta solo; aquí van los que no son un enlace: 'formulario', 'plano', 'recorrido'.
export function contar(tipo, detalle) {
  try { window.urbisContador?.evento(tipo, detalle) } catch { /* que no se note */ }
}
