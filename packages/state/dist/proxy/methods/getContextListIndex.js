/**
 * getContextListIndex.ts
 *
 * StateClassの内部APIとして、現在のプロパティ参照スコープにおける
 * 指定したstructuredPath（ワイルドカード付きプロパティパス）に対応する
 * リストインデックス（IListIndex）を取得する関数です。
 *
 * 主な役割:
 * - handlerの最後にアクセスされたStatePropertyRefから、指定パスに対応するリストインデックスを取得
 * - ワイルドカード階層に対応し、多重ループやネストした配列バインディングにも利用可能
 *
 * 設計ポイント:
 * - 直近のプロパティ参照情報を取得
 * - info.wildcardPathsからstructuredPathのインデックスを特定
 * - listIndex.at(index)で該当階層のリストインデックスを取得
 * - パスが一致しない場合や参照が存在しない場合はnullを返す
 */
export function getContextListIndex(handler, structuredPath) {
    const address = handler.lastAddressStack;
    if (address == null) {
        return null;
    }
    if (address.pathInfo == null) {
        return null;
    }
    if (address.listIndex == null) {
        return null;
    }
    const index = address.pathInfo.indexByWildcardPath[structuredPath];
    if (typeof index !== "undefined") {
        return address.listIndex.at(index);
    }
    return null;
}
//# sourceMappingURL=getContextListIndex.js.map