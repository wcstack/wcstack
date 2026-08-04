import { IState } from "../types";
import { DCC_DEFINITION_ATTRIBUTE, STATE_BINDABLES_NAME } from "../define";
import { config } from "../config";
import { raiseError } from "../raiseError";
import { getterFn, setterFn, callFn, isInternalProperty } from "./dccPropertyFactories";
import { processBindablesDeclaration } from "./processBindablesDeclaration";
import { createWcBindable, createBindableEventMap, IWcBindable } from "./wcBindable";
import { getAllPropertyDescriptors } from "../getAllPropertyDescriptors";
// 具象 State ではなくインターフェースに依存する（dcc → components の逆参照を断つ、§3.5）。
import type { IStateElement } from "../components/types";

export function defineDCC(hostElement: Element, shadowRoot: ShadowRoot, state: IState): void {
  const tagName = hostElement.tagName.toLowerCase();

  // バリデーション
  if (!tagName.includes("-")) {
    raiseError(`DCC: "${tagName}" is not a valid custom element name (must contain a hyphen).`);
  }
  if (customElements.get(tagName)) {
    // 既に登録済みならスキップ（重複定義の検知のため警告は出す）
    console.warn(`[@wcstack/state] DCC: "${tagName}" is already registered. Skipping redefinition.`);
    return;
  }

  // ShadowRoot は cloneNode 不可のため、template 経由で内容をクローン
  const template = document.createElement("template");
  template.innerHTML = shadowRoot.innerHTML;
  const shadowRootMode = shadowRoot.mode as ShadowRootMode;

  // $bindables から wcBindable + bindableEventMap を生成
  const bindables: string[] = processBindablesDeclaration(state);
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
      // 再接続では shadow を張り直さない。shadow tree は host の切断後も保持されるため
      // 2 回目の attachShadow は NotSupportedError で throw する。`if` の false→true 再マウントと
      // `for` の行プーリングはどちらも同一ノードを unmount → mount するので日常的に踏む
      // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.3）。
      // closed mode では this.shadowRoot が null なので、判定はこのフィールドで行う。
      if (this._shadow !== null) return;
      this._shadow = this.attachShadow({ mode: DCCElement.shadowRootMode });
      this._shadow.appendChild(DCCElement.template.content.cloneNode(true));

      // bindableEventMap の設定。
      // initializePromise は待たない。待つと state のロード完了まで map が空のままで、
      // $connectedCallback 内で行った初期変更が変更イベントを出さない
      // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §2.7）。
      // setBindableEventMap はフィールド代入だけで state を参照しないので、
      // <wcs-state> の初期化前に呼んでも安全。
      if (Object.keys(DCCElement.bindableEventMap).length > 0) {
        const stateEl = this._shadow.querySelector(stateTagSelector) as IStateElement | null;
        if (stateEl) {
          stateEl.setBindableEventMap(DCCElement.bindableEventMap);
        } else {
          // $bindables を宣言しているのに束ねる先が無い。stateTagSelector は
          // `:not([name])` なので name 付きの <wcs-state> は一致せず、この分岐に落ちると
          // 変更イベントが一切出ないまま静かに壊れる
          // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §2.5）。
          console.warn(`[@wcstack/state] DCC: "${tagName}" declares ${STATE_BINDABLES_NAME} but its template has no <${config.tagNames.state}> without a "name" attribute. Change events will not be dispatched.`);
        }
      }
    }

    get stateElement(): IStateElement | null {
      return (this._shadow?.querySelector(stateTagSelector) ?? null) as IStateElement | null;
    }
  };

  // state プロパティを走査して DCC クラスのプロトタイプにgetter/setter/methodを定義。
  // 走査範囲は State の getterPaths / setterPaths 収集と同じ「自身＋プロトタイプチェーン」に
  // 揃える。own descriptor だけを見ていた頃は、クラスインスタンスや Object.create(proto) の
  // state で「getterPaths には載るのにアクセサが生えない」乖離が出ていた
  // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §2.4）。
  const descriptors = getAllPropertyDescriptors(state);
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
