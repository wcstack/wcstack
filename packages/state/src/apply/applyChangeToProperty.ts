import { config, inSsr } from "../config";
import { devtoolsSink } from "../devtools/sink";
import { applyMirrorAttribute, getInputAttributeMirror } from "../event/getInputAttributeMirror";
import { beginPropagationTransaction, extendPropagationContext, getCurrentPropagationContext, getEdgeId, getWireId, runWithPropagationContext, runWithWriteReceipt } from "../propagation/propagation";
import { IBindingInfo } from "../types";
import { IApplyContext } from "./types";
import { addSsrProperty, trackSsrPropertyNode } from "./ssrPropertyStore";

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

export function applyChangeToProperty(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  // undefined は「状態が値を持たない＝無意見」であり、書き込み自体をスキップして
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
    if ((element as any)[firstSegment] !== newValue) {
      const performWrite = (): void => {
        let propertyWriteSucceeded = false;
        try {
          (element as any)[firstSegment] = newValue;
          propertyWriteSucceeded = true;
        } catch (error) {
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
      if (config.enablePropagationContext) {
        // Phase 3: state → element edge の通過を記録し、同じ transaction が
        // 同じ edge を再度通ろうとした場合だけ抑止する（設計書 §4 規則 2）。
        // 書き込みは WriteReceipt scope で包み、setter が同期 dispatch する
        // event が confirmation / 正規化を判定できるようにする（規則 3）。
        const wireId = getWireId(element, firstSegment, binding.stateName, binding.statePathName);
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
  const oldValue = subObject[propSegments[propSegments.length - 1]];
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
    try {
      subObject[propSegments[propSegments.length - 1]] = newValue;
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
