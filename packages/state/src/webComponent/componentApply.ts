/**
 * webComponent/componentApply.ts — bind-component の 2 つの台帳（完了・宣言 — completeWebComponent.ts、
 * 完了前の書き込みの控え — preCompletionWrites.ts）を、親スコープの適用が引く受け口
 * （core/componentApplyHooks.ts）の形に束ねたもの。置くのは bindComponentLifecycle.ts の install。
 * 完了前は素のプロパティへ積んで控え、完了後は値を運ばない通知へ切り替える。
 */
import type { IComponentApplyHooks } from "../core/componentApplyHooks";
import { isWebComponentComplete, isWebComponentStatePropDeclared } from "./completeWebComponent";
import { recordInjectedKey, rememberOverwrittenObject, rememberOverwrittenValue } from "./preCompletionWrites";

export const bindComponentApplyHooks: IComponentApplyHooks = {
  isComplete: isWebComponentComplete,
  isDeclared: isWebComponentStatePropDeclared,
  rememberOverwrittenObject,
  recordInjectedKey,
  rememberOverwrittenValue,
};
