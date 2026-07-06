-- ============================================================
-- SQL-COMISIONES.sql  |  URBIS CONTROL v2
-- Modulo de comisiones de vendedores/asesores. IDEMPOTENTE:
-- se puede correr aunque las tablas ya existan de la migracion.
-- Ejecutar en Supabase > SQL Editor.
-- ============================================================

-- Asesores (ya existe en produccion; por si acaso)
create table if not exists advisors (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  full_name text,
  active boolean not null default true,
  created_at timestamptz default now()
);

-- Comisiones (una por venta)
create table if not exists commissions (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references sales(id) on delete cascade,
  advisor_id uuid references advisors(id),
  amount numeric not null default 0,
  status text not null default 'pendiente',   -- pendiente | pagada
  rh_number text,                             -- recibo por honorarios que corrobora el pago
  rh_url text,                                -- archivo del RH (storage urbis-files/rh/)
  paid_date date,
  notes text,
  created_at timestamptz default now()
);

-- Columnas por si la tabla existia con otra forma
alter table commissions add column if not exists sale_id uuid references sales(id) on delete cascade;
alter table commissions add column if not exists advisor_id uuid references advisors(id);
alter table commissions add column if not exists amount numeric default 0;
alter table commissions add column if not exists status text default 'pendiente';
alter table commissions add column if not exists rh_number text;
alter table commissions add column if not exists rh_url text;
alter table commissions add column if not exists paid_date date;
alter table commissions add column if not exists notes text;
alter table commissions add column if not exists created_at timestamptz default now();

create index if not exists idx_commissions_sale on commissions(sale_id);
create index if not exists idx_commissions_advisor on commissions(advisor_id);
-- Una sola comision por venta (si falla: hay duplicados, limpiar antes)
create unique index if not exists uq_commissions_sale on commissions(sale_id);

alter table commissions enable row level security;
drop policy if exists "commissions_auth" on commissions;
create policy "commissions_auth" on commissions
  for all to authenticated using (true) with check (true);
-- NOTA: politica temporal igual al resto del sistema; se endurece con SQL-SEGURIDAD-RLS.sql (pendiente 8).
