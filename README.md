# Datatilt-SuiviConsultant

Plan de charge et disponibilité des consultants DATATILT.

Les administrateurs créent les **missions** (mission client, avant-vente, interne, absences). Chaque collaborateur se connecte avec son e-mail professionnel (mot de passe provisoire donné par un administrateur, ou lien magique, puis mot de passe personnel), **s'affecte à ses missions** (pourcentage, jours de la semaine, jusqu'à la fin de la mission) et son planning se remplit tout seul. Il ajuste ensuite au jour près sur une grille de 3 semaines (absence, demi-journée, autre mission).

Les administrateurs pilotent les KPI : taux facturable, occupation, intercontrat, surcharges et fraîcheur des plannings.

- **Front** : HTML/JS statique, sans étape de build, hébergé sur Vercel.
- **Back-end** : Supabase (base Postgres, authentification, temps réel).
- **Sécurité** : appliquée par la base (Row Level Security). Un collaborateur ne peut modifier que son planning, et seuls les e-mails du domaine autorisé peuvent créer un compte.

---

## Mise en ligne (≈ 20 minutes)

### 1. Pousser le code sur GitHub

```bash
cd Datatilt-SuiviConsultant
git init
git add .
git commit -m "Datatilt-SuiviConsultant : première version"
git branch -M main
git remote add origin https://github.com/<ton-compte-ou-orga>/Datatilt-SuiviConsultant.git
git push -u origin main
```

Crée d'abord le dépôt **vide** sur github.com (bouton *New repository*, nom `Datatilt-SuiviConsultant`, sans README). Un dépôt **privé** est recommandé.

### 2. Créer la base Supabase

1. Crée un compte sur [supabase.com](https://supabase.com), puis un projet. Choisis la région **Europe (Paris ou Frankfurt)** et note le mot de passe de la base.
2. Ouvre **SQL Editor → New query**.
3. Ouvre `supabase/schema.sql` et modifie les deux lignes marquées **À ADAPTER** :
   - ton domaine e-mail (ex. `datatilt.com`) ;
   - ton e-mail d'administrateur.

   Colle ensuite le fichier et clique sur **Run**.
4. Exécute ensuite `supabase/migration_v2.sql` (missions, affectations, saisie au jour, gestion des admins).
   Puis `supabase/migration_v3.sql` (e-mail des consultants pour les rappels).
   Puis `supabase/migration_v4.sql` (création des comptes par un administrateur, sans e-mail).
   Puis `supabase/migration_v5.sql` (un consultant peut appartenir à plusieurs groupes).
   Puis `supabase/migration_v6.sql` (BUILD et RUN / TMA fusionnés en « Mission client »).
5. *(Optionnel)* Pour avoir des données d'exemple, exécute `supabase/seed.sql`. Elles se suppriment ensuite en un clic dans l'application.
6. Va dans **Project Settings → API** et copie :
   - **Project URL** ;
   - la clé **anon public**.

### 3. Renseigner `config.js`

```js
SUPABASE_URL: "https://xxxxx.supabase.co",
SUPABASE_ANON_KEY: "eyJhbGciOi...",
ALLOWED_DOMAINS: ["datatilt.com"],
```

Commit puis push. La clé *anon* peut être publiée sans risque : la sécurité repose sur les règles de la base. **Ne mets jamais la clé `service_role` dans ce fichier.**

### 4. Déployer sur Vercel

1. Sur [vercel.com](https://vercel.com), clique sur **Add New → Project** et importe le dépôt GitHub `Datatilt-SuiviConsultant`.
2. Garde **Framework Preset : Other**, sans commande de build ni dossier de sortie, puis clique sur **Deploy**.
3. Note l'adresse obtenue, par exemple `https://datatilt-suiviconsultant.vercel.app`.

Chaque `git push` sur `main` redéploie automatiquement l'application.

### 5. Relier Supabase à l'adresse Vercel (indispensable pour les liens de connexion)

Dans Supabase, va dans **Authentication → URL Configuration** :

- **Site URL** : `https://datatilt-suiviconsultant.vercel.app`
- **Redirect URLs** : ajoute la même adresse, ainsi que `http://localhost:3000` si tu testes en local.

### 6. Premier lancement

1. Ouvre l'application et connecte-toi avec l'e-mail déclaré administrateur.
2. Dans **Missions** : crée le catalogue (une mission « sans date de fin » pour les projets à l'année et les TMA). Les motifs d'absence « Congés / absence » et « Temps partiel » existent déjà.
3. Dans **Administration** :
   - ajoute les autres administrateurs ;
   - crée les groupes (ex. Pôle PA, Pôle BOARD, Pôle IA). Un consultant peut appartenir à plusieurs groupes : coche-les dans sa fiche, ou utilise « Membres » sur un groupe ;
   - crée les profils des consultants ;
   - supprime les exemples.
4. Dans **Mon planning**, choisis ton propre profil. Pour un administrateur, le rattachement est immédiat.
5. Crée les comptes : dans **Administration → Équipe**, renseigne l'e-mail et un **mot de passe provisoire** à la création du consultant, ou clique sur « Créer le compte » pour un profil existant. Aucun e-mail n'est envoyé : transmets toi-même l'adresse de l'application et le mot de passe. À sa première connexion, chacun doit choisir son propre mot de passe, puis s'affecte à ses missions avec « + Affecter à une mission ». Le bouton « Mot de passe » d'une ligne de l'équipe redonne un mot de passe provisoire à quelqu'un qui l'a oublié.

   *Autre possibilité* : la personne se connecte par lien, choisit son nom et tu valides la demande dans **Administration**.

---

## Mise à jour vers la v2 (déploiement existant)

1. Remplace dans le dépôt GitHub les fichiers `app.js`, `index.html`, `README.md` et le dossier `supabase/` (garde ton `config.js`).
2. Dans Supabase, **SQL Editor** : exécute `supabase/migration_v2.sql`. Les staffings déjà saisis sont convertis en missions + affectations ; rien n'est perdu.
3. Vercel redéploie automatiquement après le commit.

---

## Recommandé pour la production

- **Envoi des e-mails** : le service d'e-mail intégré de Supabase est limité à quelques envois par heure. Pour une équipe de 20 personnes, configure un SMTP professionnel dans **Authentication → Emails → SMTP Settings** (Microsoft 365, Brevo, Resend…).
- **Modèle d'e-mail** : dans **Authentication → Emails → Magic Link**, traduis l'objet et le texte en français.
- **Mots de passe** : la connexion par mot de passe utilise le fournisseur **Email** de Supabase (**Authentication → Sign In / Providers → Email**, activé par défaut). Chaque collaborateur se connecte une première fois par lien, puis choisit son mot de passe avec le bouton « Mot de passe ». « Mot de passe oublié ? » envoie l'e-mail **Reset Password** (à traduire dans **Authentication → Emails**).
- **Autoriser un autre domaine** (filiale…) : exécute `insert into public.allowed_domains (domain) values ('autre-domaine.com');` puis ajoute-le dans `config.js`.
- **Sauvegardes** : le plan gratuit de Supabase ne garde pas d'historique long. Exporte régulièrement les tables (Table Editor → Export CSV) ou passe au plan Pro.

---

## Tester en local

```bash
npx serve -l 3000 .
```

Ouvre ensuite <http://localhost:3000>. Pense à ajouter `http://localhost:3000` aux Redirect URLs de Supabase.

---

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Page et styles |
| `app.js` | Application (calculs, KPI, alertes, écrans) |
| `config.js` | Connexion à Supabase, domaine autorisé, objectifs |
| `vendor/supabase.js` | Client Supabase v2.45.4 (licence MIT, embarqué pour ne dépendre d'aucun CDN) |
| `supabase/schema.sql` | Tables de base, règles de sécurité, restriction de domaine |
| `supabase/migration_v2.sql` | Missions, affectations récurrentes, saisie au jour, gestion des admins |
| `supabase/migration_v3.sql` | E-mail de contact des consultants (rappels) |
| `supabase/seed.sql` | Données d'exemple (optionnel) |
| `vercel.json` | En-têtes de sécurité pour Vercel |

## Rôles

- **Administrateur** (liste gérée dans l'onglet Administration) : missions (import et suppression en masse), équipe, groupes, administrateurs, modification de tous les plannings, et rappels par e-mail (bouton « ✉ Envoyer un rappel » de l'onglet Équipe, qui ouvre la messagerie avec le message prêt).
  Il a aussi l'onglet **Matrice** : vue consolidée consultants × semaines (4 semaines à partir de la semaine en cours, flèches pour avancer ou reculer d'un mois) avec les noms des projets (ex. « CELIO (3/5) / PO (2/5) »), l'interco, le % d'interco, le % interne / avant-vente et le taux de staffing client ; couleurs : vert = 100 % facturé, orange = contient de l'interne / avant-vente, rouge = contient de l'interco, violet = off, pointillés = probable, exportable en CSV pour Excel.
- **Manager** : un consultant dont le rôle est « Manager » ou « Directeur de projet ». Il voit l'onglet Équipe (KPI, alertes, disponibilités) et consulte les plannings des autres en lecture seule.
- **Collaborateur** : ne voit que l'onglet « Mon planning ».

## Règles de calcul

- **Un jour** : si le jour a été ajusté manuellement, c'est cet ajustement qui compte ; sinon, ce sont les missions récurrentes actives ce jour-là (période de l'affectation, dates de la mission, jours de la semaine choisis).
- **Absences** : une absence récurrente (congés, temps partiel) suspend les missions au prorata. Une demi-journée d'absence divise la mission par deux ce jour-là.
- **Capacité nette** : 1 jour par jour ouvré, moins les jours fériés français (calculés automatiquement, Pâques inclus) et les absences.
- **Taux facturable** : missions client / capacité nette.
- **Taux d'occupation** : (missions client + avant-vente + interne) / capacité nette.
- **Intercontrat** : consultant facturable (missions client) à moins de 50 % de sa capacité nette sur la semaine en cours. L'interne, l'avant-vente et une mission « Interco » ne comptent pas comme facturable ; un consultant absent toute la semaine n'est pas compté.
- **Surcharge** : jour où la charge dépasse 100 %.
- **Planning à jour** : planning modifié ou confirmé il y a moins de 14 jours (paramétrable dans `config.js`).
- Les missions **probables** peuvent être inclus ou exclus des calculs grâce à l'interrupteur.
