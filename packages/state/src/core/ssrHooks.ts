/**
 * core/ssrHooks.ts — SSR（サーバー描画とハイドレーション）の受け口（設計案 H8、S5）。
 *
 * core が持つのは SSR **モード**（config の `inSsr()` と apply 側が書く `@@wcs-*` コメント）と
 * `enable-ssr` 属性の判定だけ。`<wcs-ssr>` の読み書きとハイドレーションの実装は ssr 機能
 * （src/ssr/）が install で置く。core から機能への辺はこの 1 本の受け口に畳まれている。
 *
 * 受け口（core 側の呼び出し点）:
 *   hydrate       ルート登録（stateElementByName）で、`enable-ssr` のクライアント側
 *   loadState     `_initialize` の冒頭で、`<wcs-ssr>` に載った state データを読む
 *   emitSnapshot  サーバー側の `connectedCallback` の末尾で `<wcs-ssr>` を書き出す
 */
import { raiseError } from "../raiseError";
import { featureNotInstalledMessage } from "./featureEntries";

export interface ISsrHooks {
  /** クライアント: SSR 出力からバインディングを起こす。偽なら core が通常の構築へ倒す */
  hydrate(root: Document): Promise<boolean>;
  /** クライアント: この要素の前に置かれた `<wcs-ssr>` の state データ（無ければ null） */
  loadState(element: Element): Record<string, any> | null;
  /** サーバー: バインディング完了後に `<wcs-ssr>` を書き出す */
  emitSnapshot(element: Element): Promise<void>;
}

/** 置かれていなければ null。`enable-ssr` の無いページはここを一度も見ない */
export let ssrHooks: ISsrHooks | null = null;

/** 機能の install が呼ぶ（冪等 — 置き換え） */
export function setSsrHooks(hooks: ISsrHooks | null): void {
  ssrHooks = hooks;
}

/**
 * `enable-ssr` が SSR 機能を要求した: 未 install なら名指しで throw する（readiness barrier、H5 / D13）。
 * full / auto は `bootstrapState()` が install するので起きない。
 */
export function requireSsrHooks(declaration: string): ISsrHooks {
  if (ssrHooks === null) {
    raiseError(featureNotInstalledMessage("ssr", declaration));
  }
  return ssrHooks;
}
