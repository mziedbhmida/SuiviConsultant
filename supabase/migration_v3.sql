-- =====================================================================
--  Datatilt-SuiviConsultant — v3
--  E-mail de contact des consultants (pour les rappels envoyés par les
--  administrateurs, y compris aux consultants qui ne se sont jamais
--  connectés).
--
--  À exécuter une fois dans Supabase : SQL Editor > New query > Run
--  (après migration_v2.sql). Ré-exécutable sans risque.
-- =====================================================================

alter table public.members add column if not exists email text;

-- Reprend l'e-mail de connexion des consultants déjà rattachés
update public.members set email = user_email
 where email is null and user_email is not null;
