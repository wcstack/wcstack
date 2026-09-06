/**
 * devtools/declaredBindings.ts — 宣言レベルのバインディング列挙
 * （IDevtoolsSource.getDeclaredBindings の実装・protocol v1 追補）。
 *
 * devtools 側の DOM 再スキャン（declaredScan — 「正本 bindTextParser に非追随」と
 * 自己申告する簡易パーサ）を置き換える正本実装。ランタイム自身のパーサと
 * fragment レジストリで答えるため:
 * - パース結果は実行時解釈と**同一**（複製パーサのドリフトが構造的に消える）
 * - DOM から引き上げられた構造テンプレート内部（for/if の中身）も列挙できる
 *   （DOM 再スキャンでは原理的に不可視だった領域）
 *
 * **戻り値は「宣言の集合」であり、インスタンスの multiset ではない**:
 * レンダリング済みページでは行クローンが `data-wcs` 属性とネストアンカー
 * （同一 UUID）を保持したまま live DOM に入るため、素朴な走査は宣言 1 件を
 * 行数分だけ重複列挙してしまう。ここでは宣言タプル（path / prop /
 * bindingType / フィルタ列）で dedupe し、宣言 1 件 = エントリ 1 件を保証する。
 * インスタンス粒度（どの行のどのノードか）は live の binding 台帳
 * （state:binding-added）の守備範囲で、こちらには持たせない。
 * 同一タプルの独立した静的宣言（同じバインディングを書いた別要素）も 1 件に
 * 畳まれる — node は最初に見つかったものを代表として持つ。
 *
 * fragment（構造テンプレート内部）は **rootNode 配下の live アンカーから到達可能な
 * UUID の推移閉包**として列挙する。ページ大域のレジストリを直接舐めないため、
 * 別 root の fragment や破棄済みビューの stale fragment は載らない。
 *
 * spread（`...:`）は attribute 起点では live Element の wcBindable から展開する
 * （設計 §5-1）。対象カスタム要素が未定義なら既存契約どおり spread のまま残す。
 *
 * **既知の盲点（時系列依存）**: 構造テンプレート外のテキストバインディングは、
 * binding start がコメントアンカーを空 Text に差し替えるため、**活性化後の DOM
 * から消えて列挙に現れない**（mustache は変換前も素の Text で不可視）。早期
 * アタッチ時は live 台帳（binding-added）が同領域を持つ。遅延アタッチでは
 * declared / live のどちらからも見えない — protocol §6 の既知非対称の一部。
 *
 * エラーパス以外もフック接続時にしか呼ばれない pull API であり、ホットパスには
 * 乗らない。壊れた宣言（不正 bindText）はエントリを捨てて先へ進む（検査は lint の
 * 責務 — ここは観測面）。
 */

import { config } from "../config";
import { parseBindTextsForElement } from "../bindTextParser/parseBindTextsForElement";
import { parseBindTextForEmbeddedNode } from "../bindTextParser/parseBindTextForEmbeddedNode";
import { expandSpread } from "../bindTextParser/expandSpread";
import { getFragmentInfoByUUID } from "../structural/fragmentInfoByUUID";
import { ParseBindTextResult } from "../bindTextParser/types";
import { IDeclaredBindingInfo } from "./types";

// bindings/parseCommentNode.ts の EMBEDDED_REGEX と同形（keyword を自前で保持する
// ために複製する — parseCommentNode は keyword を捨てて値しか返さないため、
// 「未登録の構造アンカー（SSR pre-hydration ウィンドウ等）」と「埋め込みテキスト」
// を区別できず、UUID をパスとして誤パースした bogus エントリが生まれる）。
const COMMENT_PATTERN = /^\s*@@\s*(.*?)\s*:\s*(.+?)\s*$/;

function declarationKey(info: IDeclaredBindingInfo): string {
  const filters = [...info.inFilters, ...info.outFilters]
    .map((f) => `${f.filterName}(${f.args.join(",")})`)
    .join("|");
  return [info.statePathName, info.propName, info.bindingType, filters].join("\u0000");
}

function toInfo(
  node: Node | null,
  parsed: ParseBindTextResult,
  origin: IDeclaredBindingInfo["origin"],
  raw: string,
): IDeclaredBindingInfo {
  return {
    node,
    propName: parsed.propName,
    statePathName: parsed.statePathName,
    bindingType: parsed.bindingType,
    inFilters: parsed.inFilters,
    outFilters: parsed.outFilters,
    origin,
    raw,
  };
}

/**
 * rootNode 配下の live DOM と、そこから到達可能な fragment から宣言集合を列挙する。
 * ヘッダの規定（宣言集合 / 到達閉包 / spread 展開 / テキストの盲点）を参照。
 */
export function collectDeclaredBindings(rootNode: Node): IDeclaredBindingInfo[] {
  const out: IDeclaredBindingInfo[] = [];
  const seenKeys = new Set<string>();
  const visitedFragments = new Set<string>();

  const push = (info: IDeclaredBindingInfo): void => {
    const key = declarationKey(info);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    out.push(info);
  };

  /** fragment の内部宣言を emit し、ネストした構造アンカーへ再帰する（到達閉包）。 */
  const visitFragment = (uuid: string): void => {
    if (visitedFragments.has(uuid)) return;
    visitedFragments.add(uuid);
    const fragmentInfo = getFragmentInfoByUUID(uuid);
    if (fragmentInfo === null) return;
    for (const nodeInfo of fragmentInfo.nodeInfos) {
      for (const parsed of nodeInfo.parseBindTextResults) {
        push(toInfo(null, parsed, "fragment", ""));
        if (parsed.uuid != null) {
          visitFragment(parsed.uuid);
        }
      }
    }
  };

  const doc = rootNode.ownerDocument ?? (rootNode as Document);
  const walker = doc.createTreeWalker(
    rootNode,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT,
  );

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      const bindText = element.getAttribute(config.bindAttributeName);
      if (bindText === null || bindText.length === 0) continue;
      try {
        // spread は live Element の wcBindable から展開（未定義要素は spread のまま = 既存契約）
        const results = expandSpread(element, parseBindTextsForElement(bindText));
        for (const parsed of results) {
          push(toInfo(element, parsed, "attribute", bindText));
        }
      } catch {
        // 不正な宣言は観測面では捨てる（検査は lint / ランタイム raiseError の責務）
      }
      continue;
    }
    // コメントアンカー: 構造ディレクティブ（UUID → fragment 登録済み）または
    // 埋め込みテキストバインディング。
    const match = COMMENT_PATTERN.exec((node as Comment).data.trim());
    if (match === null) continue;
    const keyword = match[1] || config.commentTextPrefix;
    const value = match[2];
    const fragmentInfo = getFragmentInfoByUUID(value);
    if (fragmentInfo !== null) {
      push(toInfo(node, fragmentInfo.parseBindTextResult, "comment", value));
      visitFragment(value);
      continue;
    }
    if (keyword !== config.commentTextPrefix) {
      // 構造アンカーなのに fragment 未登録（SSR の pre-hydration ウィンドウ等）、
      // または未知 keyword — UUID や不明値をパスとして誤パースしない。
      continue;
    }
    try {
      push(toInfo(node, parseBindTextForEmbeddedNode(value), "comment", value));
    } catch {
      // 同上
    }
  }

  return out;
}
