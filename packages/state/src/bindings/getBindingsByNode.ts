import { IBindingInfo } from "../binding/types";

const bindingsByNode = new WeakMap<Node, IBindingInfo[]>();

export function getBindingsByNode(node: Node): IBindingInfo[] | null {
  return bindingsByNode.get(node) || null;
}

export function setBindingsByNode(node: Node, bindings: IBindingInfo[]): void {
  bindingsByNode.set(node, bindings);
}

export function addBindingByNode(node: Node, binding: IBindingInfo): void {
  const bindings = getBindingsByNode(node);
  if (bindings === null) {
    setBindingsByNode(node, [binding]);
  } else {
    bindings.push(binding);
  }
}