import { IParsedBinding } from "../binding/types";

// IParsedBinding(DOM 非依存)の別名。Pick<IBindingInfo, ...> にしないのは、
// `@wcstack/state/parser` の d.ts バンドルへ IBindingInfo 経由で Node 型
// (DOM lib)が持ち込まれるのを防ぐため。
export type ParseBindTextResult = IParsedBinding;
