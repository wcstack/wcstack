/**
 * diagnostics/pathChecks.ts — バインド / `$watch` / `$scan` 対象パスの存在検査
 * （@wcstack/state/features/diagnostics。silent failure の可視化）。
 *
 * なぜ必要か:
 * `getByAddress` は「親が null / undefined のパスの読み」を undefined で返し、
 * undefined はプロパティ書き込みがスキップされる値なので、`user.nmae` のような
 * 打ち間違いは**エラーも警告も出さずに DOM が更新されない**だけになる。一方で
 * トップレベルの打ち間違い（`cout`）は parentAddress を辿れず raiseError で落ちる。
 * 同じ「パスを打ち間違えた」という 1 つの失敗が、パスの深さで silent / loud に
 * 割れており、書き手からは区別がつかない。ここはその silent 側を埋める。
 *
 * 開発時の診断なので機能として分けてある（full / auto は入れる。`@wcstack/state/core` だけの
 * ページは入れなければ警告を出さない — 本番向けの軽量形）。core の受け口は
 * core/diagnosticsHooks.ts。
 *
 * 精度方針（過小近似）:
 * 「確実に存在しない」と言い切れる場合にだけ報告する。getter の戻り値の先・
 * 空配列・null 親・mapped な `bind-component` など、静的に決められない形はすべて
 * `"unknown"` に倒して黙る（偽陽性ゼロ優先。docs/static-wiring-dx-design.md D7 /
 * [ADR-06](../../../docs/architecture-hardening/06-path-type-safety.md) の精度哲学）。
 */

import { getPathInfo } from "../address/PathInfo";
import type { IStateElement } from "../components/types";
import { DELIMITER, WILDCARD } from "../define";
import { devtoolsSink } from "../platform/devtoolsSink";
import { didYouMean, LINT_HINT } from "../errorGuidance";
import { collectCandidates, DIAGNOSTIC_CODE, findDescriptor, PathInfoSource, SUBJECT } from "../pathDiagnostics";

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

/** 同じ (state 要素, パス) の報告は 1 回だけにする台帳 */
const reportedPathsByStateElement: WeakMap<IStateElement, Set<string>> = new WeakMap();

/** テスト間の分離用（本番経路からは呼ばれない） */
export function clearReportedPaths(stateElement: IStateElement): void {
  reportedPathsByStateElement.delete(stateElement);
}

/**
 * state の世代が進んだ（再セット）ときに、この要素の検査済みの印と遅延中の報告を捨てる（#270）。
 *
 * 「パスごとに 1 回」は同じ誤りを更新のたびに報告し続けないための台帳で、世代をまたいで
 * 持ち越す理由は無い。持ち越すと、第 1 世代で検査済みのパスが第 2 世代の state から消えても
 * 無言のままになる。遅延中の報告は前の世代の state で判定した結果なので、あわせて捨てる
 * （呼び手の経路情報の作り直しが、新しい世代で判定し直して積み直す）。公開 getter の登録
 * （`markExportedPath`）はマウント記録の寿命に属するので触らない。
 */
export function resetPathDiagnostics(stateElement: IStateElement): void {
  reportedPathsByStateElement.delete(stateElement);
  deferredReportsByStateElement.delete(stateElement);
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
  // 機能が黙らせる領域（予約済みボリュームスロットの配下 — D22。webComponent/addressHooks.ts）は
  // suppressPathDiagnostic hook に聞く。hook の無い state は判定 1 個で抜ける
  const hooks = stateElement.addressHooks;
  if (hooks) {
    const suppress = hooks.suppressPathDiagnostic;
    for (let i = 0; i < suppress.length; i++) {
      if (suppress[i](stateElement, path)) {
        return;
      }
    }
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
  // 再帰 getter の展開形は、バインド確立の時点ではまだ生えていない（読む直前に
  // 遅延実体化する — recursion/registry.ts）。素の存在検査では必ず「解決できない」に
  // なるので、宣言済みの `**` getter に合致するかを先に見る。実体化はしない。
  // 展開形の**値の内側**（`nodes.*.stats.count` で `get "nodes.**.stats"()` がオブジェクトを
  // 返す形）も同じ — 通常の getter なら下の「途中のプレフィックスがフラット宣言」で
  // UNKNOWN に倒れるところ、未実体化のアクセサは findDescriptor に見えないのでここで畳む。
  if (stateElement.hasRecursion === true && stateElement.recursionRegistry!.recursiveGetterOwning(path) !== null) {
    return;
  }
  const result = resolvePathExistence(state, path, stateElement.getterPaths);
  if (result.existence !== "missing") {
    return;
  }
  if (isExportedPath(stateElement, path)) {
    return;
  }
  if (source === "binding") {
    // 遅延報告（docs/state-overlay-export-design.md X7）: バインド確立時点では、その位置に
    // マウントされるコンポーネントの getter（公開 getter）がまだ登録されていない。
    // 1 マクロタスク待って、登録で解消しなかったものだけを報告する
    deferReport(stateElement, path, result);
    return;
  }
  reportMissing(stateElement, path, source, result);
}

interface IMissingResult {
  readonly missingSegment: string;
  readonly candidates: readonly string[];
}

const deferredReportsByStateElement = new WeakMap<IStateElement, Map<string, IMissingResult>>();
const flushScheduled = new WeakSet<IStateElement>();
const exportedPathsByStateElement = new WeakMap<IStateElement, Set<string>>();

/** 公開 getter の登録（webComponent/exportIndex.ts）— このパスは「存在しない」ではない */
export function markExportedPath(stateElement: IStateElement, path: string): void {
  let paths = exportedPathsByStateElement.get(stateElement);
  if (typeof paths === "undefined") {
    paths = new Set<string>();
    exportedPathsByStateElement.set(stateElement, paths);
  }
  paths.add(path);
  deferredReportsByStateElement.get(stateElement)?.delete(path);
}

function isExportedPath(stateElement: IStateElement, path: string): boolean {
  return exportedPathsByStateElement.get(stateElement)?.has(path) === true;
}

function deferReport(stateElement: IStateElement, path: string, result: IMissingResult): void {
  let pending = deferredReportsByStateElement.get(stateElement);
  if (typeof pending === "undefined") {
    pending = new Map();
    deferredReportsByStateElement.set(stateElement, pending);
  }
  pending.set(path, result);
  if (flushScheduled.has(stateElement)) {
    return;
  }
  flushScheduled.add(stateElement);
  setTimeout(() => flushDeferredPathReports(stateElement), 0);
}

/** 遅延中の報告を今すぐ流す（タイマー到達時・テスト用） */
export function flushDeferredPathReports(stateElement: IStateElement): void {
  flushScheduled.delete(stateElement);
  const pending = deferredReportsByStateElement.get(stateElement);
  if (typeof pending === "undefined") {
    return;
  }
  deferredReportsByStateElement.delete(stateElement);
  // 登録で解消したものは markExportedPath が pending から消している
  for (const [path, result] of pending) {
    reportMissing(stateElement, path, "binding", result);
  }
}

function reportMissing(
  stateElement: IStateElement,
  path: string,
  source: PathInfoSource & ("binding" | "watch" | "scan"),
  result: IMissingResult,
): void {
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
