/**
 * list/listKeys.ts
 *
 * `$listKeys: { <listPath>: <fieldName | (row) => key> }` 宣言マップを解析し、
 * 「リストパス → キー指定」表を構築する（docs/state-list-key-design.md §3）。
 *
 * この表が存在するリストパスへの配列代入は、setByAddress でキー突合され、
 * 一致行は旧オブジェクトを据え置いたまま変化フィールドだけが per-path 書き込みで
 * 流し込まれる（§2）。未宣言なら書き込み経路は従来と完全に同一。
 *
 * 「そのパスが実際にリストか」は宣言時には判定できない（listPaths は
 * バインディング収集時に確定する）。実行時に配列でなければ経路に入らないだけで、
 * 宣言自体はエラーにしない。
 */

/** キー指定: フラットなフィールド名、または行から複合キーを作る関数 */
type ListKeySpec = string | ((row: any) => unknown);
type ListKeyMap = ReadonlyMap<string, ListKeySpec>;

/**
 * Interface for hierarchical loop index management in nested loops.
 * Tracks parent-child relationships, versions, and provides access to index hierarchy.
 */
interface IListIndex {
    readonly parentListIndex: IListIndex | null;
    readonly uuid: string;
    readonly position: number;
    readonly length: number;
    index: number;
    readonly version: number;
    readonly dirty: boolean;
    readonly indexes: number[];
    readonly listIndexes: WeakRef<IListIndex>[];
    readonly varName: string;
    at(position: number): IListIndex | null;
}
interface ILoopContext extends IStateAddress {
    readonly pathInfo: IPathInfo;
    readonly listIndex: IListIndex;
}
interface ILoopContextStack {
    createLoopContext(elementStateAddress: IStateAddress, callback: (loopContext: ILoopContext) => void | Promise<void>): void | Promise<void>;
}

declare const setLoopContextSymbol: unique symbol;
declare const getByAddressSymbol: unique symbol;
declare const hasByAddressSymbol: unique symbol;
declare const setByAddressSymbol: unique symbol;
declare const connectedCallbackSymbol: unique symbol;
declare const disconnectedCallbackSymbol: unique symbol;
declare const updatedCallbackSymbol: unique symbol;
declare const errorCallbackSymbol: unique symbol;

interface IStateHandler extends ProxyHandler<IState> {
    readonly stateElement: IStateElement;
    readonly addressStackLength: number;
    /**
     * アドレススタックの先頭（いま評価しているアドレス）。ループ文脈の無いスコープでは null。
     * 再帰の深さ解決（recursion/bind.ts）もここだけを見る — 添字の供給元
     * （getContextListIndex / `$getAll` の省略形）が先頭しか見ないので、深さだけを外側の
     * フレームから拾うと「深さはあるが行が無い」定義にない状態になる。
     */
    readonly lastAddressStack: IStateAddress | null;
    readonly loopContext: ILoopContext | null | undefined;
    /**
     * 依存追跡の抑止中か。$untrackDependency のスコープ内、および setter 実行中
     * （setter は命令的な代入であって派生ではないため、その中の読み取りで依存を
     * 張らない）は true。checkDependency / $1 インデックス依存の登録が抑止される。
     */
    readonly untracking: boolean;
    /**
     * このプロキシの書き込み能力。書き込み API の入口（proxy/assertWritable.ts）が検査する — set
     * トラップを通らない `$resolve` / `$setAll` も readonly では書けない（要件 B6）。省略は writable。
     */
    readonly mutability?: Mutability;
    pushAddress(address: IStateAddress | null): void;
    popAddress(): IStateAddress | null;
    setLoopContext(loopContext: ILoopContext | null): void;
    clearLoopContext(): void;
    beginUntrack(): void;
    endUntrack(): void;
}
interface IStateProxy extends IState {
    [setLoopContextSymbol](loopContext: ILoopContext | null, callback: () => any): any;
    [getByAddressSymbol](address: IStateAddress): any;
    [hasByAddressSymbol](address: IStateAddress): boolean;
    [setByAddressSymbol](address: IStateAddress, value: any): void;
    [connectedCallbackSymbol](): Promise<void>;
    [disconnectedCallbackSymbol](): void;
    [updatedCallbackSymbol](updatedAbsAddressList: IAbsoluteStateAddress[]): void;
    [errorCallbackSymbol](error: unknown, info: IBindingErrorInfo): void;
}
type Mutability = "readonly" | "writable";

/**
 * Filter/types.ts
 *
 * Type definition file for filter functions.
 *
 * Main responsibilities:
 * - Defines types for filter functions (FilterFn) and filter functions with options (FilterWithOptionsFn)
 * - Type-safe management of filter name-to-function mappings (FilterWithOptions) and filter function arrays (Filters)
 * - Defines types for retrieving filter functions from built-in filter collections
 *
 * Design points:
 * - Type design enabling flexible filter design and extension
 * - Supports filters with options and combinations of multiple filters
 */
type FilterFn<T = unknown> = (value: unknown) => T;

interface IContent {
    readonly firstNode: Node | null;
    readonly lastNode: Node | null;
    readonly mounted: boolean;
    appendTo(targetNode: Node): void;
    mountAfter(targetNode: Node): void;
    unmount(): void;
    /**
     * 自分のノードを DOM に残したままの解体（#4）。行の置き換えで `for` が同じ位置の Content を
     * 新しい行に使い回すとき、入力中の欄を DOM から外さずに unmount と同じ後始末をする。
     */
    unmountInPlace(): void;
    /**
     * wholesale 破棄: 全行クリアで再利用されない content の binding teardown
     * （listener 解除・アドレス台帳・loopContext 掃除）を省略し、ノード・binding
     * もろとも GC に任せる。定義待ち等の副作用がある場合は false を返し、呼び出し側が
     * 従来経路（deactivate + unmount）で解体する。
     */
    tryDestroy(): boolean;
}

/**
 * core/addressHooks.ts — 読み書き境界の受け口（設計案 H1、S3）。
 *
 * 機能は `install()` でレジストリに hook 実装を置く（hot path には触れない）。state 要素は
 * 宣言が要求する機能の hook だけを `attachAddressHooks` で自分に付け、core の各受け口は
 * `stateElement.addressHooks` が null なら判定 1 回で抜ける
 * （調査 §10.8: 大域配列の走査は読み +40%、state ごとの門なら +0.1 ns）。
 * 宣言が要求する機能が未 install なら `requireFeature` が宣言時に throw する（readiness barrier、D13）。
 *
 * 受け口（core 側の呼び出し点）:
 *   read         getByAddress の先頭（キャッシュより前）。名前空間・マーカーなど raw state に無い値を答える
 *   readMissing  getByAddress で「ツリーにそのキーが無い」と分かった点（親の値つき。親が無ければ null）
 *   write        setByAddress の先頭。書き込みを奪うか、禁止して throw する
 *   writeMissing setByAddress の fast path で「親にそのキーが無い」と分かった点（公開 getter への書き込み）
 *   writeObserve 旧値が分かった点（同値ガードの直後）。旧値の台帳を持つ機能が読む
 *   written      書き込み・`$postUpdate` の後。観測面へ通知する機能が読む
 *   swapped      要素の入れ替えで行が動いた点（旧値の台帳を行に追従させる）
 *   get          get トラップの文字列プロパティ先頭。API・名前空間・パスの翻訳を答える
 *   indexShift   `$n` の解決点。スコープ相対の段ずれを足す
 *   handlerScope イベントハンドラの添字の段数を決める点
 *   updated      `$updatedCallback` の後。相対配送する機能が読む
 *   suppressPathDiagnostic  束縛時の未宣言パス診断を黙らせるか（予約済みスロットの配下など）
 *   rowReused    その場で使い回した行（DOM から外れない）の点。行の中のスコープを新しい listIndex へ張り直す
 */

type ReadHook = (stateElement: IStateElement, address: IStateAddress, receiver: any, handler: IStateHandler) => unknown;
type ReadMissingHook = (stateElement: IStateElement, address: IStateAddress, parentValue: object | null, receiver: any, handler: IStateHandler) => unknown;
type WriteHook = (stateElement: IStateElement, address: IStateAddress, value: unknown, receiver: any, handler: IStateHandler) => unknown;
type WriteMissingHook = (stateElement: IStateElement, address: IStateAddress, parentValue: object, key: PropertyKey, value: unknown, receiver: any, handler: IStateHandler) => unknown;
type WriteObserveHook = (stateElement: IStateElement, path: string, absAddress: IAbsoluteStateAddress, oldValue: unknown, hasOldValue: boolean) => void;
type WrittenHook = (stateElement: IStateElement, pathInfo: IPathInfo, detail?: {
    readonly value: unknown;
}) => void;
type SwappedHook = (stateElement: IStateElement, elementAbsAddress: IAbsoluteStateAddress, displacedAbsAddress: IAbsoluteStateAddress) => void;
type GetHook = (handler: IStateHandler, prop: string, receiver: any, target: object) => unknown;
type IndexShiftHook = (handler: IStateHandler, lastAddress: IStateAddress) => number;
type HandlerScopeHook = (stateElement: IStateElement, node: Node, rootNode: Node, loopContext: ILoopContext, wildcardCount: number) => number;
type UpdatedHook = (stateElement: IStateElement, refs: IAbsoluteStateAddress[], receiver: any) => void;
type SuppressPathDiagnosticHook = (stateElement: IStateElement, path: string) => boolean;
type RowReusedHook = (stateElement: IStateElement, content: IContent) => void;
interface IAddressHooks {
    readonly read?: ReadHook;
    readonly readMissing?: ReadMissingHook;
    readonly write?: WriteHook;
    readonly writeMissing?: WriteMissingHook;
    readonly writeObserve?: WriteObserveHook;
    readonly written?: WrittenHook;
    readonly swapped?: SwappedHook;
    readonly get?: GetHook;
    readonly indexShift?: IndexShiftHook;
    readonly handlerScope?: HandlerScopeHook;
    readonly updated?: UpdatedHook;
    readonly suppressPathDiagnostic?: SuppressPathDiagnosticHook;
    readonly rowReused?: RowReusedHook;
}
/** state 要素に付いた hook 群（種類ごとに、機能の登録順） */
type IAttachedHooks = {
    readonly [K in keyof Required<IAddressHooks>]: NonNullable<IAddressHooks[K]>[];
};

/**
 * pathDiagnostics.ts — パスに関する**エラーの文言**（throw する側）と、診断の両面が共有する部品。
 *
 * 束縛時の存在検査（`user.nmae` のような打ち間違いを console.warn で知らせる開発時の診断）は
 * `features/diagnostics` へ分けた（diagnostics/pathChecks.ts）。core に残るのは、実行を止める
 * エラーの文言と、その did-you-mean が使う候補の集め方だけ。エラーは機能の有無に関わらず
 * 読める文言で落ちなければならないので、ここは core から外せない。
 *
 * 診断 code はコンソール → lint → IDE の三面で共有する（errorGuidance.ts の規約）。
 */
/** `setPathInfo` の呼び出し元の種別。診断 code と適用範囲がこれで変わる */
type PathInfoSource = 
/** data-wcs / mustache / コメントバインディング */
"binding"
/** `$watch` の宣言キー */
 | "watch"
/** `$scan` の `from` / `resetOn`（docs/state-scan-design.md §2-4） */
 | "scan"
/** ランタイム内部のパス翻訳（mapped な bind-component の外向き伝播）。検査しない */
 | "internal";

/**
 * 単一の自己再帰宣言。初版はアンカーと反復サブパスとも「固定プロパティ列の末尾に
 * `.*` がひとつ」の形に限定する（docs/state-recursive-path-impl-plan.md §1-1）。
 *
 * 例: `$recursion = { "nodes.*": "children.*" }`
 * - `anchor`         … `"nodes.*"`（深さ 0 のノードパス）
 * - `repeat`         … `"children.*"`（1 段深くする相対サブパス）
 * - `recursiveAnchor` … `"nodes.**"`
 * - `anchorList`     … `"nodes"`
 * - `repeatList`     … `"children"`
 *
 * リスト側の 2 つは宣言時に確定させる（静的側の `RecursionSpec` と同じ構成）。
 * 各所で `lastIndexOf(DELIMITER)` の slice を繰り返すと、綴りの取り違えが分散する。
 */
interface IRecursionSpec {
    readonly anchor: string;
    readonly repeat: string;
    /** `anchor` の `**` 形（`"nodes.**"`）。オーサリング層のパス解析で使う。 */
    readonly recursiveAnchor: string;
    /** `anchor` のリスト側（`"nodes"` — 末尾の `.*` を落とした形）。 */
    readonly anchorList: string;
    /** `repeat` のリスト側（`"children"`）。 */
    readonly repeatList: string;
}
/**
 * 展開済みの再帰 getter 1 本ぶんの素性。生成アクセサに紐づくメタデータで、
 * ランタイムが読むのは深さ（`**` の束縛）と元の宣言（診断の名指し）の 2 つだけ。
 * 具体パスは台帳のキー、`PathInfo` は読む側が intern 済みのものを持つので、ここには
 * 重ねて持たない。
 */
interface IRecursionAccessor {
    /** 元の宣言（`"nodes.**.total"`） */
    readonly recursivePath: string;
    /** 反復の段数（0 origin） */
    readonly depth: number;
}

/**
 * recursion/registry.ts
 *
 * state 1 つぶんの再帰レジストリ。宣言・`**` getter の定義・展開済みアクセサの台帳を
 * 持ち、「具体パスを読む直前に、その深さのアクセサを生やす」遅延実体化を担う。
 *
 * 遅延であることは実装の**不変条件**である（Phase A の A6/A7）。そのパスを一度でも
 * 読んでから生やしても、`isCacheable` が `wildcardCount > 0` だけでキャッシュ可を返す
 * ため `undefined` が `dirty:false` で固定され、以後どう書いても回復しない。
 * したがって実体化は `getByAddress` のキャッシュ参照**前**に置く（E5）。
 *
 * 寿命は state の世代と共にする。`_state` の再セットで `getterPaths` / `listPaths` は
 * クリアされるので、レジストリも作り直す（§1-3）。ただし**生やしたアクセサは state
 * オブジェクトの側に残る**ので、同じ state を再セットすると `getStateInfo` がそれを
 * `getterPaths` に復元する。そのとき「もう生えているから何もしない」と早期 return して
 * しまうと `listPaths` の登録だけが抜け落ちるため、生成物は WeakSet で見分けて
 * 登録だけをやり直す。
 */

declare class RecursionRegistry {
    readonly spec: IRecursionSpec;
    private readonly _definitions;
    private readonly _accessors;
    /**
     * `recursiveGetterOwning` の記憶。キーは添字を `*` に畳んだ形（`nodes.1.total` と `nodes.2.total`
     * は 1 つ）、値は「その具体パスを展開形（またはその値の内側）として持つ `**` getter」、
     * 無ければ null。
     *
     * 有界である: キーは添字を畳んだワイルドカード形のパス文字列で、`PathInfo` が intern する集合
     * （バインディング・getter・API 引数に綴られたパスと、その展開形）の部分集合にしかならない。
     * intern 済みパスの集合が有界であることは D10 で受け入れ済みなので、ここも同じ上限に収まる。
     * 文字列は WeakSet に入らないので、寿命はレジストリ（＝ state の世代）と共にする。
     */
    private readonly _ownerByPath;
    /**
     * 書き込みのホットパス（`setByAddress`）向けの記憶。キーは intern 済みの `PathInfo` なので
     * 寿命と上限は PathInfo の intern 集合と同じ（WeakMap）。畳み（split + Number + join）は
     * miss のときだけ払う — 宣言のある state では**アンカー外を含む全書き込み**がここを通る
     * （第 4 サイクルで実測: 畳みを毎回払うと `s.counter = i` で +100ns/書き込み）。
     */
    private readonly _ownerByPathInfo;
    /**
     * 読みのホットパス（`getByAddress`）向けの記憶。`_ownerByPathInfo` と対称で、キーは
     * intern 済みの `PathInfo`、値は「そのパスの展開アクセサ」、展開形でなければ null。
     * 宣言のある state では**アンカー外を含む全読み**（親ウォークの各段を含む）がここを
     * 通るので、文字列キーの `Map.get` + `Set.has` + `startsWith` を毎回払わせない
     * （第 5 サイクルで実測）。
     *
     * 読みの否定判定の記憶は**ここ 1 つ**（第 5 サイクル再検証で文字列キーの `_nonAccessors` を撤去 —
     * 前段にこの記憶を置いた後は、PathInfo とパス文字列が 1:1 なので二重に持つだけだった）。
     * 否定を記憶してよい根拠は、定義集合が state の世代内で不変であること —
     * 同じ `PathInfo` は同じパス文字列なので、いちど「展開形でない」と決まった PathInfo が
     * 後から実体化されることはない。実体化した側は `materializeForPathInfo` が
     * `_define` の戻り値でそのまま記憶を更新する（否定が実体化を隠さない）。
     */
    private readonly _accessorByPathInfo;
    /** `concretePathAt` の記憶（接尾辞 → 深さ順の具体パス）。 */
    private readonly _concreteBySuffix;
    private readonly _registeredListPaths;
    constructor(spec: IRecursionSpec, state: object);
    /**
     * 作者が手で書いた具体パス（`get "nodes.*.children.*.total"()` / データプロパティ）が、宣言済み
     * `**` getter の展開形と同名でないことを**構築時に**確かめる。
     *
     * `_define` の衝突検査は「その深さを最初に読んだとき」にしか走らないので、データが浅い間は
     * 通り、木が 1 段深くなった瞬間にバインディングが落ちていた（第 3 サイクルのレビューで実測）。
     * 前世代の生成物（own に残った生成 getter）は衝突ではない — 同じ state の再セットで必ず居る。
     */
    private _assertNoConcreteCollision;
    /**
     * 2 本の `**` getter が同じ具体パスへ展開しないことを、宣言だけから静的に確かめる。
     *
     * 衝突するのは「片方の接尾辞がもう片方の接尾辞の末尾で、差分が反復語の整数倍」の
     * ときだけ（`nodes.**.total` と `nodes.**.children.*.total` は深さ k と k+1 で
     * 同じ `nodes.*.children.*.total` になる）。検出しないと `_definitions` の挿入順で
     * 最初に一致した方が無言で勝つ。
     */
    private _assertNoColliding;
    /**
     * `**` getter を 1 本でも宣言しているか。
     * **テスト・診断専用**（ランタイムの経路は `_definitions.size` を直接見る）。
     */
    get hasDefinitions(): boolean;
    /**
     * その接尾辞が宣言済みの `**` getter と衝突するなら、その getter のパスを返す。
     *
     * 完全一致だけでは足りない。①反復語の整数倍だけ違う接尾辞は同じ族を指す
     * （`_assertNoColliding` が宣言どうしについて既に見ている条件）②getter の**下**を
     * 指す形（`nodes.**.total.x` / 反復語ぶんずれた `nodes.**.children.*.total.x`）は、
     * getter が返したオブジェクトへ書いてキャッシュを汚し、次の無効化で無言に戻る。
     * どちらも書き込みの入口（列挙より前）で止める — 述語は expand.ts の `coversSuffix`。
     */
    conflictingRecursiveGetter(suffix: string): string | null;
    /**
     * `recursiveGetterOwning` の intern 済み `PathInfo` 版（書き込みのホットパス用）。
     * WeakMap の hit なら畳みも照合も払わない。
     */
    recursiveGetterOwningPath(pathInfo: IPathInfo): string | null;
    /**
     * 具体パスを展開形（またはその値の内側）として持つ `**` getter のパス。無ければ null。
     * **実体化はしない。**
     *
     * `conflictingRecursiveGetter` の**具体パス版**で、`**` を経ない 2 つの入口が使う:
     *
     *  - バインド確立時のパス存在検査（`checkDeclaredPath`）。あの時点ではまだ生えて
     *    いないので、素の存在検査では必ず「解決できない」になる。展開形そのもの
     *    （`nodes.*.total`）だけでなく、その値の中を指す形（`nodes.*.stats.count` で
     *    `get "nodes.**.stats"()` がオブジェクトを返す）も、通常の getter の下と同じく
     *    評価しないと分からないので黙る側に倒す。
     *  - 書き込みの入口（`setByAddress`）。`$setAll("nodes.*.children.*.total", [], v)` や
     *    `this["nodes.1.total"] = v` は `**` を含まないので `setAllRecursive` の
     *    読み取り専用検査を通らず、未実体化なら fast path が行オブジェクトへ素の
     *    プロパティとして書いてしまう（ノードを汚し、代入値が `dirty:false` で載って
     *    以後 getter が評価されない）。展開形への書き込みは、実体化の前後に関わらず
     *    `wcs/recursion-readonly` で止める。
     */
    recursiveGetterOwning(concretePath: string): string | null;
    /** 具体パスが宣言済み `**` getter の展開形そのものなら、その getter のパス。 */
    private _matchExpansion;
    /**
     * `materializeFor` の `PathInfo` 版。**読みのホットパス（`getByAddress`）専用**で、
     * 判定そのものは `materializeFor` に委ね、結果（否定を含む）を PathInfo に記憶する。
     * 書き側の `recursiveGetterOwningPath` と対称。
     */
    materializeForPathInfo(stateElement: IStateElement, pathInfo: IPathInfo): IRecursionAccessor | null;
    /**
     * 具体パスが再帰 getter の展開形なら、そのアクセサを（未登録なら生やして）返す。
     * 該当しなければ null。読みは `materializeForPathInfo` を通るので、ここへ来るのは
     * 記憶が外れたときだけ — 判定は接頭辞 1 回で抜け、ここでは否定を記憶しない（記憶は
     * `materializeForPathInfo` の PathInfo キーの 1 か所）。
     * （`**` getter の無い空レジストリを弾くのは呼び出し側の役目。）
     */
    materializeFor(stateElement: IStateElement, concretePath: string): IRecursionAccessor | null;
    private _define;
    /**
     * 経路上のリストパスを `listPaths` に載せる（E4）。`setPathInfo(path, "for")` は
     * 使えない — あちらは `elementPaths` にも入れて `setByAddress` の swap 経路
     * （`isSwappable`）を変えてしまう。ここで要るのは「依存ウォークがこのパスを
     * リストとして展開する」ことだけ。
     */
    private _registerListPaths;
    /**
     * この世代が生やしたもの（own の生成アクセサ・依存辺・キャッシュ）を忘れる（state の
     * 再セット時、`getStateInfo` の再収集より**前**に呼ぶ）。実体は generation.ts。
     */
    forgetGenerated(stateElement: IStateElement, previousState: object): ReadonlySet<string>;
    /**
     * `**` 接尾辞の深さ `depth` の具体パス（`concretePathAt` の記憶付き版）。
     * 束縛形の読み（`this["nodes.**.value"]` / 省略形 `$getAll`）は再帰 getter の評価ごとに
     * ここを通るので、深さぶんの文字列連結とワイルドカード数えを毎回やり直さない。
     * 上限は「接尾辞の種類 × 128」で有界（上限超過は `concretePathAt` が throw するので載らない）。
     */
    concretePathAt(suffix: string, depth: number): string;
    /** 展開済みアクセサのメタデータ（深さ解決・診断・テスト用）。 */
    accessorFor(concretePath: string): IRecursionAccessor | null;
    /**
     * これまでに実体化した具体パスの一覧。**テスト専用**（「読んだ深さだけが生える」という
     * 遅延実体化の不変条件を外から確かめる口。ランタイムはどの経路からも呼ばない）。
     */
    get materializedPaths(): ReadonlySet<string>;
}

interface IStateElement {
    /** DOM connection state; optional for non-DOM state implementations. */
    readonly isConnected?: boolean;
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
    /**
     * state の世代。`_state` の差し替えごとに 1 つ進み、キャッシュ項目の印になる
     * （cache/types.ts の `generation`）。`version`（更新サイクルの番号）とは別のカウンタ。
     * optional なのはテスト用モック互換のため（undefined のモックが載せた項目は
     * undefined 同士で一致し、従来どおりヒットする — `__tests__/proxy.getByAddress.test.ts`
     * の「キャッシュがある場合はキャッシュを返すこと」が固定する）。
     */
    readonly stateGeneration?: number;
    readonly rootNode: Node;
    readonly boundComponentStateProp: string | null;
    /**
     * `bind-component` で束ねられているコンポーネント要素（親スコープ側のノード）。
     * マッピング規則の引き当てに使う。optional なのはテスト用モック互換のため。
     */
    /**
     * この state の実体が innerState proxy（＝ 値の正本が親スコープの state にある
     * mapped な `bind-component`）か。真のときだけ越境アドレスの受け渡しと
     * リストパスの外向き伝播が働く（§1.8）。
     * optional なのはテスト用モック互換のため（undefined は plain 扱い）。
     */
    /**
     * この state element にマウント（Phase 2 の単一ツリー — webComponent/mount.ts）が
     * 1 つでも登録されているか。偽のとき getByAddress / isCacheable / `$n` 補正は
     * boolean 判定 1 個でオーバーレイ経路を抜ける（設計書 D18）。
     * optional なのはテスト用モック互換のため（undefined は「マウント無し」扱い）。
     */
    readonly hasMounts?: boolean;
    markHasMounts?(): void;
    /**
     * この state element に接ぎ木済みのボリューム（`mount=` — webComponent/volume.ts）が
     * 1 つでもあるか。偽のとき setByAddress の D22 後段ガード（マウントポイントを含む
     * 親の丸ごと書き検査）は boolean 判定 1 個で抜ける（設計書 D18 と同じ形）。
     * optional なのはテスト用モック互換のため（undefined は「ボリューム無し」扱い）。
     */
    readonly hasGraftedVolumes?: boolean;
    markHasGraftedVolumes?(): void;
    /** ボリュームがこのルートに予約・接ぎ木された: スコープ機能の hook を付ける（webComponent/addressHooks.ts） */
    markHasVolume?(): void;
    /**
     * ライフサイクル機能（core/lifecycleHooks.ts、設計案 H3）へ開く内部面。接続を引き取った機能が
     * 要素の初期化を所有するために要る最小限で、optional はテスト用モック互換のため。
     */
    /** いま接続している rootNode（未接続は null）。公開の `rootNode` と違い throw しない */
    readonly connectedRootNode?: Node | null;
    clearConnectedRootNode?(): void;
    /** 初期化完了の印（引き取った機能が自分の着地で立てる） */
    markInitialized?(): void;
    /** 初期化待ちの 3 つの promise を解決する（未解決のまま投げるとページが無言でウェッジする） */
    settleInitialization?(): void;
    /** `state` / `src` / 内包スクリプトからこの要素のソースを読む */
    loadStateFromSource?(): Promise<Record<string, any>>;
    /** 自分のツリーを持たずに初期化を終えた印（DCC 定義要素。再接続でこの rootNode のツリーとして登録し直さない） */
    markTreeless?(): void;
    /** 初期化失敗の着地（診断 1 件・connectedCallbackPromise の reject — #257）。常に throw する */
    failInitializeLoudly?(error: unknown): never;
    /** 接続の世代（接続の末尾の起動が、陳腐化した connect の再開を弾くために照合する） */
    readonly connectGeneration?: number;
    /** `$watch` / ボリュームの合流が決めた監視パス（setByAddress の旧値キャプチャのゲート） */
    setWatchPaths?(paths: ReadonlySet<string> | null): void;
    /** `$scan` の `from` パス（`watchPaths` と並ぶ旧値キャプチャのゲート） */
    setScanPaths?(paths: ReadonlySet<string> | null): void;
    /** 設定エラーの着地（初期化待ちの promise を解決し、二重着地の印を立てる） */
    landInitialization?(): void;
    /** `bind-component` が束ねた相手（`boundComponentStateProp` の答えになる） */
    setBoundComponent?(component: Element | null, stateProp: string | null): void;
    /** `$recursion` のレジストリ（宣言が無ければ null。`hasRecursion` の裏づけ） */
    setRecursionRegistry?(registry: RecursionRegistry | null): void;
    /** 前世代の再帰レジストリが生やした具体パス（経路情報の作り直しから除く） */
    addGeneratedPath?(path: string): void;
    /**
     * 読み書き境界の hook（core/addressHooks.ts、設計案 H1）。宣言が要求する機能の分だけ
     * `attachAddressHooks` で付く。無い state は null 判定 1 個で抜ける。optional はモック互換
     */
    readonly addressHooks?: IAttachedHooks | null;
    attachAddressHooks?(feature: string, declaration: string): void;
    /**
     * この state 要素に束ねられた（`setPathInfo` を通った）パスの集合。丸ごとマウント
     * （ルート規則）の親→子通知が「登録済みパス全部を読み直せ」を組み立てるのに使う
     * （webComponent/rootReloadPaths.ts）。
     * optional なのはテスト用モック互換のため（undefined は「登録なし」扱い）。
     */
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
     * state が $errorCallback を定義しているか。true のとき drain は隔離したバインディング
     * 適用失敗を console.error の代わりに $errorCallback へ配送する（devtools sink へは常に流す）。
     * optional なのはテスト用モック互換のため（undefined は「未定義＝console.error」）。
     */
    readonly hasErrorCallback?: boolean;
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
     * `$scan` の `from` パスの集合（docs/state-scan-design.md §2-1）。`watchPaths` と並んで
     * setByAddress の旧値キャプチャのゲートになる（fold に `prev` を渡すため）。
     * 宣言が無ければ null / undefined。optional なのはテスト用モック互換のため。
     */
    readonly scanPaths?: ReadonlySet<string> | null;
    /**
     * パスを依存グラフへ登録する。DOM バインディング登録（BindingSession）のほか、
     * `$watch` 宣言（processWatchDeclaration）からも呼ばれる — 静的依存グラフに
     * 載るのがバインド済みパスだけだと headless 購読が成立しないため（設計書 §8）。
     *
     * `source` は存在検査の診断 code と適用範囲を決める（pathDiagnostics.ts）。
     * 省略時は `"binding"`（テスト用モック互換のため optional）。
     */
    /** ボリュームの宣言面の合流（webComponent/volume.ts 専用・実装は State のみ） */
    addVolumeWatchPaths?(paths: ReadonlySet<string>): void;
    mergeVolumeListKeys?(entries: ReadonlyMap<string, ListKeySpec>): void;
    enableUpdatedCallback?(): void;
    /** enable-ssr スナップショットから初期化されたか（D14）。 */
    readonly hydratedFromSsr?: boolean;
    /** ボリュームのアクセサ登録（webComponent/volume.ts 専用） */
    defineTreeAccessor(path: string, descriptor: PropertyDescriptor): void;
    /**
     * リストパスとしてだけ登録する（`listPaths` に足す）。`setPathInfo(path, "for")` は
     * `elementPaths` にも入れて `setByAddress` の swap 経路（`isSwappable`）を変えるので、
     * 「依存ウォークがこのパスをリストとして展開する」ことだけが要る用途には使えない
     * （docs/state-recursive-path-impl-plan.md §3-2 の E4）。
     */
    addListPath(path: string): void;
    /**
     * state オブジェクト自身＋プロトタイプチェーンから descriptor を引く（生成物と作者定義の
     * 見分けに使う）。class 構文の getter は prototype に載るので own だけでは足りない。
     */
    findStateDescriptor(path: string): PropertyDescriptor | undefined;
    /**
     * この state に `$recursion` 宣言があるか。偽のとき getByAddress の遅延実体化と
     * get トラップの `**` 解決は boolean 判定 1 個で抜ける（hasMounts と同じ D18 の形）。
     * 読み手は必ずこのゲートを先に見て、真なら `recursionRegistry` を `!` で読む。
     * 必須メンバー（実装は `State` のみ）。`any` 型のテスト用モックがフィールドを持たなくても
     * 通るのは vitest が型検査をしないからで、その場合 `undefined === true` は偽なので再帰の
     * 経路に入らないだけ — 型としては必須。
     */
    readonly hasRecursion: boolean;
    /**
     * 再帰レジストリ（宣言が無ければ null。`hasRecursion === true` なら非 null）。registry.ts は
     * このファイルの IStateElement を参照するが、`import type` どうしなので実行時の循環にはならない。
     */
    readonly recursionRegistry: RecursionRegistry | null;
    setPathInfo(path: string, bindingType: BindingType, source?: PathInfoSource): void;
    addStaticDependency(parentPath: string, childPath: string): boolean;
    addDynamicDependency(fromPath: string, toPath: string): boolean;
    createStateAsync(mutability: Mutability, callback: (state: IStateProxy) => Promise<void>): Promise<void>;
    createState(mutability: Mutability, callback: (state: IStateProxy) => void): void;
    nextVersion(): number;
    setInitialState(state: Record<string, any>): void;
}

interface IPathInfo {
    readonly id: number;
    readonly path: string;
    readonly segments: string[];
    readonly lastSegment: string;
    readonly cumulativePaths: string[];
    readonly cumulativePathSet: Set<string>;
    readonly cumulativePathInfos: IPathInfo[];
    readonly cumulativePathInfoSet: Set<IPathInfo>;
    readonly parentPath: string | null;
    readonly parentPathInfo: IPathInfo | null;
    readonly wildcardPaths: string[];
    readonly wildcardPathSet: Set<string>;
    readonly indexByWildcardPath: Record<string, number>;
    readonly wildcardPathInfos: IPathInfo[];
    readonly wildcardPathInfoSet: Set<IPathInfo>;
    readonly wildcardParentPaths: string[];
    readonly wildcardParentPathSet: Set<string>;
    readonly wildcardParentPathInfos: IPathInfo[];
    readonly wildcardParentPathInfoSet: Set<IPathInfo>;
    readonly wildcardPositions: number[];
    readonly lastWildcardPath: string | null;
    readonly lastWildcardInfo: IPathInfo | null;
    readonly wildcardCount: number;
}
interface IStateAddress {
    readonly pathInfo: IPathInfo;
    readonly listIndex: IListIndex | null;
    readonly parentAddress: IStateAddress | null;
}
interface ITreePath {
    readonly stateElement: IStateElement;
    readonly pathInfo: IPathInfo;
}
interface IAbsoluteStateAddress {
    readonly absolutePathInfo: ITreePath;
    readonly listIndex: IListIndex | null;
}

type BindingType = 'text' | 'prop' | 'event' | 'for' | 'if' | 'elseif' | 'else' | 'radio' | 'checkbox' | 'spread';
/**
 * 文法の段が読むフィルタ（名前と引数だけ。要件 D16）。実関数は束縛計画の段で
 * 登録簿から解決される（`core/filterRegistry.ts`）ので、パース結果はここで止まる。
 */
interface IParsedFilter {
    readonly filterName: string;
    readonly args: string[];
    /**
     * 引数の型付きの値（要件 B9）。引用符の無い `true` / `false` / `null` / 数値は型付き、引用符付きは
     * 文字列のまま。`args` は引用符を外した原文（書式フィルタはこちらを読む）。組み立てた側が省略したら
     * `args` と同じ扱い。
     */
    readonly literals?: readonly unknown[];
}
/** 束縛計画の段で実関数まで解決したフィルタ */
interface IFilterInfo extends IParsedFilter {
    readonly filterFn: FilterFn;
}
/**
 * バインディング式のパース結果（DOM 非依存の部分）。`@wcstack/state/parser` の
 * ParseBindTextResult がこれをそのまま公開するため、Node 等の DOM lib 型を
 * ここに足してはならない（足すなら IBindingInfo 側へ）。
 */
interface IParsedBinding {
    readonly propName: string;
    readonly propSegments: string[];
    readonly propModifiers: string[];
    readonly statePathName: string;
    readonly statePathInfo: IPathInfo;
    readonly inFilters: IParsedFilter[];
    readonly outFilters: IParsedFilter[];
    readonly bindingType: BindingType;
    readonly uuid?: string | null;
}
/**
 * 束縛計画の段のバインディング。パース結果に DOM のノードと、**解決済みのフィルタ**が付く
 * （`bindings/getBindingInfos.ts` が登録簿から引く — 要件 D16）。
 */
interface IBindingInfo extends IParsedBinding {
    readonly inFilters: IFilterInfo[];
    readonly outFilters: IFilterInfo[];
    readonly node: Node;
    readonly replaceNode: Node;
}

interface IState {
    [key: string]: any;
}
interface ITagNames {
    readonly state: string;
    readonly ssr: string;
}
interface IWritableTagNames {
    state?: string;
    ssr?: string;
}
interface IConfig {
    readonly bindAttributeName: string;
    readonly commentTextPrefix: string;
    readonly commentForPrefix: string;
    readonly commentIfPrefix: string;
    readonly commentElseIfPrefix: string;
    readonly commentElsePrefix: string;
    readonly tagNames: ITagNames;
    readonly locale: string;
    readonly debug: boolean;
    readonly enableMustache: boolean;
    /**
     * Enables direction-aware initial synchronization (`init=` / `sync=`).
     * Disabled by default while Phase 2 is evaluated against existing snapshots.
     */
    readonly enableDirectionalInitialSync: boolean;
    /**
     * Enables causal propagation tracking (transaction / edge provenance /
     * write receipts). Disabled by default while Phase 3 runs as a shadow of
     * the primitive same-value guard.
     */
    readonly enablePropagationContext: boolean;
    /**
     * Enables the opt-in dev-time contract analyzer (Phase 5b). When false
     * (default), `analyzeContract()` is a no-op with zero cost — runtime
     * behavior and allocation are unchanged. When true, it checks the actually
     * loaded `static wcBindable` declarations against a supplied sidecar
     * manifest and emits `contract:*` drift trace via the DevTools sink.
     */
    readonly enableContractAnalyzer: boolean;
    /**
     * 同値ガード（**既定 true**・標準的リアクティブ挙動・`setConfig({ sameValueGuard: false })` で opt-out 可）。
     * primitive 値の set で `Object.is` 同値なら更新を no-op にする
     * （enqueue / 依存 walk / DOM 適用 / $updatedCallback / DCC イベントを発火しない）。
     * 参照型（object/array）は in-place mutation 取りこぼし防止のため素通し。
     * 同値 set に副作用（同値時の $updatedCallback 等）を期待する場合は false にする。
     */
    readonly sameValueGuard: boolean;
}
/**
 * `$errorCallback(error, info)` の第 2 引数 — 適用に失敗したバインディングの識別情報。
 * 値と DOM は巻き戻されない（隔離規範）。作者はここで「どのバインディングが」を知り、
 * 自分の state にエラーを書いてページ内で受ける。
 */
interface IBindingErrorInfo {
    /** バインドされた state パス（`data-wcs` に書かれた形。`items.*.name` などワイルドカードのまま） */
    readonly path: string;
    /** バインディング種別（text / property / attribute / class / style / for / if …） */
    readonly bindingType: BindingType;
    /** バインディングが付いたノード（テキストバインドでは Text ノード） */
    readonly node: Node;
}
interface IWritableConfig {
    bindAttributeName?: string;
    commentTextPrefix?: string;
    commentForPrefix?: string;
    commentIfPrefix?: string;
    commentElseIfPrefix?: string;
    commentElsePrefix?: string;
    tagNames?: IWritableTagNames;
    locale?: string;
    debug?: boolean;
    enableMustache?: boolean;
    enableDirectionalInitialSync?: boolean;
    enablePropagationContext?: boolean;
    enableContractAnalyzer?: boolean;
    sameValueGuard?: boolean;
}

/**
 * 全機能を入れてから core を立ち上げる（従来の `bootstrapState()` と同じ挙動）。
 * install は要素の定義（connectedCallback が走り得る）より前に行う。いずれも冪等。
 */
declare function bootstrapState(config?: IWritableConfig, registry?: CustomElementRegistry): void;

declare function getConfig(): IConfig;

/**
 * Trusted Types (`require-trusted-types-for 'script'`) 対応。正本は docs/csp.md §7。
 *
 * state が HTML sink に流すのは **状態の値**（`innerHTML: path` などのプロパティ
 * バインド）で、ユーザー入力が混ざり得る文字列そのもの。ここに identity policy を
 * 噛ませて通すのは TT の無効化と同義なので、state は自前の policy を作らない。
 * 利用側が sanitizer を持つ policy を注入したときだけ通し、無ければ従来どおり
 * ブラウザに弾かせる（ただし何を設定すれば直るかは必ず言う）。
 *
 * 注入口は全 @wcstack パッケージ共通のグローバルスロット。buildless（CDN 一発）でも
 * inline script 1 本で差し込める:
 *
 * ```js
 * globalThis[Symbol.for("wcstack.trustedTypes.policy")] =
 *   trustedTypes.createPolicy("my-app", { createHTML: (s) => DOMPurify.sanitize(s) });
 * ```
 *
 * バンドラ経由なら `setTrustedTypesPolicy()` を使う。値は毎回スロットから読むので
 * 後から差し替えても効く（identity policy を作る router / worker 側だけは
 * `createPolicy` の重複を避けるため生成結果をシングルトンで保持する）。
 */
interface IWcsTrustedTypesPolicy {
    createHTML?(input: string): unknown;
    createScriptURL?(input: string): unknown;
}
/** 利用側が policy を差し込むグローバルスロット（全 @wcstack パッケージ共通）。 */
declare const TRUSTED_TYPES_POLICY_SLOT: unique symbol;
/**
 * 利用側が注入した policy を返す。state はここに identity policy をフォールバック
 * させない（それをやると TT を無効化することになる）。
 */
declare function getTrustedTypesPolicy(): IWcsTrustedTypesPolicy | null;
/** 利用側 policy を設定する（`null` で解除）。最初のバインド適用前に呼ぶこと。 */
declare function setTrustedTypesPolicy(policy: IWcsTrustedTypesPolicy | null): void;

/**
 * 指定された rootNode のバインディング初期化が完了するまで待機する Promise を返す。
 */
declare function getBindingsReady(rootNode: Node): Promise<void>;

/**
 * Browser builds use the native HTMLElement. Headless runtimes receive an
 * inert base so the public module can be imported without installing DOM
 * globals; constructing components remains a browser-only operation.
 */
declare const HTMLElementBase: typeof HTMLElement;

interface ISsrElement {
    readonly version: string;
    readonly stateData: IState;
    readonly templates: Map<string, HTMLTemplateElement>;
    readonly hydrateProps: Record<string, Record<string, unknown>>;
    getTemplate(uuid: string): HTMLTemplateElement | null;
    verifyVersion(): boolean;
}
declare class Ssr extends HTMLElementBase implements ISsrElement {
    private _stateData;
    private _templates;
    private _hydrateProps;
    get version(): string;
    get stateData(): IState;
    get templates(): Map<string, HTMLTemplateElement>;
    get hydrateProps(): Record<string, Record<string, unknown>>;
    getTemplate(uuid: string): HTMLTemplateElement | null;
    /**
     * サーバーの SSR バージョンとクライアントの state バージョンを検証する。
     * メジャー・マイナーバージョンが一致すればtrue。
     * version 属性がない場合は検証スキップ（true）。
     */
    verifyVersion(): boolean;
    setStateData(data: IState): void;
    setHydrateProps(props: Record<string, Record<string, unknown>>): void;
    private _loadStateData;
    private _loadTemplates;
    private _loadHydrateProps;
    static find(root: Node): ISsrElement | null;
    /**
     * stateData と構造テンプレート・プロパティから <wcs-ssr> の中身を構築する。
     * server パッケージの renderToString から呼ばれる。
     */
    /**
     * wcs-state 要素から $ プレフィックスや関数を除いたデータを抽出する。
     */
    static extractStateData(stateEl: Element): Record<string, any>;
    static buildContent(ssrEl: Element, stateData: Record<string, any>): void;
    /**
     * SSR ブロック境界コメント (@@wcs-*-start/end) を除去する
     */
    static removeBlockBoundaryComments(root: Node): void;
    /**
     * SSR の構造プレースホルダーコメント (@@wcs-for:uuid 等) を除去する
     */
    static removeStructuralComments(root: Node): void;
    /**
     * SSR テキストバインディングコメントを復元する。
     * <!--@@wcs-text-start:path-->text<!--@@wcs-text-end:path-->
     * → <!--@@: path--> (バインディングシステムが認識する形式)
     */
    static restoreTextBindings(root: Node): void;
    /**
     * SSR DOM をクリーンアップし、buildBindings が動作できる状態に戻す。
     * バージョン不一致時のフォールバック用。
     *
     * 1. SSR ブロック境界コメント間のレンダリング済みノードを除去
     * 2. SSR テキストバインディングを @@: 形式に復元
     * 3. プレースホルダーコメントを <wcs-ssr> 内のテンプレートで差し替え
     * 4. data-wcs-ssr-id 属性を除去
     * 5. <wcs-ssr> を除去
     */
    static cleanupDom(root: Document): void;
}

declare function buildBindings(root: Document | ShadowRoot): Promise<void>;

/**
 * defineState.ts
 *
 * 状態オブジェクトに型付けを提供するためのユーティリティ。
 * defineState() はアイデンティティ関数で、ThisType<> を付与することで
 * メソッド・computed getter 内の this に型補完を提供する。
 *
 * テンプレートリテラル型によるドットパスの型解決:
 * - WcsPaths<T>      : T から生成される全ドットパスの union
 * - WcsPathValue<T,P>: パス P に対応する値の型
 * - WcsPathAccessor<T>: ブラケットアクセス用マップ型
 */
/**
 * `any` 型を検出する。
 * `0 extends (1 & T)` は T が `any` の場合のみ true になる。
 */
type IsAny<T> = 0 extends (1 & T) ? true : false;
/**
 * T がドットパス再帰の対象となる「プレーンなデータオブジェクト」かどうかを判定する。
 * プリミティブ、組み込みオブジェクト (Date, Map 等)、関数、配列、any は除外。
 */
type IsPlainObject<T> = IsAny<T> extends true ? false : T extends string | number | boolean | null | undefined | symbol | bigint | ((...args: any[]) => any) | Date | RegExp | Error | Map<any, any> | Set<any> | WeakMap<any, any> | WeakSet<any> | Promise<any> | readonly any[] ? false : T extends Record<string, any> ? true : false;
/**
 * T のキーのうち、関数でないもの（データプロパティ・computed getter）を抽出する。
 * メソッド（イベントハンドラ等）はドットパスの対象外。
 * `$` プレフィックスキー（$streams / $commandTokens / $on 等の予約宣言）もドットパスにならない。
 * any 型のプロパティは除外せず保持する。
 */
type DataKeys<T> = {
    [K in keyof T & string]: K extends `$${string}` ? never : IsAny<T[K]> extends true ? K : T[K] extends (...args: any[]) => any ? never : K;
}[keyof T & string];
/**
 * 型 T から生成される全てのドットパスの union。
 * 配列プロパティはワイルドカード `*` を使用: `items.*.name`
 *
 * 再帰の深さは最大4レベルに制限（コンパイル性能の確保）。
 *
 * @example
 * ```ts
 * type S = {
 *   count: number;
 *   users: { name: string; age: number }[];
 *   cart: { items: { price: number }[] };
 * };
 * type P = WcsPaths<S>;
 * // = "count" | "users" | "users.*" | "users.*.name" | "users.*.age"
 * //   | "cart" | "cart.items" | "cart.items.*" | "cart.items.*.price"
 * ```
 */
type WcsPaths<T, Depth extends readonly any[] = []> = Depth["length"] extends 4 ? never : {
    [K in DataKeys<T>]: K | (T[K] extends readonly (infer E)[] ? IsPlainObject<E> extends true ? `${K}.*` | WcsSubPaths<E, `${K}.*.`, [...Depth, 0]> : `${K}.*` : IsPlainObject<T[K]> extends true ? WcsSubPaths<T[K], `${K}.`, [...Depth, 0]> : never);
}[DataKeys<T>];
/** @internal プレフィックス付きサブパスの生成ヘルパー */
type WcsSubPaths<T, Prefix extends string, Depth extends readonly any[]> = WcsPaths<T, Depth> extends infer P extends string ? `${Prefix}${P}` : never;
/**
 * ドットパス P に対応する値の型を T から解決する。
 *
 * 解決順序:
 * 1. T の直接キー（computed getter 含む）
 * 2. `K.*` → 配列要素型
 * 3. `K.rest` → オブジェクト/配列のネストを再帰的に辿る
 *
 * @example
 * ```ts
 * type S = { cart: { items: { price: number; qty: number }[] } };
 * type V1 = WcsPathValue<S, "cart.items.*.price">; // number
 * type V2 = WcsPathValue<S, "cart.items.*">;        // { price: number; qty: number }
 * type V3 = WcsPathValue<S, "cart">;                 // { items: ... }
 * ```
 */
type WcsPathValue<T, P extends string> = P extends keyof T ? T[P] : P extends `${infer K}.*` ? K extends keyof T ? T[K] extends readonly (infer E)[] ? E : never : never : P extends `${infer K}.${infer Rest}` ? K extends keyof T ? T[K] extends readonly (infer E)[] ? Rest extends `*.${infer SubRest}` ? WcsPathValue<E, SubRest> : Rest extends "*" ? E : never : T[K] extends Record<string, any> ? WcsPathValue<T[K], Rest> : never : never : never;
/**
 * 全ドットパスに対する型付きブラケットアクセスを提供するマップ型。
 *
 * `this["users.*.name"]` のようなアクセスに対して、
 * WcsPaths で生成されたパスに対応する値の型を返す。
 */
type WcsPathAccessor<T> = {
    [P in WcsPaths<T>]: WcsPathValue<T, P>;
};
/**
 * `<wcs-state>` の Proxy 経由で提供されるAPIメソッド。
 * state定義オブジェクト内のメソッド・getter で `this.` 経由で利用可能。
 */
interface WcsStateApi {
    /**
     * ワイルドカードを含むパスにマッチする全要素を配列で取得する。
     *
     * @param path - ワイルドカードを含むパス
     * @param indexes - 各ワイルドカード階層のインデックス（前方一致の接頭辞。`[]` は全階層を展開）。
     *   省略時はループ文脈の添字（`[$1..$n]` 相当）のうち path と共有するワイルドカード連鎖の
     *   分が接頭辞として敷かれる（文脈が path より深い分は切り詰め）。共有が無いのに文脈が
     *   添字を持つ場合は throw する — 異なる文脈の添字は流用しない。
     *
     * @example
     * ```ts
     * get "cart.totalPrice"() {
     *   return this.$getAll("cart.items.*.price").reduce((sum, v) => sum + v, 0);
     * }
     * ```
     */
    $getAll<V = any>(path: string, indexes?: number[]): V[];
    /**
     * ワイルドカードを含むパスにマッチする**全アドレスへ一括で書き込む**（`$getAll` の対称形）。
     *
     * 配列を作り直さずに一括更新するための API。`this.users = this.users.map(...)` は
     * ListIndex・行 getter キャッシュ・差分描画をまとめて作り直すが、`$setAll` は
     * in-place な個別書き込みに分解するのでリストの同一性が保たれる。
     *
     * - `indexes` は `$getAll` と同じ**前方一致の接頭辞**（`[]` で全階層を展開）。省略は不可。
     * - 関数を渡すと **mapper**（`(current, ...indexes) => next`）として要素ごとに評価される。
     * - 配列は既定でブロードキャストされる。1 件ずつ配るには `{ spread: true }` を明示する。
     * - `undefined` を書こうとした要素はスキップされる（クリアは `null`）。
     *
     * @returns 実際に書き込んだ件数（`undefined` でスキップした分を含まない）
     *
     * @example
     * ```ts
     * toggleAll(e: Event) {
     *   this.$setAll("users.*.selected", [], (e.target as HTMLInputElement).checked);
     * }
     * invertAll() {
     *   this.$setAll("users.*.selected", [], cur => !cur);
     * }
     * ```
     */
    $setAll<V = any>(path: string, indexes: number[], value: V | ((current: V, ...indexes: number[]) => V | undefined)): number;
    $setAll<V = any>(path: string, indexes: number[], values: readonly V[], options: {
        spread: true;
    }): number;
    /**
     * 指定パスの更新を手動でトリガーする。
     * Proxy の set トラップを経由せずに内部状態を変更した場合に使用。
     */
    $postUpdate(path: string): void;
    /**
     * パスとインデックス配列を指定して、ワイルドカードを解決した値を取得・設定する。
     *
     * @param path - ワイルドカードを含むパス
     * @param indexes - 各ワイルドカード階層のインデックス
     * @param value - 設定する値（省略時は取得）
     */
    $resolve(path: string, indexes: number[], value?: any): any;
    /**
     * 指定パスへの依存関係を明示的に登録する。
     * computed getter 内で動的にパスを組み立てる場合に使用。
     */
    $dependOn(path: string): void;
    /**
     * コールバック実行中の依存追跡（動的依存・`$1` インデックス依存の登録）を
     * 抑止して fn を実行し、その戻り値を返す。
     * リスト行 getter が「行外の単一値」を読みたいが、その値の変更で全行を
     * 再評価させたくない場合に使う（該当行へ直接書き込む設計と組で用いる）。
     */
    $untracked<T>(fn: () => T): T;
    /** @deprecated `$dependOn` の旧名（3.x の間は動き、4.0 で外れる — 要件 B12） */
    $trackDependency(path: string): void;
    /** @deprecated `$untracked` の旧名（3.x の間は動き、4.0 で外れる — 要件 B12） */
    $untrackDependency<T>(fn: () => T): T;
    /**
     * 鍵付き購読: `path` の現在値が `key` に等しいかを返し、評価中のリスト行 getter を
     * その鍵で購読する。`path` への書き込みは旧値・新値の鍵の行だけを再評価する
     * （パターン依存なら全行）。`path` 自体は依存として追跡しない。
     * 例: `get "items.*.selected"() { return this.$eq("selectedId", this.$untracked(() => this["items.*.id"])); }`
     */
    $eq(path: string, key: unknown): boolean;
    /**
     * `$eq` の鍵を `keyPath`（ワイルドカードは評価中の行で解決）から依存を張らずに読む形。
     * 例: `get "items.*.selected"() { return this.$eqPath("selectedId", "items.*.id"); }`
     */
    $eqPath(path: string, keyPath: string): boolean;
    /**
     * `$eq` の鍵を評価中の行の index（`$1` 相当。`level` でワイルドカード段を選ぶ）にする形。
     * getter を index 依存には記録せず、行の移動時はリスト差分が鍵を付け替えるので、
     * 1 行削除で再評価されるのは高々 2 行。
     * 例: `get "items.*.selected"() { return this.$eqIndex("selectedIndex"); }`
     */
    $eqIndex(path: string, level?: number): boolean;
    /** `<wcs-state>` 要素への参照 */
    readonly $stateElement: HTMLElement;
    /**
     * `$commandTokens` で宣言した command token の名前空間。
     * `this.$command.<name>` で token を解決できる（バインディングでは
     * `onclick: $command.<name>` / `command.<method>: $command.<name>`）。
     */
    readonly $command: Record<string, {
        emit(...args: any[]): any;
    }>;
    /** `$stream` 各エントリの状態（"idle" | "active" | "done" | "error"）を返す読み取り専用名前空間 */
    readonly $streamStatus: Record<string, "idle" | "active" | "done" | "error">;
    /** `$stream` 各エントリの直近エラーを返す読み取り専用名前空間 */
    readonly $streamError: Record<string, unknown>;
    readonly [key: `$streamStatus.${string}`]: "idle" | "active" | "done" | "error";
    readonly [key: `$streamError.${string}`]: unknown;
    readonly $1: number;
    readonly $2: number;
    readonly $3: number;
    readonly $4: number;
    readonly $5: number;
    readonly $6: number;
    readonly $7: number;
    readonly $8: number;
    readonly $9: number;
    readonly [key: `${string}.**.${string}`]: any;
    readonly [key: `${string}.**`]: any;
}
/**
 * state定義オブジェクト内の `this` の型。
 *
 * - `T` のプロパティに型付きでアクセス可能（直接キー）
 * - `WcsPathAccessor<T>` によるネストされたドットパスの型付きアクセス
 * - `WcsStateApi` のメソッド ($getAll, $postUpdate 等) にアクセス可能
 * - 動的パス (`this[\`items.${i}.name\`]`) は型チェック対象外（キャストが必要）
 *
 * @example
 * ```ts
 * defineState({
 *   count: 0,
 *   users: [] as { name: string; age: number }[],
 *   increment() {
 *     this.count++;                // number
 *     this["users.*.name"];        // string (パス型解決)
 *     this.$getAll("users.*.age"); // API
 *   }
 * });
 * ```
 */
type WcsThis<T> = T & WcsStateApi & WcsPathAccessor<T>;
/**
 * `<wcs-state>` 用の型付き状態オブジェクトを定義する。
 *
 * ランタイムではアイデンティティ関数（引数をそのまま返す）として動作し、
 * コストはゼロ。TypeScript の `ThisType<>` を利用して、メソッド・getter 内の
 * `this` に型補完を提供する。
 *
 * ### 基本的な使い方 (TypeScript)
 * ```ts
 * import { defineState } from '@wcstack/state';
 *
 * export default defineState({
 *   count: 0,
 *   users: [] as { name: string; age: number }[],
 *
 *   increment() {
 *     this.count++;            // ✅ number
 *     this["users.*.name"];    // ✅ string (ドットパス型解決)
 *   },
 *
 *   get "users.*.ageCategory"() {
 *     return this["users.*.age"] < 25 ? "Young" : "Adult";
 *   }
 * });
 * ```
 *
 * ### JavaScript (JSDoc)
 * ```js
 * import { defineState } from '@wcstack/state';
 *
 * export default defineState({
 *   count: 0,
 *   increment() {
 *     this.count++;  // ✅ JSDoc + tsconfig checkJs で型補完
 *   }
 * });
 * ```
 *
 * ### HTML インラインスクリプト
 * ```html
 * <wcs-state>
 *   <script type="module">
 *     import { defineState } from '@wcstack/state';
 *     export default defineState({
 *       count: 0,
 *       increment() { this.count++; }
 *     });
 *   </script>
 * </wcs-state>
 * ```
 *
 * ### ライフサイクルコールバック
 * ```ts
 * export default defineState({
 *   data: null,
 *   async $connectedCallback() {
 *     this.data = await fetch('/api/data').then(r => r.json());
 *   },
 *   $disconnectedCallback() {
 *     // cleanup
 *   },
 *   $renderedCallback() {
 *     // called after the bindings are applied (old name: $updatedCallback)
 *   }
 * });
 * ```
 */
declare function defineState<T extends Record<string, any>>(definition: T & ThisType<WcsThis<T>>): T;

declare const VERSION: string;

/**
 * filterMeta.ts — 組み込みフィルタの構造化メタデータ（単一正本・route-a A2-1）。
 *
 * これまで vscode-wcs（completionData.ts BUILTIN_FILTERS）が手で持っていたフィルタの
 * 引数仕様・型・説明を、実装側（@wcstack/state）に**正本として移設**したもの。
 * manifest.ts がこれを公開し、vscode-wcs はそれを消費して手リストを撤去できる。
 *
 * 完全性は __tests__/manifest.test.ts のドリフト検出が保証する
 * （filterMeta のキー集合 == builtinFilters のキー集合）。フィルタを追加して meta を
 * 書き忘れると CI が落ちる。
 */
type FilterResultType = "boolean" | "number" | "string" | "passthrough";
type FilterArgType = "number" | "string" | "any";
interface IFilterMeta {
    /** 説明（補完・ホバー用） */
    description: string;
    /** 引数を取るか */
    hasArgs: boolean;
    /** 適用後の結果型（passthrough は入力型をそのまま返す） */
    resultType: FilterResultType;
    /** 受け入れ可能な入力型（'any' は任意） */
    acceptTypes: "any" | readonly string[];
    /** 引数の最小数 */
    minArgs: number;
    /** 引数の最大数 */
    maxArgs: number;
    /** 各引数の期待型（省略時はチェックしない） */
    argTypes?: readonly FilterArgType[];
}
/** 組み込みフィルタ名 → 構造化メタデータ。キー集合は builtinFilters と一致しなければならない。 */
declare const builtinFilterMeta: Record<string, IFilterMeta>;

/** マニフェストのバージョン（構造を変えたら上げる）。 */
declare const WCS_MANIFEST_VERSION = 1;
interface IWcsManifest {
    version: number;
    syntax: {
        /** バインド属性名（既定 data-wcs） */
        bindAttribute: string;
        /** タグ名（既定 wcs-state） */
        tagName: string;
        /** パス区切り（`.`） */
        pathDelimiter: string;
        /** ワイルドカード（`*`） */
        wildcard: string;
        /** バインディング構文 `[prop][#mod]: [path][|filter...]` の区切り文字 */
        delimiters: {
            binding: string;
            propValue: string;
            modifier: string;
            filter: string;
        };
        /** 構造ディレクティブ（`<template data-wcs="for: ...">` 等） */
        structuralDirectives: readonly string[];
        /**
         * 修飾子（`#` 後）の語彙。flags は値を取らない形（`#prevent`）、keyValue は
         * `=` で値を取る形（`#init=element`）、eventNamePrefix は `on` + イベント名の形
         * （`#onchange` — two-way / radio / checkbox のイベント名上書き。README「Modifiers」）。
         * define.ts の定数が単一正本で、ランタイムの消費箇所も同じ定数に分岐する。
         */
        modifiers: {
            flags: readonly string[];
            keyValue: readonly string[];
            eventNamePrefix: string;
        };
        /** リストインデックス参照名（`$1`..`$N`）。prefix + 1 始まり連番、maxDepth まで。 */
        indexParam: {
            prefix: string;
            maxDepth: number;
        };
        /**
         * bindingType 判別の語彙（parseBindTextsForElement の分岐と同一の定数から導出）。
         * 判別順: else → spread → 構造ディレクティブ/radio/checkbox → eventToken・`on*`
         * （event）→ prop。propNamespaces は左辺先頭セグメントの特殊 namespace で、
         * apply 層のディスパッチキー集合との一致はテストが強制する。
         * 既知の未収載: `radio` / `checkbox`（BindingType union のみが正本）。
         */
        bindingTypes: {
            elseKeyword: string;
            spread: string;
            eventPropertyPrefix: string;
            /** 左辺の先頭に付けると、名前が `on` で始まってもイベントにしない明示のプロパティ形（`.online:`、要件 B5） */
            explicitPropertyPrefix: string;
            propNamespaces: {
                eventToken: string;
                command: string;
                class: string;
                attr: string;
                style: string;
            };
        };
    };
    /** 組み込みフィルタ名（builtinFilters から自動導出＝実装が正本） */
    filters: string[];
    /** 組み込みフィルタの構造化メタデータ（説明・引数仕様・型）。vscode-wcs の手リスト撤去用。 */
    filterMeta: Record<string, IFilterMeta>;
    /** 組み込みフィルタの旧名 → 正式名（要件 B12）。旧名も解決するが、ツールは正式名を提案する */
    filterAliases: Readonly<Record<string, string>>;
    /** 予約ライフサイクルフック名 */
    reservedLifecycle: readonly string[];
    /** 予約 state API（プロトコル系の `$` 名前空間） */
    reservedStateApi: readonly string[];
}
/** 機械可読な単一正本を返す。vscode-wcs はこれを消費する想定。 */
declare function getWcsManifest(): IWcsManifest;

/**
 * devtools/types.ts
 *
 * DevTools Hook Protocol (docs/devtools-hook-protocol.md) の型定義。
 *
 * イベント payload はランタイム内部オブジェクト（IAbsoluteStateAddress /
 * IBindingInfo 等）への生参照を含む（同一 realm・オーバーレイ前提、protocol 原則 4）。
 * 消費者はこれらを変異してはならない。
 */

type DevtoolsEvent = {
    readonly type: "state:element-registered";
    readonly rootNode: Node;
    readonly element: IStateElement;
} | {
    readonly type: "state:element-unregistered";
    readonly rootNode: Node;
    readonly element: IStateElement;
} | {
    readonly type: "state:write";
    readonly absoluteAddress: IAbsoluteStateAddress;
    readonly value: unknown;
    /** same-value guard が既に取得していた場合のみ意味を持つ（protocol §4.2） */
    readonly oldValue: unknown;
    readonly hasOldValue: boolean;
} | {
    readonly type: "state:update-batch";
    readonly addresses: ReadonlySet<IAbsoluteStateAddress>;
} | {
    readonly type: "state:binding-added";
    readonly absoluteAddress: IAbsoluteStateAddress;
    readonly binding: IBindingInfo;
} | {
    readonly type: "state:binding-removed";
    readonly absoluteAddress: IAbsoluteStateAddress;
    readonly binding: IBindingInfo;
} | {
    readonly type: "state:binding-cleared";
    readonly absoluteAddress: IAbsoluteStateAddress;
} | {
    readonly type: "state:token-emit";
    readonly kind: "command" | "event";
    readonly tokenName: string;
    readonly args: readonly unknown[];
    readonly subscriberCount: number;
    /**
     * 発火元ツリーの state 要素（protocol v2 追補 2026-09-05・additive）。
     * registry（getOrCreate*Token）経由で作られた token だけが持つ — 直接生成された
     * token や旧ランタイムの payload には無い（optional）。無い emit の実測は
     * ツリー別に分けられないため、消費側は全ツリーの照会へ合算で残す。
     */
    readonly stateElement?: IStateElement;
} | {
    readonly type: "state:watch-error";
    /**
     * throw 元。cur の評価（getter）とハンドラ本体では原因も直し方も違う。
     * `$scan`（scan/scanReport.ts）は `evaluate`（source / 出力の読み）・`fold`（fold の throw・
     * Promise の戻り値・接ぎ木で getter になった from）・`write`（出力の書き込み）を使う
     */
    readonly phase: "prime" | "evaluate" | "handler" | "fold" | "write";
    /** `$watch` の宣言キー（ワイルドカードを含む生のパス）。`$scan` は `$scan.<出力名>` */
    readonly path: string;
    readonly error: unknown;
} | {
    readonly type: "state:watch-chain-limit";
    readonly maxDepth: number;
    /** 打ち切ったバッチに載っていたアドレスのパス（報告用） */
    readonly paths: readonly string[];
} | {
    readonly type: "state:watch-fired";
    /** `$watch` の宣言キー（ワイルドカードを含む生のパス） */
    readonly path: string;
    /**
     * 発火元ツリーの state 要素（protocol v2 追補 2026-09-05・additive）。
     * 複数ツリーが同名の watch パスを宣言するページで実測台帳をツリー別に
     * 分けるための識別。旧ランタイムの payload には無い（optional）— 無い発火は
     * 消費側が全ツリーの照会へ合算で残す。値を載せない契約（§4.3.1）は不変。
     */
    readonly stateElement?: IStateElement;
} | {
    readonly type: "state:path-unresolved";
    /** 書き手が書いた面。診断 code が binding / watch で変わる */
    readonly source: "binding" | "watch" | "scan";
    /** 宣言されたパス（ワイルドカードを含む生の文字列） */
    readonly path: string;
    /** 解決に失敗したセグメント */
    readonly missingSegment: string;
} | {
    readonly type: "state:binding-apply-error";
    /** バインディングの state パス（ワイルドカードを含む生の文字列） */
    readonly path: string;
    readonly bindingType: string;
    readonly error: unknown;
} | {
    readonly type: "propagation:suppressed";
    readonly reason: "confirmation" | "visited-edge";
    readonly transactionId: number;
    readonly edgeId: number;
    readonly node: Node;
    readonly member: string;
} | {
    readonly type: "propagation:coalesced";
    readonly absoluteAddress: IAbsoluteStateAddress;
    readonly droppedTransactionId: number;
    readonly winnerTransactionId: number;
} | {
    readonly type: "propagation:hop-limit";
    readonly absoluteAddress: IAbsoluteStateAddress;
    readonly transactionId: number;
    readonly hop: number;
} | {
    readonly type: "contract:manifest-read";
    readonly tag: string;
    /** 実行時に該当タグが登録済みか(未登録なら drift の起点)。 */
    readonly loaded: boolean;
} | {
    readonly type: "contract:unsupported-extension";
    readonly namespace: string;
} | {
    readonly type: "contract:drift";
    readonly reason: "component-not-loaded" | "missing-member" | "event-mismatch";
    readonly tag: string;
    readonly member?: string;
    /** event-mismatch のとき: sidecar 宣言 event / live event。 */
    readonly sidecarEvent?: string;
    readonly liveEvent?: string;
};
/** contract analyzer(Phase 5b)が生成しうる event だけの狭い union(公開 API の戻り型)。 */
type ContractEvent = Extract<DevtoolsEvent, {
    readonly type: "contract:manifest-read" | "contract:unsupported-extension" | "contract:drift";
}>;

/**
 * contract/types.ts
 *
 * Phase 5b(dev-time contract analyzer)が読む sidecar manifest の最小 subset。
 * 完全な JSON-Schema subset 検証は CI 側(vscode-wcs の validator core)の責務であり、
 * runtime analyzer は「実際に読み込まれた wcBindable 宣言との drift」照合に絞る。
 *
 * この型は vscode-wcs の `wcstack.types` を copy-distribution したもの(§14: ランタイム
 * 依存を導入しない)。CI 側の全量型ではなく drift 照合に必要な形だけを持つ。
 */
interface IContractObservable {
    readonly event?: string;
}
interface IContractComponent {
    readonly observables?: Readonly<Record<string, IContractObservable>>;
    readonly inputs?: Readonly<Record<string, unknown>>;
    readonly commands?: Readonly<Record<string, unknown>>;
}
interface IContractManifest {
    readonly manifestExtensions?: {
        readonly "wcstack.types"?: {
            readonly components?: Readonly<Record<string, IContractComponent>>;
        };
        readonly [namespace: string]: unknown;
    };
}

/**
 * contract/contractAnalyzer.ts
 *
 * Phase 5b(09-remediation-design.md §5b / §7.1 dev runtime / §6 contract trace)の
 * opt-in dev-time analyzer。実際に登録済みの custom element の `static wcBindable`
 * 宣言(= 実行時の正本)を、利用者が渡した sidecar manifest と突き合わせ、drift を
 * DevTools trace(`contract:*`)へ流す。
 *
 * 完了条件「無効時の runtime 挙動・cost が不変」: `analyzeContract` は
 * `config.enableContractAnalyzer` が false のとき即 return し、manifest を一切走査
 * しない(hot path には一切フックしない — 純粋な on-demand API)。
 *
 * pure な core(`analyzeManifestContract`)は宣言解決と emit を注入で受けるためテスト可能。
 */

/**
 * opt-in dev-time contract analysis。無効時はゼロコスト(即 return・manifest 非走査)。
 * 有効時は live 宣言と manifest を突き合わせ、`contract:*` trace を返しつつ、DevTools
 * sink が接続されていれば同時に流す。
 */
declare function analyzeContract(manifest: IContractManifest): readonly ContractEvent[];

declare class State extends HTMLElementBase implements IStateElement {
    static hasConnectedCallbackPromise: boolean;
    static getBindingsReady(rootNode: Node): Promise<void>;
    /**
     * `mount` の動的変更は未サポート（再マウントは非目標 — 設計書 §4-7）。
     * 初期化済み要素での変更は無言で捨てず warn で知らせる。初期化前の属性設定
     * （パース時・接続前の setAttribute）は正規の使い方なので黙る。
     * `name` は connectedCallback 冒頭で fail-fast 済みなので観測しない。
     */
    static get observedAttributes(): string[];
    private __state;
    private _hasUpdatedCallback;
    /** $errorCallback の有無（_hasUpdatedCallback と同じく state セット時に確定。ルートのみ） */
    private _hasErrorCallback;
    /** enable-ssr のスナップショットから初期化された（D14: ボリュームはデータを採用する） */
    private _hydratedFromSsr;
    private _crossRowListPaths;
    private _indexDependentGetterPaths;
    private _initialized;
    /**
     * 初期化（`_initialize`）が失敗した（#257）。`_initialized` の裏返しではない —
     * 「まだ初期化していない」と「もう初期化できない」を取り違えると、復旧不能の
     * 要素に `setInitialState` が効いたように見える。真にするのは
     * `_failInitializeLoudly` だけ。
     */
    private _initializeFailed;
    /**
     * この接続サイクルの失敗は**もう着地した**（#257）。設定エラーの fail-fast
     * （`_failInitialization` と `initializeMountScope` の catch）は自分で promise を
     * 解決してから raise する — connectedCallbackPromise を**解決**する側のクラスなので、
     * 下の loud な着地（reject ＋ 診断）に載せ替えると意味論が変わる。接続ごとに畳む。
     */
    private _initializationLanded;
    private _initializePromise;
    private _resolveInitialize;
    private _connectedCallbackPromise;
    private _resolveConnectedCallback;
    private _rejectConnectedCallback;
    private _loadingPromise;
    private _resolveLoading;
    private _setStatePromise;
    private _resolveSetState;
    private _listPaths;
    private _listKeys;
    private _recursionRegistry;
    private _elementPaths;
    private _getterPaths;
    private _setterPaths;
    private _loopContextStack;
    private _dynamicDependency;
    private _staticDependency;
    private _pathSet;
    /**
     * state の世代（issue #258 の X10）。`_state` の差し替えごとに 1 つ進み、キャッシュ項目の
     * 印になる（cache/types.ts の `generation`）。`_version`（更新サイクルの番号）とは別の
     * カウンタで、増える条件が違う — 再セットは世代だけを進める
     * （`__tests__/integration.stateGenerationReset.test.ts` の
     * 「再セットは世代だけを進め、version は動かさない」が固定する）。
     */
    private _stateGeneration;
    /**
     * この要素が受け取った `setPathInfo` の台帳（issue #258 の X7）。パス → 種別と呼び出し元。
     *
     * `_pathSet` / `_listPaths` / `_elementPaths` は再セットでクリアされるが、それらを登録した
     * バインドは生き残る（再セットは DOM を作り直さない）。台帳が空のままだと依存ウォークが
     * `items` をリストとして展開できず、全リスト書き込みが「非リストのアドレスにワイルドカードを
     * 展開できない」で恒久的に throw する（値と DOM は追従するが、書き込みのたびに投げ続ける）。
     * クリアのあと、この台帳から作り直す（`_rebuildPathInfo`）。
     *
     * `source === "internal"`（再帰の生成アクセサ・ボリュームのツリーアクセサ）は載せない。
     * あれらは生やした機構が新しい世代で登録し直す（recursion/registry.ts の `_define`）。
     *
     * `bound` はバインドがいちどでも登録したか（#270）。作り直しで存在検査をやり直すのはバインドの
     * パスだけ — `$watch` / `$scan` の登録は前の世代の宣言の残骸でもあり、今の世代の宣言は
     * 作り直しの後で自分の検査をする（`processWatchDeclaration` / `registerScans`）。残骸まで
     * 検査すると、新しい宣言から外したパスを「存在しない」と誤って報告する。
     */
    private _pathRegistrations;
    /**
     * 切断中の再セットで適用し直せなかったトップレベルのパス（#267）。再適用には rootNode が要るので、
     * 再接続で `reapplyStateBindings` に渡す。切断中に何度入れ直しても和集合で持つ
     * （前の世代にしか無いキーのバインドも失敗として報告させるため）。
     */
    private _pendingReapplyPaths;
    /**
     * これまでのどの世代かで再帰レジストリが実体化した具体パス（`nodes.*.total` 等）の累積。
     * 再セットのたびに `forgetGenerated` の戻り値を足し、`_rebuildPathInfo` の除外に使う。
     *
     * 除外は**世代を跨いで累積する**。読みを挟まない連続した再セットでも、生成アクセサの具体パスを
     * 指す静的辺（`nodes.*` → `nodes.*.total`）が戻らないことは、
     * `__tests__/integration.stateGenerationReset.test.ts` の
     * 「読みを挟まない 3 連続の再セットで静的辺が戻らない」が固定する。
     */
    private _generatedPaths;
    private _watchPaths;
    private _scanPaths;
    private _version;
    private _rootNode;
    private _boundComponent;
    private _boundComponentStateProp;
    private _hasMounts;
    private _hasGraftedVolumes;
    /** 読み書き境界の hook（設計案 H1）。宣言が要求する機能の分だけ付く */
    private _addressHooks;
    private _bindableEventMap;
    private _commandTokenNames;
    private _eventTokenNames;
    private _treeless;
    private _connectGeneration;
    constructor();
    private get _state();
    private set _state(value);
    attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void;
    private _loadFromSsrElement;
    /** state / src / json / inner <script> / API set のソース解決（_initialize とボリュームで共用）。 */
    private _loadStateFromSource;
    /**
     * 初回マウントのロードと登録。戻り値は「この接続で初期化を**完了**したか」で、
     * `false` は失敗ではなく**中断**（ロード中に要素が剥がされた — 下の注記）。
     */
    private _initialize;
    /**
     * 設定エラーでの fail-fast。initializePromise 等を解決してから raise する —
     * 未解決のまま投げると waitForStateInitialize（ホストの buildBindings）が
     * この要素を待ち続け、**ページ全体が無言でウェッジする**（1 つの設定ミスが
     * 無関係なバインディングまで道連れにする）。エラー自体は unhandled rejection
     * として loud に残る。
     */
    private _failInitialization;
    /**
     * `_initialize` の失敗の着地（#257）。旧挙動は「throw が connectedCallback の外へ
     * 出るだけ」で、`_initializePromise` も `_connectedCallbackPromise` も永久に未解決の
     * まま残り、作者が受け取るのは診断ではなく無言のハングだった。載るのは
     * `_initialize` が投げうるもの全部 — `_state` セッタの宣言検証（$recursion /
     * $commandTokens / $eventTokens / $on / $streams / $listKeys / $watch）、
     * `_loadStateFromSource` のロード失敗（src の拡張子・json のパース・内包スクリプト・
     * 外部モジュール）、SSR データの merge、そして `setStateElement` の
     * 「1 rootNode 1 ツリー」違反（**別の**要素が 2 本目に来た形 — 同じ要素の再登録は
     * 冪等なので、ロード中の remove → append はここへ来ない）。
     *
     * 載**らない**もの: ロード中に要素が剥がされた形。作者のミスが 1 つも無いので
     * 初期化失敗ではなく中断として扱う（`_initialize` が `false` を返す）。
     *
     * もう 1 つ載らないのがボリューム（`mount=`）の失敗。`_initializeVolume` の catch が
     * 3 つの promise（initialize / loading / connectedCallback）を自分で解決してから raise し、
     * `connectedCallback` のボリューム分岐はそれを包まないので、ボリュームはこの着地に
     * 載らず connectedCallbackPromise を**拒否しない**。自前の報告が出るかどうかは失敗の
     * 種類による。報告が無い形では、逃げ方は `name=`（`_failInitialization` の注記）と
     * 同じで、throw はカスタム要素リアクションが捨てる戻り Promise へ出ていく
     * （ブラウザのコンソールには "Uncaught (in promise)" として残るが、promise を待つ側
     * ＝ renderToString・mount・テストレシピには届かない）。失敗箇所ごとの正確な挙動は
     * `__tests__/integration.initFailureDiagnostics.test.ts` が固定している。挙動はこの
     * PR では変えない（枠の寿命は別 Issue）。
     *
     * `connectedCallback` が `_initialize` より前に await する 2 つ
     * （DCC の接続 — dcc/dccLifecycle.ts が内部面の `failInitializeLoudly` で載せる — と、
     * `bind-component` の preparing）の raise も同じ着地に載る。
     * 特に「初期化に失敗した要素の再接続」は `bindWebComponent` → `setInitialState` の
     * 復旧不能 raise でそこへ来るので、包まないと診断ゼロで素通りする。
     *
     * `_failInitialization`（設定エラーの fail-fast）との違いは 1 つ:
     * **connectedCallbackPromise を reject する**。ここまで来た要素は state を 1 つも
     * 持たない ＝ このツリーは存在しない。resolve すると、それを待つ消費者
     * （@wcstack/server の renderToString・@wcstack/testing の mount・README の
     * テストレシピ）に「準備完了」と嘘をつく。下の SSR 経路（_rejectConnectedCallback）と
     * 同じ規範で、そちらと同じく**元のエラーをそのまま**投げ直す。
     *
     * `initializePromise` は従来どおり**解決**する（reject しない）。
     * `waitForStateInitialize` はページ中の全 `<wcs-state>` の initializePromise を
     * `Promise.all` で待つので、reject にすると 1 要素の設定ミスが無関係な
     * バインディングまで道連れになる（_failInitialization の注記と同じ理由）。
     *
     * 後始末はしない: `_initialized` を立てないので `disconnectedCallback` は初期化前
     * ガードで抜ける。`$listKeys` / `$watch` のようにセッタの後半で落ちた形では
     * `$on` の購読と stream registry が残るが、この要素は復旧不能（setInitialState が
     * throw する）なので、残骸は要素ごと捨てる前提で放置する。
     *
     * `ownsTree` が false の着地は、この要素だけを失敗させてルートに触らない。`mount=` の
     * readiness barrier（要件 D23）が使う: ボリュームはツリーの持ち主ではなく、ルートより先に
     * 接続したボリュームでは rootNode にまだ誰も居ないので、既定の着地だとまだ来ていないルートの
     * ノードを利用不能と印付けし、保留中の他のボリュームまで落としてしまう。
     */
    private _failInitializeLoudly;
    private _callStateConnectedCallback;
    private _callStateDisconnectedCallback;
    connectedCallback(): Promise<void>;
    disconnectedCallback(): void;
    get initialized(): boolean;
    /**
     * ライフサイクル機能（core/lifecycleHooks.ts、設計案 H3）へ開く内部面。接続を引き取った機能が
     * 要素の初期化を所有するために要る最小限。
     */
    get connectedRootNode(): Node | null;
    clearConnectedRootNode(): void;
    markInitialized(): void;
    settleInitialization(): void;
    loadStateFromSource(): Promise<Record<string, any>>;
    markTreeless(): void;
    /** 初期化失敗の着地（`_failInitializeLoudly`）。接続を引き取った機能が自分の失敗を載せる */
    failInitializeLoudly(error: unknown): never;
    get connectGeneration(): number;
    setWatchPaths(paths: ReadonlySet<string> | null): void;
    setScanPaths(paths: ReadonlySet<string> | null): void;
    /** 設定エラーの着地（`_failInitialization` の raise を除いた部分）。引き取った機能が使う */
    landInitialization(): void;
    setRecursionRegistry(registry: RecursionRegistry | null): void;
    addGeneratedPath(path: string): void;
    setBoundComponent(component: Element | null, stateProp: string | null): void;
    get initializePromise(): Promise<void>;
    get connectedCallbackPromise(): Promise<void>;
    get listPaths(): Set<string>;
    get listKeys(): ListKeyMap | null;
    get hasRecursion(): boolean;
    get recursionRegistry(): RecursionRegistry | null;
    get watchPaths(): ReadonlySet<string> | null;
    get scanPaths(): ReadonlySet<string> | null;
    get elementPaths(): Set<string>;
    /**
     * ボリューム（webComponent/volume.ts）のアクセサ登録: ツリーパスをキーにした
     * quoted-path アクセサを state オブジェクトに定義し、getter / setter 台帳と
     * 依存グラフに載せる。ルートのワイルドカード getter（`"children.*.label"`）と
     * 同じ機構に乗るので、評価は pushAddress 下・依存はグラフに載る。
     */
    /** ボリュームの watch パスをホットパス用ゲート（watchPaths）へ合流させる。 */
    addVolumeWatchPaths(paths: ReadonlySet<string>): void;
    /** ボリュームの $listKeys（接頭辞翻訳済み）をルートの表へ合流させる。衝突は設定ミス。 */
    mergeVolumeListKeys(entries: ReadonlyMap<string, ListKeySpec>): void;
    /** ボリュームが $updatedCallback を持つとき、収集ゲートを開ける（apply/applyChange.ts）。 */
    enableUpdatedCallback(): void;
    /** enable-ssr スナップショットから初期化されたか（D14 — webComponent/volume.ts が読む）。 */
    get hydratedFromSsr(): boolean;
    addListPath(path: string): void;
    findStateDescriptor(path: string): PropertyDescriptor | undefined;
    defineTreeAccessor(path: string, descriptor: PropertyDescriptor): void;
    get getterPaths(): Set<string>;
    get setterPaths(): Set<string>;
    get loopContextStack(): ILoopContextStack;
    get dynamicDependency(): Map<string, string[]>;
    get staticDependency(): Map<string, string[]>;
    get version(): number;
    /** state の世代（キャッシュ項目の印の正本 — cache/types.ts の `generation`）。 */
    get stateGeneration(): number;
    get rootNode(): Node;
    get boundComponentStateProp(): string | null;
    get hasMounts(): boolean;
    /** 唯一の呼び手は webComponent/mount.ts の registerMountRecord（Phase 2）。 */
    markHasMounts(): void;
    get hasGraftedVolumes(): boolean;
    get addressHooks(): IAttachedHooks | null;
    /** 宣言 `declaration` が要求する機能 `feature` の hook をこの state に付ける（未 install なら throw、D13） */
    attachAddressHooks(feature: string, declaration: string): void;
    /** 唯一の呼び手は webComponent/volume.ts の graftVolume（D22 後段のガードが読む）。 */
    markHasGraftedVolumes(): void;
    /** ボリュームがこのルートに予約された（接ぎ木前でも、予約下の読みは undefined が正 — D22） */
    markHasVolume(): void;
    /** スコープ機能（マウント・ボリューム）の hook をこの state に付ける（冪等） */
    private _attachScopeHooks;
    get bindableEventMap(): Record<string, string>;
    get commandTokenNames(): ReadonlySet<string>;
    get eventTokenNames(): ReadonlySet<string>;
    setBindableEventMap(map: Record<string, string>): void;
    private _addDependency;
    /**
     * source,           target
     *
     * products.*.price => products.*.tax
     * get "products.*.tax"() { return this["products.*.price"] * 0.1; }
     *
     * products.*.price => products.summary
     * get "products.summary"() { return this.$getAll("products.*.price", []).reduce(sum); }
     *
     * categories.*.name => categories.*.products.*.categoryName
     * get "categories.*.products.*.categoryName"() { return this["categories.*.name"]; }
     *
     * @param sourcePath
     * @param targetPath
     */
    addDynamicDependency(sourcePath: string, targetPath: string): boolean;
    /**
     * source,      target
     * products => products.*
     * products.* => products.*.price
     * products.* => products.*.name
     *
     * @param sourcePath
     * @param targetPath
     */
    addStaticDependency(sourcePath: string, targetPath: string): boolean;
    setPathInfo(path: string, bindingType: BindingType, source?: PathInfoSource): void;
    /**
     * 再セットで消した経路情報を、生き残ったバインドの登録から作り直す（issue #258 の X7）。
     *
     * `_pathSet.clear()` は残す。あのクリアには、`forgetGeneration` が外した静的辺を「行が
     * 作り直されたときに登録し直させる」自己修復が乗っている（辺が戻ることは
     * `__tests__/integration.stateGenerationReset.test.ts` の
     * 「静的な辺 nodes.* → nodes.*.total が戻る」が固定する）。消したうえで、生きているバインド
     * ぶんだけ `setPathInfo` をやり直す — `$recursion` のアンカーで既に同じことをしている手口を、
     * バインド全体へ広げたもの。
     *
     * `_generatedPaths`（これまでの世代の生成アクセサの具体パス）は張り直さない。行バインドが
     * 名指していても、新しい世代ではまだ実体化されていないため（recursion/generation.ts）。読みが
     * 実体化したときに `defineTreeAccessor` が登録し直す。
     *
     * 作り直すのはバインドが登録したパスだけ（`_pathRegistrations` の `bound`・#270）。`$watch` /
     * `$scan` だけの登録は飛ばす — 作り直しの後で今の世代の宣言が自分で登録し直し、そこで存在も
     * 検査される。ここで `_pathSet` に入れてしまうと、宣言側の `setPathInfo` が `_pathSet.has` で
     * 素通りし、両方の世代で宣言し続けたパスが新しい state で消えても報告されない。
     *
     * 反復中に `setPathInfo` が台帳へ書き戻す（既存キーの上書きのみで新キーは増えない）ので、
     * 誤解を避けるためスナップショットを取ってから回す。
     */
    private _rebuildPathInfo;
    private _createState;
    createStateAsync(mutability: Mutability, callback: (state: IStateProxy) => Promise<void>): Promise<void>;
    createState(mutability: Mutability, callback: (state: IStateProxy) => void): void;
    nextVersion(): number;
    get hasUpdatedCallback(): boolean;
    get hasErrorCallback(): boolean;
    get crossRowListPaths(): ReadonlySet<string>;
    addCrossRowListPath(path: string): void;
    get indexDependentGetterPaths(): ReadonlySet<string>;
    addIndexDependentGetterPath(path: string): void;
    setInitialState(state: Record<string, any>): void;
    /** 確立済みのバインドを今の世代で適用し直す（#267）。行のバインドは経路情報の台帳のパスから引く。 */
    private _reapplyBindings;
}

declare global {
    interface HTMLElementTagNameMap {
        "wcs-state": State;
        "wcs-ssr": Ssr;
    }
}

export { Ssr, TRUSTED_TYPES_POLICY_SLOT, VERSION, WCS_MANIFEST_VERSION, analyzeContract, bootstrapState, buildBindings, builtinFilterMeta, defineState, getBindingsReady, getConfig, getTrustedTypesPolicy, getWcsManifest, setTrustedTypesPolicy };
export type { ContractEvent, FilterArgType, FilterResultType, IBindingErrorInfo, IContractManifest, IFilterMeta, ISsrElement, IWcsManifest, IWcsTrustedTypesPolicy, IWritableConfig, IWritableTagNames, WcsPathValue, WcsPaths, WcsStateApi, WcsThis };
