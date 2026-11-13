# Reportero del panel de C-Soft — lo que falta hacer a mano

`panel_reporte.js` ya está en el repositorio. Falta, en este orden:

## 1. Registrar el proceso en el servidor (una sola vez)

Después de publicar (push) y de correr el comando de siempre (`07_actualizar_agente.sh`,
que baja el código):

```bash
ssh root@157.245.8.78 'cd /root/crm/agente && pm2 start panel_reporte.js --name panel-reporte && pm2 save && pm2 logs panel-reporte --lines 5 --nostream'
```

Tiene que decir `[panel-reporte] corriendo · ... sin PANEL_REPORTE_CLAVE: en espera, no envía nada`.

## 2. Poner la clave (cuando el panel de C-Soft la entregue)

En el servidor, `nano /root/crm/agente/.env` y agregar (la clave no pasa por el chat):

```
PANEL_REPORTE_CLAVE=la-clave-que-muestra-el-panel
```

No hay que reiniciar nada: el reportero la toma en el minuto siguiente. Para comprobar:

```bash
ssh root@157.245.8.78 'cd /root/crm/agente && node panel_reporte.js --una-vez'
```

Debe decir `reporte completo enviado`. Si dice `el panel respondió 401`, la clave o el
nombre del sistema (`urbis-crm`) no coinciden con lo registrado en el panel.

## 3. (Opcional) Que el script 07 también lo cuide

No se tocó `migracion/07_actualizar_agente.sh` (no está en git y es el script de
despliegue de los bots). No hace falta: el reportero se reinicia solo cuando cambia su
archivo. Si se quiere que el 07 lo registre en un servidor nuevo y lo muestre al final,
agregar este bloque **después del paso 5 y antes de `pm2 save`**:

```bash
echo ""
echo "=== 5b. Reportero del panel de C-Soft ==="
if pm2 describe panel-reporte >/dev/null 2>&1; then
  pm2 restart panel-reporte --update-env || echo "⚠ no se pudo reiniciar panel-reporte (no afecta a los bots)"
else
  pm2 start panel_reporte.js --name panel-reporte || echo "⚠ no se pudo iniciar panel-reporte (no afecta a los bots)"
fi
```

(En ese punto el script ya está parado en `/root/crm/agente`.) Y en el paso 6, sumar
`|panel-reporte` al `grep -E` de `pm2 list`.

## 4. No implementado: los botones del panel (contrato v1.1, CONTROLES)

El reportero **solo informa**. No declara `controles` y no atiende las `ordenes` que
vengan en la respuesta del panel. El estado del agente de cobranza va como ficha
informativa ("Prendido" / "Modo prueba" / "Apagado"). Que el panel de C-Soft pueda
prender o apagar algo de Urbis queda pendiente de una decisión expresa de César.
