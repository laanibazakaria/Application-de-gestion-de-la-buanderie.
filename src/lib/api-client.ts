/** Appel à l'API depuis le navigateur. Ne lève jamais : renvoie le code d'erreur à traduire. */
export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; status: number; code: string; message: string; data?: unknown };

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init.method ?? "POST",
      headers: init.body === undefined ? {} : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    if (res.ok) return { ok: true, data: data as T };
    return {
      ok: false,
      status: res.status,
      code: data?.error?.code ?? "INTERNAL",
      message: data?.error?.message ?? "",
      data,
    };
  } catch {
    return { ok: false, status: 0, code: "NETWORK", message: "" };
  }
}
