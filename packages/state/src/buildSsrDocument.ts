import { config } from "./config";
import { Ssr } from "./components/Ssr";
import { VERSION } from "./version";
import { IWcsSsrSnapshotBuilder, SSR_SNAPSHOT_BUILDER_KEY } from "./protocol/ssrSnapshot";

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
  const stateElements = root.querySelectorAll(`${stateTag}[enable-ssr]`);
  for (const stateEl of stateElements) {
    // 既に直前へ生成済み（旧 server との組み合わせで inline 生成された等）なら
    // 何もしない — build() は冪等でなければならない（プロトコル契約）
    const prev = stateEl.previousElementSibling;
    if (prev !== null && prev.tagName.toLowerCase() === ssrTag) {
      continue;
    }
    const ssrEl = document.createElement(ssrTag);
    ssrEl.setAttribute("version", VERSION);
    Ssr.buildContent(ssrEl, Ssr.extractStateData(stateEl));
    stateEl.parentNode?.insertBefore(ssrEl, stateEl);
  }
}

const builder: IWcsSsrSnapshotBuilder = {
  protocol: "wcs-ssr-snapshot",
  version: 1,
  build: buildSsrDocument,
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
