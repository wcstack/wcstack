/**
 * dcc/dccLifecycle.ts — DCC 定義要素（`[data-wc-definition]` ホストの ShadowRoot 内の `<wcs-state>`）の
 * 接続（設計案 H3、S4）。この `<wcs-state>` は自分のツリーを持たない: ソースを読み、ホストの
 * テンプレートからカスタム要素を定義して（defineDCC）初期化を終える。
 *
 * 従来 `State.connectedCallback` の先頭の分岐と private メソッド `_initializeDCC` だったもの。
 * 聞く順は order 10 — ボリューム（20）・bind-component（30）より先という従来の分岐順を番号で固定する。
 * 要素から要るのは内部面の 5 つ（`failInitializeLoudly` / `markTreeless` / `markInitialized` /
 * `clearConnectedRootNode` / `settleInitialization`）だけ。
 */
import type { IStateElement } from "../components/types";
import { ILifecycleHooks, registerLifecycleHooks } from "../core/lifecycleHooks";
import { DCC_DEFINITION_ATTRIBUTE } from "../define";
import { raiseError } from "../raiseError";
import { loadFromInnerScript } from "../stateLoader/loadFromInnerScript";
import { loadFromScriptFile } from "../stateLoader/loadFromScriptFile";
import { IState } from "../types";
import { defineDCC } from "./defineDCC";

async function loadDccState(el: HTMLElement, hostElement: Element): Promise<IState> {
  try {
    if (el.hasAttribute('src')) {
      const src = el.getAttribute('src')!;
      if (src.endsWith('.js')) {
        return await loadFromScriptFile(src);
      }
      raiseError(`DCC: Unsupported src type: ${src}`);
    }
    const script = el.querySelector<HTMLScriptElement>('script[type="module"]');
    if (script) {
      return await loadFromInnerScript(script, hostElement.tagName.toLowerCase());
    }
    raiseError(`DCC: No state source found for "${hostElement.tagName.toLowerCase()}".`);
  } catch (e) {
    raiseError(`DCC: Failed to load state: ${e}`);
  }
}

async function initializeDcc(element: IStateElement, hostElement: Element, shadowRoot: ShadowRoot): Promise<void> {
  const el = element as unknown as HTMLElement;
  try {
    // DCC と bind-component は排他。DCC の state はテンプレートに属し、
    // インスタンスごとにロードされるので、定義時点のホストのプロパティを
    // ソースにする bind-component とは両立しない。従来はこの return で
    // 無言に無視していた（docs/architecture-hardening/15 §3.1）。
    if (el.hasAttribute("bind-component")) {
      raiseError(`"bind-component" cannot be used inside a [${DCC_DEFINITION_ATTRIBUTE}] host. DCC state comes from the template, not from a component property.`);
    }
    const state = await loadDccState(el, hostElement);
    defineDCC(hostElement, shadowRoot, state);
    // 自分のツリーを持たない: 再接続でこの rootNode のツリーとして登録し直さない
    element.markTreeless!();
    element.markInitialized!();
    element.clearConnectedRootNode!(); // disconnectedCallbackでのstate参照を防止
    element.settleInitialization!();
  } catch (error) {
    // _initialize と同じ着地（#257）。DCC のロード失敗もここまでは
    // 「throw が connectedCallback の外へ出るだけ」＝ 無言のハングだった
    element.failInitializeLoudly!(error);
  }
}

export const dccLifecycleHooks: ILifecycleHooks = {
  order: 10,
  connecting(element) {
    // DCC 検出: ShadowRoot 内かつホストに data-wc-definition がある場合
    const parentNode = (element as unknown as HTMLElement).parentNode;
    if (!(parentNode instanceof ShadowRoot) || !parentNode.host.hasAttribute(DCC_DEFINITION_ATTRIBUTE)) {
      return null;
    }
    return initializeDcc(element, parentNode.host, parentNode);
  },
};

let installed = false;
/** 冪等。full / auto では `bootstrapState()` が呼ぶ */
export function installDccLifecycle(): void {
  if (installed) return;
  installed = true;
  registerLifecycleHooks("dcc", dccLifecycleHooks);
}
