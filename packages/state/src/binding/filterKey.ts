/**
 * binding/filterKey.ts — フィルタの引数と並びを文字列の鍵にする（**唯一の基準**）。
 *
 * 鍵を作る場所は 2 つあり、規準がずれると必ず取り違えが起きる:
 *  - `core/filterRegistry.ts` の解決済み実関数のキャッシュ
 *  - ハンドラの共有キー（`event/twowayHandler.ts` / `radioHandler.ts` / `checkboxHandler.ts`）、
 *    束縛キー（`bindings/BindingSession.ts`）、devtools の宣言キー（`devtools/declaredBindings.ts`）
 *
 * どちらも `filterArgsKey` を通すことで、規準のずれを構造的に止める。
 */

/**
 * 引数 1 組の鍵。**原文（`args`）と型付きの値（`literals`）の両方**を書き出す。
 *
 * - 原文だけだと `defaults(0)` と `defaults('0')` が同じ `["0"]` になり、型の違う 2 つの
 *   フィルタが同じ実関数・同じハンドラを共有する（要件 B9）。
 * - 型付きの値だけだと `toLiteral` の `Number()` 正規化で `1` / `1.0` / `01` / `+1` が
 *   同じ literal になり、原文を読む工場（`truncate` / `unit` / `join` / `ymd` / `padStart` …）が
 *   別の引数に対して同じ答えを引く。
 */
export function filterArgsKey(args: readonly string[], literals: readonly unknown[]): string {
  return `${JSON.stringify(args)}${JSON.stringify(literals)}`;
}

/** 鍵を作るのに要る最小の形（`IParsedFilter` / `IFilterInfo` と devtools の宣言情報の両方を受ける） */
interface IFilterKeySource {
  readonly filterName: string;
  readonly args: readonly string[];
  readonly literals?: readonly unknown[];
}

/**
 * フィルタの並びの鍵。`handlerByHandlerKey` はモジュール大域なので、ここで区別が付かないと
 * 後から配線された束縛が先の束縛のハンドラ（別のフィルタで畳まれた値を書くもの）を共有する。
 *
 * `literals` は束縛計画の段（`bindings/planFilters.ts`）が落とさずに持ち回している前提。
 * 省略された組み立て（devtools の宣言情報など）は原文で代用する。
 */
export function filterListKey(filters: readonly IFilterKeySource[]): string {
  if (filters.length === 0) {
    return "";
  }
  let key = "";
  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i];
    if (i > 0) key += "|";
    key += `${filter.filterName}(${filterArgsKey(filter.args, filter.literals ?? filter.args)})`;
  }
  return key;
}
