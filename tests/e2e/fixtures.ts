import {
  devices,
  expect,
  test as base,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";

import { E2E_BASE_URL, E2E_DATABASE_URL } from "../../playwright.config";

export const PASSWORD = "motdepasse-e2e";
export const ADMIN = "admin-e2e";
export const STUDENTS: ReadonlyArray<{
  id: string;
  firstName: string;
  lastName: string;
  room: string;
  mustChangePassword?: boolean;
}> = [
  { id: "E2E-001", firstName: "Amina", lastName: "Alaoui", room: "A1" },
  { id: "E2E-002", firstName: "Bilal", lastName: "Bennani", room: "A2" },
  { id: "E2E-003", firstName: "Chaimae", lastName: "Chraibi", room: "A3" },
  { id: "E2E-004", firstName: "Driss", lastName: "Daoudi", room: "A4" },
  { id: "E2E-NEW", firstName: "Nouveau", lastName: "Compte", room: "B1", mustChangePassword: true },
];

let pool: Pool | null = null;
export function db(): Pool {
  pool ??= new Pool({ connectionString: E2E_DATABASE_URL, max: 2 });
  return pool;
}

/** Remet la buanderie dans un état connu : tout libre, files vides, ouvert 24 h/24, horloge réelle. */
export async function resetState(request: APIRequestContext) {
  await db().query(
    "truncate cycles, reservations, notifications, activity_log, rate_limits, sessions cascade",
  );
  await db().query(
    "update machines set status = 'free', name = 'Machine ' || number, default_duration_min = 45",
  );
  await db().query(
    "update settings set call_delay_min = 5, confirm_delay_min = 3, cycle_durations_min = '{30,45,60,90}', max_active_reservations = 1, student_can_start_cycle = true",
  );
  await db().query("update opening_hours set is_open = true, open_minute = 0, close_minute = 1440");
  await db().query("update users set must_change_password = (school_id = 'E2E-NEW'), status = 'active'");
  await db().query("update laundry_state set version = version + 1, next_deadline_at = null");
  await setClock(request, 0);
}

/** Horloge simulée du serveur (route /api/test/clock, inaccessible en production). */
export async function setClock(request: APIRequestContext, offsetMs: number) {
  const res = await request.post(`${E2E_BASE_URL}/api/test/clock`, { data: { offsetMs } });
  expect(res.ok()).toBeTruthy();
}
export async function advanceMinutes(request: APIRequestContext, minutes: number) {
  const res = await request.post(`${E2E_BASE_URL}/api/test/clock`, { data: { advanceMs: minutes * 60_000 } });
  expect(res.ok()).toBeTruthy();
}

/** Connexion rapide par l'API (le cookie est partagé avec les pages du contexte). */
export async function loginByApi(context: BrowserContext, schoolId: string, password = PASSWORD) {
  const res = await context.request.post(`${E2E_BASE_URL}/api/auth/login`, {
    data: { schoolId, password },
    headers: { Origin: E2E_BASE_URL },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Ouvre un « téléphone » (nouveau contexte navigateur) connecté et affiche une page. */
export async function phone(browser: Browser, schoolId: string, path = "/"): Promise<Page> {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL: E2E_BASE_URL,
    locale: "fr-FR",
    timezoneId: "Africa/Casablanca",
  });
  await loginByApi(context, schoolId);
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

/**
 * Force un rafraîchissement immédiat (comme au retour du réseau).
 * Utilisé uniquement quand on avance l'horloge du serveur et qu'on ne veut pas attendre
 * l'intervalle normal (15 s) ; les tests de synchronisation, eux, attendent le rythme réel.
 */
export async function nudge(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

export const test = base.extend<{ reset: void }>({
  reset: [
    async ({ request }, use) => {
      await resetState(request);
      await use();
    },
    { auto: true },
  ],
});
export { expect };
