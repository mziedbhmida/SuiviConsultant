// =====================================================================
//  Configuration de Datatilt-SuiviConsultant
//  Récupère ces deux valeurs dans Supabase : Project Settings > API
//  La clé "anon public" peut être publiée : la sécurité est assurée
//  par les règles de la base (Row Level Security), pas par cette clé.
// =====================================================================
window.APP_CONFIG = {
  SUPABASE_URL: "https://tvetviytqzwkplpijvzw.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_77fCeHrJ_YdQJDtlycv1Kw_jySMXkDY",

  // Domaines e-mail acceptés à la connexion (vérifié aussi côté serveur)
  ALLOWED_DOMAINS: ["datatilt.fr"],

  // Objectif de taux facturable affiché dans les KPI
  TARGET_BILLABLE: 0.8,

  // Nombre de jours après lequel un planning est considéré "à relancer"
  STALE_DAYS: 14,

  // Alertes « Compétence fragile » (compétence détenue par 0 ou 1 consultant) : true pour les afficher
  SKILL_ALERTS: false
};
