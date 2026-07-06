-- ============================================================
-- SQL-SEGURIDAD-RLS.sql  |  URBIS CONTROL v2
-- ENDURECIMIENTO DE SEGURIDAD: politicas RLS por rol.
--
-- ANTES: cualquier usuario logueado podia escribir CUALQUIER tabla
--        via API (los roles solo se validaban en la pantalla).
-- AHORA: la base de datos valida el rol en cada operacion.
--
-- * El agente WhatsApp NO se ve afectado (usa service key, salta RLS).
-- * Ejecutar COMPLETO en Supabase > SQL Editor > Run (es 1 transaccion:
--   si algo falla, no cambia nada).
-- * Despues de correrlo: probar login con CADA rol (superusuario,
--   administrador, secretaria, gerencia) y navegar el panel.
-- * Si algo se rompe: bloque de REVERSION comentado al final.
--
-- Reglas aplicadas (espejo de lo acordado en el panel):
--   SUPERUSER  todo + exclusivo: usuarios, asignaciones, seguimiento
--              (personas), bitacora (lectura), eliminar pagos/lotes
--   ADMIN      operacion completa; no usuarios ni bitacora
--   SECRETARY  opera (pagos, clientes, separaciones, ventas, gastos,
--              visitas, tareas propias); no whatsapp, no borrar
--   MANAGER    solo lectura general + marcar SUS propias tareas
-- ============================================================

-- ---------- 1) limpiar TODAS las politicas actuales ----------
do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in (
      'profiles','projects','financial_accounts','project_assignments','lots',
      'clients','separations','sales','installments','daily_income','expenses',
      'activity_log','lot_status_changes','advisors','commissions',
      'secretaries','secretary_routines','secretary_tasks','seguimiento_access',
      'visits','leads','whatsapp_conversations','whatsapp_messages',
      'whatsapp_numbers','scheduled_messages','bot_settings','bot_brains')
  loop
    execute format('drop policy if exists %I on %I', p.policyname, p.tablename);
  end loop;
end $$;

-- ---------- 2) funcion de rol (security definer: lee profiles sin recursion) ----------
drop function if exists get_user_role() cascade;
create function get_user_role() returns text
language sql stable security definer set search_path = public as
$$ select role::text from profiles where id = auth.uid() $$;

drop function if exists es_super() cascade;
create function es_super() returns boolean language sql stable as
$$ select get_user_role() = 'superuser' $$;

drop function if exists es_admin() cascade;
create function es_admin() returns boolean language sql stable as
$$ select get_user_role() in ('superuser','admin') $$;

drop function if exists es_staff() cascade;
create function es_staff() returns boolean language sql stable as
$$ select get_user_role() in ('superuser','admin','secretary') $$;

-- ---------- 3) activar RLS en todo (idempotente, salta tablas inexistentes) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','projects','financial_accounts','project_assignments','lots',
    'clients','separations','sales','installments','daily_income','expenses',
    'activity_log','lot_status_changes','advisors','commissions',
    'secretaries','secretary_routines','secretary_tasks','seguimiento_access',
    'visits','leads','whatsapp_conversations','whatsapp_messages',
    'whatsapp_numbers','scheduled_messages','bot_settings','bot_brains']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table %I enable row level security', t);
    end if;
  end loop;
end $$;

-- ---------- 4) politicas por tabla ----------

-- PROFILES: todos leen (nombres en vinculos/selects); solo superuser escribe.
-- Nadie puede cambiarse el rol a si mismo.
create policy profiles_sel on profiles for select to authenticated using (true);
create policy profiles_ins on profiles for insert to authenticated with check (es_super());
create policy profiles_upd on profiles for update to authenticated using (es_super());
create policy profiles_del on profiles for delete to authenticated using (es_super());

-- PROYECTOS y CUENTAS: lectura general; escribe admin/superuser
create policy projects_sel on projects for select to authenticated using (true);
create policy projects_wr  on projects for insert to authenticated with check (es_admin());
create policy projects_up  on projects for update to authenticated using (es_admin());
create policy projects_del on projects for delete to authenticated using (es_super());
create policy finacc_sel on financial_accounts for select to authenticated using (true);
create policy finacc_wr  on financial_accounts for insert to authenticated with check (es_admin());
create policy finacc_up  on financial_accounts for update to authenticated using (es_admin());
create policy finacc_del on financial_accounts for delete to authenticated using (es_admin());

-- ASIGNACIONES DE PROYECTO: cada quien lee (el panel filtra con esto); escribe superuser
create policy passign_sel on project_assignments for select to authenticated using (true);
create policy passign_ins on project_assignments for insert to authenticated with check (es_super());
create policy passign_del on project_assignments for delete to authenticated using (es_super());

-- LOTES: lee todos; crea admin; edita staff (separar/vender actualiza estado); borra superuser
create policy lots_sel on lots for select to authenticated using (true);
create policy lots_ins on lots for insert to authenticated with check (es_admin());
create policy lots_upd on lots for update to authenticated using (es_staff());
create policy lots_del on lots for delete to authenticated using (es_super());

-- CLIENTES: lee todos (vista macro); escribe staff (gerencia NO)
create policy clients_sel on clients for select to authenticated using (true);
create policy clients_ins on clients for insert to authenticated with check (es_staff());
create policy clients_upd on clients for update to authenticated using (es_staff());
create policy clients_del on clients for delete to authenticated using (es_admin());

-- SEPARACIONES: lee todos; registra/completa staff; borra admin
create policy seps_sel on separations for select to authenticated using (true);
create policy seps_ins on separations for insert to authenticated with check (es_staff());
create policy seps_upd on separations for update to authenticated using (es_staff());
create policy seps_del on separations for delete to authenticated using (es_admin());

-- VENTAS y CUOTAS: lee todos; escribe staff; borra admin
create policy sales_sel on sales for select to authenticated using (true);
create policy sales_ins on sales for insert to authenticated with check (es_staff());
create policy sales_upd on sales for update to authenticated using (es_staff());
create policy sales_del on sales for delete to authenticated using (es_admin());
create policy inst_sel on installments for select to authenticated using (true);
create policy inst_ins on installments for insert to authenticated with check (es_staff());
create policy inst_upd on installments for update to authenticated using (es_staff());
create policy inst_del on installments for delete to authenticated using (es_admin());

-- PAGOS (daily_income): lee todos; registra/edita staff; ELIMINA solo superuser
create policy dinc_sel on daily_income for select to authenticated using (true);
create policy dinc_ins on daily_income for insert to authenticated with check (es_staff());
create policy dinc_upd on daily_income for update to authenticated using (es_staff());
create policy dinc_del on daily_income for delete to authenticated using (es_super());

-- GASTOS: lee todos; solicita/confirma staff; elimina admin
create policy exp_sel on expenses for select to authenticated using (true);
create policy exp_ins on expenses for insert to authenticated with check (es_staff());
create policy exp_upd on expenses for update to authenticated using (es_staff());
create policy exp_del on expenses for delete to authenticated using (es_admin());

-- BITACORA: INMUTABLE. Todos insertan (el sistema registra), solo superuser lee.
-- Sin politicas de update/delete = nadie puede alterarla.
create policy alog_ins on activity_log for insert to authenticated with check (true);
create policy alog_sel on activity_log for select to authenticated using (es_super());

-- CAMBIOS DE ESTADO DE LOTE: lee todos (historial en ficha); inserta admin
create policy lsc_sel on lot_status_changes for select to authenticated using (true);
create policy lsc_ins on lot_status_changes for insert to authenticated with check (es_admin());

-- ASESORES y COMISIONES: lee todos; asesores los maneja admin;
-- la comision se inserta al registrar la venta (staff) y se paga/edita admin
create policy adv_sel on advisors for select to authenticated using (true);
create policy adv_ins on advisors for insert to authenticated with check (es_staff());
create policy adv_upd on advisors for update to authenticated using (es_admin());
create policy adv_del on advisors for delete to authenticated using (es_admin());
create policy comm_sel on commissions for select to authenticated using (true);
create policy comm_ins on commissions for insert to authenticated with check (es_staff());
create policy comm_upd on commissions for update to authenticated using (es_staff());
create policy comm_del on commissions for delete to authenticated using (es_admin());

-- SEGUIMIENTO (personas): lee todos; SOLO SUPERUSER registra/edita/quita personas
create policy secs_sel on secretaries for select to authenticated using (true);
create policy secs_ins on secretaries for insert to authenticated with check (es_super());
create policy secs_upd on secretaries for update to authenticated using (es_super());
create policy secs_del on secretaries for delete to authenticated using (es_super());

-- RUTINAS: lee todos; programa admin o el dueno vinculado (su propia rutina)
create policy secr_sel on secretary_routines for select to authenticated using (true);
create policy secr_ins on secretary_routines for insert to authenticated
  with check (es_admin() or exists (
    select 1 from secretaries s where s.id = secretary_id and s.user_id = auth.uid()));
create policy secr_upd on secretary_routines for update to authenticated
  using (es_admin() or exists (
    select 1 from secretaries s where s.id = secretary_routines.secretary_id and s.user_id = auth.uid()));
create policy secr_del on secretary_routines for delete to authenticated
  using (es_admin() or exists (
    select 1 from secretaries s where s.id = secretary_routines.secretary_id and s.user_id = auth.uid()));

-- TAREAS: lee todos; crea staff (separaciones crean recordatorio);
-- actualiza admin O el dueno vinculado (secretaria/gerencia marca LO SUYO); borra admin
create policy sect_sel on secretary_tasks for select to authenticated using (true);
create policy sect_ins on secretary_tasks for insert to authenticated
  with check (es_staff() or exists (
    select 1 from secretaries s where s.id = secretary_id and s.user_id = auth.uid()));
create policy sect_upd on secretary_tasks for update to authenticated
  using (es_admin() or exists (
    select 1 from secretaries s
    where s.id = secretary_tasks.secretary_id and s.user_id = auth.uid()));
create policy sect_del on secretary_tasks for delete to authenticated
  using (es_admin() or exists (
    select 1 from secretaries s
    where s.id = secretary_tasks.secretary_id and s.user_id = auth.uid()));

-- ACCESOS "VE A": lee todos (el panel filtra con esto); escribe superuser
create policy segacc_sel on seguimiento_access for select to authenticated using (true);
create policy segacc_ins on seguimiento_access for insert to authenticated with check (es_super());
create policy segacc_del on seguimiento_access for delete to authenticated using (es_super());

-- VISITAS: lee todos; registra/gestiona staff (gerencia solo ve); borra admin
create policy vis_sel on visits for select to authenticated using (true);
create policy vis_ins on visits for insert to authenticated with check (es_staff());
create policy vis_upd on visits for update to authenticated using (es_staff());
create policy vis_del on visits for delete to authenticated using (es_admin());

-- WHATSAPP BOT (leads, chats, numeros, programados, ajustes, cerebros):
-- SOLO admin/superuser — secretaria y gerencia no ven este modulo
create policy leads_all on leads for all to authenticated
  using (es_admin()) with check (es_admin());
create policy wconv_all on whatsapp_conversations for all to authenticated
  using (es_admin()) with check (es_admin());
create policy wmsg_all on whatsapp_messages for all to authenticated
  using (es_admin()) with check (es_admin());
create policy wnum_all on whatsapp_numbers for all to authenticated
  using (es_admin()) with check (es_admin());
create policy smsg_all on scheduled_messages for all to authenticated
  using (es_admin()) with check (es_admin());
create policy bset_sel on bot_settings for select to authenticated using (true);
create policy bset_wr  on bot_settings for insert to authenticated with check (es_admin());
create policy bset_up  on bot_settings for update to authenticated using (es_admin());
create policy bset_del on bot_settings for delete to authenticated using (es_admin());
create policy bbrain_sel on bot_brains for select to authenticated using (es_admin());
create policy bbrain_wr  on bot_brains for insert to authenticated with check (es_admin());
create policy bbrain_up  on bot_brains for update to authenticated using (es_admin());

-- ============================================================
-- NOTAS
-- * Storage (bucket urbis-files): sus politicas se manejan aparte en
--   Storage > Policies. No se tocaron aqui.
-- * PENDIENTE MANUAL DE SEGURIDAD: rotar la contrasena root del droplet
--   (DigitalOcean > droplet > Access > Reset root password).
--
-- ---------- REVERSION DE EMERGENCIA (solo si algo se rompe) ----------
-- Descomenta y corre esto para volver al modo permisivo anterior:
--
-- do $$
-- declare t text; p record;
-- begin
--   foreach t in array array[
--     'profiles','projects','financial_accounts','project_assignments','lots',
--     'clients','separations','sales','installments','daily_income','expenses',
--     'activity_log','lot_status_changes','advisors','commissions',
--     'secretaries','secretary_routines','secretary_tasks','seguimiento_access',
--     'visits','leads','whatsapp_conversations','whatsapp_messages',
--     'whatsapp_numbers','scheduled_messages','bot_settings','bot_brains']
--   loop
--     if to_regclass('public.' || t) is null then continue; end if;
--     for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
--       execute format('drop policy if exists %I on %I', p.policyname, t);
--     end loop;
--     execute format('create policy %I on %I for all to authenticated using (true) with check (true)', t || '_open', t);
--   end loop;
-- end $$;
-- ============================================================
