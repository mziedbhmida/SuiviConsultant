-- =====================================================================
--  Datatilt-SuiviConsultant — v2
--  Catalogue de missions, affectations récurrentes, saisie au jour,
--  gestion des administrateurs depuis l'application.
--
--  À exécuter une fois dans Supabase : SQL Editor > New query > Run
--  (après schema.sql). Ré-exécutable sans risque.
--  Les staffings saisis en v1 sont convertis automatiquement en
--  missions + affectations ; l'ancienne table "items" est conservée.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Catalogue des missions (géré par les administrateurs)
-- ---------------------------------------------------------------------
create table if not exists public.missions (
  id          uuid primary key default gen_random_uuid(),
  client      text not null default '',
  name        text not null check (length(trim(name)) > 0),
  type        text not null check (type in ('BUILD','RUN','AVV','INTERNE','ABSENCE')),
  status      text not null default 'ferme' check (status in ('ferme','probable')),
  start_date  date,
  end_date    date,                       -- null = sans date de fin
  active      boolean not null default true,
  example     boolean not null default false,
  created_at  timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

-- ---------------------------------------------------------------------
-- Affectations récurrentes : « je suis sur la mission X à 100 %,
-- du lundi au vendredi, jusqu'à la fin de la mission »
-- ---------------------------------------------------------------------
create table if not exists public.assignments (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  mission_id  uuid not null references public.missions(id) on delete restrict,
  pct         smallint not null check (pct > 0 and pct <= 100),
  weekdays    smallint[] not null default '{1,2,3,4,5}'
              check (cardinality(weekdays) > 0 and weekdays <@ '{1,2,3,4,5}'::smallint[]),
  start_date  date not null,
  end_date    date,                       -- null = jusqu'à la fin de la mission
  example     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists assignments_member_idx  on public.assignments(member_id);
create index if not exists assignments_mission_idx on public.assignments(mission_id);

-- ---------------------------------------------------------------------
-- Ajustements au jour : remplacent les affectations récurrentes ce jour-là
-- mission_id null = journée libre
-- ---------------------------------------------------------------------
create table if not exists public.day_entries (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  day         date not null,
  mission_id  uuid references public.missions(id) on delete restrict,
  pct         smallint not null default 0 check (pct >= 0 and pct <= 100),
  created_at  timestamptz not null default now()
);
create unique index if not exists day_entries_uniq
  on public.day_entries(member_id, day, coalesce(mission_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists day_entries_day_idx on public.day_entries(day);

drop trigger if exists assignments_touch on public.assignments;
create trigger assignments_touch before update on public.assignments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Administrateurs : e-mail normalisé, toujours au moins un admin
-- ---------------------------------------------------------------------
create or replace function public.admins_normalize()
returns trigger language plpgsql as $$
begin new.email := lower(trim(new.email)); return new; end;
$$;
drop trigger if exists admins_normalize on public.admins;
create trigger admins_normalize before insert or update on public.admins
  for each row execute function public.admins_normalize();

create or replace function public.keep_one_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.admins) <= 1 then
    raise exception 'Il doit rester au moins un administrateur.';
  end if;
  return old;
end;
$$;
drop trigger if exists keep_one_admin on public.admins;
create trigger keep_one_admin before delete on public.admins
  for each row execute function public.keep_one_admin();

-- ---------------------------------------------------------------------
-- Sécurité
-- ---------------------------------------------------------------------
alter table public.missions    enable row level security;
alter table public.assignments enable row level security;
alter table public.day_entries enable row level security;

drop policy if exists missions_read  on public.missions;
drop policy if exists missions_admin on public.missions;
create policy missions_read  on public.missions for select to authenticated using (true);
create policy missions_admin on public.missions for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists assignments_read  on public.assignments;
drop policy if exists assignments_write on public.assignments;
create policy assignments_read  on public.assignments for select to authenticated using (true);
create policy assignments_write on public.assignments for all    to authenticated
  using (public.is_admin() or public.owns_member(member_id))
  with check (public.is_admin() or public.owns_member(member_id));

drop policy if exists day_entries_read  on public.day_entries;
drop policy if exists day_entries_write on public.day_entries;
create policy day_entries_read  on public.day_entries for select to authenticated using (true);
create policy day_entries_write on public.day_entries for all    to authenticated
  using (public.is_admin() or public.owns_member(member_id))
  with check (public.is_admin() or public.owns_member(member_id));

drop policy if exists admins_read   on public.admins;
drop policy if exists admins_insert on public.admins;
drop policy if exists admins_delete on public.admins;
create policy admins_read   on public.admins for select to authenticated using (public.is_admin());
create policy admins_insert on public.admins for insert to authenticated with check (public.is_admin());
create policy admins_delete on public.admins for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- Missions d'absence par défaut (utilisables par tous)
-- ---------------------------------------------------------------------
insert into public.missions (client, name, type)
select 'Interne', 'Congés / absence', 'ABSENCE'
where not exists (select 1 from public.missions where type = 'ABSENCE' and name = 'Congés / absence');

insert into public.missions (client, name, type)
select 'Interne', 'Temps partiel', 'ABSENCE'
where not exists (select 1 from public.missions where type = 'ABSENCE' and name = 'Temps partiel');

-- ---------------------------------------------------------------------
-- Reprise des données v1 (staffings "items") — une seule fois
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.items') is not null
     and exists (select 1 from public.items)
     and not exists (select 1 from public.assignments) then

    insert into public.missions (client, name, type, status, start_date, end_date, example)
    select i.client, coalesce(nullif(trim(i.mission), ''), i.type), i.type, i.status,
           min(i.start_date), max(i.end_date), bool_and(i.example)
    from public.items i
    where i.type <> 'ABSENCE'
    group by i.client, coalesce(nullif(trim(i.mission), ''), i.type), i.type, i.status;

    insert into public.assignments (member_id, mission_id, pct, start_date, end_date, example)
    select i.member_id, m.id, least(100, greatest(1, round(i.days / 5.0 * 100)))::smallint,
           i.start_date, i.end_date, i.example
    from public.items i
    join public.missions m
      on m.type = i.type and m.client = i.client and m.status = i.status
     and m.name = coalesce(nullif(trim(i.mission), ''), i.type)
    where i.type <> 'ABSENCE';

    insert into public.assignments (member_id, mission_id, pct, start_date, end_date, example)
    select i.member_id,
           (select id from public.missions where type = 'ABSENCE' and name = 'Congés / absence' limit 1),
           least(100, greatest(1, round(i.days / 5.0 * 100)))::smallint,
           i.start_date, i.end_date, i.example
    from public.items i
    where i.type = 'ABSENCE';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Temps réel
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['missions','assignments','day_entries','admins'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
