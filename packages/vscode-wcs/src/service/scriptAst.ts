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
 * スコープ（関数境界で「`this` が state か」と「有効なエイリアス集合」を別々に持つ）:
 *   - 通常の `function` / class の中では `this` は state ではない。だが外側で
 *     `const self = this` と束縛した名前はクロージャ越しに state を指し続けるので、
 *     エイリアスは関数境界を越えて生きる。アロー関数は `this` も透過する。
 *   - エイリアスは関数スコープ単位で決める: その名前の束縛が**すべて** `= this`（または
 *     既存エイリアス）で、引数・非 this 初期化・再代入・関数宣言名・catch 引数として
 *     束縛されていないときだけ有効。`self => self.a` の引数 `self` は外側の
 *     `const self = this` を影にする。曖昧なら「エイリアスではない」に倒す（黙る側）。
 *   - ブロックスコープは見ない（関数単位の超集合。影は強めに効き、黙る側に倒れる）。
 *
 * 収集規則の対応表は計画書 §1。要点:
 *   - `this.a` / `this["a.b"]` / `this?.a` / 式なしテンプレートリテラル添字 → path
 *   - `this.$getAll("p")` / `this.$resolve("p")` / `this.$dependOn("p")`（旧名 `this.$trackDependency("p")`）
 *     → path（文字列リテラルのみ）
 *   - `const { a } = this` / `const self = this; self.a` → path
 *   - `this.form.name` → path は `form`、chain は `["form", "name"]`（untracked-read の材料）
 *   - `this.a += 1` / `this.a++` / `this.a ??= x` → path（ランタイムは get → set の順に動く。`written: true`）
 *   - `this[key]` / 非リテラル引数 → 集めない（断定できない）
 *   - `this.$untracked(fn)`（旧名 `this.$untrackDependency(fn)`）の中 → 集めない（意図的な抑止）
 *   - 単純代入 `this.a = x` の左辺 → 集めない（読みではない。`wcs/nested-assign` の担当）
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
  /** 複合代入・増減の対象として読まれたか（`this.a += 1` / `this.a++`）。読み兼書き。 */
  readonly written: boolean;
  readonly start: number;
  readonly end: number;
}

const PREFIX = '(async function* () {\n';
const SUFFIX = '\n})';

/** ランタイム API のうち、第 1 引数の文字列リテラルがそのまま依存パスになるもの。 */
const PATH_ARG_APIS = new Set(['$getAll', '$resolve', '$dependOn', '$trackDependency']);
/** 明示の依存登録（`$dependOn` が正式名、`$trackDependency` は 3.x の間の旧名 — @wcstack/state 3.2） */
const TRACK_APIS = new Set(['$dependOn', '$trackDependency']);
/** この呼び出しの引数の中は依存追跡が抑止される（`$untracked` が正式名、`$untrackDependency` は旧名）。 */
const UNTRACK_APIS = new Set(['$untracked', '$untrackDependency']);

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
  const out: GetterRead[] = [];
  const root: Scope = { thisIsState: true, aliases: new Set() };
  visit(fn.body, enterFunction(fn, root, true), out);
  return out;
}

/** 関数スコープ 1 段。 */
interface Scope {
  /** このスコープの `this` が state proxy か（通常の function / class の中では false） */
  readonly thisIsState: boolean;
  /** state を指すと断定できる識別子（外側から継承し、このスコープの束縛で上書き・影付け） */
  readonly aliases: ReadonlySet<string>;
}

type FunctionNode = AnyNode & { type: 'FunctionExpression' | 'FunctionDeclaration' | 'ArrowFunctionExpression' };

/** ラッパー `(async function* () { … })` の関数ノードを取り出す。 */
function unwrapWrapper(program: AnyNode): (AnyNode & { type: 'FunctionExpression' }) | null {
  if (program.type !== 'Program' || program.body.length !== 1) return null;
  const statement = program.body[0];
  if (statement.type !== 'ExpressionStatement') return null;
  const expression = statement.expression;
  if (expression.type !== 'FunctionExpression') return null;
  return expression;
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

function isFunctionNode(node: AnyNode): node is FunctionNode {
  return node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration' || node.type === 'ArrowFunctionExpression';
}

function isClassNode(node: AnyNode): boolean {
  return node.type === 'ClassExpression' || node.type === 'ClassDeclaration';
}

/** パターン（引数・宣言の左辺）が束縛する識別子名を全部集める。 */
function bindingNames(pattern: AnyNode, out: Set<string>): void {
  switch (pattern.type) {
    case 'Identifier': out.add(pattern.name); return;
    case 'ObjectPattern':
      for (const p of pattern.properties) bindingNames(p.type === 'RestElement' ? p.argument : p.value, out);
      return;
    case 'ArrayPattern':
      for (const e of pattern.elements) if (e !== null) bindingNames(e, out);
      return;
    case 'RestElement': bindingNames(pattern.argument, out); return;
    case 'AssignmentPattern': bindingNames(pattern.left, out); return;
    default: return;
  }
}

/**
 * 関数に入るときのスコープを作る。本体を（入れ子の関数・class には降りずに）走査し、
 * 「`= this`（または既存エイリアス）でだけ束縛された名前」を有効エイリアスに足し、
 * それ以外の束縛（引数・非 this 初期化・再代入・関数/class 宣言名・catch 引数・for-in/of の左辺）
 * を持つ名前を影として外す。`= this` は `thisIsState` のスコープでだけエイリアスになる。
 */
function enterFunction(fn: FunctionNode, outer: Scope, thisIsState: boolean): Scope {
  const shadowed = new Set<string>();
  /** `= this` は from: null、`= ident` は from: ident */
  const aliasInits: { name: string; from: string | null }[] = [];
  for (const param of fn.params) bindingNames(param, shadowed);

  const scan = (node: AnyNode): void => {
    if (isFunctionNode(node)) {
      if (node.type === 'FunctionDeclaration' && node.id !== null) shadowed.add(node.id.name);
      return;
    }
    if (isClassNode(node)) {
      if (node.type === 'ClassDeclaration' && node.id !== null) shadowed.add(node.id.name);
      return;
    }
    if (node.type === 'VariableDeclarator') {
      if (node.id.type === 'Identifier' && node.init !== null && node.init !== undefined && isStateRootCandidate(node.init)) {
        aliasInits.push({ name: node.id.name, from: node.init.type === 'Identifier' ? node.init.name : null });
      } else {
        bindingNames(node.id, shadowed);
      }
    } else if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') {
      if (node.operator === '=' && isStateRootCandidate(node.right)) aliasInits.push({ name: node.left.name, from: node.right.type === 'Identifier' ? node.right.name : null });
      else shadowed.add(node.left.name);
    } else if (node.type === 'CatchClause' && node.param !== null && node.param !== undefined) {
      bindingNames(node.param, shadowed);
    }
    forEachChild(node, scan);
  };
  // 走査中は「this か識別子なら候補」として集め、名前解決は後段で不動点まで回す
  const isStateRootCandidate = (node: AnyNode): boolean =>
    node.type === 'ThisExpression' || node.type === 'Identifier';
  scan(fn.body);
  for (const param of fn.params) if (param.type === 'AssignmentPattern') scan(param.right);

  // 有効エイリアス = (外側 ∪ 自スコープの this 束縛) − 影。`const b = a` の連鎖は不動点で解く
  const aliases = new Set<string>();
  for (const name of outer.aliases) if (!shadowed.has(name)) aliases.add(name);
  let changed = true;
  while (changed) {
    changed = false;
    for (const { name, from } of aliasInits) {
      if (shadowed.has(name) || aliases.has(name)) continue;
      const ok = from === null ? thisIsState : aliases.has(from);
      if (ok) { aliases.add(name); changed = true; }
    }
  }
  // `const self = other` と `const self = this` が同居する名前は曖昧 → 影に倒す
  for (const { name, from } of aliasInits) {
    const ok = from === null ? thisIsState : aliases.has(from);
    if (!ok) aliases.delete(name);
  }
  return { thisIsState, aliases };
}

function isThisRoot(node: AnyNode, scope: Scope): boolean {
  return (node.type === 'ThisExpression' && scope.thisIsState)
    || (node.type === 'Identifier' && scope.aliases.has(node.name));
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

interface EmitOptions {
  readonly form: GetterRead['form'];
  readonly callee: boolean;
  readonly written: boolean;
}

function emit(out: GetterRead[], segments: readonly Segment[], options: EmitOptions, start: number, end: number): void {
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
  out.push({
    path: root, chain, form: options.form, callee: options.callee, written: options.written,
    start: start - PREFIX.length, end: end - PREFIX.length,
  });
}

function visit(node: AnyNode, scope: Scope, out: GetterRead[]): void {
  if (isFunctionNode(node)) {
    // アローは this 透過、通常の function は this が別物。エイリアスはどちらも閉包で生きる
    const inner = enterFunction(node, scope, node.type === 'ArrowFunctionExpression' ? scope.thisIsState : false);
    for (const param of node.params) if (param.type === 'AssignmentPattern') visit(param.right, inner, out);
    visit(node.body, inner, out);
    return;
  }
  if (isClassNode(node)) {
    // class の中の this はインスタンス。閉包のエイリアスは生きる（extends / 算出キーの
    // 外側 this は取りこぼす — 超集合の黙る側）
    const inner: Scope = { thisIsState: false, aliases: scope.aliases };
    forEachChild(node, (child) => visit(child, inner, out));
    return;
  }
  switch (node.type) {
    case 'ChainExpression':
      visit(node.expression, scope, out);
      return;
    case 'MemberExpression':
      visitMember(node, scope, out, { form: 'member', callee: false, written: false });
      return;
    case 'CallExpression':
      visitCall(node, scope, out);
      return;
    case 'AssignmentExpression':
      if (node.operator === '=') visitWriteTarget(node.left, scope, out);
      else visitReadWriteTarget(node.left, scope, out);
      visit(node.right, scope, out);
      return;
    case 'UpdateExpression':
      visitReadWriteTarget(node.argument, scope, out);
      return;
    case 'VariableDeclarator':
      visitDeclarator(node, scope, out);
      return;
    default:
      forEachChild(node, (child) => visit(child, scope, out));
  }
}

/** チェーン全体を 1 件として扱い、基底が `this` でなければ基底を通常走査する。動的添字の式は常に走査する。 */
function visitMember(node: AnyNode, scope: Scope, out: GetterRead[], options: EmitOptions): void {
  const { segments, base } = resolveChain(node);
  if (isThisRoot(base, scope)) {
    emit(out, segments, options, node.start, node.end);
  } else {
    visit(base, scope, out);
  }
  for (const segment of segments) {
    if (segment.dynamic !== null) visit(segment.dynamic, scope, out);
  }
}

function visitCall(node: AnyNode & { type: 'CallExpression' }, scope: Scope, out: GetterRead[]): void {
  const callee = unwrapChain(node.callee);
  if (callee.type === 'MemberExpression') {
    const { segments, base } = resolveChain(callee);
    if (isThisRoot(base, scope) && segments.length === 1 && segments[0].text !== null) {
      const api = segments[0].text;
      // `$untracked(fn)` / `$untrackDependency(fn)` の中は依存追跡が抑止される — 引数ごと読まない
      if (UNTRACK_APIS.has(api)) return;
      if (PATH_ARG_APIS.has(api)) {
        const first = node.arguments[0];
        const path = first !== undefined && first.type !== 'SpreadElement' ? literalString(first) : null;
        if (path !== null && path.length > 0 && !path.startsWith('$')) {
          out.push({
            path, chain: null, form: TRACK_APIS.has(api) ? 'track' : 'api', callee: false, written: false,
            start: node.start - PREFIX.length, end: node.end - PREFIX.length,
          });
        }
        for (const argument of node.arguments) visit(argument, scope, out);
        return;
      }
    }
    visitMember(callee, scope, out, { form: 'member', callee: true, written: false });
  } else {
    visit(callee, scope, out);
  }
  for (const argument of node.arguments) visit(argument, scope, out);
}

/** 単純代入の左辺。`this` ルートのチェーンは読みではないので集めない（動的添字の式だけ走査）。 */
function visitWriteTarget(target: Pattern | Expression, scope: Scope, out: GetterRead[]): void {
  const unwrapped = unwrapChain(target);
  if (unwrapped.type !== 'MemberExpression') {
    visit(unwrapped, scope, out);
    return;
  }
  const { segments, base } = resolveChain(unwrapped);
  if (!isThisRoot(base, scope)) visit(base, scope, out);
  for (const segment of segments) {
    if (segment.dynamic !== null) visit(segment.dynamic, scope, out);
  }
}

/** 複合代入・増減の対象。ランタイムは get → set の順に動くので読みとして集める（`written: true`）。 */
function visitReadWriteTarget(target: Pattern | Expression, scope: Scope, out: GetterRead[]): void {
  const unwrapped = unwrapChain(target);
  if (unwrapped.type !== 'MemberExpression') {
    visit(unwrapped, scope, out);
    return;
  }
  visitMember(unwrapped, scope, out, { form: 'member', callee: false, written: true });
}

function visitDeclarator(node: AnyNode & { type: 'VariableDeclarator' }, scope: Scope, out: GetterRead[]): void {
  const init = node.init;
  if (init !== null && init !== undefined && isThisRoot(init, scope)) {
    // `const self = this` は enterFunction が解決済み。`const { a } = this` は分割代入の読み
    if (node.id.type === 'ObjectPattern') visitDestructure(node.id, [], scope, out);
    return;
  }
  if (init !== null && init !== undefined && node.id.type === 'ObjectPattern') {
    // `const { name } = this.form` — `this.form.name` と同じ形の素のプロパティ読み
    const { segments, base } = resolveChain(init);
    if (segments.length > 0 && isThisRoot(base, scope)) {
      visitDestructure(node.id, segments, scope, out);
      for (const segment of segments) {
        if (segment.dynamic !== null) visit(segment.dynamic, scope, out);
      }
      return;
    }
  }
  visit(node.id, scope, out);
  if (init !== null && init !== undefined) visit(init, scope, out);
}

function visitDestructure(pattern: ObjectPattern, prefix: readonly Segment[], scope: Scope, out: GetterRead[]): void {
  for (const property of pattern.properties) {
    if (property.type === 'RestElement') continue;
    let key: string | null = null;
    if (!property.computed && property.key.type === 'Identifier') key = property.key.name;
    else key = literalString(property.key);
    let value: AnyNode = property.value;
    if (value.type === 'AssignmentPattern') {
      // 既定値の式は通常走査（`const { a = this.b } = this` の `this.b`）
      visit(value.right, scope, out);
      value = value.left;
    }
    const segments = [...prefix, { text: key, dynamic: null }];
    if (value.type === 'ObjectPattern' && value.properties.length > 0) {
      visitDestructure(value, segments, scope, out);
      continue;
    }
    emit(out, segments, { form: 'destructure', callee: false, written: false }, property.start, property.end);
  }
}

// ============================================================
// `this.<name>` のメンバー参照（旧名の宣言キーの読み出し検出）
// ============================================================

/** `this.<name>` / `this["<name>"]` のメンバー参照 1 件（本体テキスト相対オフセット）。 */
export interface ThisMemberRef {
  /** 参照されたメンバー名（引用符は含まない） */
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

/**
 * getter / メソッド本体から `this.<name>` / `this["<name>"]` のメンバー参照を集める。
 * 名前は `names` に含まれるものだけ。パースできなければ null（呼び出し側は断定しない側に倒す）。
 *
 * 依存解析（`collectGetterReads`）とは別物なので、エイリアス（`const self = this`）は追わず
 * 素の `this` だけを見る — 取りこぼしても誤検出を出さない側に倒す。`this` の束縛だけは
 * 同じ規則で扱い、入れ子の function / class の中の `this` は state ではないので見ない。
 * 正規表現（`/\.\s*\$streams\b/`）と違い、文字列リテラルの中（`"obj.$streams"`）や
 * 他オブジェクトのプロパティ（`other.$streams`）には当たらない。
 */
export function collectThisMemberRefs(body: string, names: ReadonlySet<string>): ThisMemberRef[] | null {
  let program: AnyNode;
  try {
    program = parse(PREFIX + body + SUFFIX, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch {
    return null;
  }
  const fn = unwrapWrapper(program);
  if (fn === null) return null;
  return walkThisMembers(fn.body, names, PREFIX.length);
}

const VALUE_PREFIX = '(async function* () {\n(';
const VALUE_SUFFIX = ')\n})';

/**
 * プロパティの**値**に置かれた関数（`count: function (cur) { … }`）の中の `this.<name>` を集める。
 *
 * ランタイムが `.call(state, …)` で再束縛する宣言面（`$watch`）は、メソッド短縮記法だけでなく
 * `function` 式でも `this` が state になる。アロー関数・識別子参照・その他の値は `this` が
 * state ではない（モジュールスコープ ＝ ESM では undefined）ので**空**を返す — ここで拾うと
 * 誤検出になる。パースできなければ null。
 */
export function collectThisMemberRefsInValue(value: string, names: ReadonlySet<string>): ThisMemberRef[] | null {
  let program: AnyNode;
  try {
    program = parse(VALUE_PREFIX + value + VALUE_SUFFIX, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch {
    return null;
  }
  const wrapper = unwrapWrapper(program);
  if (wrapper === null || wrapper.body.body.length !== 1) return null;
  const statement = wrapper.body.body[0];
  if (statement.type !== 'ExpressionStatement') return null;
  const expression = statement.expression;
  // 通常の function 式だけが `this` を再束縛される側。アロー等は state の `this` を持たない
  if (expression.type !== 'FunctionExpression') return [];
  return walkThisMembers(expression.body, names, VALUE_PREFIX.length);
}

/**
 * 関数本体（`this` が state を指すスコープ）から `this.<name>` を集める。
 * `offsetShift` はラッパー接頭辞の長さ（返すオフセットは入力テキスト相対になる）。
 */
function walkThisMembers(root: AnyNode, names: ReadonlySet<string>, offsetShift: number): ThisMemberRef[] {
  const out: ThisMemberRef[] = [];
  const walk = (node: AnyNode, thisIsState: boolean): void => {
    // class 本体の `this` は state ではない（中身ごと見ない）
    if (isClassNode(node)) return;
    if (isFunctionNode(node)) {
      // アロー関数は外側の `this` を継承し、通常の function は自分の `this` を持つ
      const inner = node.type === 'ArrowFunctionExpression' ? thisIsState : false;
      forEachChild(node, (child) => walk(child, inner));
      return;
    }
    if (thisIsState && node.type === 'MemberExpression' && node.object.type === 'ThisExpression') {
      const hit = thisMemberName(node);
      if (hit !== null && names.has(hit.name)) {
        out.push({ name: hit.name, start: hit.start - offsetShift, end: hit.end - offsetShift });
      }
    }
    forEachChild(node, (child) => walk(child, thisIsState));
  };
  walk(root, true);
  return out;
}

/** `this.name` / `this["name"]` のメンバー名とそのスパン（引用符の内側）。断定できなければ null。 */
function thisMemberName(node: MemberExpression): { name: string; start: number; end: number } | null {
  const property = node.property;
  if (!node.computed && property.type === 'Identifier') {
    return { name: property.name, start: property.start, end: property.end };
  }
  if (node.computed && property.type === 'Literal' && typeof property.value === 'string') {
    return { name: property.value, start: property.start + 1, end: property.end - 1 };
  }
  return null;
}
