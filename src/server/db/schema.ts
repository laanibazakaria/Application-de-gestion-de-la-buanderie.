/**
 * Schéma PostgreSQL (Drizzle). Les migrations SQL générées sont dans ./drizzle.
 *
 * Garanties apportées par la base, en plus du verrou global pris par chaque
 * transaction métier (voir docs/ARCHITECTURE.md) :
 * - au plus un cycle en cours par machine, et par étudiant ;
 * - au plus un étudiant appelé ou présent par machine ;
 * - un rang unique pour chaque réservation en attente (ordre de file sans ambiguïté) ;
 * - des statuts, numéros, durées et horaires toujours valides (contraintes CHECK).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { MACHINE_STATUSES } from "../domain/machine-state";
import { RESERVATION_STATUSES } from "../domain/reservation-state";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => timestamptz("created_at").notNull().defaultNow();

export const userRole = pgEnum("user_role", ["admin", "student"]);
export const userStatus = pgEnum("user_status", ["active", "suspended"]);
export const machineStatus = pgEnum("machine_status", MACHINE_STATUSES);
export const cycleStatus = pgEnum("cycle_status", ["running", "finished", "cancelled"]);
export const cycleEndReason = pgEnum("cycle_end_reason", ["completed", "ended_early", "cancelled"]);
export const reservationStatus = pgEnum("reservation_status", RESERVATION_STATUSES);
export const reservationCloseReason = pgEnum("reservation_close_reason", [
  "fulfilled",
  "no_show",
  "not_started",
  "cancelled_by_student",
  "cancelled_by_admin",
  "laundry_closed",
]);
export const reservationNotice = pgEnum("reservation_notice", ["machine_out_of_service"]);

// ---------------------------------------------------------------------------
// Comptes et sessions
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    role: userRole("role").notNull(),
    /** Identifiant de l'école, utilisé pour se connecter. Unicité insensible à la casse. */
    schoolId: text("school_id").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    /** Numéro de chambre (vide pour un administrateur). */
    room: text("room"),
    passwordHash: text("password_hash").notNull(),
    status: userStatus("status").notNull().default("active"),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    locale: text("locale").notNull().default("fr"),
    createdAt: createdAt(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_school_id_uq").on(sql`lower(${t.schoolId})`),
    index("users_role_idx").on(t.role),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    /** Empreinte SHA-256 du jeton du cookie : un vol de la base ne donne pas de session utilisable. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

// ---------------------------------------------------------------------------
// Machines, cycles, réservations
// ---------------------------------------------------------------------------

export const machines = pgTable(
  "machines",
  {
    id: smallint("id").primaryKey(),
    number: smallint("number").notNull().unique(),
    name: text("name").notNull(),
    status: machineStatus("status").notNull().default("free"),
    defaultDurationMin: smallint("default_duration_min").notNull().default(45),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("machines_number_ck", sql`${t.number} between 1 and 7`),
    check("machines_default_duration_ck", sql`${t.defaultDurationMin} between 1 and 300`),
  ],
);

export const cycles = pgTable(
  "cycles",
  {
    id: uuid("id").primaryKey(),
    machineId: smallint("machine_id")
      .notNull()
      .references(() => machines.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    reservationId: uuid("reservation_id")
      .unique()
      .references(() => reservations.id),
    startedAt: timestamptz("started_at").notNull(),
    plannedDurationMin: smallint("planned_duration_min").notNull(),
    plannedEndAt: timestamptz("planned_end_at").notNull(),
    actualEndAt: timestamptz("actual_end_at"),
    status: cycleStatus("status").notNull(),
    endReason: cycleEndReason("end_reason"),
  },
  (t) => [
    uniqueIndex("cycles_one_running_per_machine_uq")
      .on(t.machineId)
      .where(sql`${t.status} = 'running'`),
    uniqueIndex("cycles_one_running_per_student_uq")
      .on(t.studentId)
      .where(sql`${t.status} = 'running'`),
    index("cycles_running_end_idx")
      .on(t.plannedEndAt)
      .where(sql`${t.status} = 'running'`),
    index("cycles_student_idx").on(t.studentId, t.startedAt),
    index("cycles_started_idx").on(t.startedAt),
    check("cycles_duration_ck", sql`${t.plannedDurationMin} between 1 and 600`),
    check("cycles_end_after_start_ck", sql`${t.plannedEndAt} > ${t.startedAt}`),
    check(
      "cycles_closed_consistency_ck",
      sql`(${t.status} = 'running') = (${t.actualEndAt} is null and ${t.endReason} is null)`,
    ),
  ],
);

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    /** `null` = « première machine disponible ». */
    targetMachineId: smallint("target_machine_id").references(() => machines.id),
    assignedMachineId: smallint("assigned_machine_id").references(() => machines.id),
    rank: doublePrecision("rank").notNull(),
    status: reservationStatus("status").notNull(),
    createdAt: createdAt(),
    calledAt: timestamptz("called_at"),
    callDeadlineAt: timestamptz("call_deadline_at"),
    confirmedAt: timestamptz("confirmed_at"),
    confirmDeadlineAt: timestamptz("confirm_deadline_at"),
    closedAt: timestamptz("closed_at"),
    closeReason: reservationCloseReason("close_reason"),
    notice: reservationNotice("notice"),
  },
  (t) => [
    uniqueIndex("reservations_waiting_rank_uq")
      .on(t.rank)
      .where(sql`${t.status} = 'waiting'`),
    uniqueIndex("reservations_one_called_per_machine_uq")
      .on(t.assignedMachineId)
      .where(sql`${t.status} in ('called', 'confirmed')`),
    index("reservations_active_idx")
      .on(t.status)
      .where(sql`${t.status} in ('waiting', 'called', 'confirmed')`),
    index("reservations_student_idx").on(t.studentId, t.createdAt),
    index("reservations_closed_idx").on(t.closeReason, t.closedAt),
    check(
      "reservations_called_has_machine_ck",
      sql`${t.status} not in ('called', 'confirmed') or (${t.assignedMachineId} is not null and ${t.callDeadlineAt} is not null)`,
    ),
    check(
      "reservations_confirmed_has_deadline_ck",
      sql`${t.status} <> 'confirmed' or ${t.confirmDeadlineAt} is not null`,
    ),
    check(
      "reservations_closed_consistency_ck",
      sql`(${t.status} in ('waiting', 'called', 'confirmed')) = (${t.closedAt} is null and ${t.closeReason} is null)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Paramètres et horaires (lignes uniques modifiables par l'admin)
// ---------------------------------------------------------------------------

export const settings = pgTable(
  "settings",
  {
    id: smallint("id").primaryKey().default(1),
    callDelayMin: smallint("call_delay_min").notNull().default(5),
    confirmDelayMin: smallint("confirm_delay_min").notNull().default(3),
    cycleDurationsMin: smallint("cycle_durations_min")
      .array()
      .notNull()
      .default(sql`'{30,45,60,90}'`),
    maxActiveReservations: smallint("max_active_reservations").notNull().default(1),
    studentCanStartCycle: boolean("student_can_start_cycle").notNull().default(true),
    noShowWarningThreshold: smallint("no_show_warning_threshold").notNull().default(3),
    noShowWindowDays: smallint("no_show_window_days").notNull().default(30),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("settings_singleton_ck", sql`${t.id} = 1`),
    check("settings_call_delay_ck", sql`${t.callDelayMin} between 1 and 60`),
    check("settings_confirm_delay_ck", sql`${t.confirmDelayMin} between 1 and 60`),
    check("settings_max_active_ck", sql`${t.maxActiveReservations} between 1 and 5`),
    check("settings_durations_ck", sql`cardinality(${t.cycleDurationsMin}) between 1 and 10`),
    check(
      "settings_no_show_ck",
      sql`${t.noShowWarningThreshold} >= 1 and ${t.noShowWindowDays} between 1 and 365`,
    ),
  ],
);

export const openingHours = pgTable(
  "opening_hours",
  {
    /** Jour ISO : 1 = lundi … 7 = dimanche. */
    weekday: smallint("weekday").primaryKey(),
    isOpen: boolean("is_open").notNull().default(true),
    /** Minutes depuis minuit, heure de Casablanca. */
    openMinute: smallint("open_minute").notNull(),
    closeMinute: smallint("close_minute").notNull(),
  },
  (t) => [
    check("opening_hours_weekday_ck", sql`${t.weekday} between 1 and 7`),
    check(
      "opening_hours_range_ck",
      sql`${t.openMinute} >= 0 and ${t.closeMinute} <= 1440 and ${t.openMinute} < ${t.closeMinute}`,
    ),
  ],
);

/**
 * Ligne unique lue à chaque rafraîchissement (une lecture par clé primaire) :
 * - `version` augmente à chaque modification : si le client a déjà cette version,
 *   la réponse est un 304 sans autre requête ;
 * - `next_deadline_at` : tant qu'elle n'est pas atteinte, aucune échéance n'est à traiter.
 */
export const laundryState = pgTable(
  "laundry_state",
  {
    id: smallint("id").primaryKey().default(1),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    nextDeadlineAt: timestamptz("next_deadline_at"),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [check("laundry_state_singleton_ck", sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------------------
// Messages, journal, limitation de requêtes
// ---------------------------------------------------------------------------

/** Messages affichés dans la page (pas de Web Push) : appel, expiration, fin de cycle… */
export const notifications = pgTable(
  "notifications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    readAt: timestamptz("read_at"),
  },
  (t) => [
    index("notifications_unread_idx")
      .on(t.userId, t.id)
      .where(sql`${t.readAt} is null`),
  ],
);

/** Journal d'activité : qui a fait quoi, quand. `actor_id` nul = action automatique du système. */
export const activityLog = pgTable(
  "activity_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamptz("at").notNull().defaultNow(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index("activity_log_at_idx").on(t.at),
    index("activity_log_entity_idx").on(t.entityType, t.entityId),
    index("activity_log_actor_idx").on(t.actorId, t.at),
  ],
);

/** Compteurs de limitation de requêtes (fenêtre fixe), stockés en base car Vercel n'a pas de mémoire partagée. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamptz("window_start").notNull(),
  count: integer("count").notNull(),
});
