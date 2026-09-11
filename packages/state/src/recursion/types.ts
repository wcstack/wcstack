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

/**
 * 展開済みの再帰 getter 1 本ぶんの素性。生成アクセサに紐づくメタデータで、
 * ランタイムが読むのは深さ（`**` の束縛）と元の宣言（診断の名指し）の 2 つだけ。
 * 具体パスは台帳のキー、`PathInfo` は読む側が intern 済みのものを持つので、ここには
 * 重ねて持たない。
 */
export interface IRecursionAccessor {
  /** 元の宣言（`"nodes.**.total"`） */
  readonly recursivePath: string;
  /** 反復の段数（0 origin） */
  readonly depth: number;
}

/** `**` を含むパスを (接頭辞, 接尾辞) に割ったもの。 */
export interface IRecursivePathParts {
  /** `**` より後ろ（`".total"`。無ければ空文字） */
  readonly suffix: string;
}
