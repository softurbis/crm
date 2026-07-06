-- ============================================================
-- SQL-SEPARACIONES.sql  |  URBIS CONTROL v2
-- Separaciones con vencimiento, bloqueo de lote y recordatorios.
-- IDEMPOTENTE: se puede correr varias veces sin danar nada.
-- Ejecutar en Supabase > SQL Editor > Run.
-- ============================================================

-- columnas nuevas en separations
alter table separations add column if not exists advisor_id uuid references advisors(id);
alter table separations add column if not exists created_by uuid references profiles(id);
alter table separations add column if not exists aviso_previo_at timestamptz;   -- ya se aviso "por vencer"
alter table separations add column if not exists aviso_vencida_at timestamptz;  -- ya se aviso "vencida"

-- tareas del control de actividades ligadas a una separacion
-- (se crean al separar; si se extiende el plazo se mueven; si se marca perdida se borran)
alter table secretary_tasks add column if not exists separation_id uuid references separations(id) on delete cascade;

create index if not exists idx_sec_tasks_separation on secretary_tasks(separation_id);
create index if not exists idx_separations_status on separations(status);
create index if not exists idx_separations_lot on separations(lot_id);
