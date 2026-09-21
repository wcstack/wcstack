/**
 * pathDiagnostics.ts — パスに関する**エラーの文言**（throw する側）と、診断の両面が共有する部品。
 *
 * 束縛時の存在検査（`user.nmae` のような打ち間違いを console.warn で知らせる開発時の診断）は
 * `features/diagnostics` へ分けた（diagnostics/pathChecks.ts）。core に残るのは、実行を止める
 * エラーの文言と、その did-you-mean が使う候補の集め方だけ。エラーは機能の有無に関わらず
 * 読める文言で落ちなければならないので、ここは core から外せない。
 *
 * 診断 code はコンソール → lint → IDE の三面で共有する（errorGuidance.ts の規約）。
 */

import { DELIMITER } from "./define";
import { didYouMean, LINT_HINT } from "./errorGuidance";

/** `setPathInfo` の呼び出し元の種別。診断 code と適用範囲がこれで変わる */
export type PathInfoSource =
  /** data-wcs / mustache / コメントバインディング */
  | "binding"
  /** `$watch` の宣言キー */
  | "watch"
  /** `$scan` の `from` / `resetOn`（docs/state-scan-design.md §2-4） */
  | "scan"
  /** ランタイム内部のパス翻訳（mapped な bind-component の外向き伝播）。検査しない */
  | "internal";

/**
 * `obj` 自身＋プロトタイプチェーン（Object.prototype 手前まで）から descriptor を引く。
 * 打ち切り位置は getAllPropertyDescriptors と同じ — 「state が宣言したもの」だけを
 * 存在とみなし、`toString` 等の Object.prototype 由来を存在扱いしない。
 *
 * `State.findStateDescriptor`（再帰アクセサの衝突検査）も同じ走査を使う。打ち切り位置が
 * 2 本に分かれると、片方だけが `Object.prototype` を存在扱いするようなずれ方をする。
 */
export function findDescriptor(obj: object, key: string): PropertyDescriptor | undefined {
  let proto: object | null = obj;
  while (proto !== null && proto !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (typeof descriptor !== "undefined") {
      return descriptor;
    }
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}

/** `obj` 自身＋プロトタイプチェーンのキー名（did-you-mean の候補集合） */
function ownKeys(obj: object): string[] {
  const keys: string[] = [];
  let proto: object | null = obj;
  while (proto !== null && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      keys.push(key);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return keys;
}

/**
 * 失敗した階層の兄弟候補。生オブジェクトのキーに加え、その階層にフラット宣言
 * （ドットパス getter）されているものも混ぜる — `cart.items.*.subtotl` の正解
 * `subtotal` は行オブジェクトには無く getterPaths にしか居ないため。
 */
export function collectCandidates(
  container: object,
  parentPrefix: string,
  declaredPaths: Iterable<string>,
): string[] {
  const candidates = ownKeys(container);
  const prefix = parentPrefix.length > 0 ? parentPrefix + DELIMITER : "";
  for (const declared of declaredPaths) {
    if (prefix.length > 0 && !declared.startsWith(prefix)) {
      continue;
    }
    const rest = declared.slice(prefix.length);
    // 直下の 1 セグメントだけを候補にする（孫は別階層の名前なので提案しない）
    if (rest.length > 0 && rest.indexOf(DELIMITER) === -1) {
      candidates.push(rest);
    }
  }
  return candidates;
}

/** 診断 code は lint / IDE と同一語彙（errorGuidance.ts の三面共有規約） */
export const DIAGNOSTIC_CODE: Readonly<Record<"binding" | "watch" | "scan", string>> = {
  binding: "wcs/binding-path-missing",
  watch: "wcs/watch-path-missing",
  scan: "wcs/scan-path-missing",
};

export const SUBJECT: Readonly<Record<"binding" | "watch" | "scan", string>> = {
  binding: "Bound path",
  watch: "$watch path",
  scan: "$scan path",
};

/**
 * ルート直下（単一セグメント）のパスが state に無いときのエラーメッセージ。
 *
 * この形だけは親アドレスを辿れないので読み取りが throw する ＝ 元から loud だが、
 * 文面が `address.parentAddress is undefined path: cout` という内部実装の言葉で、
 * 「打ち間違い」だと分からず did-you-mean も lint 誘導も無かった。深いパスの
 * `console.warn` と同じ語彙に揃える。
 */
export function missingRootPathMessage(
  path: string,
  target: object,
  declaredPaths: Iterable<string>,
): string {
  return `[${DIAGNOSTIC_CODE.binding}] Path "${path}" does not exist on the state tree.` +
    `${didYouMean(path, collectCandidates(target, "", declaredPaths))}${LINT_HINT}`;
}

/**
 * `$resolve` / `$getAll` に渡した添字の本数がワイルドカードの本数と噛み合わない。
 *
 * 不足（`$resolve`）は元から throw していたが、**超過は両 API とも黙って無視**され、
 * 取り違えた添字のまま「もっともらしい値」を返していた。本数はパス文字列から
 * 決まるので、噛み合わないことは常にプログラマのミス。
 */
export function indexArityMessage(
  api: "$resolve" | "$getAll" | "$setAll",
  path: string,
  wildcardCount: number,
  actual: number,
): string {
  // `$getAll` / `$setAll` の添字は前方一致の接頭辞なので上限、`$resolve` だけが厳密一致
  // （docs/state-set-all-design.md §4）。
  const requirement = api === "$resolve"
    ? `exactly ${wildcardCount}`
    : `at most ${wildcardCount}`;
  return `[wcs/index-arity] ${api}("${path}") requires ${requirement} index(es) ` +
    `("*" appears ${wildcardCount} time(s) in the path) but got ${actual}.${LINT_HINT}`;
}

/**
 * `**` を含むパスが宣言済みの再帰アンカーと合致しない（綴り違い・2 つ目の `**`）。
 * 束縛形（bind.ts）・合併形（getAllRecursive.ts）・ブロードキャスト（setAllRecursive.ts）の
 * 3 入口が同じ文面で報告する。
 */
export function recursionAnchorMismatchMessage(path: string, recursiveAnchor: string): string {
  return `[wcs/recursion-anchor] "${path}" does not match the declared recursion anchor ` +
    `"${recursiveAnchor}". This version supports exactly one anchor per state, and "**" must be followed ` +
    `by a well-formed suffix (no second "**", no empty segment, no bare "*" right after "**").`;
}

/**
 * `$getAll(path)`（添字省略）の既定値はループ文脈の添字 `[$1..$n]` だが、それを
 * 敷けるのは path と文脈がワイルドカード連鎖を共有している場合だけ。共有ゼロなのに
 * 文脈が添字を持っている場合、黙って全展開に倒すと「文脈で絞られている」という
 * 書き手の期待と食い違い、異なる文脈の添字の流用とも区別が付かないため throw する。
 *
 * 実行時の評価文脈に依存する（`$setAll` の spread 長と同種）ので lint へは誘導しない。
 */
export function getAllContextMismatchMessage(path: string, contextPath: string): string {
  return `$getAll("${path}") was called without indexes inside the loop context of ` +
    `"${contextPath}", but the path shares no wildcard level with that context, ` +
    `so the context indexes ($1..$n) do not apply. ` +
    `Pass indexes explicitly ([] expands every level).`;
}

/**
 * `$setAll(path, indexes, values, { spread: true })` の配列長がマッチ件数と噛み合わない。
 *
 * 静的には件数が分からない（実行時のリスト長に依存する）ので lint へは誘導しない。
 * 黙って切り詰める／余りを捨てると誤配が通ってしまうため throw する
 * （docs/state-set-all-design.md §3-3）。
 */
export function setAllSpreadArityMessage(
  path: string,
  matched: number,
  actual: number,
): string {
  return `$setAll("${path}", …, { spread: true }) requires the values array to have ` +
    `exactly one entry per matched address (matched ${matched}) but got ${actual}. ` +
    `Did the list change between $getAll and $setAll?`;
}

/**
 * `$setAll` の値と `options` の組み合わせが意味を成さない。
 * （docs/state-set-all-design.md §3-1）
 */
export function setAllValueKindMessage(path: string, reason: string): string {
  return `$setAll("${path}") ${reason}`;
}

/**
 * ワイルドカードを解決するループ文脈が足りない（＝パスの階数 > スコープの階数）。
 *
 * `matrix.*.*` を 1 段の `for` の中で読む、`$2` を 1 段のループの中で読む、といった
 * 取り違えがこれ。元の文面は `address.listIndex?.index is undefined path: matrix.*` /
 * `Index not found at position 1 for loopContext:` という内部実装の言葉で、
 * **何を間違えたのかが書かれていなかった**。
 */
export function wildcardScopeMessage(subject: string, needed: number, available: number): string {
  return `[wcs/wildcard-rank] ${subject} needs ${needed} enclosing loop level(s) but the current ` +
    `scope provides ${available}. Wrap it in that many "for" templates, or use $resolve(path, indexes) ` +
    `to name the row explicitly.${LINT_HINT}`;
}

