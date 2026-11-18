/**
 * getterAnnotations.ts
 *
 * state の getter に、仮想コードで戻り値の型 `any` の JSDoc（`/** @returns {any} *\/`）を足す位置を求める。
 *
 * `defineState<T>(def: T & ThisType<_WcsThis<T>>)` は、T をオブジェクトリテラルから推論する。
 * 注釈の無い getter の型はその本体から推論され、本体が `this` を読むと推論が T に戻ってくる
 * （循環）。TypeScript はその getter の型を `any` にし、本体の `this` も `any` のまま
 * キャッシュする — `get first() { return this.items[0].nmae; }` の typo は報告されず、
 * strict では `this.items.filter((i) => …)` の `i` が暗黙の any（TS7006）になる。
 * メソッドは本体の検査が T の確定後に回るので起きない（TypeScript 5.9 / 7.1 で同じ）。
 *
 * 戻り値を注釈すると循環が切れ、本体は確定した `this` で検査される。getter の型は
 * どのみち `any` だったので、失うものは無い。注釈は `this` を読む getter にだけ付ける —
 * 読まない getter（`get now() { return Date.now(); }`）は今どおり推論された型を持つ。
 * 仮想コードは JavaScript なので（4.26）、注釈は getter の前に置く JSDoc。作者が JSDoc で戻り値の型を
 * 書いた getter（直前の JSDoc に `@returns` / `@return` / `@type`）には足さない — その注釈が循環を切る。
 *
 * 対象は state オブジェクト（`export default { … }` / `export default defineState({ … })`）の
 * 直下の getter だけ。パースできないコード（構文エラー、TypeScript の構文）では何も足さない。
 */

import { parse, type AnyNode, type Comment } from 'acorn';

/**
 * getter の直前に足す、戻り値の型の JSDoc。先頭の改行が要る: TypeScript は前のトークン（`{` や `,`）と同じ行に
 * 続くコメントをそのトークンの後ろのコメントと読み、次の宣言の JSDoc にしない（`{ a: 1, get b() {…} }` と 1 行に
 * 書いた state で注釈が効かなくなる）。挿入した文字は HTML へ結ばないので、行が増えても位置はずれない。
 */
export const GETTER_RETURN_ANNOTATION = '\n/** @returns {any} */ ';

/** 作者が書いた、戻り値の型を決める JSDoc のタグ。 */
const RETURN_TYPE_TAG = /@(?:returns?|type)\b/;

/**
 * `code` の中で `GETTER_RETURN_ANNOTATION` を挿入するオフセット（昇順）。
 * 各オフセットは `this` を読む getter の先頭（`get` の位置）。
 */
export function getterAnnotationOffsets(code: string): number[] {
  let program: AnyNode;
  const comments: Comment[] = [];
  try {
    program = parse(code, { ecmaVersion: 'latest', sourceType: 'module', onComment: comments });
  } catch {
    return [];
  }
  const state = stateObject(program);
  if (state === null) return [];
  const offsets: number[] = [];
  for (const property of state.properties) {
    if (property.type !== 'Property' || property.kind !== 'get') continue;
    const fn = property.value;
    if (fn.type !== 'FunctionExpression' || !readsThis(fn.body)) continue;
    if (hasReturnTypeDoc(code, comments, property.start)) continue;
    offsets.push(property.start);
  }
  return offsets;
}

/** `start` の直前（空白だけを挟む）の JSDoc が戻り値の型を書いているか。 */
function hasReturnTypeDoc(code: string, comments: readonly Comment[], start: number): boolean {
  let at = start;
  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i];
    if (comment.end > at) continue;
    if (code.slice(comment.end, at).trim() !== '') return false;
    if (comment.type === 'Block' && comment.value.startsWith('*') && RETURN_TYPE_TAG.test(comment.value)) return true;
    at = comment.start;
  }
  return false;
}

/** `export default { … }` か `export default defineState({ … })` のオブジェクト。 */
function stateObject(program: AnyNode): (AnyNode & { type: 'ObjectExpression' }) | null {
  if (program.type !== 'Program') return null;
  for (const statement of program.body) {
    if (statement.type !== 'ExportDefaultDeclaration') continue;
    const declaration = statement.declaration;
    if (declaration.type === 'ObjectExpression') return declaration;
    if (
      declaration.type === 'CallExpression'
      && declaration.callee.type === 'Identifier'
      && declaration.callee.name === 'defineState'
      && declaration.arguments[0]?.type === 'ObjectExpression'
    ) {
      return declaration.arguments[0];
    }
    return null;
  }
  return null;
}

/** 本体が（入れ子の function / class ではなく）getter 自身の `this` を読むか。アロー関数は `this` を継ぐ。 */
function readsThis(node: AnyNode): boolean {
  if (node.type === 'ThisExpression') return true;
  if (node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration'
    || node.type === 'ClassExpression' || node.type === 'ClassDeclaration') {
    return false;
  }
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    const children = Array.isArray(value) ? value : [value];
    for (const child of children) {
      if (isNode(child) && readsThis(child)) return true;
    }
  }
  return false;
}

function isNode(value: unknown): value is AnyNode {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
