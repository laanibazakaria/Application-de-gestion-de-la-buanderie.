# Architecture

> Document complété au fil des étapes. Version actuelle : modèle de données et règles métier (étape 1).

## Couches

```
src/server/domain/   Logique métier pure, sans entrée/sortie (testée unitairement)
  machine-state.ts      Machine à états d'une machine à laver
  reservation-state.ts  Machine à états d'une réservation
  queue.ts              Ordre de file, « première disponible », positions, rangs
  estimate.ts           Heures de disponibilité estimées
  opening-hours.ts      Horaires d'ouverture (Africa/Casablanca)
  laundry.ts            Moteur : commandes + traitement des échéances (settle)
src/server/db/       Schéma Drizzle, connexion, migrations
drizzle/             Migrations SQL versionnées
```

Le moteur `Laundry` reçoit un instantané de l'état actif (machines, cycles en cours, réservations
actives, paramètres, horaires) et une heure `now`. Il applique les règles et renvoie la liste des
modifications, des entrées du journal et des messages à afficher aux étudiants. Le service (étape 2)
le charge dans une transaction, sous un verrou global, et enregistre le résultat.

## Machine à états : machine

| Depuis             | Événement      | Vers               | Déclencheur                                                     |
| ------------------ | -------------- | ------------------ | --------------------------------------------------------------- |
| `free`             | `call`         | `awaiting_student` | Un étudiant de la file est appelé                               |
| `free`             | `start_cycle`  | `running`          | Admin : lancement direct pour un étudiant présent               |
| `free`             | `disable`      | `out_of_service`   | Admin                                                           |
| `awaiting_student` | `release_call` | `free`             | Expiration ou annulation de l'appelé (puis appel du suivant)    |
| `awaiting_student` | `start_cycle`  | `running`          | Étudiant (après « Je suis là ») ou admin                        |
| `awaiting_student` | `disable`      | `out_of_service`   | Admin (l'appelé retourne en file à sa place)                    |
| `running`          | `extend_cycle` | `running`          | Admin : prolongation                                            |
| `running`          | `end_cycle`    | `free`             | Fin prévue, fin anticipée ou annulation (puis appel du suivant) |
| `out_of_service`   | `enable`       | `free`             | Admin (puis appel du suivant)                                   |

Toute autre combinaison est refusée (`INVALID_TRANSITION`, HTTP 409). Une machine dont le cycle
tourne ne peut pas être mise hors service : il faut d'abord terminer ou annuler le cycle.

Couleurs et icônes : libre = vert, en attente de l'étudiant = orange, en cours = rouge, hors service = gris.

## Machine à états : réservation

| Depuis                           | Événement                               | Vers                      |
| -------------------------------- | --------------------------------------- | ------------------------- |
| `waiting`                        | `call`                                  | `called`                  |
| `called`                         | `confirm` (« Je suis là »)              | `confirmed`               |
| `confirmed`                      | `fulfill` (cycle lancé)                 | `fulfilled`               |
| `called`                         | `expire` (délai de présentation, 5 min) | `expired` (`no_show`)     |
| `confirmed`                      | `expire` (délai de lancement, 3 min)    | `expired` (`not_started`) |
| `called`, `confirmed`            | `uncall` (machine mise hors service)    | `waiting` (même rang)     |
| `waiting`, `called`, `confirmed` | `cancel`                                | `cancelled`               |

`fulfilled`, `expired` et `cancelled` sont terminaux. Le statut `fulfilled` (« honorée ») a été
ajouté aux cinq statuts du cahier des charges pour distinguer une réservation devenue cycle.

## File d'attente

- Chaque réservation a un **rang global** (ordre d'arrivée). Une réservation « première disponible »
  apparaît dans la file de toutes les machines.
- Quand une machine se libère, on appelle la réservation en attente de plus petit rang parmi celles
  qui ciblent cette machine ou acceptent « première disponible ».
- L'admin réordonne en plaçant une réservation avant une autre (rang intermédiaire ; la file est
  renumérotée si les rangs deviennent trop proches).

## Échéances (sans processus permanent)

Les échéances sont des heures absolues stockées en base : `cycles.planned_end_at`,
`reservations.call_deadline_at`, `reservations.confirm_deadline_at`, et la fermeture de la
buanderie (calculée depuis `opening_hours`). `Laundry.settle()` traite, dans l'ordre chronologique,
toutes celles qui sont atteintes :

- une fin de cycle ou une expiration est **datée de son échéance exacte** ;
- un étudiant appelé lors d'un rattrapage reçoit un délai qui **part du moment de l'appel effectif** :
  un appel n'a de sens que s'il peut être vu ;
- à la fermeture, les réservations en file sont annulées ; personne n'est appelé quand c'est fermé.

## Base de données : garanties

| Garantie                                         | Mécanisme                                                     |
| ------------------------------------------------ | ------------------------------------------------------------- |
| Un seul cycle en cours par machine               | index unique partiel `cycles_one_running_per_machine_uq`      |
| Un seul cycle en cours par étudiant              | index unique partiel `cycles_one_running_per_student_uq`      |
| Un seul étudiant appelé/présent par machine      | index unique partiel `reservations_one_called_per_machine_uq` |
| Ordre de file sans ambiguïté                     | index unique partiel `reservations_waiting_rank_uq`           |
| Cohérence des statuts et horodatages             | contraintes `CHECK`                                           |
| Identifiant école unique (insensible à la casse) | index unique sur `lower(school_id)`                           |
