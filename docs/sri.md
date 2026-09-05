# wcstack and Subresource Integrity (SRI operations guide)

- **Audience**: anyone loading wcstack from a CDN who wants tampering in the delivery path to be detectable, plus implementers changing the layout of what gets published
- **Status**: normative. That `dist/auto.min.js` has no static imports is a precondition for SRI working at all here, and MUST NOT be broken
- **Why this exists**: normally, reading an ESM bundle from a CDN means `<script type="module" integrity>` **protects only the entry point**. Whatever it `import`s is a separate fetch, outside the reach of that integrity check. wcstack's `dist/auto.min.js` is a self-contained bundle with zero external imports, so **a single integrity attribute covers every line of wcstack that runs**. That property only holds because "zero dependencies + bundled + one tag" all hold at once, and it is easy to break
- **See also**: [csp.md](./csp.md) (combining this with a CSP)
- **日本語版**: [sri.ja.md](./sri.ja.md)

---

## 1. Usage

```html
<script type="module"
        src="https://cdn.jsdelivr.net/npm/@wcstack/state@1.26.0/dist/auto.min.js"
        integrity="sha384-…"></script>
```

- **`crossorigin` is not needed.** `type="module"` is always fetched in CORS mode, so unlike a classic script it does not need `crossorigin="anonymous"`.
- **Always pin the version.** A digest is over the bytes of one specific version; on an unpinned URL it is guaranteed to stop matching at the next release.

## 2. Where the digests come from — never ask the CDN

The **body of each GitHub Release** carries a table for every package. A machine-readable `sri.json` is attached to the same release.

```json
{
  "version": "1.26.0",
  "algorithm": "sha384",
  "file": "dist/auto.min.js",
  "packages": {
    "@wcstack/state": {
      "integrity": "sha384-…",
      "url": "https://cdn.jsdelivr.net/npm/@wcstack/state@1.26.0/dist/auto.min.js"
    }
  }
}
```

jsDelivr's data API will also return a hash for a file, but **do not use it**. The point of SRI is to not have to trust the CDN, and a CDN self-reporting the hash of the file it serves is circular. The digests are computed from the tree being published ([scripts/generate-sri.mjs](../scripts/generate-sri.mjs)) and distributed from GitHub, independently of the CDN.

You can also check them yourself. The repository at the matching tag and the npm tarball are byte-equivalent, so:

```bash
# from your local artifact
openssl dgst -sha384 -binary packages/state/dist/auto.min.js | openssl base64 -A

# from what the CDN returned (a match means the path was not tampered with)
curl -sL https://cdn.jsdelivr.net/npm/@wcstack/state@1.26.0/dist/auto.min.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

**The same digests double as CSP `script-src` hash sources.** CSP3 has a path that admits an external script whose `integrity` digest matches a hash source in `script-src`, so nothing needs computing separately for CSP. The catch is that only Chromium implements the matching; Firefox and Safari block on it. Details and constraints: [csp.md §3.2](./csp.md#32-hashing-the-external-bundle--the-value-is-the-sri-digest).

## 3. SRI cannot work through `esm.run`

```
https://esm.run/@wcstack/state/auto
  → 301 → https://cdn.jsdelivr.net/npm/@wcstack/state/auto/+esm
```

`+esm` is an endpoint where jsDelivr **re-bundles with Rollup / esbuild**, and the file it returns has the builder version baked into its header. Those are not the published bytes, so no fixed digest can match them in principle — and the content changes again whenever the builder is updated.

To make SRI work, use a **version-pinned, direct path** on `cdn.jsdelivr.net`. Note that jsDelivr's bare paths do not resolve `package.json` `exports`, so you have to name `dist/auto.min.js` rather than `/auto` (`/npm/@wcstack/state/auto` is a 404).

A secondary benefit: a direct path costs only one host in the CSP `script-src` (going through `esm.run` needs two, since the redirect target is matched as well). See [csp.md §1](./csp.md#1-delivery-origin--esmrun-requires-two-hosts).

### 3.1 …and neither can jsDelivr `/combine/`

`/combine/` MUST NOT be used to deliver wcstack — it fails harder than `esm.run`: the response is not merely unverifiable, it does not parse.

The endpoint concatenates the listed files with a bare `;` separator and no scope wrapping. Minifiers rename top-level bindings on the assumption that the module scope is theirs alone, so two minified ESM bundles collide as soon as they share one file: combining any two wcstack `dist/auto.min.js` files yields `SyntaxError: Identifier 't' has already been declared` (measured 2026-08-29 against the published 1.30.0 bundles of `@wcstack/state` + `@wcstack/router`; a local concatenation of the same files reproduces the identical error). This is structural, not a bug a future release could fix.

Even for a combination that happened to parse, SRI is ruled out by jsDelivr itself: the combined response opens with a banner comment — "Do NOT use SRI with dynamically generated files!" — and the official guidance is "Only use SRI with full single-file links, and static versions"; regenerated output is not guaranteed byte-identical. The endpoint is also all-or-nothing operationally: one 404 among the parts fails the whole URL, and that 404 is edge-cached for a day.

To load several packages, use one version-pinned single-file tag per package. Each `dist/auto.min.js` is self-contained, so the tags fetch in parallel — there is no import waterfall to collapse — and each keeps its own full-coverage digest:

```html
<script type="module"
        src="https://cdn.jsdelivr.net/npm/@wcstack/state@1.26.0/dist/auto.min.js"
        integrity="sha384-…"></script>
<script type="module"
        src="https://cdn.jsdelivr.net/npm/@wcstack/router@1.26.0/dist/auto.min.js"
        integrity="sha384-…"></script>
```

For the single-request form, use the **`wcstack` entry bundle** instead: one Rollup-built (identifier-safe — Rollup renames what concatenation collides) tag covering the SPA-core packages (state / router / fetch / storage / autoloader), with one full-coverage digest, listed in `sri.json` like every other package. Loading it alongside an individual package's `/auto` is safe: every member define is guarded and the protocol installs are first-wins, so whichever copy evaluates first owns the page.

```html
<script type="module"
        src="https://cdn.jsdelivr.net/npm/wcstack@2.1.0/dist/auto.min.js"
        integrity="sha384-…"></script>
```

## 4. Coverage — what is protected and what is not

| Target | Protected by integrity? |
|---|---|
| the whole wcstack runtime (the contents of `dist/auto.min.js`) | **yes** (self-contained bundle, zero static imports) |
| named imports out of `dist/index.esm.js` | no (an `import` inside a module is outside the enclosing script's integrity — see §5) |
| the state definition for `<wcs-state>` (inline `<script>` or `src="./state.js"`) | no (page-side code, dynamically imported at runtime) |
| a `<wcs-route>` guard script | no (same) |
| components resolved by `@wcstack/autoloader` | no (same) |

The bottom three are **a design boundary, not a defect**. That is code the page supplies; it is not part of what wcstack publishes. To protect it, make each piece a resource of its own and bring it under SRI / CSP yourself.

The boundary is machine-checkable. A single static import inside `dist/auto.min.js` invalidates the premise above, so verify it whenever you change the layout:

```bash
node -e "const s=require('fs').readFileSync('packages/state/dist/auto.min.js','utf8');
  console.log([...s.matchAll(/(?:^|[;\n])import\s*[{*\"']/g)].length === 0 ? 'self-contained' : 'HAS STATIC IMPORTS')"
```

## 5. To protect named imports, use import map integrity

The named-import style (`import { bootstrapState } from '…'`) against `dist/index.esm.js` cannot be protected by a `<script>` integrity attribute, because an `import` inside a module is a separate request. The mechanism for that is the `integrity` key of an import map, **shipped in Chrome 127 and Safari 18; Firefox does not support it**.

```html
<script type="importmap" nonce="{RANDOM}">
{
  "imports": {
    "@wcstack/state": "https://cdn.jsdelivr.net/npm/@wcstack/state@1.26.0/dist/index.esm.js"
  },
  "integrity": {
    "https://cdn.jsdelivr.net/npm/@wcstack/state@1.26.0/dist/index.esm.js": "sha384-…"
  }
}
</script>
```

If you want protection in every browser, the single-tag `dist/auto.min.js` form rather than named imports is the surest route.

## 6. For implementers — invariants not to break

1. `src/auto.ts` imports from `./exports` only. It MUST NOT relatively import a sibling dist file. Doing so turns `auto.min.js` back into a stub and drops integrity coverage to nearly zero. **"integrity is present but protects nothing" is worse than no integrity at all**
2. `dist/auto.min.js` is a real Rollup entry, not a hand-written stub that gets copied ([config-templates/rollup.config.js](../config-templates/rollup.config.js))
3. Digests are computed from the tree being published. They MUST NOT be taken from a CDN response
4. New packages are picked up automatically by [scripts/generate-sri.mjs](../scripts/generate-sri.mjs). Packages with no `dist/auto.min.js` are listed explicitly under `withoutBootstrap`, so none of them can drop out silently
