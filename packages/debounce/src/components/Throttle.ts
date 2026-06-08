import { IWcBindable } from "../types.js";
import { Debounce } from "./Debounce.js";
import { makeDebounceProperties } from "../wcBindableFactory.js";

/**
 * `<wcs-throttle>` — the same {@link DebounceCore} engine biased to throttle:
 * `maxWait === wait` (a fire happens at least every `wait` ms under continuous
 * input) and `leading` on by default. It advertises its own `wcs-throttle:*`
 * event namespace (via `makeDebounceProperties("wcs-throttle")`), and the Core
 * dispatches under that prefix because the constructor passes it through.
 */
export class Throttle extends Debounce {
  protected static eventPrefix = "wcs-throttle";
  static wcBindable: IWcBindable = {
    ...Debounce.wcBindable,
    properties: makeDebounceProperties("wcs-throttle"),
  };

  // leading defaults on for throttle; `no-leading` opts out (symmetric with the
  // inherited `no-trailing`).
  protected _resolveLeading(): boolean {
    return !this.hasAttribute("no-leading");
  }

  // Pin maxWait to wait so throttle fires on a steady cadence; an explicit
  // `max-wait` attribute still overrides via the inherited getter.
  protected _defaultMaxWait(): number | undefined {
    return this.wait;
  }
}
