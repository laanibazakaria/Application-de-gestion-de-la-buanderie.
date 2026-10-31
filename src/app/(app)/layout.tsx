import type { ReactNode } from "react";

import { AlertCenter } from "@/components/laundry/alert-center";
import { AppHeader } from "@/components/laundry/app-header";
import { LaundryProvider } from "@/components/laundry/laundry-provider";
import { SyncBanner } from "@/components/laundry/sync-banner";
import { ToastProvider } from "@/components/laundry/toasts";
import { requirePageUser } from "@/server/auth/page-auth";
import { initialState } from "@/server/services/state-service";

export const dynamic = "force-dynamic";

/**
 * Toutes les pages de l'application exigent une session (vérifiée côté serveur).
 * L'état est rendu avec la page : affichage immédiat, puis rafraîchissement automatique.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser();
  const state = await initialState(user);
  return (
    <ToastProvider>
      <LaundryProvider initialState={state}>
        <AppHeader user={user} />
        <SyncBanner />
        <AlertCenter />
        <main id="contenu" className="mx-auto max-w-6xl px-4 py-4">
          {children}
        </main>
      </LaundryProvider>
    </ToastProvider>
  );
}
