-- =====================================================================
--  Datatilt-SuiviConsultant — schéma Supabase
--  À exécuter une seule fois dans Supabase : SQL Editor > New query > Run
--
--  AVANT D'EXÉCUTER, modifie les deux lignes marquées "À ADAPTER" :
--    1. le domaine e-mail autorisé (ex. datatilt.com)
--    2. l'e-mail du ou des administrateurs
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Paramétrage : domaines autorisés et administrateurs
-- ---------------------------------------------------------------------
create table if not exists public.allowed_domains (
  domain text primary key
);

create table if not exists public.admins (
  email text primary key
);

insert into public.allowed_domains (domain) values
  ('datatilt.com')                       -- À ADAPTER : ton domaine e-mail
on conflict do nothing;

insert into public.admins (email) values
  ('prenom.nom@datatilt.com')            -- À ADAPTER : ton e-mail (administrateur)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Données métier
-- ---------------------------------------------------------------------
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  example     boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  role        text not null default 'Consultant',
  group_id    uuid references public.groups(id) on delete set null,
  capacity    numeric(3,1) not null default 5 check (capacity > 0 and capacity <= 5),
  skills      text[] not null default '{}',
  user_id     uuid unique references auth.users(id) on delete set null,
  user_email  text,
  example     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Demande de rattachement : un utilisateur connecté dit « ce profil, c'est moi »
create table if not exists public.claims (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  email       text not null default (auth.jwt() ->> 'email'),
  member_id   uuid not null references public.members(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- Staffings, avant-ventes, congés…
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  type        text not null check (type in ('BUILD','RUN','AVV','INTERNE','ABSENCE')),
  client      text not null default '',
  mission     text not null default '',
  start_date  date not null,
  end_date    date not null,
  days        numeric(3,1) not null check (days > 0 and days <= 5),
  status      text not null default 'ferme' check (status in ('ferme','probable')),
  example     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists items_member_idx on public.items(member_id);

-- Fraîcheur du planning de chaque consultant
create table if not exists public.plan_status (
  member_id     uuid primary key references public.members(id) on delete cascade,
  updated_at    timestamptz,
  confirmed_at  timestamptz
);

-- ---------------------------------------------------------------------
-- Fonctions utilitaires
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.owns_member(mid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where id = mid and user_id = auth.uid());
$$;

-- Bloque toute création de compte hors des domaines autorisés (côté serveur)
create or replace function public.enforce_email_domain()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is null or lower(split_part(new.email, '@', 2)) not in (
    select lower(domain) from public.allowed_domains
  ) then
    raise exception 'Adresse e-mail non autorisée pour Datatilt-SuiviConsultant';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_email_domain on auth.users;
create trigger enforce_email_domain
  before insert on auth.users
  for each row execute function public.enforce_email_domain();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
-- L'e-mail d'une demande de rattachement vient toujours du jeton de connexion (non falsifiable)
create or replace function public.claims_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  new.email := coalesce(auth.jwt() ->> 'email', new.email);
  return new;
end;
$$;
drop trigger if exists claims_identity on public.claims;
create trigger claims_identity before insert or update on public.claims
  for each row execute function public.claims_identity();

drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Sécurité (Row Level Security)
--   - tout utilisateur connecté LIT l'équipe et les plannings
--   - seuls les admins gèrent groupes et profils
--   - chacun ne MODIFIE que son propre planning (les admins : tous)
-- ---------------------------------------------------------------------
alter table public.allowed_domains enable row level security;
alter table public.admins          enable row level security;
alter table public.groups          enable row level security;
alter table public.members         enable row level security;
alter table public.claims          enable row level security;
alter table public.items           enable row level security;
alter table public.plan_status     enable row level security;
-- allowed_domains et admins : aucune policy = inaccessibles depuis l'application

drop policy if exists groups_read  on public.groups;
drop policy if exists groups_admin on public.groups;
create policy groups_read  on public.groups for select to authenticated using (true);
create policy groups_admin on public.groups for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists members_read  on public.members;
drop policy if exists members_admin on public.members;
create policy members_read  on public.members for select to authenticated using (true);
create policy members_admin on public.members for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists claims_read   on public.claims;
drop policy if exists claims_insert on public.claims;
drop policy if exists claims_update on public.claims;
drop policy if exists claims_delete on public.claims;
create policy claims_read   on public.claims for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy claims_insert on public.claims for insert to authenticated with check (user_id = auth.uid());
create policy claims_update on public.claims for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy claims_delete on public.claims for delete to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists items_read  on public.items;
drop policy if exists items_write on public.items;
create policy items_read  on public.items for select to authenticated using (true);
create policy items_write on public.items for all    to authenticated
  using (public.is_admin() or public.owns_member(member_id))
  with check (public.is_admin() or public.owns_member(member_id));

drop policy if exists status_read  on public.plan_status;
drop policy if exists status_write on public.plan_status;
create policy status_read  on public.plan_status for select to authenticated using (true);
create policy status_write on public.plan_status for all    to authenticated
  using (public.is_admin() or public.owns_member(member_id))
  with check (public.is_admin() or public.owns_member(member_id));

grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------
-- Temps réel (les écrans se mettent à jour quand un collègue enregistre)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['groups','members','claims','items','plan_status'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
