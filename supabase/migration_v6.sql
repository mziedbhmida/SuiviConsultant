-- =====================================================================
--  Datatilt-SuiviConsultant — v6
--  BUILD et RUN / TMA ne sont plus distingués : un seul type
--  « Mission client » (code BUILD). Les missions RUN existantes sont
--  converties ; plannings et affectations sont conservés.
--
--  À exécuter une fois dans Supabase : SQL Editor > New query > Run
--  (après migration_v5.sql). Ré-exécutable sans risque.
-- =====================================================================

update public.missions set type = 'BUILD' where type = 'RUN';
update public.items    set type = 'BUILD' where type = 'RUN';
