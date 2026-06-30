/**
 * filterMeta.ts — 組み込みフィルタの構造化メタデータ（単一正本・route-a A2-1）。
 *
 * これまで vscode-wcs（completionData.ts BUILTIN_FILTERS）が手で持っていたフィルタの
 * 引数仕様・型・説明を、実装側（@wcstack/state）に**正本として移設**したもの。
 * manifest.ts がこれを公開し、vscode-wcs はそれを消費して手リストを撤去できる。
 *
 * 完全性は __tests__/manifest.test.ts のドリフト検出が保証する
 * （filterMeta のキー集合 == builtinFilters のキー集合）。フィルタを追加して meta を
 * 書き忘れると CI が落ちる。
 */

export type FilterResultType = "boolean" | "number" | "string" | "passthrough";
export type FilterArgType = "number" | "string" | "any";

export interface IFilterMeta {
  /** 説明（補完・ホバー用） */
  description: string;
  /** 引数を取るか */
  hasArgs: boolean;
  /** 適用後の結果型（passthrough は入力型をそのまま返す） */
  resultType: FilterResultType;
  /** 受け入れ可能な入力型（'any' は任意） */
  acceptTypes: "any" | readonly string[];
  /** 引数の最小数 */
  minArgs: number;
  /** 引数の最大数 */
  maxArgs: number;
  /** 各引数の期待型（省略時はチェックしない） */
  argTypes?: readonly FilterArgType[];
}

/** 組み込みフィルタ名 → 構造化メタデータ。キー集合は builtinFilters と一致しなければならない。 */
export const builtinFilterMeta: Record<string, IFilterMeta> = {
  // 比較・論理
  eq:  { description: "等しいか比較",   hasArgs: true,  resultType: "boolean", acceptTypes: "any",                minArgs: 1, maxArgs: 1, argTypes: ["any"] },
  ne:  { description: "異なるか比較",   hasArgs: true,  resultType: "boolean", acceptTypes: "any",                minArgs: 1, maxArgs: 1, argTypes: ["any"] },
  not: { description: "ブール値を反転", hasArgs: false, resultType: "boolean", acceptTypes: ["boolean"],          minArgs: 0, maxArgs: 0 },
  lt:  { description: "より小さいか",   hasArgs: true,  resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  le:  { description: "以下か",         hasArgs: true,  resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  gt:  { description: "より大きいか",   hasArgs: true,  resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  ge:  { description: "以上か",         hasArgs: true,  resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  // 算術
  inc: { description: "加算", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  dec: { description: "減算", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  mul: { description: "乗算", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  div: { description: "除算", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  mod: { description: "剰余", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  // 数値フォーマット
  fix:     { description: "固定小数点表記",                 hasArgs: true, resultType: "string", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  locale:  { description: "ロケール形式で数値フォーマット", hasArgs: true, resultType: "string", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["string"] },
  // 文字列
  uc:     { description: "大文字に変換",             hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  lc:     { description: "小文字に変換",             hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  cap:    { description: "先頭文字を大文字に",       hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  trim:   { description: "前後の空白を削除",         hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  slice:  { description: "部分文字列 (start[,end])", hasArgs: true,  resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "number"] },
  substr: { description: "部分文字列 (pos,len)",     hasArgs: true,  resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "number"] },
  pad:    { description: "パディング (length[,char])", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "string"] },
  rep:    { description: "繰り返し (count)",         hasArgs: true,  resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  rev:    { description: "文字順を反転",             hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  // 数値パース・丸め
  int:     { description: "整数にパース",         hasArgs: false, resultType: "number", acceptTypes: ["string", "number"], minArgs: 0, maxArgs: 0 },
  float:   { description: "浮動小数点数にパース", hasArgs: false, resultType: "number", acceptTypes: ["string", "number"], minArgs: 0, maxArgs: 0 },
  round:   { description: "四捨五入",             hasArgs: true,  resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  floor:   { description: "切り下げ",             hasArgs: true,  resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  ceil:    { description: "切り上げ",             hasArgs: true,  resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  percent: { description: "パーセンテージ形式",   hasArgs: true,  resultType: "string", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  // 日付・時刻
  date:     { description: "ロケール形式の日付", hasArgs: false, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  time:     { description: "ロケール形式の時刻", hasArgs: false, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  datetime: { description: "ロケール形式の日時", hasArgs: false, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  ymd:      { description: "YYYY-MM-DD 形式",   hasArgs: true,  resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 1, argTypes: ["string"] },
  // 真偽値・変換
  falsy:    { description: "偽値か判定",             hasArgs: false, resultType: "boolean",     acceptTypes: "any",      minArgs: 0, maxArgs: 0 },
  truthy:   { description: "真値か判定",             hasArgs: false, resultType: "boolean",     acceptTypes: "any",      minArgs: 0, maxArgs: 0 },
  defaults: { description: "偽値の場合デフォルト値", hasArgs: true,  resultType: "passthrough", acceptTypes: "any",      minArgs: 1, maxArgs: 1, argTypes: ["any"] },
  boolean:  { description: "ブール値に変換",         hasArgs: false, resultType: "boolean",     acceptTypes: "any",      minArgs: 0, maxArgs: 0 },
  number:   { description: "数値に変換",             hasArgs: false, resultType: "number",      acceptTypes: "any",      minArgs: 0, maxArgs: 0 },
  string:   { description: "文字列に変換",           hasArgs: false, resultType: "string",      acceptTypes: "any",      minArgs: 0, maxArgs: 0 },
  null:     { description: "空文字列をnullに変換",   hasArgs: false, resultType: "passthrough", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
};
