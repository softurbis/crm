-- ============ SECRETARIAS V3: sin limite, tipo gerencia, seguimiento por persona, usuario vinculado ============
alter table secretaries add column if not exists tipo text not null default 'secretaria';
alter table secretaries add column if not exists seguimiento boolean not null default true;
alter table secretaries add column if not exists user_id uuid;
