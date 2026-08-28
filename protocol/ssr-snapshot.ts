// ssr-snapshot protocol — how the SSR renderer asks whoever owns reactive
// state to build hydration snapshots (<wcs-ssr>) as a final pass, after every
// DOM inserter (router route content, late custom elements) has settled.
//
// Without this, the snapshot is built inside <wcs-state>'s connectedCallback
// and races DOM inserted by other packages: whether a route's structural
// templates make it into the snapshot depends on document order and state's
// load mechanism (docs/ssr-router-design.md §5).
//
// The provider (@wcstack/state) installs itself on a well-known global symbol
// at bootstrap. The renderer (@wcstack/server) looks the builder up after
// running bootstraps: if present it announces orchestration by setting
// `data-wcs-server="orchestrated"` on the document element BEFORE parsing, and
// calls build() right before serialization. The provider keeps its inline
// per-element fallback whenever the attribute value is anything else, so:
//   - old renderer + new provider  -> inline build, yesterday's behavior
//   - new renderer + old provider  -> no builder found, attribute stays "",
//     the old provider builds inline as before
//   - new renderer + new provider  -> orchestrated: snapshots are built last
//     and therefore always see settled DOM
//
// The symbol (rather than a package import) also pins the builder to the state
// copy that actually runs on the page — its module-scoped fragment registries
// are the ones the snapshot must read.
//
// SINGLE SOURCE OF TRUTH: edit only this file (/protocol/ssr-snapshot.ts), then
// run `node scripts/sync-protocol-types.mjs` to regenerate the per-package
// copies (packages/<pkg>/src/protocol/ssrSnapshot.ts). Those copies are
// generated — do not edit them.

/**
 * Global key the snapshot builder installs itself under. `Symbol.for` so
 * independently loaded copies of this file (state's and server's) still agree.
 */
export const SSR_SNAPSHOT_BUILDER_KEY = Symbol.for("wcstack.ssr.snapshotBuilder");

/**
 * `data-wcs-server` attribute value announcing that the renderer will call the
 * builder as a final pass. Providers must skip their inline per-element build
 * when they see this value, and keep it for any other value (including "").
 */
export const SSR_ORCHESTRATED_VALUE = "orchestrated";

export interface IWcsSsrSnapshotBuilder {
  readonly protocol: "wcs-ssr-snapshot";
  /** Integer protocol version. All versions >= 1 are participant-compatible. */
  readonly version: number;
  /**
   * Build a hydration snapshot for every enable-ssr state element in `root`
   * that does not already have one. Called once per render, after all
   * waiting-protocol elements have settled and bindings are ready. Must be
   * idempotent with respect to already-snapshotted elements.
   */
  build(root: Document): void;
}

/**
 * The installed builder, or null when there is none or it speaks a shape this
 * reader does not.
 */
export function getSsrSnapshotBuilder(): IWcsSsrSnapshotBuilder | null {
  const candidate = (globalThis as Record<symbol, unknown>)[
    SSR_SNAPSHOT_BUILDER_KEY
  ] as IWcsSsrSnapshotBuilder | undefined;
  if (candidate === undefined || candidate === null) return null;
  if (candidate.protocol !== "wcs-ssr-snapshot") return null;
  if (typeof candidate.version !== "number" || candidate.version < 1) return null;
  if (typeof candidate.build !== "function") return null;
  return candidate;
}
