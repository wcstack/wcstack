/**
 * getByAddress.ts
 *
 * StateClassの内部APIとして、構造化パス情報（IStructuredPathInfo）とリストインデックス（IListIndex）を指定して
 * 状態オブジェクト（target）から値を取得するための関数（getByAddress）の実装です。
 *
 * 主な役割:
 * - 指定されたパス・インデックスに対応するState値を取得（多重ループやワイルドカードにも対応）
 * - 依存関係の自動登録（checkDependencyで登録）
 * - キャッシュ機構（リストもキャッシュ対象）
 * - getter経由で値取得時はpushAddressでスコープを一時設定
 * - 存在しない場合は親pathAddressやlistIndexを辿って再帰的に値を取得
 *
 * 設計ポイント:
 * - checkDependencyで依存追跡を実行
 * - キャッシュ有効時はstateAddressで値をキャッシュし、取得・再利用を最適化
 * - ワイルドカードや多重ループにも柔軟に対応し、再帰的な値取得を実現
 * - finallyでキャッシュへの格納を保証
 */
import { IStateAddress } from "../../address/types";
import { IStateHandler } from "../types";
export declare function getByAddress(target: object, address: IStateAddress, receiver: any, handler: IStateHandler): any;
//# sourceMappingURL=getByAddress.d.ts.map