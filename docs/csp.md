# wcstack and Content-Security-Policy (CSP compatibility guide)

- **Audience**: anyone running wcstack on a page that enforces a CSP, and implementers making changes that touch CSP
- **Status**: normative. The directive requirements in the tables below are statements of fact about the implementation; a change to one MUST update the other
- **Why this exists**: wcstack sells the idea that dropping in a tag is enough, but **under a strict CSP some of the default spellings do not run**. In particular, the inline `<script>` inside `<wcs-state>` is evaluated through a blob: URL and therefore requires either the page's nonce on the `<script>` that loads state, or `script-src blob:`. With that fact written down nowhere, a user hits an initialization failure with no visible cause
- **See also**: [sri.md](./sri.md) (detecting tampering in the delivery path — its answer is the same "move to the direct path" as here) / [async-io-node-guidelines.md](./async-io-node-guidelines.md) / each package's README
- **日本語版**: [csp.ja.md](./csp.ja.md)

---

## 0. TL;DR

**Trying it out (the single-line `esm.run` form from the quick start)**

```
Content-Security-Policy:
  script-src 'self' https://esm.run https://cdn.jsdelivr.net 'nonce-{RANDOM}' blob:;
  connect-src 'self';
```

**Production (delivery narrowed to one host, state moved into an external file)**

```
Content-Security-Policy:
  script-src 'self' https://cdn.jsdelivr.net 'nonce-{RANDOM}';
  connect-src 'self';
```

Two differences. **`esm.run` 301-redirects to `cdn.jsdelivr.net`, so it costs two hosts** (§1). **`blob:` is needed only if you use the inline `<script>` inside `<wcs-state>`** (§4) — and not even then if the `<script>` that loads state carries the nonce (`<script type="module" nonce="{RANDOM}" src="…">`; the blob: import inherits it). An inline import map needs either a nonce or a hash (§2 / §3).

**Static hosting, where no nonce can be issued (GitHub Pages, object storage)**

```
Content-Security-Policy:
  script-src 'self' https://cdn.jsdelivr.net 'sha256-{digest of the import map}';
  connect-src 'self';
```

A hash stands in for the nonce. But **a hash covers strictly less than a nonce does, and it cannot rescue the inline `<script>` inside `<wcs-state>` either**, so this shape effectively forces the `src=` escape hatch (§3).

---

## 1. Delivery origin — `esm.run` requires two hosts

`esm.run` is a separate host, and the request is 301-redirected:

```
https://esm.run/@wcstack/state/auto
  → 301 → https://cdn.jsdelivr.net/npm/@wcstack/state/auto/+esm
```

CSP **re-checks the redirect target** (path matching is skipped after a redirect, but scheme / host / port are still matched). So `script-src https://esm.run` alone gets refused at the destination. List both.

Moving to a direct `cdn.jsdelivr.net` path brings it down to one host. Note that jsDelivr's bare paths do not resolve `package.json` `exports`, so you have to name the actual file rather than `/auto`:

```
https://cdn.jsdelivr.net/npm/@wcstack/state/auto            → 404
https://cdn.jsdelivr.net/npm/@wcstack/state@1.26.0/dist/auto.min.js → 200
```

The host count is not the only reason to prefer the direct path. `esm.run` lands on the `+esm` endpoint, which re-bundles, so SRI cannot work there in principle; a direct path can carry `integrity`. See [sri.md](./sri.md).

## 2. An import map needs a nonce or a hash (SRI cannot help)

`@components/` resolution in `@wcstack/autoloader` depends on the page's inline import map. An inline `<script type="importmap">` does not execute without `'unsafe-inline'` or a **nonce / hash**. Being inline, it cannot carry an `integrity` attribute.

```html
<script type="importmap" nonce="{RANDOM}">
  { "imports": { "@components/": "/components/" } }
</script>
```

Where no nonce can be issued, a hash substitutes for it. How to compute one, and what the substitution **cannot** cover, is §3.

### 2.1 The split entries of `@wcstack/state`

The split entries (`@wcstack/state/core` and `features/*`; "Split entries" in the state README) are plain ES modules with no `eval`, no `new Function` and no blob:, so loading them needs only the delivery host in the policy — the same as the all-in-one `auto.min.js`. What differs is how many inline scripts the page carries.

| Spelling | Inline scripts | CSP needed |
|---|---|---|
| `dist/auto.min.js` (all-in-one) | none | the delivery host |
| The README example (an import map plus an inline module script calling `installFeatures`) | 2 | the delivery host, plus a nonce or a hash on each of the two (§3.1) |
| The bootstrap in an external file (`/boot.js`) importing the full CDN URLs | none | the delivery host and `'self'` |

- The split files (core, `features/*`, `dist/split/chunks/`) reach one another through static imports; one host entry covers them all.
- Give the bootstrap script the nonce and the static and dynamic imports beyond it inherit it, so a nonce-only policy with no host entry, or `'strict-dynamic'`, works too (checked in a minimal setup on Chromium, Firefox and WebKit, 2026-09-28).
- Narrowing file by file with hashes (§3.2) is not possible: the chunks and `features/*` have no `<script>` tag to hang a hash source on.
- The split entries are not loaded from `esm.run` (state README), so the two-host issue of §1 does not arise.
- For integrity see [sri.md §5.1](./sri.md#51-the-split-entries-of-wcstackstate). The import map's `integrity` lives in the same inline import map, so the CSP requirements in the table do not change.

## 3. When a nonce is unavailable — what a hash can replace

Static hosting (GitHub Pages, object storage, files served straight off a CDN) cannot issue a per-request nonce. **The wcstack quick start is exactly that shape, so a hash is the only option if you want a CSP on such a page.** But a hash covers less than a nonce does.

| Target | `'nonce-…'` | Hash | Notes |
|---|---|---|---|
| Inline import map (§2) | Yes | Yes (`sha256` / `384` / `512`) | The digest is over the contents of the `<script>` (§3.1) |
| External `dist/auto.min.js` (`<script src integrity>`) | Yes | **Chromium only** (`sha384`) | Same value as `integrity`; wcstack ships sha384 (§3.2) |
| Inline `<script type="module">` inside `<wcs-state>` (§4) | Yes (on the `<script>` that loads state) | No | Goes through a blob: URL, so it is never matched as an inline script |
| A `<wcs-route>` guard (§5) | Yes (on the `<script>` that loads router) | No | Same; there is no `src=` escape hatch |
| State in `<script type="application/json">` (§4) | not needed | not needed | Never executed, so `script-src` does not apply |

**A hash does not rescue the two blob: paths, but a nonce does.** A module loaded from a blob: URL is fetched as an *external* script, so it is not a candidate for inline-hash matching and there is nowhere to put an `integrity` attribute. A module's `import()`, on the other hand, inherits the nonce of the `<script>` that loaded the module doing the import (the HTML spec's descendant script fetch options). So a nonce on the `<script>` that loads the state or router bundle admits the blob: import as well (checked with the real 3.x state, state 4.0 and router bundles on Chromium, Firefox and WebKit, 2026-09-28; pinned on Chromium by [e2e/tests/csp.spec.ts](../e2e/tests/csp.spec.ts)). Where no nonce can be issued, it comes down to opening `script-src blob:` or moving to `src=`.

### 3.1 Hashing an inline import map — not one byte may change

The digest is computed over **the contents of the `<script>` itself** — the textContent, including the surrounding newlines and indentation. Re-indenting, adding a comment, or gaining or losing a trailing newline breaks it every time. If a build step reformats your HTML, take the hash **after** it (MUST).

```bash
# Pass the textContent through verbatim (%s so printf adds no newline of its own;
# the leading/trailing newline and the indentation are part of the textContent, so keep them)
printf '%s' '
  { "imports": { "@components/": "/components/" } }
' | openssl dgst -sha256 -binary | openssl base64 -A
```

Rather than matching it by hand, **let the browser tell you the answer**. The console message on a block prints the digest it wants; copy that:

```
Refused to execute inline script because it violates the following Content-Security-Policy
directive: … Either the 'unsafe-inline' keyword, a hash ('sha256-…'), or a nonce … is
required to enable inline execution.
```

### 3.2 Hashing the external bundle — the value is the SRI digest

CSP3 has a path that admits an external script when the digest in its `integrity` attribute matches a hash source in `script-src`. The digest to use for `dist/auto.min.js` is the one already published in each release's `sri.json` ([sri.md §2](./sri.md#2-where-the-digests-come-from--never-ask-the-cdn)). **Nothing has to be computed separately for CSP.**

```
script-src 'self' 'sha384-{digest of auto.min.js}';
```

```html
<script type="module"
        src="https://cdn.jsdelivr.net/npm/@wcstack/state@1.26.0/dist/auto.min.js"
        integrity="sha384-…"></script>
```

Three constraints come with it:

1. **Chromium only** (Firefox has not implemented it — [bug 1409200](https://bugzilla.mozilla.org/show_bug.cgi?id=1409200) — and neither has Safari). In those two the hash source simply fails to match and the script is blocked, so in practice you list the host from §1 alongside it. Which means the hash source buys nothing beyond "Chromium can drop the host allowance"
2. **Every digest in the `integrity` attribute must also appear in `script-src`.** If you list several algorithms, the script is refused when even one of them is missing from the policy
3. **One hash source per `<script>` tag.** On a page that loads many packages, a single host entry is shorter

### 3.3 Out of scope for this document

Combining any of this with `'strict-dynamic'` is **untested end to end on wcstack's paths**. `'strict-dynamic'` disables host-based allowlisting, so an `import()` made from a script loaded through a tag without a nonce (host allowance only) — component resolution in `@wcstack/autoloader`, `<wcs-state src=…>`, blob: evaluation — is refused. Imports made from a module loaded by a nonced `<script>` (static imports, dynamic imports, blob:) inherit that nonce and pass under `'strict-dynamic'` (checked in a minimal setup on Chromium, Firefox and WebKit, 2026-09-28). How dynamic import should interact with CSP is [still under discussion](https://github.com/w3c/webappsec-csp/issues/506) in the spec (the `import-src` proposal). Every recipe here assumes no `'strict-dynamic'`.

## 4. Loading state into `<wcs-state>` — requirements differ per path

This is the most important point in this document. **The CSP requirement changes with the load path.**

| Spelling | Implementation | CSP needed |
|---|---|---|
| `<wcs-state state="<id>">` (referencing a `<script type="application/json">` by id) | `JSON.parse(script.textContent)` | **nothing extra** (a data block is not executed, so `script-src` does not apply) |
| `<wcs-state json='{...}'>` | `JSON.parse` on the attribute value | **nothing extra** |
| `<wcs-state src="./state.js">` | an ordinary `import(url)` | `script-src <origin>` |
| `<wcs-state src="./data.json">` | `fetch(url)` | `connect-src <origin>` |
| the `setInitialState()` API | none | **nothing extra** |
| `<wcs-state><script type="module">…</script></wcs-state>` | **`import()` through a blob: URL** | **a nonce on the `<script>` that loads state**, or **`script-src blob:`** |

State pulls the text of the inline `<script>` out, builds a blob: URL, and dynamically `import()`s it ([loadFromInnerScript.ts](../packages/state/src/stateLoader/loadFromInnerScript.ts)). That is what CSP catches.

**A nonce on the `<script>` that loads state covers it.** An `import()` inherits the nonce of the `<script>` that loaded the module making it — here, the state bundle (§3). Load state through a tag without a nonce (host allowance only) and the blob: import is refused. A hash does not cover it (§3).

**The browser executes that `<script>` too.** Being a child of `<wcs-state>` does not stop it: a `<script type="module">` placed in the document is evaluated by the browser as usual (only one inside a `<template>` is not). Its exports go nowhere, so state's result is unaffected, but two things follow (3.x and 4.0, Chromium, Firefox and WebKit, checked 2026-09-28):

- Under a CSP, the browser's own evaluation of that `<script>` is refused when it carries no nonce, and the console shows one violation. It is separate from state's own load (through blob:), so state still works.
- If that `<script>` carries the nonce as well, or the page has no CSP, its top-level code runs **twice** — once by the browser, once by state. Keep side effects (requests, logging, assignments to globals) out of the top level.

**Under a strict CSP, prefer `src=`.** It needs neither blob: nor a nonce hand-off, and neither of the two effects above occurs. Where no nonce can be issued, opening `script-src blob:` amounts to "allow dynamically generated scripts wholesale", which defeats much of the point of having a policy. Splitting the state definition out into `./state.js` needs no extra directive:

```html
<!-- CSP-safe -->
<wcs-state src="./state.js"></wcs-state>
```

One interaction to know about: if the page sets a `<base href>` — the i18n
locale-basename pattern does exactly that ([i18n-design.md §9-1-4](./i18n-design.md)) —
a *relative* `src="./state.js"` resolves against the base (`/ja/state.js`),
not against the page, and 404s. Under a `<base>`, write the URL root-absolute:
`src="/state.js"`.

## 5. Router guards — a nonce or blob:

A `<wcs-route>` guard script is likewise evaluated through a blob: URL ([loadGuardHandler.ts](../packages/router/src/loadGuardHandler.ts)). As in §4, **a nonce on the `<script>` that loads router covers it** (checked with the real router bundle on Chromium, Firefox and WebKit, 2026-09-28). The guard's `<script>` sits inside a `<template>`, so the browser never evaluates it itself (neither effect in §4 occurs).

Unlike state, though, **guards are inline-only — there is no `src=` escape hatch**. Where no nonce can be issued, using guards makes `script-src blob:` mandatory.

This asymmetry is known; external-file support is not implemented. To keep a strict policy without a nonce, skip guards and control access on the route-rendering side instead.

## 6. I/O nodes that talk to the network

| Package | CSP needed |
|---|---|
| `@wcstack/fetch` / `@wcstack/upload` | `connect-src <API origin>` |
| `@wcstack/websocket` | `connect-src wss://<host>` (state the `ws:`/`wss:` scheme explicitly) |
| `@wcstack/sse` | `connect-src <origin>` |
| `@wcstack/worker` | `worker-src <origin of the script>` |
| `@wcstack/autoloader` | the host `@components/` resolves to, in `script-src` |

Paths that bind a Blob (a `@wcstack/fetch` Blob turned into an object URL, a `@wcstack/camera` recording) need `img-src blob:` or `media-src blob:` depending on where the value is assigned.

## 7. Trusted Types

`require-trusted-types-for 'script'` is supported. What matters is **which sinks wcstack signs and which it refuses to sign**:

| Sink | Input | Handling |
|---|---|---|
| `<wcs-layout>` template expansion ([Layout.ts](../packages/router/src/components/Layout.ts)) | markup the author wrote (an in-document `<template>`, or an app asset fetched with `src`) | signed by the shared `wcstack` identity policy |
| `new Worker(src)` ([WorkerCore.ts](../packages/worker/src/core/WorkerCore.ts)) | the `src` attribute the author wrote | signed by the shared `wcstack` identity policy |
| `<wcs-fetch target>` HTML replace mode ([Fetch.ts](../packages/fetch/src/components/Fetch.ts)) | the response body | **an adopter-supplied sanitizing policy is required**; wcstack never signs it |
| `innerHTML:` / `outerHTML:` / `srcdoc:` property bindings ([applyChangeToProperty.ts](../packages/state/src/apply/applyChangeToProperty.ts)) | a state value | **an adopter-supplied sanitizing policy is required**; wcstack never signs it |

The split is the whole point. The first two carry strings the page author wrote, which is the same ground Lit stands on when it signs its template literals. The last two carry remote data and user-influenced state — signing those with an identity policy would not be "Trusted Types support", it would be turning the policy off, and a security review is right to reject it.

**DCC definition no longer has a sink at all.** [defineDCC.ts](../packages/state/src/dcc/defineDCC.ts) clones the definition's shadow tree node by node instead of round-tripping it through `innerHTML`, so `@wcstack/state` needs no `trusted-types` allowlist entry on its own.

### The policy to allow

```
Content-Security-Policy:
  require-trusted-types-for 'script';
  trusted-types wcstack;
```

The `trusted-types` line is needed **only if the page uses `<wcs-layout>` or `<wcs-worker>`**; everything else runs under `require-trusted-types-for 'script'` alone. One name covers every package: the policy object is created once and shared through a global slot, so two packages never call `createPolicy("wcstack")` twice — a duplicate name throws unless the directive carries `'allow-duplicates'`.

### Injecting your own policy

```html
<script nonce="{RANDOM}">
  globalThis[Symbol.for("wcstack.trustedTypes.policy")] =
    trustedTypes.createPolicy("my-app", {
      createHTML: (s) => DOMPurify.sanitize(s),
      createScriptURL: (s) => s,
    });
</script>
```

If the policy sanitizes, make sure it returns a `TrustedHTML` — DOMPurify needs `RETURN_TRUSTED_TYPE: true`; a policy that returns a bare string is rejected under enforcement.

Bundler users can call `setTrustedTypesPolicy()`, exported from `@wcstack/state`, `@wcstack/router`, `@wcstack/fetch` and `@wcstack/worker` (they all address the same slot). Install it before the first layout expansion / worker spawn / fetch.

**An injected policy is used on the two remote-data sinks only**, and there it applies **even on engines without Trusted Types**, so a sanitizer never silently degrades to a pass-through outside Chromium. It is deliberately **not** applied to author-written markup (`<wcs-layout>`, `new Worker(src)`): an injected policy is normally a sanitizer, and DOMPurify strips custom elements by default — routing a layout through it would silently remove `<wcs-link>` and friends. Author-written strings are signed by the `wcstack` identity policy instead. If that policy cannot be created (the CSP does not allow the name), the injected policy is used as a fallback and a one-time `console.warn` says what may be stripped.

### If you install none

The two remote-data sinks keep failing — deliberately — but they now say so, once, with the fix. The report **replaces** the exception: neither sink throws (the I/O-node never-throw rule), so an automatic `<wcs-fetch target>` run on connect does not become an unhandled rejection, and the rest of the page keeps binding. When the `wcstack` identity policy cannot be created but an injected policy exists, the fallback `console.warn` is the whole report — no `console.error` telling you to inject a policy you already injected.

```
[@wcstack/fetch] The "target" HTML replace mode was blocked by Trusted Types (require-trusted-types-for 'script'). ...
[@wcstack/state] Writing to "innerHTML" was blocked by Trusted Types (require-trusted-types-for 'script'). ...
```

The state property-write path swallows setter exceptions by design (the element is allowed to reject a value), so before this it broke *silently*. Enforcement is confirmed by probing a throwaway element rather than by matching the wording of an error, so a page that installs a `default` policy is correctly read as "not blocked".

### Notes

- **The shared policy object is reachable from page scripts.** To create `wcstack` exactly once across packages, the created policy is kept in a global slot (`Symbol.for("wcstack.trustedTypes.internal")`). Any script running on the page can therefore read it and use its `createHTML` as a Trusted Types bypass gadget. This does not weaken the DOM-XSS case Trusted Types is aimed at — reaching the slot requires script execution, which is already game over — but it is the price of the single shared policy name, and it is stated here because a policy review will ask. Giving each package its own policy name would remove the global slot at the cost of one CSP entry per package.
- Trusted Types ships in Chromium only. Elsewhere every path above is a pass-through.
- All four sinks, both failure paths and the fallback are pinned against an enforcing Chromium in [e2e/tests/trusted-types.spec.ts](../e2e/tests/trusted-types.spec.ts) (fixtures `e2e/fixtures/trusted-types-*.html`); the unit suites can only stub the sinks because happy-dom has no Trusted Types.
- Dynamic `import()` — state's inline `<script>`, router guard handlers, the autoloader — is **not** a Trusted Types sink. It is governed by `script-src` (§4, §5, §9).
- The DCC switch to node cloning carries one behavior change: cloning a `script` element copies its already-started flag, so an inline `<script>` inside a DCC template no longer runs natively once per instance. The state definition inside `<wcs-state>` is unaffected — it evaluates `script.text` itself (§4).

## 8. What does not touch CSP (easily misread)

- **`style` bindings do not require `style-src`.** The `class`/`style` bindings assign CSSOM properties (`element.style.color = …`); they neither parse a `style` attribute nor insert a `<style>` element. CSP's `style-src` does not govern changes made through the CSSOM, so `'unsafe-inline'` is not needed.
- **`data-wcs` expressions are not evaluated.** `data-wcs` declares paths and filter names; there is no `eval` / `new Function`. The repository contains zero uses of either.

## 9. Diagnostics — how to read the errors

The rejection from a dynamic `import()` that CSP blocked says only `Failed to fetch dynamically imported module` and never mentions CSP. So state and router subscribe to `securitypolicyviolation` during evaluation and speak with certainty only when a block was actually observed.

| Output | Meaning |
|---|---|
| `... was blocked by Content-Security-Policy` | **CSP confirmed.** Give the nonce to the `<script>` that loads state / router, add `script-src blob:`, or move to `src=` |
| `Failed to evaluate the inline <script> of …` | No violation was observed. Usually a syntax error in the state definition (the original error is in `cause`) |

Not asserting CSP when no violation was observed is deliberate: it keeps a syntax error from being misattributed to the policy.

**Firefox fires the violation event after the import has failed** (in the next task; Chromium and WebKit fire it before the failure — checked 2026-09-28).

- State 4.0 waits one task after the failure before deciding, so it can assert CSP on every engine. On a page without the diagnostics add-on the message is a number instead of the sentence (`[@wcstack/state] #42` is CSP confirmed, `#43 "…"` the non-asserting one).
- Router waits the same one task in versions after 3.3.0 ([loadGuardHandler.ts](../packages/router/src/loadGuardHandler.ts)). Router up to 3.3.0 and 3.x state do not wait, so on Firefox a CSP block yields the non-asserting message (the second row).
