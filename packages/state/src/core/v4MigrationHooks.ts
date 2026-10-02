/**
 * core/v4MigrationHooks.ts — the receptacle for the 4.0 migration notices (`[wcs/v4-migration]`), a
 * surface of the last 3.x minor only (docs/state-3x-naming.ja.md D39).
 *
 * The core calls it only where an old name is resolved: a state object entering the runtime (the
 * declaration-key normalization, declarationAliases.ts), a volume's state loading (State.ts
 * `loadStateFromSource`) and grafting (webComponent/volume.ts), the proxy's alias branches
 * (proxy/traps/get.ts), a filter alias resolving in the registry (core/filterRegistry.ts), and the
 * factory of a built-in filter that 4.0 removes (`substr`, formats/builtinFilters.ts). The alias sites
 * run only when the old form is written; the others run once per state object or volume, so no
 * ordinary read or write gains a check.
 *
 * The wording and the warn-once ledger live in the full entries (`bootstrapState.ts` → `v4Migration.ts`).
 * The split `@wcstack/state/core` does not carry them; with nothing placed here, nothing is printed.
 */
export interface IV4MigrationNotices {
  /** A state object entered the runtime (once per object, before its old declaration keys are rewritten). */
  state(state: object): void;
  /**
   * A volume's state object was loaded, before `state()` sees it: what 4.0 refuses in a volume is reported
   * by `volume()` instead of the root-state checks.
   */
  volumeLoaded(state: object): void;
  /** An old name from 3.2 resolved to its canonical name (state API, filter). */
  renamed(oldName: string, canonical: string): void;
  /** A built-in that 4.0 removes was used (`substr`). */
  removed(name: string): void;
  /**
   * A volume (`<wcs-state mount>`) is being grafted, its declaration keys already normalized: what 4.0
   * refuses to graft — the declaration keys it does not run in a volume, and injections.
   */
  volume(mountPath: string, state: object, injections: number): void;
}

/** null when nothing is placed: no notices. */
export let v4Migration: IV4MigrationNotices | null = null;

/** Called by the full entries' `bootstrapState()` (idempotent: it replaces). */
export function setV4Migration(notices: IV4MigrationNotices | null): void {
  v4Migration = notices;
}
