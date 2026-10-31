import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import fr from "../../messages/fr.json";

function keys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}/${k}` : k));
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe("messages français", () => {
  it("aucune clé ne contient de point (séparateur de niveaux de next-intl)", () => {
    expect(keys(fr).filter((k) => k.split("/").some((part) => part.includes(".")))).toEqual([]);
  });

  it("chaque action enregistrée dans le journal a un libellé", () => {
    const code = sources(path.resolve("src/server"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const literal = [
      ...code.matchAll(
        /["'`]((?:reservation|queue|cycle|machine|user|auth|settings|opening_hours)\.[a-z_.]+)["'`]/g,
      ),
    ].map((m) => m[1]!);
    // Actions construites dynamiquement dans le moteur.
    const dynamic = ["reservation.expired.no_show", "reservation.expired.not_started"];
    const actions = new Set([...literal, ...dynamic].filter((a) => !a.endsWith(".")));
    const labels = fr.admin.activity.actions as Record<string, string>;
    const missing = [...actions].filter((a) => !labels[a.replaceAll(".", "_")]);
    expect(missing).toEqual([]);
  });

  it("chaque code d'erreur métier a un message", async () => {
    const { DOMAIN_ERROR_CODES } = await import("@/server/domain/errors");
    const missing = Object.keys(DOMAIN_ERROR_CODES).filter((c) => !(c in fr.errors));
    expect(missing).toEqual([]);
  });

  it("chaque type de message envoyé aux étudiants a un texte", async () => {
    const kinds = [
      "called",
      "expired_no_show",
      "expired_not_started",
      "cycle_finished",
      "machine_out_of_service",
      "machine_back_in_service",
      "cancelled_laundry_closed",
      "cancelled_by_admin",
    ];
    expect(kinds.filter((k) => !(k in fr.alerts))).toEqual([]);
  });
});
