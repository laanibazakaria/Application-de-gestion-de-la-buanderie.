# Buanderie de l'internat

Plateforme web de réservation des **7 machines à laver** de l'internat : état des machines en temps
réel, files d'attente, appel automatique de l'étudiant suivant, délai de présentation de 5 minutes,
pilotage complet par le ou la responsable. Pensée d'abord pour le téléphone, utilisable dans
n'importe quel navigateur, en français (structure prête pour l'arabe).

- **Application** : Next.js 16 (React 19, TypeScript strict), déployée sur **Vercel** (offre gratuite Hobby).
- **Base de données** : PostgreSQL 16 hébergé sur **Neon** (offre gratuite).
- **Échéances** (fin de cycle, délais) : stockées en base et traitées à chaque requête, avec
  **cron-job.org** comme filet de sécurité — aucun serveur permanent.
- **Mise à jour des pages** : rafraîchissement automatique léger (réponse `304` en une seule requête SQL),
  arrêté quand l'onglet est caché.

Documentation complémentaire :

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture, machines à états, échéances, synchronisation, sécurité ;
- [`docs/SCHEMA.md`](docs/SCHEMA.md) — schéma de la base de données ; migrations SQL dans [`drizzle/`](drizzle).

---

## Sommaire

1. [Fonctionnalités](#1-fonctionnalités)
2. [Installation en local](#2-installation-en-local)
3. [Variables d'environnement](#3-variables-denvironnement)
4. [Lancement en développement](#4-lancement-en-développement)
5. [Tests](#5-tests)
6. [Déploiement sur Vercel + Neon](#6-déploiement-sur-vercel--neon)
7. [Tâche planifiée avec cron-job.org](#7-tâche-planifiée-avec-cron-joborg)
8. [Consommation estimée et quotas gratuits](#8-consommation-estimée-et-quotas-gratuits)
9. [Exploitation au quotidien](#9-exploitation-au-quotidien)
10. [Limites connues](#10-limites-connues)
11. [Structure du projet et commandes](#11-structure-du-projet-et-commandes)

---

## 1. Fonctionnalités

**Étudiant** (téléphone ou ordinateur)

- Tableau de bord : 7 cartes (statut avec couleur, icône et texte ; compte à rebours ; file avec
  position et heure estimée), résumé « machines libres / attente la plus courte ».
- Réserver une machine précise ou la **première machine disponible**.
- « Ma réservation » : position, heure estimée, bouton **« Je suis là »** avec compte à rebours,
  choix de la durée et lancement du cycle, annulation.
- **Alertes dans la page** (pas de notification push) : fenêtre plein écran à l'appel, son, vibration
  (Android), titre de l'onglet qui clignote, alerte 1 minute avant l'expiration, fin de cycle,
  expiration, machine hors service, fermeture. Bouton « Garder l'écran allumé ».
- Historique personnel.

**Administrateur** (plusieurs comptes possibles)

- Pilotage : démarrer (étudiant appelé ou démarrage direct), prolonger, terminer, annuler un cycle,
  mettre une machine hors service / en service, confirmer une présence.
- Files : ajouter, retirer, **réordonner par glisser-déposer** (souris, tactile, clavier).
- Comptes : création, **import CSV**, suspension, réinitialisation du mot de passe (mot de passe
  temporaire à changer à la première connexion), avertissement après 3 absences en 30 jours.
- Paramètres : délais, durées proposées, réservations max, horaires **par jour**, machines.
- Journal d'activité complet et statistiques (utilisation par machine, heures de pointe, taux de
  non-présentation, attente moyenne).

**Règles principales** : une réservation active par étudiant (paramétrable), aucune réservation
pendant son propre cycle ni en dehors des horaires ; 5 minutes pour se présenter, puis 3 minutes
pour lancer le cycle, sinon la place passe automatiquement au suivant ; à la fermeture, les files
sont annulées. Toutes les règles et transitions sont vérifiées côté serveur.

---

## 2. Installation en local

### Prérequis

| Outil      | Version                                         |
| ---------- | ----------------------------------------------- |
| Node.js    | 22 ou plus                                      |
| pnpm       | 10 (`corepack enable` l'active automatiquement) |
| PostgreSQL | 16 (local, ou dans Docker)                      |

### Étapes

```bash
git clone https://github.com/laanibazakaria/Application-de-gestion-de-la-buanderie..git buanderie
```

```bash
cd buanderie && corepack enable && pnpm install
```

Créer l'utilisateur et les trois bases locales (développement, tests d'intégration, tests de bout en bout) :

```bash
sudo -u postgres psql -c "create user buanderie with password 'buanderie' createdb;"
```

```bash
for db in buanderie_dev buanderie_test buanderie_e2e; do sudo -u postgres createdb -O buanderie $db; done
```

> Avec Docker à la place d'un PostgreSQL local :
> `docker run -d --name pg -p 5432:5432 -e POSTGRES_USER=buanderie -e POSTGRES_PASSWORD=buanderie -e POSTGRES_DB=buanderie_dev postgres:16`
> puis créer `buanderie_test` et `buanderie_e2e` avec `docker exec pg createdb -U buanderie <nom>`.

Copier la configuration puis créer les tables et les données de démonstration :

```bash
cp .env.example .env
```

```bash
pnpm db:migrate && pnpm db:seed
```

---

## 3. Variables d'environnement

Toutes sont décrites dans [`.env.example`](.env.example).

| Variable                | Obligatoire | Rôle                                                                                                                                                            |
| ----------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | oui         | Connexion PostgreSQL. En production : chaîne **pooled** de Neon (créée par l'intégration).                                                                      |
| `DATABASE_URL_UNPOOLED` | production  | Connexion directe, utilisée par les migrations (créée par l'intégration Neon).                                                                                  |
| `CRON_SECRET`           | oui         | Secret de la tâche planifiée (≥ 32 caractères, `openssl rand -hex 32`).                                                                                         |
| `APP_URL`               | oui         | URL publique, sans `/` final (ex. `https://buanderie.vercel.app`). Sert à la protection CSRF.                                                                   |
| `TEST_DATABASE_URL`     | tests       | Base des tests d'intégration — **vidée**, obligatoirement sur `localhost`.                                                                                      |
| `E2E_DATABASE_URL`      | tests       | Base des tests de bout en bout — **vidée**, obligatoirement sur `localhost`.                                                                                    |
| `E2E_TEST_CLOCK`        | non         | Horloge simulée, posée automatiquement par les tests. **Ne jamais la définir en production** (elle y est ignorée de toute façon : voir `docs/ARCHITECTURE.md`). |

---

## 4. Lancement en développement

```bash
pnpm dev
```

Ouvrir http://localhost:3000. Comptes de démonstration créés par `pnpm db:seed` :

| Rôle           | Identifiant               | Mot de passe      |
| -------------- | ------------------------- | ----------------- |
| Administrateur | `admin`                   | `admin-buanderie` |
| Étudiants      | `E2026-001` à `E2026-015` | `etudiant123`     |

La démonstration contient 5 cycles en cours, une étudiante appelée (`E2026-006`, machine 3), des
files d'attente, la machine 7 hors service, 4 semaines d'historique et un étudiant (`E2026-007`) avec
3 absences. `E2026-013` à `E2026-015` n'ont aucune réservation : utilisez-les pour réserver.

Pour tester sur un vrai téléphone sur le même réseau Wi-Fi : `pnpm build && pnpm start -H 0.0.0.0`, puis
ouvrir `http://<adresse-IP-de-l-ordinateur>:3000` après avoir mis cette adresse dans `APP_URL`.

---

## 5. Tests

| Commande                | Contenu                                                                                                                                                                                                                                                       | Durée  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `pnpm test:unit`        | Machines à états, règles métier (file, expiration, « première disponible », estimations, horaires, fuseau), rythme de rafraîchissement, formats                                                                                                               | ~2 s   |
| `pnpm test:integration` | Routes API sur un vrai PostgreSQL : contrôles d'accès (matrice complète), parcours, **concurrence** (20 réservations simultanées), **redémarrage du serveur**, tâche planifiée, réponse 304 en une requête                                                    | ~30 s  |
| `pnpm test`             | Les deux précédents                                                                                                                                                                                                                                           | ~30 s  |
| `pnpm test:e2e`         | **Bout en bout** (Playwright, téléphone simulé) : réserver → appelé → « Je suis là » → lancer → fin ; **expiration au profit du suivant** ; synchronisation entre téléphones ; hors ligne ; administration ; accès ; **accessibilité WCAG 2.1 AA** (axe-core) | ~2 min |
| `pnpm check`            | Formatage + lint + typage + `pnpm test` + build : **ce qui doit passer avant chaque envoi**                                                                                                                                                                   | ~1 min |

Avant le premier `pnpm test:e2e`, installer le navigateur : `pnpm exec playwright install chromium`.
`E2E_SKIP_BUILD=1 pnpm test:e2e` réutilise le dernier build. Les tests de bout en bout utilisent une
horloge serveur simulée pour vérifier les délais de 5 et 3 minutes sans attendre.

L'intégration continue ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) lance `pnpm check` puis
les tests de bout en bout à chaque envoi sur GitHub.

---

## 6. Déploiement sur Vercel + Neon

### 6.1 Créer le projet Vercel

1. Sur https://vercel.com, **Add New… → Project**, importer le dépôt GitHub.
2. Laisser les réglages détectés (framework Next.js). La commande de build vient de
   [`vercel.json`](vercel.json) : `pnpm db:migrate && pnpm build` — **les migrations sont appliquées à
   chaque déploiement** (elles sont idempotentes). Les fonctions tournent dans la région indiquée par
   `regions` (actuellement `iad1`, Washington), qui **doit être celle de la base Neon** : une action fait
   plusieurs requêtes SQL, chacune ne doit coûter que quelques millisecondes.
3. Ne pas lancer le premier déploiement tout de suite (il échouerait sans base) : passer à l'étape suivante.

### 6.2 Créer la base Neon

1. Dans le projet Vercel : **Storage → Create Database → Neon** (intégration officielle).
2. Région : de préférence **AWS Europe Central 1 (Frankfurt)**, la plus proche du Maroc. **Faire
   correspondre ensuite `regions` dans `vercel.json`** : Francfort → `fra1`, US East 1 (Virginie) → `iad1`,
   Londres → `lhr1`. La base de production actuelle est en US East 1, d'où `iad1` (pour un utilisateur au
   Maroc, ~0,06 s de plus par chargement, imperceptible ; base et fonctions côte à côte, c'est l'essentiel).
   La région d'une base Neon ne peut pas être changée après sa création.
3. Connecter la base au projet pour **Production, Preview et Development**. L'intégration crée
   `DATABASE_URL` (pooled) et `DATABASE_URL_UNPOOLED` (directe), et une branche de base par
   déploiement de prévisualisation.
4. Dans la console Neon, **fixer la taille du calcul à 0,25 CU** (réglage _Compute_ de la branche
   principale : minimum et maximum à 0,25). C'est largement suffisant et c'est ce qui permet de tenir dans le quota
   gratuit (voir §8). Laisser la mise en veille automatique (5 minutes) activée.

### 6.3 Variables d'environnement

Dans **Project → Settings → Environment Variables** (environnement _Production_, et _Preview_ si vous
utilisez les prévisualisations) :

| Variable      | Valeur                                                              |
| ------------- | ------------------------------------------------------------------- |
| `CRON_SECRET` | le résultat de `openssl rand -hex 32` (le garder pour cron-job.org) |
| `APP_URL`     | l'URL de production, ex. `https://buanderie-internat.vercel.app`    |

Ne pas définir `E2E_TEST_CLOCK`.

### 6.4 Déployer et créer le premier administrateur

1. **Deployments → Redeploy** (ou un envoi sur la branche de production). Le journal de build doit
   afficher « Migrations appliquées sur … ».
2. Créer le compte du ou de la responsable, depuis un ordinateur, avec la connexion directe Neon
   (valeur de `DATABASE_URL_UNPOOLED`, visible dans Vercel → Storage → votre base, ou dans la console Neon) :

   ```bash
   DATABASE_URL="<DATABASE_URL_UNPOOLED de Neon>" pnpm admin:create --identifiant responsable --prenom Fatima --nom Alaoui
   ```

   Le script affiche un mot de passe temporaire, à changer à la première connexion.

3. Se connecter sur l'URL de production, choisir un mot de passe, puis dans **Administration** :
   régler les **horaires** et les **paramètres**, renommer les machines si besoin, **importer les
   étudiants** (CSV : `nom;prénom;chambre;identifiant`) et télécharger le fichier des identifiants
   temporaires à distribuer.

> Ne lancez **jamais** `pnpm db:seed` sur la base de production : il efface les comptes et l'historique
> (il refuse d'ailleurs une base distante sans l'option `--force`).

---

## 7. Tâche planifiée avec cron-job.org

L'offre Hobby de Vercel ne permet qu'une tâche planifiée par jour. On utilise donc le service gratuit
https://cron-job.org pour appeler `/api/cron/settle`. Ce n'est qu'un **filet de sécurité** : chaque
page ouverte traite déjà les échéances à chaque rafraîchissement (l'étudiant suivant, en tête de file,
rafraîchit toutes les 3 secondes et déclenche lui-même son appel). La tâche sert quand **personne**
n'a la page ouverte : fins de cycle, expirations et fermeture restent ainsi à jour dans l'historique,
les statistiques et pour le prochain visiteur.

### Réglages

1. Créer un compte sur cron-job.org, puis **Create cronjob** :

   | Champ                                             | Valeur                                                                                                     |
   | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
   | URL                                               | `https://<votre-app>.vercel.app/api/cron/settle`                                                           |
   | Exécution                                         | **toutes les 15 minutes**, uniquement de **07:00 à 23:00** (adapter : de l'ouverture à la fermeture + 1 h) |
   | Fuseau horaire (réglage de la tâche ou du compte) | `Africa/Casablanca`                                                                                        |

2. Dans les options avancées de la tâche :

   | Champ                     | Valeur                                   |
   | ------------------------- | ---------------------------------------- |
   | Request method            | `GET`                                    |
   | Headers                   | `Authorization` = `Bearer <CRON_SECRET>` |
   | Délai d'attente (timeout) | 30 s                                     |

3. Activer les notifications en cas d'échec. **Test run** doit répondre `200` avec un corps du type
   `{"settled":0,"due":false}` ; sans le bon secret, la réponse est `401`.

### Pourquoi toutes les 15 minutes et pas chaque minute ?

Chaque appel touche la base, et Neon ne se met en veille qu'après **5 minutes sans requête**. Un appel
chaque minute garderait la base éveillée **toute la plage horaire, tous les jours** : environ 16 h × 30 j
× 0,25 CU = **120 CU-heures par mois, au-delà des 100 du quota gratuit** — et quand ce quota est épuisé,
**Neon suspend la base jusqu'au mois suivant** (application inutilisable). Toutes les 15 minutes, la
tâche ne coûte qu'environ 1,5 h d'éveil par jour en dehors des moments d'utilisation, et les échéances
« sans témoin » sont traitées en 15 minutes au plus. Ce délai n'affecte personne : dès qu'un étudiant ou
l'administrateur ouvre la page, tout est traité immédiatement. Si vous passez sur une offre payante de
Neon, vous pouvez revenir à un appel par minute.

---

## 8. Consommation estimée et quotas gratuits

### Hypothèses (à ajuster à votre internat)

| Hypothèse                           | Valeur retenue                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| Étudiants inscrits                  | 100                                                                                       |
| Lessives par jour                   | 40 (≈ 2,8 par étudiant et par semaine)                                                    |
| Horaires                            | 07:00 – 22:00 (15 h), tous les jours                                                      |
| Page visible pendant une lessive    | ~20 min avant le cycle (5 min à 3 s, 10 min à 5 s, 5 min à 15 s), ~5 min pendant le cycle |
| Simples consultations               | 1 par étudiant et par jour, 3 min à 15 s                                                  |
| Administrateur                      | page affichée 6 h par jour, rafraîchie toutes les 5 s                                     |
| Tâche planifiée                     | toutes les 15 min de 07:00 à 23:00                                                        |
| Onglets cachés / écrans verrouillés | **0 requête** (rafraîchissement arrêté)                                                   |

### Volume de requêtes

| Origine                                         | Requêtes par jour                    |
| ----------------------------------------------- | ------------------------------------ |
| Étudiants pendant leurs lessives (40 × ~270)    | 10 800                               |
| Consultations simples (100 × 12)                | 1 200                                |
| Administrateur (6 h × 720)                      | 4 320                                |
| Actions (réserver, confirmer, lancer, piloter…) | ~300                                 |
| Pages affichées (rendu serveur)                 | ~400                                 |
| Tâche planifiée                                 | 64                                   |
| **Total**                                       | **≈ 17 100 / jour ≈ 515 000 / mois** |

Environ 85 % de ces requêtes reçoivent un `304` (rien n'a changé) après **une seule** lecture en base.

### Vercel — offre Hobby

| Ressource                                    | Quota mensuel gratuit | Estimation                                                          | Part  |
| -------------------------------------------- | --------------------- | ------------------------------------------------------------------- | ----- |
| Invocations de fonctions                     | 1 000 000             | ~515 000                                                            | ~52 % |
| Requêtes « edge » (API + fichiers statiques) | 1 000 000             | ~560 000                                                            | ~56 % |
| CPU actif                                    | 4 h                   | ~1 h (≈ 3 ms par `304`, ≈ 25 ms par état complet, ≈ 60 ms par page) | ~25 % |
| Transfert de données                         | 100 Go                | ~2 Go                                                               | ~2 %  |
| Tâches planifiées Vercel                     | 1 / jour              | 0 (cron-job.org)                                                    | —     |

Marge confortable. Le premier levier si besoin : passer l'administrateur à 15 s
(`src/lib/sync/cadence.ts`), soit −120 000 requêtes par mois.

### Neon — offre gratuite

| Ressource        | Quota mensuel gratuit      | Estimation                                                                                 | Part         |
| ---------------- | -------------------------- | ------------------------------------------------------------------------------------------ | ------------ |
| Calcul (0,25 CU) | 100 CU-h (≈ 400 h d'éveil) | ~9 h d'éveil/jour liées à l'usage + ~1,5 h dues à la tâche planifiée ≈ 315 h ≈ **79 CU-h** | ~79 %        |
| Stockage         | 1 Go                       | ~100 Mo par an, index compris (≈ 350 lignes de journal et 100 messages par jour)           | ~10 % par an |
| Transfert réseau | 5 Go                       | ~1,8 Go                                                                                    | ~36 %        |

**Point d'attention : le calcul Neon.** La base reste éveillée tant qu'au moins une page est affichée
quelque part (et 5 minutes après). L'estimation tient dans le quota, mais si la buanderie est utilisée
**en continu toute la journée** (base éveillée ~15 h/jour), on atteint ~115 CU-h : **au-delà du quota,
Neon suspend la base jusqu'au mois suivant**. Recommandations :

1. Vérifier chaque semaine **Neon → Billing/Usage → Compute** le premier mois ; si la projection dépasse
   ~85 CU-h, agir avant la fin du mois.
2. Leviers sans coût : horaires réduits ; administrateur à 15 s ; ne pas laisser un écran
   d'administration affiché en permanence (un écran oublié ouvert garde la base éveillée).
3. Leviers à faible coût : offre Neon _Launch_ à l'usage (0,106 $ par CU-h au moment de la rédaction :
   20 CU-h de dépassement ≈ 2 $/mois), ou une autre base PostgreSQL gratuite sans quota d'heures de
   calcul (par exemple Supabase, offre gratuite limitée à 500 Mo) : il suffit de changer `DATABASE_URL`,
   le code n'utilise que du PostgreSQL standard.

> Quotas relevés en octobre 2026 sur les pages officielles ([Vercel Hobby](https://vercel.com/docs/plans/hobby),
> [tarification des fonctions Vercel](https://vercel.com/docs/functions/usage-and-pricing),
> [Neon — offre gratuite](https://neon.com/faqs/free-plan-limits-and-quotas), [tarifs Neon](https://neon.com/pricing)).
> Ils changent régulièrement : vérifiez-les avant la mise en service.

**Usage commercial** : l'offre Hobby de Vercel est réservée à un usage personnel non commercial.
Vérifiez avec l'école que ce cadre convient ; sinon, l'offre Pro fonctionne sans aucune modification du code
(et permet une tâche planifiée Vercel à la minute à la place de cron-job.org).

---

## 9. Exploitation au quotidien

| Besoin                                       | Où                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Un étudiant a oublié son mot de passe        | Administration → Comptes → « Réinitialiser le mot de passe »                                                                                                             |
| Une machine tombe en panne                   | Pilotage → « Mettre hors service » (terminer ou annuler d'abord le cycle en cours). Les étudiants de sa file sont prévenus et peuvent passer en « première disponible ». |
| Un étudiant est présent mais n'a pas réservé | Pilotage → machine libre → « Démarrer un cycle »                                                                                                                         |
| Litige (« j'étais là ! »)                    | Administration → Journal : chaque action est horodatée, avec son auteur (« Système » pour les échéances automatiques)                                                    |
| Absences répétées                            | badge ⚠ dans les files, les comptes et les statistiques (3 absences en 30 jours, paramétrable)                                                                           |
| Nouvelle rentrée                             | Comptes → import CSV ; suspendre les anciens comptes                                                                                                                     |
| Ajouter un administrateur                    | Comptes → Créer un compte → rôle « Administrateur »                                                                                                                      |

---

## 10. Limites connues

- **Pas de notification push.** Un étudiant n'est prévenu que si la page est affichée (alerte, son,
  vibration, titre clignotant). Quand l'onglet est caché ou l'écran verrouillé, la page ne
  communique plus avec le serveur (pour respecter les quotas) : l'alerte s'affiche dès son retour.
  Le bouton « Garder l'écran allumé » et le rappel affiché sous la réservation compensent en partie.
  Exception : les échéances déjà connues (dernière minute du délai, fin de son cycle) sont signalées
  même sans requête.
- **Son** : les navigateurs exigent un premier geste (toucher, clic) avant de jouer un son ; le bouton
  « Activer le son des alertes » l'indique. La vibration n'existe pas sur iPhone.
- **Délai d'affichage** : une modification apparaît chez les autres en 3 à 15 s selon leur situation
  (3 s pour l'étudiant appelé ou en tête de file), immédiatement pour celui qui agit.
- **Arabe** : la structure est prête (`messages/`, `dir="rtl"` automatique, propriétés CSS logiques),
  mais seule la traduction française est fournie. Pour ajouter l'arabe : créer `messages/ar.json`
  (mêmes clés que `fr.json`), ajouter `"ar"` à `locales` dans `src/i18n/config.ts` et choisir la langue
  dans `src/i18n/request.ts` (par exemple d'après la colonne `users.locale`).

---

## 11. Structure du projet et commandes

```
src/
  app/                    pages (connexion, tableau de bord, ma réservation, historique, admin/*) et API (app/api/**)
  components/             interface (laundry/ : étudiant et commun ; admin/ : administration ; ui/ : boutons, icônes)
  lib/                    code partagé client/serveur : validation (Zod), formats, CSV, synchronisation, types de l'état
  server/
    domain/               logique métier pure : machines à états, file, estimations, horaires, moteur « Laundry »
    services/             transactions métier, état, comptes, paramètres, statistiques, historique
    auth/                 mots de passe (argon2id), sessions, protection des pages
    db/                   schéma Drizzle, connexion, migrations
    http/                 enveloppe des routes (droits, CSRF, validation, erreurs)
drizzle/                  migrations SQL versionnées
scripts/                  migrate, seed (démonstration), create-admin
tests/unit | integration | e2e
messages/fr.json          textes de l'interface
```

| Commande                                               | Rôle                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `pnpm dev`                                             | serveur de développement                                                |
| `pnpm build` / `pnpm start`                            | build et serveur de production                                          |
| `pnpm db:migrate`                                      | appliquer les migrations (`DATABASE_URL_UNPOOLED` sinon `DATABASE_URL`) |
| `pnpm db:generate`                                     | générer une migration après modification de `src/server/db/schema.ts`   |
| `pnpm db:seed`                                         | données de démonstration (base locale uniquement, sauf `--force`)       |
| `pnpm db:setup`                                        | `db:migrate` + `db:seed`                                                |
| `pnpm admin:create --identifiant … --prenom … --nom …` | créer un administrateur                                                 |
| `pnpm check`                                           | formatage, lint, typage, tests, build                                   |
| `pnpm test` / `pnpm test:e2e`                          | tests (voir §5)                                                         |
| `pnpm format`                                          | formater le code                                                        |
