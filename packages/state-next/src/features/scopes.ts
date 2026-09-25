/**
 * The scopes add-on (@wcstack/state/features/scopes): `<wcs-state>` elements that are not roots.
 * Volumes (`<wcs-state mount="p">`, src/scopes/volume.ts), Declarative Custom Components
 * (`[data-wc-definition]`, src/scopes/dcc.ts) and component mounts (`<wcs-state
 * bind-component>`, src/scopes/component.ts).
 */
import { addHook, hooks, type Feature } from "../hooks";
import { raiseError } from "../parser/raiseError";
import { claimVolume, grafted, guardAncestorWrite, rootEngineCreated } from "../scopes/volume";
import { claimDcc, dccEngineCreated, dccWritten } from "../scopes/dcc";
import { claimComponent, componentScope, crossed, hasMounts, hostBinding } from "../scopes/component";

export const scopes: Feature = {
  name: "scopes",
  install(): void {
    addHook("claim", claimVolume);
    addHook("claim", claimDcc);
    addHook("claim", claimComponent);
    hooks.hostBinding = hostBinding;
    hooks.componentScope = componentScope;
    addHook("element", (engine, phase) => {
      if (phase !== "mounting") return;
      const root = (engine.element as Node).getRootNode();
      rootEngineCreated(engine, root);
      dccEngineCreated(engine, root);
    });
    addHook("written", (engine, p, row, old, value, direct) => {
      dccWritten(engine, p, value, direct);
      crossed(engine, p, row, old, value, direct, false);
    });
    addHook("getterReached", (engine, g, row) => crossed(engine, g, row, undefined, undefined, false, true));
    addHook("beforeWrite", (engine, p) => {
      guardAncestorWrite(engine, p);
      return false;
    });
    addHook("declare", (engine) => {
      const list = grafted.get(engine);
      if (list !== undefined && list.length > 0) {
        raiseError(`re-setting a root state with grafted volumes (${list.join(", ")}) is not supported: their data is part of the tree.`);
      }
      if (hasMounts(engine)) raiseError("re-setting a root state with mounted components is not supported: they read its data.");
    });
  },
};
export default scopes;
