// みどり市 市民農園 区画管理 — talking to the server. Never throws: every call resolves with
// { ok, status, data, offline }. `status` 0 with `offline: true` means the request did not reach the server.

/** A delay for every API call, for trying the app on a slow server: /?apiDelay=2000 (read once, at load). */
const API_DELAY = Number(new URLSearchParams(globalThis.location?.search ?? "").get("apiDelay") || 0);

/**
 * @param {string} method
 * @param {string} path  e.g. "/api/plots/3"
 * @param {unknown} [body]
 * @returns {Promise<{ ok: boolean, status: number, data: any, offline: boolean }>}
 */
export async function api(method, path, body) {
  let url = path;
  if (API_DELAY > 0) url += `${path.includes("?") ? "&" : "?"}delay=${API_DELAY}`;
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    return { ok: res.ok, status: res.status, data, offline: false };
  } catch (e) {
    return { ok: false, status: 0, data: null, offline: true, error: String(e?.message ?? e) };
  }
}

/** A sentence for a failed call, for a toast. */
export function failureText(r, what) {
  if (r.offline) return `${what}できませんでした（サーバーにつながりません）`;
  if (r.status >= 500) return `${what}できませんでした（サーバーのエラー ${r.status}）`;
  if (r.status === 404) return `${what}できませんでした（見つかりません）`;
  return `${what}できませんでした（${r.status}）`;
}
