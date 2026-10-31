-- Données de référence indispensables en production (idempotent).
-- Les 7 machines, les paramètres par défaut, les horaires et l'état de synchronisation.
-- Les comptes (administrateur, étudiants) ne sont PAS créés ici : voir `pnpm admin:create` et `pnpm db:seed`.

INSERT INTO "settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "laundry_state" ("id", "version") VALUES (1, 1) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "machines" ("id", "number", "name", "status", "default_duration_min")
SELECT n, n, 'Machine ' || n, 'free', 45 FROM generate_series(1, 7) AS n
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Horaires par défaut : tous les jours de 07:00 à 22:00 (modifiables dans les paramètres).
INSERT INTO "opening_hours" ("weekday", "is_open", "open_minute", "close_minute")
SELECT d, true, 7 * 60, 22 * 60 FROM generate_series(1, 7) AS d
ON CONFLICT DO NOTHING;
