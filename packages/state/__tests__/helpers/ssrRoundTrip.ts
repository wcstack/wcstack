/**
 * __tests__/helpers/ssrRoundTrip.ts — サーバー描画 → クライアントのハイドレーションを、1 つのテスト
 * モジュールの中で往復させる手順（#258）。
 *
 * **fixture は手で書かず、サーバーに描かせる。** 入れ子の for の実際のサーバー出力は、`<wcs-ssr>` の
 * テンプレートが平ら（入れ子は親の中身にプレースホルダとして居る）で、内側の行の終端コメントが逆順に
 * 並ぶ。手書きの断片はどちらも持たず、ハイドレーション全体が `ListIndex not found` で止まる穴を
 * 見逃した。
 *
 * **サーバーの台帳は捨ててからハイドレートする。** 構造テンプレートの台帳（fragmentInfoByUUID）は
 * モジュール寿命なので、同じモジュールで描いたサーバーの登録が残っていると、ブラウザでは起きない形で
 * 解決できてしまう（サーバーの uuid を指すプレースホルダが、クライアントが `<wcs-ssr>` から組んだ
 * 台帳に無くても引ける）。`@wcstack/server` の `renderToString` が後始末の最後に呼ぶのと同じ
 * `resetSsrRenderState` を掛け、新しいページと同じ「台帳は `<wcs-ssr>` からだけ組む」状態にする。
 *
 * 使う側は bootstrapState() 済みであること。
 */
import { State } from "../../src/components/State";
import { buildSsrDocument, resetSsrRenderState } from "../../src/ssr/buildSsrDocument";
import { flush } from "./recursionTestUtils";

/** updater の drain と、その後の deferReport・マウントの完了まで流す */
export async function settle(): Promise<void> {
  await flush();
  await flush();
}

/** サーバーとして描き、`<wcs-ssr>` 付きの body の HTML を返す。後始末で DOM とサーバーの台帳を捨てる */
export async function serverRender(markup: string, make: () => any): Promise<string> {
  document.documentElement.setAttribute("data-wcs-server", "");
  try {
    document.body.innerHTML = markup;
    const el = document.querySelector("wcs-state") as State;
    el.setInitialState(make());
    await el.connectedCallbackPromise;
    await State.getBindingsReady(document);
    await settle();
    buildSsrDocument(document);
    return document.body.innerHTML;
  } finally {
    document.documentElement.removeAttribute("data-wcs-server");
    document.body.innerHTML = "";
    resetSsrRenderState();
  }
}

/** クライアントとして HTML を読み込み、バインディングの確立（ハイドレーションか全描画）まで待つ */
export async function clientLoad(html: string, make: () => any): Promise<State> {
  document.body.innerHTML = html;
  const el = document.querySelector("wcs-state") as State;
  el.setInitialState(make());
  await el.connectedCallbackPromise;
  await State.getBindingsReady(document);
  await settle();
  return el;
}

/** `enable-ssr` を外した同じマークアップ（CSR の対照） */
export function csrMarkup(markup: string): string {
  return markup.replace(" enable-ssr", "");
}
