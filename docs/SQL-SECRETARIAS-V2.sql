-- ============ SECRETARIAS V2: hora exacta, categorias y feedback ============
alter table secretary_tasks add column if not exists time time;
alter table secretary_tasks add column if not exists notified_at timestamptz;
alter table secretary_tasks add column if not exists category text not null default 'administrativa';
alter table secretary_routines add column if not exists category text not null default 'administrativa';
alter table secretaries add column if not exists feedback_asked date;
alter table secretaries add column if not exists feedback_done date;

insert into bot_settings (key, value) values ('hora_feedback_sec','17:30')
on conflict (key) do nothing;
