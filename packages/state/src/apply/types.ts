import { IStateElement } from "../components/types";
import { IStateProxy } from "../proxy/types";
import { IBindingInfo } from "../binding/types";
import { IAbsoluteStateAddress } from "../address/types";
import { IPropagationContext } from "../propagation/types";

export interface IDeferredSelectBinding {
  readonly binding: IBindingInfo;
  readonly value: unknown;
}

export interface IApplyContext {
  readonly rootNode: Node;
  readonly stateName: string;
  readonly stateElement: IStateElement;
  readonly state: IStateProxy;
  appliedBindingSet: Set<IBindingInfo>;
  newListValueByAbsAddress: Map<IAbsoluteStateAddress, readonly unknown[]>;
  updatedAbsAddressSetByStateElement: Map<IStateElement, Set<IAbsoluteStateAddress>>;
  deferredSelectBindings: IDeferredSelectBinding[];
  /**
   * applyChangeFromBindings のグループ化ループが「この context に渡る binding の
   * 解決済みルートは context.rootNode に一致する」ことを検証済みであることを示す。
   * true かつ stateName が一致する binding は applyChange 内の getRootNode 再解決を
   * 省略できる（大量バインディング drain のホットパス短縮）。
   */
  readonly sameRootVerified?: boolean;
  /**
   * updater drain 由来の binding ごとの因果 context（Phase 3、
   * `enablePropagationContext` 有効時のみ設定される）。update record の
   * coalescing 済み winner context がそのまま入る。
   */
  readonly propagationContextByBinding?: ReadonlyMap<IBindingInfo, IPropagationContext | null>;
}

export type ApplyChangeFn = (binding: IBindingInfo, context: IApplyContext, newValue: unknown) => void;
