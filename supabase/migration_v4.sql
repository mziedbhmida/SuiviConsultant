-- =====================================================================
--  Datatilt-SuiviConsultant — v4
--  Création des comptes par un administrateur, sans e-mail :
--  l'admin choisit un mot de passe provisoire, le compte est créé
--  confirmé et rattaché au profil. À la première connexion, le
--  collaborateur doit choisir son propre mot de passe.
--
--  À exécuter une fois dans Supabase : SQL Editor > New query > Run
--  (après migration_v3.sql). Ré-exécutable sans risque.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Créer le compte de connexion d'un profil
-- ---------------------------------------------------------------------
create or replace function public.admin_create_account(p_member uuid, p_email text, p_password text)
returns uuid
language plpgsql security definer
set search_path = public, extensions, auth
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_uid   uuid := gen_random_uuid();
  v_now   timestamptz := now();
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Adresse e-mail invalide';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Le mot de passe provisoire doit faire au moins 8 caractères';
  end if;
  if not exists (select 1 from public.members where id = p_member) then
    raise exception 'Profil introuvable';
  end if;
  if exists (select 1 from public.members where id = p_member and user_id is not null) then
    raise exception 'Ce profil est déjà rattaché à un compte';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Un compte existe déjà pour %. La personne peut se connecter et choisir son nom dans « Mon planning ».', v_email;
  end if;

  -- le trigger enforce_email_domain vérifie le domaine autorisé
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_email, crypt(p_password, gen_salt('bf')),
    v_now, '{"provider":"email","providers":["email"]}'::jsonb, '{"must_change_password":true}'::jsonb,
    v_now, v_now,
    '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_uid, v_uid::text, 'email',
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
    null, v_now, v_now
  );

  update public.members
     set user_id = v_uid, user_email = v_email, email = coalesce(nullif(trim(email), ''), v_email)
   where id = p_member;

  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------
-- Redonner un mot de passe provisoire à un compte rattaché
-- (le collaborateur devra en choisir un nouveau à la connexion)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_password(p_member uuid, p_password text)
returns void
language plpgsql security definer
set search_path = public, extensions, auth
as $$
declare v_uid uuid;
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Le mot de passe provisoire doit faire au moins 8 caractères';
  end if;
  select user_id into v_uid from public.members where id = p_member;
  if v_uid is null then
    raise exception 'Ce profil n''est rattaché à aucun compte';
  end if;
  update auth.users
     set encrypted_password = crypt(p_password, gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"must_change_password":true}'::jsonb,
         updated_at = now()
   where id = v_uid;
end;
$$;

revoke all on function public.admin_create_account(uuid, text, text) from public, anon;
revoke all on function public.admin_set_password(uuid, text)        from public, anon;
grant execute on function public.admin_create_account(uuid, text, text) to authenticated;
grant execute on function public.admin_set_password(uuid, text)        to authenticated;
