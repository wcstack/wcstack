# router + state + fetch + storage demo (members area)

The members area of a small online store, "Coffee Corner". Anyone can see the home page; a member logs in to see their profile and their order history. The member pages are protected by router guards and read a JSON API that needs a token. The session survives a reload, is shared by every tab, and can expire while the member is using the site.

## Run it

The packages load from a CDN ([esm.run](https://esm.run)), so Node.js alone is enough:

```bash
node examples/router-auth/server.js                     # http://localhost:3000
PORT=3456 TOKEN_TTL_MS=60000 node examples/router-auth/server.js   # tokens expire after a minute
WCS_LOCAL=1 node examples/router-auth/server.js         # use the locally built packages/*/dist
```

The server builds on `examples/shared/server.js` — copy `examples/shared/` along with this directory if you take it out of the repo. Every `GET` that is not a file or an API serves `index.html`, so deep links and reloads work. Tokens live in the server's memory and expire `TOKEN_TTL_MS` after login (default 300000); `POST /api/test/expire-all` expires them all at once.

Members: `alice` / `alice123` (3 orders), `bob` / `bob123` (no orders).

## Things to try

- Open `/account/orders/2` while logged out → `/login?next=%2Faccount%2Forders%2F2` → log in → order 2. Back from the login page returns to where you were, not to the guarded URL.
- Reload any member page → the same page, still logged in.
- `curl -X POST http://localhost:3000/api/test/expire-all`, then open another member page → "Your session has expired — please log in again.", and logging in brings you back there.
- Log out, then press Back → the login page, with no member content.
- Open two tabs. Logging in in one moves the other's open login form on; logging out in one moves the other off its member page.
- Log in as `bob` → "You have no orders yet."
- `/login?next=https://evil.example/` → after logging in you are on `/account`, not off-site.

## The seams it crosses

| Seam | What has to hold |
|---|---|
| router guard × the session | A guard does not see the `<wcs-state>` tree, and on a page load it runs before `@wcstack/state` has loaded. Both guards (`/account` and `/login`) read the session from localStorage, inside the function, so they agree with each other and with every tab. |
| `<wcs-storage>` × state × other tabs | `value#init=element: session`, seeded `null`: the stored session wins at load, every later assignment is saved, and the `storage` event brings other tabs' changes. |
| `<wcs-fetch>` × state × page load | The member fetches get their `url` from state getters that are `null` until a token is there, and the `Authorization` header from `<wcs-fetch-header data-wcs="value: authHeader">` (`null` = no header at all). With a literal `url` the request would leave on a reload before state has set the header. |
| `<wcs-fetch>` 401 × navigation | Each member fetch reports its response on the `memberResponded` event token; a 401 clears the session and replaces the URL with `/login?next=<path>` plus the message. |
| router outputs × state | `typedParams` / `routeName` / `searchParams` flow into state (the order id, which page is a member page, `next`); `navigateUrl` / `replaceUrl` flow back. One `$watch` on the `token` getter handles every session change, here or in another tab: it drops the old member's data, leaves member pages, and moves an open login form on to `next`. |

`next` is followed only when it is a path inside the app; the guard puts the query string back into it (`toPath` has none).

## What building it found

This app was the pilot of the seam apps: a first-time author built it from the public documents only, against 4.0.4, and kept a friction log. The findings, how each was classified and where it went are recorded in [docs/seam-apps.md](../../docs/seam-apps.md#router-auth-2026-10-13). In short, 4.1.0 changed what this app relies on:

- a guard redirect replaces the history entry (Back used to return to the guarded URL and be redirected again), a redirect on page load no longer reloads the document, and a `<wcs-guard-handler>` enables the guard without `guard=""`;
- the router writes the new route's params into state before placing its content;
- an `if:` over a getter no longer applies its content with the value that closes it;
- `<wcs-fetch-header>` has a `value` property, so the header can come from state;
- `wcs-validate` reports any literal seed of a `<wcs-storage>` `value` bound without `#init=element` (it logs every tab out when a second one opens), and an `$on` handler that uses `this`.

Still open: the lint does not report an `onsubmit:` without `#prevent` (with the router, the browser's native GET submission puts the password in the URL), and writing `navigateUrl` to a page whose guard redirects logs `wcs-router navigate failed: AbortError` (the app's own links do not, which is why the home page links to the member area instead of navigating from state).

## Tests

[`e2e/tests/router-auth.spec.ts`](../../e2e/tests/router-auth.spec.ts) runs this server with `WCS_LOCAL=1` in Chromium. It covers every life event above — the deep link (one document load, no member request before the guard lets it through), Back after a guard redirect, the reload (the first request already carries the token), the expiry, logging out (the server revokes the token) and Back, two tabs, bob's empty list, `next` pointing off-site — plus the wrong password, `/login` while logged in and the not-found pages. It also checks that the console has no errors or warnings.
