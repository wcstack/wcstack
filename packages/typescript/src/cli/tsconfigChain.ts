/**
 * tsconfigChain.ts — what TypeScript 7 does not tell `wcs-tsc` about a tsconfig.
 *
 * Under TypeScript 7 there is no JavaScript API to parse a config, and
 * `tsc --showConfig` prints the resolved `compilerOptions` / `include` / `files`
 * but not `contentMappers`. A config's own `contentMappers` replaces the inherited
 * array (an empty one removes them), so the effective list is the one of the nearest
 * config in the `extends` chain that declares it — the config itself first, then its
 * bases from the last to the first, each with its own chain.
 *
 * Reading is best effort: a base that cannot be found or parsed declares nothing
 * (tsc reports it on the real run).
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** One `contentMappers` entry as written (`package`, `extensions`, `options`, …). */
export type ContentMapperEntry = Readonly<Record<string, unknown>>;

/** JSON with comments and trailing commas, as tsconfig files are written. */
export function parseJsonc(text: string): unknown {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return JSON.parse(withoutTrailingCommas(withoutComments(source)));
}

/** The end of the string literal that starts at `start` (just past its closing quote). */
function stringEnd(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
  return i + 1;
}

function withoutComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; ) {
    if (text[i] === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (text.startsWith("//", i)) {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += text[i++];
    }
  }
  return out;
}

function withoutTrailingCommas(text: string): string {
  const closes = /\s*[}\]]/y;
  let out = "";
  for (let i = 0; i < text.length; ) {
    closes.lastIndex = i + 1;
    if (text[i] === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (text[i] === "," && closes.test(text)) {
      i++;
    } else {
      out += text[i++];
    }
  }
  return out;
}

/** Where `extends: specifier` written in `fromConfig` points, or `undefined`. */
export function resolveExtends(specifier: string, fromConfig: string): string | undefined {
  const dir = dirname(fromConfig);
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    const path = resolve(dir, specifier);
    if (existsSync(path)) return path;
    return existsSync(`${path}.json`) ? `${path}.json` : undefined;
  }
  const require = createRequire(join(dir, "__wcs_tsc_extends__.js"));
  for (const candidate of [specifier, `${specifier}.json`, `${specifier}/tsconfig.json`]) {
    try {
      return require.resolve(candidate);
    } catch {
      /* try the next form */
    }
  }
  return undefined;
}

/** The `contentMappers` `configPath` ends up with, and the config that declares them. */
export function effectiveContentMappers(configPath: string, seen: Set<string> = new Set()): { entries: readonly ContentMapperEntry[]; from: string } | undefined {
  if (seen.has(configPath)) return undefined;
  seen.add(configPath);
  let config: Record<string, unknown>;
  try {
    config = parseJsonc(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (Array.isArray(config.contentMappers)) {
    return { entries: config.contentMappers.filter((e): e is ContentMapperEntry => typeof e === "object" && e !== null), from: configPath };
  }
  const bases = typeof config.extends === "string" ? [config.extends] : Array.isArray(config.extends) ? config.extends : [];
  for (const base of [...bases].reverse()) {
    if (typeof base !== "string") continue;
    const path = resolveExtends(base, configPath);
    const found = path === undefined ? undefined : effectiveContentMappers(path, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}
