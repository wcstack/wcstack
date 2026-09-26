/**
 * The SSR add-on (@wcstack/state/features/ssr): `<wcs-state enable-ssr>` with @wcstack/server —
 * see src/ssr/ssr.ts.
 */
import { addHook, hooks, type Feature } from "../hooks";
import { hydrate, hydrated, installBuilder, ssrMark } from "../ssr/ssr";
import { defineSsr } from "../ssr/element";
import { registries } from "../element";

export const ssr: Feature = {
  name: "ssr",
  install(): void {
    hooks.ssrMark = ssrMark;
    addHook("element", (engine, phase) => {
      if (phase === "mounting") hydrate(engine);
      else if (phase === "connected") hydrated(engine);
    });
    installBuilder();
    // `<wcs-ssr>` in every registry `<wcs-state>` is defined in, now and later
    addHook("tags", defineSsr);
    for (const r of registries()) defineSsr(r);
  },
};
export default ssr;
