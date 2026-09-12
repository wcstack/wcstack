export interface ICacheEntry {
  readonly value: unknown;
  dirty: boolean;
  /**
   * この項目を載せた state の世代（`IStateElement.stateGeneration`）。
   *
   * 絶対アドレスは (stateElement, pathInfo, listIndex) で intern されるので、state を
   * 再セットしても**同じアドレスのまま**になる。世代印が無いと、旧世代に `dirty:false` で
   * 載った値が新世代の読みにそのまま返り、getter が一度も評価されないので依存辺も
   * 張り直されない（issue #258 の X10）。読みは現世代と一致する項目だけをヒットとする。
   *
   * optional なのはテスト用モック互換のため。世代を持たない state 要素が載せた項目は
   * `undefined === undefined` でヒットし続ける（`__tests__/proxy.getByAddress.test.ts` の
   * 「キャッシュがある場合はキャッシュを返すこと」が固定する）。既定値は**書かない** —
   * 到達不能な分岐を作らない。
   */
  readonly generation?: number;
}
