/**
 * core/filterRegistry.ts — フィルタ実関数の登録簿（設計案 §4、要件 D16）。
 *
 * 文法（`path|filter(args)` の解析）は core に残り、**実関数は登録簿から束縛計画の段で引く**。
 * 解析の段は名前と引数しか作らない（`bindTextParser/parseFilters.ts`）ので、パーサだけを使う
 * tooling（`@wcstack/state/parser`）はフィルタの実装を 1 バイトも引き込まない。
 *
 * 書式フィルタ群（`uc` / `date` / `round` …）は `features/formats` が install で登録する。
 * core が自前で持つのは、エンジン自身が差し込む `not` だけ（`if` / `else` の反転 —
 * structural/notFilter.ts）。未知のフィルタは束縛計画の段で名指しで落ちる（従来は解析時）。
 */
import { filterArgsKey } from "../binding/filterKey";
import { didYouMean, LINT_HINT } from "../errorGuidance";
import type { FilterFn, FilterIOType, FilterWithOptions } from "../filters/types";
import { raiseError } from "../raiseError";

/** `options` を受け取って実関数を返す工場（`filters/types.ts` の `FilterWithOptions` の要素） */
export type FilterFactory = (options?: string[], literals?: readonly unknown[]) => FilterFn;

/**
 * エンジン自身が差し込むフィルタ。`if` / `else` の分岐は `not` を付けた束縛として組み立てられる
 * ので、`features/formats` の無いページでも必ず要る。
 *
 * `Map` であることに意味がある: 素のオブジェクトへのブラケット参照だと `Object.prototype` の
 * メンバがフィルタとして通り（`|toString` / `|constructor` / `|valueOf` / `|hasOwnProperty`）、
 * `[wcs/filter-unknown]` の代わりに意味不明な TypeError が出ていた。
 */
const CORE_FILTERS = new Map<string, FilterFactory>([
  ["not", () => (value: unknown): boolean => !value],
]);

/**
 * core が答えるフィルタの引数の個数（要件 B3）。`features/formats` を入れないページでも
 * `|not(1)` が名指しで落ちるように、登録簿とは別にここに持つ。
 */
const CORE_ARITIES = new Map<string, readonly [number, number]>([
  ["not", [0, 0]],
]);

const registries: Record<FilterIOType, Map<string, FilterFactory>> = {
  input: new Map<string, FilterFactory>(),
  output: new Map<string, FilterFactory>(),
};

/** 受け付ける引数の個数 [最少, 最多]。登録した機能が渡したものだけ（要件 B3） */
const aritiesByIOType: Record<FilterIOType, Map<string, readonly [number, number]>> = {
  input: new Map<string, readonly [number, number]>(),
  output: new Map<string, readonly [number, number]>(),
};

/** 旧名 → 正式名（要件 B12）。解決・引数の個数は正式名で引く。登録した機能が渡したものだけ */
const aliasesByIOType: Record<FilterIOType, Map<string, string>> = {
  input: new Map<string, string>(),
  output: new Map<string, string>(),
};

/** 名前 + 引数 + 入出力ごとに解決済みの実関数（解決は 1 回だけ） */
const resolvedByKey = new Map<string, FilterFn>();

/** 機能の install が呼ぶ（冪等 — 同じ名前は置き換え）。hot path には触れない */
export function registerFilters(
  filterIOType: FilterIOType,
  filters: FilterWithOptions,
  arity?: Readonly<Record<string, readonly [number, number]>>,
  aliases?: Readonly<Record<string, string>>,
): void {
  const registry = registries[filterIOType];
  const arities = aritiesByIOType[filterIOType];
  for (const name of Object.keys(filters)) {
    registry.set(name, filters[name] as FilterFactory);
    const bounds = arity?.[name];
    if (typeof bounds === "undefined") {
      arities.delete(name);
    } else {
      arities.set(name, bounds);
    }
  }
  // 旧名も arity と同じ規則で掃除する（追加専用だと、登録簿を入れ替える tooling / テストに
  // 前の登録の旧名が残る）。「今回登録した正式名を指す旧名」だけを対象にするので、別の機能が
  // 登録した旧名は消さない
  const nextAliases = aliases ?? {};
  const aliasMap = aliasesByIOType[filterIOType];
  for (const [alias, canonical] of [...aliasMap]) {
    if (Object.prototype.hasOwnProperty.call(filters, canonical) && nextAliases[alias] !== canonical) {
      aliasMap.delete(alias);
    }
  }
  for (const alias of Object.keys(nextAliases)) {
    aliasMap.set(alias, nextAliases[alias]);
  }
  // 登録が変われば解決済みの答えも変わりうる（同じページで 2 回 install することは無いが、
  // テストと tooling は登録簿を入れ替える）
  resolvedByKey.clear();
}

/** 登録済みの名前（core のものを含む）。診断の did-you-mean が読む */
export function knownFilterNames(filterIOType: FilterIOType): string[] {
  return [...new Set([...CORE_FILTERS.keys(), ...registries[filterIOType].keys()])];
}

/** 解決済みの答えを捨てる（tooling: `@wcstack/state/parser` の clearParserCaches） */
export function clearFilterResolutionCache(): void {
  resolvedByKey.clear();
}

/**
 * 実関数を引く（束縛計画の段）。未知のフィルタはここで落ちる — 解析の段では落とさない。
 * 文言は lint の `wcs/filter-unknown` と同じ語彙・同じ did-you-mean 規準（三面同語彙）。
 */
export function resolveFilterFn(
  filterName: string,
  args: string[],
  filterIOType: FilterIOType,
  literals: readonly unknown[] = args,
): FilterFn {
  // 旧名（`uc` / `fix` …）は正式名で引く — 3.x の間のエイリアス（要件 B12、4.0 で外す）。
  // 鍵も**正式名**で作るので、`uc` と `upper` は同じ実関数を共有する（旧名 1 つにつき
  // クロージャが 1 つ増えていた）
  const canonical = aliasesByIOType[filterIOType].get(filterName) ?? filterName;
  // 引数の鍵は `binding/filterKey.ts` の 1 本に集約する（原文 `args` と型付きの値 `literals` の
  // 両方 — 要件 B3 / B9）。ハンドラ共有キー側と同じ関数を通すことで、規準のずれを構造的に止める
  const key = `${canonical}${filterArgsKey(args, literals)}:${filterIOType}`;
  const resolved = resolvedByKey.get(key);
  if (typeof resolved !== "undefined") {
    return resolved;
  }
  const factory = registries[filterIOType].get(canonical) ?? CORE_FILTERS.get(canonical);
  if (typeof factory === "undefined") {
    // 書式フィルタ（`uc` / `date` …）は `features/formats` が install で登録する。1 つも
    // 登録されていないページは「打ち間違い」ではなく「機能の入れ忘れ」なので、そこまで案内する
    const missingFormats = registries[filterIOType].size === 0
      ? ` No formatting filters are installed — add them with installFeatures([...]) from "@wcstack/state/features/formats".`
      : "";
    raiseError(`[wcs/filter-unknown] filter not found: ${filterName}.${didYouMean(filterName, knownFilterNames(filterIOType))}${missingFormats}${LINT_HINT}`);
  }
  const bounds = aritiesByIOType[filterIOType].get(canonical) ?? CORE_ARITIES.get(canonical);
  if (typeof bounds !== "undefined" && (args.length < bounds[0] || args.length > bounds[1])) {
    // lint の wcs/filter-arity と同じ語彙
    raiseError(args.length < bounds[0]
      ? `[wcs/filter-arity] filter "${filterName}" requires at least ${bounds[0]} argument(s) (${args.length} given).${LINT_HINT}`
      : `[wcs/filter-arity] filter "${filterName}" accepts at most ${bounds[1]} argument(s) (${args.length} given).${LINT_HINT}`);
  }
  const filterFn = factory(args, literals);
  resolvedByKey.set(key, filterFn);
  return filterFn;
}
