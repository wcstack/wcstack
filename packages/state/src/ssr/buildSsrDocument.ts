import { config } from "../config";
import { Ssr } from "./Ssr";
import { VERSION } from "../version";
import { IWcsSsrSnapshotBuilder, SSR_SNAPSHOT_BUILDER_KEY } from "../protocol/ssrSnapshot";
import { clearSsrPropertyStore } from "../apply/ssrPropertyStore";
import { clearFragmentInfos } from "../structural/fragmentInfoByUUID";

/**
 * ssr-snapshot プロトコルの提供側（docs/ssr-router-design.md §5）。
 *
 * `<wcs-ssr>` スナップショットを document 全体に対する最終パスとして生成する。
 * connectedCallback 内の inline 生成は「その時点の DOM」しか見えず、router が
 * 後から挿入するルート内容の構造テンプレートを取り逃がすレースがあった
 * （state のロード方式と文書順に依存）。renderToString が全要素の完了と
 * バインディング構築の後にこれを呼ぶことで、スナップショットは常に確定後の
 * DOM を見る。
 *
 * 複数 `enable-ssr` state の意味論は inline 生成と同一に保つ（文書順に生成・
 * fragment レジストリはモジュール共有・props store は生成ごとにクリア）。
 * その整理は本プロトコルの範囲外の既存挙動として引き継ぐ。
 */
export function buildSsrDocument(root: Document): void {
  const stateTag = config.tagNames.state;
  const ssrTag = config.tagNames.ssr;
  // スナップショットはルートツリーに 1 本（D14）: ボリューム（mount=）と bind-component は
  // 独立ツリー（__state）を持たないため、含めると空の <wcs-ssr> を生成してしまう。
  // Ssr.find は文書先頭一致なので、ルートより前の空スナップショットをルートが掴み、
  // ハイドレーション全体が無言で CSR 退化する
  const stateElements = root.querySelectorAll(`${stateTag}[enable-ssr]:not([mount]):not([bind-component])`);
  for (const stateEl of stateElements) {
    // 既に直前へ生成済み（旧 server との組み合わせで inline 生成された等）なら
    // 何もしない — build() は冪等でなければならない（プロトコル契約）
    const prev = stateEl.previousElementSibling;
    if (prev !== null && prev.tagName.toLowerCase() === ssrTag) {
      continue;
    }
    const ssrEl = document.createElement(ssrTag);
    ssrEl.setAttribute("version", VERSION);
    Ssr.buildContent(ssrEl, Ssr.extractStateData(stateEl), stateEl.getRootNode());
    stateEl.parentNode?.insertBefore(ssrEl, stateEl);
  }
  // props の台帳は `buildContent` の末尾でも空にするが、**`enable-ssr` が 1 件も無いページ**は
  // そこを通らない。通らないと強参照の `Set<Node>` が次のレンダリングまで残り、前のページの
  // 値が次のリクエストの props JSON に載る（実測: `{"wcs-ssr-0":{"valueAsNumber":"PRIVATE-C"}}`）。
  // ここはサーバーの最終パスなので、この文書の props をこの後で読む者は居ない。
  // 構造テンプレートの台帳（fragmentInfoByUUID）はここでは消さない — この後に走る
  // 進行中のバインディング構築がまだ読む。プロセスの後始末は `resetSsrRenderState()`
  clearSsrPropertyStore();
}

/**
 * サーバーのレンダリング 1 回分のモジュール大域を捨てる。**サーバー専用**。
 *
 * `@wcstack/server` の `renderToString` は 1 プロセスで何枚も描くが、state 側の台帳
 * （構造テンプレート・SSR props）はモジュール寿命で削除の口が無い。出力への混入は
 * 到達可能性フィルタ（`Ssr.buildContent`）で閉じてあるので、これは**メモリ**の口である。
 *
 * 呼ぶ位置: `renderToString`（正確には `renderInWindow`）の `finally` の最後 — その
 * レンダリングの DOM をもう誰も触らないことが確定してから。ブラウザでは呼ばない。
 */
export function resetSsrRenderState(): void {
  clearFragmentInfos();
  clearSsrPropertyStore();
}

const builder: IWcsSsrSnapshotBuilder = {
  protocol: "wcs-ssr-snapshot",
  version: 1,
  build: buildSsrDocument,
  // レンダラ（@wcstack/server）が後始末の最後に呼ぶ。パッケージの import ではなく
  // プロトコル越しに渡すのは `build` と同じ理由 — グローバル symbol は「実際に動いた
  // state のコピー」を指すので、捨てるべき台帳を持っている当人に必ず届く。
  // 分割エントリを直接 import すると core がもう 1 つ読み込まれ、**別の**台帳を
  // 空にして終わる
  reset: resetSsrRenderState,
};

/**
 * グローバル symbol へ自分を載せる。`bootstrapState` から呼ぶ。
 * binder（registerBinder）と同じ規範 — 既に別のコピーが載っているなら譲る
 * （そのコピーのレジストリが、そのページの正本だからである）。
 */
export function registerSsrSnapshotBuilder(): void {
  const globals = globalThis as Record<symbol, unknown>;
  if (globals[SSR_SNAPSHOT_BUILDER_KEY] === undefined) {
    globals[SSR_SNAPSHOT_BUILDER_KEY] = builder;
  }
}

/** テスト用: 登録を外す */
export function _unregisterSsrSnapshotBuilder(): void {
  const globals = globalThis as Record<symbol, unknown>;
  if (globals[SSR_SNAPSHOT_BUILDER_KEY] === builder) {
    delete globals[SSR_SNAPSHOT_BUILDER_KEY];
  }
}
