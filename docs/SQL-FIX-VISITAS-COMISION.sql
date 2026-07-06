-- ============================================================
-- SQL-FIX-VISITAS-COMISION.sql  |  URBIS CONTROL v2
-- 1) VISITAS: el esquema inicial habia creado una tabla "visits" vieja
--    (por eso el error "client_name column not found"). Se recrea con
--    la forma correcta del modulo nuevo. Las visitas son data de prueba,
--    no se pierde nada real.
-- 2) COMISIONES: monto de comision URBIS ademas del monto del asesor.
-- Ejecutar en Supabase > SQL Editor > Run. IDEMPOTENTE.
-- ============================================================

-- 1) recrear la tabla de visitas con la forma correcta
drop table if exists visit_reschedules;
drop table if exists visits cascade;
create table visits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  client_name text not null,
  client_phone text not null,
  encargado_name text,
  encargado_phone text not null,
  date date not null,
  time time not null,
  meeting_point text not null,
  notes text,
  status text not null default 'programada' check (status in ('programada','realizada','cancelada','no_asistio')),
  reminded_at timestamptz,
  created_by uuid,
  created_at timestamptz default now()
);
alter table visits enable row level security;
drop policy if exists visits_all on visits;
create policy visits_all on visits for all to authenticated using (true) with check (true);

-- 2) doble comision: monto Urbis (el del asesor ya existe como "amount")
alter table commissions add column if not exists urbis_amount numeric not null default 0;
