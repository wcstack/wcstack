import { IState } from "../types";
import { DCC_DEFINITION_ATTRIBUTE, STATE_BINDABLES_NAME } from "../define";
import { config } from "../config";
import { raiseError } from "../raiseError";
import { getterFn, setterFn, callFn, isInternalProperty } from "./dccPropertyFactories";
import { createWcBindable, createBindableEventMap, IWcBindable } from "./wcBindable";
import { State } from "../components/State";

export function defineDCC(hostElement: Element, shadowRoot: ShadowRoot, state: IState): void {
  const tagName = hostElement.tagName.toLowerCase();

  // バリデーション
  if (!tagName.includes("-")) {
    raiseError(`DCC: "${tagName}" is not a valid custom element name (must contain a hyphen).`);
  }
  if (customElements.get(tagName)) {
    // 既に登録済みならスキップ
    return;
  }

  // ShadowRoot は cloneNode 不可のため、template 経由で内容をクローン
  const template = document.createElement("template");
  template.innerHTML = shadowRoot.innerHTML;
  const shadowRootMode = shadowRoot.mode as ShadowRootMode;

  // $bindables から wcBindable + bindableEventMap を生成
  const bindables: string[] = Array.isArray(state[STATE_BINDABLES_NAME])
    ? state[STATE_BINDABLES_NAME]
    : [];
  const wcBindable: IWcBindable | null = bindables.length > 0
    ? createWcBindable(tagName, bindables)
    : null;
  const bindableEventMap: Record<string, string> = bindables.length > 0
    ? createBindableEventMap(tagName, bindables)
    : {};

  // DCC クラス生成
  const stateTagSelector = `${config.tagNames.state}:not([name])` as const;

  const DCCElement = class extends HTMLElement {
    static template = template;
    static shadowRootMode = shadowRootMode;
    static wcBindable = wcBindable;
    static bindableEventMap = bindableEventMap;

    private _shadow: ShadowRoot | null = null;

    connectedCallback() {
      if (this.hasAttribute(DCC_DEFINITION_ATTRIBUTE)) return;
      this._shadow = this.attachShadow({ mode: DCCElement.shadowRootMode });
      this._shadow.appendChild(DCCElement.template.content.cloneNode(true));

      // bindableEventMap の設定
      if (Object.keys(DCCElement.bindableEventMap).length > 0) {
        const stateEl = this._shadow.querySelector(stateTagSelector) as State | null;
        if (stateEl) {
          stateEl.initializePromise.then(() => {
            stateEl.setBindableEventMap(DCCElement.bindableEventMap);
          });
        }
      }
    }

    get stateElement() {
      return this._shadow?.querySelector(stateTagSelector) as State | null;
    }
  };

  // state プロパティを走査して DCC クラスのプロトタイプにgetter/setter/methodを定義
  const descriptors = Object.getOwnPropertyDescriptors(state);
  for (const [name, desc] of Object.entries(descriptors)) {
    if (isInternalProperty(name)) continue;

    const newDesc: PropertyDescriptor = { configurable: true, enumerable: true };
    if (typeof desc.value === "function") {
      const isAsync = desc.value.constructor?.name === "AsyncFunction";
      newDesc.value = callFn(name, isAsync);
    } else {
      newDesc.get = getterFn(name);
      newDesc.set = setterFn(name);
    }
    Object.defineProperty(DCCElement.prototype, name, newDesc);
  }

  // カスタム要素登録
  customElements.define(tagName, DCCElement);
}
