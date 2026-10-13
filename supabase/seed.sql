-- =====================================================================
--  Données d'exemple (optionnel) — à exécuter APRÈS schema.sql et
--  migration_v2.sql. Les dates sont relatives à aujourd'hui.
--  Le bouton « Supprimer les exemples » de l'application les efface.
-- =====================================================================

insert into public.groups (id, name, example) values
  ('00000000-0000-4000-8000-0000000000a1', 'Pôle Planning Analytics', true),
  ('00000000-0000-4000-8000-0000000000a2', 'Pôle BOARD', true),
  ('00000000-0000-4000-8000-0000000000a3', 'Pôle IA & Agents', true)
on conflict do nothing;

insert into public.members (id, name, role, group_id, skills, example) values
  ('00000000-0000-4000-8000-0000000000c1', 'Camille Roux',  'Consultant senior', '00000000-0000-4000-8000-0000000000a1', '{"Planning Analytics","Gestion de projet"}', true),
  ('00000000-0000-4000-8000-0000000000c2', 'Hugo Marchal',  'Consultant',        '00000000-0000-4000-8000-0000000000a1', '{"Planning Analytics"}', true),
  ('00000000-0000-4000-8000-0000000000c3', 'Inès Belkacem', 'Consultant',        '00000000-0000-4000-8000-0000000000a2', '{"BOARD"}', true),
  ('00000000-0000-4000-8000-0000000000c4', 'Lucas Petit',   'Consultant',        '00000000-0000-4000-8000-0000000000a3', '{"Watson Orchestrate","Planning Analytics"}', true),
  ('00000000-0000-4000-8000-0000000000c5', 'Sarah Nguyen',  'Manager',           '00000000-0000-4000-8000-0000000000a2', '{"Gestion de projet","BOARD"}', true),
  ('00000000-0000-4000-8000-0000000000c6', 'Yanis Ferrand', 'Consultant',        '00000000-0000-4000-8000-0000000000a1', '{"Planning Analytics"}', true),
  ('00000000-0000-4000-8000-0000000000c7', 'Léa Moreau',    'Consultant senior', '00000000-0000-4000-8000-0000000000a2', '{"BOARD","Planning Analytics"}', true)
on conflict do nothing;

insert into public.missions (id, client, name, type, status, start_date, end_date, example) values
  ('00000000-0000-4000-8000-0000000000b1', 'Client Retail',       'Budget & forecast Planning Analytics', 'BUILD',   'ferme',    current_date - 30, current_date + 300, true),
  ('00000000-0000-4000-8000-0000000000b2', 'Client Industrie',    'TMA Planning Analytics',               'RUN',     'ferme',    current_date - 90, null,               true),
  ('00000000-0000-4000-8000-0000000000b3', 'Client Assurance',    'Consolidation BOARD',                  'BUILD',   'ferme',    current_date - 45, current_date + 17,  true),
  ('00000000-0000-4000-8000-0000000000b4', 'Client Énergie',      'POC agents IA Watson Orchestrate',     'AVV',     'ferme',    current_date - 3,  current_date + 40,  true),
  ('00000000-0000-4000-8000-0000000000b5', 'Client Énergie',      'Déploiement agents IA — phase 1',      'BUILD',   'probable', current_date + 12, current_date + 110, true),
  ('00000000-0000-4000-8000-0000000000b6', 'Client Distribution', 'TMA BOARD',                            'RUN',     'ferme',    current_date - 90, null,               true),
  ('00000000-0000-4000-8000-0000000000b7', 'Interne',             'Pilotage delivery',                    'INTERNE', 'ferme',    null,              null,               true),
  ('00000000-0000-4000-8000-0000000000b8', 'Client Distribution', 'Planification BOARD',                  'BUILD',   'probable', current_date + 20, current_date + 140, true),
  ('00000000-0000-4000-8000-0000000000b9', 'Client Luxe',         'Reporting ESG / CSRD',                 'BUILD',   'ferme',    current_date + 5,  current_date + 120, true)
on conflict do nothing;

insert into public.assignments (member_id, mission_id, pct, weekdays, start_date, end_date, example) values
  ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000b1',100,'{1,2,3,4,5}', current_date - 30, null, true),
  ('00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000b2',100,'{1,2,3}',     current_date - 60, null, true),
  ('00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000b4',100,'{4}',         current_date - 3,  null, true),
  ('00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000b1', 50,'{1,2}',       current_date,      current_date + 10, true),
  ('00000000-0000-4000-8000-0000000000c3','00000000-0000-4000-8000-0000000000b3',100,'{1,2,3,4,5}', current_date - 45, null, true),
  ('00000000-0000-4000-8000-0000000000c4','00000000-0000-4000-8000-0000000000b4', 40,'{1,2,3,4,5}', current_date - 3,  null, true),
  ('00000000-0000-4000-8000-0000000000c4','00000000-0000-4000-8000-0000000000b5', 60,'{1,2,3,4,5}', current_date + 12, null, true),
  ('00000000-0000-4000-8000-0000000000c5','00000000-0000-4000-8000-0000000000b6', 40,'{1,2,3,4,5}', current_date - 60, null, true),
  ('00000000-0000-4000-8000-0000000000c5','00000000-0000-4000-8000-0000000000b7', 20,'{1,2,3,4,5}', current_date - 60, null, true),
  ('00000000-0000-4000-8000-0000000000c5','00000000-0000-4000-8000-0000000000b3', 40,'{1,2,3,4,5}', current_date - 45, null, true),
  ('00000000-0000-4000-8000-0000000000c6','00000000-0000-4000-8000-0000000000b2',100,'{1,2,3,4}',   current_date - 60, null, true),
  ('00000000-0000-4000-8000-0000000000c7','00000000-0000-4000-8000-0000000000b8',100,'{1,2,3,4,5}', current_date + 20, null, true),
  ('00000000-0000-4000-8000-0000000000c7','00000000-0000-4000-8000-0000000000b7', 40,'{1,2,3,4,5}', current_date - 10, current_date + 14, true);

-- Temps partiel de Yanis le vendredi, congés d'Inès
insert into public.assignments (member_id, mission_id, pct, weekdays, start_date, end_date, example)
select '00000000-0000-4000-8000-0000000000c6', id, 100, '{5}', current_date - 60, null, true
from public.missions where type = 'ABSENCE' and name = 'Temps partiel' limit 1;

insert into public.assignments (member_id, mission_id, pct, weekdays, start_date, end_date, example)
select '00000000-0000-4000-8000-0000000000c3', id, 100, '{1,2,3,4,5}', current_date + 24, current_date + 28, true
from public.missions where type = 'ABSENCE' and name = 'Congés / absence' limit 1;

-- Un ajustement au jour : Camille en atelier avant-vente vendredi
insert into public.day_entries (member_id, day, mission_id, pct) values
  ('00000000-0000-4000-8000-0000000000c1', date_trunc('week', current_date)::date + 4, '00000000-0000-4000-8000-0000000000b1', 50),
  ('00000000-0000-4000-8000-0000000000c1', date_trunc('week', current_date)::date + 4, '00000000-0000-4000-8000-0000000000b4', 50)
on conflict do nothing;

insert into public.plan_status (member_id, updated_at, confirmed_at) values
  ('00000000-0000-4000-8000-0000000000c1', now() - interval '1 day', now() - interval '1 day'),
  ('00000000-0000-4000-8000-0000000000c2', now() - interval '4 days', null),
  ('00000000-0000-4000-8000-0000000000c3', now() - interval '22 days', null),
  ('00000000-0000-4000-8000-0000000000c5', null, now()),
  ('00000000-0000-4000-8000-0000000000c6', now() - interval '8 days', null)
on conflict do nothing;
