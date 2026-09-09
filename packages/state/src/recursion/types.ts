import { IPathInfo } from "../address/types";

/**
 * 単一の自己再帰宣言。初版はアンカーと反復サブパスとも「固定プロパティ列の末尾に
 * `.*` がひとつ」の形に限定する（docs/state-recursive-path-impl-plan.md §1-1）。
 *
 * 例: `$recursion = { "nodes.*": "children.*" }`
 * - `anchor`      … `"nodes.*"`（深さ 0 のノードパス）
 * - `repeat`      … `"children.*"`（1 段深くする相対サブパス）
 */
export interface IRecursionSpec {
  readonly anchor: string;
  readonly repeat: string;
  /** `anchor` の `**` 形（`"nodes.**"`）。オーサリング層のパス解析で使う。 */
  readonly recursiveAnchor: string;
}

/** 展開済みの再帰 getter 1 本ぶんの素性。生成アクセサに紐づくメタデータ。 */
export interface IRecursionAccessor {
  /** 元の宣言（`"nodes.**.total"`） */
  readonly recursivePath: string;
  /** 展開後の具体パス（`"nodes.*.children.*.total"`） */
  readonly concretePath: string;
  /** 反復の段数（0 origin） */
  readonly depth: number;
  readonly spec: IRecursionSpec;
  readonly pathInfo: IPathInfo;
}

/** `**` を含むパスを (接頭辞, 接尾辞) に割ったもの。 */
export interface IRecursivePathParts {
  readonly spec: IRecursionSpec;
  /** `**` より後ろ（`".total"`。無ければ空文字） */
  readonly suffix: string;
}
