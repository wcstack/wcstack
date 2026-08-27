#!/usr/bin/env node
/**
 * Compare the key sets of every catalog against the fallback.
 *
 *   node examples/router-i18n/check-catalogs.mjs
 *
 * This is the one translation check that has to be static. Everything else
 * surfaces at runtime: a key in no catalog at all renders empty and the console
 * says `wcs/binding-path-missing`. But a key that exists in the fallback and is
 * *missing from one locale* renders perfectly — in the fallback's language.
 * Nothing is broken, nothing is logged, and the page quietly serves English to
 * a Japanese reader. Only comparing the files finds it.
 *
 * Deliberately standalone rather than part of `wcs-validate`. That validator is
 * regex-based over inline `<wcs-state>` scripts by design — it has no module
 * resolution — and the catalog is reached through a *dynamic* import keyed by
 * the runtime locale, so which file backs `t` is not statically decidable
 * anyway. Comparing two data files needs none of that machinery.
 *
 * Copy it alongside the snippet; the only thing to change is the two constants.
 */
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const CATALOG_DIR = fileURLToPath(new URL("./i18n/", import.meta.url));
const FALLBACK = "en";

/** Files that are catalogs, not the machinery around them. */
const NOT_A_CATALOG = new Set(["catalog.js", "format.js", "state.js"]);

const PLURAL_CATEGORIES = new Set(["zero", "one", "two", "few", "many", "other"]);

/**
 * A plural group is an object whose keys are all Intl.PluralRules categories.
 *
 * These must not be compared across locales key-for-key: **which categories
 * exist is a property of the language**. English needs `one` and `other`;
 * Japanese only ever selects `other`, so writing `one` there would be dead
 * weight, not a translation. A checker that flagged it would be reporting
 * correct catalogs as broken — and a check that cries wolf gets muted, which
 * costs more than not having it.
 */
function isPluralGroup(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => PLURAL_CATEGORIES.has(key));
}

/** Flatten to dotted paths. Plural groups are emitted as the group itself. */
function walk(value, prefix, leaves, pluralGroups) {
  if (isPluralGroup(value)) {
    pluralGroups.add(prefix);
    return;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    leaves.add(prefix);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    walk(child, prefix ? `${prefix}.${key}` : key, leaves, pluralGroups);
  }
}

function analyse(catalog) {
  const leaves = new Set();
  const pluralGroups = new Set();
  walk(catalog, "", leaves, pluralGroups);
  return { leaves, pluralGroups };
}

/** The categories this language actually uses, straight from Intl. */
function categoriesFor(locale) {
  return new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
}

function at(catalog, path) {
  return path.split(".").reduce((node, key) => (node == null ? undefined : node[key]), catalog);
}

const files = (await readdir(CATALOG_DIR))
  .filter((name) => name.endsWith(".js") && !NOT_A_CATALOG.has(name));

const catalogs = new Map();
for (const file of files) {
  const module = await import(new URL(`./i18n/${file}`, import.meta.url).href);
  catalogs.set(file.replace(/\.js$/, ""), module.default);
}

const fallback = catalogs.get(FALLBACK);
if (fallback === undefined) {
  console.error(`No catalog for the fallback locale "${FALLBACK}" in ${CATALOG_DIR}`);
  process.exit(2);
}
const expected = analyse(fallback);

let problems = 0;
for (const [locale, catalog] of catalogs) {
  if (locale === FALLBACK) continue;
  const found = analyse(catalog);
  const missing = [];
  const extra = [];

  for (const path of expected.leaves) {
    if (!found.leaves.has(path)) missing.push(path);
  }
  for (const path of found.leaves) {
    if (!expected.leaves.has(path)) extra.push(path);
  }

  // Plural groups: compare against what *this* language needs, not what the
  // fallback happens to have.
  for (const group of expected.pluralGroups) {
    const needed = categoriesFor(locale);
    const present = at(catalog, group);
    if (!isPluralGroup(present)) {
      missing.push(group);
      continue;
    }
    for (const category of needed) {
      if (!(category in present)) missing.push(`${group}.${category}`);
    }
    for (const category of Object.keys(present)) {
      if (!needed.has(category)) extra.push(`${group}.${category} (unused in ${locale})`);
    }
  }

  if (missing.length > 0) {
    problems += missing.length;
    console.log(`${locale}: ${missing.length} key(s) missing — these render in ${FALLBACK}`);
    for (const key of missing.sort()) console.log(`  - ${key}`);
  }
  if (extra.length > 0) {
    console.log(`${locale}: ${extra.length} key(s) not expected (dead, or ${FALLBACK} is behind)`);
    for (const key of extra.sort()) console.log(`  + ${key}`);
  }
}

if (problems === 0) {
  console.log(`All ${catalogs.size} catalogs agree with "${FALLBACK}".`);
}
// Exit 0 either way: this demo ships one missing key on purpose
// (about.fallbackNote) to show the fallback working. A real project would
// `process.exit(problems ? 1 : 0)`.
