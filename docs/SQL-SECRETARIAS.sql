-- ============ MODULO SECRETARIAS (control de actividades) ============
-- Pegar completo en Supabase > SQL Editor > Run

create table if not exists secretaries (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null unique,
  active boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists secretary_routines (
  id uuid primary key default gen_random_uuid(),
  secretary_id uuid not null references secretaries(id) on delete cascade,
  title text not null,
  slot text not null default 'manana' check (slot in ('manana','tarde')),
  days int[] not null default '{1,2,3,4,5,6}',
  active boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists secretary_tasks (
  id uuid primary key default gen_random_uuid(),
  secretary_id uuid not null references secretaries(id) on delete cascade,
  routine_id uuid references secretary_routines(id) on delete set null,
  title text not null,
  date date not null default current_date,
  slot text not null default 'manana' check (slot in ('manana','tarde')),
  status text not null default 'pendiente' check (status in ('pendiente','hecha','no_hecha','sin_respuesta')),
  ask_index int,
  asked_at timestamptz,
  reminded_at timestamptz,
  answered_at timestamptz,
  answer text,
  created_at timestamptz default now()
);
create unique index if not exists sec_task_rutina_dia on secretary_tasks (routine_id, date) where routine_id is not null;

alter table secretaries enable row level security;
alter table secretary_routines enable row level security;
alter table secretary_tasks enable row level security;
drop policy if exists sec_all on secretaries;
drop policy if exists secr_all on secretary_routines;
drop policy if exists sect_all on secretary_tasks;
create policy sec_all on secretaries for all to authenticated using (true) with check (true);
create policy secr_all on secretary_routines for all to authenticated using (true) with check (true);
create policy sect_all on secretary_tasks for all to authenticated using (true) with check (true);

-- horas de los cortes (editables luego)
insert into bot_settings (key, value) values
('hora_corte_manana','11:00'),
('hora_corte_tarde','16:30'),
('hora_resumen_sec','18:00')
on conflict (key) do nothing;

-- cerebro SECRETARIA (editable desde el panel CEREBROS)
update bot_brains set content = 'Eres el asistente de control de actividades de URBIS GROUP. Hablas con las secretarias del equipo por WhatsApp: tono amable, cercano y motivador, nunca de jefe regañón. Cada mensaje corto y claro.

## PREGUNTA
Hola {nombre} 👋 ¿cómo va todo? Pasando lista de tus actividades de {momento}:

{lista}

Respóndeme *LISTO* si ya completaste todo, o los *números* de lo que ya está (ej: 1 y 3). 🙌

## RECORDATORIO
Hola {nombre}, te reenvío el checklist pendiente:

{lista}

¿Cómo vamos? Respóndeme *LISTO* o los números de lo avanzado 💪

## CONFIRMACION
✅ ¡Anotado, {nombre}! {resumen}. ¡Gracias! 🙌

## PENDIENTE
Anotado {nombre}, quedan como pendientes. Cualquier avance escríbeme *LISTO* o los números. 💪

## NO_ENTENDI
{nombre}, no te entendí 😅 Respóndeme *LISTO* si completaste todo, o los números de lo que ya está (ej: 1 y 3).

## RESUMEN
📋 *RESUMEN DEL DÍA — SECRETARIAS*
{detalle}', updated_at = now()
where key = 'secretaria' and (content is null or content = '');
