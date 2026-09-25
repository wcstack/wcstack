/**
 * The scopes add-on (@wcstack/state/features/scopes): `<wcs-state>` elements that are not roots.
 * So far: volumes (`<wcs-state mount="p">`, src/scopes/volume.ts) and Declarative Custom
 * Components (`[data-wc-definition]`, src/scopes/dcc.ts).
 */
import { addHook, type Feature } from "../hooks";
import { raiseError } from "../parser/raiseError";
import { claimVolume, grafted, guardAncestorWrite, rootEngineCreated } from "../scopes/volume";
import { claimDcc, dccEngineCreated, dccWritten } from "../scopes/dcc";

export const scopes: Feature = {
  name: "scopes",
  install(): void {
    addHook("claim", claimVolume);
    addHook("claim", claimDcc);
    addHook("element", (engine, phase) => {
      if (phase !== "mounting") return;
      const root = (engine.element as Node).getRootNode();
      rootEngineCreated(engine, root);
      dccEngineCreated(engine, root);
    });
    addHook("written", (engine, p, _row, _old, value, direct) => dccWritten(engine, p, value, direct));
    addHook("beforeWrite", (engine, p) => {
      guardAncestorWrite(engine, p);
      return false;
    });
    addHook("declare", (engine) => {
      const list = grafted.get(engine);
      if (list !== undefined && list.length > 0) {
        raiseError(`re-setting a root state with grafted volumes (${list.join(", ")}) is not supported: their data is part of the tree.`);
      }
    });
  },
};
export default scopes;
