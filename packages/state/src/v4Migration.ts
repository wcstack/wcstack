/**
 * v4Migration.ts — notices for what 4.0 removes or moves (`[wcs/v4-migration]`, docs/state-3x-naming.ja.md D39).
 *
 * The names 3.2 renamed keep working as aliases through 3.x and are removed in 4.0. Lint has suggested the
 * canonical names since 3.2; runtime warnings were promised for the last 3.x minor only, the way 2.6 ran
 * `wcs/v3-migration`. This is that surface. It changes nothing about how 3.x runs. Each message says
 * briefly what 4.0 does and what to write; the full list is the README section "Preparing for 4.0"
 * (as in 2.6, since every word here ships in the runtime bundle). Each message is printed once per page.
 *
 * Covered:
 *  - the 3.2 old names: state API (`$trackDependency` / `$untrackDependency`), declaration keys
 *    (`$updatedCallback` / `$streams`) and filters (`inc` / `uc` / `fix` …)
 *  - what 4.0 removes: `$scan`, the `substr` filter
 *  - `bootstrapState` options 4.0 throws on: the removed `debug` / `commentTextPrefix` /
 *    `enablePropagationContext`, the `enableMustache` / `sameValueGuard` / `enableDirectionalInitialSync`
 *    that move to the state's `$behavior`, unknown keys and values of the wrong type
 *  - the 4.0 declaration keys `$behavior` / `$features`, which 3.x does not read: only a value that
 *    differs from how 3.x runs the state, and the shapes 4.0 throws on
 *  - volumes 4.0 refuses to graft: one that declares `$watch`, `$listKeys`, `$renderedCallback`,
 *    `$behavior` or `$features`, and one that injects root paths (`data-wcs="state.<key>: …"`)
 *
 * **Only the full entries import this file** (`bootstrapState.ts`). The core calls the receptacle
 * (core/v4MigrationHooks.ts) where it resolves an old name, so the split `@wcstack/state/core` does not
 * carry this file. The checks copy the 4.0 rules (state-next `config.ts` and `engine.ts` `loadTarget`).
 */
import { config } from "./config";
import { IV4MigrationNotices, setV4Migration } from "./core/v4MigrationHooks";
import { DECLARATION_ALIASES } from "./declarationAliases";
import { STATE_SCAN_NAME } from "./define";

const warned = new Set<string>();
/**
 * The old names already warned. An alias can be read on every getter evaluation, so `renamed` leaves by
 * the name before it builds the message: after the first warning an alias read costs one `Set` lookup.
 */
const renamedWarned = new Set<string>();

/** Warns once per message; each message names its subject, so once per name. */
export function warnV4Migration(message: string): void {
  if (warned.has(message)) {
    return;
  }
  warned.add(message);
  console.warn(`[@wcstack/state] [wcs/v4-migration] ${message} See "Preparing for 4.0" in the @wcstack/state README.`);
}

/** For tests: forget what was already warned. */
export function clearV4MigrationWarningsForTesting(): void {
  warned.clear();
  renamedWarned.clear();
}

/** `bootstrapState` options 4.0 removes. */
const REMOVED_OPTIONS: readonly string[] = ["debug", "commentTextPrefix", "enablePropagationContext"];
/** `bootstrapState` options 4.0 moves to the state's `$behavior` (each a boolean, true by default). */
const BEHAVIOR_OPTIONS: readonly string[] = ["enableMustache", "sameValueGuard", "enableDirectionalInitialSync"];
/** The options 4.0's `bootstrapState` takes → the type of the default (4.0 throws on another type, null, an array). */
const OPTION_TYPES: Readonly<Record<string, string>> = {
  bindAttributeName: "string",
  commentForPrefix: "string",
  commentIfPrefix: "string",
  commentElseIfPrefix: "string",
  commentElsePrefix: "string",
  tagNames: "object",
  locale: "string",
  enableContractAnalyzer: "boolean",
};
const TAG_NAMES: readonly string[] = ["state", "ssr"];
/** The add-on names 4.0's `$features` takes (state-next load.ts `FEATURE_NAMES`). */
const FEATURE_NAMES: readonly string[] = ["formats", "diagnostics", "temporal", "list-keys", "scopes", "recursion", "ssr", "devtools"];

const hasOwn = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);
const invalid = (where: string, key: string, kind: string): void =>
  warnV4Migration(`${where}: "${key}" is not one of its options, or not ${kind}. 4.0 throws on it.`);

/**
 * Reads `bootstrapState(options)` by the 4.0 rules: an undefined value is skipped; an unknown key, a value
 * of another type or a tag name it does not define throws (state-next config.ts `setConfig`).
 */
export function checkBootstrapOptionsForV4(options: object | undefined): void {
  if (typeof options !== "object" || options === null) {
    return;
  }
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === "undefined") {
      continue;
    }
    if (REMOVED_OPTIONS.includes(key)) {
      warnV4Migration(`bootstrapState option "${key}" is removed in 4.0, which throws on it. Remove it.`);
    } else if (BEHAVIOR_OPTIONS.includes(key) && typeof value === "boolean") {
      warnV4Migration(
        `bootstrapState option "${key}" moves to the state's $behavior in 4.0, which throws on it here. ` +
        `When you upgrade, write $behavior: { ${key}: ${value} } in the state.`,
      );
    } else if (BEHAVIOR_OPTIONS.includes(key) || !hasOwn(OPTION_TYPES, key) || value === null
      || typeof value !== OPTION_TYPES[key] || Array.isArray(value)) {
      // A moved option given a non-boolean lands here too: 4.0's `$behavior` would reject that value
      // as well, so the message neither embeds it nor suggests writing it
      invalid("bootstrapState", key, "of the option's type");
    } else if (key === "tagNames") {
      for (const [name, tag] of Object.entries(value as object)) {
        if (typeof tag !== "undefined" && (!TAG_NAMES.includes(name) || typeof tag !== "string")) {
          invalid("bootstrapState", `tagNames.${name}`, "of the option's type");
        }
      }
    }
  }
}

/**
 * 4.0's `$behavior` (state-next engine.ts `loadTarget`). 3.x does not read it, so this names a value
 * 3.x runs the state against (the `bootstrapState` setting differs), and the shapes 4.0 throws on.
 */
function checkBehavior(behavior: unknown): void {
  if (typeof behavior === "undefined" || behavior === null) {
    return;
  }
  if (typeof behavior !== "object") {
    invalid("state", "$behavior", "an object");
    return;
  }
  const options = behavior as Record<string, unknown>;
  for (const key in options) {
    const value = options[key];
    if (!BEHAVIOR_OPTIONS.includes(key) || typeof value !== "boolean") {
      invalid("$behavior", key, "a boolean");
    } else if (value !== (config as unknown as Record<string, unknown>)[key]) {
      warnV4Migration(
        `$behavior takes effect in 4.0; 3.x does not read it and runs this state with ${key}: ${!value}. ` +
        `Until you upgrade, pass bootstrapState({ ${key}: ${value} }).`,
      );
    }
  }
}

/** 4.0's `$features` (an array of add-on names). The full 3.x entries install every feature, so only the shapes 4.0 throws on. */
function checkFeatures(features: unknown): void {
  if (typeof features === "undefined") {
    return;
  }
  if (!Array.isArray(features) || features.some((name) => !FEATURE_NAMES.includes(name))) {
    warnV4Migration(`$features is not an array of add-on names (${FEATURE_NAMES.join(", ")}). 4.0 throws on it.`);
  }
}

function renamed(oldName: string, canonical: string): void {
  if (renamedWarned.has(oldName)) {
    return;
  }
  renamedWarned.add(oldName);
  // An old name without a leading `$` is a filter (`uc` → `upper`)
  const label = oldName[0] === "$" ? "" : "filter ";
  warnV4Migration(`${label}"${oldName}" is removed in 4.0: write "${canonical}" (its name since 3.2).`);
}

const REMOVED: Readonly<Record<string, string>> = {
  substr: `filter "substr" is removed in 4.0: write slice(start, start + length) — slice takes the end index, not a length.`,
};

/**
 * Declaration keys that 3.x runs in a volume (relative to the mount path) or ignores there, and on which
 * 4.0 refuses the whole graft with a `console.error` (state-next scopes/volume.ts `REJECTED`) → what to
 * write instead. `$updatedCallback` is not listed: the volume's keys are normalized before the graft, so
 * it arrives as `$renderedCallback` (and its own rename notice names the old spelling). `$stream`,
 * `$scan` and `$recursion` are left out too: 3.x already rejects them in a volume with an error.
 */
const VOLUME_REJECTED: Readonly<Record<string, string>> = {
  $watch: "Move it to the root state, where its paths are absolute.",
  $listKeys: "Move it to the root state, where its paths are absolute.",
  $renderedCallback: "Move it to the root state, where it receives absolute paths.",
  $behavior: "Declare it on the root state.",
  $features: "Declare it on the root state.",
};

/** State objects loaded by a volume: their `$behavior` / `$features` are reported by `volume()` alone. */
const volumeStates = new WeakSet<object>();

const notices: IV4MigrationNotices = {
  state(state: object): void {
    // 4.0 throws on these only when the value is not undefined (state-next engine.ts `loadTarget`)
    const declared = state as Record<string, unknown>;
    for (const alias of Object.keys(DECLARATION_ALIASES)) {
      if (typeof declared[alias] !== "undefined") {
        renamed(alias, DECLARATION_ALIASES[alias]);
      }
    }
    if (typeof declared[STATE_SCAN_NAME] !== "undefined") {
      warnV4Migration(`"${STATE_SCAN_NAME}" is removed in 4.0: rewrite it with $watch (state paths) or $on (event tokens).`);
    }
    // A volume may not declare either key in 4.0: advice for a root state would contradict that
    if (!volumeStates.has(state)) {
      checkBehavior(declared.$behavior);
      checkFeatures(declared.$features);
    }
  },
  volumeLoaded(state: object): void {
    volumeStates.add(state);
  },
  renamed,
  removed(name: string): void {
    warnV4Migration(REMOVED[name]);
  },
  volume(mountPath: string, state: object, injections: number): void {
    // 4.0 refuses the graft when a volume element has a data-wcs at all (state-next scopes/volume.ts
    // `claimVolume`); in 3.x that attribute carries the injections, so they are what is named here
    if (injections > 0) {
      warnV4Migration(
        `volume "${mountPath}" injects root paths (data-wcs="state.<key>: …"): 4.0 does not graft a volume with injections. ` +
        `Read the root path in a root getter instead.`,
      );
    }
    for (const key of Object.keys(VOLUME_REJECTED)) {
      if (typeof (state as Record<string, unknown>)[key] !== "undefined") {
        warnV4Migration(`volume "${mountPath}" declares ${key}: 4.0 does not graft a volume that declares it. ${VOLUME_REJECTED[key]}`);
      }
    }
  },
};

/** Called by the full entries' `bootstrapState()` (idempotent): places the notices, then reads the options. */
export function installV4Migration(options?: object): void {
  setV4Migration(notices);
  checkBootstrapOptionsForV4(options);
}
