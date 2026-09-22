import { config, inSsr, isOrchestratedSsr } from "../config";
import { loadFromInnerScript } from "../stateLoader/loadFromInnerScript";
import { loadFromJsonFile } from "../stateLoader/loadFromJsonFile";
import { loadFromScriptFile } from "../stateLoader/loadFromScriptFile";
import { loadFromScriptJson } from "../stateLoader/loadFromScriptJson";
import { raiseError } from "../raiseError";
import { BindingType, IState } from "../types";
import { IStateElement } from "./types";
import { setStateElement, getStateElement, getBindingsReady, markBindingsUnavailable } from "../stateElementByName";
import { ILoopContextStack } from "../list/types";
import { createLoopContextStack } from "../list/loopContext";
import { DCC_DEFINITION_ATTRIBUTE, NO_SET_TIMEOUT, STATE_CONNECTED_CALLBACK_NAME, STATE_DISCONNECTED_CALLBACK_NAME, STATE_ERROR_CALLBACK_NAME, STATE_UPDATED_CALLBACK_NAME, WILDCARD } from "../define";
import { normalizeDeclarationAliases } from "../declarationAliases";
import { processCommandTokensDeclaration } from "../command/processCommandTokensDeclaration";
import { clearCommandNamespace } from "../command/commandNamespace";
import { processEventTokensDeclaration } from "../event/processEventTokensDeclaration";
import { clearEventTokenRegistry } from "../event/eventTokenRegistry";
import { processOnDeclaration } from "../event/processOnDeclaration";
import { ListKeyMap, ListKeySpec, processListKeysDeclaration } from "../list/listKeys";
import type { RecursionRegistry } from "../recursion/registry";
import { STATE_WATCH_NAME, STATE_BINDABLES_NAME } from "../define";
import { appendHooks, createAttachedHooks, IAttachedHooks, requireFeature } from "../core/addressHooks";
import { createDeclarationContext, runActivate, runApply, runApplyEarly, runDeactivate, runPreCommit, runRegister, runValidate, runValidateEarly } from "../core/declarationHooks";
import { getPathInfo } from "../address/PathInfo";
import { IStateProxy, Mutability } from "../proxy/types";
import { createStateProxy } from "../proxy/StateHandler";
import { requireLifecycleFeature, runConnecting, runDisconnecting, runInitializeFailed, runInitializeFailureCleared, runPreparing, runReconnecting, runReplacingState } from "../core/lifecycleHooks";
import { connectedCallbackSymbol, disconnectedCallbackSymbol } from "../proxy/symbols";
import { requireSsrHooks } from "../core/ssrHooks";
import { HTMLElementBase } from "../platform/HTMLElementBase";
import { getAllPropertyDescriptors } from "../getAllPropertyDescriptors";
import { findDescriptor, PathInfoSource } from "../pathDiagnostics";
import { pathDiagnostics } from "../core/diagnosticsHooks";
import { collectReapplyPaths, reapplyStateBindings } from "../apply/reapplyStateBindings";

function getStateInfo(
  state: IState
): {
  getterPaths: Set<string>,
  setterPaths: Set<string>,
} {
  const getterPaths: Set<string> = new Set<string>();
  const setterPaths: Set<string> = new Set<string>();
  const descriptors = getAllPropertyDescriptors(state);
  for(const [ key, descriptor ] of Object.entries(descriptors)) {
    if (typeof descriptor.get === "function") {
      getterPaths.add(key);
    }
    if (typeof descriptor.set === "function") {
      setterPaths.add(key);
    }
  }
  return {
    getterPaths, setterPaths
  };
}

export class State extends HTMLElementBase implements IStateElement {
  static hasConnectedCallbackPromise = true;

  static getBindingsReady(rootNode: Node): Promise<void> {
    return getBindingsReady(rootNode);
  }

  /**
   * `mount` の動的変更は未サポート（再マウントは非目標 — 設計書 §4-7）。
   * 初期化済み要素での変更は無言で捨てず warn で知らせる。初期化前の属性設定
   * （パース時・接続前の setAttribute）は正規の使い方なので黙る。
   * `name` は connectedCallback 冒頭で fail-fast 済みなので観測しない。
   */
  static get observedAttributes(): string[] {
    return ["mount"];
  }

  private __state: IState | undefined;
  private _hasUpdatedCallback: boolean = false;
  /** $errorCallback の有無（_hasUpdatedCallback と同じく state セット時に確定。ルートのみ） */
  private _hasErrorCallback: boolean = false;
  /** enable-ssr のスナップショットから初期化された（D14: ボリュームはデータを採用する） */
  private _hydratedFromSsr: boolean = false;
  // 他行を読む getter が検出されたリストパス（diff-filter 展開の全行フォールバック対象）。
  // 依存マップ（static/dynamic）と同様に追加のみ・クリアしない（安全側に固定される）。
  private _crossRowListPaths: Set<string> = new Set<string>();
  // $1 等のインデックスを読んだ getter パス（実行時検出）。位置のみ変わった行の
  // 静的子展開はこの集合の subtree に限定される。追加のみ・クリアしない（安全側）。
  private _indexDependentGetterPaths: Set<string> = new Set<string>();
  private _initialized: boolean = false;
  /**
   * 初期化（`_initialize`）が失敗した（#257）。`_initialized` の裏返しではない —
   * 「まだ初期化していない」と「もう初期化できない」を取り違えると、復旧不能の
   * 要素に `setInitialState` が効いたように見える。真にするのは
   * `_failInitializeLoudly` だけ。
   */
  private _initializeFailed: boolean = false;
  /**
   * この接続サイクルの失敗は**もう着地した**（#257）。設定エラーの fail-fast
   * （`_failInitialization` と `initializeMountScope` の catch）は自分で promise を
   * 解決してから raise する — connectedCallbackPromise を**解決**する側のクラスなので、
   * 下の loud な着地（reject ＋ 診断）に載せ替えると意味論が変わる。接続ごとに畳む。
   */
  private _initializationLanded: boolean = false;
  private _initializePromise: Promise<void>;
  private _resolveInitialize: (() => void) | null = null;
  private _connectedCallbackPromise: Promise<void>;
  private _resolveConnectedCallback: (() => void) | null = null;
  private _rejectConnectedCallback: ((reason?: unknown) => void) | null = null;
  private _loadingPromise: Promise<void>;
  private _resolveLoading: (() => void) | null = null;
  private _setStatePromise: Promise<Record<string, any>> | null = null;
  private _resolveSetState: ((value: Record<string, any>) => void) | null = null;
  private _listPaths: Set<string> = new Set<string>();
  private _listKeys: ListKeyMap | null = null;
  private _recursionRegistry: RecursionRegistry | null = null;
  private _elementPaths: Set<string> = new Set<string>();
  private _getterPaths: Set<string> = new Set<string>();
  private _setterPaths: Set<string> = new Set<string>();
  // v2: 境界ホップがループ文脈を継承するので Δ（base depth）の帳簿は無い
  private _loopContextStack: ILoopContextStack = createLoopContextStack();
  private _dynamicDependency: Map<string, string[]> = new Map<string, string[]>();
  private _staticDependency: Map<string, string[]> = new Map<string, string[]>();
  private _pathSet: Set<string> = new Set<string>();
  /**
   * state の世代（issue #258 の X10）。`_state` の差し替えごとに 1 つ進み、キャッシュ項目の
   * 印になる（cache/types.ts の `generation`）。`_version`（更新サイクルの番号）とは別の
   * カウンタで、増える条件が違う — 再セットは世代だけを進める
   * （`__tests__/integration.stateGenerationReset.test.ts` の
   * 「再セットは世代だけを進め、version は動かさない」が固定する）。
   */
  private _stateGeneration: number = 0;
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
  private _pathRegistrations: Map<string, { bindingType: BindingType; bound: boolean }> =
    new Map<string, { bindingType: BindingType; bound: boolean }>();
  /**
   * 切断中の再セットで適用し直せなかったトップレベルのパス（#267）。再適用には rootNode が要るので、
   * 再接続で `reapplyStateBindings` に渡す。切断中に何度入れ直しても和集合で持つ
   * （前の世代にしか無いキーのバインドも失敗として報告させるため）。
   */
  private _pendingReapplyPaths: Set<string> | null = null;
  /**
   * これまでのどの世代かで再帰レジストリが実体化した具体パス（`nodes.*.total` 等）の累積。
   * 再セットのたびに `forgetGenerated` の戻り値を足し、`_rebuildPathInfo` の除外に使う。
   *
   * 除外は**世代を跨いで累積する**。読みを挟まない連続した再セットでも、生成アクセサの具体パスを
   * 指す静的辺（`nodes.*` → `nodes.*.total`）が戻らないことは、
   * `__tests__/integration.stateGenerationReset.test.ts` の
   * 「読みを挟まない 3 連続の再セットで静的辺が戻らない」が固定する。
   */
  private _generatedPaths: Set<string> = new Set<string>();
  // `$watch` 宣言の監視対象パス。宣言が無ければ null（setByAddress のゼロコスト契約）
  private _watchPaths: ReadonlySet<string> | null = null;
  private _scanPaths: ReadonlySet<string> | null = null;
  private _version = 0;
  private _rootNode: Node | null = null;
  private _boundComponent: Element | null = null;
  private _boundComponentStateProp: string | null = null;
  private _hasMounts: boolean = false;
  private _hasGraftedVolumes: boolean = false;
  /** 読み書き境界の hook（設計案 H1）。宣言が要求する機能の分だけ付く */
  private _addressHooks: IAttachedHooks | null = null;
  // ボリューム（mount=）の控え（接ぎ木情報・枠・再入ガード）は webComponent/volumeLifecycle.ts が
  // 要素ごとに持つ（設計案 H3 — State はボリュームを知らない）
  private _bindableEventMap: Record<string, string> = {};
  private _commandTokenNames: Set<string> = new Set<string>();
  private _eventTokenNames: Set<string> = new Set<string>();
  // 自分のツリーを持たずに初期化を終えた（DCC 定義要素 — dcc/dccLifecycle.ts）。再接続でこの rootNode の
  // ツリーとして登録し直さない
  private _treeless: boolean = false;
  // connect サイクルの世代カウンタ（connectedCallback 冒頭でインクリメント）。
  // $connectedCallback の await 中の「切断 → 即再接続」では、新 connect が
  // _rootNode を再設定済みのため陳腐化した旧 connect の再開が _rootNode ガードを
  // 素通りして startStreams に到達し、同一の再接続に対して source が二重起動する。
  // 末尾で冒頭に捕捉した世代と照合し、陳腐 connect からの起動を skip する（設計書 §2-3）。
  private _connectGeneration: number = 0;

  constructor() {
    super();
    this._initializePromise = new Promise<void>((resolve) => {
      this._resolveInitialize = resolve;
    });
    this._connectedCallbackPromise = new Promise<void>((resolve, reject) => {
      this._resolveConnectedCallback = resolve;
      this._rejectConnectedCallback = reject;
    });
    this._loadingPromise = new Promise<void>((resolve) => {
      this._resolveLoading = resolve;
    });
    this._setStatePromise = new Promise<Record<string, any>>((resolve) => {
      this._resolveSetState = resolve;
    });
  }

  private get _state(): IState {
    if (typeof this.__state === "undefined") {
      raiseError(`${config.tagNames.state} _state is not initialized yet.`);
    }
    return this.__state;
  }

  private set _state(value: IState) {
    // 宣言キーの旧名（`$updatedCallback` / `$streams`）を正式名へ写す（要件 B12）— 以降の読み手は正式名だけを見る
    normalizeDeclarationAliases(value);
    // 旧世代のデータ。再帰の生成物（辺・キャッシュ）を忘れるとき、台帳を辿る起点になる
    const previousState = this.__state;
    // 順序: **`value` しか読まない検証** → 旧世代の後始末 → 世代を進める → 差し替え → 再収集。
    //
    // 宣言の検証は世代更新を挟んで 2 群に割れる。
    //  - 世代を進める**前**に走る 5 つ: `$recursion`（宣言とレジストリの構築）・`$commandTokens`・
    //    `$eventTokens`・`$listKeys`・`$scan`。どれも `value` しか読まないのでここへ置ける。この 5 つで
    //    throw した再セットは世代を進めず、`__state` も旧世代の読みもそのまま残る。
    //  - 世代を進めた**後**に走る 3 つ: `$on`（下・`_eventTokenNames` と token registry を要る）・
    //    `$streams`・`$watch`。この 3 つで throw した再セットは、世代が進んで `__state` も
    //    新しくなった後に落ちる。
    // throw の後に何が残るかは検証ごとに違う。散文で言い直さない —
    // `__tests__/integration.stateGenerationReset.test.ts` が 1 つずつ固定する。
    //
    // 後の 2 つがこの位置に要る理由（同じファイルが 1 本ずつ固定する）:
    //  - `$streams` の衝突検査は**新しい** value から集め直した `getterPaths` / `setterPaths` を
    //    見る（旧 state だけが持つ getter は、新 state の同名 `$streams` と衝突しない）。
    //  - `$watch` の存在検査は**新しい** `__state` を見る（新 state にだけあるパスの watch は
    //    `wcs/watch-path-missing` にならない）。
    // 宣言の段（設計案 H4）。文脈袋はこの set のぶんだけ作り、機能どうしの受け渡しに使う。
    // `$recursion` はここで解析され、構築したレジストリを袋に置く — `$scan` の検証がそれを読む
    const declarations = createDeclarationContext();
    declarations.set("previousState", previousState);
    runValidateEarly(this, value, declarations);
    const commandTokenNames = processCommandTokensDeclaration(value);
    const eventTokenNames = processEventTokensDeclaration(value);
    // $listKeys の検証は `value` しか読まない（要素にも旧世代にも触れない）ので、ここで済ませる。
    // 反映は下の所定位置のまま（クリアと再収集の並びは変えない）。
    const listKeys = processListKeysDeclaration(value);
    // 検証の段（設計案 H4 の validate）: 世代を進める前の、`value` しか読まない段。ここで throw した
    // 再セットは世代を進めない。core が作ったトークン名を袋へ publish する（`$scan` の検証が読む）
    declarations.set("eventTokenNames", eventTokenNames);
    runValidate(this, value, declarations);
    // 検証がすべて済み、まだ世代を進めていない点（設計案 H4 の preCommit）: 旧世代の後始末と
    // 差し替えがここに載る（`$recursion` — recursion/declarations.ts）
    runPreCommit(this, value, declarations);
    this._commandTokenNames = commandTokenNames;
    this._eventTokenNames = eventTokenNames;
    // 世代を進める（issue #258 の X10）。位置は「旧世代の後始末（forgetGenerated）の**後**・
    // `__state` の差し替えの**前**」。上の 5 つ（`value` しか読まない検証）で throw した再セットは
    // ここへ到達しないので、要素は丸ごと旧世代に留まる — 世代も、旧世代のキャッシュが返す読みも
    // 据え置き（同ファイルの「throw する再セットは世代を進めない」4 本が固定する）。
    this._stateGeneration++;
    this.__state = value;
    // 存在検査の台帳も世代に属する（#270）。「パスごとに 1 回」の印を前の世代から持ち越すと、
    // 下の経路情報の作り直しが新しい state で検査し直さない。初回のセットには捨てるものが無い
    if (typeof previousState !== "undefined") {
      pathDiagnostics?.reset(this);
    }
    // $updatedCallback の有無を state セット時に確定しておく（in はプロトタイプ
    // チェーンも見る・getter を評価しない）。drain 側はこのフラグで更新アドレスの
    // 集計と writable createState をスキップできる。
    // 注: state セット後に生オブジェクトへ直接 $updatedCallback を後付けする
    // パターンは検知できない（bindProperty / _state 再セットは検知する）。
    // ライフサイクルフックは宣言時に定義するのが規約。
    this._hasUpdatedCallback = STATE_UPDATED_CALLBACK_NAME in value;
    this._hasErrorCallback = STATE_ERROR_CALLBACK_NAME in value;
    // 再 set 時に二重 subscribe しないよう registry をクリアしてから $on を配線し直す。
    clearEventTokenRegistry(this);
    // 差し替え直後の段（設計案 H4 の applyEarly）: `$on` の配線より前に走る（`$scan` の出力の実体化と
    // 購読 — 同じトークンでは reducer → effect の順、D11。scan/declarations.ts）
    runApplyEarly(this, value, declarations);
    processOnDeclaration(this, value, this._eventTokenNames);
    this._listPaths.clear();
    this._elementPaths.clear();
    this._getterPaths.clear();
    // 再 set 時の残骸が $streams の衝突検査（processStreamsDeclaration）に
    // 偽陽性で命中しないよう getterPaths と対称にクリアする。
    this._setterPaths.clear();
    this._pathSet.clear();
    const stateInfo = getStateInfo(value);
    for(const path of stateInfo.getterPaths) {
      this._getterPaths.add(path);
    }
    for(const path of stateInfo.setterPaths) {
      this._setterPaths.add(path);
    }
    // 宣言の反映（設計案 H4 の apply）: パス収集の後に走る段。`$streams` の衝突検査が
    // 新しい getterPaths / setterPaths を見るので、この位置でなければならない（stream/streamRuntime.ts）
    runApply(this, value, declarations);
    // $listKeys: 宣言が無ければ null のままで、setByAddress のキー突合経路には
    // 一切入らない（docs/state-list-key-design.md §7-1）。再 set で必ず置き換える。
    this._listKeys = listKeys;
    // 生きているバインドの経路情報を作り直す（issue #258 の X7）。置き場所は
    // `_pathSet` / `_listPaths` / `_elementPaths` のクリアより後、startWatch / startStreams より前。
    // 上で存在検査の台帳を捨てているので、バインドのパスはここで新しい state に対して検査し直され、
    // 第 2 世代で消えたバインド先が報告される（#270 — `__tests__/integration.stateGenerationReset.test.ts`
    // の末尾が固定する）。
    this._rebuildPathInfo();
    // 依存グラフ登録の段（設計案 H4 の register）: `_rebuildPathInfo` と `$scan` の登録の後。
    // `$watch` はここで宣言を解析し直す（watch/watchRuntime.ts）
    runRegister(this, value, declarations);
    // 接続中の再 set（S13）は新宣言で即再起動する（設計案 H4 の activate）。起動の可否・
    // 二重起動ガード・SSR の除外は機能側が持つ。初回（_initialize 中）は初期化前なので
    // ここでは起動されず、接続の末尾の activate が担う
    runActivate(this, null);
    this._resolveLoading?.();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    // observedAttributes は "mount" のみ。同値 set（oldValue === newValue）は変更ではない
    if (!this._initialized || oldValue === newValue) {
      return;
    }
    console.warn(
      `[@wcstack/state] Changing the "mount" attribute after initialization is not supported and is ignored ` +
      `(was ${oldValue === null ? "absent" : `"${oldValue}"`}, now ${newValue === null ? "absent" : `"${newValue}"`}). ` +
      `Remove this <${config.tagNames.state}> element and create a new one with the desired mount path instead.`,
    );
  }

  private _loadFromSsrElement(): IState | null {
    if (!this.hasAttribute('enable-ssr')) return null;
    // `<wcs-ssr>` に載った state データの読み出しは SSR 機能（ssr/install.ts）。未 install なら名指しで落とす
    return requireSsrHooks(`the "enable-ssr" attribute`).loadState(this) as IState | null;
  }

  /** state / src / json / inner <script> / API set のソース解決（_initialize とボリュームで共用）。 */
  private async _loadStateFromSource(): Promise<Record<string, any>> {
    try {
      if (this.hasAttribute('state')) {
        const state = this.getAttribute('state');
        return loadFromScriptJson(state!);
      } else if (this.hasAttribute('src')) {
        const src = this.getAttribute('src');
        if (src && src.endsWith('.json')) {
          return await loadFromJsonFile(src);
        } else if (src && src.endsWith('.js')) {
          return await loadFromScriptFile(src);
        } else {
          raiseError(`Unsupported src file type: ${src}`);
        }
      } else if (this.hasAttribute('json')) {
        const json = this.getAttribute('json');
        return JSON.parse(json!);
      } else {
        const script = this.querySelector<HTMLScriptElement>('script[type="module"]');
        if (script) {
          // sourceURL ラベル。v2 はルートに 1 ツリーなので名前次元は無く、要素の
          // タグ名（DCC 経路が host のタグ名を渡すのと同じ流儀）で特定十分
          return await loadFromInnerScript(script, config.tagNames.state);
        } else {
          const timerId = setTimeout(() => {
            // v2: name 属性は撤去済み（fail-fast）— 文言に name を出さない（tagName で特定十分）
            console.warn(`[@wcstack/state] Warning: No state source found for <${config.tagNames.state}> element.`);
          }, NO_SET_TIMEOUT);
          // 要注意！！！APIでセットする場合はここで待機する必要がある --(1)
          const state = await this._setStatePromise!;
          clearTimeout(timerId);
          return state;
        }
      }
    } catch(e) {
      raiseError(`Failed to initialize state: ${e}`);
    }
  }

  /**
   * 初回マウントのロードと登録。戻り値は「この接続で初期化を**完了**したか」で、
   * `false` は失敗ではなく**中断**（ロード中に要素が剥がされた — 下の注記）。
   */
  private async _initialize(): Promise<boolean> {
    // enable-ssr (クライアント側のみ): <wcs-ssr> から初期データを取得
    const ssrState = !inSsr() ? this._loadFromSsrElement() : null;
    if (ssrState !== null) {
      // ボリュームの接ぎ木が「採用」へ切り替わる根拠（D14）。データ merge より先に立てる
      this._hydratedFromSsr = true;
    }
    this._state = await this._loadStateFromSource();
    // SSR データがある場合、state 定義（メソッド/getter）を維持しつつデータ値を上書き
    if (ssrState !== null && this.__state) {
      for (const [key, value] of Object.entries(ssrState)) {
        if (key in this.__state) {
          const desc = Object.getOwnPropertyDescriptor(this.__state, key);
          // getter/setter はスキップ（定義側を優先）
          if (desc && (desc.get || desc.set)) continue;
          // 関数はスキップ
          if (typeof this.__state[key] === 'function') continue;
        }
        this.__state[key] = value;
      }
    }
    await this._loadingPromise;
    if (this._rootNode === null) {
      // ロード中に剥がされた（行プールの張り直し・DOM の移動・shadow の組み直し）。
      // これは初期化の**失敗ではなく中断**である: 作者のミスは 1 つも無く、state も
      // 健全。診断を出さず、要素を毒化せず（_initializeFailed を立てず）、
      // connectedCallbackPromise も拒否せずに、この接続だけを黙って終わらせる。
      //
      // 拒否してはいけない理由は取り返しのつかなさ: promise はコンストラクタで
      // 1 度だけ作られるので、一度拒否すると**付け直して正常に初期化できた要素**まで
      // 永久に「失敗」を報告し続け、それを待つ @wcstack/server の renderToString と
      // @wcstack/testing の mount が健全なページで throw する。
      // 付け直した接続が改めてここへ来て、通常どおり登録と解決を行う。
      return false;
    }
    setStateElement(this._rootNode, this);
    return true;
  }

  /**
   * 設定エラーでの fail-fast。initializePromise 等を解決してから raise する —
   * 未解決のまま投げると waitForStateInitialize（ホストの buildBindings）が
   * この要素を待ち続け、**ページ全体が無言でウェッジする**（1 つの設定ミスが
   * 無関係なバインディングまで道連れにする）。エラー自体は unhandled rejection
   * として loud に残る。
   */
  private _failInitialization(message: string): never {
    // 着地はここで完了（connectedCallback の catch が二重に着地させない — #257）
    this._initializationLanded = true;
    // _initialized は立てない — 切断時の後始末（createState を要する）が
    // 未ロードの state を触らないよう、初期化前ガードに掛かるままにする
    this._resolveInitialize?.();
    this._resolveLoading?.();
    this._resolveConnectedCallback?.();
    raiseError(message);
  }

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
  private _failInitializeLoudly(error: unknown, ownsTree: boolean = true): never {
    if (this._initializationLanded) {
      // 設定エラーの fail-fast が自分で着地済み（promise は解決済み）。ここで
      // reject に載せ替えると「ページの残りは生きている設定ミス」と「state を 1 つも
      // 持たない要素」を混ぜることになるので、伝播だけさせる
      throw error;
    }
    this._initializeFailed = true;
    // 診断は必ず 1 件出す。カスタム要素リアクションは connectedCallback の戻り
    // Promise を捨てるので、ブラウザの "Uncaught (in promise)" 以外に受け手が居ない
    console.error(`[@wcstack/state] <${config.tagNames.state}> failed to initialize.`, error);
    this._resolveInitialize?.();
    this._resolveLoading?.();
    // reject より先に handled を立てる。DOM 駆動のマウントでは
    // connectedCallbackPromise を誰も await しないため、印が無いと
    // unhandled rejection になる（Node ではプロセスごと落ちる）
    this._connectedCallbackPromise.catch(() => undefined);
    this._rejectConnectedCallback?.(error);
    // このツリーは存在しない。ready を即時解決のまま残すと waitForReady
    // （@wcstack/server）が「バインド構築済み」と報告し、保留中のボリュームは
    // ルート登録が来ないので永久に未解決のまま残る。
    // 生きたルートが既にこの rootNode に居る形（2 本目の <wcs-state> ＝ v2 の
    // 「1 rootNode 1 ツリー」違反）では、ページは 1 本目で成立している —
    // ready も保留ボリュームも 1 本目のものなので触らない
    if (ownsTree && this._rootNode !== null && getStateElement(this._rootNode) === null) {
      markBindingsUnavailable(this._rootNode, error);
      // このルートを待っている機能（保留中のボリューム）に知らせる（設計案 H3）
      runInitializeFailed(this, this._rootNode, error);
    }
    throw error;
  }



  private async _callStateConnectedCallback(): Promise<void> {
    await this.createStateAsync("writable", async (state) => {
      // stateに"$connectedCallback"があるか確認し、connectedCallbackAPIを呼び出す
      if (STATE_CONNECTED_CALLBACK_NAME in state) {
        await state[connectedCallbackSymbol]();
      }
    });
  }

  private _callStateDisconnectedCallback(): void {
    this.createState("writable", (state) => {
      // stateに"$disconnectedCallback"があるか確認し、disconnectedCallbackAPIを呼び出す
      if (STATE_DISCONNECTED_CALLBACK_NAME in state) {
        state[disconnectedCallbackSymbol]();
      }
    });
  }

  async connectedCallback() {
    this._rootNode = this.getRootNode() as Node;
    // connect 世代を進めて冒頭で捕捉する（末尾の startStreams 前に照合し、
    // $connectedCallback の await 中に「切断 → 即再接続」された陳腐 connect の
    // 再開からの起動を防ぐ）。前回接続中の再 set（S13）で立った
    // _streamsStartedGeneration も世代不一致となり自然に無効化される。
    const connectGeneration = ++this._connectGeneration;
    // 着地の印は接続ごとに畳む（前の接続の fail-fast をこの接続へ持ち越さない — #257）
    this._initializationLanded = false;
    if (!this._initialized) {
      // 名前次元は v2 で撤去（D16 / §9）。名前付き State はボリュームへ移行する。
      // mount 併記（移行途中で name を残した形）は専用文言で誘導する
      if (this.hasAttribute("name")) {
        this._failInitialization(
          this.hasAttribute("mount")
            ? `"mount" replaces "name" — a volume has no name of its own. Remove the name attribute.`
            : `The "name" attribute was removed in v2 — there is a single state tree per root. ` +
              `Mount this state onto the tree instead: <wcs-state mount="${this.getAttribute("name")}" ...> ` +
              `and read it as "${this.getAttribute("name")}.<path>".`,
        );
      }
      // この接続を引き取る機能（DCC 定義要素 — dcc/dccLifecycle.ts、ボリューム `mount=` —
      // webComponent/volumeLifecycle.ts。設計案 H3。聞く順は DCC → ボリュームで、従来の分岐順どおり）。
      // 引き取った機能がこの接続の初期化を所有する（promise を返すのは引き取ったときだけなので、
      // 引き取り手の無い素の state に microtask の境界は増えない）
      const claimed = runConnecting(this);
      if (claimed !== null) {
        await claimed;
        return;
      }
      // 引き取り手の居ない宣言 ＝ その機能が未 install（readiness barrier、H5 / D13）。
      // full / auto では bootstrapState() が install するので起きない。どちらも初期化失敗として
      // 着地させる（要件 D23）: throw するだけだと connectedCallbackPromise が未解決のまま残り、
      // それを待つ renderToString・mount・getBindingsReady が止まる
      const parentNode = this.parentNode;
      if (parentNode instanceof ShadowRoot && parentNode.host.hasAttribute(DCC_DEFINITION_ATTRIBUTE)) {
        try {
          requireLifecycleFeature("dcc", `a <${config.tagNames.state}> inside a [${DCC_DEFINITION_ATTRIBUTE}] host`);
        } catch (error) {
          // DCC のロード失敗（dcc/dccLifecycle.ts）と同じ着地
          this._failInitializeLoudly(error);
        }
      }
      if (this.hasAttribute("mount")) {
        try {
          requireLifecycleFeature("scopes", `the "mount" attribute`);
        } catch (error) {
          // ボリュームはツリーの持ち主ではないので、ルートを巻き込まない着地
          this._failInitializeLoudly(error, false);
        }
      }
      // 接続の前処理（設計案 H3 の preparing）。`bind-component` はここで走り、マウントスコープを
      // 組んだときだけこの要素を丸ごと引き取る（webComponent/bindComponentLifecycle.ts）
      let prepared = false;
      try {
        // 引き取り手が無くても await する: 従来この位置には必ず `await this._initializeBindWebComponent()`
        // があり、素の state でも microtask の境界が 1 つ入っていた。同期にすると、内包スクリプトの
        // ロードのようにその境界に依存する経路が時間切れになる（実測）。接続は 1 要素 1 回なので費用は無い
        const preparing = runPreparing(this);
        if (preparing === null && this.hasAttribute("bind-component")) {
          // 引き取り手の居ない `bind-component` ＝ スコープ機能が未 install（readiness barrier、H5 / D13）。
          // 黙って素の state にしない。bind-component の他の設定エラーと同じく下の着地に載る
          requireLifecycleFeature("scopes", `the "bind-component" attribute`);
        }
        prepared = await (preparing ?? false);
      } catch (error) {
        // bind-component の raise も同じ着地に載せる（#257）。とりわけ「初期化に
        // 失敗した要素の再接続」は bindWebComponent → setInitialState の復旧不能
        // raise でここへ来る — _initialize の外なので、包まないと素通りする。
        // 自分で着地済みの fail-fast（_failInitialization / initializeMountScope）は
        // _failInitializeLoudly の先頭で弾かれ、従来どおり伝播するだけ
        this._failInitializeLoudly(error);
      }
      if (prepared) {
        return;
      }
      let completed = false;
      try {
        completed = await this._initialize();
      } catch (error) {
        // ここが唯一の無防備な await だった（#257）。throw は下の 2 行と
        // 末尾の _resolveConnectedCallback を飛ばし、両 promise を永久未解決にする
        this._failInitializeLoudly(error);
      }
      if (!completed) {
        // ロード中に剥がされた ＝ 失敗ではなく中断（_initialize の注記）。promise は
        // 未解決のまま残し、付け直した接続にそのまま解決させる
        return;
      }
      this._initialized = true;

      this._resolveInitialize?.();
    } else if (runReconnecting(this)) {
      // 再接続を引き取った機能（初期化済みボリューム — webComponent/volumeLifecycle.ts。設計案 H3）
      this._resolveConnectedCallback?.();
      return;
    } else if (!this._treeless && getStateElement(this._rootNode) !== this) {
      // 再接続（disconnect で名前登録が解除された後の再 connect）: 登録を復元する。
      // 自分のツリーを持たない要素（DCC 定義要素）は登録しない。
      // createState が rootNode 経由でこの要素を解決できるようにするために必要
      // （$connectedCallback の再実行と $streams の initial からの再起動が依存する、設計書 §2-3）。
      setStateElement(this._rootNode, this);
    }
    // 切断中に入れ直した state を、戻ってきた rootNode のバインドへ適用する（#267）。上の登録より
    // 後であること — 適用は rootNode から state 要素を引く
    if (this._pendingReapplyPaths !== null) {
      const paths = this._pendingReapplyPaths;
      this._pendingReapplyPaths = null;
      this._reapplyBindings(paths);
    }
    // enable-ssr (クライアント側): SSR で $connectedCallback 済みなのでスキップ
    // inSsr() (サーバー側): レンダリング中なので実行する
    // 世代ガード（connectGeneration 照合）: ロード完了前の remove → append では
    // _initialize が 2 本同時に走り、**負けたほうもここまで到達する**（登録は冪等に
    // 弾かれるだけで tail は止まらない）。ガードが無いと作者の $connectedCallback が
    // 1 接続につき 2 回走り、副作用も 2 回出る。下の startWatch / startStreams と
    // 同じ規範で、起動点を最新の connect に一本化する
    if ((!this.hasAttribute('enable-ssr') || inSsr())
      && connectGeneration === this._connectGeneration) {
      await this._callStateConnectedCallback();
    }

    // サーバーモード + enable-ssr: バインディング完了後に <wcs-ssr> を生成。
    // orchestrated（サーバー主導の最終パス、docs/ssr-router-design.md §5）では
    // 生成しない — renderToString が全要素の完了後にまとめて生成するため。
    // ここで生成すると、router 等が後から挿入した内容の構造テンプレートを
    // 取り逃がすレースがある（state のロード方式と文書順に依存）
    if (inSsr() && this.hasAttribute('enable-ssr') && !isOrchestratedSsr()) {
      try {
        // `<wcs-ssr>` の生成は SSR 機能（ssr/install.ts）。バインディング完了を待つのも機能側
        await requireSsrHooks(`the "enable-ssr" attribute`).emitSnapshot(this);
      } catch (error) {
        // reject を配管しないと _connectedCallbackPromise が永久に未解決になり、
        // renderToString が mutex を握ったまま connectedCallbackPromise 待ちで
        // 無言ハングする。getBindingsReady の reject 化（設計書 §8.2）を
        // SSR の消費者（render.ts）まで届けるための対。
        this._rejectConnectedCallback?.(error);
        throw error;
      }
    }

    // $streams の eager 起動（$connectedCallback 完了後、設計書 §2-3）。
    // inSsr() 時は起動しない（SSR 出力には initial が乗る、§7-1）。
    // enable-ssr のクライアント側は $connectedCallback をスキップしても起動する
    // （stream はシリアライズ不能なランタイム副作用のため）。
    // $connectedCallback 完了後の起動（設計案 H4 の activate）。捕捉した世代を渡し、
    // 「切断 → 即再接続」で陳腐化した connect の再開からの起動は機能側が弾く
    runActivate(this, connectGeneration);

    this._resolveConnectedCallback?.();
  }

  disconnectedCallback() {
    // この切断を引き取る機能（ボリューム — webComponent/volumeLifecycle.ts。設計案 H3）
    if (runDisconnecting(this)) {
      return;
    }
    if (this._rootNode !== null) {
      if (!this._initialized) {
        // 初期化前に剥がされた（bind-component の await 中に shadow が張り直された等）。
        // 名前登録も token も stream もまだ無く、state も作れないので後始末は不要。
        // ここで createState すると "_state is not initialized" で CE リアクションが落ちる
        if (this._initializeFailed) {
          // 落ちたルート要素**本人**が DOM から消えた ＝「このルートノードにルートは
          // 来ない」はもう成り立たない（作者の復旧は取り除いて作り直す）。印が残ると、
          // 外してから修正版を接続するまでの窓で接続したボリュームが即座に孤児化する。
          // 条件は本人に限る（#257 第 3 ラウンド）: 「初期化前に剥がされた要素」全部で
          // 落とすと、同じ rootNode の別要素（ゾンビの 2 本目・行プールの張り直し・
          // ロード中の DOM 移動）の切断で印が消え、以後のボリュームが孤児報告を
          // 受けられず永久保留へ戻る
          runInitializeFailureCleared(this, this._rootNode);
        }
        this._rootNode = null;
        return;
      }
      // try/finally: ユーザーの $disconnectedCallback が throw しても後続の後始末を
      // 必ず実行する。特に abortAllStreams が飛ぶと stream が消費を続け（ゾンビ I/O）、
      // activeStateElements の強参照残留で GC が妨げられ、切断済み要素が依存駆動
      // restart の対象にも残る（設計書 §3-2 / §5-1 違反）。throw 自体は従来どおり
      // 呼び出し元へ伝播させる（変わるのは後始末の保証のみ）。
      try {
        this._callStateDisconnectedCallback();
      } finally {
        setStateElement(this.rootNode, null);
        // command-token / event-token の registry は捨てない（#273）。`$on` は `_state` セッターでしか、
        // `command.<method>:` は値の適用でしか購読しないので、捨てると再接続の後の発火が購読者の
        // 居ない新しい token に届き、無言で止まる（下の stream / watch が registry を保持するのと同じ理由）。
        // 切断中の発火は state の解決で止まる: 要素のイベントは上の登録解除で state を引けず、
        // `$command` の emit は `rootNode` の無い createState を通れない。
        // namespace proxy の memo は破棄する（registry は残るので、再接続後の初回アクセスで
        // 同じ token を返す proxy が作り直される）。
        clearCommandNamespace(this);
        // 機能の停止（設計案 H4 の deactivate。起動の逆順 — stream を止めてから watch を外す）
        runDeactivate(this);
        this._rootNode = null;
      }
    }
  }

  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * ライフサイクル機能（core/lifecycleHooks.ts、設計案 H3）へ開く内部面。接続を引き取った機能が
   * 要素の初期化を所有するために要る最小限。
   */
  get connectedRootNode(): Node | null {
    return this._rootNode;
  }

  clearConnectedRootNode(): void {
    this._rootNode = null;
  }

  markInitialized(): void {
    this._initialized = true;
  }

  settleInitialization(): void {
    this._resolveInitialize?.();
    this._resolveLoading?.();
    this._resolveConnectedCallback?.();
  }

  loadStateFromSource(): Promise<Record<string, any>> {
    // ボリュームは `_state` を通らずに接ぎ木するので、宣言キーの正規化（要件 B12）はここで行う
    return this._loadStateFromSource().then((state) => {
      normalizeDeclarationAliases(state);
      return state;
    });
  }

  markTreeless(): void {
    this._treeless = true;
  }

  /** 初期化失敗の着地（`_failInitializeLoudly`）。接続を引き取った機能が自分の失敗を載せる */
  failInitializeLoudly(error: unknown): never {
    return this._failInitializeLoudly(error);
  }

  get connectGeneration(): number {
    return this._connectGeneration;
  }

  setWatchPaths(paths: ReadonlySet<string> | null): void {
    this._watchPaths = paths;
  }

  setScanPaths(paths: ReadonlySet<string> | null): void {
    this._scanPaths = paths;
  }

  /** 設定エラーの着地（`_failInitialization` の raise を除いた部分）。引き取った機能が使う */
  landInitialization(): void {
    this._initializationLanded = true;
    this._resolveInitialize?.();
    this._resolveLoading?.();
    this._resolveConnectedCallback?.();
  }

  setRecursionRegistry(registry: RecursionRegistry | null): void {
    this._recursionRegistry = registry;
  }

  addGeneratedPath(path: string): void {
    this._generatedPaths.add(path);
  }

  setBoundComponent(component: Element | null, stateProp: string | null): void {
    this._boundComponent = component;
    this._boundComponentStateProp = stateProp;
  }

  get initializePromise(): Promise<void> {
    return this._initializePromise;
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  get listPaths(): Set<string> {
    return this._listPaths;
  }

  get listKeys(): ListKeyMap | null {
    return this._listKeys;
  }

  get hasRecursion(): boolean {
    return this._recursionRegistry !== null;
  }

  get recursionRegistry(): RecursionRegistry | null {
    return this._recursionRegistry;
  }

  get watchPaths(): ReadonlySet<string> | null {
    return this._watchPaths;
  }

  get scanPaths(): ReadonlySet<string> | null {
    return this._scanPaths;
  }

  get elementPaths(): Set<string> {
    return this._elementPaths;
  }

  /**
   * ボリューム（webComponent/volume.ts）のアクセサ登録: ツリーパスをキーにした
   * quoted-path アクセサを state オブジェクトに定義し、getter / setter 台帳と
   * 依存グラフに載せる。ルートのワイルドカード getter（`"children.*.label"`）と
   * 同じ機構に乗るので、評価は pushAddress 下・依存はグラフに載る。
   */
  /** ボリュームの watch パスをホットパス用ゲート（watchPaths）へ合流させる。 */
  addVolumeWatchPaths(paths: ReadonlySet<string>): void {
    if (paths.size === 0) {
      return;
    }
    const merged = new Set(this._watchPaths ?? []);
    for (const path of paths) {
      merged.add(path);
    }
    this._watchPaths = merged;
    // ルートが `$watch` を宣言していなくても、合流した watch パスの旧値は同じ hook が記録する
    this.attachAddressHooks("watch", STATE_WATCH_NAME);
  }

  /** ボリュームの $listKeys（接頭辞翻訳済み）をルートの表へ合流させる。衝突は設定ミス。 */
  mergeVolumeListKeys(entries: ReadonlyMap<string, ListKeySpec>): void {
    if (entries.size === 0) {
      return;
    }
    const merged = new Map(this._listKeys ?? []);
    for (const [path, spec] of entries) {
      if (merged.has(path)) {
        raiseError(`$listKeys entry "${path}" is declared by both the root and a volume (or two volumes). Keep exactly one.`);
      }
      merged.set(path, spec);
    }
    this._listKeys = merged;
  }

  /** ボリュームが $updatedCallback を持つとき、収集ゲートを開ける（apply/applyChange.ts）。 */
  enableUpdatedCallback(): void {
    this._hasUpdatedCallback = true;
  }

  /** enable-ssr スナップショットから初期化されたか（D14 — webComponent/volume.ts が読む）。 */
  get hydratedFromSsr(): boolean {
    return this._hydratedFromSsr;
  }

  addListPath(path: string): void {
    this._listPaths.add(path);
  }

  findStateDescriptor(path: string): PropertyDescriptor | undefined {
    // own → プロトタイプチェーン（Object.prototype 手前まで）。打ち切り位置は
    // getAllPropertyDescriptors / getStateInfo と同じ ＝ 「state が宣言したもの」の範囲。
    // 走査そのものは pathDiagnostics と共有する（2 本に分かれると打ち切り位置がずれる）。
    return findDescriptor(this._state, path);
  }

  defineTreeAccessor(path: string, descriptor: PropertyDescriptor): void {
    Object.defineProperty(this._state, path, descriptor);
    if (typeof descriptor.get === "function") {
      this._getterPaths.add(path);
    }
    if (typeof descriptor.set === "function") {
      this._setterPaths.add(path);
    }
    this.setPathInfo(path, "prop", "internal");
  }

  get getterPaths(): Set<string> {
    return this._getterPaths;
  }

  get setterPaths(): Set<string> {
    return this._setterPaths;
  }

  get loopContextStack(): ILoopContextStack {
    return this._loopContextStack;
  }

  get dynamicDependency(): Map<string, string[]> {
    return this._dynamicDependency;
  }

  get staticDependency(): Map<string, string[]> {
    return this._staticDependency;
  }

  get version(): number {
    return this._version;
  }

  /** state の世代（キャッシュ項目の印の正本 — cache/types.ts の `generation`）。 */
  get stateGeneration(): number {
    return this._stateGeneration;
  }

  get rootNode(): Node {
    if (this._rootNode === null) {
      raiseError('State rootNode is not available.');
    }
    return this._rootNode;
  }

  get boundComponentStateProp(): string | null {
    return this._boundComponentStateProp;
  }



  get hasMounts(): boolean {
    return this._hasMounts;
  }

  /** 唯一の呼び手は webComponent/mount.ts の registerMountRecord（Phase 2）。 */
  markHasMounts(): void {
    this._hasMounts = true;
    this._attachScopeHooks("bind-component");
  }

  get hasGraftedVolumes(): boolean {
    return this._hasGraftedVolumes;
  }

  get addressHooks(): IAttachedHooks | null {
    return this._addressHooks;
  }

  /** 宣言 `declaration` が要求する機能 `feature` の hook をこの state に付ける（未 install なら throw、D13） */
  attachAddressHooks(feature: string, declaration: string): void {
    const hooks = requireFeature(feature, declaration);
    if (this._addressHooks === null) {
      this._addressHooks = createAttachedHooks();
    }
    appendHooks(this._addressHooks, hooks);
  }

  /** 唯一の呼び手は webComponent/volume.ts の graftVolume（D22 後段のガードが読む）。 */
  markHasGraftedVolumes(): void {
    this._hasGraftedVolumes = true;
    this._attachScopeHooks("mount");
  }

  /** ボリュームがこのルートに予約された（接ぎ木前でも、予約下の読みは undefined が正 — D22） */
  markHasVolume(): void {
    this._attachScopeHooks("mount");
  }

  /** スコープ機能（マウント・ボリューム）の hook をこの state に付ける（冪等） */
  private _attachScopeHooks(declaration: string): void {
    // install は `bootstrapState()` の `installVolumeGraft()` が済ませている（未 install は
    // `attachAddressHooks` の readiness barrier が名指しで落とす — D13）
    this.attachAddressHooks("scopes", declaration);
  }

  get bindableEventMap(): Record<string, string> {
    return this._bindableEventMap;
  }

  get commandTokenNames(): ReadonlySet<string> {
    return this._commandTokenNames;
  }

  get eventTokenNames(): ReadonlySet<string> {
    return this._eventTokenNames;
  }

  setBindableEventMap(map: Record<string, string>): void {
    this._bindableEventMap = map;
    // `$bindables` の束ね先になった: 書き込み後の bindable イベントを撃つ hook を付ける
    // （install は dcc/defineDCC.ts が束ねる時点で済ませている）
    this.attachAddressHooks("dcc", STATE_BINDABLES_NAME);
  }

  private _addDependency(
    map: Map<string, string[]>,
    sourcePath: string,
    targetPath: string
  ): boolean {
    const deps = map.get(sourcePath);
    if (deps === undefined) {
      map.set(sourcePath, [targetPath]);
      return true;
    } else if (!deps.includes(targetPath)) {
      deps.push(targetPath);
      return true;
    }
    return false;
  }

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
  addDynamicDependency(sourcePath: string, targetPath: string): boolean {
    return this._addDependency(this._dynamicDependency, sourcePath, targetPath);
  }

  /**
   * source,      target
   * products => products.*
   * products.* => products.*.price
   * products.* => products.*.name
   *
   * @param sourcePath
   * @param targetPath
   */
  addStaticDependency(sourcePath: string, targetPath: string): boolean {
    return this._addDependency(this._staticDependency, sourcePath, targetPath);
  }

  setPathInfo(path: string, bindingType: BindingType, source: PathInfoSource = "binding"): void {
    // 再セットで作り直すための台帳（issue #258 の X7）。同じパスは複数の呼び出し元から登録
    // されうる（バインド・`$watch` の宣言）ので、いちど `for` で登録されたパスは `for` のまま
    // 保つ — `listPaths` / `elementPaths` を決めるのは下のとおり `for` だけ。保たない場合に
    // 何が壊れるかは `__tests__/integration.stateGenerationReset.test.ts` の
    // 「`for` で登録したリストパスは `$watch` の prop 登録に上書きされない」が固定する。
    if (source !== "internal") {
      // `for` の登録はバインドからしか来ないので、`for` の登録を残すときは `bound` も真のまま
      const previous = this._pathRegistrations.get(path);
      if (typeof previous === "undefined") {
        this._pathRegistrations.set(path, { bindingType, bound: source === "binding" });
      } else if (previous.bindingType !== "for") {
        this._pathRegistrations.set(path, { bindingType, bound: previous.bound || source === "binding" });
      }
    }
    if (bindingType === "for") {
      this._listPaths.add(path);
      this._elementPaths.add(path + '.' + WILDCARD);
    }
    if (!this._pathSet.has(path)) {
      const pathInfo = getPathInfo(path);
      this._pathSet.add(path);
      // 存在しないパスへの配線は「黙って更新されない」だけで終わるため、
      // 新規パスを 1 回だけ検査して確実な miss を報告する（diagnostics/pathChecks.ts — 開発時の
      // 診断なので features/diagnostics。入っていなければ検査しない）。
      // パスごとに 1 回・バインド確立時のみで、更新のホットパスには乗らない。
      pathDiagnostics?.check(this, this.__state, path, source);
      if (pathInfo.parentPath !== null) {
        let currentPathInfo = pathInfo;
        while(currentPathInfo.parentPath !== null) {
          if (!this.addStaticDependency(currentPathInfo.parentPath, currentPathInfo.path)) {
            break;
          }
          currentPathInfo = getPathInfo(currentPathInfo.parentPath);
        }
      }
    }
  }

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
  private _rebuildPathInfo(): void {
    for (const [path, registration] of Array.from(this._pathRegistrations)) {
      if (!registration.bound || this._generatedPaths.has(path)) {
        continue;
      }
      this.setPathInfo(path, registration.bindingType);
    }
  }

  private _createState<T>(rootNode: Node, mutability: Mutability, callback: (state: IStateProxy) => T): T {
    try {
      const stateProxy = createStateProxy(rootNode, this._state, mutability);
      return callback(stateProxy);
    } finally {
      // cleanup if needed
    }
  }

  async createStateAsync(mutability: Mutability, callback: (state: IStateProxy) => Promise<void>): Promise<void> {
    return await this._createState(this.rootNode, mutability, callback);
  }

  createState(mutability: Mutability, callback: (state: IStateProxy) => void): void {
    this._createState(this.rootNode, mutability, callback);
  }

  nextVersion(): number {
    this._version++;
    return this._version;
  }

  get hasUpdatedCallback(): boolean {
    return this._hasUpdatedCallback;
  }

  get hasErrorCallback(): boolean {
    return this._hasErrorCallback;
  }

  get crossRowListPaths(): ReadonlySet<string> {
    return this._crossRowListPaths;
  }

  addCrossRowListPath(path: string): void {
    this._crossRowListPaths.add(path);
  }

  get indexDependentGetterPaths(): ReadonlySet<string> {
    return this._indexDependentGetterPaths;
  }

  addIndexDependentGetterPath(path: string): void {
    this._indexDependentGetterPaths.add(path);
  }


  setInitialState(state: Record<string, any>): void {
    if (!this._initialized) {
      if (this._initializeFailed) {
        // 初期化に失敗した要素は再武装しない（#257）。_setStatePromise は解決済みで、
        // ここで渡し直しても読み手が居ないため、旧挙動は無言の no-op だった。
        // 再武装は「落ちた宣言の残骸（$on の購読・stream registry）をどう畳むか」を
        // 決める別の設計判断なので、ここでは唯一有効な復旧手段を伝えるに留める
        raiseError(
          `<${config.tagNames.state}> failed to initialize (the diagnostic was reported when it connected), ` +
          `so its state cannot be replaced. Remove this element and create a new one with the corrected state.`,
        );
      }
      this._resolveSetState?.(state);
      return;
    }
    // state の差し替えを拒む機能（ロード済みボリューム #268 — webComponent/volumeLifecycle.ts。設計案 H3）に聞く
    runReplacingState(this);
    // D22 と同型の防御: 接ぎ木済みボリューム / マウント記録の居るツリーの丸ごと再 set は、
    // 接ぎ木データ・quoted-path アクセサ（defineTreeAccessor）・マーカーの getterPaths・
    // 合流済み宣言面（$watch / $listKeys / $updatedCallback ゲート）を全て無言で捨てる。
    // 「マウントポイントを含む親の丸ごと書きは throw」（setByAddress の D22 後段）と
    // 同じ設定ミスとして loud に落とす。
    if (this._hasGraftedVolumes || this._hasMounts) {
      raiseError(
        `Cannot replace the whole state of a tree that has grafted volumes or mounted components: ` +
        `re-setting would silently drop grafted data, tree accessors and mount ledgers (D22). ` +
        `Write the changed paths instead.`,
      );
    }
    const previousState = this.__state;
    this._state = state;
    // 再セットは描画し直す（#267）。読みは世代印で新しい state を返すので、確立済みのバインドも
    // ここで新しい世代に揃える（apply/reapplyStateBindings.ts）。消えたキーのバインドも失敗として
    // 報告させるため、前後両方の state のキーを起点にする
    const paths = collectReapplyPaths([previousState, state]);
    if (this._rootNode === null) {
      // 切断中は適用先の rootNode が無い。再接続（connectedCallback）で適用し直す
      this._pendingReapplyPaths = new Set([...(this._pendingReapplyPaths ?? []), ...paths]);
      return;
    }
    this._reapplyBindings(paths);
  }

  /** 確立済みのバインドを今の世代で適用し直す（#267）。行のバインドは経路情報の台帳のパスから引く。 */
  private _reapplyBindings(paths: Iterable<string>): void {
    reapplyStateBindings(this, paths, this._pathRegistrations.keys());
  }
}

