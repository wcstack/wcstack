# wcstack and Content-Security-Policy (CSP compatibility guide)

- **Audience**: anyone running wcstack on a page that enforces a CSP, and implementers making changes that touch CSP
- **Status**: normative. The directive requirements in the tables below are statements of fact about the implementation; a change to one MUST update the other
- **Why this exists**: wcstack sells the idea that dropping in a tag is enough, but **under a strict CSP some of the default spellings do not run**. In particular, the inline `<script>` inside `<wcs-state>` is evaluated through a blob: URL and therefore requires `script-src blob:`. With that fact written down nowhere, a user hits an initialization failure with no visible cause
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

Two differences. **`esm.run` 301-redirects to `cdn.jsdelivr.net`, so it costs two hosts** (§1). **`blob:` is needed only if you use the inline `<script>` inside `<wcs-state>`** (§4). An inline import map needs either a nonce or a hash (§2 / §3).

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

## 3. When a nonce is unavailable — what a hash can replace

Static hosting (GitHub Pages, object storage, files served straight off a CDN) cannot issue a per-request nonce. **The wcstack quick start is exactly that shape, so a hash is the only option if you want a CSP on such a page.** But a hash covers less than a nonce does.

| Target | `'nonce-…'` | Hash | Notes |
|---|---|---|---|
| Inline import map (§2) | Yes | Yes (`sha256` / `384` / `512`) | The digest is over the contents of the `<script>` (§3.1) |
| External `dist/auto.min.js` (`<script src integrity>`) | Yes | **Chromium only** (`sha384`) | Same value as `integrity`; wcstack ships sha384 (§3.2) |
| Inline `<script type="module">` inside `<wcs-state>` (§4) | No | No | Goes through a blob: URL, so it is never matched as an inline script |
| A `<wcs-route>` guard (§5) | No | No | Same, and there is no `src=` escape hatch either |
| State in `<script type="application/json">` (§4) | not needed | not needed | Never executed, so `script-src` does not apply |

**A hash does not rescue the two blob: paths.** §4 says "a nonce does not cover it", but the reason is not specific to nonces. A module loaded from a blob: URL is fetched as an *external* script, so it is not a candidate for inline-hash matching and there is nowhere to put an `integrity` attribute. The choice between opening `script-src blob:` and moving to `src=` is the same whether you use nonces or hashes.

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

Combining any of this with `'strict-dynamic'` is **untested**. `'strict-dynamic'` disables host-based allowlisting, so paths that rely on `import()` (component resolution in `@wcstack/autoloader`, `<wcs-state src=…>`, blob: evaluation) may break. How dynamic import should interact with CSP is [still under discussion](https://github.com/w3c/webappsec-csp/issues/506) in the spec (the `import-src` proposal). Every recipe here assumes no `'strict-dynamic'`.

## 4. Loading state into `<wcs-state>` — requirements differ per path

This is the most important point in this document. **The CSP requirement changes with the load path.**

| Spelling | Implementation | CSP needed |
|---|---|---|
| `<wcs-state state="<id>">` (referencing a `<script type="application/json">` by id) | `JSON.parse(script.textContent)` | **nothing extra** (a data block is not executed, so `script-src` does not apply) |
| `<wcs-state json='{...}'>` | `JSON.parse` on the attribute value | **nothing extra** |
| `<wcs-state src="./state.js">` | an ordinary `import(url)` | `script-src <origin>` |
| `<wcs-state src="./data.json">` | `fetch(url)` | `connect-src <origin>` |
| the `setInitialState()` API | none | **nothing extra** |
| `<wcs-state><script type="module">…</script></wcs-state>` | **`import()` through a blob: URL** | **`script-src blob:`** |

The browser never executes the contents of that inline `<script>` (it is a child of `<wcs-state>`). State pulls the text out, builds a blob: URL, and dynamically `import()`s it ([loadFromInnerScript.ts](../packages/state/src/stateLoader/loadFromInnerScript.ts)). That is what CSP catches.

**A nonce does not cover it.** A module loaded from a blob: URL does not inherit the page nonce. A hash does not cover it either (§3). It comes down to opening `script-src blob:` or moving the code into an external file.

**Under a strict CSP, prefer `src=`.** `script-src blob:` amounts to "allow dynamically generated scripts wholesale", which defeats much of the point of having a policy. Splitting the state definition out into `./state.js` needs no extra directive:

```html
<!-- CSP-safe -->
<wcs-state src="./state.js"></wcs-state>
```

One interaction to know about: if the page sets a `<base href>` — the i18n
locale-basename pattern does exactly that ([i18n-design.md §9-1-4](./i18n-design.md)) —
a *relative* `src="./state.js"` resolves against the base (`/ja/state.js`),
not against the page, and 404s. Under a `<base>`, write the URL root-absolute:
`src="/state.js"`.

## 5. Router guards require blob: (no way around it)

A `<wcs-route>` guard script is likewise evaluated through a blob: URL ([loadGuardHandler.ts](../packages/router/src/loadGuardHandler.ts)). Unlike state, though, **guards are inline-only — there is no `src=` escape hatch**. If you use guards, `script-src blob:` is mandatory.

This asymmetry is known; external-file support is not implemented. To keep a strict policy, skip guards and control access on the route-rendering side instead.

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

The two remote-data sinks keep failing — deliberately — but they now say so, once, with the fix:

```
[@wcstack/fetch] The "target" HTML replace mode was blocked by Trusted Types (require-trusted-types-for 'script'). ...
[@wcstack/state] Writing to "innerHTML" was blocked by Trusted Types (require-trusted-types-for 'script'). ...
```

The state property-write path swallows setter exceptions by design (the element is allowed to reject a value), so before this it broke *silently*. Enforcement is confirmed by probing a throwaway element rather than by matching the wording of an error, so a page that installs a `default` policy is correctly read as "not blocked".

### Notes

- **The shared policy object is reachable from page scripts.** To create `wcstack` exactly once across packages, the created policy is kept in a global slot (`Symbol.for("wcstack.trustedTypes.internal")`). Any script running on the page can therefore read it and use its `createHTML` as a Trusted Types bypass gadget. This does not weaken the DOM-XSS case Trusted Types is aimed at — reaching the slot requires script execution, which is already game over — but it is the price of the single shared policy name, and it is stated here because a policy review will ask. Giving each package its own policy name would remove the global slot at the cost of one CSP entry per package.
- Trusted Types ships in Chromium only. Elsewhere every path above is a pass-through.
- Dynamic `import()` — state's inline `<script>`, router guard handlers, the autoloader — is **not** a Trusted Types sink. It is governed by `script-src` (§4, §5, §9).
- The DCC switch to node cloning carries one behavior change: cloning a `script` element copies its already-started flag, so an inline `<script>` inside a DCC template no longer runs natively once per instance. The state definition inside `<wcs-state>` is unaffected — it evaluates `script.text` itself (§4).

## 8. What does not touch CSP (easily misread)

- **`style` bindings do not require `style-src`.** The `class`/`style` bindings assign CSSOM properties (`element.style.color = …`); they neither parse a `style` attribute nor insert a `<style>` element. CSP's `style-src` does not govern changes made through the CSSOM, so `'unsafe-inline'` is not needed.
- **`data-wcs` expressions are not evaluated.** `data-wcs` declares paths and filter names; there is no `eval` / `new Function`. The repository contains zero uses of either.

## 9. Diagnostics — how to read the errors

The rejection from a dynamic `import()` that CSP blocked says only `Failed to fetch dynamically imported module` and never mentions CSP. So state and router subscribe to `securitypolicyviolation` during evaluation and speak with certainty only when a block was actually observed.

| Output | Meaning |
|---|---|
| `... was blocked by Content-Security-Policy` | **CSP confirmed.** Add `script-src blob:` or move to `src=` |
| `Failed to evaluate the inline <script> of state "…"` | No violation was observed. Usually a syntax error in the state definition (the original error is in `cause`) |

Not asserting CSP when no violation was observed is deliberate: it keeps a syntax error from being misattributed to the policy.
