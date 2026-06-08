import { IWcBindableProperty } from "./types.js";

/**
 * Build the wc-bindable `properties` list for a debounce/throttle element, with
 * every event name derived from a single `prefix`. `<wcs-debounce>` uses
 * `"wcs-debounce"`, `<wcs-throttle>` uses `"wcs-throttle"`, so the two tags share
 * one engine (DebounceCore) yet advertise distinct event namespaces from one
 * source of truth — no hand-duplicated property tables (cf. the geolocation Shell
 * which overrode its wcBindable by hand).
 *
 * - `value`   — the debounced value of the latest `source` write (value surface),
 *               read from the `<prefix>:settled` event.
 * - `fired`   — the coalesced args of the latest `trigger()` pulse (signal
 *               surface), read from the `<prefix>:fired` event. Declared as a
 *               property (not just an event) so state can subscribe via the
 *               event-token protocol (`eventToken.fired: <name>`).
 * - `pending` — whether a debounce is currently in flight.
 */
export function makeDebounceProperties(prefix: string): IWcBindableProperty[] {
  return [
    { name: "value", event: `${prefix}:settled`, getter: (e: Event) => (e as CustomEvent).detail.value },
    { name: "fired", event: `${prefix}:fired`, getter: (e: Event) => (e as CustomEvent).detail.args },
    { name: "pending", event: `${prefix}:pending-changed` },
  ];
}
