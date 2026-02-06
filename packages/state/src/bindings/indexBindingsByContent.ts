import { IContent } from "../structural/types";
import { IBindingInfo } from "../types";

const indexBindingsByContent: WeakMap<IContent, IBindingInfo[]> = new WeakMap();

export function getIndexBindingsByContent(content: IContent): IBindingInfo[] {
  return indexBindingsByContent.get(content) ?? [];
}

export function setIndexBindingsByContent(content: IContent, bindings: IBindingInfo[]): void {
  indexBindingsByContent.set(content, bindings);
}
