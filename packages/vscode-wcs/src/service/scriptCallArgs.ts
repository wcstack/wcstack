/**
 * scriptCallArgs.ts
 *
 * `<wcs-state>` スクリプト内の **ランタイム API 呼び出しの実引数**を、軽量に切り出す部品。
 * `semanticValidator`（`wcs/index-arity` ほか）と `recursionValidator`（`$recursion` /
 * `**`）が同じ切り出し方を共有するために独立させた pure module。
 *
 * 精度方針は既存 validator と同じ **断定できるときだけ返す**。文字列リテラルでない
 * パス・リテラルでない添字配列は `null`（＝判定しない）に倒し、偽陽性を出さない。
 */

/** 実引数の切り出し結果。 */
export interface ICallArgs {
  /** 実引数の生テキスト（トップレベルのカンマで分割済み） */
  readonly args: readonly string[];
  /** 各実引数の開始オフセット（source 内の絶対位置） */
  readonly starts: readonly number[];
  /** 閉じ括弧の次の位置。走査継続に使う */
  readonly end: number;
}

/** 文字列リテラル 1 個ぶん（エスケープ対応）。テンプレートリテラルは対象外。 */
const STRING_LITERAL = /^\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*$/;

/**
 * `open`（`(` の次の位置）から実引数をトップレベルのカンマで切り出す。
 * 括弧・角括弧・波括弧の入れ子と、文字列・テンプレート・正規表現もどきを飛ばす。
 * 閉じ括弧が見つからなければ null（不完全な編集中テキスト）。
 */
export function splitCallArgs(source: string, open: number): ICallArgs | null {
  const args: string[] = [];
  const starts: number[] = [];
  let depth = 0;
  let argStart = open;
  let i = open;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; i++; continue; }
    if (ch === ')' && depth === 0) {
      args.push(source.slice(argStart, i));
      starts.push(argStart);
      return { args, starts, end: i + 1 };
    }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; i++; continue; }
    if (ch === ',' && depth === 0) {
      args.push(source.slice(argStart, i));
      starts.push(argStart);
      argStart = i + 1;
      i++;
      continue;
    }
    i++;
  }
  return null;
}

/** 実引数が単純な文字列リテラルならその中身を返す（それ以外は null＝判定しない）。 */
export function literalString(arg: string): string | null {
  const match = STRING_LITERAL.exec(arg);
  return match === null ? null : match[2];
}

/**
 * 実引数が配列リテラルなら要素数を返す（それ以外・スプレッド混じりは null＝判定しない）。
 * `[]` は 0、末尾カンマは数えない。
 */
export function literalArrayLength(arg: string): number | null {
  const trimmed = arg.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1);
  if (inner.trim().length === 0) return 0;
  // スプレッドは長さが静的に決まらない
  if (/(^|[^.])\.\.\./.test(inner)) return null;
  const parts = splitCallArgs(`${inner})`, 0);
  if (parts === null) return null;
  return parts.args.filter((part) => part.trim().length > 0).length;
}

/**
 * 行コメント / ブロックコメントを同じ長さの空白へ潰す（文字列リテラルは残す）。
 * 文字列の中の `//` をコメント開始と誤認しないよう、文字列も同時に追跡する。
 */
export function blankComments(source: string): string {
  const out = source.split('');
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) { out[i] = ' '; i++; }
      if (i < source.length) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * `this.$<api>(` の呼び出し開始を拾う正規表現を作る（`?.` 経由も拾う）。
 * `g` フラグ付きで `lastIndex` を進めながら使うため、**呼び出しごとに新しい実体**を返す。
 */
export function createApiCallRegex(apis: readonly string[]): RegExp {
  return new RegExp(`\\.\\s*\\$(${apis.join('|')})\\s*\\(`, 'g');
}
