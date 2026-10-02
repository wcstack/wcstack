/**
 * The scopes add-on (@wcstack/state/features/scopes): `<wcs-state>` elements that are not roots.
 * Volumes (`<wcs-state mount="p">`, src/scopes/volume.ts), Declarative Custom Components
 * (`[data-wc-definition]`, src/scopes/dcc.ts) and component mounts (`<wcs-state
 * bind-component>`, src/scopes/component.ts).
 */
import { chain, first, handled, hooks, taken, type Feature } from "../hooks";
import { raiseError } from "../parser/raiseError";
import { claimVolume, grafted, guardAncestorWrite, rootEngineCreated } from "../scopes/volume";
import { claimDcc, dccEngineCreated, dccWritten } from "../scopes/dcc";
import { claimComponent, componentScope, crossed, guardReadonlyMount, hasMounts, hostBinding } from "../scopes/component";

export const scopes: Feature = {
  name: "scopes",
  install(): void {
    hooks.claim = first(taken, hooks.claim, claimVolume);
    hooks.claim = first(taken, hooks.claim, claimDcc);
    // last: what it does not take is a root, which it watches for the volumes (watchRoot)
    hooks.claim = first(taken, hooks.claim, claimComponent);
    hooks.hostBinding = hostBinding;
    hooks.componentScope = componentScope;
    hooks.element = chain(hooks.element, (engine, phase) => {
      if (phase !== "mounting") return;
      const root = (engine.element as Node).getRootNode();
      rootEngineCreated(engine, root);
      dccEngineCreated(engine, root);
    });
    hooks.written = chain(hooks.written, (engine, p, row, old, value, direct) => {
      dccWritten(engine, p, value, direct);
      crossed(engine, p, row, old, value, direct, false);
    });
    hooks.getterReached = chain(hooks.getterReached, (engine, g, row) => crossed(engine, g, row, undefined, undefined, false, true));
    hooks.beforeWrite = first(handled, hooks.beforeWrite, (engine, p, _row, _value, element) => {
      guardAncestorWrite(engine, p);
      return guardReadonlyMount(engine, p, element);
    });
    hooks.declare = chain(hooks.declare, (engine) => {
      const list = grafted.get(engine);
      if (list !== undefined && list.length > 0) {
        raiseError(`re-setting a root state with grafted volumes (${list.join(", ")}) is not supported: their data is part of the tree.`);
      }
      if (hasMounts(engine)) raiseError("re-setting a root state with mounted components is not supported: they read its data.");
    });
  },
};
export default scopes;
