// =====================================================================
//  Configuration de Datatilt-SuiviConsultant
//  Récupère ces deux valeurs dans Supabase : Project Settings > API
//  La clé "anon public" peut être publiée : la sécurité est assurée
//  par les règles de la base (Row Level Security), pas par cette clé.
// =====================================================================
window.APP_CONFIG = {
  SUPABASE_URL: "https://VOTRE-PROJET.supabase.co",
  SUPABASE_ANON_KEY: "VOTRE-CLE-ANON-PUBLIQUE",

  // Domaines e-mail acceptés à la connexion (vérifié aussi côté serveur)
  ALLOWED_DOMAINS: ["datatilt.com"],

  // Objectif de taux facturable affiché dans les KPI
  TARGET_BILLABLE: 0.8,

  // Nombre de jours après lequel un planning est considéré "à relancer"
  STALE_DAYS: 14
};
