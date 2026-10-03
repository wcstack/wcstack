/**
 * The SSR add-on (@wcstack/state/features/ssr): `<wcs-state enable-ssr>` with @wcstack/server —
 * see src/ssr/ssr.ts.
 */
import { chain, hooks, type Feature } from "../hooks";
import { adoptScope, hydrate, installBuilder, ssrMark } from "../ssr/ssr";
import { defineSsr } from "../ssr/element";
import { registries } from "../element";

export const ssr: Feature = {
  name: "ssr",
  install(): void {
    hooks.ssrMark = ssrMark;
    hooks.adoptScope = adoptScope;
    // the snapshot first, before what is installed (in any order) runs at "mounting": a volume
    // grafting there adopts it, and its $connectedCallback writes over it (3.x D14)
    const prev = hooks.element;
    hooks.element = (engine, phase) => {
      if (phase === "mounting") hydrate(engine);
      prev?.(engine, phase);
    };
    installBuilder();
    // `<wcs-ssr>` in every registry `<wcs-state>` is defined in, now and later
    hooks.tags = chain(hooks.tags, defineSsr);
    for (const r of registries()) defineSsr(r);
  },
};
export default ssr;
