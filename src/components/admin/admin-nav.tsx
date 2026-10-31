"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const LINKS = [
  { href: "/admin", key: "pilot" },
  { href: "/admin/comptes", key: "accounts" },
  { href: "/admin/parametres", key: "settings" },
  { href: "/admin/journal", key: "activity" },
  { href: "/admin/statistiques", key: "stats" },
] as const;

export function AdminNav() {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="mb-4">
      <ul className="border-line flex flex-wrap gap-1 border-b pb-2">
        {LINKS.map((l) => {
          const current = l.href === "/admin" ? pathname === "/admin" : pathname.startsWith(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold ${current ? "bg-fg text-bg" : "hover:bg-surface-2"}`}
              >
                {t(l.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
