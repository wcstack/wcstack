/**
 * The split build's add-on loader. `base` is the URL of the entry that calls it (the
 * `import.meta.url` of `dist/split/auto.js`), so this module may land in a shared chunk: the
 * add-ons are `./features/<name>.js` beside the entry, never beside the chunk. Loads only the
 * known names: an attribute or a fetched state cannot make the page import anything else.
 */
import type { Feature } from "./hooks";

/** The add-on names (`$features`, the root `<wcs-state features>`): the tooling manifest publishes them as `features`. */
export const FEATURE_NAMES: readonly string[] = ["formats", "diagnostics", "temporal", "list-keys", "scopes", "recursion", "ssr", "devtools", "native-commands"];

export function loader(base: string): (names: string[]) => Promise<Feature[]> {
  return (names) => Promise.all(names.map(async (name) => {
    if (!FEATURE_NAMES.includes(name)) throw new Error(`[@wcstack/state] [wcs/feature-unknown] "${name}" is not an add-on (${FEATURE_NAMES.join(", ")}).`);
    // `base`, not `import.meta.url` here: a bundler (Vite, Vitest) rewrites a `new URL(…, import.meta.url)` it sees
    return ((await import(/* @vite-ignore */ new URL(`./features/${name}.js`, base).href)) as { default: Feature }).default;
  }));
}
