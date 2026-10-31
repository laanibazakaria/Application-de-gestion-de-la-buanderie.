import type { LaundryStateView } from "../state-types";

import { nextPollDelayMs } from "./cadence";

export type SyncStatus = "connecting" | "live" | "paused" | "offline" | "error";

export interface PollerDeps {
  fetch: typeof fetch;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  /** `document` (visibilité de l'onglet). */
  doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  /** `window` (événements online / offline). */
  win: Pick<Window, "addEventListener" | "removeEventListener">;
  isOnline: () => boolean;
}

export interface PollerListeners {
  onState: (state: LaundryStateView) => void;
  onStatus: (status: SyncStatus) => void;
  /** Décalage horloge serveur − horloge locale (ms), mis à jour à chaque réponse. */
  onClockOffset: (offsetMs: number) => void;
  /** Session absente ou expirée (401), ou mot de passe à changer (403). */
  onAuthError: (code: string) => void;
}

const MAX_BACKOFF_MS = 30_000;

/**
 * Rafraîchissement automatique de l'état, sans dépendance à React (testable).
 *
 * - Envoie la version connue (`If-None-Match`) : le serveur répond 304 si rien n'a changé.
 * - S'ARRÊTE complètement quand l'onglet n'est pas visible, et rafraîchit
 *   immédiatement quand il le redevient.
 * - Rafraîchit immédiatement au retour du réseau ; en cas d'erreur, réessaie
 *   avec un délai croissant (2, 4, 8… 30 s).
 * - `refresh()` après chaque action de l'utilisateur.
 */
export class StatePoller {
  private etag: string | null = null;
  private state: LaundryStateView | null = null;
  private timer: unknown = null;
  private inflight: AbortController | null = null;
  private refreshQueued = false;
  private failures = 0;
  private running = false;
  private offsetMs = 0;

  constructor(
    private readonly url: string,
    private readonly deps: PollerDeps,
    private readonly listeners: PollerListeners,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.deps.doc.addEventListener("visibilitychange", this.onVisibility);
    this.deps.win.addEventListener("online", this.onOnline);
    this.deps.win.addEventListener("offline", this.onOffline);
    this.listeners.onStatus("connecting");
    void this.poll();
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    this.inflight?.abort();
    this.inflight = null;
    this.deps.doc.removeEventListener("visibilitychange", this.onVisibility);
    this.deps.win.removeEventListener("online", this.onOnline);
    this.deps.win.removeEventListener("offline", this.onOffline);
  }

  /** Rafraîchit tout de suite (après une action de l'utilisateur). */
  refresh(): void {
    if (!this.running) return;
    if (this.inflight) {
      this.refreshQueued = true;
      return;
    }
    void this.poll();
  }

  private readonly onVisibility = () => {
    if (this.deps.doc.visibilityState === "visible") {
      this.refresh();
    } else {
      this.clearTimer();
      this.inflight?.abort();
      this.listeners.onStatus("paused");
    }
  };

  private readonly onOnline = () => this.refresh();
  private readonly onOffline = () => this.listeners.onStatus("offline");

  private clearTimer() {
    if (this.timer !== null) this.deps.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number) {
    this.clearTimer();
    if (!this.running || this.deps.doc.visibilityState !== "visible") return;
    this.timer = this.deps.setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, ms);
  }

  private async poll(): Promise<void> {
    this.clearTimer();
    if (!this.running) return;
    if (this.deps.doc.visibilityState !== "visible") {
      this.listeners.onStatus("paused");
      return;
    }
    const controller = new AbortController();
    this.inflight = controller;
    const sentAt = this.deps.now();
    try {
      const res = await this.deps.fetch(this.url, {
        headers: this.etag ? { "If-None-Match": this.etag } : {},
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const receivedAt = this.deps.now();
      const serverNow = res.headers.get("x-server-now");
      if (serverNow) {
        this.offsetMs = Date.parse(serverNow) - (sentAt + receivedAt) / 2;
        this.listeners.onClockOffset(this.offsetMs);
      }
      if (res.status === 401 || res.status === 403) {
        const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        this.listeners.onAuthError(
          body?.error?.code ?? (res.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN"),
        );
        this.stop();
        return;
      }
      if (res.status === 200) {
        const state = (await res.json()) as LaundryStateView;
        this.state = state;
        this.etag = res.headers.get("etag");
        this.listeners.onState(state);
      } else if (res.status !== 304) {
        throw new Error(`HTTP ${res.status}`);
      }
      this.failures = 0;
      this.listeners.onStatus("live");
      this.schedule(nextPollDelayMs(this.state, this.deps.now() + this.offsetMs));
    } catch (err) {
      if (controller.signal.aborted) return; // onglet masqué ou arrêt : rien à faire
      void err;
      this.failures += 1;
      this.listeners.onStatus(this.deps.isOnline() ? "error" : "offline");
      this.schedule(Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.failures));
    } finally {
      if (this.inflight === controller) this.inflight = null;
      if (this.refreshQueued && this.running) {
        this.refreshQueued = false;
        void this.poll();
      }
    }
  }
}
