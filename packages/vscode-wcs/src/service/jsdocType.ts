/**
 * jsdocType.ts
 *
 * state スクリプトの JSDoc `@type` / `@typedef` の型表現を読む。
 *
 * 目的は**形**を知ること: `fetch` や `<wcs-storage>` から届くリストは初期値が `null` / `[]` で、
 * 行のフィールドが値からは読めない。`/** @type {{ id: number, name: string }[] | null} *\/` や
 * `@typedef` で名前を付けた型を書けば、その行の形（`catalog.*.id`）と型ヒントを候補に載せられる。
 *
 * 読むのは TypeScript / Closure の JSDoc 型の部分集合:
 *   - 名前（`string` / `number` / `boolean` / `null` / `undefined` / `object` / `any` / 任意の識別子・`a.B`）
 *   - オブジェクト型 `{ id: number, name?: string }`（区切りは `,` / `;`、キーは識別子か引用符付き）
 *   - 配列 `T[]` / `Array<T>` / `Array.<T>` / `ReadonlyArray<T>`
 *   - 合併 `A | B`、括弧 `(A | B)[]`、`?T`（`T | null`）、`!T`（`T`）
 *   - 交差 `A & B` — 形を知るためには合併と同じに読む（オブジェクトの構成員のフィールドを合わせる）。
 *     getter の `@returns {(Ticket & { messages: Message[] }) | null}` の形（docs/seam-apps.md、shift-desk）
 * それ以外（関数型・リテラル型・`Record<…>` などの総称）は `unknown` に畳み、形を作らない。
 * 読めない表現は全体を null にする — 推測で形を作らない（偽の候補で本物の誤りを隠さないため）。
 *
 * pure（DOM / vscode 非依存）。
 */

export type JsDocType =
  | { readonly kind: 'name'; readonly name: string }
  | { readonly kind: 'object'; readonly fields: readonly JsDocField[] }
  | { readonly kind: 'array'; readonly element: JsDocType }
  | { readonly kind: 'union'; readonly members: readonly JsDocType[] }
  | { readonly kind: 'unknown' };

export interface JsDocField {
  readonly name: string;
  readonly type: JsDocType;
}

/** `@typedef` で付けた名前 → 型。 */
export type JsDocTypedefs = ReadonlyMap<string, JsDocType>;

const UNKNOWN: JsDocType = { kind: 'unknown' };
const NULL_TYPE: JsDocType = { kind: 'name', name: 'null' };
const ARRAY_GENERICS = new Set(['Array', 'ReadonlyArray']);
/** 名前の解決（`@typedef` の連鎖）の深さの上限。自己参照で回り続けないため。 */
const MAX_RESOLVE_DEPTH = 8;

// ============================================================
// 型表現のパース
// ============================================================

type Token =
  | { readonly t: 'name'; readonly v: string }
  | { readonly t: 'string'; readonly v: string }
  | { readonly t: 'number' }
  | { readonly t: 'punct'; readonly v: string };

function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    // `=>` は関数型 — 形を持たない。トークン化だけ通し、パーサが unknown に畳む
    if (ch === '=' && text[i + 1] === '>') { tokens.push({ t: 'punct', v: '=>' }); i += 2; continue; }
    if ('{}[]<>()|&,;:?!*.='.includes(ch)) { tokens.push({ t: 'punct', v: ch }); i++; continue; }
    if (ch === '"' || ch === "'") {
      const end = text.indexOf(ch, i + 1);
      if (end === -1) return null;
      tokens.push({ t: 'string', v: text.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const num = /^-?\d+(?:\.\d+)?/.exec(text.slice(i));
    if (num) { tokens.push({ t: 'number' }); i += num[0].length; continue; }
    const name = /^[$A-Za-z_][$\w]*/.exec(text.slice(i));
    if (name) { tokens.push({ t: 'name', v: name[0] }); i += name[0].length; continue; }
    return null;
  }
  return tokens;
}

/**
 * JSDoc の型表現（`@type {…}` の波括弧の中身）をパースする。読めなければ null。
 */
export function parseJsDocType(text: string): JsDocType | null {
  const tokens = tokenize(text);
  if (tokens === null || tokens.length === 0) return null;
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const isPunct = (v: string): boolean => {
    const token = tokens[pos];
    return token !== undefined && token.t === 'punct' && token.v === v;
  };
  const expect = (v: string): boolean => {
    if (!isPunct(v)) return false;
    pos++;
    return true;
  };

  const parseUnion = (): JsDocType | null => {
    expect('|'); // 先頭の `|`（`| A | B`）を許す
    const members: JsDocType[] = [];
    for (;;) {
      const member = parsePostfix();
      if (member === null) return null;
      members.push(member);
      // `A & B`: the parts join the members (their fields are merged like a union's)
      if (expect('&')) continue;
      if (!expect('|')) break;
    }
    // 関数型 `(a: T) => U` の `=>` 以降は形を持たない
    if (isPunct('=>')) {
      pos++;
      if (parseUnion() === null) return null;
      return UNKNOWN;
    }
    return members.length === 1 ? members[0] : { kind: 'union', members };
  };

  const parsePostfix = (): JsDocType | null => {
    let type = parsePrimary();
    if (type === null) return null;
    while (isPunct('[') && tokens[pos + 1]?.t === 'punct' && (tokens[pos + 1] as { v: string }).v === ']') {
      pos += 2;
      type = { kind: 'array', element: type };
    }
    return type;
  };

  const parsePrimary = (): JsDocType | null => {
    const token = peek();
    if (token === undefined) return null;
    if (token.t === 'string' || token.t === 'number') { pos++; return UNKNOWN; }
    if (token.t === 'punct') {
      if (token.v === '{') return parseObject();
      if (token.v === '(') {
        pos++;
        // `()` は引数の無い関数型の頭
        if (expect(')')) return isPunct('=>') ? UNKNOWN : null;
        const inner = parseUnion();
        if (inner === null) return null;
        // `(a: T, b: U) => V` の引数列は形を持たない — 閉じ括弧まで読み飛ばす
        if (isPunct(':') || isPunct(',')) {
          if (!skipUntilClose('(', ')')) return null;
          return UNKNOWN;
        }
        return expect(')') ? inner : null;
      }
      if (token.v === '?') {
        pos++;
        // 単独の `?`（Closure の任意型）
        const next = peek();
        if (next === undefined || (next.t === 'punct' && ['|', ',', ';', ')', '>', ']', '}', '='].includes(next.v))) return UNKNOWN;
        const inner = parsePostfix();
        return inner === null ? null : { kind: 'union', members: [inner, NULL_TYPE] };
      }
      if (token.v === '!') { pos++; return parsePostfix(); }
      if (token.v === '*') { pos++; return UNKNOWN; }
      return null;
    }
    // 名前（`a.B` の連結を含む）
    pos++;
    let name = token.v;
    while (isPunct('.') && tokens[pos + 1]?.t === 'name') {
      name += '.' + (tokens[pos + 1] as { v: string }).v;
      pos += 2;
    }
    // `typeof x` / `keyof T` は形を持たない
    if ((name === 'typeof' || name === 'keyof') && peek()?.t === 'name') {
      pos++;
      return UNKNOWN;
    }
    // `function(…)` は Closure の関数型
    if (name === 'function' && isPunct('(')) {
      pos++;
      if (!skipUntilClose('(', ')')) return null;
      if (expect(':')) { if (parsePostfix() === null) return null; }
      return UNKNOWN;
    }
    // 総称 `Array<T>` / `Array.<T>`
    if (isPunct('.') && tokens[pos + 1]?.t === 'punct' && (tokens[pos + 1] as { v: string }).v === '<') pos++;
    if (isPunct('<')) {
      pos++;
      const args: JsDocType[] = [];
      for (;;) {
        const arg = parseUnion();
        if (arg === null) return null;
        args.push(arg);
        if (!expect(',')) break;
      }
      if (!expect('>')) return null;
      return ARRAY_GENERICS.has(name) && args.length === 1 ? { kind: 'array', element: args[0] } : UNKNOWN;
    }
    return { kind: 'name', name };
  };

  const parseObject = (): JsDocType | null => {
    pos++; // `{`
    const fields: JsDocField[] = [];
    while (!isPunct('}')) {
      const key = peek();
      if (key === undefined) return null;
      // 索引シグネチャ `[key: string]: T` は形を持たない（任意のキー）
      if (key.t === 'punct' && key.v === '[') {
        pos++;
        if (!skipUntilClose('[', ']')) return null;
        if (!expect(':') || parseUnion() === null) return null;
      } else {
        if (key.t !== 'name' && key.t !== 'string') return null;
        pos++;
        expect('?');
        if (!expect(':')) return null;
        const type = parseUnion();
        if (type === null) return null;
        fields.push({ name: key.v, type });
      }
      if (!expect(',') && !expect(';')) break;
    }
    return expect('}') ? { kind: 'object', fields } : null;
  };

  /** 開き括弧（現在位置）から、対応する閉じ括弧の直後まで進む。 */
  const skipUntilClose = (open: string, close: string): boolean => {
    let depth = 0;
    while (pos < tokens.length) {
      const token = tokens[pos++];
      if (token.t !== 'punct') continue;
      if (token.v === open) depth++;
      else if (token.v === close) {
        if (depth === 0) return true;
        depth--;
      }
    }
    return false;
  };

  // skipUntilClose は開き括弧を消費した後に呼ぶ（depth 0 の閉じ括弧で止まる）
  const type = parseUnion();
  if (type === null || pos !== tokens.length) return null;
  return type;
}

// ============================================================
// JSDoc コメントの読み出し
// ============================================================

/** スクリプト中の JSDoc コメント 1 つ（`start` は `/**` の位置、`end` は `*\/` の直後）。 */
export interface JsDocComment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * スクリプトの JSDoc コメント（`/**` で始まるブロックコメント）を順に返す。
 * `scan` はコメント・文字列の中身を空白にした鏡像（文字列の中の `/**` を拾わないため。
 * 鏡像に残るのは `/*` と `*\/` だけなので、3 文字目の `*` は原文で確かめる）。
 */
export function findJsDocComments(script: string, scan: string): JsDocComment[] {
  const out: JsDocComment[] = [];
  let from = 0;
  for (;;) {
    const start = scan.indexOf('/*', from);
    if (start === -1) break;
    const close = scan.indexOf('*/', start + 2);
    if (close === -1) break;
    from = close + 2;
    if (script[start + 2] === '*') out.push({ start, end: close + 2, text: script.slice(start, close + 2) });
  }
  return out;
}

/**
 * JSDoc コメントの `@<tag> {…}` の型表現（波括弧の中身）を返す。無ければ null。
 */
export function readJsDocTagType(comment: string, tag: 'type' | 'typedef'): string | null {
  return readBracedType(comment, tag)?.type.trim() ?? null;
}

/**
 * `@<tag> {` の位置から、波括弧の釣り合いを取って型表現を取り出す。
 * 複数行の JSDoc の行頭 `*` は空白に置き換える。
 */
function readBracedType(comment: string, tag: string): { type: string; end: number } | null {
  const tagMatch = new RegExp(`@${tag}\\s*\\{`).exec(comment);
  if (!tagMatch) return null;
  const open = tagMatch.index + tagMatch[0].length - 1;
  let depth = 0;
  for (let i = open; i < comment.length; i++) {
    const ch = comment[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const type = comment.slice(open + 1, i).replace(/\n\s*\*(?!\/)/g, '\n ');
        return { type, end: i + 1 };
      }
    }
  }
  return null;
}

/**
 * プロパティの直前（空白だけを挟む）にある JSDoc コメントの `@type {…}` の型表現を返す。
 * `/** @type {T} *\/` の 1 行でも、説明文を含む複数行の JSDoc でもよい。
 */
export function readJsDocTypeBefore(content: string, propIndex: number): string | undefined {
  const comment = jsDocCommentBefore(content, propIndex);
  return comment === undefined ? undefined : readBracedType(comment, 'type')?.type.trim();
}

/**
 * getter の直前（空白だけを挟む）にある JSDoc コメントの `@returns {…}`（`@return` も）の型表現を返す。
 * getter の本体から形を読めないとき（`{ ...r, ...live }`・早い `return []` の後の `[x].map(…)`）、
 * 作者が書いた戻りの型が唯一の手掛かり（docs/seam-apps.md、shift-desk）。
 */
export function readJsDocReturnsBefore(content: string, propIndex: number): string | undefined {
  const comment = jsDocCommentBefore(content, propIndex);
  if (comment === undefined) return undefined;
  return (readBracedType(comment, 'returns') ?? readBracedType(comment, 'return'))?.type.trim();
}

function jsDocCommentBefore(content: string, propIndex: number): string | undefined {
  let end = propIndex;
  while (end > 0 && /\s/.test(content[end - 1])) end--;
  if (!content.startsWith('*/', end - 2)) return undefined;
  const start = content.lastIndexOf('/*', end - 2);
  if (start === -1 || content[start + 2] !== '*') return undefined;
  return content.slice(start, end);
}

/**
 * スクリプトの JSDoc コメントから `@typedef {T} Name` を集める。
 * 同じ名前が 2 度あれば後の宣言が勝つ（JavaScript の評価順ではなく、単に後勝ち）。
 */
export function collectJsDocTypedefs(script: string, scan: string): Map<string, JsDocType> {
  const typedefs = new Map<string, JsDocType>();
  for (const { text: comment } of findJsDocComments(script, scan)) {
    const braced = readBracedType(comment, 'typedef');
    if (braced === null) continue;
    const name = /^\s*([$A-Za-z_][$\w]*)/.exec(comment.slice(braced.end));
    const type = parseJsDocType(braced.type);
    if (name && type !== null) typedefs.set(name[1], type);
  }
  return typedefs;
}

// ============================================================
// 型の解釈
// ============================================================

/**
 * 名前を `@typedef` で解決し、合併を平らにした構成員を返す。
 * 解決できない名前（`string` も含む）はそのまま残る。
 */
export function flattenJsDocType(type: JsDocType, typedefs: JsDocTypedefs, depth = 0): JsDocType[] {
  if (type.kind === 'union') return type.members.flatMap((member) => flattenJsDocType(member, typedefs, depth));
  if (type.kind === 'name' && depth < MAX_RESOLVE_DEPTH) {
    const resolved = typedefs.get(type.name);
    if (resolved !== undefined) return flattenJsDocType(resolved, typedefs, depth + 1);
  }
  return [type];
}

/**
 * 型ヒント（`string` / `number` / `boolean` / `null` / `array` / `object` を `|` で結んだもの）。
 * 既存の推定（stateAnalyzer の inferTypeHint）と同じ語彙。ヒントにならない構成員は落とし、
 * 1 つも残らなければ undefined。
 */
export function jsDocTypeHint(type: JsDocType, typedefs: JsDocTypedefs = new Map()): string | undefined {
  const hints = new Set<string>();
  for (const member of flattenJsDocType(type, typedefs)) {
    if (member.kind === 'array') hints.add('array');
    else if (member.kind === 'object') hints.add('object');
    else if (member.kind === 'name') {
      const lower = member.name.toLowerCase();
      if (lower === 'string' || lower === 'number' || lower === 'boolean' || lower === 'object') hints.add(lower);
      else if (lower === 'null' || lower === 'undefined') hints.add('null');
      // 要素の型を書かない `Array`（`{Array|null}`）も配列
      else if (lower === 'array' || lower === 'readonlyarray') hints.add('array');
    }
  }
  return hints.size === 0 ? undefined : [...hints].sort().join('|');
}

/** 型の形: 配列の要素（の合併）と、オブジェクトのフィールド（の合わせ）。 */
export interface JsDocShape {
  /** 配列の構成員があれば、その要素の型（複数あれば合併）。 */
  readonly element: JsDocType | null;
  /** オブジェクトの構成員のフィールド（同名は先勝ち）。 */
  readonly fields: readonly JsDocField[];
}

export function jsDocShape(type: JsDocType, typedefs: JsDocTypedefs): JsDocShape {
  const elements: JsDocType[] = [];
  const fields: JsDocField[] = [];
  for (const member of flattenJsDocType(type, typedefs)) {
    if (member.kind === 'array') elements.push(member.element);
    else if (member.kind === 'object') {
      for (const field of member.fields) {
        if (!fields.some((f) => f.name === field.name)) fields.push(field);
      }
    }
  }
  const element = elements.length === 0 ? null : elements.length === 1 ? elements[0] : { kind: 'union' as const, members: elements };
  return { element, fields };
}
