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

import { getPathInfo } from "../address/PathInfo";
import { IStateElement } from "../components/types";
import { DELIMITER } from "../define";
import { getAllPropertyDescriptors } from "../getAllPropertyDescriptors";
import { raiseError } from "../raiseError";
import { concretePathAt, depthOfConcretePath, hasRecursionWildcard, listPathsUpTo, splitRecursivePath } from "./expand";
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
  /** 「再帰 getter の展開形ではない」と分かったパス。読みのホットパスの否定判定を記憶する。 */
  private readonly _nonAccessors: Set<string> = new Set();
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
      const parts = splitRecursivePath(spec, key);
      if (parts === null) {
        raiseError(
          `"${key}" does not match the declared recursion anchor "${spec.recursiveAnchor}". ` +
          `This version supports exactly one anchor, and no second "**" in the same path.`
        );
      }
      if (parts.suffix.length === 0) {
        // `get "nodes.**"` は展開すると `nodes.*` そのもの。`getByAddress` は
        // 「パスが target にあるか」を先に見るので、実データの行が丸ごと隠れる。
        raiseError(
          `"${key}" names the recursive node itself. "**" names a computed path under a node ` +
          `(for example "${spec.recursiveAnchor}${DELIMITER}total"), not the node.`
        );
      }
      this._definitions.set(key, {
        recursivePath: key,
        suffix: parts.suffix,
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

  /** 既にこの深さのアクセサを生やしてあるか（読みの早期 return 用）。 */
  isMaterialized(concretePath: string): boolean {
    return this._accessors.has(concretePath);
  }

  /**
   * 実体化せずに「宣言済み `**` getter の展開形か」だけを答える。
   * バインド確立時のパス存在検査（`checkDeclaredPath`）が使う — あの時点では
   * まだ生えていないので、素の存在検査では必ず「解決できない」になってしまう。
   */
  matchesRecursivePath(concretePath: string): boolean {
    if (this._accessors.has(concretePath)) {
      return true;
    }
    if (!concretePath.startsWith(this.spec.anchor)) {
      return false;
    }
    for (const definition of this._definitions.values()) {
      if (depthOfConcretePath(this.spec, definition.suffix, concretePath) !== null) {
        return true;
      }
    }
    return false;
  }

  /** `**` を含むパスを深さ `depth` の具体パスにする。宣言外なら raise。 */
  concretePath(recursivePath: string, depth: number): string {
    const parts = splitRecursivePath(this.spec, recursivePath);
    if (parts === null) {
      raiseError(
        `"${recursivePath}" does not match the declared recursion anchor "${this.spec.recursiveAnchor}".`
      );
    }
    return concretePathAt(this.spec, parts.suffix, depth);
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
    const existing = stateElement.getOwnStateDescriptor(concretePath);
    const existingGet = existing?.get;
    if (typeof existingGet === "function" && !generatedGetters.has(existingGet)) {
      // 作者が同じ具体パスの getter を手で書いている。自動生成で上書きしない。
      raiseError(
        `"${concretePath}" is already defined on the state, so the recursive getter ` +
        `"${definition.recursivePath}" cannot expand to it. Rename one of them.`
      );
    }
    const accessor: IRecursionAccessor = Object.freeze({
      recursivePath: definition.recursivePath,
      concretePath,
      depth,
      spec: this.spec,
      pathInfo: getPathInfo(concretePath),
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

  /** 展開済みアクセサのメタデータ（深さ解決・診断・テスト用）。 */
  accessorFor(concretePath: string): IRecursionAccessor | null {
    return this._accessors.get(concretePath) ?? null;
  }

  get materializedPaths(): ReadonlySet<string> {
    return new Set(this._accessors.keys());
  }
}
