import type { MachineStatus } from "./machine-state";
import type { WeeklyHours } from "./opening-hours";
import type { ReservationStatus } from "./reservation-state";

export type Role = "admin" | "student";

export interface Settings {
  /** Délai pour se présenter après l'appel (minutes). */
  callDelayMin: number;
  /** Délai pour lancer le cycle après « Je suis là » (minutes). */
  confirmDelayMin: number;
  /** Durées de cycle proposées (minutes). */
  cycleDurationsMin: number[];
  maxActiveReservations: number;
  studentCanStartCycle: boolean;
  /** Avertissement admin à partir de N absences… */
  noShowWarningThreshold: number;
  /** … sur les N derniers jours. */
  noShowWindowDays: number;
}

export const DEFAULT_SETTINGS: Settings = {
  callDelayMin: 5,
  confirmDelayMin: 3,
  cycleDurationsMin: [30, 45, 60, 90],
  maxActiveReservations: 1,
  studentCanStartCycle: true,
  noShowWarningThreshold: 3,
  noShowWindowDays: 30,
};

export interface Machine {
  id: number;
  number: number;
  name: string;
  status: MachineStatus;
  defaultDurationMin: number;
}

export type CycleStatus = "running" | "finished" | "cancelled";
export type CycleEndReason = "completed" | "ended_early" | "cancelled";

export interface Cycle {
  id: string;
  machineId: number;
  studentId: string;
  reservationId: string | null;
  startedAt: Date;
  plannedDurationMin: number;
  /** Source de vérité du temps restant : toujours calculé à partir de cette heure. */
  plannedEndAt: Date;
  actualEndAt: Date | null;
  status: CycleStatus;
  endReason: CycleEndReason | null;
}

export type CloseReason =
  "fulfilled" | "no_show" | "not_started" | "cancelled_by_student" | "cancelled_by_admin" | "laundry_closed";

export type ReservationNotice = "machine_out_of_service";

export interface Reservation {
  id: string;
  studentId: string;
  /** Machine demandée, ou `null` pour « première disponible ». */
  targetMachineId: number | null;
  /** Machine attribuée au moment de l'appel. */
  assignedMachineId: number | null;
  /** Ordre global d'arrivée (plus petit = plus tôt). Réordonnable par l'admin. */
  rank: number;
  status: ReservationStatus;
  createdAt: Date;
  calledAt: Date | null;
  callDeadlineAt: Date | null;
  confirmedAt: Date | null;
  confirmDeadlineAt: Date | null;
  closedAt: Date | null;
  closeReason: CloseReason | null;
  notice: ReservationNotice | null;
}

export type Actor = { kind: "system" } | { kind: "user"; id: string; role: Role };

export const SYSTEM_ACTOR: Actor = { kind: "system" };

export type EntityType = "machine" | "cycle" | "reservation" | "settings" | "user" | "opening_hours";

export interface LogEntry {
  action: string;
  actorId: string | null;
  entityType: EntityType;
  entityId: string;
  details: Record<string, unknown>;
}

export type NotificationKind =
  | "called"
  | "expired_no_show"
  | "expired_not_started"
  | "cycle_finished"
  | "machine_out_of_service"
  | "machine_back_in_service"
  | "cancelled_laundry_closed"
  | "cancelled_by_admin";

export interface Notification {
  userId: string;
  kind: NotificationKind;
  details: Record<string, unknown>;
}

/** État chargé depuis la base au début d'une transaction. */
export interface LaundrySnapshot {
  machines: Machine[];
  /** Cycles en cours uniquement. */
  runningCycles: Cycle[];
  /** Réservations actives uniquement (waiting, called, confirmed). */
  activeReservations: Reservation[];
  settings: Settings;
  hours: WeeklyHours;
  timeZone: string;
}
