import { IInitializeBindingPromise } from "./types";

const bindingPromiseByNode = new WeakMap<Node, IInitializeBindingPromise>();
// resolve 済みマーク。エントリ未生成のまま resolve されたノードは、後から
// wait された時に「生成して即 resolve」で追いつく。
const resolvedNodes = new WeakSet<Node>();

let id = 0;

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
    id: ++id,
    promise,
    resolve: resolveFn!
  };
  bindingPromiseByNode.set(node, bindingPromise);
  if (resolvedNodes.has(node)) {
    bindingPromise.resolve();
  }
  return bindingPromise;
}

export async function waitInitializeBinding(node: Node): Promise<void> {
  const bindingPromise = getInitializeBindingPromiseByNode(node);
  await bindingPromise.promise;
}

export function resolveInitializedBinding(node: Node): void {
  // ホットパス: リスト行では全 subscriber ノードがここを通るが、await する消費者
  // （boundComponent / shadowRoot host）はほぼ居ない。既存エントリが無ければ
  // Promise+closure を生成せず resolve 済みマークだけ残す（15 万個級の割り当て削減）。
  const existing = bindingPromiseByNode.get(node);
  if (typeof existing !== "undefined") {
    existing.resolve();
    return;
  }
  resolvedNodes.add(node);
}
