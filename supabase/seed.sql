-- =====================================================================
--  Données d'exemple (optionnel) — pour découvrir l'outil.
--  Un bouton « Supprimer les exemples » dans l'application les efface.
-- =====================================================================

insert into public.groups (id, name, example) values
  ('00000000-0000-4000-8000-0000000000a1', 'Pôle Planning Analytics', true),
  ('00000000-0000-4000-8000-0000000000a2', 'Pôle BOARD', true),
  ('00000000-0000-4000-8000-0000000000a3', 'Pôle IA & Agents', true)
on conflict do nothing;

insert into public.members (id, name, role, group_id, capacity, skills, example) values
  ('00000000-0000-4000-8000-0000000000c1', 'Camille Roux',   'Consultant senior', '00000000-0000-4000-8000-0000000000a1', 5, '{"Planning Analytics","Gestion de projet"}', true),
  ('00000000-0000-4000-8000-0000000000c2', 'Hugo Marchal',   'Consultant',        '00000000-0000-4000-8000-0000000000a1', 5, '{"Planning Analytics"}', true),
  ('00000000-0000-4000-8000-0000000000c3', 'Inès Belkacem',  'Consultant',        '00000000-0000-4000-8000-0000000000a2', 5, '{"BOARD"}', true),
  ('00000000-0000-4000-8000-0000000000c4', 'Lucas Petit',    'Consultant',        '00000000-0000-4000-8000-0000000000a3', 5, '{"Watson Orchestrate","Planning Analytics"}', true),
  ('00000000-0000-4000-8000-0000000000c5', 'Sarah Nguyen',   'Manager',           '00000000-0000-4000-8000-0000000000a2', 5, '{"Gestion de projet","BOARD"}', true),
  ('00000000-0000-4000-8000-0000000000c6', 'Yanis Ferrand',  'Consultant',        '00000000-0000-4000-8000-0000000000a1', 4, '{"Planning Analytics"}', true),
  ('00000000-0000-4000-8000-0000000000c7', 'Léa Moreau',     'Consultant senior', '00000000-0000-4000-8000-0000000000a2', 5, '{"BOARD","Planning Analytics"}', true)
on conflict do nothing;

insert into public.items (member_id, type, client, mission, start_date, end_date, days, status, example) values
  ('00000000-0000-4000-8000-0000000000c1','BUILD','Client Retail','Build budget & forecast PA','2026-10-01','2026-12-18',5,'ferme',true),
  ('00000000-0000-4000-8000-0000000000c2','RUN','Client Industrie','TMA Planning Analytics','2026-09-01','2027-03-31',3,'ferme',true),
  ('00000000-0000-4000-8000-0000000000c2','BUILD','Client Retail','Renfort reporting','2026-10-12','2026-10-30',2,'ferme',true),
  ('00000000-0000-4000-8000-0000000000c2','AVV','Client Énergie','Démo agent IA Orchestrate','2026-10-19','2026-11-06',1,'ferme',true),
  ('00000000-0000-4000-8000-0000000000c3','BUILD','Client Assurance','Build consolidation BOARD','2026-09-07','2026-10-30',5,'ferme',true),
  ('00000000-0000-4000-8000-0000000000c3','ABSENCE','','Congés','2026-11-23','2026-11-27',5,'ferme',true),
  ('00000000-0000-4000-8000-0000000000c4','AVV','Client Énergie','POC agents IA Watson Orchestrate','2026-10-12','2026-11-27',2,'ferme',true),
  ('00000000-0000-4000-8000-0000000000c4','BUILD','Client Énergie','Déploiement agents IA (phase 1)','2026-10-26','2027-01-29',3,'probable',true),
  ('00000000-0000-4000-8000-0000000000c5','RUN','Client Distribution','TMA BOARD','2026-09-01','2027-06-30',2,'ferme',true),
  ('00000000-0000-4000-8000-0000000000c5','INTERNE','Interne','Pilotage delivery','2026-09-01','2027-06-30',1,'ferme',true),
  ('00000000-0000-4000-8000-0000000000c5','BUILD','Client Assurance','Direction de projet consolidation','2026-10-12','2026-12-11',2,'ferme',true),
  ('00000000-0000-4000-8000-0000000000c6','RUN','Client Industrie','TMA Planning Analytics','2026-10-01','2026-12-31',4,'ferme',true),
  ('00000000-0000-4000-8000-0000000000c6','ABSENCE','','Congés Toussaint','2026-10-26','2026-10-30',4,'ferme',true),
  ('00000000-0000-4000-8000-0000000000c7','BUILD','Client Distribution','Build planification BOARD','2026-11-02','2027-02-26',5,'probable',true),
  ('00000000-0000-4000-8000-0000000000c7','INTERNE','Interne','Certification BOARD','2026-10-12','2026-10-30',2,'ferme',true);

insert into public.plan_status (member_id, updated_at, confirmed_at) values
  ('00000000-0000-4000-8000-0000000000c1', now() - interval '1 day', now() - interval '1 day'),
  ('00000000-0000-4000-8000-0000000000c2', now() - interval '4 days', null),
  ('00000000-0000-4000-8000-0000000000c3', now() - interval '22 days', null),
  ('00000000-0000-4000-8000-0000000000c5', null, now()),
  ('00000000-0000-4000-8000-0000000000c6', now() - interval '8 days', null)
on conflict do nothing;
