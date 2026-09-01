import { ListKeyMap } from "../list/listKeys";
import { ILoopContextStack } from "../list/types";
import type { PathInfoSource } from "../pathDiagnostics";
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
  /**
   * この state element が今使えるか（＝ 接続済みで rootNode を保持しているか）。
   * `createState` は rootNode を要求するので、false のときに呼ぶと raiseError する。
   * 台帳に載っていること（登録済み）と使えることは別で、要素をキーにした台帳には
   * 切断済みの state element が残る窓がある（§1.9）。
   * optional なのはテスト用モック互換のため（undefined は「不明＝使える扱い」）。
   */
  readonly hasRootNode?: boolean;
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
   * `bind-component` で束ねられているコンポーネント要素（親スコープ側のノード）。
   * マッピング規則の引き当てに使う。optional なのはテスト用モック互換のため。
   */
  readonly boundComponent?: Element | null;
  /**
   * この state の実体が innerState proxy（＝ 値の正本が親スコープの state にある
   * mapped な `bind-component`）か。真のときだけ越境アドレスの受け渡しと
   * リストパスの外向き伝播が働く（§1.8）。
   * optional なのはテスト用モック互換のため（undefined は plain 扱い）。
   */
  readonly hasMappedComponentState?: boolean;
  markComponentStateMapped?(): void;
  /**
   * この state 要素に束ねられた（`setPathInfo` を通った）パスの集合。丸ごとマウント
   * （ルート規則）の親→子通知が「登録済みパス全部を読み直せ」を組み立てるのに使う
   * （webComponent/rootReloadPaths.ts）。
   * optional なのはテスト用モック互換のため（undefined は「登録なし」扱い）。
   */
  readonly boundPaths?: ReadonlySet<string>;
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
  /**
   * `$listKeys` 宣言から生成した「リストパス → キー指定」表。
   * 宣言が無ければ null / undefined で、setByAddress のキー突合経路に一切入らない
   * （docs/state-list-key-design.md §7-1 のゼロコスト契約）。
   * optional なのはテスト用モック互換のため（undefined は「宣言なし」扱い）。
   */
  readonly listKeys?: ListKeyMap | null;
  /**
   * `$watch` 宣言から生成した監視対象パスの集合。
   * 宣言が無ければ null / undefined で、setByAddress の旧値キャプチャには一切入らない
   * （docs/state-watch-hook-design.md §10 のゼロコスト契約）。
   * optional なのはテスト用モック互換のため（undefined は「宣言なし」扱い）。
   */
  readonly watchPaths?: ReadonlySet<string> | null;
  /**
   * パスを依存グラフへ登録する。DOM バインディング登録（BindingSession）のほか、
   * `$watch` 宣言（processWatchDeclaration）からも呼ばれる — 静的依存グラフに
   * 載るのがバインド済みパスだけだと headless 購読が成立しないため（設計書 §8）。
   *
   * `source` は存在検査の診断 code と適用範囲を決める（pathDiagnostics.ts）。
   * 省略時は `"binding"`（テスト用モック互換のため optional）。
   */
  setPathInfo(path: string, bindingType: BindingType, source?: PathInfoSource): void;
  addStaticDependency(parentPath: string, childPath: string): boolean;
  addDynamicDependency(fromPath: string, toPath: string): boolean;
  createStateAsync(mutability: Mutability, callback: (state: IStateProxy) => Promise<void>): Promise<void>;
  createState(mutability: Mutability, callback: (state: IStateProxy) => void): void;
  nextVersion(): number;
  bindProperty(prop: string, desc: PropertyDescriptor): void;
  setInitialState(state: Record<string, any>): void;
}

