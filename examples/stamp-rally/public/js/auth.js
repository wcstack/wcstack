// Signing in without typing, shared by the route guards and the state (both import this one module, so the browser
// is asked for the saved pair once per page load).
//
// A guard does not see the <wcs-state> tree and, on a page load, runs before @wcstack/state has loaded
// (packages/router/README.md, GuardHandler), so this module reads and writes the session where <wcs-storage> keeps it
// (localStorage "sr.session") and asks the browser through the <wcs-credential id="cred-silent"> element directly.
//
// workaround: the login request here is a plain fetch(), not a <wcs-fetch>: the guard has to *await* the answer before
// it lets the route in, and a <wcs-fetch> is driven from state, which is not there yet on a page load.

export const SESSION_KEY = "sr.session";

export function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null"); } catch { return null; }
}

function apiUrl(path) {
  const delay = new URLSearchParams(location.search).get("delay");
  return delay ? `${path}?delay=${encodeURIComponent(delay)}` : path;
}

// One module for the guards and the state (the guards import it by its URL, state.js by its relative path): this memo
// is shared, so a guard and the state that wait for the same silent sign-in wait for one request.
const memo = { pending: null };

/**
 * Ask the browser for a saved 参加者番号 / あいことば without showing anything (mediation "silent"), and sign in with
 * it. Resolves the session (and saves it), or null. `again` asks a second time in the same page load (after a 401).
 */
export function silentSignIn({ again = false } = {}) {
  if (memo.pending && !again) return memo.pending;
  memo.pending = (async () => {
    const el = document.querySelector("#cred-silent");
    if (!el || typeof el.get !== "function") return null;            // element not defined (package failed to load)
    if (!el.supported) return null;                                     // no saved passwords in this browser
    let cred = null;
    try {
      cred = await el.get({ password: true, mediation: "silent" });   // never throws; failures land in el.error
    } catch { cred = null; }
    if (!cred || cred.type !== "password" || !cred.id || !cred.password) return null;
    try {
      const res = await fetch(apiUrl("/api/login"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: cred.id, phrase: cred.password }),
      });
      if (!res.ok) return null;
      const session = await res.json();
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      return session;
    } catch { return null; }
  })();
  return memo.pending;
}

/** The guard of /team, /walk and /card. */
export async function memberGuard(toPath, fromPath, { searchParams }) {
  if (readSession()?.token) return true;
  const session = await silentSignIn();
  if (session?.token) return { signedInSilently: session };
  const query = new URLSearchParams(searchParams).toString();
  return `/login?next=${encodeURIComponent(query ? `${toPath}?${query}` : toPath)}`;
}
