import { IBindingInfo } from "../binding/types";

const bindingsByNode = new WeakMap<Node, IBindingInfo[]>();

export function getBindingsByNode(node: Node): IBindingInfo[] | null {
  return bindingsByNode.get(node) || null;
}

export function setBindingsByNode(node: Node, bindings: IBindingInfo[]): void {
  bindingsByNode.set(node, bindings);
}