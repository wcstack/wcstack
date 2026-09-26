/**
 * The SSR add-on (@wcstack/state/features/ssr): `<wcs-state enable-ssr>` with @wcstack/server —
 * see src/ssr/ssr.ts.
 */
import { addHook, hooks, type Feature } from "../hooks";
import { hydrate, hydrated, installBuilder, ssrMark } from "../ssr/ssr";

export const ssr: Feature = {
  name: "ssr",
  install(): void {
    hooks.ssrMark = ssrMark;
    addHook("element", (engine, phase) => {
      if (phase === "mounting") hydrate(engine);
      else if (phase === "connected") hydrated(engine);
    });
    installBuilder();
  },
};
export default ssr;
