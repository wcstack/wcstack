import { waitInitializeBinding } from "./bindings/initializeBindingPromiseByNode";
import { initializeBindings } from "./bindings/initializeBindings";
import { config } from "./config";
import { convertMustacheToComments } from "./mustache/convertMustacheToComments";
import { collectStructuralFragments } from "./structural/collectStructuralFragments";
import { waitForStateInitialize } from "./waitForStateInitialize";

export async function buildBindings(root: Document | ShadowRoot): Promise<void> {
  if (root === document) {
    // document配下のwcs-stateの初期化(connectedCallbackの完了)を待機する
    await waitForStateInitialize(document);
    // baindingを取得して、初期値をセットする
    convertMustacheToComments(document);
    collectStructuralFragments(document, document);
    initializeBindings(document.body, null);
  } else {
    const shadowRoot = root as ShadowRoot;
    if (shadowRoot.host.hasAttribute(config.bindAttributeName)) {
      // data-wcsを持つWebComponentは、WebComponentのbindingが完了するまで待機する。
      await waitInitializeBinding(shadowRoot.host);
    }
    // shadowRoot配下のwcs-stateの初期化(connectedCallbackの完了)を待機する
    await waitForStateInitialize(shadowRoot);
    // baindingを取得して、初期値をセットする
    convertMustacheToComments(shadowRoot);
    collectStructuralFragments(shadowRoot, shadowRoot);
    initializeBindings(shadowRoot, null);
  }
}
