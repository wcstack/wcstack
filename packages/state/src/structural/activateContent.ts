import { applyChange } from "../apply/applyChange";
import { IApplyContext } from "../apply/types";
import { getAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding";
import { addBindingByAbsoluteStateAddress, removeBindingByAbsoluteStateAddress } from "../binding/getBindingSetByAbsoluteStateAddress";
import { getBindingsByContent } from "../bindings/bindingsByContent";
import { getBindingSessionByContent } from "../bindings/bindingSessionByContent";
import { bindLoopContextToContent, unbindLoopContextToContent } from "../bindings/bindLoopContextToContent";
import { ILoopContext } from "../list/types";
import { IContent } from "./types";

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
  for (const binding of bindings) {
    if (session !== null) {
      session.disposeBinding(binding);
    } else {
      const absoluteStateAddress = getAbsoluteStateAddressByBinding(binding);
      removeBindingByAbsoluteStateAddress(absoluteStateAddress, binding);
    }
  }
  unbindLoopContextToContent(content);
}
