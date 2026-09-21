/**
 * webComponent/volumeLifecycle.ts — ボリューム（`<wcs-state mount="path">`）のライフサイクル
 * （設計案 H3、S4）。独立ツリーを持たず、ロード完了でルートに接ぎ木する（volume.ts）。
 * 接続時にスロットを予約（D22）。ルートより先に接続されてもよい — ルート登録が保留分を引き取る（V5）。
 *
 * 従来 `State` の private メソッド（`_initializeVolume` / `_acquireVolumeSlot` / `_releaseVolumeSlot`）と
 * 5 つの private フィールドだったものを、要素ごとの台帳を持つこのモジュールへ移した。要素から要るのは
 * 内部面の 5 つ（`connectedRootNode` / `clearConnectedRootNode` / `markInitialized` /
 * `settleInitialization` / `loadStateFromSource`）だけ。
 */
import type { IStateElement } from "../components/types";
import { CLAIMED, ILifecycleHooks, registerLifecycleHooks } from "../core/lifecycleHooks";
import { config } from "../config";
import { raiseError } from "../raiseError";
import { getStateElement } from "../stateElementByName";
import { callVolumeLifecycle, clearFailedRootNode, failPendingVolumes, graftOrQueueVolume, IVolumeGraftInfo, releaseVolumeSlot, reserveVolumeSlot, validateVolumeMountPath } from "./volume";

/** 要素ごとのボリュームの控え（従来の `State` の private フィールド 5 つ） */
interface IVolumeLedger {
  /** 接ぎ木済みの控え（`$disconnectedCallback` 用） */
  graftInfo: IVolumeGraftInfo | null;
  /** スロット予約済み・接ぎ木進行中（ロード完了前の再接続の再入ガード） */
  initializing: boolean;
  /**
   * 予約したマウントパス（#265）。枠を返した後に取り直すときもこれを使う —
   * `mount` 属性は書き換えられるので読み直さない。
   */
  mountPath: string | null;
  /**
   * いま枠を握っている rootNode（#265）。null は「握っていない」。解放はこの控えと
   * `mountPath` の組でだけ行う。切断時の rootNode（先に null になる）から読み直すと、
   * 予約した組と一致する保証が無く、別の要素の枠を消しうる。
   */
  slotRootNode: Node | null;
  /**
   * ロード中に外れたときに枠を返した rootNode（#265）。同じ rootNode へ付け直した（並べ替えた）
   * ときだけ、接続でその場で枠を取り直すための控え。付け直すたびに null へ戻す。
   */
  detachedFrom: Node | null;
}

const ledgerByElement = new WeakMap<IStateElement, IVolumeLedger>();

function ledgerOf(element: IStateElement): IVolumeLedger {
  let ledger = ledgerByElement.get(element);
  if (typeof ledger === "undefined") {
    ledger = { graftInfo: null, initializing: false, mountPath: null, slotRootNode: null, detachedFrom: null };
    ledgerByElement.set(element, ledger);
  }
  return ledger;
}

function asElement(element: IStateElement): HTMLElement {
  return element as unknown as HTMLElement;
}

/** 控えている枠を返す（#265）。所有者の確認は `releaseVolumeSlot` が行う。 */
function releaseSlot(element: IStateElement, ledger: IVolumeLedger): void {
  if (ledger.slotRootNode === null) {
    return;
  }
  releaseVolumeSlot(ledger.slotRootNode, ledger.mountPath!, element);
  ledger.slotRootNode = null;
}

/**
 * 接ぎ木の直前に、`rootNode` のマウントの枠を取る（#265）。握っていれば真。ロード中・保留中に外れて
 * 返していれば取り直して真。外れている間に別の要素が同じマウントパスを取っていれば、横取りせずに
 * 報告して偽 — 黙らせると、作者に見えるのは「データが現れない」だけになる。
 */
function acquireSlot(element: IStateElement, ledger: IVolumeLedger, rootNode: Node): boolean {
  if (ledger.slotRootNode === rootNode) {
    return true;
  }
  const mountPath = ledger.mountPath!;
  try {
    reserveVolumeSlot(rootNode, mountPath, element);
  } catch {
    console.error(
      `[@wcstack/state] <${config.tagNames.state} mount="${mountPath}"> will not graft: another volume already holds ` +
      `the "${mountPath}" slot on this root. Keep one volume per mount path.`,
    );
    return false;
  }
  getStateElement(rootNode)?.markHasVolume?.();
  ledger.slotRootNode = rootNode;
  return true;
}

async function initializeVolume(element: IStateElement, ledger: IVolumeLedger): Promise<void> {
  const el = asElement(element);
  const rootNode = element.connectedRootNode!;
  const mountPath = el.getAttribute("mount")!;
  try {
    validateVolumeMountPath(mountPath);
    if (el.hasAttribute("bind-component")) {
      raiseError(`"mount" cannot be combined with "bind-component".`);
    }
    // name 併記は接続の冒頭の name チェックが mount 専用文言で先に落とす
    //（ここに同じ検査を置いても到達しない）
    if (el.hasAttribute("enable-ssr")) {
      // D14: スナップショットはルートに 1 本 — ボリューム側の enable-ssr は意味を持たない
      console.warn(`[@wcstack/state] <${config.tagNames.state} mount="${mountPath}"> ignores "enable-ssr" — snapshots are per root tree (the root state element aggregates volume data).`);
    }
    reserveVolumeSlot(rootNode, mountPath, element);
    // ルートが既に居れば今すぐ、まだなら登録時に（volume.ts の adoptVolumesOnRootRegistered）hook を付ける
    getStateElement(rootNode)?.markHasVolume?.();
    ledger.mountPath = mountPath;
    ledger.slotRootNode = rootNode;
  } catch (error) {
    // 設定エラーでも初期化待ちをウェッジさせない（`_failInitialization` と同じ規範 —
    // 未解決のまま投げると waitForStateInitialize がページ全体を無言で止める）。
    // ここを `_failInitializeLoudly` に載せないのは意図（#257 第 3 ラウンド）:
    // この要素はルートではないので、あちらの「この rootNode にルートは来ない」着地
    //（markBindingsUnavailable / failPendingVolumes）が**無関係なルートと兄弟
    // ボリュームを巻き添えにする**。promise を解決してから raise する点は
    // `name=` と同じクラスで、reject 側へ動かすのは別の設計判断
    element.settleInitialization!();
    throw error;
  }
  // 予約成立後に立てる（設定エラーの再接続は従来どおり再 raise させる）
  ledger.initializing = true;
  // D11: ルートの居ないページのボリュームを無言にしない（検査は要素の存在・
  // パース完了後 — 下の module 関数を参照）
  if (getStateElement(rootNode) === null) {
    reportVolumeWithoutRoot(rootNode, mountPath);
  }
  const finish = (info: IVolumeGraftInfo | null): void => {
    ledger.graftInfo = info;
    element.markInitialized!();
    if (info === null) {
      // 接ぎ木しないまま決着した（ロード失敗・接ぎ木失敗・孤児・外れたまま）ので枠を返す（#265）。
      // 握ったままだと、同じマウントパスで作り直した要素が "already mounted" に弾かれ、
      // 復旧がページの読み直ししか無くなる
      releaseSlot(element, ledger);
    }
    element.settleInitialization!();
  };
  let volumeState: Record<string, any>;
  try {
    volumeState = await element.loadStateFromSource!();
  } catch (error) {
    // ロード失敗（404 / JSON パースエラー / import 失敗）は 1 ボリュームに閉じる
    // （graftIsolated と同じ隔離規範 — 接ぎ木は載らず、枠も返す着地）。
    // 未解決のまま投げると waitForStateInitialize が全 <wcs-state> の
    // initializePromise を Promise.all で待つためページ全体が無言でウェッジし、
    // 上で立てた initializing の再入ガードが remove → append の復旧も握り潰す。
    // 予約成立後の失敗は graft 失敗と同じ着地（finish(null)）に合流し、
    // 予約成立前の設定エラー（上の try/catch）だけが fail-fast で再 raise する
    console.error(`[@wcstack/state] volume "${mountPath}" failed to load.`, error);
    finish(null);
    return;
  }
  // 接ぎ木先はいま繋がっている rootNode。await 中に剥がされていたら接ぎ木しない（スコープは持っていない）。ロード中に外れて枠を返していれば、ここで取り直す（#265）。
  // 保留に積むなら、ルートが来た時点でもう一度取る — その間に外れて枠を返していることがあり、そのとき
  // 枠が空いていれば外れたままでも接ぎ木する（従来の着地）。別の要素が取っていれば接ぎ木しない
  const graftRootNode = element.connectedRootNode ?? null;
  if (graftRootNode === null) {
    finish(null);
    return;
  }
  if (!acquireSlot(element, ledger, graftRootNode)) {
    finish(null);
    return;
  }
  graftOrQueueVolume(
    graftRootNode,
    getStateElement(graftRootNode),
    mountPath,
    volumeState,
    finish,
    () => acquireSlot(element, ledger, graftRootNode),
  );
}

export const volumeLifecycleHooks: ILifecycleHooks = {
  // DCC（10）の後・bind-component（30）の前。従来の分岐順（設計案 H3）
  order: 20,
  connecting(element) {
    const el = asElement(element);
    if (!el.hasAttribute("mount")) {
      return null;
    }
    const ledger = ledgerOf(element);
    // ロード完了前の remove → append 再入: 接ぎ木は進行中の initializeVolume が持っている
    // （connectedCallbackPromise もそちらが解決する）ので再実行しない。再実行すると
    // reserveVolumeSlot を二重に呼ぶ。外れたときに返した枠は、原則として接ぎ木の直前に取り直す（#265 —
    // acquireSlot）。別の root へ移った形でここで取ると、保留の要求が残る元の root と食い違った
    // まま、移った先の枠を握り続ける。同じ root へ付け直した（並べ替えた）だけなら、空いている枠を
    // その場で黙って取り直す — 取らないと、並べ替えの一瞬に後から来た同じパスのボリュームに枠を奪われる。
    // 取れなければ、接ぎ木の直前の取り直しが報告する
    if (ledger.initializing) {
      const rootNode = element.connectedRootNode;
      if (rootNode != null && ledger.detachedFrom === rootNode) {
        try {
          reserveVolumeSlot(rootNode, ledger.mountPath!, element);
          getStateElement(rootNode)?.markHasVolume?.();
          ledger.slotRootNode = rootNode;
        } catch {
          // 外れている間に別のボリュームが取った。接ぎ木の直前の acquireSlot が報告する
        }
      }
      ledger.detachedFrom = null;
      return CLAIMED;
    }
    return initializeVolume(element, ledger);
  },
  reconnecting(element) {
    const el = asElement(element);
    if (!el.hasAttribute("mount")) {
      return false;
    }
    // 初期化済みボリュームの再接続（remove → append）: 接ぎ木・アクセサ・宣言はツリーに残っている
    // （disconnecting と対称 — アンマウント未対応）。core の「ルート再登録」に落とすと、独立ツリーを
    // 持たないボリューム自身がこの rootNode のツリー根として登録されてしまう（ルート不在時）か、
    // "already registered" で落ちる（ルート健在時）。
    // $connectedCallback だけは要素のライフサイクルとして chroot で再実行する（マウント済み
    // コンポーネントの再接続と同じ意味論）。ルートが既に居ない・別 rootNode へ移された形では
    // 接ぎ木先ツリーに到達できないので呼ばない
    const ledger = ledgerOf(element);
    const rootNode = element.connectedRootNode ?? null;
    if (ledger.graftInfo !== null && rootNode !== null
      && getStateElement(rootNode) === ledger.graftInfo.rootStateElement) {
      callVolumeLifecycle(ledger.graftInfo, "$connectedCallback");
    }
    return true;
  },
  replacingState(element) {
    // 読み込み済みのボリューム（#268）: 接ぎ木はロード完了時にデータをルートの木へ一度だけ複製する
    // ので、この要素の state を入れ直してもページには届かない（要素自身の読みだけが新しくなる）。
    // 無言の no-op にせず、ルート側の拒否（D22）と同じく loud に落とす。initializing は
    // スロットを予約したボリュームだけが立て、下ろさない — 接ぎ木に失敗した形もここで弾く。
    if (ledgerByElement.get(element)?.initializing !== true) {
      return;
    }
    const mountPath = asElement(element).getAttribute("mount");
    raiseError(
      `Cannot replace the state of <${config.tagNames.state} mount="${mountPath}"> after it has loaded: ` +
      `a volume's data is copied into the root tree when it grafts, so a new state would never reach the page. ` +
      `Write the paths under "${mountPath}" on the root state instead.`,
    );
  },
  initializeFailed(_element, rootNode) {
    // このルートノードにルートは来ない: 保留中のボリュームを待たせ続けない（#257）
    failPendingVolumes(rootNode);
  },
  initializeFailureCleared(_element, rootNode) {
    // 落ちたルート要素**本人**が DOM から消えた ＝「このルートノードにルートは来ない」はもう
    // 成り立たない（作者の復旧は取り除いて作り直す）。印が残ると、外してから修正版を接続する
    // までの窓で接続したボリュームが即座に孤児化する
    clearFailedRootNode(rootNode);
  },
  disconnecting(element) {
    const el = asElement(element);
    if (!el.hasAttribute("mount")) {
      return false;
    }
    // ボリューム: 接ぎ木したデータ・アクセサ・宣言はツリーに残る（アンマウントは
    // 未対応 — 揮発させると依存グラフに残った getter 登録が宙に浮く）。接ぎ木済みなら予約も維持。
    // $disconnectedCallback だけは要素のライフサイクルとして chroot で呼ぶ
    const ledger = ledgerOf(element);
    if (ledger.graftInfo !== null) {
      callVolumeLifecycle(ledger.graftInfo, "$disconnectedCallback");
    }
    if (element.initialized !== true) {
      // ロード中（ルート待ちの保留中を含む）に外れた: 枠を返す（#265）。握ったままだと、ソースが
      // 来ないまま外れた要素の枠が漏れ、同じマウントパスで作り直した要素が "already mounted" に
      // 弾かれる。枠は接ぎ木の直前に取り直す（acquireSlot）。同じ root へ付け直したときだけは
      // 接続がその場で取り直すので、外れた root を控える
      ledger.detachedFrom = ledger.slotRootNode;
      releaseSlot(element, ledger);
    }
    element.clearConnectedRootNode!();
    return true;
  },
};

let installed = false;
/** 冪等。full / auto では `bootstrapState()` の `installVolumeGraft()` が呼ぶ */
export function installVolumeLifecycle(): void {
  if (installed) return;
  installed = true;
  registerLifecycleHooks("scopes", volumeLifecycleHooks);
}

/**
 * D11（設計 §4-7）: ボリュームだけでルートの無いページを無言にしない。
 * 接ぎ木は保留キューで待つ（V5 — ルートが後から来れば成立する）ため throw はせず、
 * 接続内 throw は初期化待ちを永久未解決にする（`_failInitialization` の注記と同じ理由）。
 * そこで文書のパース完了後に「ルート候補（mount も bind-component も無い <wcs-state>）が
 * **要素として**存在するか」を検査し、無ければ console.error で誘導する。登録（ロード完了）でなく
 * 要素の存在で見るのは、ルートの src ロードの遅さで誤検知しないため。ルートを後から動的に足す
 * ページでは報告が出るが、接ぎ木自体はその後も成立する（文言で釈明）。
 */
function reportVolumeWithoutRoot(rootNode: Node, mountPath: string): void {
  const check = (): void => {
    if (getStateElement(rootNode) !== null) {
      return; // ルートが登録された
    }
    // rootNode は Document / ShadowRoot / Element のいずれか — querySelectorAll は必ずある
    const candidates = (rootNode as ParentNode).querySelectorAll(config.tagNames.state);
    for (const el of candidates) {
      if (!el.hasAttribute("mount") && !el.hasAttribute("bind-component")) {
        return; // ルート候補が居る（ロード中かもしれない）— 登録を待つ
      }
    }
    console.error(
      `[@wcstack/state] <${config.tagNames.state} mount="${mountPath}"> has no root state tree to graft onto (D11). ` +
      `A volume mounts onto the root tree — add a root <${config.tagNames.state}> to this root node ` +
      `(an empty <${config.tagNames.state}></${config.tagNames.state}> is enough). ` +
      `If the root is added dynamically later, the graft will still complete and this report can be ignored.`,
    );
  };
  const doc = (rootNode.ownerDocument ?? rootNode) as Document;
  if (doc.readyState === "loading") {
    // パース中は後続にルートが書かれていてもまだ DOM に無い — 完了後に検査する
    doc.addEventListener("DOMContentLoaded", () => queueMicrotask(check), { once: true });
  } else {
    setTimeout(check, 0);
  }
}
