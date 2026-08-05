import { ILoopContextStack } from "../list/types";
import { IStateProxy, Mutability } from "../proxy/types";
import { BindingType } from "../types";

export interface IStateElement {
  readonly name: string;
  /**
   * state のロードが完了しているか。`initializePromise` の同期版で、
   * DCC のアクセサが「今すぐ読み書きしてよいか」を判断するのに使う。
   * optional なのはテスト用モック互換のため（undefined は「不明＝未初期化扱い」）。
   */
  readonly initialized?: boolean;
  readonly initializePromise: Promise<void>;
  readonly connectedCallbackPromise: Promise<void>;
  readonly listPaths: Set<string>;
  readonly elementPaths: Set<string>;
  readonly getterPaths: Set<string>;
  readonly setterPaths: Set<string>;
  readonly loopContextStack: ILoopContextStack;
  readonly dynamicDependency: Map<string, string[]>;
  readonly staticDependency: Map<string, string[]>;
  readonly version: number;
  readonly rootNode: Node;
  readonly boundComponentStateProp: string | null;
  /**
   * DCC の `$bindables` から生成した「パス → 変更イベント名」表。
   * 唯一の書き手は defineDCC で、読み手は setByAddress。
   * getter だけを公開して setter をインターフェースから落としていたため
   * defineDCC が具象 State に依存していた（§3.5）。
   */
  readonly bindableEventMap: Record<string, string>;
  setBindableEventMap(map: Record<string, string>): void;
  readonly commandTokenNames: ReadonlySet<string>;
  readonly eventTokenNames: ReadonlySet<string>;
  /**
   * state が $updatedCallback を定義しているか。false のとき drain は更新
   * アドレスの集計と最終の writable createState を丸ごとスキップできる。
   * optional なのはテスト用モック互換のため（undefined は「不明＝集計する」）。
   */
  readonly hasUpdatedCallback?: boolean;
  /**
   * 他行を読む getter（隣接項目参照など）が検出されたリストパスの集合。
   * これらのリストは walkDependency の diff-filter 展開の対象外（全行展開）。
   * optional なのはテスト用モック互換のため（undefined は「検出なし」扱い）。
   */
  readonly crossRowListPaths?: ReadonlySet<string>;
  addCrossRowListPath?(path: string): void;
  /**
   * 評価中に $1 等のインデックスを読んだ getter パスの集合（実行時検出）。
   * 位置だけが変わった行（listDiff.changeIndexSet）は index 以外の入力が不変なので、
   * walkDependency の静的子展開をこの集合の subtree に限定できる。
   * optional なのはテスト用モック互換のため（undefined は「検出なし」扱い）。
   */
  readonly indexDependentGetterPaths?: ReadonlySet<string>;
  addIndexDependentGetterPath?(path: string): void;
  setPathInfo(path: string, bindingType: BindingType): void;
  addStaticDependency(parentPath: string, childPath: string): boolean;
  addDynamicDependency(fromPath: string, toPath: string): boolean;
  createStateAsync(mutability: Mutability, callback: (state: IStateProxy) => Promise<void>): Promise<void>;
  createState(mutability: Mutability, callback: (state: IStateProxy) => void): void;
  nextVersion(): number;
  bindProperty(prop: string, desc: PropertyDescriptor): void;
  setInitialState(state: Record<string, any>): void;
}

