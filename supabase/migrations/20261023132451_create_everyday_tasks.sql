create table public.everyday_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,

  title text not null check (char_length(title) > 0),
  description text,

  deadline_date date,
  deadline_at timestamptz,
  deadline_time_zone text,
  scheduled_date date,

  status text not null default 'active'
    check (status in ('active', 'completed', 'dismissed')),
  is_focused boolean not null default false,
  completed_at timestamptz,

  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  version integer not null default 1 check (version > 0),

  constraint everyday_tasks_deadline_shape check (
    (deadline_at is null and deadline_time_zone is null)
    or (
      deadline_date is null
      and deadline_at is not null
      and deadline_time_zone is not null
    )
  ),

  constraint everyday_tasks_deadline_date_range check (
    deadline_date between date '0001-01-01' and date '9999-12-31'
  ),

  constraint everyday_tasks_deadline_instant_range check (
    deadline_at >= timestamptz '0001-01-01 00:00:00+00'
    and deadline_at < timestamptz '10000-01-01 00:00:00+00'
  ),

  constraint everyday_tasks_schedule_range check (
    scheduled_date between date '0001-01-01' and date '9999-12-31'
  ),

  constraint everyday_tasks_focus_requires_active check (
    status = 'active' or not is_focused
  ),

  constraint everyday_tasks_completion_matches_status check (
    (status = 'completed') = (completed_at is not null)
  )
);

create index everyday_tasks_owner_order_idx
  on public.everyday_tasks(owner_id, id);

create schema if not exists private;

create function private.apply_everyday_task_rules()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  -- Match the whitespace trimmed by JavaScript String.trim().
  whitespace constant text :=
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  new.title := btrim(new.title, whitespace);
  new.description := nullif(btrim(new.description, whitespace), '');
  new.deadline_time_zone := btrim(new.deadline_time_zone);

  if new.deadline_time_zone is not null
    and not exists (
      select 1
      from pg_catalog.pg_timezone_names
      where name = new.deadline_time_zone
    ) then
    raise exception 'Invalid deadline time zone.'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'active'
      or new.is_focused
      or new.version <> 1
      or new.completed_at is not null then
      raise exception 'New tasks must start active and outside Focus.'
        using errcode = '23514';
    end if;

    new.created_at := statement_timestamp();
    new.updated_at := new.created_at;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.owner_id is distinct from old.owner_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Task identity and ownership are immutable.'
      using errcode = '42501';
  end if;

  if new.version is distinct from old.version + 1 then
    raise exception 'Task version conflict.'
      using errcode = '40001';
  end if;

  if old.status <> 'active'
    and new.status <> old.status
    and new.status <> 'active' then
    raise exception 'Reactivate the task before changing its terminal status.'
      using errcode = '23514';
  end if;

  if old.status = 'active' and new.status <> 'active' then
    new.is_focused := false;
  end if;

  new.updated_at := statement_timestamp();

  if new.status = 'completed' then
    if old.status = 'completed' then
      new.completed_at := old.completed_at;
    else
      new.completed_at := new.updated_at;
    end if;
  else
    new.completed_at := null;
  end if;

  return new;
end;
$function$;

revoke all on function private.apply_everyday_task_rules()
  from public, anon, authenticated;

create trigger everyday_tasks_apply_rules
before insert or update on public.everyday_tasks
for each row execute function private.apply_everyday_task_rules();

alter table public.everyday_tasks enable row level security;

create policy everyday_tasks_select_own
on public.everyday_tasks for select
to authenticated
using (owner_id = (select auth.uid()));

create policy everyday_tasks_insert_own
on public.everyday_tasks for insert
to authenticated
with check (owner_id = (select auth.uid()));

create policy everyday_tasks_update_own
on public.everyday_tasks for update
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

revoke all on table public.everyday_tasks
  from public, anon, authenticated;

grant select on table public.everyday_tasks to authenticated;

grant insert (
  owner_id,
  title,
  description,
  deadline_date,
  deadline_at,
  deadline_time_zone,
  scheduled_date
) on public.everyday_tasks to authenticated;

grant update (
  title,
  description,
  deadline_date,
  deadline_at,
  deadline_time_zone,
  scheduled_date,
  status,
  is_focused,
  version
) on public.everyday_tasks to authenticated;
