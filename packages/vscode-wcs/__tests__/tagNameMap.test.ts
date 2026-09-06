/**
 * Drift check between the built-in tag catalog (generated from each package's
 * dist/auto.min.js — the runtime's `customElements.define` calls) and the
 * `HTMLElementTagNameMap` augmentation each package declares in its src/exports.ts
 * (docs/typescript.md §3, plan D4).
 *
 * Both directions are enforced:
 *  - every catalogued tag must be declared (a new I/O tag without a typed lookup);
 *  - every declared tag must be catalogued, except the tags of packages the catalog
 *    does not scan (state / router / devtools — they carry their own per-package test
 *    that compares the declaration with `config.tagNames`).
 *
 * This job (wcs-validate) always runs, so a Shell change that forgets the map is
 * caught even when the package's own matrix job does not run.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { BUILTIN_TAGS } from "../src/service/generated/builtinTags.generated.js";

const PACKAGES_DIR = resolve(__dirname, "..", "..");

/** Tags declared by packages outside the catalog's scan (no dist/auto.min.js I/O node). */
const OUTSIDE_CATALOG = new Set([
  // @wcstack/state
  "wcs-state", "wcs-ssr",
  // @wcstack/router (wcs-guard-handler is a config name without an element class)
  "wcs-router", "wcs-route", "wcs-outlet", "wcs-layout", "wcs-layout-outlet", "wcs-link", "wcs-head",
  // @wcstack/devtools
  "wcs-devtools",
]);

function declaredTagsByPackage(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const dir of readdirSync(PACKAGES_DIR)) {
    const file = join(PACKAGES_DIR, dir, "src", "exports.ts");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const block = /interface HTMLElementTagNameMap \{([\s\S]*?)\n\s*\}/.exec(text);
    if (block === null) continue;
    const tags = [...block[1].matchAll(/"(wcs-[a-z0-9-]+)"\s*:/g)].map((m) => m[1]);
    out.set(dir, tags);
  }
  return out;
}

describe("HTMLElementTagNameMap ⇄ builtin tag catalog", () => {
  const declared = declaredTagsByPackage();
  const declaredTags = new Set([...declared.values()].flat());
  const catalogued = new Set(Object.keys(BUILTIN_TAGS));

  it("カタログの全タグが、いずれかのパッケージの HTMLElementTagNameMap に宣言されている", () => {
    const missing = [...catalogued].filter((tag) => !declaredTags.has(tag)).sort();
    expect(missing).toEqual([]);
  });

  it("宣言されたタグは全てカタログに載っている（state / router / devtools のタグは除外）", () => {
    const unknown = [...declaredTags].filter((tag) => !catalogued.has(tag) && !OUTSIDE_CATALOG.has(tag)).sort();
    expect(unknown).toEqual([]);
  });

  it("同じタグを 2 つのパッケージが宣言していない", () => {
    const owners = new Map<string, string[]>();
    for (const [pkg, tags] of declared) {
      for (const tag of tags) owners.set(tag, [...(owners.get(tag) ?? []), pkg]);
    }
    const duplicated = [...owners].filter(([, pkgs]) => pkgs.length > 1);
    expect(duplicated).toEqual([]);
  });

  it("宣言は要素を持つ全パッケージ（I/O ノード 38 + state + router + devtools = 41）に存在する", () => {
    expect(declared.size).toBeGreaterThanOrEqual(41);
    expect(declared.has("state")).toBe(true);
    expect(declared.has("router")).toBe(true);
    expect(declared.has("fetch")).toBe(true);
  });
});
