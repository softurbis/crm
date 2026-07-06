-- ============ V4: quien puede ver a quien en el modulo Seguimiento ============
create table if not exists seguimiento_access (
  user_id uuid not null,
  secretary_id uuid not null references secretaries(id) on delete cascade,
  primary key (user_id, secretary_id)
);
alter table seguimiento_access enable row level security;
drop policy if exists segacc_all on seguimiento_access;
create policy segacc_all on seguimiento_access for all to authenticated using (true) with check (true);
