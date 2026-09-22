import { config, inSsr } from "../config";
import { devtoolsSink } from "../platform/devtoolsSink";
import { applyMirrorAttribute, getInputAttributeMirror } from "../event/getInputAttributeMirror";
import { beginPropagationTransaction, extendPropagationContext, getCurrentPropagationContext, getEdgeId, getWireId, runWithPropagationContext, runWithWriteReceipt } from "../propagation/propagation";
import { isPossibleTwoWay } from "../event/isPossibleTwoWay";
import { getCustomElement } from "../getCustomElement";
import { IBindingInfo } from "../types";
import { componentApplyHooks } from "../core/componentApplyHooks";
import { IApplyContext } from "./types";
import { addSsrProperty, trackSsrPropertyNode } from "./ssrPropertyStore";
import { isHtmlSinkProp, reportTrustedTypesBlock, trustHtmlValue } from "../trustedTypes";

// SSR 時に HTML 属性で代替可能なプロパティ
// これら以外のプロパティは ssrPropertyStore に蓄積してハイドレーション時に復元
const SSR_ATTR_PROPS: Record<string, (element: Element, value: unknown) => void> = {
  value(element, value) {
    if (element.tagName === 'TEXTAREA') {
      element.textContent = String(value ?? '');
    } else {
      element.setAttribute('value', String(value ?? ''));
    }
  },
  checked(element, value) {
    if (value) element.setAttribute('checked', '');
    else element.removeAttribute('checked');
  },
  selected(element, value) {
    if (value) element.setAttribute('selected', '');
    else element.removeAttribute('selected');
  },
  disabled(element, value) {
    if (value) element.setAttribute('disabled', '');
    else element.removeAttribute('disabled');
  },
  selectedIndex(element, value) {
    const options = element.querySelectorAll('option');
    const idx = Number(value);
    for (let i = 0; i < options.length; i++) {
      if (i === idx) options[i].setAttribute('selected', '');
      else options[i].removeAttribute('selected');
    }
  },
};

/**
 * 表示のプロパティ（要件 B8）。ここへの undefined は「値が無い」ので空にする — 要素の入力と違って
 * 生かすべき既定値が無く、スキップすると、使い回した行に前の行の表示が残る。
 *
 * `outerHTML` は **入れない**。`trustedTypes.isHtmlSinkProp` は HTML sink として認めるが、
 * `element.outerHTML = ""` は要素そのものを DOM から外すので、「空にする」では済まず束縛先の
 * ノードごと失われる（以降の更新が届かない）。値が無いときはスキップして前の描画を残す方が
 * まだ壊れ方が小さい。`outerHTML:` を表示面として正しく畳むには「置換のやり直し」の設計が要る。
 */
const DISPLAY_PROPS = new Set<string>(["textContent", "innerText", "innerHTML"]);

export function applyChangeToProperty(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  if (typeof newValue === "undefined" && binding.propSegments.length === 1 && DISPLAY_PROPS.has(binding.propSegments[0])) {
    newValue = "";
  }
  // 要素の入力への undefined は「状態が値を持たない＝無意見」であり、書き込み自体をスキップして
  // 要素側の既定値を生かす。書き込んでしまうと setter の文字列化で
  // "undefined" 属性や removeAttribute が走り要素が壊れる (spread で未初期化
  // slot を配線したときに顕在化)。明示的なクリアは null で表現する。
  // mirror 属性 (applyMirrorAttribute) の「undefined → 属性削除」と同じ語彙。
  if (typeof newValue === "undefined") {
    if (config.debug) {
      console.debug(`Skipped property write: state value is undefined.`, {
        element: binding.node,
        propSegments: binding.propSegments,
        statePathName: binding.statePathName,
      });
    }
    return;
  }
  const element = binding.node as Element;
  const propSegments = binding.propSegments;
  if (propSegments.length === 1) {
    const firstSegment = propSegments[0];

    const current = (element as any)[firstSegment];
    if (current !== newValue) {
      // 完了前の丸ごとマウント（`state: user`）は、作者の state オブジェクトを親の
      // オブジェクトで置き換えてしまう。あとで戻せるように置き換え前を控える
      // （webComponent/preCompletionWrites.ts — bind-component の機能が core/componentApplyHooks.ts に置く。
      // 置かれていなければ判定 1 回で抜ける）。オブジェクト → オブジェクトの書き込みで
      // 相手がカスタム要素のときだけ台帳に触る（通常の書き込みは typeof 判定で抜ける）。
      if (componentApplyHooks !== null && current !== null && typeof current === 'object'
        && newValue !== null && typeof newValue === 'object'
        && getCustomElement(element) !== null) {
        componentApplyHooks.rememberOverwrittenObject(element, firstSegment, current);
      }
      // Trusted Types: HTML sink (`innerHTML` 等) への書き込みだけ、利用側が注入した
      // sanitizer 付き policy を通す。state が identity policy を作って素通しさせるのは
      // TT の無効化と同義なので採らない（docs/csp.md §7）。sink 以外は文字列比較 3 回で
      // 抜けるので、ホットパスの実コストはほぼ無い。
      const isHtmlSink = isHtmlSinkProp(firstSegment);

      const performWrite = (): void => {
        let propertyWriteSucceeded = false;
        try {
          (element as any)[firstSegment] = isHtmlSink ? trustHtmlValue(newValue) : newValue;
          propertyWriteSucceeded = true;
        } catch (error) {
          // TT が原因のときは config.debug に関係なく報告する。ここを黙って握り潰すと
          // 「バインドを書いたのに何も起きない」という最悪の壊れ方をする。
          if (isHtmlSink) {
            reportTrustedTypesBlock(element, firstSegment);
          }
          if (config.debug) {
            console.warn(`Failed to set property '${firstSegment}' on element.`, {
              element,
              newValue,
              error
            });
          }
        }
        // wc-bindable inputs[].attribute ミラー。プロパティ書き込みが成功したときだけ
        // 属性へ反映する。setter が値を拒否した場合に属性だけ進んでしまうと
        // property と attribute が乖離し、attributeChangedCallback や CSS セレクタが
        // 実際のプロパティ値と矛盾した状態で発火するため、ここでガードする。
        if (propertyWriteSucceeded) {
          const mirrorAttr = getInputAttributeMirror(element, firstSegment);
          if (mirrorAttr !== null) {
            try {
              applyMirrorAttribute(element, mirrorAttr, newValue);
            } catch (error) {
              if (config.debug) {
                console.warn(`Failed to mirror attribute '${mirrorAttr}' on element.`, {
                  element,
                  newValue,
                  error
                });
              }
            }
          }
        }
      };
      // Zero-cost fast path (§4 最適化): the propagation edge / WriteReceipt
      // machinery only matters when the element write can *echo* — i.e. the setter
      // may synchronously dispatch an event a two-way wire feeds back to state.
      // `isPossibleTwoWay` is the same conservative check the two-way listener
      // registration uses, and it is cheap for the common one-way case (textContent
      // / class / style on plain elements return false fast). One-way bindings can
      // never re-traverse an edge, so skipping the context/receipt is safe and
      // avoids a per-apply Set copy + receipt allocation. Diamond / coalescing are
      // unaffected — those ride the write-transaction context threaded through the
      // updater, not the element edge.
      if (config.enablePropagationContext && isPossibleTwoWay(element, firstSegment)) {
        // Phase 3: state → element edge の通過を記録し、同じ transaction が
        // 同じ edge を再度通ろうとした場合だけ抑止する（設計書 §4 規則 2）。
        // 書き込みは WriteReceipt scope で包み、setter が同期 dispatch する
        // event が confirmation / 正規化を判定できるようにする（規則 3）。
        const wireId = getWireId(element, firstSegment, binding.statePathName);
        const edgeId = getEdgeId(wireId, "to-element");
        const baseContext = _context?.propagationContextByBinding?.get(binding)
          ?? getCurrentPropagationContext()
          ?? beginPropagationTransaction(wireId);
        if (baseContext.visitedEdges.has(edgeId)) {
          if (devtoolsSink !== null) {
            devtoolsSink({
              type: "propagation:suppressed",
              reason: "visited-edge",
              transactionId: baseContext.transactionId,
              edgeId,
              node: element,
              member: firstSegment,
            });
          }
        } else {
          const extendedContext = extendPropagationContext(baseContext, edgeId);
          runWithPropagationContext(extendedContext, () =>
            runWithWriteReceipt(element, firstSegment, newValue, wireId, extendedContext.transactionId, performWrite));
        }
      } else {
        performWrite();
      }
    }
    if (inSsr()) {
      const attrHandler = SSR_ATTR_PROPS[firstSegment];
      if (attrHandler) {
        // 属性で代替可能 → HTML 属性に反映
        attrHandler(element, newValue);
      } else {
        // 属性で代替不可 → ハイドレーション用ストアに蓄積
        addSsrProperty(element, firstSegment, newValue);
        trackSsrPropertyNode(element);
      }
    }
    return;
  }
  const firstSegment = propSegments[0];
  let subObject = (element as any)[firstSegment];
  for (let i = 1; i < propSegments.length - 1; i++) {
    const segment = propSegments[i];
    if (subObject == null) {
      return;
    }
    subObject = subObject[segment];
  }
  const lastSegment = propSegments[propSegments.length - 1];
  const oldValue = subObject[lastSegment];
  if (oldValue !== newValue) {
    if (Object.isFrozen(subObject)) {
      if (config.debug) {
        console.warn(`Attempting to set property on frozen object.`, {
          element,
          propSegments,
          oldValue,
          newValue
        });
      }
      return;
    }
    // 完了前の部分マウント（`state.theme: theme`）が、作者の state オブジェクトに無かった
    // キーを作る（積み）ことを控える。R1 の衝突報告はこのキーを作者のものとして扱わない
    // （webComponent/preCompletionWrites.ts — core/componentApplyHooks.ts 越し）
    if (componentApplyHooks !== null && propSegments.length === 2 && typeof subObject === 'object' && subObject !== null
      && getCustomElement(element) !== null) {
      if (!(lastSegment in subObject)) {
        componentApplyHooks.recordInjectedKey(element, firstSegment, lastSegment);
      } else {
        // 既存キーの上書き: 作者の値を控える（v2 の厳格 R1 が snapshot 前に復元する）。
        // 完了後の (element, stateProp) への適用はここへルーティングされない
        //（applyChangeToWebComponent の no-op へ行く — apply/applyChange.ts）ので、
        // ここに来る上書きは常に完了前＝控えの対象で良い
        componentApplyHooks.rememberOverwrittenValue(element, firstSegment, lastSegment, subObject[lastSegment]);
      }
    }
    try {
      subObject[lastSegment] = newValue;
    } catch (error) {
      if (config.debug) {
        console.warn(`Failed to set property on sub-object.`, {
          element,
          propSegments,
          oldValue,
          newValue,
          error
        });
      }
    }
  }
  // サブオブジェクトプロパティ (e.g. style.xxx) は属性に反映済みなのでストア不要
}
