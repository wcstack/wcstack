/**
 * SSR モード判定。@wcstack/server の renderToString がレンダリング中の document
 * 要素へ `data-wcs-server` 属性を設定する。state 側（packages/state/src/config.ts の
 * inSsr）と同じ規約 — パッケージ間 import はせず、属性規約で合意する
 * （docs/ssr-router-design.md §3.2）。
 *
 * キャッシュしない: SSR モードはプロセスの属性ではなく「現在の document」の属性。
 * サーバーレンダリングの後、同一プロセスでクライアント側の起動（SSR→hydrate の
 * e2e）が走り得るため、呼び出しごとに現在の document を見る。
 */
export function inSsr(): boolean {
  const html = document.documentElement;
  return html ? html.hasAttribute('data-wcs-server') : false;
}
