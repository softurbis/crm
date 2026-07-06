-- ============================================================
-- SQL-GASTOS-CORRELATIVO.sql  |  URBIS CONTROL v2
-- Numero de solicitud correlativo automatico para gastos.
-- IDEMPOTENTE. Ejecutar en Supabase > SQL Editor > Run.
-- ============================================================

create sequence if not exists expenses_request_seq;

alter table expenses add column if not exists request_number bigint;

-- backfill: numera los gastos existentes en orden cronologico (solo los que no tienen numero)
with ordenado as (
  select id, row_number() over (order by created_at, issue_date) as rn
  from expenses
  where request_number is null
)
update expenses e
set request_number = o.rn + coalesce((select max(request_number) from expenses where request_number is not null), 0)
from ordenado o
where e.id = o.id;

-- la secuencia continua desde el maximo actual
select setval('expenses_request_seq', coalesce((select max(request_number) from expenses), 0) + 1, false);

-- los gastos nuevos se numeran solos
alter table expenses alter column request_number set default nextval('expenses_request_seq');

create unique index if not exists uq_expenses_request_number on expenses(request_number);
