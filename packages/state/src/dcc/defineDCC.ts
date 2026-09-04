import { IState } from "../types";
import { DCC_DEFINITION_ATTRIBUTE, STATE_BINDABLES_NAME } from "../define";
import { config } from "../config";
import { raiseError } from "../raiseError";
import { getterFn, setterFn, callFn, isInternalProperty } from "./dccPropertyFactories";
import { processDccDeclarations } from "./processDccDeclarations";
import { createWcBindable, createBindableEventMap, IWcBindable } from "./wcBindable";
import { getAllPropertyDescriptors } from "../getAllPropertyDescriptors";
import { getCustomElementRegistry, upgradeCustomElement } from "../platform/customElementRegistry";
// 具象 State ではなくインターフェースに依存する（dcc → components の逆参照を断つ、§3.5）。
import type { IStateElement } from "../components/types";

export function defineDCC(hostElement: Element, shadowRoot: ShadowRoot, state: IState): void {
  const tagName = hostElement.tagName.toLowerCase();

  // バリデーション
  if (!tagName.includes("-")) {
    raiseError(`DCC: "${tagName}" is not a valid custom element name (must contain a hyphen).`);
  }
  // 定義先は「定義元ホストを支配するレジストリ」。scoped registry を持つツリーで
  // global に define すると、その定義は自分の兄弟にすら適用されない。
  const definitionRegistry = getCustomElementRegistry(hostElement);
  if (definitionRegistry === null || typeof definitionRegistry.define !== "function") {
    raiseError(`DCC: CustomElementRegistry is unavailable for "${tagName}".`);
  }
  if (definitionRegistry.get(tagName)) {
    // 重複定義は authoring error として落とす。従来は warn してスキップしていたが、
    // 先勝ちで別テンプレートのインスタンスが生えるため「動いているように見えて中身が違う」
    // 状態になる。state 名の重複（stateElementByName）が raiseError なのと作法を揃える
    // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §3.4）。
    // 一意性はレジストリ単位なので、別スコープの同名 DCC は衝突しない。
    raiseError(`DCC: "${tagName}" is already registered. A custom element name can only be defined once.`);
  }

  // ShadowRoot は cloneNode 不可のため、template 経由で内容をクローン
  const template = document.createElement("template");
  template.innerHTML = shadowRoot.innerHTML;
  const shadowRootMode = shadowRoot.mode as ShadowRootMode;

  // $bindables / $commands から wcBindable + bindableEventMap を生成
  const { bindables, commands, streamBackedBindables } = processDccDeclarations(state);
  const wcBindable: IWcBindable | null = (bindables.length > 0 || commands.length > 0)
    ? createWcBindable(tagName, bindables, commands)
    : null;
  const bindableEventMap: Record<string, string> = bindables.length > 0
    ? createBindableEventMap(tagName, bindables)
    : {};

  // DCC クラス生成
  const stateTagSelector = config.tagNames.state;

  const DCCElement = class extends HTMLElement {
    static template = template;
    static shadowRootMode = shadowRootMode;
    static wcBindable = wcBindable;
    static bindableEventMap = bindableEventMap;

    private _shadow: ShadowRoot | null = null;

    /**
     * shadow を遅延構築する。定義要素（`data-wc-definition`）では null を返す。
     *
     * connectedCallback ではなくここで張るのは、**接続前にアクセサが呼ばれる**ため
     * （§1.4）。`for` の全追加パスは行を fragment に組み立ててからバインドを適用し、
     * fragment を DOM に挿すのは最後なので、`element.count = v` の時点で行はまだ未接続。
     * shadow が無いと `stateElement` が null になり、setterFn が無言で書き込みを捨てていた。
     * ここで構築しておけば、書き込みは inner `<wcs-state>` の initializePromise に
     * 積まれ、接続・state ロード後に適用される。
     *
     * 冪等なので再接続でも張り直さない。shadow tree は host の切断後も保持され、
     * 2 回目の attachShadow は NotSupportedError になる（§1.3）。`if` の false→true
     * 再マウントと `for` の行プーリングはどちらも同一ノードを unmount → mount する。
     * closed mode では `this.shadowRoot` が null なので判定はフィールド側で行う。
     *
     * G4 は「constructor へ前倒し」で決着したが、実装は constructor ではなく
     * この遅延構築を採った。目的（未接続でもアクセサが動く）は同じで、constructor 版だと
     * (1) 定義要素の判定に属性を読む必要があり constructor の作法に反する、
     * (2) 同一タグの `data-wc-definition` が 2 つある場合、DSD の shadow を既に持つ
     * 2 つ目に attachShadow して throw する、の 2 点を踏むため。
     */
    private _ensureShadow(): ShadowRoot | null {
      if (this._shadow !== null) return this._shadow;
      if (this.hasAttribute(DCC_DEFINITION_ATTRIBUTE)) return null;
      this._shadow = this.attachShadow({ mode: DCCElement.shadowRootMode });
      this._shadow.appendChild(DCCElement.template.content.cloneNode(true));
      // template.content は inert なテンプレート所有ドキュメントに属するため、その clone は
      // カスタム要素として upgrade されていない。ホストが接続済みなら appendChild の時点で
      // upgrade されるが、未接続の shadow に挿した場合は upgrade 契機が無く、内側の
      // <wcs-state> が素の HTMLElement のまま残って createState が生えない。明示的に upgrade する。
      const registry = getCustomElementRegistry(this._shadow);
      if (registry !== null) {
        upgradeCustomElement(registry, this._shadow);
      }
      return this._shadow;
    }

    connectedCallback() {
      const shadow = this._ensureShadow();
      if (shadow === null) return;

      // bindableEventMap の設定。
      // initializePromise は待たない。待つと state のロード完了まで map が空のままで、
      // $connectedCallback 内で行った初期変更が変更イベントを出さない
      // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §2.7）。
      // setBindableEventMap はフィールド代入だけで state を参照しないので、
      // <wcs-state> の初期化前に呼んでも安全。
      if (Object.keys(DCCElement.bindableEventMap).length > 0) {
        const stateEl = shadow.querySelector(stateTagSelector) as IStateElement | null;
        if (stateEl) {
          stateEl.setBindableEventMap(DCCElement.bindableEventMap);
        } else {
          // $bindables を宣言しているのに束ねる先が無い。この分岐に落ちると
          // 変更イベントが一切出ないまま静かに壊れる
          // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §2.5）。
          console.warn(`[@wcstack/state] DCC: "${tagName}" declares ${STATE_BINDABLES_NAME} but its template has no <${config.tagNames.state}>. Change events will not be dispatched.`);
        }
      }
    }

    get stateElement(): IStateElement | null {
      // 未接続でも shadow を構築して解決する（§1.4）。
      return (this._ensureShadow()?.querySelector(stateTagSelector) ?? null) as IStateElement | null;
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

  // `$streams` の値プロパティはインスタンス側の processStreamsDeclaration で実体化されるため、
  // defineDCC の時点では state 上に descriptor が無い。$bindables に載っているのに
  // アクセサが生えないと宣言だけが生きて要素側が expando を掴むので、ここで補う（§2.3）。
  for (const name of streamBackedBindables) {
    Object.defineProperty(DCCElement.prototype, name, {
      configurable: true,
      enumerable: true,
      get: getterFn(name),
      set: setterFn(name),
    });
  }

  // カスタム要素登録
  definitionRegistry.define(tagName, DCCElement);
}
