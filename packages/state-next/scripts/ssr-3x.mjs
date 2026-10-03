// Records __tests__/golden/ssr-3x-353.json (or the file the first argument names, relative to this
// package): pages rendered by @wcstack/server 3.x with @wcstack/state 3.x, from their checked-in dists
// (packages/server/dist, packages/state/dist), for the test of a 4.0 client on 3.x output
// (__tests__/ssr-3x.test.ts). Neither package needs its own node_modules: the server's imports resolve
// here (happy-dom from this package's devDependencies, @wcstack/state to the 3.x dist). The output
// depends only on the dists (the pages render in order: the private keys' numbers `#mN` run across them).
//
// __tests__/golden/ssr-3x.json holds the pages up to `filters` as the 3.5.0 dists rendered them, before
// 3.5.3 (wcstack#373) made a text mark carry the binding's whole expression, filters included (a Light
// DOM child's in its own vocabulary). It is frozen, the record of the output up to 3.5.2: the checked-in
// dists no longer produce it, so this script does not write it.
import { register } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const here = new URL("../", import.meta.url);
const packages = new URL("../../", import.meta.url);
const state = new URL("state/dist/index.esm.js", packages).href;
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === "@wcstack/state") return { url: ${JSON.stringify(state)}, shortCircuit: true };
  if (specifier === "happy-dom") return next(specifier, { ...context, parentURL: ${JSON.stringify(new URL("package.json", here).href)} });
  return next(specifier, context);
}`));
const { renderToString } = await import(new URL("server/dist/index.esm.js", packages).href);
const version = (p) => JSON.parse(readFileSync(new URL(`${p}/package.json`, packages), "utf8")).version;

/** The custom elements the pages use (tag → the host's `state`), defined on the server as in the test. */
const components = {
  "x-light": { mine: "own" },
  "x-part": { other: "o", box: { k: "v" } },
  "x-inner": {},
  // private keys named like their own mount path
  "y-own": { box: "mine" },
  "y-own-x": { box: { x: "own-x" } },
  "y-deep": { profile: "deep-own" },
  // (the 3.5.3+ pages')
  "x-kid": {},
  "x-num": {},
};
const bootstraps = [async () => {
  for (const [tag, state] of Object.entries(components)) {
    customElements.define(tag, class extends HTMLElement { state = structuredClone(state); });
  }
  (await import("@wcstack/state")).bootstrapState();
}];

const pages = {
  // page-level {{ }}, a comment binding and data-wcs; a for: with relative paths; an if: / else: chain
  basic: `<!DOCTYPE html><html><head></head><body>
<wcs-state enable-ssr json='{"title":"Hello","count":3,"show":true,"items":[{"name":"Apple","n":1},{"name":"Banana","n":2}]}'></wcs-state>
<h1>{{ title }}</h1>
<p class="count" data-wcs="textContent: count"></p>
<ul>
  <template data-wcs="for: items">
    <li><span data-wcs="textContent: .name"></span> {{ .n }}</li>
  </template>
</ul>
<template data-wcs="if: show"><div class="shown">shown {{ count }}</div></template>
<template data-wcs="else:"><div class="hidden">hidden</div></template>
<p class="comment"><!--@@: title--></p>
<input data-wcs="value: title">
</body></html>`,
  // a for: in a for: (a relative inner list), an if: in a for:
  nested: `<!DOCTYPE html><html><head></head><body>
<wcs-state enable-ssr json='{"groups":[{"label":"A","items":[{"v":1},{"v":0}]},{"label":"B","items":[{"v":3}]}]}'></wcs-state>
<template data-wcs="for: groups">
  <section><h2>{{ .label }}</h2>
    <template data-wcs="for: .items"><p data-wcs="textContent: .v"></p><template data-wcs="if: .v"><i>{{ .v }}</i></template></template>
  </section>
</template>
</body></html>`,
  // if / elseif / elseif / else: 3.x renders an elseif as an if inside an else of its own
  chain: `<!DOCTYPE html><html><head></head><body>
<wcs-state enable-ssr json='{"n":2}'></wcs-state>
<template data-wcs="if: n|eq(1)"><b class="one">one</b></template>
<template data-wcs="elseif: n|eq(2)"><b class="two">two {{ n }}</b></template>
<template data-wcs="elseif: n|eq(3)"><b class="three">three</b></template>
<template data-wcs="else:"><b class="other">other</b></template>
</body></html>`,
  // the server ran $connectedCallback (an inline script): its data is in the snapshot
  connected: `<!DOCTYPE html><html><head></head><body>
<wcs-state enable-ssr>
  <script type="module">
    export default {
      items: [],
      $connectedCallback() { this.items = ["server"]; },
    };
  </script>
</wcs-state>
<ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>
</body></html>`,
  // a volume (its data is in 3.x's snapshot too), a for: inside a (Light DOM) custom element
  volume: `<!DOCTYPE html><html><head></head><body>
<wcs-state enable-ssr json='{"title":"T","items":[{"n":1},{"n":2}]}'></wcs-state>
<wcs-state mount="cart" json='{"count":2,"lines":["a","b"]}'></wcs-state>
<p class="t">{{ title }} / {{ cart.count }}</p>
<ul><template data-wcs="for: cart.lines"><li class="line">{{ . }}</li></template></ul>
<my-box><template data-wcs="for: items"><b class="n">{{ .n }}</b></template></my-box>
</body></html>`,
  // Light DOM components wired from the page: 3.x writes their paths as the page's — a whole mount
  // (`user.name`; a private key `user.#m1.mine`; an inner for:, if:), a partial one beside it
  // (`state.where: user.profile`) and alone (`state.label: user.name`; a private key `#m2.other`), a
  // component in a component (`user.profile.city`; over a private key, `#m2.box.k`; with a private key
  // named like its mount path, `user.profile.#m3.profile`, `#m2.box.#m4.box`), a host binding that is
  // not the mount (`attr.title`)
  light: `<!DOCTYPE html><html><head></head><body>
<wcs-state enable-ssr json='{"title":"T","user":{"name":"Ann","age":3,"on":true,"tags":["a","b"],"profile":{"city":"X"}},"theme":{"mode":"dark"}}'></wcs-state>
<x-light data-wcs="state: user; state.theme: theme; state.where: user.profile; attr.title: title"><wcs-state bind-component="state"></wcs-state>
  <p class="name">{{ name }}</p><p class="age">{{ age|add(1) }}</p><p class="mine">{{ mine }}</p><p class="mode">{{ theme.mode }}</p><p class="where">{{ where.city }}</p>
  <p class="bound" data-wcs="textContent: name"></p>
  <ul><template data-wcs="for: tags"><li>{{ . }}</li></template></ul>
  <template data-wcs="if: on|not"><i class="off">off</i></template><template data-wcs="else:"><i class="on">{{ name }}</i></template>
  <x-inner data-wcs="state: profile"><wcs-state bind-component="state"></wcs-state><em>{{ city }}</em></x-inner>
  <y-deep data-wcs="state: profile"><wcs-state bind-component="state"></wcs-state><em class="deep">{{ profile }}</em><em class="deep-city">{{ city }}</em></y-deep>
</x-light>
<x-part data-wcs="state.label: user.name"><wcs-state bind-component="state"></wcs-state><p class="label">{{ label }}</p><p class="other">{{ other }}</p>
  <x-inner data-wcs="state: box"><wcs-state bind-component="state"></wcs-state><em class="box">{{ k }}</em></x-inner>
  <y-own data-wcs="state: box"><wcs-state bind-component="state"></wcs-state><em class="own">{{ box }}</em><em class="own-k">{{ k }}</em></y-own>
  <y-own-x data-wcs="state: box"><wcs-state bind-component="state"></wcs-state><em class="own-x">{{ box.x }}</em></y-own-x>
</x-part>
</body></html>`,
  // a page-level text binding with filters: 3.x's mark keeps only the path
  filters: `<!DOCTYPE html><html><head></head><body>
<wcs-state enable-ssr json='{"price":3.14159,"items":[1.5]}'></wcs-state>
<p class="price">{{ price|toFixed(2) }}</p>
<ul><template data-wcs="for: items"><li>{{ .|toFixed(2) }}</li></template></ul>
</body></html>`,
  // 3.5.3+: a Light DOM child wired with the names swapped (`state.x: v; state.v: w`): its marks are in
  // its own vocabulary, where `v` is the page's `w`
  swap: `<!DOCTYPE html><html><head></head><body>
<wcs-state enable-ssr json='{"v":"host-v","w":"host-w"}'></wcs-state>
<p class="page">{{ v }} / {{ w }}</p>
<x-kid data-wcs="state.x: v; state.v: w"><wcs-state bind-component="state"></wcs-state><p class="kid">{{ v }} / {{ x }}</p></x-kid>
</body></html>`,
  // 3.5.3+: a filter chain, a string argument (in a comment binding too), filters in Light DOM children
  // (a partial mount; a whole one, on a private key too)
  exprs: `<!DOCTYPE html><html><head></head><body>
<wcs-state enable-ssr json='{"price":3.14159,"name":"Ann","user":{"name":"Bo","age":3}}'></wcs-state>
<p class="chain">{{ price|mul(10)|round|unit(' pt') }}</p>
<p class="str"><!--@@: name|padStart(6,'*') --></p>
<x-num data-wcs="state.p: price"><wcs-state bind-component="state"></wcs-state><p class="p">{{ p|toFixed(2) }}</p></x-num>
<x-light data-wcs="state: user"><wcs-state bind-component="state"></wcs-state><p class="age">{{ age|add(1)|unit(' y') }}</p><p class="mine">{{ mine|upper }}</p></x-light>
</body></html>`,
  // 3.5.3+: an expression a comment cannot hold (`--`): the mark falls back to the path, in a Light DOM
  // child the page's — here a private key's (`#mN.…`)
  fallback: `<!DOCTYPE html><html><head></head><body>
<wcs-state enable-ssr json='{"title":"T","user":{"name":"Ann"}}'></wcs-state>
<p class="page">{{ title|unit('--') }}</p>
<x-part data-wcs="state.label: user.name"><wcs-state bind-component="state"></wcs-state><p class="own">{{ other|unit('--') }}</p><p class="kept">{{ label|unit('!') }}</p></x-part>
<x-light data-wcs="state: user"><wcs-state bind-component="state"></wcs-state><p class="own">{{ mine|unit('--') }}</p><p class="kept">{{ name|unit('!') }}</p></x-light>
</body></html>`,
  // 3.5.3+: the same, of a wired path: the mark is the page's path, not the child's
  "fallback-wired": `<!DOCTYPE html><html><head></head><body>
<wcs-state enable-ssr json='{"user":{"name":"Ann"}}'></wcs-state>
<x-part data-wcs="state.label: user.name"><wcs-state bind-component="state"></wcs-state><p class="wired">{{ label|unit('--') }}</p></x-part>
<x-light data-wcs="state: user"><wcs-state bind-component="state"></wcs-state><p class="wired">{{ name|unit('--') }}</p></x-light>
</body></html>`,
};

const target = process.argv[2] ?? "__tests__/golden/ssr-3x-353.json";
if (/(^|[\\/])ssr-3x\.json$/.test(target)) throw new Error(`${target} is frozen (the 3.5.0 output): see the top of this script`);
const out = {};
for (const [name, html] of Object.entries(pages)) out[name] = { page: html, output: await renderToString(html, { bootstraps }) };
const file = new URL(target, here);
writeFileSync(file, JSON.stringify({
  engine: `@wcstack/server ${version("server")} + @wcstack/state ${version("state")} (their checked-in dists)`,
  components,
  pages: out,
}, null, 2) + "\n");
console.log(`${target}: ${Object.keys(out).length} pages`);
