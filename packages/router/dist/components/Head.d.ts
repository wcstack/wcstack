export declare class Head extends HTMLElement {
    private _initialized;
    private _childElementArray;
    constructor();
    private _initialize;
    connectedCallback(): void;
    disconnectedCallback(): void;
    get childElementArray(): Element[];
    /**
     * 要素の一意キーを生成
     */
    private _getKey;
    /**
     * head内で指定のキーに一致する要素を検索
     */
    private _findInHead;
    /**
     * 初期の<head>状態をキャプチャ
     */
    private _captureInitialHead;
    /**
     * スタック全体からheadを再構築
     * 後のHeadが優先される（上書き）
     */
    private _reapplyHead;
}
export declare function _resetHeadStack(): void;
//# sourceMappingURL=Head.d.ts.map