# AGENTE URBIS (WhatsApp)

Corre en una PC que quede prendida (o un servidor). Se conecta a TU WhatsApp escaneando un QR (como WhatsApp Web).

## Que hace
1. **Cobranza automatica**: todos los dias a la hora configurada envia recordatorios a las cuotas que vencen en 3 dias y re-avisa las vencidas (cada X dias). Nunca duplica avisos. Todo queda registrado.
2. **Filtro de leads**: si escribe un numero desconocido, lo saluda, le pide nombre y proyecto de interes, CREA EL LEAD EN EL KANBAN y avisa al administrador. Si escribe un cliente diciendo "ya pague", le responde y te reenvia el aviso.

## Puesta en marcha (una sola vez)
1. Instalar Node.js en la PC donde correra.
2. En esta carpeta: copiar `.env.example` como `.env` y completar:
   - SUPABASE_SERVICE_KEY: la clave `sb_secret_...` (Supabase > Settings > API). ES SECRETA.
   - ADMIN_PHONE: tu numero con 51 adelante (recibes los avisos del agente).
3. Doble clic a `INICIAR-AGENTE.bat` (la primera vez instala todo).
4. Aparecera un QR: escanealo con el WhatsApp DEL CHIP DEDICADO (Dispositivos vinculados > Vincular dispositivo).
5. Listo. Deja la ventana abierta. Para probar la cobranza sin esperar: pon RUN_NOW=1 en .env y reinicia.

## Anti-baneo
- Usa un CHIP NUEVO dedicado, nunca tu numero personal principal.
- El agente espacia envios 20-45 s y tiene tope diario (MAX_ENVIOS_DIA).
- La primera semana deja el tope bajo (10-15) para "calentar" el numero.

## IMPORTANTE
- La carpeta `auth/` guarda la sesion de WhatsApp y `.env` la clave maestra: JAMAS se suben a GitHub (ya estan en .gitignore).
- Si cierras sesion desde el telefono, borra la carpeta `auth/` y vuelve a escanear.

## Reportero del panel de C-Soft (`panel_reporte.js`)
Proceso aparte (pm2 `panel-reporte`) que cada minuto manda un latido a `panel.csoft.men` y cada 5 minutos un resumen de SOLO TOTALES (cobrado, cuotas vencidas, ventas, leads, estado del agente de cobranza). No lleva nombres, telefonos ni DNI; solo lee la base y no atiende ordenes del panel.
- Se registra una vez: `cd /root/crm/agente && pm2 start panel_reporte.js --name panel-reporte && pm2 save`.
- Sin `PANEL_REPORTE_CLAVE` en el `.env` no hace nada. La clave se pega con `nano .env` y se toma sola en un minuto (no hay que reiniciar).
- Cuando un `git pull` trae una version nueva del archivo, el proceso se reinicia solo.
- Probar a mano: `node panel_reporte.js --una-vez`. Errores: `pm2 logs panel-reporte` (prefijo `[panel-reporte]`).
