/**
 * webComponent/bindComponentLifecycle.ts — `bind-component` とマウントスコープのライフサイクル
 * （設計案 H3、S4）。従来 `State` の `_initializeBindWebComponent` と、接続・再接続・切断の
 * マウント分岐だったもの。本体は State.ts から機械的に移しており、`this.` の参照だけを
 * 要素ごとの台帳（`IBindLedger`）と要素の内部面に書き換えてある。
 *
 * 引き取りの形が他の機能と違う: この処理は `bind-component` のある要素で必ず走り、
 * **マウントスコープを組んだときだけ**その後の初期化（独立ツリーの構築）を打ち切る。
 * そのため受け口は `preparing`（「前処理をして、この要素を丸ごと引き取ったかを返す」）。
 */
import type { IStateElement } from "../components/types";
import { ILifecycleHooks, registerLifecycleHooks } from "../core/lifecycleHooks";
import { setComponentApplyHooks } from "../core/componentApplyHooks";
import { bindComponentApplyHooks } from "./componentApply";
import { config } from "../config";
import { raiseError } from "../raiseError";
import { getStateElement } from "../stateElementByName";
import { getCustomElement } from "../getCustomElement";
import { getCustomElementRegistry } from "../platform/customElementRegistry";
import { getBindingsByNode } from "../bindings/getBindingsByNode";
import { waitInitializeBinding } from "../bindings/initializeBindingPromiseByNode";
import { bindWebComponent, invokeStateReadyCallback } from "./bindWebComponent";
import { buildMountRecord, callMountLifecycleCallback, getRegisteredMountRecord, IMountRecord, warnMountedDollarDeclarations } from "./mount";
import { initializeMountScope, remountScopeBindings } from "./mountScope";
import { createPublicMountState } from "./overlay";
import { warnOwnKeyShadowsForMount } from "./ownKeyShadow";
import { markWebComponentAsComplete, markWebComponentStatePropDeclared } from "./completeWebComponent";
import { getInjectedKeys, restoreOverwrittenValues, takeOverwrittenObject } from "./preCompletionWrites";
import { hasRootMountBinding } from "./rootMountBinding";
import { notifyExports } from "./exportIndex";

/** 要素ごとの控え（従来の `State` の private フィールド 3 つ） */
interface IBindLedger {
  boundComponent: Element | null;
  boundComponentStateProp: string | null;
  /** v2 マウント（Phase 2）: この bind-component 要素が構築したマウント記録 */
  mountRecord: IMountRecord | null;
}

const ledgerByElement = new WeakMap<IStateElement, IBindLedger>();

function ledgerOf(element: IStateElement): IBindLedger {
  let ledger = ledgerByElement.get(element);
  if (typeof ledger === "undefined") {
    ledger = { boundComponent: null, boundComponentStateProp: null, mountRecord: null };
    ledgerByElement.set(element, ledger);
  }
  return ledger;
}

/**
 * 設定エラーでの fail-fast（`State._failInitialization` と同じ着地）。initializePromise 等を
 * 解決してから raise する — 未解決のまま投げると waitForStateInitialize がこの要素を待ち続け、
 * **ページ全体が無言でウェッジする**。
 */
function failInitialization(element: IStateElement, message: string): never {
  element.landInitialization!();
  raiseError(message);
}

async function initializeBindWebComponent(element: IStateElement, ledger: IBindLedger): Promise<void> {
  const el = element as unknown as HTMLElement;
    if (el.hasAttribute("bind-component")) {
      // wcs-stateはコンポーネントのトップレベル要素であること
      // ShadowDOM直下: parentNodeがShadowRoot → hostが親コンポーネント
      // LightDOM/ShadowDOM内のLightDOM: parentNodeがElement → それが親コンポーネント
      const parentNode = el.parentNode;
      const boundComponent = parentNode instanceof ShadowRoot
        ? parentNode.host
        : parentNode instanceof Element
          ? parentNode
          : null;
      const customTagName = boundComponent ? getCustomElement(boundComponent) : null;
      if (boundComponent === null || customTagName === null) {
        raiseError(`"bind-component" requires <${config.tagNames.state}> to be a direct child of a custom element.`);
      }
      // plain（ホスト配線なし）の Light DOM は廃止（v2・2026-09-03 著者決定）。
      // 共有 rootNode に独立ツリーを置くには名前次元が要り、単一登録簿（P3-6）と
      // 両立しない。shadow を付ければ plain Shadow 形（独立ツリー・$ 宣言込み）に
      // そのままなる。data-wcs が無ければ確実に plain — 従来の位置で fail-fast。
      // data-wcs があるときの判定はホスト配線が要るため下（waitInitializeBinding の後）
      if (!(parentNode instanceof ShadowRoot) && !boundComponent.hasAttribute(config.bindAttributeName)) {
        failInitialization(element, 
          `A plain (unwired) Light DOM "bind-component" is not supported. ` +
          `Attach a shadow root to <${customTagName}>, or mount it from the host ` +
          `(data-wcs="${el.getAttribute("bind-component")}: path").`,
        );
      }
      // bind-component はコンポーネント側の state プロパティを唯一のソースにする。
      // state / src / json / inner <script> と併記すると、この後の _initialize が
      // そちらを採用して _setStatePromise を await しないため、bindWebComponent が
      // setInitialState で渡した innerState proxy ごと捨てられ、親↔子マッピングが
      // 無言で死ぬ。併記は必ず設定ミスなので fail-fast させる
      // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §2.6）。
      const conflicting = ["state", "src", "json"].filter((name) => el.hasAttribute(name));
      if (el.querySelector('script[type="module"]') !== null) {
        conflicting.push('<script type="module">');
      }
      if (conflicting.length > 0) {
        raiseError(`"bind-component" cannot be combined with ${conflicting.join(", ")}. The component's "${el.getAttribute("bind-component")}" property is the only state source.`);
      }
      const boundComponentStateProp = el.getAttribute("bind-component")!;
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
      ledger.boundComponent = boundComponent;
      ledger.boundComponentStateProp = boundComponentStateProp;
      element.setBoundComponent!(boundComponent, boundComponentStateProp);
      // data-wcs はあるが state 配線が無い Light DOM も plain（廃止 — 上と同じ誘導）。
      // 判定にホスト配線（台帳）が要るためここ（waitInitializeBinding の後）で行う
      if (!(parentNode instanceof ShadowRoot)
        && !(getBindingsByNode(boundComponent) ?? []).some((b) => b.propSegments[0] === boundComponentStateProp)) {
        failInitialization(element, 
          `A plain (unwired) Light DOM "bind-component" is not supported. ` +
          `Attach a shadow root to <${customTagName}>, or mount it from the host ` +
          `(data-wcs="${boundComponentStateProp}: path").`,
        );
      }
      // v2 マウント（Phase 2・impl-plan §3-0）: この stateProp へのホスト配線
      //（ルートエントリ / 部分マウントのみ、Shadow / Light DOM とも）は単一ツリーで
      // 構築する。ホスト配線が 1 本も無い plain Shadow 形だけが下の bindWebComponent
      //（独立ツリー）に落ちる。
      if (boundComponent.hasAttribute(config.bindAttributeName)) {
        const hostBindings = (getBindingsByNode(boundComponent) ?? []).filter(
          (hostBinding) => hostBinding.propSegments[0] === boundComponentStateProp,
        );
        if (hostBindings.length > 0) {
          // 設定エラーは _failInitialization 経由（未解決 throw は waitForStateInitialize を
          // 永久待ちにしてページ全体をウェッジする — _failInitialization の注記参照）
          const parentStateElement = getStateElement(boundComponent.getRootNode() as Node)
            ?? failInitialization(element, `No state tree found on this root for mount host <${customTagName}>.`);
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
          ledger.mountRecord = record;
          // shadow 張り直しの連打で、上の await 中に自分が剥がされた形。スコープは
          // 次に入った <wcs-state> が組み直すので触らない（_mountRecord は立てて、
          // connectedCallback の続きが v1 の _initialize に落ちないようにする）
          if (el.parentNode !== parentNode) {
            return;
          }
          // スコープ根: Shadow DOM 形はコンポーネントの shadowRoot、
          // Light DOM 形はコンポーネント要素自身（そのサブツリーがスコープ・D7）。
          // 設定エラー（1 スコープ根 1 マウント違反等）でも初期化待ちを
          // ウェッジさせない（_failInitialization と同じ規範 — resolve してから伝播）
          try {
            initializeMountScope(record, parentNode instanceof ShadowRoot ? parentNode : boundComponent);
          } catch (error) {
            // 着地はここで完了（_failInitialization と同じクラス — #257）
            element.landInitialization!();
            throw error;
          }
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
          // 宣言面はマウントでは実行しない（1 回だけ誘導 warn — 設計書 §4-6）。
          // ライフサイクルはスコープごとに残る — $connectedCallback を chroot で呼ぶ
          warnMountedDollarDeclarations(record);
          callMountLifecycleCallback(record, "$connectedCallback");
          return;
        }
      }
      bindWebComponent(element, ledger.boundComponent!, ledger.boundComponentStateProp!, state);
    }
}

export const bindComponentLifecycleHooks: ILifecycleHooks = {
  // ボリューム（20）の後。従来の分岐順（設計案 H3）
  order: 30,
  preparing(element) {
    const el = element as unknown as HTMLElement;
    if (!el.hasAttribute("bind-component")) {
      return null;
    }
    const ledger = ledgerOf(element);
    return initializeBindWebComponent(element, ledger).then(() => {
      if (ledger.mountRecord === null) {
        // ホスト配線の無い plain Shadow 形: 独立ツリーを持つので core の初期化が続く
        return false;
      }
      // v2 マウント: この要素は独立ツリーを持たない（台帳エイリアスが親を指す）。
      // 名前登録・state ロード・$connectedCallback / $watch / $streams は行わない
      // （マウントスコープの $ 面は P2-9 — 設計書 §4-6）
      element.markInitialized!();
      element.settleInitialization!();
      return true;
    });
  },
  reconnecting(element) {
    const ledger = ledgerByElement.get(element);
    if (typeof ledger === "undefined" || ledger.mountRecord === null) {
      return false;
    }
    // マウント済みコンポーネントの再接続（行 content のプール再利用）: 現在の行の
    // listIndex でマウントスコープの台帳を張り直し、最新値を適用する（§1.9 の v2 版）。
    // microtask に遅らせるのは、この接続が親の行ループ（mountAfter）の最中に同期で発火し、
    // 新しいループ文脈は直後の activateContent が張るため — 同期で張り直すと旧行の
    // listIndex を読んでしまう
    const mountRecord = ledger.mountRecord;
    // Shadow DOM 形は shadowRoot、Light DOM 形はコンポーネント要素自身
    const scopeRoot = (element as unknown as HTMLElement).parentNode as ShadowRoot | Element;
    queueMicrotask(() => {
      if (element.connectedRootNode == null) return; // 再接続後すぐ切断された（プール返却）
      remountScopeBindings(mountRecord, scopeRoot);
    });
    // 接続ごとのライフサイクル（v1 の $connectedCallback 再実行と同じ意味論）
    callMountLifecycleCallback(mountRecord, "$connectedCallback");
    return true;
  },
  disconnecting(element) {
    const ledger = ledgerByElement.get(element);
    if (typeof ledger === "undefined" || ledger.mountRecord === null) {
      return false;
    }
    // v2 マウント: 名前登録・streams・watch を持たないので後始末は不要。
    // 台帳エイリアスは消さない（プール再利用の再接続が同じスコープに戻る）。
    // $disconnectedCallback だけは要素のライフサイクルとして呼ぶ（例外は隔離）
    callMountLifecycleCallback(ledger.mountRecord, "$disconnectedCallback");
    // 公開 getter の答えが消えた（X6）— 親の依存者を再評価させる。プール返却も
    // 恒久破棄もここを通る（行ごと消えた形は $postUpdate が届かず無視される）
    notifyExports(ledger.mountRecord);
    element.clearConnectedRootNode!();
    return true;
  },
};

let installed = false;
/** 冪等。full / auto では `bootstrapState()` の `installVolumeGraft()` が呼ぶ */
export function installBindComponentLifecycle(): void {
  if (installed) return;
  installed = true;
  registerLifecycleHooks("bindComponent", bindComponentLifecycleHooks);
  // 親スコープの適用が台帳を引く受け口（core/componentApplyHooks.ts）
  setComponentApplyHooks(bindComponentApplyHooks);
}
