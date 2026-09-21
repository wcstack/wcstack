/**
 * dcc/addressHooks.ts — `$bindables` を持つ DCC の state に付く hook（設計案 H1、S3）。
 * 書き込み・`$postUpdate` の後の bindable イベント dispatch を core から移し、
 * `$bindables` の無い state では一切走らない。
 */
import { IAddressHooks, registerFeatureHooks } from "../core/addressHooks";
import { dispatchBindableEvent } from "./dispatchBindableEvent";

export const dccAddressHooks: IAddressHooks = {
  // DCC bindable イベントディスパッチ（完全一致 ＋ サブパス → 先頭セグメント、§2.1）
  written: dispatchBindableEvent,
};

let installed = false;
/** 冪等。full エントリでは State が `$bindables` の束ね先になった時点で呼ぶ */
export function installDccHooks(): void {
  if (installed) return;
  installed = true;
  registerFeatureHooks("dcc", dccAddressHooks);
}
