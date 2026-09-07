/**
 * scriptAst.ts
 *
 * getter 本体を AST（acorn）で読み、`this` を通した state パスの**読み取り**を集める。
 * `@wcstack/state` の「依存追跡の境界」規則 1（追跡されるのは `this` を通したパスの
 * 読み取りだけ・`this.form.name` は `form` しか追跡しない）を静的に機械化する部品で、
 * `wcs/getter-cycle` と `wcs/getter-untracked-read` が消費する。
 *
 * 設計（docs/getter-dependency-ast-impl-plan.md D1〜D4）:
 *   - パーサは acorn。`typescript` は esbuild で external なので validator core からは
 *     import できない（`@wcstack/lint` の cli.cjs が実行時に落ちる）。
 *   - 解析単位は callable 本体 1 個。位置決めは stateAnalyzer の正規表現に任せ、本体を
 *     `(async function* () {` … `})` で包んでパースする。`await` / `yield` / `for await` を
 *     全部受ける超集合で、壊れた getter 1 本が他の getter の診断を巻き込まない。
 *   - パース失敗は `null`（断定できないときは黙る）。例外はこの関数の外に出さない。
 *   - 静的に集まる読み取りは runtime が登録する依存の**超集合**（分岐で実行されない
 *     読み取りも拾う）。超集合で安全な規則だけがこれを使う。
 *
 * 収集規則の対応表は計画書 §1。要点:
 *   - `this.a` / `this["a.b"]` / `this?.a` / 式なしテンプレートリテラル添字 → path
 *   - `this.$getAll("p")` / `this.$resolve("p")` / `this.$trackDependency("p")` → path（文字列リテラルのみ）
 *   - `const { a } = this` / `const self = this; self.a` → path
 *   - `this.form.name` → path は `form`、chain は `["form", "name"]`（untracked-read の材料）
 *   - `this[key]` / 非リテラル引数 → 集めない（断定できない）
 *   - `this.$untrackDependency(fn)` の中 / 入れ子の function・class の中 → 集めない（`this` が別物 or 意図的な抑止）
 *   - 代入・更新の左辺 → 集めない（読みではない。`wcs/nested-assign` の担当）
 *   - `$` 始まりのルート → 集めない（API 名前空間）
 */

import { parse, type AnyNode, type MemberExpression, type ObjectPattern, type Pattern, type Expression } from 'acorn';

/** getter 本体で見つかった `this` 経由の読み取り 1 件。オフセットは本体テキスト相対。 */
export interface GetterRead {
  /** 依存として登録されるパス（chain の先頭セグメント。`this["a.b"]` なら `a.b`） */
  readonly path: string;
  /**
   * 読み取りの全セグメント（`this.form.name` → `["form", "name"]`）。動的添字や
   * ドットを含む非ルート添字を含むときは null（提案パスを断定できない）。
   * `form: 'api' | 'track'` では常に null。
   */
  readonly chain: readonly string[] | null;
  /** 読み取りの形。 */
  readonly form: 'member' | 'api' | 'track' | 'destructure';
  /** チェーンが呼び出しの callee だったか（`this.form.validate()` の `validate` が末尾） */
  readonly callee: boolean;
  readonly start: number;
  readonly end: number;
}

const PREFIX = '(async function* () {\n';
const SUFFIX = '\n})';

/** ランタイム API のうち、第 1 引数の文字列リテラルがそのまま依存パスになるもの。 */
const PATH_ARG_APIS = new Set(['$getAll', '$resolve', '$trackDependency']);
/** この呼び出しの引数の中は依存追跡が抑止される。 */
const UNTRACK_API = '$untrackDependency';

/**
 * getter 本体（`{ … }` の中身）から `this` 経由の読み取りを集める。
 * パースできなければ null。
 */
export function collectGetterReads(body: string): GetterRead[] | null {
  let program: AnyNode;
  try {
    program = parse(PREFIX + body + SUFFIX, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch {
    return null;
  }
  const fn = unwrapWrapper(program);
  if (fn === null) return null;
  const ctx: Context = { aliases: collectAliases(fn), out: [] };
  visit(fn, ctx);
  return ctx.out;
}

interface Context {
  /** `const self = this` で束縛された識別子（本体直下と透過するアロー関数の中） */
  readonly aliases: Set<string>;
  readonly out: GetterRead[];
}

/** ラッパー `(async function* () { … })` の BlockStatement を取り出す。 */
function unwrapWrapper(program: AnyNode): AnyNode | null {
  if (program.type !== 'Program' || program.body.length !== 1) return null;
  const statement = program.body[0];
  if (statement.type !== 'ExpressionStatement') return null;
  const expression = statement.expression;
  if (expression.type !== 'FunctionExpression') return null;
  return expression.body;
}

function isNode(value: unknown): value is AnyNode {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

function forEachChild(node: AnyNode, fn: (child: AnyNode) => void): void {
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) fn(item);
    } else if (isNode(value)) {
      fn(value);
    }
  }
}

/** `this` が別物になる境界（アロー関数は透過するので含めない）。 */
function isThisBoundary(node: AnyNode): boolean {
  return node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration'
    || node.type === 'ClassExpression' || node.type === 'ClassDeclaration';
}

function collectAliases(root: AnyNode): Set<string> {
  const aliases = new Set<string>();
  const scan = (node: AnyNode): void => {
    if (isThisBoundary(node)) return;
    if (node.type === 'VariableDeclarator' && node.init?.type === 'ThisExpression' && node.id.type === 'Identifier') {
      aliases.add(node.id.name);
    }
    forEachChild(node, scan);
  };
  scan(root);
  return aliases;
}

function isThisRoot(node: AnyNode, ctx: Context): boolean {
  return node.type === 'ThisExpression' || (node.type === 'Identifier' && ctx.aliases.has(node.name));
}

interface Segment {
  /** セグメントのテキスト。動的添字は null */
  readonly text: string | null;
  /** 動的添字のときの式（中の `this` 読み取りを別途走査する） */
  readonly dynamic: Expression | null;
}

/** 文字列リテラル / 式なしテンプレートリテラルならその文字列、それ以外は null。 */
function literalString(node: AnyNode): string | null {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked ?? null;
  }
  return null;
}

function segmentOf(member: MemberExpression): Segment {
  const property = member.property;
  if (!member.computed) {
    return property.type === 'Identifier' ? { text: property.name, dynamic: null } : { text: null, dynamic: null };
  }
  if (property.type === 'Literal' && typeof property.value === 'number') {
    return { text: String(property.value), dynamic: null };
  }
  const text = literalString(property);
  if (text !== null) return { text, dynamic: null };
  return property.type === 'PrivateIdentifier' ? { text: null, dynamic: null } : { text: null, dynamic: property };
}

/** ChainExpression（optional chain の外皮）を剥がす。 */
function unwrapChain(node: AnyNode): AnyNode {
  return node.type === 'ChainExpression' ? node.expression : node;
}

/** メンバーチェーンをルート側から並べたセグメント列と、その基底式に分解する。 */
function resolveChain(node: AnyNode): { segments: Segment[]; base: AnyNode } {
  const segments: Segment[] = [];
  let current = unwrapChain(node);
  while (current.type === 'MemberExpression') {
    segments.unshift(segmentOf(current));
    current = unwrapChain(current.object);
  }
  return { segments, base: current };
}

function emit(ctx: Context, segments: readonly Segment[], form: GetterRead['form'], callee: boolean, start: number, end: number): void {
  if (segments.length === 0) return;
  const root = segments[0].text;
  // 動的ルート（`this[key]`）は断定できない。`$` ルートは API 名前空間
  if (root === null || root.length === 0 || root.startsWith('$')) return;
  let chain: string[] | null = [];
  for (let i = 0; i < segments.length; i++) {
    const text = segments[i].text;
    // 非ルートのドット入り添字（`this.form["x.y"]`）は素のプロパティ名であってパスではない
    if (text === null || (i > 0 && text.includes('.'))) { chain = null; break; }
    chain.push(text);
  }
  ctx.out.push({ path: root, chain, form, callee, start: start - PREFIX.length, end: end - PREFIX.length });
}

function visit(node: AnyNode, ctx: Context): void {
  if (isThisBoundary(node)) return;
  switch (node.type) {
    case 'ChainExpression':
      visit(node.expression, ctx);
      return;
    case 'MemberExpression':
      visitMember(node, ctx, false);
      return;
    case 'CallExpression':
      visitCall(node, ctx);
      return;
    case 'AssignmentExpression':
      visitWriteTarget(node.left, ctx);
      visit(node.right, ctx);
      return;
    case 'UpdateExpression':
      visitWriteTarget(node.argument, ctx);
      return;
    case 'VariableDeclarator':
      visitDeclarator(node, ctx);
      return;
    default:
      forEachChild(node, (child) => visit(child, ctx));
  }
}

/** チェーン全体を 1 件として扱い、基底が `this` でなければ基底を通常走査する。動的添字の式は常に走査する。 */
function visitMember(node: AnyNode, ctx: Context, callee: boolean): void {
  const { segments, base } = resolveChain(node);
  if (isThisRoot(base, ctx)) {
    emit(ctx, segments, 'member', callee, node.start, node.end);
  } else {
    visit(base, ctx);
  }
  for (const segment of segments) {
    if (segment.dynamic !== null) visit(segment.dynamic, ctx);
  }
}

function visitCall(node: AnyNode & { type: 'CallExpression' }, ctx: Context): void {
  const callee = unwrapChain(node.callee);
  if (callee.type === 'MemberExpression') {
    const { segments, base } = resolveChain(callee);
    if (isThisRoot(base, ctx) && segments.length === 1 && segments[0].text !== null) {
      const api = segments[0].text;
      // `$untrackDependency(fn)` の中は依存追跡が抑止される — 引数ごと読まない
      if (api === UNTRACK_API) return;
      if (PATH_ARG_APIS.has(api)) {
        const first = node.arguments[0];
        const path = first !== undefined && first.type !== 'SpreadElement' ? literalString(first) : null;
        if (path !== null && path.length > 0 && !path.startsWith('$')) {
          ctx.out.push({
            path, chain: null, form: api === '$trackDependency' ? 'track' : 'api', callee: false,
            start: node.start - PREFIX.length, end: node.end - PREFIX.length,
          });
        }
        for (const argument of node.arguments) visit(argument, ctx);
        return;
      }
    }
    visitMember(callee, ctx, true);
  } else {
    visit(callee, ctx);
  }
  for (const argument of node.arguments) visit(argument, ctx);
}

/** 代入・更新の左辺。`this` ルートのチェーンは読みではないので集めない（動的添字の式だけ走査）。 */
function visitWriteTarget(target: Pattern | Expression, ctx: Context): void {
  const unwrapped = unwrapChain(target);
  if (unwrapped.type !== 'MemberExpression') {
    visit(unwrapped, ctx);
    return;
  }
  const { segments, base } = resolveChain(unwrapped);
  if (!isThisRoot(base, ctx)) visit(base, ctx);
  for (const segment of segments) {
    if (segment.dynamic !== null) visit(segment.dynamic, ctx);
  }
}

function visitDeclarator(node: AnyNode & { type: 'VariableDeclarator' }, ctx: Context): void {
  const init = node.init;
  if (init !== null && init !== undefined && isThisRoot(init, ctx)) {
    // `const self = this` は collectAliases 済み。`const { a } = this` は分割代入の読み
    if (node.id.type === 'ObjectPattern') visitDestructure(node.id, [], ctx);
    return;
  }
  if (init !== null && init !== undefined && node.id.type === 'ObjectPattern') {
    // `const { name } = this.form` — `this.form.name` と同じ形の素のプロパティ読み
    const { segments, base } = resolveChain(init);
    if (segments.length > 0 && isThisRoot(base, ctx)) {
      visitDestructure(node.id, segments, ctx);
      for (const segment of segments) {
        if (segment.dynamic !== null) visit(segment.dynamic, ctx);
      }
      return;
    }
  }
  visit(node.id, ctx);
  if (init !== null && init !== undefined) visit(init, ctx);
}

function visitDestructure(pattern: ObjectPattern, prefix: readonly Segment[], ctx: Context): void {
  for (const property of pattern.properties) {
    if (property.type === 'RestElement') continue;
    let key: string | null = null;
    if (!property.computed && property.key.type === 'Identifier') key = property.key.name;
    else key = literalString(property.key);
    let value: AnyNode = property.value;
    if (value.type === 'AssignmentPattern') {
      // 既定値の式は通常走査（`const { a = this.b } = this` の `this.b`）
      visit(value.right, ctx);
      value = value.left;
    }
    const segments = [...prefix, { text: key, dynamic: null }];
    if (value.type === 'ObjectPattern' && value.properties.length > 0) {
      visitDestructure(value, segments, ctx);
      continue;
    }
    emit(ctx, segments, 'destructure', false, property.start, property.end);
  }
}
