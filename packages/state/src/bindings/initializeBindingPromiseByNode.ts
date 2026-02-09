import { IInitializeBindingPromise } from "./types";

const bindingPromiseByNode = new WeakMap<Node, IInitializeBindingPromise>();

export function getInitializeBindingPromiseByNode(node: Node): IInitializeBindingPromise {
  let bindingPromise = bindingPromiseByNode.get(node) || null;
  if (bindingPromise !== null) {
    return bindingPromise;
  }
  let resolveFn = undefined;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  bindingPromise = {
    promise,
    resolve: resolveFn!
  };
  bindingPromiseByNode.set(node, bindingPromise);
  return bindingPromise;
}

export async function waitInitializeBinding(node: Node): Promise<void> {
  const bindingPromise = getInitializeBindingPromiseByNode(node);
  await bindingPromise.promise;
}

export function resolveInitializedBinding(node: Node): void {
  const bindingPromise = getInitializeBindingPromiseByNode(node);
  bindingPromise.resolve();
}
