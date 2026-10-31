"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { api } from "@/lib/api-client";

import { SoundToggle } from "./sound-toggle";

export function AppHeader({
  user,
}: {
  user: { firstName: string; lastName: string; role: "admin" | "student" };
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const router = useRouter();
  const links = [
    { href: "/", label: t("nav.dashboard") },
    ...(user.role === "student"
      ? [
          { href: "/ma-reservation", label: t("nav.myReservation") },
          { href: "/historique", label: t("nav.history") },
        ]
      : [{ href: "/admin", label: t("nav.admin") }]),
  ];

  return (
    <header className="border-line bg-surface border-b">
      <a
        href="#contenu"
        className="focus:bg-accent focus:text-accent-fg sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:px-3 focus:py-2"
      >
        {t("app.skipToContent")}
      </a>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="text-lg font-extrabold">
          🧺 {t("app.name")}
        </Link>
        <span className="text-muted text-sm">
          {user.firstName} {user.lastName}
        </span>
        <div className="ms-auto flex items-center gap-2">
          {user.role === "student" && <SoundToggle />}
          <button
            type="button"
            className="border-line hover:bg-surface-2 min-h-10 rounded-lg border px-3 text-sm font-semibold"
            onClick={async () => {
              await api("/api/auth/logout");
              router.replace("/connexion");
              router.refresh();
            }}
          >
            {t("nav.logout")}
          </button>
        </div>
        <nav aria-label={t("nav.menu")} className="w-full">
          <ul className="flex flex-wrap gap-1">
            {links.map((l) => {
              const current = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={current ? "page" : undefined}
                    className={`inline-flex min-h-10 items-center rounded-lg px-3 font-semibold whitespace-nowrap ${
                      current ? "bg-accent text-accent-fg" : "hover:bg-surface-2"
                    }`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
