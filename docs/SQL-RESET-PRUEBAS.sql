-- ============================================================
-- SQL-RESET-PRUEBAS.sql  |  URBIS CONTROL v2
-- Deja el sistema cuadrado HASTA EL 30 DE JUNIO 2026:
--  * borra TODO pago y gasto con fecha de julio
--  * borra ventas/separaciones/clientes DE PRUEBA (creados desde el 04-jul;
--    la data real se migro el 02-jul y no se toca)
--  * revierte las cuotas que esos pagos habian marcado como pagadas
--  * visitas, bot, chats y seguimiento a CERO (las personas registradas
--    y sus vinculos se quedan)
-- RE-EJECUTABLE: corre completo cada vez que quieras limpiar pruebas.
-- Supabase > SQL Editor > Run.
-- ============================================================

-- 1) revertir cuotas afectadas por pagos con fecha de julio
update installments i set
  amount_paid = greatest(0, i.amount_paid - x.total),
  status = (case
    when (i.amount_paid - x.total) <= 0.01 then 'pendiente'
    when (i.amount - (i.amount_paid - x.total)) <= 2 then 'pagado'
    else 'pendiente' end)::installment_status,
  paid_date = case when (i.amount_paid - x.total) <= 0.01 then null else i.paid_date end
from (
  select installment_id, sum(amount) as total
  from daily_income
  where date >= '2026-07-01' and installment_id is not null
  group by installment_id
) x
where i.id = x.installment_id;

-- 2) borrar TODOS los pagos con fecha de julio
delete from daily_income where date >= '2026-07-01';

-- 3) ventas de prueba (creadas desde el 04-jul): pagos sueltos, comisiones,
--    cuotas, liberar lote y borrar la venta
delete from daily_income where sale_id in (select id from sales where created_at >= '2026-07-04');
delete from commissions  where sale_id in (select id from sales where created_at >= '2026-07-04');
delete from installments where sale_id in (select id from sales where created_at >= '2026-07-04');
update lots set status = 'disponible'
where id in (select lot_id from sales where created_at >= '2026-07-04');
delete from sales where created_at >= '2026-07-04';

-- 3b) separaciones de prueba: pagos ligados, recordatorios, liberar lote y borrar
delete from daily_income where separation_id in (
  select id from separations
  where created_at >= '2026-07-04'
     or client_id in (select id from clients where created_at >= '2026-07-04'));
delete from secretary_tasks where separation_id in (
  select id from separations
  where created_at >= '2026-07-04'
     or client_id in (select id from clients where created_at >= '2026-07-04'));
update lots set status = 'disponible'
where id in (select lot_id from separations
             where created_at >= '2026-07-04'
                or client_id in (select id from clients where created_at >= '2026-07-04'));
delete from separations
where created_at >= '2026-07-04'
   or client_id in (select id from clients where created_at >= '2026-07-04');

-- 4) clientes de prueba que quedaron sin ventas ni separaciones
delete from clients where created_at >= '2026-07-04'
  and id not in (select client_id from sales where client_id is not null)
  and id not in (select co_client_id from sales where co_client_id is not null)
  and id not in (select client_id from separations where client_id is not null);

-- 5) historial de cambios de estado de prueba
delete from lot_status_changes where changed_at >= '2026-07-04';

-- 6) gastos de julio + la numeracion SOL- continua desde el maximo real
delete from expenses where issue_date >= '2026-07-01' and issue_date < '2026-08-01';
select setval('expenses_request_seq', coalesce((select max(request_number) from expenses), 0) + 1, false);

-- 7) visitas a cero (todas son de prueba)
delete from visits;

-- 8) bot y chats a cero
delete from whatsapp_messages;
delete from whatsapp_conversations;
delete from scheduled_messages;
delete from leads;

-- 9) seguimiento a cero (tareas y rutinas; las PERSONAS y vinculos se quedan)
delete from secretary_tasks;
delete from secretary_routines;
update secretaries set feedback_asked = null, feedback_done = null;

-- ============================================================
-- VERIFICACION rapida (opcional, correr aparte):
-- select count(*) from daily_income where date >= '2026-07-01';   -- 0
-- select count(*) from sales where created_at >= '2026-07-04';    -- 0
-- select count(*) from separations where status = 'vigente';      -- solo reales
-- select count(*) from expenses where issue_date >= '2026-07-01'; -- 0
-- ============================================================
