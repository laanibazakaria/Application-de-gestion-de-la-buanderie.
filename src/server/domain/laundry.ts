import { addMinutes } from "@/lib/time";

import { DomainError } from "./errors";
import { transitionMachine } from "./machine-state";
import { currentPeriod, isOpenAt, lastClosingAtOrBefore } from "./opening-hours";
import { compareReservations, pickNextForMachine, rankBefore, waitingInOrder } from "./queue";
import { isActiveReservationStatus, transitionReservation } from "./reservation-state";
import type {
  Actor,
  CloseReason,
  Cycle,
  EntityType,
  LaundrySnapshot,
  LogEntry,
  Machine,
  Notification,
  NotificationKind,
  Reservation,
  Settings,
} from "./types";

/** Durée maximale qu'un administrateur peut choisir ou ajouter à un cycle (minutes). */
export const ADMIN_MAX_DURATION_MIN = 300;
export const MAX_EXTENSION_MIN = 120;

export interface LaundryChanges {
  machines: Machine[];
  cycles: Cycle[];
  reservations: Reservation[];
  logs: LogEntry[];
  notifications: Notification[];
}

export interface LaundryDeps {
  now: Date;
  newId: () => string;
}

type DueEvent =
  | { kind: "cycle_end"; at: Date; cycle: Cycle }
  | { kind: "call_expired"; at: Date; reservation: Reservation }
  | { kind: "confirm_expired"; at: Date; reservation: Reservation }
  | { kind: "closing"; at: Date };

const EVENT_PRIORITY: Record<DueEvent["kind"], number> = {
  cycle_end: 0,
  call_expired: 1,
  confirm_expired: 2,
  closing: 3,
};

/**
 * Moteur métier de la buanderie, sans aucune entrée/sortie.
 *
 * Le service charge un `LaundrySnapshot` dans une transaction (sous verrou global),
 * appelle `settle()` puis la commande demandée, et enregistre `changes()`.
 * Toutes les règles métier vivent ici, ce qui permet de les tester sans base.
 *
 * Toutes les dates sont dérivées de `deps.now` : une même transaction utilise
 * une seule et même heure.
 */
export class Laundry {
  private readonly machines = new Map<number, Machine>();
  private readonly cycles = new Map<string, Cycle>();
  private readonly reservations = new Map<string, Reservation>();
  private readonly settings: Settings;
  private readonly dirtyMachines = new Set<number>();
  private readonly dirtyCycles = new Set<string>();
  private readonly dirtyReservations = new Set<string>();
  private readonly logs: LogEntry[] = [];
  private readonly notifications: Notification[] = [];
  readonly now: Date;

  constructor(
    private readonly snapshot: LaundrySnapshot,
    private readonly deps: LaundryDeps,
  ) {
    for (const m of snapshot.machines) this.machines.set(m.id, { ...m });
    for (const c of snapshot.runningCycles) this.cycles.set(c.id, { ...c });
    for (const r of snapshot.activeReservations) this.reservations.set(r.id, { ...r });
    this.settings = snapshot.settings;
    this.now = deps.now;
  }

  // ---------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------

  machineList(): Machine[] {
    return [...this.machines.values()].sort((a, b) => a.number - b.number);
  }

  runningCycleList(): Cycle[] {
    return [...this.cycles.values()].filter((c) => c.status === "running");
  }

  activeReservationList(): Reservation[] {
    return [...this.reservations.values()]
      .filter((r) => isActiveReservationStatus(r.status))
      .sort(compareReservations);
  }

  isOpen(): boolean {
    return isOpenAt(this.snapshot.hours, this.now, this.snapshot.timeZone);
  }

  /** Modifications à enregistrer en base. */
  changes(): LaundryChanges {
    return {
      machines: [...this.dirtyMachines].map((id) => this.machines.get(id)!),
      cycles: [...this.dirtyCycles].map((id) => this.cycles.get(id)!),
      reservations: [...this.dirtyReservations].map((id) => this.reservations.get(id)!),
      logs: [...this.logs],
      notifications: [...this.notifications],
    };
  }

  hasChanges(): boolean {
    return (
      this.dirtyMachines.size + this.dirtyCycles.size + this.dirtyReservations.size + this.logs.length > 0
    );
  }

  /**
   * Prochaine échéance (stockée dans `laundry_state.next_deadline_at`) : tant qu'elle
   * n'est pas atteinte, une lecture n'a rien à traiter et peut répondre sans verrou.
   */
  nextDeadline(): Date | null {
    const candidates: Date[] = [];
    for (const c of this.runningCycleList()) candidates.push(c.plannedEndAt);
    const active = this.activeReservationList();
    for (const r of active) {
      if (r.status === "called" && r.callDeadlineAt) candidates.push(r.callDeadlineAt);
      if (r.status === "confirmed" && r.confirmDeadlineAt) candidates.push(r.confirmDeadlineAt);
    }
    if (active.some((r) => r.status === "waiting")) {
      // Ouvert : la file sera annulée à la fermeture du jour. Fermé : elle doit l'être tout de suite.
      const period = currentPeriod(this.snapshot.hours, this.now, this.snapshot.timeZone);
      candidates.push(period && !this.closingDueEvent() ? period.closesAt : this.now);
    }
    if (candidates.length === 0) return null;
    return new Date(Math.min(...candidates.map((d) => d.getTime())));
  }

  // ---------------------------------------------------------------------------
  // Échéances
  // ---------------------------------------------------------------------------

  /**
   * Traite, dans l'ordre chronologique, toutes les échéances atteintes à `now` :
   * fins de cycle, délais de présentation, délais de lancement, fermeture.
   * Appelée au début de chaque lecture ou action, et par la tâche planifiée.
   *
   * Les fins de cycle et expirations sont datées de leur échéance exacte. En
   * revanche, un étudiant appelé lors d'un rattrapage reçoit un délai qui part
   * de `now` : un appel n'a de sens que s'il peut être vu.
   *
   * @returns le nombre d'échéances traitées.
   */
  settle(): number {
    let processed = 0;
    for (let guard = 0; guard < 10_000; guard++) {
      const event = this.earliestDueEvent();
      if (!event) break;
      this.applyDueEvent(event);
      processed++;
    }
    this.callFreeMachines();
    return processed;
  }

  /**
   * Une réservation en attente est caduque si une fermeture a eu lieu depuis sa création,
   * ou si la buanderie est fermée en ce moment (horaires modifiés par l'admin) : on ne
   * peut pas réserver quand c'est fermé, donc une file existant pendant la fermeture
   * date forcément d'avant celle-ci.
   */
  private isStaleWaiting(r: Reservation, lastClosing: Date | null, open: boolean): boolean {
    return (
      r.status === "waiting" &&
      (!open || (lastClosing !== null && r.createdAt.getTime() < lastClosing.getTime()))
    );
  }

  private closingDueEvent(): DueEvent | null {
    const { hours, timeZone } = this.snapshot;
    const lastClosing = lastClosingAtOrBefore(hours, this.now, timeZone);
    const open = this.isOpen();
    const stale = this.activeReservationList().filter((r) => this.isStaleWaiting(r, lastClosing, open));
    if (stale.length === 0) return null;
    const closedBeforeAll =
      lastClosing !== null && stale.every((r) => r.createdAt.getTime() < lastClosing.getTime());
    return { kind: "closing", at: closedBeforeAll ? lastClosing : this.now };
  }

  private earliestDueEvent(): DueEvent | null {
    const now = this.now.getTime();
    const events: DueEvent[] = [];
    for (const cycle of this.runningCycleList()) {
      if (cycle.plannedEndAt.getTime() <= now)
        events.push({ kind: "cycle_end", at: cycle.plannedEndAt, cycle });
    }
    for (const r of this.activeReservationList()) {
      if (r.status === "called" && r.callDeadlineAt && r.callDeadlineAt.getTime() <= now) {
        events.push({ kind: "call_expired", at: r.callDeadlineAt, reservation: r });
      }
      if (r.status === "confirmed" && r.confirmDeadlineAt && r.confirmDeadlineAt.getTime() <= now) {
        events.push({ kind: "confirm_expired", at: r.confirmDeadlineAt, reservation: r });
      }
    }
    const closing = this.closingDueEvent();
    if (closing) events.push(closing);
    events.sort((a, b) => a.at.getTime() - b.at.getTime() || EVENT_PRIORITY[a.kind] - EVENT_PRIORITY[b.kind]);
    return events[0] ?? null;
  }

  private applyDueEvent(event: DueEvent): void {
    switch (event.kind) {
      case "cycle_end": {
        const { cycle } = event;
        this.finishCycle(cycle, "finished", "completed", cycle.plannedEndAt);
        this.log("cycle.completed", null, "cycle", cycle.id, { machineId: cycle.machineId });
        this.notify(cycle.studentId, "cycle_finished", { machineId: cycle.machineId, cycleId: cycle.id });
        this.callNext(cycle.machineId);
        break;
      }
      case "call_expired":
      case "confirm_expired": {
        const r = event.reservation;
        const machineId = r.assignedMachineId;
        const reason: CloseReason = event.kind === "call_expired" ? "no_show" : "not_started";
        this.closeReservation(r, "expire", reason, event.at);
        this.log(`reservation.expired.${reason}`, null, "reservation", r.id, { machineId });
        this.notify(r.studentId, event.kind === "call_expired" ? "expired_no_show" : "expired_not_started", {
          reservationId: r.id,
          machineId,
        });
        if (machineId !== null) {
          this.releaseCall(machineId);
          this.callNext(machineId);
        }
        break;
      }
      case "closing": {
        const { hours, timeZone } = this.snapshot;
        const lastClosing = lastClosingAtOrBefore(hours, this.now, timeZone);
        const open = this.isOpen();
        for (const r of this.activeReservationList()) {
          if (this.isStaleWaiting(r, lastClosing, open)) {
            const at = r.createdAt.getTime() > event.at.getTime() ? r.createdAt : event.at;
            this.closeReservation(r, "cancel", "laundry_closed", at);
            this.log("reservation.cancelled.laundry_closed", null, "reservation", r.id, {});
            this.notify(r.studentId, "cancelled_laundry_closed", { reservationId: r.id });
          }
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Commandes
  // ---------------------------------------------------------------------------

  /** Réserve une machine précise (`targetMachineId`) ou la première disponible (`null`). */
  reserve(actor: Actor, studentId: string, targetMachineId: number | null): Reservation {
    this.requireUserOrAdmin(actor, studentId);
    if (!this.isOpen()) throw new DomainError("LAUNDRY_CLOSED");
    if (this.runningCycleList().some((c) => c.studentId === studentId)) {
      throw new DomainError("OWN_CYCLE_RUNNING");
    }
    const activeCount = this.activeReservationList().filter((r) => r.studentId === studentId).length;
    if (activeCount >= this.settings.maxActiveReservations) {
      throw new DomainError("MAX_ACTIVE_RESERVATIONS", undefined, {
        max: this.settings.maxActiveReservations,
      });
    }
    if (targetMachineId !== null) {
      const machine = this.machine(targetMachineId);
      if (machine.status === "out_of_service") throw new DomainError("MACHINE_OUT_OF_SERVICE");
    }

    const reservation: Reservation = {
      id: this.deps.newId(),
      studentId,
      targetMachineId,
      assignedMachineId: null,
      rank: this.maxRank() + 1,
      status: "waiting",
      createdAt: this.now,
      calledAt: null,
      callDeadlineAt: null,
      confirmedAt: null,
      confirmDeadlineAt: null,
      closedAt: null,
      closeReason: null,
      notice: null,
    };
    this.reservations.set(reservation.id, reservation);
    this.dirtyReservations.add(reservation.id);
    this.log(
      actor.kind === "user" && actor.role === "admin" ? "queue.added_by_admin" : "reservation.created",
      this.actorId(actor),
      "reservation",
      reservation.id,
      {
        studentId,
        targetMachineId,
      },
    );
    this.callFreeMachines();
    return reservation;
  }

  /** Annulation par l'étudiant (sa propre réservation) ou retrait de la file par l'admin. */
  cancelReservation(actor: Actor, reservationId: string): void {
    const r = this.reservation(reservationId);
    this.requireUserOrAdmin(actor, r.studentId);
    const byAdmin = actor.kind === "user" && actor.role === "admin" && actor.id !== r.studentId;
    const machineId = r.status === "called" || r.status === "confirmed" ? r.assignedMachineId : null;
    this.closeReservation(r, "cancel", byAdmin ? "cancelled_by_admin" : "cancelled_by_student", this.now);
    this.log(
      byAdmin ? "queue.removed_by_admin" : "reservation.cancelled",
      this.actorId(actor),
      "reservation",
      r.id,
      {
        machineId,
      },
    );
    if (byAdmin) this.notify(r.studentId, "cancelled_by_admin", { reservationId: r.id });
    if (machineId !== null) {
      // L'étudiant appelé annule : on appelle immédiatement le suivant.
      this.releaseCall(machineId);
      this.callNext(machineId);
    }
    this.callFreeMachines();
  }

  /** « Je suis là » : par l'étudiant appelé, ou par l'admin pour lui. */
  confirmPresence(actor: Actor, reservationId: string): void {
    const r = this.reservation(reservationId);
    this.requireUserOrAdmin(actor, r.studentId);
    r.status = transitionReservation(r.status, "confirm");
    r.confirmedAt = this.now;
    r.confirmDeadlineAt = addMinutes(this.now, this.settings.confirmDelayMin);
    this.dirtyReservations.add(r.id);
    this.log("reservation.confirmed", this.actorId(actor), "reservation", r.id, {
      machineId: r.assignedMachineId,
    });
  }

  /**
   * Lance un cycle.
   * - Machine en attente de l'étudiant : pour l'étudiant appelé (l'admin peut lancer
   *   même sans « Je suis là », la présence est alors confirmée par lui).
   * - Machine libre : lancement direct par l'admin pour un étudiant présent (`studentId`).
   */
  startCycle(actor: Actor, input: { machineId: number; durationMin: number; studentId?: string }): Cycle {
    if (actor.kind !== "user") throw new DomainError("FORBIDDEN");
    const isAdmin = actor.role === "admin";
    const machine = this.machine(input.machineId);
    this.validateDuration(input.durationMin, isAdmin);

    if (machine.status === "out_of_service") throw new DomainError("MACHINE_OUT_OF_SERVICE");
    if (machine.status === "running") throw new DomainError("MACHINE_BUSY");

    let studentId: string;
    let reservationId: string | null = null;

    if (machine.status === "awaiting_student") {
      const r = this.calledReservationFor(machine.id);
      if (!r) throw new DomainError("INVALID_TRANSITION");
      if (!isAdmin) {
        if (r.studentId !== actor.id) throw new DomainError("FORBIDDEN");
        if (!this.settings.studentCanStartCycle) throw new DomainError("STUDENT_CANNOT_START");
        if (r.status !== "confirmed")
          throw new DomainError("INVALID_TRANSITION", "Confirmez d'abord votre présence");
      } else if (input.studentId && input.studentId !== r.studentId) {
        throw new DomainError("MACHINE_BUSY", "La machine attend un autre étudiant");
      }
      if (r.status === "called") this.confirmPresence(actor, r.id);
      this.closeReservation(r, "fulfill", "fulfilled", this.now);
      studentId = r.studentId;
      reservationId = r.id;
    } else {
      if (!isAdmin) throw new DomainError("FORBIDDEN");
      if (!input.studentId) throw new DomainError("INVALID_INPUT", "Étudiant requis");
      studentId = input.studentId;
      if (this.runningCycleList().some((c) => c.studentId === studentId))
        throw new DomainError("OWN_CYCLE_RUNNING");
      if (this.activeReservationList().some((r) => r.studentId === studentId)) {
        throw new DomainError("MAX_ACTIVE_RESERVATIONS", "Cet étudiant a déjà une réservation active");
      }
    }

    machine.status = transitionMachine(machine.status, "start_cycle");
    this.dirtyMachines.add(machine.id);
    const cycle: Cycle = {
      id: this.deps.newId(),
      machineId: machine.id,
      studentId,
      reservationId,
      startedAt: this.now,
      plannedDurationMin: input.durationMin,
      plannedEndAt: addMinutes(this.now, input.durationMin),
      actualEndAt: null,
      status: "running",
      endReason: null,
    };
    this.cycles.set(cycle.id, cycle);
    this.dirtyCycles.add(cycle.id);
    this.log("cycle.started", this.actorId(actor), "cycle", cycle.id, {
      machineId: machine.id,
      studentId,
      reservationId,
      durationMin: input.durationMin,
    });
    return cycle;
  }

  extendCycle(actor: Actor, cycleId: string, minutes: number): void {
    this.requireAdmin(actor);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_EXTENSION_MIN) {
      throw new DomainError("INVALID_DURATION");
    }
    const cycle = this.runningCycle(cycleId);
    const machine = this.machine(cycle.machineId);
    machine.status = transitionMachine(machine.status, "extend_cycle");
    cycle.plannedDurationMin += minutes;
    cycle.plannedEndAt = addMinutes(cycle.plannedEndAt, minutes);
    this.dirtyCycles.add(cycle.id);
    this.log("cycle.extended", this.actorId(actor), "cycle", cycle.id, {
      minutes,
      plannedEndAt: cycle.plannedEndAt,
    });
  }

  /** Terminer plus tôt (`ended_early`) ou annuler (`cancelled`) un cycle. */
  stopCycle(actor: Actor, cycleId: string, mode: "ended_early" | "cancelled"): void {
    this.requireAdmin(actor);
    const cycle = this.runningCycle(cycleId);
    this.finishCycle(cycle, mode === "cancelled" ? "cancelled" : "finished", mode, this.now);
    this.log(
      mode === "cancelled" ? "cycle.cancelled" : "cycle.ended_early",
      this.actorId(actor),
      "cycle",
      cycle.id,
      {
        machineId: cycle.machineId,
      },
    );
    if (mode === "ended_early") {
      this.notify(cycle.studentId, "cycle_finished", { machineId: cycle.machineId, cycleId: cycle.id });
    }
    this.callNext(cycle.machineId);
  }

  /**
   * Met une machine hors service. L'étudiant appelé retourne en file à sa place ;
   * les étudiants qui ciblaient cette machine sont prévenus et peuvent basculer en
   * « première disponible ».
   */
  disableMachine(actor: Actor, machineId: number): void {
    this.requireAdmin(actor);
    const machine = this.machine(machineId);
    if (machine.status === "running") {
      throw new DomainError("MACHINE_BUSY", "Terminez ou annulez d'abord le cycle en cours");
    }
    const called = this.calledReservationFor(machine.id);
    machine.status = transitionMachine(machine.status, "disable");
    this.dirtyMachines.add(machine.id);

    if (called) {
      called.status = transitionReservation(called.status, "uncall");
      called.assignedMachineId = null;
      called.calledAt = null;
      called.callDeadlineAt = null;
      called.confirmedAt = null;
      called.confirmDeadlineAt = null;
      this.dirtyReservations.add(called.id);
      if (called.targetMachineId === null) {
        this.notify(called.studentId, "machine_out_of_service", { machineId, reservationId: called.id });
      }
    }
    for (const r of this.activeReservationList()) {
      if (r.status === "waiting" && r.targetMachineId === machine.id) {
        r.notice = "machine_out_of_service";
        this.dirtyReservations.add(r.id);
        this.notify(r.studentId, "machine_out_of_service", { machineId, reservationId: r.id });
      }
    }
    this.log("machine.disabled", this.actorId(actor), "machine", String(machine.id), {});
    this.callFreeMachines();
  }

  enableMachine(actor: Actor, machineId: number): void {
    this.requireAdmin(actor);
    const machine = this.machine(machineId);
    machine.status = transitionMachine(machine.status, "enable");
    this.dirtyMachines.add(machine.id);
    for (const r of this.activeReservationList()) {
      if (r.notice === "machine_out_of_service" && r.targetMachineId === machine.id) {
        r.notice = null;
        this.dirtyReservations.add(r.id);
        this.notify(r.studentId, "machine_back_in_service", { machineId, reservationId: r.id });
      }
    }
    this.log("machine.enabled", this.actorId(actor), "machine", String(machine.id), {});
    this.callFreeMachines();
  }

  /** Bascule une réservation en attente vers « première disponible » (elle garde son rang). */
  switchToFirstAvailable(actor: Actor, reservationId: string): void {
    const r = this.reservation(reservationId);
    this.requireUserOrAdmin(actor, r.studentId);
    if (r.status !== "waiting") throw new DomainError("INVALID_TRANSITION");
    r.targetMachineId = null;
    r.notice = null;
    this.dirtyReservations.add(r.id);
    this.log("reservation.switched_to_any", this.actorId(actor), "reservation", r.id, {});
    this.callFreeMachines();
  }

  /** Réordonne : place `reservationId` juste avant `beforeId` (ou en fin de file si `null`). */
  moveReservation(actor: Actor, reservationId: string, beforeId: string | null): void {
    this.requireAdmin(actor);
    const r = this.reservation(reservationId);
    if (r.status !== "waiting") throw new DomainError("INVALID_TRANSITION");
    const before = beforeId === null ? null : this.reservation(beforeId);
    if (before && (before.status !== "waiting" || before.id === r.id)) throw new DomainError("INVALID_INPUT");

    const others = waitingInOrder(this.reservations.values()).filter((x) => x.id !== r.id);
    const oldRank = r.rank;
    const rank = rankBefore(others, before);
    if (rank !== null) {
      r.rank = rank;
      this.dirtyReservations.add(r.id);
    } else {
      // Écart trop petit : on renumérote toute la file d'attente (1, 2, 3…).
      const index = before ? others.findIndex((x) => x.id === before.id) : others.length;
      const ordered = [...others.slice(0, index), r, ...others.slice(index)];
      ordered.forEach((x, i) => {
        x.rank = i + 1;
        this.dirtyReservations.add(x.id);
      });
    }
    this.log("queue.reordered", this.actorId(actor), "reservation", r.id, {
      beforeId,
      oldRank,
      newRank: r.rank,
    });
  }

  // ---------------------------------------------------------------------------
  // Mécanique interne
  // ---------------------------------------------------------------------------

  /** Appelle le suivant sur chaque machine libre, par numéro croissant. */
  private callFreeMachines(): void {
    for (const m of this.machineList()) if (m.status === "free") this.callNext(m.id);
  }

  /** Si la machine est libre et la buanderie ouverte, appelle le premier étudiant de sa file. */
  private callNext(machineId: number): void {
    const machine = this.machine(machineId);
    if (machine.status !== "free" || !this.isOpen()) return;
    const next = pickNextForMachine(machineId, this.reservations.values());
    if (!next) return;
    next.status = transitionReservation(next.status, "call");
    next.assignedMachineId = machineId;
    next.calledAt = this.now;
    next.callDeadlineAt = addMinutes(this.now, this.settings.callDelayMin);
    next.notice = null;
    this.dirtyReservations.add(next.id);
    machine.status = transitionMachine(machine.status, "call");
    this.dirtyMachines.add(machine.id);
    this.log("reservation.called", null, "reservation", next.id, {
      machineId,
      callDeadlineAt: next.callDeadlineAt,
    });
    this.notify(next.studentId, "called", {
      machineId,
      reservationId: next.id,
      deadline: next.callDeadlineAt,
    });
  }

  private releaseCall(machineId: number): void {
    const machine = this.machine(machineId);
    if (machine.status !== "awaiting_student") return;
    machine.status = transitionMachine(machine.status, "release_call");
    this.dirtyMachines.add(machine.id);
  }

  private finishCycle(
    cycle: Cycle,
    status: "finished" | "cancelled",
    reason: Cycle["endReason"],
    at: Date,
  ): void {
    const machine = this.machine(cycle.machineId);
    machine.status = transitionMachine(machine.status, "end_cycle");
    this.dirtyMachines.add(machine.id);
    cycle.status = status;
    cycle.endReason = reason;
    cycle.actualEndAt = at;
    this.dirtyCycles.add(cycle.id);
  }

  private closeReservation(
    r: Reservation,
    event: "expire" | "cancel" | "fulfill",
    reason: CloseReason,
    at: Date,
  ): void {
    r.status = transitionReservation(r.status, event);
    r.closeReason = reason;
    r.closedAt = at;
    this.dirtyReservations.add(r.id);
  }

  private calledReservationFor(machineId: number): Reservation | null {
    return (
      this.activeReservationList().find(
        (r) => r.assignedMachineId === machineId && (r.status === "called" || r.status === "confirmed"),
      ) ?? null
    );
  }

  private validateDuration(durationMin: number, isAdmin: boolean): void {
    const ok = isAdmin
      ? Number.isInteger(durationMin) && durationMin >= 1 && durationMin <= ADMIN_MAX_DURATION_MIN
      : this.settings.cycleDurationsMin.includes(durationMin);
    if (!ok) throw new DomainError("INVALID_DURATION");
  }

  /**
   * Plus grand rang parmi TOUTES les réservations actives (pas seulement en attente) :
   * un étudiant appelé peut revenir en attente avec son rang (machine mise hors service),
   * il ne doit donc jamais entrer en collision avec une réservation plus récente.
   */
  private maxRank(): number {
    let max = 0;
    for (const r of this.reservations.values())
      if (isActiveReservationStatus(r.status) && r.rank > max) max = r.rank;
    return Math.floor(max);
  }

  private machine(id: number): Machine {
    const m = this.machines.get(id);
    if (!m) throw new DomainError("NOT_FOUND", "Machine introuvable");
    return m;
  }

  private reservation(id: string): Reservation {
    const r = this.reservations.get(id);
    if (!r || !isActiveReservationStatus(r.status))
      throw new DomainError("NOT_FOUND", "Réservation introuvable");
    return r;
  }

  private runningCycle(id: string): Cycle {
    const c = this.cycles.get(id);
    if (!c || c.status !== "running") throw new DomainError("NOT_FOUND", "Cycle introuvable");
    return c;
  }

  private requireAdmin(actor: Actor): void {
    if (actor.kind !== "user" || actor.role !== "admin") throw new DomainError("FORBIDDEN");
  }

  /** L'étudiant concerné lui-même, ou un administrateur. */
  private requireUserOrAdmin(actor: Actor, studentId: string): void {
    if (actor.kind !== "user") throw new DomainError("FORBIDDEN");
    if (actor.role !== "admin" && actor.id !== studentId) throw new DomainError("FORBIDDEN");
  }

  private actorId(actor: Actor): string | null {
    return actor.kind === "user" ? actor.id : null;
  }

  private log(
    action: string,
    actorId: string | null,
    entityType: EntityType,
    entityId: string,
    details: Record<string, unknown>,
  ) {
    this.logs.push({ action, actorId, entityType, entityId, details });
  }

  private notify(userId: string, kind: NotificationKind, details: Record<string, unknown>) {
    this.notifications.push({ userId, kind, details });
  }
}
