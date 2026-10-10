import { IWcBindable } from "../types.js";
import { Debounce } from "./Debounce.js";
import { makeDebounceProperties } from "../wcBindableFactory.js";
import { reflectBooleanAttribute } from "../protocol/inputAttribute.js";

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
  // inherited `no-trailing`). Both accessors are overridden: the inherited ones
  // read and write `leading`, which a throttle does not read, so `leading = false`
  // through the property (a binding) did nothing and the getter answered false
  // while leading was on. `null` removes `no-leading` (on, the default) and
  // `undefined` restores the attribute the element started with.
  get leading(): boolean {
    return !this.hasAttribute("no-leading");
  }

  set leading(value: boolean | null | undefined) {
    reflectBooleanAttribute(this, "no-leading", value == null ? value : !value);
  }

  // Pin maxWait to wait so throttle fires on a steady cadence; an explicit
  // `max-wait` attribute still overrides via the inherited getter.
  protected _defaultMaxWait(): number | undefined {
    return this.wait;
  }
}
