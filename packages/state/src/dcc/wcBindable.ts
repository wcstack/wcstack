// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "../protocol/wcBindable.js";
// This module also uses the types in its runtime helpers below, so import them into scope.
import type {
  IWcBindable, IWcBindableCommand, IWcBindableInput, IWcBindableProperty,
} from "../protocol/wcBindable.js";

export function createWcBindable(
  tagName: string,
  bindables: string[],
  commands: string[] = [],
): IWcBindable {
  const properties: IWcBindableProperty[] = bindables.map((propName) => ({
    name: propName,
    event: `${tagName}:${propName}-changed`,
    // Read the member off the element instead of trusting event.detail. The event is a
    // notification, not a carrier: a sub-path write (`user.name = "x"` against a `user`
    // member) has no single value to put in detail, and a state-side setter may normalize
    // what was written. Both cases are correct through the property.
    getter: (event: Event) => (event.target as unknown as Record<string, unknown>)[propName],
  }));
  // Every $bindables member gets both a getter and a setter on the DCC prototype,
  // so declare it in inputs as well — a property declared only in `properties` is
  // output-only under directional initial sync, which would permanently block
  // parent-state → DCC writes.
  const inputs: IWcBindableInput[] = bindables.map((propName) => ({
    name: propName,
  }));
  const declaration: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties,
    inputs,
  };
  if (commands.length === 0) {
    return declaration;
  }
  // `async: true` is uniform on purpose: dccPropertyFactories.callFn always chains on the
  // inner <wcs-state>'s initializePromise, so a DCC command returns a Promise whether or not
  // the underlying state method was declared `async`. Reporting the state method's own
  // asyncness would describe something callers never observe.
  const declaredCommands: IWcBindableCommand[] = commands.map((name) => ({
    name,
    async: true,
  }));
  return { ...declaration, commands: declaredCommands };
}

export function createBindableEventMap(tagName: string, bindables: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const propName of bindables) {
    map[propName] = `${tagName}:${propName}-changed`;
  }
  return map;
}
