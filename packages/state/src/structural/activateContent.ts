import { applyChange } from "../apply/applyChange";
import { IApplyContext } from "../apply/types";
import { getAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding";
import { addBindingByAbsoluteStateAddress, removeBindingByAbsoluteStateAddress } from "../binding/getBindingSetByAbsoluteStateAddress";
import { getBindingsByContent } from "../bindings/bindingsByContent";
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
  for(const binding of bindings) {
    const absoluteStateAddress = getAbsoluteStateAddressByBinding(binding);
    addBindingByAbsoluteStateAddress(absoluteStateAddress, binding);
    applyChange(binding, context);
  }
}

export function deactivateContent(
  content: IContent
): void {
  if (!content.mounted) {
    return;
  }
  const bindings = getBindingsByContent(content);
  for(const binding of bindings) {
    const absoluteStateAddress = getAbsoluteStateAddressByBinding(binding);
    removeBindingByAbsoluteStateAddress(absoluteStateAddress, binding);
    // アドレスキャッシュ（absoluteStateAddressByBinding / stateAddressByBindingInfo）
    // のクリアはここでは行わない。deactivateContent の呼び出し元（for/if）は必ず
    // 直後に content.unmount() を呼び、unmount が同じ2台帳をネスト content も含めて
    // クリアする（createContent.ts）。ここで消すと全 binding で二重 delete になる。
  }
  unbindLoopContextToContent(content);
}

