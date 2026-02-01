import { IContent } from "../structural/types";
import { IBindingInfo } from "../types";

const bindingsByContent: WeakMap<IContent, IBindingInfo[]> = new WeakMap();

export function getBindingsByContent(content: IContent): IBindingInfo[] {
  return bindingsByContent.get(content) ?? [];
}

export function setBindingsByContent(content: IContent, bindings: IBindingInfo[]): void {
  bindingsByContent.set(content, bindings);
}
