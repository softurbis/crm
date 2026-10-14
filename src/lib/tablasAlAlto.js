import { useEffect } from 'react'

// LAS TABLAS CABEN EN LA PANTALLA (14 oct 2026, "la rueda para correr de derecha a
// izquierda está muy abajo, varios usuarios tienen problema").
// Cada .table-wrap scrollea dentro de su caja (así el encabezado queda fijo), y la
// barra para correr de costado está al PIE de esa caja. Con un alto fijo
// (100vh - 220px) la caja terminaba por debajo del borde de la pantalla cuando arriba
// había más cosas (avisos, filtros): la barra quedaba escondida y la rueda, encima de
// la tabla, movía la tabla y no la página. Ahora el alto se calcula con lo que de
// verdad queda debajo de donde empieza la tabla: el pie de la caja (y su barra) queda
// siempre a la vista.
//
// No se tocan: las tablas de las ventanas (.modal), la del cronograma de la ficha
// (.fl-tabla, crece con la página) ni las que ya traen su alto puesto en el código.
const AIRE = 56          // debajo de la tabla: el paginador y un respiro
const MINIMO = 300

function ajustar() {
  const vh = window.innerHeight
  for (const el of document.querySelectorAll('main.content .table-wrap')) {
    if (el.classList.contains('fl-tabla') || el.closest('.modal')) continue
    // un alto puesto por la pantalla misma (no por aquí) manda
    if (el.style.maxHeight && el.dataset.alto !== '1') continue
    const top = el.getBoundingClientRect().top + window.scrollY
    // si la tabla empieza muy abajo (un formulario abierto arriba), se la deja del
    // alto de la pantalla: al bajar hasta ella, entra completa
    const alto = top + MINIMO <= vh ? vh - top - AIRE : vh - 120
    el.style.maxHeight = Math.max(MINIMO, Math.round(alto)) + 'px'
    el.dataset.alto = '1'
  }
}

export function useTablasAlAlto(clave) {
  useEffect(() => {
    let pendiente = 0
    const pedir = () => { if (!pendiente) pendiente = requestAnimationFrame(() => { pendiente = 0; ajustar() }) }
    pedir()
    window.addEventListener('resize', pedir)
    // las tablas aparecen cuando llegan los datos, y lo de arriba cambia de alto
    // (un aviso, un filtro): se vuelve a medir. Solo cambios en el contenido, no en
    // los estilos: el alto que pone esta función no la vuelve a disparar.
    const main = document.querySelector('main.content')
    const mo = main ? new MutationObserver(pedir) : null
    mo?.observe(main, { childList: true, subtree: true })
    return () => { window.removeEventListener('resize', pedir); mo?.disconnect(); if (pendiente) cancelAnimationFrame(pendiente) }
  }, [clave])
}
