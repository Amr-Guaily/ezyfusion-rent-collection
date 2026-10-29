// Browser-side calls to our own API routes. The session cookie authenticates them,
// so UI mutations go through exactly the same checks as any other API client.

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

export async function callApi<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(path, {
      method: init.method,
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
    })
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server. Check your connection and try again.' }
  }
  const payload: unknown = await res.json().catch(() => null)
  if (res.ok) return { ok: true, data: payload as T }
  const message =
    typeof payload === 'object' && payload !== null && typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : `Request failed (${res.status})`
  return { ok: false, status: res.status, error: message }
}
