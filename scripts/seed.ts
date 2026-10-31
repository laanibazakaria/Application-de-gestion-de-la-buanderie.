/**
 * Données de démonstration : 1 administrateur, 15 étudiants, cycles et files en cours,
 * et 4 semaines d'historique (statistiques, absences).
 *
 *   pnpm db:seed            → base locale uniquement
 *   pnpm db:seed --force    → autorise une base distante (ex. : base Neon de démonstration)
 *
 * ATTENTION : vide les comptes, cycles, réservations et le journal avant de remplir.
 */
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL n'est pas définie.");
  process.exit(1);
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host) && !process.argv.includes("--force")) {
  console.error(`Refus : la base ${host} n'est pas locale. Ajoutez --force pour confirmer.`);
  process.exit(1);
}

export const DEMO_ADMIN = { schoolId: "admin", password: "admin-buanderie" };
export const DEMO_STUDENT_PASSWORD = "etudiant123";

const STUDENTS: Array<[string, string, string]> = [
  ["Yassine", "Alaoui", "A101"],
  ["Salma", "Benali", "A102"],
  ["Omar", "Cherkaoui", "A103"],
  ["Imane", "Daoudi", "A104"],
  ["Mehdi", "El Amrani", "A105"],
  ["Fatima Zahra", "El Idrissi", "B201"],
  ["Hamza", "Fassi", "B202"],
  ["Khadija", "Ghazali", "B203"],
  ["Anas", "Haddad", "B204"],
  ["Nour", "Jabri", "B205"],
  ["Ayoub", "Kettani", "C301"],
  ["Sara", "Lahlou", "C302"],
  ["Reda", "Mansouri", "C303"],
  ["Hiba", "Naciri", "C304"],
  ["Ilyas", "Ouazzani", "C305"],
];

async function main() {
  const { hashPassword } = await import("../src/server/auth/password");
  const { runMigrations } = await import("../src/server/db/migrate");
  const { withLaundry } = await import("../src/server/services/laundry-tx");
  const { isOpenAt } = await import("../src/server/domain/opening-hours");
  const { loadHours } = await import("../src/server/services/laundry-tx");
  const { getDb } = await import("../src/server/db/client");
  const { TIME_ZONE } = await import("../src/i18n/config");

  await runMigrations(url!);
  const pool = new Pool({ connectionString: url, max: 2 });
  const q = (text: string, params: unknown[] = []) => pool.query(text, params);

  console.log("Nettoyage…");
  await q("truncate cycles, reservations, sessions, notifications, activity_log, rate_limits, users cascade");
  await q("update machines set status = 'free', updated_at = now()");
  await q(
    "update settings set call_delay_min = 5, confirm_delay_min = 3, cycle_durations_min = '{30,45,60,90}', max_active_reservations = 1, student_can_start_cycle = true where id = 1",
  );

  // Horaires de démonstration : semaine 07:00–23:00, week-end 09:00–23:00.
  await q(
    "update opening_hours set is_open = true, open_minute = case when weekday >= 6 then 540 else 420 end, close_minute = 1380",
  );
  const hours = await loadHours(getDb());
  let allDay = false;
  if (!isOpenAt(hours, new Date(), TIME_ZONE)) {
    // Lancé en dehors des horaires : on ouvre 24 h/24 pour que la démonstration soit immédiatement utilisable.
    await q("update opening_hours set is_open = true, open_minute = 0, close_minute = 1440");
    allDay = true;
  }

  console.log("Comptes…");
  const adminHash = await hashPassword(DEMO_ADMIN.password);
  const studentHash = await hashPassword(DEMO_STUDENT_PASSWORD);
  const { rows: adminRows } = await q(
    `insert into users (role, school_id, first_name, last_name, password_hash, must_change_password)
     values ('admin', $1, 'Responsable', 'Buanderie', $2, false) returning id`,
    [DEMO_ADMIN.schoolId, adminHash],
  );
  const adminId = adminRows[0].id as string;
  const studentIds: string[] = [];
  for (const [i, [first, last, room]] of STUDENTS.entries()) {
    const { rows } = await q(
      `insert into users (role, school_id, first_name, last_name, room, password_hash, must_change_password)
       values ('student', $1, $2, $3, $4, $5, false) returning id`,
      [`E2026-${String(i + 1).padStart(3, "0")}`, first, last, room, studentHash],
    );
    studentIds.push(rows[0].id as string);
  }

  console.log("Historique (4 semaines)…");
  // Heures de pointe réalistes : fin d'après-midi et soirée, plus le samedi matin.
  const peakHours = [7, 8, 12, 13, 17, 18, 18, 19, 19, 19, 20, 20, 20, 21, 21, 22];
  let rank = 1;
  for (let day = 28; day >= 1; day--) {
    const perDay = 4 + ((day * 7) % 6);
    for (let k = 0; k < perDay; k++) {
      const studentId = studentIds[(day * 3 + k) % studentIds.length]!;
      const machineId = ((day + k * 3) % 7) + 1;
      const hour = peakHours[(day + k * 5) % peakHours.length]!;
      const duration = [30, 45, 45, 60, 90][(day + k) % 5]!;
      const started = new Date(Date.now() - day * 86_400_000);
      started.setUTCHours(hour - 1, (k * 13) % 60, 0, 0); // UTC+1 ≈ Casablanca
      const end = new Date(started.getTime() + duration * 60_000);
      const resId = randomUUID();
      await q(
        `insert into reservations (id, student_id, target_machine_id, assigned_machine_id, rank, status, created_at, called_at,
           call_deadline_at, confirmed_at, confirm_deadline_at, closed_at, close_reason)
         values ($1, $2, $3, $3, $4, 'fulfilled', $5::timestamptz - make_interval(mins => $6), $5, $5::timestamptz + interval '5 minutes', $5, $5::timestamptz + interval '3 minutes', $5, 'fulfilled')`,
        // Attente réaliste entre la réservation et l'appel : 0 à 55 minutes, plus longue aux heures de pointe.
        [
          resId,
          studentId,
          machineId,
          -rank++,
          started,
          hour >= 18 ? 15 + ((day * 7 + k * 11) % 41) : (day + k * 3) % 12,
        ],
      );
      await q(
        `insert into cycles (id, machine_id, student_id, reservation_id, started_at, planned_duration_min, planned_end_at, actual_end_at, status, end_reason)
         values ($1, $2, $3, $4, $5, $6, $7, $7, 'finished', 'completed')`,
        [randomUUID(), machineId, studentId, resId, started, duration, end],
      );
    }
    // Quelques absences, dont 3 pour Hamza Fassi (avertissement admin).
    if (day % 4 === 0 || [3, 9, 16].includes(day)) {
      const studentId = [3, 9, 16].includes(day) ? studentIds[6]! : studentIds[day % studentIds.length]!;
      const at = new Date(Date.now() - day * 86_400_000);
      at.setUTCHours(19, 0, 0, 0);
      await q(
        `insert into reservations (id, student_id, target_machine_id, assigned_machine_id, rank, status, created_at, called_at, call_deadline_at, closed_at, close_reason)
         values ($1, $2, 2, 2, $3, 'expired', $4, $4, $4::timestamptz + interval '5 minutes', $4::timestamptz + interval '5 minutes', 'no_show')`,
        [randomUUID(), studentId, -rank++, at],
      );
    }
  }

  console.log("Situation en cours…");
  const admin = { kind: "user" as const, id: adminId, role: "admin" as const };
  const s = (i: number) => studentIds[i]!;
  await withLaundry(({ engine }) => {
    // Cycles en cours avec des temps restants variés.
    engine.startCycle(admin, { machineId: 1, durationMin: 45, studentId: s(0) });
    engine.startCycle(admin, { machineId: 2, durationMin: 30, studentId: s(1) });
    engine.startCycle(admin, { machineId: 4, durationMin: 60, studentId: s(2) });
    engine.startCycle(admin, { machineId: 5, durationMin: 90, studentId: s(3) });
    engine.startCycle(admin, { machineId: 6, durationMin: 20, studentId: s(4) });
    // Machine 7 hors service.
    engine.disableMachine(admin, 7);
    // Machine 3 libre → le premier inscrit est appelé (compte à rebours de présentation).
    engine.reserve(admin, s(5), 3);
    // Files d'attente.
    engine.reserve(admin, s(6), 2);
    engine.reserve(admin, s(7), null);
    engine.reserve(admin, s(8), 1);
    engine.reserve(admin, s(9), 6);
    engine.reserve(admin, s(10), 2);
    engine.reserve(admin, s(11), null);
  });

  await pool.end();
  const { closeDb } = await import("../src/server/db/client");
  await closeDb();

  console.log(`
Données de démonstration prêtes.
  Administrateur : identifiant « ${DEMO_ADMIN.schoolId} », mot de passe « ${DEMO_ADMIN.password} »
  Étudiants      : identifiants E2026-001 à E2026-015, mot de passe « ${DEMO_STUDENT_PASSWORD} »
    - E2026-006 (Fatima Zahra El Idrissi) est appelée sur la machine 3
    - E2026-007 (Hamza Fassi) a 3 absences sur 30 jours (avertissement)
    - E2026-013 à E2026-015 n'ont aucune réservation : prêts à réserver${allDay ? "\n  Lancé en dehors des horaires : la buanderie a été ouverte 24 h/24." : ""}
`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
