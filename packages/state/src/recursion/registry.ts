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

import { IPathInfo } from "../address/types";
import { IStateElement } from "../components/types";
import { DELIMITER } from "../define";
import { getAllPropertyDescriptors } from "../getAllPropertyDescriptors";
import { recursionAnchorMismatchMessage } from "../pathDiagnostics";
import { raiseError } from "../raiseError";
import {
  concretePathAt, coversSuffix, depthOfConcretePath, foldSuffixIndexes, hasRecursionWildcard,
  indexSegmentsToWildcard, isStructuralSuffix, listPathsUpTo, sameFamily, splitRecursivePath,
} from "./expand";
import { forgetGeneration, isGeneratedGetter, markGeneratedGetter } from "./generation";
import { IRecursionAccessor, IRecursionSpec } from "./types";

/** 宣言時（構築時）の診断コード。lint（vscode-wcs）が同じコードで先に出す。 */
const DECLARATION_INVALID = "[wcs/recursion-declaration-invalid]";

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
   * `recursiveGetterOwning` の記憶。キーは添字を `*` に畳んだ形（`nodes.1.total` と `nodes.2.total`
   * は 1 つ）、値は「その具体パスを展開形（またはその値の内側）として持つ `**` getter」、
   * 無ければ null。
   *
   * 有界である: キーは添字を畳んだワイルドカード形のパス文字列で、`PathInfo` が intern する集合
   * （バインディング・getter・API 引数に綴られたパスと、その展開形）の部分集合にしかならない。
   * intern 済みパスの集合が有界であることは D10 で受け入れ済みなので、ここも同じ上限に収まる。
   * 文字列は WeakSet に入らないので、寿命はレジストリ（＝ state の世代）と共にする。
   */
  private readonly _ownerByPath: Map<string, string | null> = new Map();
  /**
   * 書き込みのホットパス（`setByAddress`）向けの記憶。キーは intern 済みの `PathInfo` なので
   * 寿命と上限は PathInfo の intern 集合と同じ（WeakMap）。畳み（split + Number + join）は
   * miss のときだけ払う — 宣言のある state では**アンカー外を含む全書き込み**がここを通る
   * （第 4 サイクルで実測: 畳みを毎回払うと `s.counter = i` で +100ns/書き込み）。
   */
  private readonly _ownerByPathInfo: WeakMap<IPathInfo, string | null> = new WeakMap();
  /**
   * 読みのホットパス（`getByAddress`）向けの記憶。`_ownerByPathInfo` と対称で、キーは
   * intern 済みの `PathInfo`、値は「そのパスの展開アクセサ」、展開形でなければ null。
   * 宣言のある state では**アンカー外を含む全読み**（親ウォークの各段を含む）がここを
   * 通るので、文字列キーの `Map.get` + `Set.has` + `startsWith` を毎回払わせない
   * （第 5 サイクルで実測）。
   *
   * 読みの否定判定の記憶は**ここ 1 つ**（第 5 サイクル再検証で文字列キーの `_nonAccessors` を撤去 —
   * 前段にこの記憶を置いた後は、PathInfo とパス文字列が 1:1 なので二重に持つだけだった）。
   * 否定を記憶してよい根拠は、定義集合が state の世代内で不変であること — 
   * 同じ `PathInfo` は同じパス文字列なので、いちど「展開形でない」と決まった PathInfo が
   * 後から実体化されることはない。実体化した側は `materializeForPathInfo` が
   * `_define` の戻り値でそのまま記憶を更新する（否定が実体化を隠さない）。
   */
  private readonly _accessorByPathInfo: WeakMap<IPathInfo, IRecursionAccessor | null> = new WeakMap();
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
          `${DECLARATION_INVALID} Recursive setters are not supported in this version: "${key}". ` +
          `Declare a plain path setter, or write through the concrete path.`
        );
      }
      if (typeof descriptor.get !== "function") {
        raiseError(
          `${DECLARATION_INVALID} "${key}" contains "**" but is not a getter. ` +
          `The recursion wildcard only names a family of computed paths.`
        );
      }
      const suffix = splitRecursivePath(spec, key);
      if (suffix === null) {
        raiseError(recursionAnchorMismatchMessage(key, spec.recursiveAnchor));
      }
      if (suffix.length === 0) {
        // `get "nodes.**"` は展開すると `nodes.*` そのもの。`getByAddress` は
        // 「パスが target にあるか」を先に見るので、実データの行が丸ごと隠れる。
        raiseError(
          `${DECLARATION_INVALID} "${key}" names the recursive node itself. "**" names a computed path ` +
          `under a node (for example "${spec.recursiveAnchor}${DELIMITER}total"), not the node.`
        );
      }
      // 構造の判定は添字綴り（`get "nodes.**.children.0"()`）も畳んでから掛ける（書き側と同じ）
      if (isStructuralSuffix(spec, foldSuffixIndexes(suffix))) {
        // `get "nodes.**.children"` / `.children.*` / `.children.length` / 多段なら `.branch` は
        // 展開すると実データの子リスト（子ノード・その length・途中のオブジェクト）そのもの。
        // 生成 getter が `getByAddress` の「パスが target にあるか」で勝ち、実データの木を
        // 深さ 1 以下ごと無言で影にする（第 2 サイクルのレビューで実測: `$getAll("nodes.**.value", [])`
        // が `[1, 2]` に縮んだ）。書き側が同じ形を `recursion-structural-write` で拒否するのと対称。
        raiseError(
          `${DECLARATION_INVALID} "${key}" names the recursion structure itself (a node, its ` +
          `"${spec.repeatList}" list or that list's length, or an ` +
          `object on the way to that list). A recursive getter would hide the real child list at every ` +
          `depth — "**" names a computed leaf under a node (for example "${spec.recursiveAnchor}${DELIMITER}total").`
        );
      }
      this._definitions.set(key, {
        recursivePath: key,
        suffix,
        get: descriptor.get as () => unknown,
      });
    }
    this._assertNoColliding();
    this._assertNoConcreteCollision(descriptors);
  }

  /**
   * 作者が手で書いた具体パス（`get "nodes.*.children.*.total"()` / データプロパティ）が、宣言済み
   * `**` getter の展開形と同名でないことを**構築時に**確かめる。
   *
   * `_define` の衝突検査は「その深さを最初に読んだとき」にしか走らないので、データが浅い間は
   * 通り、木が 1 段深くなった瞬間にバインディングが落ちていた（第 3 サイクルのレビューで実測）。
   * 前世代の生成物（own に残った生成 getter）は衝突ではない — 同じ state の再セットで必ず居る。
   */
  private _assertNoConcreteCollision(descriptors: Record<string, PropertyDescriptor>): void {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (hasRecursionWildcard(key) || isGeneratedGetter(descriptor)) {
        continue;
      }
      const owner = this._matchExpansion(key);
      if (owner !== null) {
        raiseError(
          `${DECLARATION_INVALID} "${key}" is already defined on the state, so the recursive getter ` +
          `"${owner}" cannot expand to it. Rename one of them.`
        );
      }
    }
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
        if (sameFamily(this.spec, definitions[i].suffix, definitions[j].suffix)) {
          raiseError(
            `${DECLARATION_INVALID} "${definitions[i].recursivePath}" and "${definitions[j].recursivePath}" ` +
            `expand to the same concrete path at different depths (they differ by whole repetitions of ` +
            `"${this.spec.repeat}"). Rename one of them.`
          );
        }
      }
    }
  }

  /**
   * `**` getter を 1 本でも宣言しているか。
   * **テスト・診断専用**（ランタイムの経路は `_definitions.size` を直接見る）。
   */
  get hasDefinitions(): boolean {
    return this._definitions.size > 0;
  }
  /**
   * その接尾辞が宣言済みの `**` getter と衝突するなら、その getter のパスを返す。
   *
   * 完全一致だけでは足りない。①反復語の整数倍だけ違う接尾辞は同じ族を指す
   * （`_assertNoColliding` が宣言どうしについて既に見ている条件）②getter の**下**を
   * 指す形（`nodes.**.total.x` / 反復語ぶんずれた `nodes.**.children.*.total.x`）は、
   * getter が返したオブジェクトへ書いてキャッシュを汚し、次の無効化で無言に戻る。
   * どちらも書き込みの入口（列挙より前）で止める — 述語は expand.ts の `coversSuffix`。
   */
  conflictingRecursiveGetter(suffix: string): string | null {
    for (const definition of this._definitions.values()) {
      if (coversSuffix(this.spec, definition.suffix, suffix)) {
        return definition.recursivePath;
      }
    }
    return null;
  }

  /**
   * `recursiveGetterOwning` の intern 済み `PathInfo` 版（書き込みのホットパス用）。
   * WeakMap の hit なら畳みも照合も払わない。
   */
  recursiveGetterOwningPath(pathInfo: IPathInfo): string | null {
    const known = this._ownerByPathInfo.get(pathInfo);
    if (typeof known !== "undefined") {
      return known;
    }
    const owner = this.recursiveGetterOwning(pathInfo.path);
    this._ownerByPathInfo.set(pathInfo, owner);
    return owner;
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
    // 添字綴り（`$setAll("nodes.1.total", [], v)` — API のパス引数は set トラップと違って
    // getResolvedAddress の正規化を経ない）は、添字を `*` に畳んでから照合する。畳まないと
    // `nodes[1].total` へ素の値が書かれる（第 3 回レビューで実測）。**無条件に**畳む —
    // 「アンカーで始まらないときだけ」にすると、ワイルドカードと添字の混在綴り
    // （`nodes.*.children.0.total`）がアンカーで始まるせいで畳まれず、`depthOfConcretePath` が
    // `.children.0` を反復単位と認めずに素通りする（第 4 回レビューで実測）。
    // 記憶のキーは畳んだ形 — 添字綴りのまま記憶すると綴りの数だけ単調に増える。
    const pattern = indexSegmentsToWildcard(concretePath);
    const known = this._ownerByPath.get(pattern);
    if (typeof known !== "undefined") {
      return known;
    }
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
    this._ownerByPath.set(pattern, owner);
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
   * `materializeFor` の `PathInfo` 版。**読みのホットパス（`getByAddress`）専用**で、
   * 判定そのものは `materializeFor` に委ね、結果（否定を含む）を PathInfo に記憶する。
   * 書き側の `recursiveGetterOwningPath` と対称。
   */
  materializeForPathInfo(stateElement: IStateElement, pathInfo: IPathInfo): IRecursionAccessor | null {
    // `**` getter の無い宣言（レジストリは空）は、記憶を作らずに抜ける
    if (this._definitions.size === 0) {
      return null;
    }
    const known = this._accessorByPathInfo.get(pathInfo);
    if (typeof known !== "undefined") {
      return known;
    }
    const accessor = this.materializeFor(stateElement, pathInfo.path);
    this._accessorByPathInfo.set(pathInfo, accessor);
    return accessor;
  }

  /**
   * 具体パスが再帰 getter の展開形なら、そのアクセサを（未登録なら生やして）返す。
   * 該当しなければ null。読みは `materializeForPathInfo` を通るので、ここへ来るのは
   * 記憶が外れたときだけ — 判定は接頭辞 1 回で抜け、ここでは否定を記憶しない（記憶は
   * `materializeForPathInfo` の PathInfo キーの 1 か所）。
   * （`**` getter の無い空レジストリを弾くのは呼び出し側の役目。）
   */
  materializeFor(stateElement: IStateElement, concretePath: string): IRecursionAccessor | null {
    const known = this._accessors.get(concretePath);
    if (typeof known !== "undefined") {
      return known;
    }
    if (!concretePath.startsWith(this.spec.anchor)) {
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
    markGeneratedGetter(generated);
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
   * この世代が生やしたもの（own の生成アクセサ・依存辺・キャッシュ）を忘れる（state の
   * 再セット時、`getStateInfo` の再収集より**前**に呼ぶ）。実体は generation.ts。
   */
  forgetGenerated(stateElement: IStateElement, previousState: object): ReadonlySet<string> {
    const generatedPaths: ReadonlySet<string> = new Set(this._accessors.keys());
    forgetGeneration(stateElement, previousState, generatedPaths);
    // 忘れた具体パスを返す。`_state` のセッタは経路情報を作り直すときにこれを除く —
    // この世代ではまだ実体化されていないので、辺だけ張り直してはならない。
    return generatedPaths;
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

  /**
   * これまでに実体化した具体パスの一覧。**テスト専用**（「読んだ深さだけが生える」という
   * 遅延実体化の不変条件を外から確かめる口。ランタイムはどの経路からも呼ばない）。
   */
  get materializedPaths(): ReadonlySet<string> {
    return new Set(this._accessors.keys());
  }
}

