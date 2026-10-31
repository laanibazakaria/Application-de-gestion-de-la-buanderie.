/**
 * Format de l'état renvoyé par GET /api/state (partagé serveur / client).
 * Toutes les dates sont des chaînes ISO 8601 (UTC). Le client calcule les
 * comptes à rebours à partir de ces heures et de `serverNow`, jamais à partir
 * d'un minuteur local.
 */

export type MachineStatusView = "free" | "awaiting_student" | "running" | "out_of_service";
export type ReservationStatusView = "waiting" | "called" | "confirmed";

/** Identité d'un étudiant : visible uniquement par l'administrateur (ou par l'étudiant lui-même). */
export interface StudentRef {
  id: string;
  firstName: string;
  lastName: string;
  room: string | null;
  schoolId: string;
  /** Admin seulement : seuil d'absences atteint sur la période. */
  noShowWarning?: boolean;
  noShowCount?: number;
}

export interface QueueEntryView {
  reservationId: string;
  /** Position dans la file de cette machine (1 = prochain servi). */
  position: number;
  /** Heure estimée de disponibilité, ou `null` si impossible à estimer (machine hors service). */
  estimatedAt: string | null;
  /** Réservation « première disponible » (peut être servie par une autre machine). */
  isAny: boolean;
  isMine: boolean;
  notice: "machine_out_of_service" | null;
  student: StudentRef | null;
}

export interface CycleView {
  id: string;
  startedAt: string;
  plannedDurationMin: number;
  plannedEndAt: string;
  isMine: boolean;
  student: StudentRef | null;
}

export interface CallView {
  reservationId: string;
  status: "called" | "confirmed";
  calledAt: string;
  /** Échéance en cours : délai de présentation (appelé) ou de lancement (confirmé). */
  deadlineAt: string;
  isMine: boolean;
  student: StudentRef | null;
}

export interface MachineView {
  id: number;
  number: number;
  name: string;
  status: MachineStatusView;
  defaultDurationMin: number;
  cycle: CycleView | null;
  call: CallView | null;
  queue: QueueEntryView[];
  /** Heure estimée pour une nouvelle réservation sur cette machine. */
  newReservationEstimateAt: string | null;
}

export interface MyReservationView {
  id: string;
  status: ReservationStatusView;
  targetMachineNumber: number | null;
  assignedMachineNumber: number | null;
  assignedMachineId: number | null;
  position: number | null;
  estimatedAt: string | null;
  estimatedMachineNumber: number | null;
  calledAt: string | null;
  /** Échéance en cours : délai de présentation (appelé) ou de lancement (confirmé). */
  deadlineAt: string | null;
  notice: "machine_out_of_service" | null;
  createdAt: string;
}

export interface MyCycleView {
  id: string;
  machineNumber: number;
  startedAt: string;
  plannedEndAt: string;
  plannedDurationMin: number;
}

export interface NotificationView {
  id: number;
  kind: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface LaundryStateView {
  version: number;
  serverNow: string;
  viewer: { id: string; role: "admin" | "student"; firstName: string; lastName: string };
  laundry: { open: boolean; closesAt: string | null; nextOpeningAt: string | null };
  settings: {
    callDelayMin: number;
    confirmDelayMin: number;
    cycleDurationsMin: number[];
    studentCanStartCycle: boolean;
    maxActiveReservations: number;
  };
  summary: {
    freeCount: number;
    /** Attente la plus courte pour une nouvelle réservation « première disponible » (minutes), `null` si aucune machine. */
    shortestWaitMin: number | null;
    shortestWaitAt: string | null;
  };
  machines: MachineView[];
  me: {
    reservations: MyReservationView[];
    cycle: MyCycleView | null;
    notifications: NotificationView[];
  };
}
