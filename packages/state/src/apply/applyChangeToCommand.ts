/**
 * command.<methodName>: <commandToken-path> バインディングの適用ハンドラ。
 *
 * subscribe lifecycle:
 *   - 同一 binding に同じ token が再評価された場合は no-op。
 *   - 異なる token が来た場合は古い subscription を解除し、新しい token に subscribe し直す。
 *     旧解除は新しい binding 妥当性検証（methodName・wcBindable.commands チェック）を
 *     通過した後に行うため、再評価が validation で失敗しても旧購読は温存される（fail-fast）。
 *   - element は WeakRef で保持し、subscriber 経由で element を強参照しないようにする。
 *     これにより、element が DOM から消えた後に subscriber が token._subscribers に
 *     残っていても element 本体は GC 可能。
 *   - emit 時に下記いずれかなら自動で subscription を破棄する（lazy purge）:
 *     - WeakRef.deref() が undefined（element が既に GC 済み）
 *     - element.isConnected が false（DOM から取り外されている）
 *
 * 既知の制約:
 *   - emit が来なければ stale subscriber は token に残り続ける（要素が GC されても subscriber 関数自体は残る）。
 *     state インスタンスが disconnect されたタイミングで registry ごとクリアされるため、最終的には解放される。
 *     element ライフサイクルに直接フックする手段が現状の binding 機構に無いため、能動的な purge は将来課題。
 */

import { isCommandToken } from "../command/CommandToken";
import { ICommandToken } from "../command/types";
import { IWcBindable } from "../event/types";
import { getCustomElement } from "../getCustomElement";
import { raiseError } from "../raiseError";
import { IBindingInfo } from "../types";
import { IApplyContext } from "./types";

interface ICommandSubscription {
  readonly token: ICommandToken;
  readonly unsubscribe: () => void;
  readonly elementRef: WeakRef<Element>;
}

const subscribedBindings: WeakMap<IBindingInfo, ICommandSubscription> = new WeakMap();

function getWcBindable(element: Element): IWcBindable | null {
  const customTagName = getCustomElement(element);
  if (customTagName === null) {
    return null;
  }
  const customClass = customElements.get(customTagName) as { wcBindable?: IWcBindable } | undefined;
  if (typeof customClass === "undefined") {
    raiseError(`Custom element <${customTagName}> is not defined for command binding.`);
  }
  const bindable = customClass.wcBindable;
  if (bindable?.protocol === "wc-bindable" && bindable?.version === 1) {
    return bindable;
  }
  return null;
}

export function applyChangeToCommand(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  if (!isCommandToken(newValue)) {
    raiseError(`command binding requires a CommandToken value (use $commandToken or $commandTokens declaration).`);
  }
  const token = newValue as ICommandToken;

  const existing = subscribedBindings.get(binding);
  if (existing && existing.token === token) {
    return;
  }

  // 新しい binding 妥当性検証は、旧 subscription を解除する前に通す（fail-fast）。
  const element = binding.node as Element;
  const methodName = binding.propSegments[1];
  if (typeof methodName !== "string" || methodName.length === 0) {
    raiseError(`command binding requires a method name (e.g., "command.fetch").`);
  }

  const bindable = getWcBindable(element);
  if (bindable === null) {
    raiseError(`command binding requires a wc-bindable custom element. <${element.tagName.toLowerCase()}> is not wc-bindable.`);
  }
  if (!Array.isArray(bindable.commands) || !bindable.commands.includes(methodName)) {
    raiseError(`Command "${methodName}" is not declared in wcBindable.commands of <${element.tagName.toLowerCase()}>.`);
  }

  // ここまで来たら旧解除して新 subscribe に切り替える。
  if (existing) {
    existing.unsubscribe();
    subscribedBindings.delete(binding);
  }

  const elementRef = new WeakRef(element);
  let unsubscribe: (() => void) | null = null;
  const subscriber = (...args: unknown[]): unknown => {
    const el = elementRef.deref();
    if (!el || !el.isConnected) {
      unsubscribe?.();
      subscribedBindings.delete(binding);
      return undefined;
    }
    const method = (el as unknown as Record<string, unknown>)[methodName];
    if (typeof method !== "function") {
      raiseError(`Method "${methodName}" is not a function on <${el.tagName.toLowerCase()}>.`);
    }
    return Reflect.apply(method as (...a: unknown[]) => unknown, el, args);
  };
  unsubscribe = token.subscribe(subscriber);
  subscribedBindings.set(binding, { token, unsubscribe, elementRef });
}

export const __private__ = {
  subscribedBindings,
};
