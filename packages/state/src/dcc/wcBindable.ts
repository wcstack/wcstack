// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "../protocol/wcBindable.js";
// This module also uses the types in its runtime helpers below, so import them into scope.
import type { IWcBindable, IWcBindableInput, IWcBindableProperty } from "../protocol/wcBindable.js";

export function createWcBindable(tagName: string, bindables: string[]): IWcBindable {
  const properties: IWcBindableProperty[] = bindables.map((propName) => ({
    name: propName,
    event: `${tagName}:${propName}-changed`,
  }));
  // Every $bindables member gets both a getter and a setter on the DCC prototype,
  // so declare it in inputs as well — a property declared only in `properties` is
  // output-only under directional initial sync, which would permanently block
  // parent-state → DCC writes.
  const inputs: IWcBindableInput[] = bindables.map((propName) => ({
    name: propName,
  }));
  return {
    protocol: "wc-bindable",
    version: 1,
    properties,
    inputs,
  };
}

export function createBindableEventMap(tagName: string, bindables: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const propName of bindables) {
    map[propName] = `${tagName}:${propName}-changed`;
  }
  return map;
}
