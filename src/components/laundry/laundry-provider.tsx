"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api } from "@/lib/api-client";
import type { LaundryStateView } from "@/lib/state-types";
import { StatePoller, type SyncStatus } from "@/lib/sync/poller";

import { useToast } from "./toasts";
import { useLocalNow } from "./use-now";

interface LaundryContextValue {
  state: LaundryStateView;
  status: SyncStatus;
  /** Décalage horloge serveur − horloge locale (ms). */
  clockOffsetMs: number;
  refresh: () => void;
  /** Envoie une action à l'API ; affiche l'erreur traduite ; rafraîchit l'état. Renvoie `true` si réussie. */
  act: (path: string, body?: unknown, method?: string) => Promise<boolean>;
}

const LaundryContext = createContext<LaundryContextValue | null>(null);

export function LaundryProvider({
  initialState,
  children,
}: {
  initialState: LaundryStateView;
  children: ReactNode;
}) {
  const [state, setState] = useState(initialState);
  const [status, setStatus] = useState<SyncStatus>("connecting");
  const [clockOffsetMs, setOffset] = useState(0);
  const poller = useRef<StatePoller | null>(null);
  const toast = useToast();
  const t = useTranslations("errors");
  const router = useRouter();

  useEffect(() => {
    const p = new StatePoller(
      "/api/state",
      {
        fetch: window.fetch.bind(window),
        now: () => Date.now(),
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (h) => window.clearTimeout(h as number),
        doc: document,
        win: window,
        isOnline: () => navigator.onLine,
      },
      {
        onState: setState,
        onStatus: setStatus,
        onClockOffset: setOffset,
        onAuthError: (code) => {
          router.replace(code === "PASSWORD_CHANGE_REQUIRED" ? "/mot-de-passe" : "/connexion");
          router.refresh();
        },
      },
    );
    p.seed(initialState, `"v${initialState.version}"`);
    p.start();
    poller.current = p;
    return () => p.stop();
    // L'état initial ne sert qu'au premier montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(() => poller.current?.refresh(), []);

  const act = useCallback(
    async (path: string, body?: unknown, method?: string) => {
      const res = await api(path, { body, method });
      refresh();
      if (!res.ok) {
        toast.push("error", t.has(res.code) ? t(res.code) : t("INTERNAL"));
        if (res.code === "UNAUTHENTICATED") {
          router.replace("/connexion");
          router.refresh();
        }
        return false;
      }
      return true;
    },
    [refresh, toast, t, router],
  );

  const value = useMemo(
    () => ({ state, status, clockOffsetMs, refresh, act }),
    [state, status, clockOffsetMs, refresh, act],
  );
  return <LaundryContext.Provider value={value}>{children}</LaundryContext.Provider>;
}

export function useLaundry(): LaundryContextValue {
  const ctx = useContext(LaundryContext);
  if (!ctx) throw new Error("LaundryProvider manquant");
  return ctx;
}

/** Heure du serveur estimée, mise à jour chaque seconde. */
export function useServerNow(): number {
  const local = useLocalNow();
  const { clockOffsetMs, state } = useLaundry();
  return local === 0 ? Date.parse(state.serverNow) : local + clockOffsetMs;
}

/** Millisecondes restantes avant `iso` (selon l'heure du serveur). */
export function useRemaining(iso: string | null | undefined): number | null {
  const now = useServerNow();
  return iso ? Date.parse(iso) - now : null;
}
