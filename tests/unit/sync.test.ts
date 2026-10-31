import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LaundryStateView, MyReservationView } from "@/lib/state-types";
import { baseIntervalMs, FAST_MS, MEDIUM_MS, nextPollDelayMs, SLOW_MS } from "@/lib/sync/cadence";
import { StatePoller, type SyncStatus } from "@/lib/sync/poller";

const NOW = Date.parse("2026-01-14T10:00:00Z");

function stateWith(
  reservations: Partial<MyReservationView>[] = [],
  role: "admin" | "student" = "student",
  version = 1,
) {
  return {
    version,
    serverNow: new Date(NOW).toISOString(),
    viewer: { id: "u", role, firstName: "A", lastName: "B" },
    me: { reservations: reservations as MyReservationView[], cycle: null, notifications: [] },
  } as unknown as LaundryStateView;
}

describe("cadence de rafraîchissement", () => {
  it.each([
    ["aucune réservation", [], SLOW_MS],
    ["appelé", [{ status: "called", position: null }], FAST_MS],
    ["présent (confirmé)", [{ status: "confirmed", position: null }], FAST_MS],
    ["en tête de file", [{ status: "waiting", position: 1 }], FAST_MS],
    ["2e place", [{ status: "waiting", position: 2 }], MEDIUM_MS],
    ["3e place", [{ status: "waiting", position: 3 }], MEDIUM_MS],
    ["4e place", [{ status: "waiting", position: 4 }], SLOW_MS],
  ] as const)("%s → %i ms", (_l, res, expected) => {
    expect(baseIntervalMs(stateWith([...res]))).toBe(expected);
  });

  it("administrateur : 5 s", () => {
    expect(baseIntervalMs(stateWith([], "admin"))).toBe(MEDIUM_MS);
  });

  it("rafraîchit juste après une échéance proche (fin de cycle, délai)", () => {
    const st = stateWith([{ status: "waiting", position: 5 }]);
    st.me.cycle = {
      id: "c",
      machineNumber: 1,
      startedAt: "",
      plannedDurationMin: 30,
      plannedEndAt: new Date(NOW + 4_000).toISOString(),
    };
    expect(nextPollDelayMs(st, NOW)).toBe(5_000);
    expect(nextPollDelayMs(stateWith([{ status: "waiting", position: 5 }]), NOW)).toBe(SLOW_MS);
  });
});

/** Environnement de navigateur simulé. */
function fakeEnv() {
  const listeners = new Map<string, Set<() => void>>();
  const on = (type: string, fn: () => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  };
  const off = (type: string, fn: () => void) => listeners.get(type)?.delete(fn);
  const emit = (type: string) => listeners.get(type)?.forEach((fn) => fn());
  const doc = {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: on,
    removeEventListener: off,
  };
  let online = true;
  const responses: Array<() => Response | Promise<Response>> = [];
  const requests: Array<Record<string, string>> = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    requests.push({ ...(init?.headers as Record<string, string>) });
    if (init?.signal?.aborted) throw new DOMException("abort", "AbortError");
    const next = responses.shift();
    if (!next) throw new TypeError("network");
    return next();
  });
  return {
    doc,
    emit,
    requests,
    fetchMock,
    setOnline: (v: boolean) => (online = v),
    respond: (fn: () => Response | Promise<Response>) => responses.push(fn),
    deps: {
      fetch: fetchMock as unknown as typeof fetch,
      now: () => Date.now(),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
      doc: doc as unknown as Document,
      win: { addEventListener: on, removeEventListener: off } as unknown as Window,
      isOnline: () => online,
    },
  };
}

const ok = (state: LaundryStateView) => () =>
  new Response(JSON.stringify(state), {
    status: 200,
    headers: { etag: `"v${state.version}"`, "x-server-now": new Date(Date.now() + 2000).toISOString() },
  });
const notModified = () => () =>
  new Response(null, { status: 304, headers: { "x-server-now": new Date().toISOString() } });

describe("StatePoller", () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }));
  afterEach(() => vi.useRealTimers());

  function setup() {
    const env = fakeEnv();
    const states: LaundryStateView[] = [];
    const statuses: SyncStatus[] = [];
    const offsets: number[] = [];
    const authErrors: string[] = [];
    const poller = new StatePoller("/api/state", env.deps, {
      onState: (s) => states.push(s),
      onStatus: (s) => statuses.push(s),
      onClockOffset: (o) => offsets.push(o),
      onAuthError: (c) => authErrors.push(c),
    });
    return { env, poller, states, statuses, offsets, authErrors };
  }

  it("première requête sans version, puis envoie la version connue ; 304 conserve l'état", async () => {
    const { env, poller, states } = setup();
    env.respond(ok(stateWith([], "student", 7)));
    env.respond(notModified());
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toHaveLength(1);
    expect(env.requests[0]).toEqual({});
    await vi.advanceTimersByTimeAsync(SLOW_MS);
    expect(env.requests[1]).toEqual({ "If-None-Match": '"v7"' });
    expect(states).toHaveLength(1);
    poller.stop();
  });

  it("rythme adapté : 3 s quand l'étudiant est appelé", async () => {
    const { env, poller } = setup();
    env.respond(ok(stateWith([{ status: "called", position: null }])));
    for (let i = 0; i < 5; i++) env.respond(notModified());
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(FAST_MS * 3);
    expect(env.fetchMock).toHaveBeenCalledTimes(4);
    poller.stop();
  });

  it("s'arrête complètement quand l'onglet est caché, rafraîchit dès qu'il redevient visible", async () => {
    const { env, poller, statuses } = setup();
    env.respond(ok(stateWith()));
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    env.doc.visibilityState = "hidden";
    env.emit("visibilitychange");
    expect(statuses.at(-1)).toBe("paused");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(env.fetchMock).toHaveBeenCalledTimes(1); // aucune requête pendant 10 minutes

    env.respond(notModified());
    env.doc.visibilityState = "visible";
    env.emit("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(env.fetchMock).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toBe("live");
    poller.stop();
  });

  it("hors ligne : réessaie avec un délai croissant, rafraîchit au retour du réseau", async () => {
    const { env, poller, statuses } = setup();
    env.setOnline(false);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("offline");
    await vi.advanceTimersByTimeAsync(2_000); // 1er nouvel essai après 2 s
    expect(env.fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_999); // le 2e attend 4 s
    expect(env.fetchMock).toHaveBeenCalledTimes(2);

    env.setOnline(true);
    env.respond(ok(stateWith()));
    env.emit("online");
    await vi.advanceTimersByTimeAsync(0);
    expect(env.fetchMock).toHaveBeenCalledTimes(3);
    expect(statuses.at(-1)).toBe("live");
    poller.stop();
  });

  it("refresh() après une action : requête immédiate ; mise en file si une requête est en cours", async () => {
    const { env, poller } = setup();
    env.respond(ok(stateWith()));
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    let release!: () => void;
    env.respond(() => new Promise((r) => (release = () => r(notModified()()))));
    env.respond(notModified());
    poller.refresh();
    poller.refresh(); // pendant la requête en cours
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(env.fetchMock).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it("calcule le décalage d'horloge avec le serveur", async () => {
    const { env, poller, offsets } = setup();
    env.respond(ok(stateWith()));
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(offsets[0]).toBeCloseTo(2000, -2);
    poller.stop();
  });

  it("401 : prévient l'application et s'arrête", async () => {
    const { env, poller, authErrors } = setup();
    env.respond(() => new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED" } }), { status: 401 }));
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(authErrors).toEqual(["UNAUTHENTICATED"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(env.fetchMock).toHaveBeenCalledTimes(1);
  });
});
