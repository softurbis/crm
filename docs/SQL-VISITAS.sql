-- ============ MODULO VISITAS ============
create table if not exists visits (
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
