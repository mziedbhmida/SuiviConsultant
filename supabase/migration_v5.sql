-- =====================================================================
--  Datatilt-SuiviConsultant — v5
--  Un consultant peut appartenir à plusieurs groupes.
--  group_ids contient tous ses groupes ; group_id reste rempli avec
--  le premier (groupe principal) pour la compatibilité.
--
--  À exécuter une fois dans Supabase : SQL Editor > New query > Run
--  (après migration_v4.sql). Ré-exécutable sans risque.
-- =====================================================================

alter table public.members add column if not exists group_ids uuid[] not null default '{}';

-- Reprend le groupe actuel de chaque consultant
update public.members set group_ids = array[group_id]
 where group_id is not null and cardinality(group_ids) = 0;

-- group_id = premier groupe de la liste
create or replace function public.members_sync_group()
returns trigger language plpgsql as $$
begin
  new.group_ids := coalesce(new.group_ids, '{}');
  -- ancienne version de l'application : elle n'écrit que group_id
  if tg_op = 'UPDATE' and new.group_ids = old.group_ids and new.group_id is distinct from old.group_id then
    new.group_ids := case when new.group_id is null then '{}' else array[new.group_id] end;
  elsif tg_op = 'INSERT' and cardinality(new.group_ids) = 0 and new.group_id is not null then
    new.group_ids := array[new.group_id];
  end if;
  new.group_id := new.group_ids[1];
  return new;
end;
$$;
drop trigger if exists members_sync_group on public.members;
create trigger members_sync_group before insert or update on public.members
  for each row execute function public.members_sync_group();

-- Supprimer un groupe le retire de la liste de chaque consultant
create or replace function public.groups_cleanup_members()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.members set group_ids = array_remove(group_ids, old.id)
   where old.id = any(group_ids);
  return old;
end;
$$;
drop trigger if exists groups_cleanup_members on public.groups;
create trigger groups_cleanup_members before delete on public.groups
  for each row execute function public.groups_cleanup_members();
