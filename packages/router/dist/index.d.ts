interface ITagNames {
    readonly route: string;
    readonly router: string;
    readonly outlet: string;
    readonly layout: string;
    readonly layoutOutlet: string;
    readonly link: string;
    readonly head: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
    readonly enableShadowRoot: boolean;
    readonly basenameFileExtensions: ReadonlyArray<string>;
}

declare const config: IConfig;

declare function registerComponents(): void;

declare class Head extends HTMLElement {
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
     * document.head内の全ての要素をスキャンして保存する
     */
    private _captureInitialHead;
    /**
     * スタック全体からheadを再構築
     * 後のHeadが優先される（上書き）
     */
    private _reapplyHead;
}

export { Head, config, registerComponents };
