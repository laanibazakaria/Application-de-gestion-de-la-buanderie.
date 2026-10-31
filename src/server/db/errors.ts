/** Code SQLSTATE d'une erreur PostgreSQL (éventuellement enveloppée par Drizzle dans `cause`). */
export function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  for (const c of [e?.code, e?.cause?.code]) if (typeof c === "string" && /^[0-9A-Z]{5}$/.test(c)) return c;
  return undefined;
}
