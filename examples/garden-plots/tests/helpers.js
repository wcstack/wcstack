// Loads the small state object of a designers' part (the inline <script type="module"> in parts/<name>.html) as a
// module, so its getters can be checked on their own — the same code the browser runs.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Not new URL(…, import.meta.url): Vite rewrites that into an asset URL (the @wcstack/testing README warns of it).
export const ROOT = process.cwd();
export function partFile(name) {
  return readFileSync(resolve(ROOT, "public/parts", name), "utf8");
}

export async function partState(name) {
  const html = partFile(`${name}.html`);
  const m = html.match(/<wcs-state>\s*<script type="module">([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`no inline state in ${name}.html`);
  const mod = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(m[1])}`);
  return mod.default;
}

/**
 * The definition's getters read against plain values, as the state proxy would for getters that read only through
 * `this` (other getters of the definition are evaluated against the same object).
 */
export function stateOf(def, values) {
  const target = { ...values };
  const proxy = new Proxy(target, {
    get(t, key) {
      if (Object.prototype.hasOwnProperty.call(t, key)) return t[key];
      const d = Object.getOwnPropertyDescriptor(def, key);
      if (d?.get) return d.get.call(proxy);
      const v = def[key];
      return typeof v === "function" ? v.bind(proxy) : v;
    },
  });
  return proxy;
}
