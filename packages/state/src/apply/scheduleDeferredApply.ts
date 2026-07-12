import { IBindingInfo } from "../types.js";
import { applyChangeFromBindings } from "./applyChangeFromBindings.js";

// applyChange が「未 define のカスタム要素」への適用を見送った binding の台帳。
// define されるまでの間、同じ binding に対して applyChange は（state 更新の
// たびに）何度も呼ばれうるため、whenDefined の多重登録をここで抑止する。
// WeakSet なので binding の寿命に追従し、恒久 define されないタグでもリークしない。
const scheduledBindings = new WeakSet<IBindingInfo>();

/**
 * 未 define のカスタム要素に対する適用を customElements.whenDefined 後に再実行
 * する。two-way / event-token の attach、spread の deferred 展開はいずれも
 * whenDefined で再試行するのに対し、値の適用だけが片道 skip だった非対称の解消
 * （docs/state-binding-init-races.md §2）。
 *
 * 再適用は applyChangeFromBindings を通すため、define 時点の最新 state 値で
 * 適用される（skip 時点の値を保持しない）。define を待つ間に DOM から外れた
 * binding には適用しない（deferred spread と同じ規約）。
 */
export function scheduleDeferredApply(binding: IBindingInfo, tagName: string): void {
  if (scheduledBindings.has(binding)) {
    return;
  }
  scheduledBindings.add(binding);
  customElements.whenDefined(tagName).then(() => {
    scheduledBindings.delete(binding);
    if (!binding.replaceNode.isConnected) {
      return; // define を待つ間にノードが削除された
    }
    applyChangeFromBindings([binding]);
  }).catch((error: unknown) => {
    console.error(`[@wcstack/state] deferred apply failed for <${tagName}>.`, error);
  });
}
