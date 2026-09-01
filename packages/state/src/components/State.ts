import { config, inSsr, isOrchestratedSsr } from "../config";
import { loadFromInnerScript } from "../stateLoader/loadFromInnerScript";
import { loadFromJsonFile } from "../stateLoader/loadFromJsonFile";
import { loadFromScriptFile } from "../stateLoader/loadFromScriptFile";
import { loadFromScriptJson } from "../stateLoader/loadFromScriptJson";
import { raiseError } from "../raiseError";
import { BindingType, IState } from "../types";
import { IStateElement } from "./types";
import { setStateElementByName, getStateElementByName, getBindingsReady } from "../stateElementByName";
import { ILoopContextStack } from "../list/types";
import { createLoopContextStack } from "../list/loopContext";
import { DCC_DEFINITION_ATTRIBUTE, NO_SET_TIMEOUT, STATE_CONNECTED_CALLBACK_NAME, STATE_DISCONNECTED_CALLBACK_NAME, STATE_UPDATED_CALLBACK_NAME, WILDCARD } from "../define";
import { processCommandTokensDeclaration } from "../command/processCommandTokensDeclaration";
import { clearCommandTokenRegistry } from "../command/commandTokenRegistry";
import { clearCommandNamespace } from "../command/commandNamespace";
import { processEventTokensDeclaration } from "../event/processEventTokensDeclaration";
import { clearEventTokenRegistry } from "../event/eventTokenRegistry";
import { processOnDeclaration } from "../event/processOnDeclaration";
import { processStreamsDeclaration } from "../stream/processStreamsDeclaration";
import { ListKeyMap, processListKeysDeclaration } from "../list/listKeys";
import { clearStreamNamespace } from "../stream/streamNamespace";
import { abortAllStreams, clearStreamRegistry } from "../stream/streamRegistry";
import { startStreams } from "../stream/streamRuntime";
import { processWatchDeclaration } from "../watch/processWatchDeclaration";
import { clearComputedSnapshots } from "../watch/computedSnapshots";
import { clearWatchRegistry, deactivateWatch } from "../watch/watchRegistry";
import { startWatch } from "../watch/watchRuntime";
import { defineDCC } from "../dcc/defineDCC";
import { getCustomElementRegistry } from "../platform/customElementRegistry";
import { getPathInfo } from "../address/PathInfo";
import { IStateProxy, Mutability } from "../proxy/types";
import { createStateProxy } from "../proxy/StateHandler";
import { initializeBindings } from "../bindings/initializeBindings";
import { collectStructuralFragments } from "../structural/collectStructuralFragments";
import { bindWebComponent, invokeStateReadyCallback } from "../webComponent/bindWebComponent";
import { getBindingsByNode } from "../bindings/getBindingsByNode";
import { buildMountRecord, getRegisteredMountRecord, IMountRecord } from "../webComponent/mount";
import { initializeMountScope, remountScopeBindings } from "../webComponent/mountScope";
import { createPublicMountState } from "../webComponent/overlay";
import { warnOwnKeyShadowsForMount } from "../webComponent/ownKeyShadow";
import { markWebComponentAsComplete } from "../webComponent/completeWebComponent";
import { getBaseDepth } from "../webComponent/baseListIndex";
import { propagateListPathToOuterState } from "../webComponent/outerListPath";
import { getPrimaryInnerPaths, hasRootMappingRule, resetDerivedMappingRules } from "../webComponent/MappingRule";
import { getRootReloadPaths } from "../webComponent/rootReloadPaths";
import { markWebComponentStatePropDeclared } from "../webComponent/completeWebComponent";
import { getInjectedKeys, restoreOverwrittenValues, takeOverwrittenObject } from "../webComponent/preCompletionWrites";
import { hasRootMountBinding } from "../webComponent/rootMountBinding";
import { warnNamedStateDeprecated } from "../deprecation";
import { connectedCallbackSymbol, disconnectedCallbackSymbol } from "../proxy/symbols";
import { waitInitializeBinding } from "../bindings/initializeBindingPromiseByNode";
import { getCustomElement } from "../getCustomElement";
import { Ssr } from "./Ssr";
import { VERSION } from "../version";
import { HTMLElementBase } from "../platform/HTMLElementBase";
import { getAllPropertyDescriptors } from "../getAllPropertyDescriptors";
import { checkDeclaredPath, PathInfoSource } from "../pathDiagnostics";

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

  private __state: IState | undefined;
  private _hasUpdatedCallback: boolean = false;
  // 他行を読む getter が検出されたリストパス（diff-filter 展開の全行フォールバック対象）。
  // 依存マップ（static/dynamic）と同様に追加のみ・クリアしない（安全側に固定される）。
  private _crossRowListPaths: Set<string> = new Set<string>();
  // $1 等のインデックスを読んだ getter パス（実行時検出）。位置のみ変わった行の
  // 静的子展開はこの集合の subtree に限定される。追加のみ・クリアしない（安全側）。
  private _indexDependentGetterPaths: Set<string> = new Set<string>();
  private _name: string = 'default';
  private _initialized: boolean = false;
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
  private _elementPaths: Set<string> = new Set<string>();
  private _getterPaths: Set<string> = new Set<string>();
  private _setterPaths: Set<string> = new Set<string>();
  private _loopContextStack: ILoopContextStack = createLoopContextStack(() => getBaseDepth(this));
  private _dynamicDependency: Map<string, string[]> = new Map<string, string[]>();
  private _staticDependency: Map<string, string[]> = new Map<string, string[]>();
  private _pathSet: Set<string> = new Set<string>();
  // `$watch` 宣言の監視対象パス。宣言が無ければ null（setByAddress のゼロコスト契約）
  private _watchPaths: ReadonlySet<string> | null = null;
  private _version = 0;
  private _rootNode: Node | null = null;
  private _boundComponent: Element | null = null;
  private _boundComponentStateProp: string | null = null;
  private _hasMappedComponentState: boolean = false;
  private _hasMounts: boolean = false;
  /** v2 マウント（Phase 2）: この bind-component 要素が構築したマウント記録 */
  private _mountRecord: IMountRecord | null = null;
  private _bindableEventMap: Record<string, string> = {};
  private _commandTokenNames: Set<string> = new Set<string>();
  private _eventTokenNames: Set<string> = new Set<string>();
  private _dcc: boolean = false;
  // connect サイクルの世代カウンタ（connectedCallback 冒頭でインクリメント）。
  // $connectedCallback の await 中の「切断 → 即再接続」では、新 connect が
  // _rootNode を再設定済みのため陳腐化した旧 connect の再開が _rootNode ガードを
  // 素通りして startStreams に到達し、同一の再接続に対して source が二重起動する。
  // 末尾で冒頭に捕捉した世代と照合し、陳腐 connect からの起動を skip する（設計書 §2-3）。
  private _connectGeneration: number = 0;
  // _state セッター側の startStreams が走った connect 世代
  // （connectedCallback 末尾の startStreams との二重起動防止、設計書 §2-3。
  //  世代が進めば不一致となり自然に無効化される — サイクル単位のフラグリセット相当）
  private _streamsStartedGeneration: number = 0;

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
    this._commandTokenNames = processCommandTokensDeclaration(value);
    this._eventTokenNames = processEventTokensDeclaration(value);
    this.__state = value;
    // $updatedCallback の有無を state セット時に確定しておく（in はプロトタイプ
    // チェーンも見る・getter を評価しない）。drain 側はこのフラグで更新アドレスの
    // 集計と writable createState をスキップできる。
    // 注: state セット後に生オブジェクトへ直接 $updatedCallback を後付けする
    // パターンは検知できない（bindProperty / _state 再セットは検知する）。
    // ライフサイクルフックは宣言時に定義するのが規約。
    this._hasUpdatedCallback = STATE_UPDATED_CALLBACK_NAME in value;
    // 再 set 時に二重 subscribe しないよう registry をクリアしてから $on を配線し直す。
    clearEventTokenRegistry(this);
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
    // $streams: 再 set 時の二重起動防止のため旧 stream を abort ＋ registry 全削除してから
    // 新宣言をパースする（clearEventTokenRegistry → processOnDeclaration と同じ再配線パターン）。
    // getterPaths / setterPaths の収集後であること（宣言バリデーションが衝突検査で参照する）。
    // namespace proxy の memo も破棄して古い proxy を捨てる（clearCommandNamespace と対称）。
    clearStreamNamespace(this);
    clearStreamRegistry(this);
    processStreamsDeclaration(this, value);
    // $listKeys: 宣言が無ければ null のままで、setByAddress のキー突合経路には
    // 一切入らない（docs/state-list-key-design.md §7-1）。再 set で必ず置き換える。
    this._listKeys = processListKeysDeclaration(value);
    // $watch: 旧宣言のハンドラが残らないよう registry を落としてから新宣言を解析する。
    // _pathSet.clear() の後であること（依存グラフ登録をやり直す必要がある、
    // docs/state-watch-hook-design.md §8）。宣言が無ければ watchPaths は null で、
    // setByAddress の旧値キャプチャには一切入らない（§10 のゼロコスト契約）。
    clearWatchRegistry(this);
    // computed の前回評価値も宣言と寿命を共にする（旧宣言の値を新しい watch の
    // prev として渡さない）。切断では消さない — 再接続の初回評価が上書きする。
    clearComputedSnapshots(this);
    this._watchPaths = processWatchDeclaration(this, value);
    // 接続中の再 set（S13）は新宣言で即再起動する。
    // 初回（_initialize 中）は _initialized が false なのでここでは起動されず、
    // connectedCallback 側の startStreams（$connectedCallback 完了後）が担う。
    if (this._initialized && this._rootNode !== null && !inSsr()) {
      // watch は stream より先に有効化する（stream の起動時書き込みを観測できるように）
      startWatch(this);
      startStreams(this);
      // $connectedCallback 実行中の再 set（setInitialState）では、ここで新宣言が
      // 起動済みのため connectedCallback 末尾の startStreams を skip させる。
      // skip しないと同一 connect サイクルで新宣言の source が 2 回起動する
      // （1 回目は即 abort — switchMap 意味論で状態は壊れないが、副作用を持つ
      // source が 2 回発火してしまう）。
      this._streamsStartedGeneration = this._connectGeneration;
    }
    this._resolveLoading?.();
  }

  get name(): string {
    return this._name;
  }

  private _loadFromSsrElement(): IState | null {
    if (!this.hasAttribute('enable-ssr')) return null;
    const name = this.getAttribute('name') || 'default';
    const root = this.parentNode;
    if (!root) return null;
    const ssrEl = Ssr.findByName(root, name);
    if (!ssrEl) return null;
    const data = ssrEl.stateData;
    return Object.keys(data).length > 0 ? data : null;
  }

  private async _initialize() {
    // enable-ssr (クライアント側のみ): <wcs-ssr> から初期データを取得
    const ssrState = !inSsr() ? this._loadFromSsrElement() : null;
    try {
      if (this.hasAttribute('state')) {
        const state = this.getAttribute('state');
        this._state = loadFromScriptJson(state!);
      } else if (this.hasAttribute('src')) {
        const src = this.getAttribute('src');
        if (src && src.endsWith('.json')) {
          this._state = await loadFromJsonFile(src);
        } else if (src && src.endsWith('.js')) {
          this._state = await loadFromScriptFile(src);
        } else {
          raiseError(`Unsupported src file type: ${src}`);
        }
      } else if (this.hasAttribute('json')) {
         const json = this.getAttribute('json');
          this._state = JSON.parse(json!);
      } else {
        const script = this.querySelector<HTMLScriptElement>('script[type="module"]');
        if (script) {
          this._state = await loadFromInnerScript(script, `${this._name}`);
        } else {
          const timerId = setTimeout(() => {
            console.warn(`[@wcstack/state] Warning: No state source found for <${config.tagNames.state}> element with name="${this._name}".`);
          }, NO_SET_TIMEOUT);
          // 要注意！！！APIでセットする場合はここで待機する必要がある --(1)
          this._state = await this._setStatePromise!;
          clearTimeout(timerId);
        }
      }
    } catch(e) {
      raiseError(`Failed to initialize state: ${e}`);
    }
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
    this._name = this.getAttribute('name') || 'default';
    if (this.hasAttribute('name') && !this.hasAttribute('bind-component')) {
      // 名前付き State は v2 でマウント（`mount=`）に置き換わる（docs/state-mount-design.md D16）。
      // Light DOM の bind-component は今日 name が必須なので、そちらには言わない。
      warnNamedStateDeprecated('attribute', this._name);
    }
    setStateElementByName(this.rootNode!, this._name, this);
  }

  private async _initializeBindWebComponent() {
    if (this.hasAttribute("bind-component")) {
      // wcs-stateはコンポーネントのトップレベル要素であること
      // ShadowDOM直下: parentNodeがShadowRoot → hostが親コンポーネント
      // LightDOM/ShadowDOM内のLightDOM: parentNodeがElement → それが親コンポーネント
      const parentNode = this.parentNode;
      const boundComponent = parentNode instanceof ShadowRoot
        ? parentNode.host
        : parentNode instanceof Element
          ? parentNode
          : null;
      const customTagName = boundComponent ? getCustomElement(boundComponent) : null;
      if (boundComponent === null || customTagName === null) {
        raiseError(`"bind-component" requires <${config.tagNames.state}> to be a direct child of a custom element.`);
      }
      // LightDOMの場合、名前空間が上位スコープと共有されるためnameが必須
      if (!(parentNode instanceof ShadowRoot) && !this.hasAttribute("name")) {
        raiseError(`"bind-component" in Light DOM requires a "name" attribute to avoid namespace conflicts with the parent scope.`);
      }
      // bind-component はコンポーネント側の state プロパティを唯一のソースにする。
      // state / src / json / inner <script> と併記すると、この後の _initialize が
      // そちらを採用して _setStatePromise を await しないため、bindWebComponent が
      // setInitialState で渡した innerState proxy ごと捨てられ、親↔子マッピングが
      // 無言で死ぬ。併記は必ず設定ミスなので fail-fast させる
      // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §2.6）。
      const conflicting = ["state", "src", "json"].filter((name) => this.hasAttribute(name));
      if (this.querySelector('script[type="module"]') !== null) {
        conflicting.push('<script type="module">');
      }
      if (conflicting.length > 0) {
        raiseError(`"bind-component" cannot be combined with ${conflicting.join(", ")}. The component's "${this.getAttribute("bind-component")}" property is the only state source.`);
      }
      const boundComponentStateProp = this.getAttribute("bind-component")!;
      // 束ねる意思をここで宣言する（完了はずっと後）。丸ごとマウント `state: user` の
      // 完了前の初期適用は、この宣言を見て書き込みを抑止する
      // （webComponent/completeWebComponent.ts）。下の await より前でなければ、
      // 親の初期適用が先に走って親のオブジェクトを state プロパティに書いてしまう。
      markWebComponentStatePropDeclared(boundComponent, boundComponentStateProp);
      const componentRegistry = getCustomElementRegistry(boundComponent);
      if (componentRegistry === null) {
        // null レジストリのサブツリーではホストは永久に upgrade されない。
        // whenDefined を待つと無言でウェッジするので落とす。
        raiseError(`CustomElementRegistry is unavailable for <${customTagName}>.`);
      }
      await componentRegistry.whenDefined(customTagName.toLowerCase());
      // data-wcs属性がある場合は、上位の状態によりbinding情報の設定が完了するまで待機する
      if (boundComponent.hasAttribute(config.bindAttributeName)) {
        await waitInitializeBinding(boundComponent);
      }
      if (!(boundComponentStateProp in boundComponent)) {
        raiseError(`Component does not have property "${boundComponentStateProp}" for state binding.`);
      }
      let state = (boundComponent as any)[boundComponentStateProp] as Record<string, any>;
      if (typeof state !== 'object' || state === null) {
        raiseError(`Component property "${boundComponentStateProp}" is not an object for state binding.`);
      }
      // 丸ごとマウント（`state: user`）の完了前の初期適用が、宣言より先に走って state
      // プロパティを親のオブジェクトごと置き換えていたら、作者のオブジェクトに戻す
      // （webComponent/preCompletionWrites.ts）。戻さないと親のキー全部が own data key に
      // なり、R1 で全部が私有に化ける。
      const authored = takeOverwrittenObject(boundComponent, boundComponentStateProp);
      if (typeof authored !== 'undefined' && hasRootMountBinding(boundComponent, boundComponentStateProp)) {
        (boundComponent as any)[boundComponentStateProp] = authored;
        state = authored as Record<string, any>;
      }
      this._boundComponent = boundComponent;
      this._boundComponentStateProp = boundComponentStateProp;
      // v2 マウント（Phase 2 slice 3・impl-plan §3-0）: **ルートエントリ**（`state: path` の
      // 丸ごとマウント）を持つホスト配線は単一ツリーで構築する。部分マウントのみの
      // 既存形は v1 機構のまま（次スライスで移行 — P2-0 のテスト仕分けと同時）。
      // Light DOM は P2 後半（P3-7 と同時）。
      if (parentNode instanceof ShadowRoot && boundComponent.hasAttribute(config.bindAttributeName)) {
        const hostBindings = (getBindingsByNode(boundComponent) ?? []).filter(
          (hostBinding) => hostBinding.propSegments[0] === boundComponentStateProp,
        );
        if (hostBindings.length > 0) {
          const parentStateElement = getStateElementByName(boundComponent.getRootNode() as Node, hostBindings[0].stateName)
            ?? raiseError(`State element with name "${hostBindings[0].stateName}" not found for mount host <${customTagName}>.`);
          // 再初期化（コンポーネントが connectedCallback で shadow の innerHTML を張り直す
          // 作りだと、再接続のたびに新しい <wcs-state> がここへ来る）: 記録を再利用して
          // マーカーを安定させる。このとき上の `state` はもう公開プロキシ（下の
          // defineProperty 済み）だが、buildMountRecord を通らないので実害はない
          let record = getRegisteredMountRecord(boundComponent, boundComponentStateProp);
          const isReinitialize = record !== null;
          if (record === null) {
            // 宣言前の窓（fragment 内の初期適用）で積みが作者の既存キーを上書きして
            // いたら、作者の値に戻してから snapshot する（厳格 R1 — D19/D21）
            restoreOverwrittenValues(boundComponent, boundComponentStateProp, state);
            record = buildMountRecord(
              boundComponent,
              boundComponentStateProp,
              hostBindings,
              parentStateElement,
              state,
              getInjectedKeys(boundComponent, boundComponentStateProp),
            );
            warnOwnKeyShadowsForMount(record);
          }
          this._mountRecord = record;
          // shadow 張り直しの連打で、上の await 中に自分が剥がされた形。スコープは
          // 次に入った <wcs-state> が組み直すので触らない（_mountRecord は立てて、
          // connectedCallback の続きが v1 の _initialize に落ちないようにする）
          if (this.parentNode !== parentNode) {
            return;
          }
          initializeMountScope(record, parentNode);
          if (!isReinitialize) {
            const publicState = createPublicMountState(record);
            Object.defineProperty(boundComponent, boundComponentStateProp, {
              get: () => publicState,
              enumerable: true,
              configurable: true,
            });
            markWebComponentAsComplete(boundComponent, boundComponentStateProp);
          }
          invokeStateReadyCallback(boundComponent, boundComponentStateProp);
          return;
        }
      }
      bindWebComponent(this, this._boundComponent, this._boundComponentStateProp, state);
    }
  }

  /**
   * Light DOM の mapped コンポーネントが、自分のサブツリーのバインディングを張る（§1.13）。
   *
   * Shadow DOM 形では子スコープが別 rootNode にあり、`setStateElementByName` の初回登録から
   * その root ぶんの `buildBindings` が別パスとして起動する。Light DOM ではホストと同じ root に
   * いるためそのパスが存在せず、かといってホストのパスに混ぜると `@name` の解決が
   * この要素の名前登録より先に来てしまう。そこで `getSubscriberNodes` がホスト側の走査から
   * このサブツリーを外し、名前登録が済んだここで同じことを自前で行う。
   *
   * `{{ }}` の変換だけはホストのパスが root 全体に対して済ませている（純粋にテキスト操作で
   * state に依存しないため）。構造フラグメントの収集は fragment info を rootNode + state 名で
   * 登録するので state 依存であり、ホストのパスからは外してここで走らせる。
   *
   * ループ文脈を null で渡すのは Shadow DOM 形（`initializeBindings(shadowRoot, null)`）と
   * 揃えるため —— 子孫の `getLoopContextByNode` はコンポーネント要素まで遡って
   * 親スコープの行を見つける。
   */
  private _initializeLightDomComponentScope(): void {
    const component = this._boundComponent;
    if (component === null || this.parentNode !== component) {
      // Shadow DOM 形（parentNode が ShadowRoot）は対象外
      return;
    }
    if (!component.hasAttribute(config.bindAttributeName)) {
      // plain 形はホストのパスに含まれたままなので、ここで張ると二重になる
      return;
    }
    collectStructuralFragments(this._rootNode!, component);
    initializeBindings(component, null);
  }

  /**
   * mapped な `bind-component` が切断 → 再接続したときに、束ねているパスを読み直させる（§1.9）。
   *
   * リスト行の content は再利用されるので、行が作り直されると子はこの経路を通る
   * （`_initialized` が真なので `_initializeBindWebComponent` / `_initialize` は走らず、
   * 子のバインディングは張り直されない）。切断中に親で起きた変更の通知は
   * `applyChangeToWebComponent` が切断済みを理由に落としているため、ここで読み直さないと
   * 子のビューだけが古い値のまま取り残される。何が変わったかは分からないので、
   * プライマリ規則の粒度で丸ごと読み直す。
   *
   * 読み直しの前に派生規則の memo を捨てる。派生規則の購読者（親スコープに立つ
   * バインディング）は切断で teardown されており、memo が残っていると導出が二度と
   * 走らないため購読者も張り直されない ＝ 以後この子だけがサブパスの書き込みを
   * 受け取れなくなる。捨てておけば、直後の読み直しで導出と購読者登録が走る。
   */
  private _reloadMappedPathsAfterReconnect(): void {
    if (!this._hasMappedComponentState || this._boundComponent === null) {
      return;
    }
    // mapped ＝ プライマリ規則が 1 件以上あることと同義（bindWebComponent の分岐）
    const innerPaths = getPrimaryInnerPaths(this._boundComponent);
    // ルート規則（丸ごとマウント）は内側パスが空なので、子の登録済みパス全部を読み直す
    // （webComponent/rootReloadPaths.ts）
    const rootPaths = hasRootMappingRule(this._boundComponent) ? getRootReloadPaths(this) : [];
    resetDerivedMappingRules(this._boundComponent);
    this.createState("readonly", (state) => {
      for (const path of innerPaths) {
        state.$postUpdate(path);
      }
      for (const path of rootPaths) {
        state.$postUpdate(path);
      }
    });
  }

  private async _callStateConnectedCallback(): Promise<void> {
    await this.createStateAsync("writable", async (state) => {
      // stateに"$connectedCallback"があるか確認し、connectedCallbackAPIを呼び出す
      if (STATE_CONNECTED_CALLBACK_NAME in state) {
        await state[connectedCallbackSymbol]();
      }
    });
  }

  private async _initializeDCC(hostElement: Element, shadowRoot: ShadowRoot): Promise<void> {
    let state: IState;
    try {
      if (this.hasAttribute('src')) {
        const src = this.getAttribute('src')!;
        if (src.endsWith('.js')) {
          state = await loadFromScriptFile(src);
        } else {
          raiseError(`DCC: Unsupported src type: ${src}`);
        }
      } else {
        const script = this.querySelector<HTMLScriptElement>('script[type="module"]');
        if (script) {
          state = await loadFromInnerScript(script, hostElement.tagName.toLowerCase());
        } else {
          raiseError(`DCC: No state source found for "${hostElement.tagName.toLowerCase()}".`);
        }
      }
    } catch (e) {
      raiseError(`DCC: Failed to load state: ${e}`);
    }
    defineDCC(hostElement, shadowRoot, state!);
    this._dcc = true;
    this._initialized = true;
    this._rootNode = null; // disconnectedCallbackでのstate参照を防止
    this._resolveInitialize?.();
    this._resolveConnectedCallback?.();
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
    if (!this._initialized) {
      // DCC 検出: ShadowRoot 内かつホストに data-wc-definition がある場合
      const parentNode = this.parentNode;
      if (parentNode instanceof ShadowRoot &&
          parentNode.host.hasAttribute(DCC_DEFINITION_ATTRIBUTE)) {
        // DCC と bind-component は排他。DCC の state はテンプレートに属し、
        // インスタンスごとにロードされるので、定義時点のホストのプロパティを
        // ソースにする bind-component とは両立しない。従来はこの return で
        // 無言に無視していた（docs/architecture-hardening/15 §3.1）。
        if (this.hasAttribute("bind-component")) {
          raiseError(`"bind-component" cannot be used inside a [${DCC_DEFINITION_ATTRIBUTE}] host. DCC state comes from the template, not from a component property.`);
        }
        await this._initializeDCC(parentNode.host, parentNode);
        return;
      }
      await this._initializeBindWebComponent();
      if (this._mountRecord !== null) {
        // v2 マウント: この要素は独立ツリーを持たない（台帳エイリアスが親を指す）。
        // 名前登録・state ロード・$connectedCallback / $watch / $streams は行わない
        // （マウントスコープの $ 面は P2-9 — 設計書 §4-6）
        this._initialized = true;
        this._resolveInitialize?.();
        this._resolveLoading?.();
        this._resolveConnectedCallback?.();
        return;
      }
      await this._initialize();
      this._initialized = true;
      // 名前登録（_initialize の末尾）が済んだこの時点でなければ、子スコープの
      // `@name` 参照が解決できない（§1.13）
      this._initializeLightDomComponentScope();
      this._resolveInitialize?.();
    } else if (this._mountRecord !== null) {
      // マウント済みコンポーネントの再接続（行 content のプール再利用）: 現在の行の
      // listIndex でマウントスコープの台帳を張り直し、最新値を適用する（§1.9 の v2 版）。
      // microtask に遅らせるのは、この connectedCallback が親の行ループ（mountAfter）の
      // 最中に同期で発火し、新しいループ文脈は直後の activateContent が張るため —
      // 同期で張り直すと旧行の listIndex を読んでしまう
      const mountRecord = this._mountRecord;
      const scopeRoot = this.parentNode as ShadowRoot;
      queueMicrotask(() => {
        if (this._rootNode === null) return; // 再接続後すぐ切断された（プール返却）
        remountScopeBindings(mountRecord, scopeRoot);
      });
      this._resolveConnectedCallback?.();
      return;
    } else if (!this._dcc && getStateElementByName(this._rootNode, this._name) !== this) {
      // 再接続（disconnect で名前登録が解除された後の再 connect）: 登録を復元する。
      // createState が rootNode 経由でこの要素を解決できるようにするために必要
      // （$connectedCallback の再実行と $streams の initial からの再起動が依存する、設計書 §2-3）。
      setStateElementByName(this._rootNode, this._name, this);
      this._reloadMappedPathsAfterReconnect();
    }
    // enable-ssr (クライアント側): SSR で $connectedCallback 済みなのでスキップ
    // inSsr() (サーバー側): レンダリング中なので実行する
    if (!this.hasAttribute('enable-ssr') || inSsr()) {
      await this._callStateConnectedCallback();
    }

    // サーバーモード + enable-ssr: バインディング完了後に <wcs-ssr> を生成。
    // orchestrated（サーバー主導の最終パス、docs/ssr-router-design.md §5）では
    // 生成しない — renderToString が全要素の完了後にまとめて生成するため。
    // ここで生成すると、router 等が後から挿入した内容の構造テンプレートを
    // 取り逃がすレースがある（state のロード方式と文書順に依存）
    if (inSsr() && this.hasAttribute('enable-ssr') && !isOrchestratedSsr()) {
      try {
        await getBindingsReady(this.rootNode);

        const name = this.getAttribute('name') || 'default';
        const stateData = Ssr.extractStateData(this);
        const ssrEl = document.createElement(config.tagNames.ssr);
        ssrEl.setAttribute('name', name);
        ssrEl.setAttribute('version', VERSION);
        Ssr.buildContent(ssrEl, stateData);
        this.parentNode?.insertBefore(ssrEl, this);
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
    // _rootNode ガード: $connectedCallback の await 中に切断された場合は起動しない。
    // ガードなしだと startStream 内の createState が rootNode 解決（disconnectedCallback
    // で null 化済み）の raiseError で throw し、connectedCallbackPromise が永遠に
    // 未解決になる。「未接続の entry は restart しない」設計書 §3-2 とも整合し、
    // _state セッター側の startStreams 前ガード（_rootNode !== null）と対称。
    // 世代ガード（connectGeneration 照合）: await 中に「切断 → 即再接続」された場合、
    // 新 connect が _rootNode を再設定済みで上のガードを素通りするため、世代不一致で
    // 陳腐化した connect の再開を検出して skip する。起動点が新 connect の末尾に
    // 一本化され、「$connectedCallback 完了後に起動」（S1）の順序保証も保たれる。
    // _streamsStartedGeneration ガード: $connectedCallback 内の setInitialState
    // （接続中の再 set）で _state セッター側が新宣言を起動済みの場合は skip する
    // （skip しないと同一 connect サイクルで source が 2 回起動する、設計書 §2-3）。
    // $watch の有効化（$connectedCallback 完了後 ＝ 初期化中の書き込みは購読対象外）。
    // ガードは startStreams と同じ理由で必要（await 中の切断・再接続）。SSR では
    // 走らせない — ハンドラの副作用がサーバとクライアントで二重に実行されるため
    // （docs/state-watch-hook-design.md §11）。
    // startStreams より先に呼ぶ: stream の起動時書き込み（initial リセット・status 遷移）は
    // watch から観測できるべきで、逆向きは要らない。
    // 再入不要: 接続中の _state 再 set は _state セッター側で startWatch 済みだが、
    // startWatch は Set への add で冪等なので $streams のような世代ガードは要らない。
    if (
      !inSsr() &&
      this._rootNode !== null &&
      connectGeneration === this._connectGeneration
    ) {
      startWatch(this);
    }

    if (
      !inSsr() &&
      this._rootNode !== null &&
      connectGeneration === this._connectGeneration &&
      this._streamsStartedGeneration !== connectGeneration
    ) {
      startStreams(this);
    }

    this._resolveConnectedCallback?.();
  }

  disconnectedCallback() {
    if (this._mountRecord !== null) {
      // v2 マウント: 名前登録・streams・watch を持たないので後始末は不要。
      // 台帳エイリアスは消さない（プール再利用の再接続が同じスコープに戻る）
      this._rootNode = null;
      return;
    }
    if (this._rootNode !== null) {
      if (!this._initialized) {
        // 初期化前に剥がされた（bind-component の await 中に shadow が張り直された等）。
        // 名前登録も token も stream もまだ無く、state も作れないので後始末は不要。
        // ここで createState すると "_state is not initialized" で CE リアクションが落ちる
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
        setStateElementByName(this.rootNode, this._name, null);
        clearCommandTokenRegistry(this);
        clearCommandNamespace(this);
        clearEventTokenRegistry(this);
        // stream は abort のみで registry は保持する（再接続時に同じ宣言から
        // initial で再起動できる、設計書 §5-1 / §5-2）。
        // namespace proxy の memo は破棄する（clearCommandNamespace と対称。
        // registry は残るため再接続後の初回アクセスで同内容の proxy が再生成される）。
        abortAllStreams(this);
        clearStreamNamespace(this);
        // watch は発火対象から外すだけで registry は保持する（stream の abortAllStreams と
        // 同じ二段構え、設計書 §9）。registry まで捨てると、_state セッターが再度走らない
        // 再接続で宣言を作り直せず watch が二度と発火しない。
        deactivateWatch(this);
        this._rootNode = null;
      }
    }
  }

  get initialized(): boolean {
    return this._initialized;
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

  get watchPaths(): ReadonlySet<string> | null {
    return this._watchPaths;
  }

  get elementPaths(): Set<string> {
    return this._elementPaths;
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

  get rootNode(): Node {
    if (this._rootNode === null) {
      raiseError('State rootNode is not available.');
    }
    return this._rootNode;
  }

  /**
   * `rootNode` を保持しているか ＝ `createState` を呼んでよいか（§1.9）。
   * disconnect で落ち、connect の冒頭で復活する。
   */
  get hasRootNode(): boolean {
    return this._rootNode !== null;
  }

  get boundComponentStateProp(): string | null {
    return this._boundComponentStateProp;
  }

  get boundComponent(): Element | null {
    return this._boundComponent;
  }

  get hasMappedComponentState(): boolean {
    return this._hasMappedComponentState;
  }

  get boundPaths(): ReadonlySet<string> {
    return this._pathSet;
  }

  get hasMounts(): boolean {
    return this._hasMounts;
  }

  /** 唯一の呼び手は webComponent/mount.ts の registerMountRecord（Phase 2）。 */
  markHasMounts(): void {
    this._hasMounts = true;
  }

  /**
   * この state の実体が innerState proxy であることを記録する。唯一の呼び手は
   * `bindWebComponent` の mapped 分岐（§1.8）。
   */
  markComponentStateMapped(): void {
    this._hasMappedComponentState = true;
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
    if (bindingType === "for") {
      const isNewListPath = !this._listPaths.has(path);
      this._listPaths.add(path);
      this._elementPaths.add(path + '.' + WILDCARD);
      // mapped な bind-component の子が回している for は、配列の実体を親スコープが
      // 持っている。親の依存 walk / swap 判定はどちらも「その state 要素の」
      // listPaths・elementPaths を見るので、マップ先のパスにも同じ宣言を届ける（§1.8）。
      if (isNewListPath && this._hasMappedComponentState) {
        propagateListPathToOuterState(this, path);
      }
    }
    if (!this._pathSet.has(path)) {
      const pathInfo = getPathInfo(path);
      this._pathSet.add(path);
      // 存在しないパスへの配線は「黙って更新されない」だけで終わるため、
      // 新規パスを 1 回だけ検査して確実な miss を報告する（pathDiagnostics.ts）。
      // パスごとに 1 回・バインド確立時のみで、更新のホットパスには乗らない。
      checkDeclaredPath(this, this.__state, path, source);
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

  private _createState<T>(rootNode: Node, mutability: Mutability, callback: (state: IStateProxy) => T): T {
    try {
      const stateProxy = createStateProxy(rootNode, this._state, this._name, mutability);
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

  bindProperty(prop: string, desc: PropertyDescriptor): void {
    Object.defineProperty(this._state, prop, desc);
    if (prop === STATE_UPDATED_CALLBACK_NAME) {
      this._hasUpdatedCallback = true;
    }
  }

  setInitialState(state: Record<string, any>): void {
    if (!this._initialized) {
      this._resolveSetState?.(state);
    } else {
      this._state = state;
    }
  }
}
