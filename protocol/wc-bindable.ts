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
export interface IWcBindableProperty {
  readonly name: string;
  readonly event: string;
  readonly getter?: (event: Event) => any;
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
