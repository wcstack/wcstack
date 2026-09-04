/**
 * pathDiagnostics.ts — バインド / `$watch` 対象パスの存在検査（silent failure の可視化）。
 *
 * なぜ必要か:
 * `getByAddress` は「親が null / undefined のパスの読み」を undefined で返し、
 * undefined はプロパティ書き込みがスキップされる値なので、`user.nmae` のような
 * 打ち間違いは**エラーも警告も出さずに DOM が更新されない**だけになる。一方で
 * トップレベルの打ち間違い（`cout`）は parentAddress を辿れず raiseError で落ちる。
 * 同じ「パスを打ち間違えた」という 1 つの失敗が、パスの深さで silent / loud に
 * 割れており、書き手からは区別がつかない。ここはその silent 側を埋める。
 *
 * 精度方針（過小近似）:
 * 「確実に存在しない」と言い切れる場合にだけ報告する。getter の戻り値の先・
 * 空配列・null 親・mapped な `bind-component` など、静的に決められない形はすべて
 * `"unknown"` に倒して黙る（偽陽性ゼロ優先。docs/static-wiring-dx-design.md D7 /
 * [ADR-06](../../docs/architecture-hardening/06-path-type-safety.md) の精度哲学）。
 *
 * 診断 code はコンソール → lint → IDE の三面で共有する（errorGuidance.ts の規約）。
 */

import { getPathInfo } from "./address/PathInfo";
import { isPathUnderReservedVolume } from "./webComponent/volumeShared";
import type { IStateElement } from "./components/types";
import { DELIMITER, WILDCARD } from "./define";
import { devtoolsSink } from "./devtools/sink";
import { didYouMean, LINT_HINT } from "./errorGuidance";

/** `setPathInfo` の呼び出し元の種別。診断 code と適用範囲がこれで変わる */
export type PathInfoSource =
  /** data-wcs / mustache / コメントバインディング */
  | "binding"
  /** `$watch` の宣言キー */
  | "watch"
  /** ランタイム内部のパス翻訳（mapped な bind-component の外向き伝播）。検査しない */
  | "internal";

export type PathExistence = "exists" | "missing" | "unknown";

export interface IPathExistenceResult {
  readonly existence: PathExistence;
  /** `"missing"` のとき、解決に失敗したセグメント */
  readonly missingSegment: string;
  /** `"missing"` のとき、その階層に実在する兄弟キー（did-you-mean 用） */
  readonly candidates: readonly string[];
}

const UNKNOWN: IPathExistenceResult = Object.freeze({
  existence: "unknown" as const,
  missingSegment: "",
  candidates: Object.freeze([]) as readonly string[],
});

const EXISTS: IPathExistenceResult = Object.freeze({
  existence: "exists" as const,
  missingSegment: "",
  candidates: Object.freeze([]) as readonly string[],
});

/**
 * `obj` 自身＋プロトタイプチェーン（Object.prototype 手前まで）から descriptor を引く。
 * 打ち切り位置は getAllPropertyDescriptors と同じ — 「state が宣言したもの」だけを
 * 存在とみなし、`toString` 等の Object.prototype 由来を存在扱いしない。
 */
function findDescriptor(obj: object, key: string): PropertyDescriptor | undefined {
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
function collectCandidates(
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

/**
 * `target` に対して `path` が解決しうるかを、値を読まずに（getter を評価せずに）判定する。
 *
 * 解決の順序は `getByAddress` の実装に合わせる: まず「パス文字列そのものがキーか」
 * （ドットパス getter がこれ）、次にセグメントを 1 つずつ降りる。
 */
export function resolvePathExistence(
  target: object,
  path: string,
  declaredPaths: Iterable<string>,
): IPathExistenceResult {
  // ドットパス getter / フラットキーの完全一致（`get "users.*.fullName"()` 等）
  if (findDescriptor(target, path) !== undefined) {
    return EXISTS;
  }
  const segments = getPathInfo(path).segments;
  let current: unknown = target;
  let prefix = "";
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const parentPrefix = prefix;
    prefix = i === 0 ? segment : prefix + DELIMITER + segment;
    // 途中のプレフィックスがフラット宣言されている（`cart.totalPrice` が getter で、
    // その戻り値のサブプロパティを読む形）。戻り値の形は評価しないと分からない
    if (i > 0 && i < segments.length - 1 && findDescriptor(target, prefix) !== undefined) {
      return UNKNOWN;
    }
    // null / undefined / primitive より深い読みは実行時 undefined 解決 = 判定不能。
    // 「初期値 null のオブジェクトに後から代入する」形を偽陽性で潰さないため
    if (Object(current) !== current) {
      return UNKNOWN;
    }
    if (segment === WILDCARD) {
      // 行の形は「いま入っている要素」からしか分からない。空配列・非配列は判定不能
      if (!Array.isArray(current) || current.length === 0) {
        return UNKNOWN;
      }
      current = current[0];
      continue;
    }
    const descriptor = findDescriptor(current as object, segment);
    if (typeof descriptor === "undefined") {
      return {
        existence: "missing",
        missingSegment: segment,
        candidates: collectCandidates(current as object, parentPrefix, declaredPaths),
      };
    }
    if (typeof descriptor.get === "function") {
      // getter の戻り値の先は評価しないと分からない（末尾なら存在は確定）
      return i === segments.length - 1 ? EXISTS : UNKNOWN;
    }
    current = descriptor.value;
  }
  return EXISTS;
}

/** 診断 code は lint / IDE と同一語彙（errorGuidance.ts の三面共有規約） */
const DIAGNOSTIC_CODE: Readonly<Record<"binding" | "watch", string>> = {
  binding: "wcs/binding-path-missing",
  watch: "wcs/watch-path-missing",
};

const SUBJECT: Readonly<Record<"binding" | "watch", string>> = {
  binding: "Bound path",
  watch: "$watch path",
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

/** 同じ (state 要素, パス) の報告は 1 回だけにする台帳 */
const reportedPathsByStateElement: WeakMap<IStateElement, Set<string>> = new WeakMap();

/** テスト間の分離用（本番経路からは呼ばれない） */
export function clearReportedPaths(stateElement: IStateElement): void {
  reportedPathsByStateElement.delete(stateElement);
}

function alreadyReported(stateElement: IStateElement, path: string): boolean {
  let reported = reportedPathsByStateElement.get(stateElement);
  if (typeof reported === "undefined") {
    reported = new Set<string>();
    reportedPathsByStateElement.set(stateElement, reported);
  }
  if (reported.has(path)) {
    return true;
  }
  reported.add(path);
  return false;
}

/**
 * バインド確立時 / `$watch` 宣言時にパスの存在を検査し、確実に存在しないものだけ報告する。
 *
 * 報告は `console.warn` に留める（`raiseError` にしない）:
 * 判定は過小近似とはいえ動的にキーが生える形まで排除できたわけではなく、
 * 既存ページを起動不能にする代償に見合わない。silent を破ることが目的であり、
 * 停止させることではない。
 */
export function checkDeclaredPath(
  stateElement: IStateElement,
  state: object | undefined,
  path: string,
  source: PathInfoSource,
): void {
  if (source === "internal" || typeof state === "undefined") {
    return;
  }
  // `$command` / `$streamStatus` / `$1` 等の予約名前空間は raw state に実体を持たない
  if (path.startsWith("$")) {
    return;
  }
  // マウントの予約セグメント（`users.*.#m1.editing` — D20）はオーバーレイに実体があり
  // raw state には無い。`#else`（構造プレースホルダ）も同様（webComponent/mount.ts）
  if (path.indexOf("#") !== -1) {
    return;
  }
  // 予約済みのボリュームスロット配下はロード完了まで undefined が正（D22）
  if (isPathUnderReservedVolume((stateElement as { rootNode?: Node }).rootNode ?? null, path)) {
    return;
  }

  // 単一セグメントのバインディングは読み取り時に raiseError で loud に落ちるので、
  // ここで二重に報告しない。`$watch` は落ちずに黙って発火しないだけなので検査する
  const segments = getPathInfo(path).segments;
  if (source === "binding" && segments.length < 2) {
    return;
  }
  if (alreadyReported(stateElement, path)) {
    return;
  }
  const result = resolvePathExistence(state, path, stateElement.getterPaths);
  if (result.existence !== "missing") {
    return;
  }
  // 接頭辞は raiseError と同じ `[@wcstack/state] [wcs/...]` の並び（コンソールの
  // grep 単位をパッケージで揃える）
  console.warn(
    `[@wcstack/state] [${DIAGNOSTIC_CODE[source]}] ${SUBJECT[source]} "${path}" does not resolve on the state tree: ` +
    `"${result.missingSegment}" is not declared.${didYouMean(result.missingSegment, result.candidates)}` +
    ` Updates to this path will be silently dropped.${LINT_HINT}`,
  );
  if (devtoolsSink !== null) {
    devtoolsSink({
      type: "state:path-unresolved",
      source,
      path,
      missingSegment: result.missingSegment,
    });
  }
}
