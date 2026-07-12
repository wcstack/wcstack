import { IBindingInfo } from "../types";

/**
 * イベントハンドラ登録の台帳。
 *
 * 旧実装は Map<string, Set<IBindingInfo>>（文字列キーの強参照 Map）で binding を
 * 保持していたため、binding.node → 行 DOM サブツリー全体が解放不能だった
 * （detach 系はほぼ呼ばれないため、リスト削除後も全イベントバインディングが
 * 永久保持されるリーク。clear-10k 後に 10k 行分の detached DOM が残留していた）。
 *
 * WeakSet（帰属判定・冪等性）と件数カウンタ（「最後の 1 件が外れたらハンドラを
 * 掃除する」判定）に分離し、binding を強参照しない。GC で binding が消えた場合
 * カウンタは減らないが、残るのはキー文字列と数値のみで実害はない。
 */
export interface IHandlerBindingRegistry {
  /** binding を key に登録する。新規登録なら true を返す（既登録は冪等に false） */
  add(key: string, binding: IBindingInfo): boolean;
  /** binding を key から外す。key の登録件数が 0 になったら true を返す */
  remove(key: string, binding: IBindingInfo): boolean;
  has(key: string, binding: IBindingInfo): boolean;
  countOf(key: string): number;
  readonly keyCount: number;
  clear(): void;
}

export function createHandlerBindingRegistry(): IHandlerBindingRegistry {
  const attachedByKey = new Map<string, WeakSet<IBindingInfo>>();
  const countByKey = new Map<string, number>();
  return {
    add(key: string, binding: IBindingInfo): boolean {
      let attached = attachedByKey.get(key);
      if (typeof attached === "undefined") {
        attached = new WeakSet<IBindingInfo>();
        attachedByKey.set(key, attached);
      }
      if (attached.has(binding)) {
        return false;
      }
      attached.add(binding);
      countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
      return true;
    },
    remove(key: string, binding: IBindingInfo): boolean {
      const attached = attachedByKey.get(key);
      if (typeof attached === "undefined" || !attached.has(binding)) {
        return false;
      }
      attached.delete(binding);
      const next = (countByKey.get(key) ?? 1) - 1;
      if (next <= 0) {
        attachedByKey.delete(key);
        countByKey.delete(key);
        return true;
      }
      countByKey.set(key, next);
      return false;
    },
    has(key: string, binding: IBindingInfo): boolean {
      return attachedByKey.get(key)?.has(binding) ?? false;
    },
    countOf(key: string): number {
      return countByKey.get(key) ?? 0;
    },
    get keyCount(): number {
      return countByKey.size;
    },
    clear(): void {
      attachedByKey.clear();
      countByKey.clear();
    },
  };
}
