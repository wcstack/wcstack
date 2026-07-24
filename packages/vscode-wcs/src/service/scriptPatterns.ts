/**
 * scriptPatterns.ts
 *
 * <wcs-state> スクリプト検査系 validator（arrayMutationValidator /
 * nestedAssignValidator）が共有する正規表現部品とパス表記変換。
 * 規範: docs/array-mutation-diagnostic-design.md §5。
 *
 * 方針: 識別子は `$` を含む ASCII（`\w` ベース。Unicode 識別子は族共通の
 * 既知限界）。トークン間の空白・改行と optional chaining（`?.` / `?.[`）を
 * 許容する。添字は quoted string 始まり以外の任意の式（ネスト bracket なし、
 * `[this.items.length]` 等の append イディオムを含む）。
 */

/** 識別子（`$` 含む）。ルートの `$` 始まりは呼び出し側で API 名前空間としてスキップする。 */
export const ID = String.raw`[\w$]+`;

/** 添字 1 個: `[0]` / `[i]` / `[this.items.length]` / `?.[i]`。quoted キーは対象外。 */
export const SUB = String.raw`\s*(?:\?\.)?\s*\[(?!\s*["'])[^\[\]]+\]`;

/** ドットセグメント 1 個: `.name` / `?.name`（空白・改行許容）。 */
export const DOT_SEG = String.raw`\s*\??\.\s*${ID}`;

/** 任意チェーン（ドット・添字の混在、0 個以上）。 */
export const CHAIN = String.raw`(?:${DOT_SEG}|${SUB})*`;

/** 添字のみのチェーン（1 個以上）— array-index-assign の対象形。 */
export const BRACKETS_ONLY = String.raw`(?:${SUB})+`;

/** ドット・添字混在チェーン（1 個以上）— nested-assign の対象形（要ドットセグメント判定）。 */
export const CHAIN_ONE_PLUS = String.raw`(?:${DOT_SEG}|${SUB})+`;

/** ドットルート: `this.items`（ルート識別子をキャプチャ）。 */
export const ROOT_DOT = String.raw`\bthis\s*\??\.\s*(${ID})`;

/** bracket ルート: `this["items"]` / `this["items.*.tags"]`（quoted パスをキャプチャ）。 */
export const ROOT_BRACKET = String.raw`\bthis\s*(?:\?\.)?\s*\[\s*["']([^"']+)["']\s*\]`;

/**
 * 代入演算子の tail: 単純 `=`（`==` は lookahead で除外）・複合代入
 * （`+=` `-=` `**=` `<<=` `>>=` `>>>=` `&=` `|=` `^=` `&&=` `||=` `??=`）・
 * 後置 `++` / `--`。`>=` / `<=` / `!=` / `!==` / `===` は演算子部が
 * どの選択肢にも一致しないため誤検出しない。マッチは演算子末尾で終わる
 * （右辺は含まない）。
 */
export const ASSIGN_TAIL = String.raw`\s*(?:(?:\*\*|<<|>>>|>>|&&|\|\||\?\?|[+\-*/%&|^])?=(?!=)|\+\+|--)`;

/** 前置インクリメント/デクリメント: `++this.items[0]` の先頭部。 */
export const PRE_INCDEC = String.raw`(?:\+\+|--)\s*`;

/**
 * チェーン部分（`.foo` / `?.foo` / `[0]` / `[expr]` の連なり）をドットパス表記へ
 * 変換する。数値添字はそのままセグメントに、識別子・式の添字は動的添字として
 * `<...>` で表す（例: `[i]` → `.<i>`、`[this.items.length]` → `.<this.items.length>`）。
 */
export function chainToDotted(chain: string): string {
  const token = new RegExp(String.raw`\s*(?:\??\.\s*(${ID})|(?:\?\.)?\s*\[([^\[\]]+)\])`, 'g');
  let out = '';
  let match: RegExpExecArray | null;
  while ((match = token.exec(chain)) !== null) {
    if (match[1] !== undefined) {
      out += `.${match[1]}`;
    } else {
      const key = match[2].trim();
      out += /^\d+$/.test(key) ? `.${key}` : `.<${key}>`;
    }
  }
  return out;
}

/**
 * チェーンに（添字の式内部を除いた）ドットセグメントが含まれるか。
 * nested-assign（ドット含みチェーン担当）と array-index-assign
 * （bracket-only チェーン担当）の相補境界の判定に使う。
 */
export function hasDotSegment(chain: string): boolean {
  return /[.]/.test(chain.replace(/\s*(?:\?\.)?\s*\[[^\[\]]+\]/g, ''));
}

/** ルートが `$` 始まり（$streams / $getAll 等の API 名前空間）なら検出対象外。 */
export function isApiRoot(root: string): boolean {
  return root.startsWith('$');
}
