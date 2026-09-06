// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/wc-bindable.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================

// wc-bindable protocol — the manifest contract a custom element exposes as `static wcBindable`,
// letting a binding core (e.g. @wcstack/state) discover and wire it generically.
//
//   properties: observable outputs — the element dispatches `event` on change; observers subscribe.
//   inputs:     settable surface — declarative metadata; optional `attribute` hints the mirrored HTML attribute.
//   commands:   invocable methods — declarative metadata; binding cores call the method by name.
//
// Cores interpret `properties`; `inputs` / `commands` and the `attribute` / `async` hints are
// descriptive metadata (tooling, codegen, remote proxying).
//
// SINGLE SOURCE OF TRUTH: edit only this file (/protocol/wc-bindable.ts), then run
// `node scripts/sync-protocol-types.mjs` to regenerate the per-package copies
// (packages/<pkg>/src/protocol/wcBindable.ts). Those copies are generated — do not edit them.
/**
 * Observation semantics of a `properties` entry.
 *
 *   "state"  — current value. A snapshot may cache it, and equality-based dedupe is safe.
 *   "event"  — occurrence. Repeated identical payloads are distinct occurrences; never dedupe.
 *   "handle" — live / opaque resource with its own lifecycle (e.g. MediaStream). Not
 *              snapshot-safe and not necessarily serializable; consumers need an explicit
 *              ref / callback surface rather than a value slot.
 */
export type WcBindableSemantics = "state" | "event" | "handle";

export interface IWcBindableProperty {
  readonly name: string;
  readonly event: string;
  readonly getter?: (event: Event) => any;
  /**
   * Optional, additive, forward-compatible. An absent value means **unspecified**, NOT
   * "state": a reader that finds no `semantics` MUST keep the behavior it had before this
   * field existed (deliver the update as-is; do not start deduping, caching or serializing
   * on assumption). Only an explicit value licenses a reader to change its handling.
   */
  readonly semantics?: WcBindableSemantics;
}

export interface IWcBindableInput {
  readonly name: string;
  readonly attribute?: string;
}

export interface IWcBindableCommand {
  readonly name: string;
  readonly async?: boolean;
}

export interface IWcBindable {
  readonly protocol: "wc-bindable";
  /** Integer protocol version. All versions >= 1 are core-compatible. */
  readonly version: number;
  readonly properties: readonly IWcBindableProperty[];
  readonly inputs?: readonly IWcBindableInput[];
  readonly commands?: readonly IWcBindableCommand[];
}
