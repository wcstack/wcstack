/**
 * connectedCallback.ts
 *
 * StateClassのライフサイクルフック「$connectedCallback」を呼び出すユーティリティ関数です。
 *
 * 主な役割:
 * - オブジェクト（target）に$connectedCallbackメソッドが定義されていれば呼び出す
 * - コールバックはtargetのthisコンテキストで呼び出し、IReadonlyStateProxy（receiver）を引数として渡す
 * - 非同期関数として実行可能（await対応）
 *
 * 設計ポイント:
 * - Reflect.getで$connectedCallbackプロパティを安全に取得
 * - 存在しない場合は何もしない
 * - ライフサイクル管理やカスタム初期化処理に利用
 */
const CONNECTED_CALLBACK = "$connectedCallback";
export async function connectedCallback(target, _prop, receiver, _handler) {
    const callback = Reflect.get(target, CONNECTED_CALLBACK);
    if (typeof callback === "function") {
        await callback.call(receiver);
    }
}
//# sourceMappingURL=connectedCallback.js.map