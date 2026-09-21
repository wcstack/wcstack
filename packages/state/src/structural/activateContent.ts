import { applyChange, applyValueToBinding } from "../apply/applyChange";
import { IApplyContext } from "../apply/types";
import { getAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding";
import { addBindingByAbsoluteStateAddress, removeBindingByAbsoluteStateAddress } from "../binding/getBindingSetByAbsoluteStateAddress";
import { getBindingsByContent } from "../bindings/bindingsByContent";
import { getBindingSessionByContent } from "../bindings/bindingSessionByContent";
import type { BindingSession } from "../bindings/BindingSession";
import { bindLoopContextToContent, unbindLoopContextToContent } from "../bindings/bindLoopContextToContent";
import { ILoopContext } from "../list/types";
import { getByAddressSymbol } from "../proxy/symbols";
import type { IBindingInfo } from "../types";
import { getPlanByContent } from "./planByContent";
import { IContent, IRowPlan } from "./types";

/**
 * プラン初期描画（行ランタイム設計 R2）の下ごしらえ。
 *
 * 行の下の**素の葉**（どの接頭辞も getter でなく、tail にワイルドカードが無く、event /
 * index 束縛でもない）の slot は、行オブジェクトを proxy で 1 回読めば値が取れる。その
 * 「行のパスからの残り」をプランと行パスの組ごとに 1 回だけ作って持つ（行不変）。
 * null は「この slot はプラン初期描画に載せない」。
 */
interface ISlotTail {
  /** 行オブジェクトからの残りのセグメント */
  readonly tail: string[];
  /** getter 判定のための、行パスからの累積パス */
  readonly prefixes: string[];
}

const tailsByPlan = new WeakMap<IRowPlan, Map<string, (ISlotTail | null)[]>>();

function slotTails(plan: IRowPlan, bindings: readonly IBindingInfo[], rowPath: string): (ISlotTail | null)[] {
  let byRowPath = tailsByPlan.get(plan);
  if (typeof byRowPath === "undefined") {
    tailsByPlan.set(plan, byRowPath = new Map());
  }
  const cached = byRowPath.get(rowPath);
  if (typeof cached !== "undefined") {
    return cached;
  }
  const prefix = rowPath + ".";
  const tails = bindings.map((binding, i) => {
    const slot = plan.slots[i];
    if (slot.isEvent || slot.isIndexBinding) {
      return null;
    }
    const path = binding.statePathInfo.path;
    if (!path.startsWith(prefix)) {
      return null;
    }
    const tail = path.slice(prefix.length).split(".");
    const prefixes: string[] = [];
    let accumulated = rowPath;
    for (const segment of tail) {
      if (segment === "*") {
        // 行より下のワイルドカード（入れ子リスト）は行オブジェクトの素の読みでは解けない
        return null;
      }
      accumulated += "." + segment;
      prefixes.push(accumulated);
    }
    return { tail, prefixes };
  });
  byRowPath.set(rowPath, tails);
  return tails;
}

/**
 * getter は state ごとの集合で、`_state` の再セットで作り直される。行ごとに引き直す
 * （プラン側にキャッシュすると、再セット後も古い判定を使ってしまう）。
 */
function hasGetterOnPrefix(prefixes: string[], getterPaths: ReadonlySet<string>): boolean {
  for (let k = 0; k < prefixes.length; k++) {
    if (getterPaths.has(prefixes[k])) {
      return true;
    }
  }
  return false;
}

/**
 * プラン行の初期描画。行オブジェクトを proxy で 1 回読み、素の葉の slot にはその生の値を
 * そのまま渡す（読み 7 → 4・適用 3 → 1 回/行。調査 §10.13）。getter の slot と、
 * 載せられない slot は従来どおり `applyChange` を通る。
 */
function applyPlanRow(
  plan: IRowPlan,
  bindings: readonly IBindingInfo[],
  session: BindingSession,
  loopContext: ILoopContext,
  context: IApplyContext,
): void {
  const tails = slotTails(plan, bindings, loopContext.pathInfo.path);
  const getterPaths = context.stateElement.getterPaths;
  let rowValue: any;
  let rowRead = false;
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    if (!session.shouldApplyState(binding)) {
      continue;
    }
    const slotTail = tails[i];
    if (slotTail === null || hasGetterOnPrefix(slotTail.prefixes, getterPaths)) {
      applyChange(binding, context);
      continue;
    }
    if (context.appliedBindingSet.has(binding)) {
      continue;
    }
    context.appliedBindingSet.add(binding);
    if (!rowRead) {
      rowValue = (context.state as any)[getByAddressSymbol](loopContext);
      rowRead = true;
    }
    const tail = slotTail.tail;
    let value: any = rowValue;
    for (let k = 0; k < tail.length; k++) {
      if (value === null || typeof value === "undefined") {
        value = undefined;
        break;
      }
      value = value[tail[k]];
    }
    applyValueToBinding(binding, context, value);
  }
}

export function activateContent(
  content: IContent,
  loopContext: ILoopContext | null,
  context: IApplyContext,
): void {
  bindLoopContextToContent(content, loopContext);
  const bindings = getBindingsByContent(content);
  const session = getBindingSessionByContent(content);
  if (session !== null) {
    // createContent 側の initialize で remember 済みの同一 binding 配列なので、
    // remember を再実行しない専用パスで活性化する（リスト行生成のホットパス）。
    // context.rootNode は applyChangeFromBindings が確定済みの root（fragment
    // バッファ中は setRootNodeByFragment の対応先と同一）で、binding ごとの
    // getRootNode を省略できる
    session.activate(bindings, context.rootNode);
    // プラン初期描画（設計 R2）。載せないのは 2 つ:
    //   `$updatedCallback` を持つ state — 束縛ごとのアドレス集計が要る
    //   `**` を持つ state — 展開形の getter が `getterPaths` に無いので素の葉と見分けられない
    if (loopContext !== null
      && context.stateElement.hasUpdatedCallback === false
      && context.stateElement.hasRecursion !== true) {
      const plan = getPlanByContent(content);
      if (plan !== null) {
        applyPlanRow(plan, bindings, session, loopContext, context);
        return;
      }
    }
  }
  for (const binding of bindings) {
    if (session === null) {
      const absoluteStateAddress = getAbsoluteStateAddressByBinding(binding);
      addBindingByAbsoluteStateAddress(absoluteStateAddress, binding);
    }
    if (session !== null && !session.shouldApplyState(binding)) {
      continue;
    }
    applyChange(binding, context);
  }
}

export function deactivateContent(
  content: IContent,
): void {
  if (!content.mounted) {
    return;
  }
  const bindings = getBindingsByContent(content);
  const session = getBindingSessionByContent(content);
  for (let i = 0; i < bindings.length; i++) { // 添字ループ（消去の窓に反復子のごみを残さない）
    const binding = bindings[i];
    if (session !== null) {
      session.disposeBinding(binding);
    } else {
      const absoluteStateAddress = getAbsoluteStateAddressByBinding(binding);
      removeBindingByAbsoluteStateAddress(absoluteStateAddress, binding);
    }
  }
  unbindLoopContextToContent(content);
}
