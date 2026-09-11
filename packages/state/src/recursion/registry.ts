/**
 * recursion/registry.ts
 *
 * state 1 つぶんの再帰レジストリ。宣言・`**` getter の定義・展開済みアクセサの台帳を
 * 持ち、「具体パスを読む直前に、その深さのアクセサを生やす」遅延実体化を担う。
 *
 * 遅延であることは実装の**不変条件**である（Phase A の A6/A7）。そのパスを一度でも
 * 読んでから生やしても、`isCacheable` が `wildcardCount > 0` だけでキャッシュ可を返す
 * ため `undefined` が `dirty:false` で固定され、以後どう書いても回復しない。
 * したがって実体化は `getByAddress` のキャッシュ参照**前**に置く（E5）。
 *
 * 寿命は state の世代と共にする。`_state` の再セットで `getterPaths` / `listPaths` は
 * クリアされるので、レジストリも作り直す（§1-3）。ただし**生やしたアクセサは state
 * オブジェクトの側に残る**ので、同じ state を再セットすると `getStateInfo` がそれを
 * `getterPaths` に復元する。そのとき「もう生えているから何もしない」と早期 return して
 * しまうと `listPaths` の登録だけが抜け落ちるため、生成物は WeakSet で見分けて
 * 登録だけをやり直す。
 */

import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../address/AbsoluteStateAddress";
import { getPathInfo } from "../address/PathInfo";
import { setCacheEntryByAbsoluteStateAddress } from "../cache/cacheEntryByAbsoluteStateAddress";
import { IStateElement } from "../components/types";
import { DELIMITER } from "../define";
import { getAllPropertyDescriptors } from "../getAllPropertyDescriptors";
import { getListIndexesByList } from "../list/listIndexesByList";
import { IListIndex } from "../list/types";
import { raiseError } from "../raiseError";
import { concretePathAt, depthOfConcretePath, hasRecursionWildcard, indexSegmentsToWildcard, isStructuralSuffix, listPathsUpTo, splitRecursivePath } from "./expand";
import { IRecursionAccessor, IRecursionSpec } from "./types";

/**
 * この機構が生やした getter。state オブジェクトに残った前世代の生成物と、
 * 作者が手で書いた同名 getter を見分けるために使う（前者は上書きしてよい・
 * 後者は衝突として拒否する）。
 */
const generatedGetters: WeakSet<object> = new WeakSet();

/** `**` getter 1 本ぶんの定義（本体は評価しない — descriptor だけを持つ）。 */
interface IRecursiveGetterDefinition {
  readonly recursivePath: string;
  readonly suffix: string;
  readonly get: () => unknown;
}

export class RecursionRegistry {
  readonly spec: IRecursionSpec;
  private readonly _definitions: Map<string, IRecursiveGetterDefinition> = new Map();
  private readonly _accessors: Map<string, IRecursionAccessor> = new Map();
  /**
   * 「再帰 getter の展開形ではない」と分かったパス。読みのホットパスの否定判定を記憶する。
   *
   * 有界である: キーは `getByAddress` に来た `address.pathInfo.path`、つまり添字を含まない
   * ワイルドカード形のパス文字列で、`PathInfo` が intern する集合（バインディング・getter・
   * API 引数に綴られたパスと、その展開形）の部分集合にしかならない。intern 済みパスの
   * 集合が有界であることは D10 で受け入れ済みなので、ここも同じ上限に収まる。
   * 文字列は WeakSet に入らないので、寿命はレジストリ（＝ state の世代）と共にする。
   */
  private readonly _nonAccessors: Set<string> = new Set();
  /**
   * `recursiveGetterOwning` の記憶。値は「その具体パスを展開形（またはその値の内側）として
   * 持つ `**` getter」、無ければ null。有界であることの根拠は `_nonAccessors` と同じ。
   */
  private readonly _ownerByPath: Map<string, string | null> = new Map();
  /** `concretePathAt` の記憶（接尾辞 → 深さ順の具体パス）。 */
  private readonly _concreteBySuffix: Map<string, string[]> = new Map();
  private readonly _registeredListPaths: Set<string> = new Set();

  constructor(spec: IRecursionSpec, state: object) {
    this.spec = spec;
    // getter 本体は実行しない。descriptor だけを見て `**` を含むキーを拾う。
    const descriptors = getAllPropertyDescriptors(state);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!hasRecursionWildcard(key)) {
        continue;
      }
      if (typeof descriptor.set === "function") {
        raiseError(
          `Recursive setters are not supported in this version: "${key}". ` +
          `Declare a plain path setter, or write through the concrete path.`
        );
      }
      if (typeof descriptor.get !== "function") {
        raiseError(
          `"${key}" contains "**" but is not a getter. ` +
          `The recursion wildcard only names a family of computed paths.`
        );
      }
      const suffix = splitRecursivePath(spec, key);
      if (suffix === null) {
        raiseError(
          `"${key}" does not match the declared recursion anchor "${spec.recursiveAnchor}". ` +
          `This version supports exactly one anchor, and no second "**" in the same path.`
        );
      }
      if (suffix.length === 0) {
        // `get "nodes.**"` は展開すると `nodes.*` そのもの。`getByAddress` は
        // 「パスが target にあるか」を先に見るので、実データの行が丸ごと隠れる。
        raiseError(
          `"${key}" names the recursive node itself. "**" names a computed path under a node ` +
          `(for example "${spec.recursiveAnchor}${DELIMITER}total"), not the node.`
        );
      }
      // 構造の判定は添字綴り（`get "nodes.**.children.0"()`）も畳んでから掛ける（書き側と同じ）
      if (isStructuralSuffix(spec, DELIMITER + indexSegmentsToWildcard(suffix.slice(DELIMITER.length)))) {
        // `get "nodes.**.children"` / `.children.*` / `.children.length` / 多段なら `.branch` は
        // 展開すると実データの子リスト（子ノード・その length・途中のオブジェクト）そのもの。
        // 生成 getter が `getByAddress` の「パスが target にあるか」で勝ち、実データの木を
        // 深さ 1 以下ごと無言で影にする（第 2 サイクルのレビューで実測: `$getAll("nodes.**.value", [])`
        // が `[1, 2]` に縮んだ）。書き側が同じ形を `recursion-structural-write` で拒否するのと対称。
        raiseError(
          `"${key}" names the recursion structure itself (a node, its "${spec.repeat.slice(0, spec.repeat.lastIndexOf(DELIMITER))}" list ` +
          `or that list's length, or an object on the way to that list). A recursive getter would hide the ` +
          `real child list at every depth — "**" names a computed leaf under a node ` +
          `(for example "${spec.recursiveAnchor}${DELIMITER}total").`
        );
      }
      this._definitions.set(key, {
        recursivePath: key,
        suffix,
        get: descriptor.get as () => unknown,
      });
    }
    this._assertNoColliding();
  }

  /**
   * 2 本の `**` getter が同じ具体パスへ展開しないことを、宣言だけから静的に確かめる。
   *
   * 衝突するのは「片方の接尾辞がもう片方の接尾辞の末尾で、差分が反復語の整数倍」の
   * ときだけ（`nodes.**.total` と `nodes.**.children.*.total` は深さ k と k+1 で
   * 同じ `nodes.*.children.*.total` になる）。検出しないと `_definitions` の挿入順で
   * 最初に一致した方が無言で勝つ。
   */
  private _assertNoColliding(): void {
    const definitions = Array.from(this._definitions.values());
    for (let i = 0; i < definitions.length; i++) {
      for (let j = i + 1; j < definitions.length; j++) {
        if (this._sameFamily(definitions[i].suffix, definitions[j].suffix)) {
          raiseError(
            `"${definitions[i].recursivePath}" and "${definitions[j].recursivePath}" expand to the same ` +
            `concrete path at different depths (they differ by whole repetitions of ` +
            `"${this.spec.repeat}"). Rename one of them.`
          );
        }
      }
    }
  }

  get hasDefinitions(): boolean {
    return this._definitions.size > 0;
  }
  /**
   * 2 つの接尾辞が**同じ具体パス族**を指すか。片方がもう片方の末尾で、差分が反復語の
   * 整数倍（0 回を含む）のとき真。`nodes.**.total` と `nodes.**.children.*.total` は
   * 深さ k と k+1 で同じ `nodes.*.children.*.total` になる、という関係を捉える。
   */
  private _sameFamily(a: string, b: string): boolean {
    const unit = DELIMITER + this.spec.repeat;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    if (!longer.endsWith(shorter)) {
      return false;
    }
    const gap = longer.slice(0, longer.length - shorter.length);
    if (gap.length === 0) {
      return true;
    }
    if (gap.length % unit.length !== 0) {
      return false;
    }
    for (let cursor = 0; cursor < gap.length; cursor += unit.length) {
      if (!gap.startsWith(unit, cursor)) {
        return false;
      }
    }
    return true;
  }

  /**
   * その接尾辞が宣言済みの `**` getter と衝突するなら、その getter のパスを返す。
   *
   * 完全一致だけでは足りない。①反復語の整数倍だけ違う接尾辞は同じ族を指す
   * （`_assertNoColliding` が宣言どうしについて既に見ている条件）②getter の**下**を
   * 指す形（`nodes.**.total.x`）は、getter が返したオブジェクトへ書いてキャッシュを
   * 汚し、次の無効化で無言に戻る。どちらも書き込みの入口で止める。
   */
  conflictingRecursiveGetter(suffix: string): string | null {
    for (const definition of this._definitions.values()) {
      if (this._sameFamily(definition.suffix, suffix)) {
        return definition.recursivePath;
      }
      if (suffix.startsWith(definition.suffix + DELIMITER)) {
        return definition.recursivePath;
      }
    }
    return null;
  }

  /**
   * 具体パスを展開形（またはその値の内側）として持つ `**` getter のパス。無ければ null。
   * **実体化はしない。**
   *
   * `conflictingRecursiveGetter` の**具体パス版**で、`**` を経ない 2 つの入口が使う:
   *
   *  - バインド確立時のパス存在検査（`checkDeclaredPath`）。あの時点ではまだ生えて
   *    いないので、素の存在検査では必ず「解決できない」になる。展開形そのもの
   *    （`nodes.*.total`）だけでなく、その値の中を指す形（`nodes.*.stats.count` で
   *    `get "nodes.**.stats"()` がオブジェクトを返す）も、通常の getter の下と同じく
   *    評価しないと分からないので黙る側に倒す。
   *  - 書き込みの入口（`setByAddress`）。`$setAll("nodes.*.children.*.total", [], v)` や
   *    `this["nodes.1.total"] = v` は `**` を含まないので `setAllRecursive` の
   *    読み取り専用検査を通らず、未実体化なら fast path が行オブジェクトへ素の
   *    プロパティとして書いてしまう（ノードを汚し、代入値が `dirty:false` で載って
   *    以後 getter が評価されない）。展開形への書き込みは、実体化の前後に関わらず
   *    `wcs/recursion-readonly` で止める。
   */
  recursiveGetterOwning(concretePath: string): string | null {
    const accessor = this._accessors.get(concretePath);
    if (typeof accessor !== "undefined") {
      return accessor.recursivePath;
    }
    const known = this._ownerByPath.get(concretePath);
    if (typeof known !== "undefined") {
      return known;
    }
    // 添字綴り（`$setAll("nodes.1.total", [], v)` — API のパス引数は set トラップと違って
    // getResolvedAddress の正規化を経ない）は、添字を `*` に畳んでから照合する。畳まないと
    // `nodes[1].total` へ素の値が書かれる（第 3 回レビューで実測）。**無条件に**畳む —
    // 「アンカーで始まらないときだけ」にすると、ワイルドカードと添字の混在綴り
    // （`nodes.*.children.0.total`）がアンカーで始まるせいで畳まれず、`depthOfConcretePath` が
    // `.children.0` を反復単位と認めずに素通りする（第 4 回レビューで実測）。パスごとに初回 1 回。
    const pattern = indexSegmentsToWildcard(concretePath);
    let owner: string | null = null;
    if (pattern.startsWith(this.spec.anchor)) {
      // 展開形そのもの → その値の内側（`.` 境界で切った接頭辞を長い方から）の順に照合する。
      // 接頭辞はアンカーより長いものだけ — アンカー自身は接尾辞が空なので getter になり得ない。
      owner = this._matchExpansion(pattern);
      for (let end = pattern.lastIndexOf(DELIMITER);
           owner === null && end > this.spec.anchor.length;
           end = pattern.lastIndexOf(DELIMITER, end - 1)) {
        owner = this._matchExpansion(pattern.slice(0, end));
      }
    }
    // 定義集合は state の世代内で不変なので、判定は記憶してよい（アンカー外の否定も含む）。
    this._ownerByPath.set(concretePath, owner);
    return owner;
  }

  /** 具体パスが宣言済み `**` getter の展開形そのものなら、その getter のパス。 */
  private _matchExpansion(concretePath: string): string | null {
    for (const definition of this._definitions.values()) {
      if (depthOfConcretePath(this.spec, definition.suffix, concretePath) !== null) {
        return definition.recursivePath;
      }
    }
    return null;
  }

  /**
   * 具体パスが再帰 getter の展開形なら、そのアクセサを（未登録なら生やして）返す。
   * 該当しなければ null。**読みのホットパスから呼ばれる**ので、接頭辞 1 回と
   * 否定の記憶で抜ける。
   */
  materializeFor(stateElement: IStateElement, concretePath: string): IRecursionAccessor | null {
    const known = this._accessors.get(concretePath);
    if (typeof known !== "undefined") {
      return known;
    }
    if (this._nonAccessors.has(concretePath) || !concretePath.startsWith(this.spec.anchor)) {
      return null;
    }
    let matched: IRecursiveGetterDefinition | null = null;
    let matchedDepth = 0;
    for (const definition of this._definitions.values()) {
      const depth = depthOfConcretePath(this.spec, definition.suffix, concretePath);
      if (depth === null) {
        continue;
      }
      if (matched !== null) {
        // コンストラクタの静的検査で弾いているはずの形。保険として先着を無言で採らない。
        raiseError(
          `"${concretePath}" matches both "${matched.recursivePath}" and "${definition.recursivePath}".`
        );
      }
      matched = definition;
      matchedDepth = depth;
    }
    if (matched === null) {
      // 定義集合は state の世代内で不変なので、否定の判定は記憶してよい。
      this._nonAccessors.add(concretePath);
      return null;
    }
    return this._define(stateElement, matched, matchedDepth, concretePath);
  }

  private _define(
    stateElement: IStateElement,
    definition: IRecursiveGetterDefinition,
    depth: number,
    concretePath: string,
  ): IRecursionAccessor {
    // 作者が同じ具体パスを手で定義していないか。**プロトタイプチェーンまで**見る —
    // class 構文の getter は own ではなく prototype に載る（`getStateInfo` が
    // `getterPaths` に拾うのと同じ範囲）。own しか見ないと、生成アクセサが own に
    // 定義されて作者の getter を無言で影にする。前世代の生成物（own・WeakSet に載る
    // get）だけは上書きしてよい。
    const existing = stateElement.findStateDescriptor(concretePath);
    if (typeof existing !== "undefined" && !isGeneratedGetter(existing)) {
      raiseError(
        `"${concretePath}" is already defined on the state, so the recursive getter ` +
        `"${definition.recursivePath}" cannot expand to it. Rename one of them.`
      );
    }
    const accessor: IRecursionAccessor = Object.freeze({
      recursivePath: definition.recursivePath,
      depth,
    });
    const body = definition.get;
    const generated = function (this: unknown): unknown {
      return body.call(this);
    };
    generatedGetters.add(generated);
    // 前世代の生成物が残っていても、登録（getterPaths / setPathInfo / listPaths）は
    // この世代でやり直す必要があるので、descriptor ごと定義し直す。
    stateElement.defineTreeAccessor(concretePath, {
      get: generated,
      enumerable: false,
      configurable: true,
    });
    this._registerListPaths(stateElement, depth);
    this._accessors.set(concretePath, accessor);
    return accessor;
  }

  /**
   * 経路上のリストパスを `listPaths` に載せる（E4）。`setPathInfo(path, "for")` は
   * 使えない — あちらは `elementPaths` にも入れて `setByAddress` の swap 経路
   * （`isSwappable`）を変えてしまう。ここで要るのは「依存ウォークがこのパスを
   * リストとして展開する」ことだけ。
   */
  private _registerListPaths(stateElement: IStateElement, depth: number): void {
    for (const listPath of listPathsUpTo(this.spec, depth)) {
      if (this._registeredListPaths.has(listPath)) {
        continue;
      }
      this._registeredListPaths.add(listPath);
      stateElement.addListPath(listPath);
    }
  }

  /**
   * この世代が生やしたものを忘れる（state の再セット時に呼ぶ）。忘れるのは 2 つ。
   *
   * **依存辺。** `_state` のセッタは `_listPaths` / `_getterPaths` / `_pathSet` をクリアするが、
   * 依存表（`_staticDependency` / `_dynamicDependency`）は state の寿命を越えて残る。
   * 通常のパスはそれで正しい — 同じ綴りのパスは新しい state でも同じ意味を持つ。
   * だが**生成アクセサは違う**。新しい世代ではまだ実体化されておらず、それを指す辺だけが
   * 残ると、次の構造書き込みで依存ウォークが「アクセサの無い具体パス」へ降りて落ちる。
   * 依存表そのものをクリアしてはならない（既存バインディングの辺まで消えて、再セット後の
   * 集計が更新されなくなる — 実測済み）。この世代が作った辺だけを外す。
   *
   * **キャッシュ。** 辺を外した以上、生成アクセサの評価結果も一緒に落とさなければ
   * ならない。同じ state オブジェクト（または同じ配列）を再セットすると、台帳は配列の
   * identity をキーにしているので ListIndex も絶対アドレスも世代を跨いで同一のまま残り、
   * 旧世代の `dirty:false` の値がそのまま次の読みに返る。辺が無いので、次に再帰 getter を
   * 読むまでの間の構造書き込み（`nodes.0.children = […]`）はそれを dirty にできない。
   * 別のオブジェクト・別の配列なら ListIndex が新しく鋳造されるので何も残らない。
   * 落とす対象は旧 state のデータを台帳に沿って辿れば列挙できる（アンカー配下の各深さの
   * 行 × その深さのアクセサ）。
   */
  forgetGenerated(stateElement: IStateElement, previousState: object): void {
    if (this._accessors.size === 0) {
      return;
    }
    const generated = new Set(this._accessors.keys());
    for (const map of [stateElement.staticDependency, stateElement.dynamicDependency]) {
      for (const path of generated) {
        map.delete(path);
      }
      for (const [source, targets] of map) {
        let kept: string[] | null = null;
        for (let i = 0; i < targets.length; i++) {
          if (generated.has(targets[i])) {
            kept ??= targets.slice(0, i);
            continue;
          }
          kept?.push(targets[i]);
        }
        if (kept !== null) {
          if (kept.length === 0) {
            map.delete(source);
          } else {
            map.set(source, kept);
          }
        }
      }
    }
    this._forgetCacheEntries(stateElement, previousState);
  }

  /**
   * 生成アクセサの評価結果のキャッシュを落とす。生成パスごとに、その `wildcardParentPathInfos`
   * （`nodes` / `nodes.*.children` / … に加えて、接尾辞側のリスト `nodes.*.tags` 等）を旧 state の
   * データと台帳に沿って降り、末端の行 ListIndex で絶対アドレスを引く。
   *
   * 深さ方向だけを降りて「ノード行の ListIndex × その深さのパス」で引くのでは足りない —
   * 接尾辞にワイルドカードを持つ getter（`get "nodes.**.tags.*.up"()`）のキャッシュは
   * タグ行の ListIndex（連鎖長 depth+2）に載っていて、ノード行の ListIndex では届かない
   * （第 2 サイクルのレビューで実測: 再セット後の読みが旧値のまま残った）。
   */
  private _forgetCacheEntries(stateElement: IStateElement, previousState: object): void {
    for (const concretePath of this._accessors.keys()) {
      const pathInfo = getPathInfo(concretePath);
      const absPathInfo = getAbsolutePathInfo(stateElement, pathInfo);
      const lists = pathInfo.wildcardParentPathInfos;
      const forget = (owner: unknown, ownerListIndex: IListIndex | null, level: number): void => {
        if (level === lists.length) {
          setCacheEntryByAbsoluteStateAddress(createAbsoluteStateAddress(absPathInfo, ownerListIndex), null);
          return;
        }
        // 直前のリストの行（または state のルート）から、次のリストまでの相対セグメントを辿る
        const from = level === 0 ? 0 : lists[level - 1].segments.length + 1;
        let list: any = owner;
        for (const segment of lists[level].segments.slice(from)) {
          list = list?.[segment];
        }
        if (!Array.isArray(list)) {
          return;
        }
        // 台帳が無い ＝ 走査を一度も経ていないリスト。その行に絶対アドレスは作られていない。
        const rows = getListIndexesByList(list);
        if (rows === null) {
          return;
        }
        const count = Math.min(rows.length, list.length);
        for (let i = 0; i < count; i++) {
          forget(list[i], rows[i], level + 1);
        }
      };
      forget(previousState, null, 0);
    }
  }

  /**
   * `**` 接尾辞の深さ `depth` の具体パス（`concretePathAt` の記憶付き版）。
   * 束縛形の読み（`this["nodes.**.value"]` / 省略形 `$getAll`）は再帰 getter の評価ごとに
   * ここを通るので、深さぶんの文字列連結とワイルドカード数えを毎回やり直さない。
   * 上限は「接尾辞の種類 × 128」で有界（上限超過は `concretePathAt` が throw するので載らない）。
   */
  concretePathAt(suffix: string, depth: number): string {
    let byDepth = this._concreteBySuffix.get(suffix);
    if (typeof byDepth === "undefined") {
      byDepth = [];
      this._concreteBySuffix.set(suffix, byDepth);
    }
    let path = byDepth[depth];
    if (typeof path === "undefined") {
      path = concretePathAt(this.spec, suffix, depth);
      byDepth[depth] = path;
    }
    return path;
  }

  /** 展開済みアクセサのメタデータ（深さ解決・診断・テスト用）。 */
  accessorFor(concretePath: string): IRecursionAccessor | null {
    return this._accessors.get(concretePath) ?? null;
  }

  get materializedPaths(): ReadonlySet<string> {
    return new Set(this._accessors.keys());
  }
}

/** 前世代の生成物か（own に残った生成 getter だけが上書きしてよい）。 */
function isGeneratedGetter(descriptor: PropertyDescriptor): boolean {
  return typeof descriptor.get === "function" && generatedGetters.has(descriptor.get);
}

