import { IAbsoluteStateAddress } from "../address/types";
import { IStateElement } from "../components/types";
import { config } from "../config";
import { devtoolsSink } from "../platform/devtoolsSink";
import { setLastListValueByAbsoluteStateAddress } from "../list/lastListValueByAbsoluteStateAddress";
import { setStateListBaseline } from "../list/stateListBaseline";
import { errorCallbackSymbol, updatedCallbackSymbol } from "../proxy/symbols";
import { raiseError } from "../raiseError";
import { getStateElement } from "../stateElementByName";
import { IPropagationContext } from "../propagation/types";
import { IBindingErrorInfo, IBindingInfo } from "../types";
import { applyChange } from "./applyChange";
import { applyChangeToProperty } from "./applyChangeToProperty";
import { getRootNodeByFragment } from "./rootNodeByFragment";
import { IApplyContext, IDeferredSelectBinding } from "./types";

/** $errorCallback へ配送する失敗 1 件（drain 末尾でまとめて配送する） */
interface IBindingFailure {
  readonly error: unknown;
  readonly info: IBindingErrorInfo;
}

/**
 * バインディング 1 本の適用失敗を報告する（握り潰しではない）。
 *
 * `console.error` だけだと devtools からは「静かに握られた失敗」が見えないため、
 * 同じ地点から sink にも流す（`state:watch-error` と同じ位置づけ）。
 * 値と DOM は巻き戻さない — 伝播 hop 上限超過・watch 連鎖打ち切りと同じ姿勢。
 *
 * state が `$errorCallback` を宣言していれば、console.error の代わりにそこへ配送する
 * （作者が報告を引き取った。ページ内で受けるための口）。配送は batch の末尾 —
 * $updatedCallback と同じ位置 — にまとめる。devtools sink へは宣言の有無に関わらず流す。
 */
function reportBindingApplyError(
  binding: IBindingInfo,
  error: unknown,
  stateElement: IStateElement | null,
  failuresByStateElement: Map<IStateElement, IBindingFailure[]>,
): void {
  const handled = stateElement !== null && stateElement.hasErrorCallback === true;
  if (handled) {
    const info: IBindingErrorInfo = {
      path: binding.statePathName,
      bindingType: binding.bindingType,
      node: binding.node,
    };
    const failures = failuresByStateElement.get(stateElement);
    if (failures === undefined) {
      failuresByStateElement.set(stateElement, [{ error, info }]);
    } else {
      failures.push({ error, info });
    }
  } else {
    console.error(
      `[@wcstack/state] binding "${binding.bindingType}: ${binding.statePathName}" failed to apply; ` +
      `the rest of this batch continues.`,
      { node: binding.node, error },
    );
  }
  if (devtoolsSink !== null) {
    devtoolsSink({
      type: "state:binding-apply-error",
      path: binding.statePathName,
      bindingType: binding.bindingType,
      error,
    });
  }
}

/**
 * バインディング情報の配列を処理し、各バインディングに対して状態の変更を適用する。
 *
 * 2フェーズで処理:
 * Phase 1: 構造的更新(for/if) + 値更新(select以外) — select.value/selectedIndex は遅延収集
 * Phase 2: 遅延されたselect.value/selectedIndex を適用（option要素の生成後）
 *
 * 最適化のため、以下のグループ化を行う:
 * 同じ rootNode を持つバインディングをグループ化 → createState の呼び出しを削減
 *
 * `options.updatedCallback === false` は `$updatedCallback` を呼ばない。唯一の呼び手は再セットの
 * 再適用（apply/reapplyStateBindings.ts）で、再セットは書き込みではないため。`$errorCallback` は
 * 適用の失敗の報告なので、どの経路でも配送する。
 */
export function applyChangeFromBindings(
  bindings: IBindingInfo[],
  propagationContextByBinding?: ReadonlyMap<IBindingInfo, IPropagationContext | null>,
  options?: { readonly updatedCallback?: boolean },
): void {
  let bindingIndex = 0;
  const appliedBindingSet: Set<IBindingInfo> = new Set();
  const newListValueByAbsAddress: Map<IAbsoluteStateAddress, readonly unknown[]> = new Map();
  const updatedAbsAddressSetByStateElement: Map<IStateElement, Set<IAbsoluteStateAddress>> = new Map();
  const deferredSelectBindings: IDeferredSelectBinding[] = [];
  const failuresByStateElement: Map<IStateElement, IBindingFailure[]> = new Map();

  // Phase 1: 構造的更新 + 値更新（select.value/selectedIndex は遅延）
  while(bindingIndex < bindings.length) {
    let binding = bindings[bindingIndex];
    if (binding.replaceNode.isConnected === false) {
      // 切断されているバインディングは無視、本来は事前に除去されているはず
      if (config.debug) {
        console.log(`applyChangeFromBindings: skip disconnected binding: ${binding.bindingType} ${binding.statePathName} on ${binding.node.nodeName}`, binding);
      }
      bindingIndex++;
      continue;
    }
    let rootNode: Node | null = binding.replaceNode.getRootNode() as Node;
    if (rootNode instanceof DocumentFragment && !(rootNode instanceof ShadowRoot)) {
      rootNode = getRootNodeByFragment(rootNode);
      if (rootNode === null) {
        raiseError(`Root node for fragment not found for binding.`);
      }
    }
    const stateElement = getStateElement(rootNode);
    if (stateElement === null) {
      raiseError(`No state tree found on this root for binding.`);
    }

    stateElement.createState("readonly", (state) => {
      const context: IApplyContext = {
        rootNode: rootNode,
        stateElement: stateElement,
        state: state,
        appliedBindingSet: appliedBindingSet,
        newListValueByAbsAddress: newListValueByAbsAddress,
        updatedAbsAddressSetByStateElement: updatedAbsAddressSetByStateElement,
        deferredSelectBindings: deferredSelectBindings,
        // グループ内の binding は下の do/while が「解決済みルート === rootNode」を
        // 検証してから applyChange に渡す（applyChange 側の getRootNode 省略の根拠）
        sameRootVerified: true,
        propagationContextByBinding: propagationContextByBinding,
      };

      do {
        // 1 本の失敗を 1 本に閉じ込める（§ エラー隔離）。隔離しないと、stale な
        // アドレスを読んだ 1 本の throw がバッチの残り・$updatedCallback・drain
        // リスナー（$watch / $streams restart）まで道連れにし、「値は新しいのに
        // DOM は途中まで」という再現困難な半端状態を作る。
        try {
          applyChange(binding, context);
        } catch (error) {
          reportBindingApplyError(binding, error, stateElement, failuresByStateElement);
        }
        bindingIndex++;

        const nextBindingInfo: IBindingInfo | undefined = bindings[bindingIndex];
        if (!nextBindingInfo) break; // 終端に到達
        const nextRootNode = nextBindingInfo.replaceNode.getRootNode() as Node;
        if (nextRootNode !== context.rootNode) break; // ルートが変わった
        binding = nextBindingInfo;
      } while(true); // eslint-disable-line no-constant-condition
    });
  }
  // Phase 2: 遅延されたselect.value/selectedIndex を適用
  // applyChangeToProperty は propagationContextByBinding 以外の context を
  // 参照しないため、遅延分は最小 context を渡す
  for (const { binding, value, stateElement } of deferredSelectBindings) {
    try {
      applyChangeToProperty(binding, { propagationContextByBinding } as unknown as IApplyContext, value);
    } catch (error) {
      reportBindingApplyError(binding, error, stateElement ?? null, failuresByStateElement);
    }
  }

  for(const [ absAddress, newListValue ] of newListValueByAbsAddress.entries()) {
    setLastListValueByAbsoluteStateAddress(absAddress, newListValue);
    // 描画の基準とは別に、state 側の基準（読み・依存ウォークの共有正本）も進める。
    // 初回描画はどの書き込みも経ていないので、ここで観測しておかないと最初の構造
    // 書き込みで基準が空のまま ListIndex を鋳造してしまう（E1）。
    setStateListBaseline(absAddress, newListValue);
  }
  if (options?.updatedCallback !== false) {
    for(const [ stateElement, absAddressSet ] of updatedAbsAddressSetByStateElement.entries()) {
      stateElement.createState("writable", (state) => {
        state[updatedCallbackSymbol](Array.from(absAddressSet));
      });
    }
  }
  // $errorCallback の配送。$updatedCallback の後・失敗した本数ぶん・this は writable proxy。
  // callback 自身の throw は隔離する — 1 件の報告失敗が残りの報告と drain を道連れにしない
  for (const [ stateElement, failures ] of failuresByStateElement.entries()) {
    stateElement.createState("writable", (state) => {
      for (const { error, info } of failures) {
        try {
          state[errorCallbackSymbol](error, info);
        } catch (callbackError) {
          console.error(
            `[@wcstack/state] $errorCallback threw while handling the failure of binding "${info.bindingType}: ${info.path}".`,
            { error: callbackError, original: error, node: info.node },
          );
        }
      }
    });
  }
}
