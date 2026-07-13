/**
 * core/formatValue.ts
 *
 * 値フォーマッタ（devtools-tag-design.md §6）。
 *
 * 規範:
 * - primitive はそのまま（文字列は引用 + 80 文字上限）
 * - 配列 / plain object は深さ制限 + 要素数制限つきの要約
 * - それ以外（MediaStream, Blob, Element, class インスタンス等）は
 *   `[[ClassName]]` タグ表示のみ
 * - structuredClone / JSON.stringify を全値に無差別適用しない
 *   （生ハンドル・循環・巨大値対策。camera G1 との共存）
 */

const MAX_STRING = 80;
const MAX_ITEMS = 3;

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function className(value: object): string {
  const ctor = (value as { constructor?: { name?: string } }).constructor;
  const name = ctor?.name;
  return typeof name === "string" && name.length > 0 ? name : "Object";
}

/**
 * 任意の値を表示用の短い文字列へ変換する。
 * @param value 対象値
 * @param depth 再帰許容深さ（既定 2。0 で複合値は要約タグのみ）
 */
export function formatValue(value: unknown, depth: number = 2): string {
  switch (typeof value) {
    case "string": {
      const body = value.length > MAX_STRING ? value.slice(0, MAX_STRING) + "…" : value;
      return `"${body}"`;
    }
    case "number":
    case "boolean":
    case "bigint":
      return String(value);
    case "symbol":
      return value.toString();
    case "undefined":
      return "undefined";
    case "function":
      return "[[Function]]";
    default:
      break;
  }
  if (value === null) {
    return "null";
  }
  const objectValue = value as object;
  if (Array.isArray(objectValue)) {
    if (depth <= 0) {
      return `[[Array(${objectValue.length})]]`;
    }
    const shown = objectValue.slice(0, MAX_ITEMS).map((item) => formatValue(item, depth - 1));
    const rest = objectValue.length > MAX_ITEMS ? `, …(${objectValue.length})` : "";
    return `[${shown.join(", ")}${rest}]`;
  }
  if (isPlainObject(objectValue)) {
    if (depth <= 0) {
      return "[[Object]]";
    }
    const keys = Object.keys(objectValue);
    const shown = keys.slice(0, MAX_ITEMS).map(
      (key) => `${key}: ${formatValue((objectValue as Record<string, unknown>)[key], depth - 1)}`
    );
    const rest = keys.length > MAX_ITEMS ? `, …(${keys.length})` : "";
    return `{${shown.join(", ")}${rest}}`;
  }
  // DOM ノード・生ハンドル・class インスタンス等はタグ表示のみ
  return `[[${className(objectValue)}]]`;
}

/**
 * token 引数の要約（先頭 3 引数 × 各 80 文字上限、devtools-tag-design.md §6）。
 */
export function formatArgs(args: readonly unknown[]): string {
  if (args.length === 0) {
    return "";
  }
  const shown = args.slice(0, MAX_ITEMS).map((arg) => {
    const text = formatValue(arg, 1);
    return text.length > MAX_STRING ? text.slice(0, MAX_STRING) + "…" : text;
  });
  const rest = args.length > MAX_ITEMS ? `, …(${args.length})` : "";
  return `${shown.join(", ")}${rest}`;
}
