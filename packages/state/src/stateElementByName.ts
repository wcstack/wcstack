import { buildBindings } from "./buildBindings";
import { hydrateBindings } from "./hydrateBindings";
import { IStateElement } from "./components/types";
import { config, inSsr } from "./config";
import { raiseError } from "./raiseError";

const stateElementByNameByNode: WeakMap<Node, Map<string, IStateElement>> = new WeakMap();
const bindingsReadyByNode: WeakMap<Node, Promise<void>> = new WeakMap();

export function getStateElementByName(rootNode:Node, name: string): IStateElement | null {
  let stateElementByName = stateElementByNameByNode.get(rootNode);
  if (!stateElementByName) {
    return null;
  }
  return stateElementByName.get(name) || null;
}

/**
 * 指定された rootNode のバインディング初期化が完了するまで待機する Promise を返す。
 */
export function getBindingsReady(rootNode: Node): Promise<void> {
  return bindingsReadyByNode.get(rootNode) ?? Promise.resolve();
}

export function setStateElementByName(rootNode:Node, name: string, element: IStateElement | null): void {

  let stateElementByName = stateElementByNameByNode.get(rootNode);

  if (element === null) {
    // 削除の場合、Mapが存在しない場合は何もしない
    if (!stateElementByName) {
      return;
    }
    stateElementByName.delete(name);
    if (stateElementByName.size === 0) {
      stateElementByNameByNode.delete(rootNode);
    }
    if (config.debug) {
      console.debug(`State element unregistered: name="${name}"`);
    }
  } else {
    // 登録の場合
    if (!stateElementByName) {
      stateElementByName = new Map<string, IStateElement>();
      stateElementByNameByNode.set(rootNode, stateElementByName);
      // 初めてルートノードに登録する場合
      // enable-ssr 属性があり、サーバーサイドでない場合はハイドレーション
      const enableSsr = !inSsr() && (element as unknown as Element).hasAttribute?.('enable-ssr');
      if (rootNode.constructor.name === 'HTMLDocument' || rootNode.constructor.name === 'Document') {
        const ready = new Promise<void>((resolve) => {
          queueMicrotask(async () => {
            if (enableSsr) {
              const success = await hydrateBindings(rootNode as Document);
              if (!success) {
                await buildBindings(rootNode as Document);
              }
            } else {
              await buildBindings(rootNode as Document);
            }
            resolve();
          });
        });
        bindingsReadyByNode.set(rootNode, ready);
      } else if (rootNode.constructor.name === 'ShadowRoot') {
        const ready = new Promise<void>((resolve) => {
          queueMicrotask(async () => {
            await buildBindings(rootNode as ShadowRoot);
            resolve();
          });
        });
        bindingsReadyByNode.set(rootNode, ready);
      }
    }
    if (stateElementByName.has(name)) {
      raiseError(`State element with name "${name}" is already registered.`);
    }
    stateElementByName.set(name, element);
    if (config.debug) {
      console.debug(`State element registered: name="${name}"`, element);
    }
  }
}
