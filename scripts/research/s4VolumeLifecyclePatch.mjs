// S4, first slice (wiring design §3 H3 / H5, §8): the lifecycle receptacle, applied to the volume
// (`mount=`) feature. `State.connectedCallback` / `disconnectedCallback` stop knowing what a volume
// is: a feature claims the connect (returning the promise of the initialization it now owns) or the
// disconnect, and everything the volume needs from the element goes through a small internal surface
// (`connectedRootNode` / `clearConnectedRootNode` / `markInitialized` / `settleInitialization` /
// `loadStateFromSource`). The volume's five private fields leave `State` for a per-element ledger in
// the feature, as every other feature ledger in this codebase already works.
// The readiness barrier (H5 / D13): a `mount=` element nobody claims means the scopes feature is not
// installed, and `requireLifecycleFeature` throws by the attribute's name. On full / auto
// `bootstrapState()` installs it, so it never fires there.
// Applied to a sandbox copy of packages/state that carries the three S3 slices; every anchor must
// match exactly once.
//   node scripts/research/s4VolumeLifecyclePatch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: s4VolumeLifecyclePatch.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const edit of edits) {
    if (edit.length === 3 && typeof edit[2] === 'string') {
      const [start, end, replacement] = edit;
      const s = code.indexOf(start);
      if (s === -1 || code.indexOf(start, s + 1) !== -1) throw new Error(`${rel}: start anchor not unique: ${start.slice(0, 70)}`);
      const e = code.indexOf(end, s);
      if (e === -1 || code.indexOf(end, e + 1) !== -1) throw new Error(`${rel}: end anchor not unique: ${end.slice(0, 70)}`);
      code = code.slice(0, s) + replacement + code.slice(e + end.length);
      continue;
    }
    const [anchor, replacement] = edit;
    const count = code.split(anchor).length - 1;
    if (count !== 1) throw new Error(`${rel}: anchor found ${count} times: ${anchor.slice(0, 70)}`);
    code = code.replace(anchor, () => replacement);
  }
  await writeFile(file, code);
  console.log('patched', rel);
}
async function writeOnce(rel, content) {
  const file = join(pkg, rel);
  const existing = await readFile(file, 'utf8').catch(() => null);
  if (existing !== null && existing.replaceAll('\r\n', '\n').includes(content.slice(0, 200))) { console.log('already written', rel); return; }
  await writeFile(file, content);
  console.log('wrote', rel);
}

// 1. the receptacle
await writeOnce('src/core/lifecycleHooks.ts', `/**
 * core/lifecycleHooks.ts — ライフサイクルの受け口（設計案 H3・H5、S4）。
 *
 * \`connectedCallback\` / \`disconnectedCallback\` の「この要素は自分のものだ」という分岐
 * （ボリューム \`mount=\`・DCC・bind-component）を機能側へ移すための受け口。機能は
 * \`install()\` で \`registerLifecycleHooks\` を呼び、core は登録順ではなく \`order\` の昇順で聞く
 * （install の順に依存させない — 従来の分岐順が契約なので、番号でそれを固定する）。
 *
 * \`connecting\` は「引き取らない」を **null** で返す。引き取るときだけ Promise を返すので、
 * 引き取り手の無い素の state（大多数）に microtask の境界を 1 つも足さない。
 */
import type { IStateElement } from "../components/types";
import { raiseError } from "../raiseError";

/** 引き取ったが待つものが無いときの返り値 */
export const CLAIMED: Promise<void> = Promise.resolve();

/** 引き取るなら「この接続の初期化」の Promise、引き取らないなら null */
export type ConnectingHook = (element: IStateElement) => Promise<void> | null;
/** 引き取って切断を処理したなら true */
export type DisconnectingHook = (element: IStateElement) => boolean;
/** 初期化済みの要素の再接続を引き取ったなら true */
export type ReconnectingHook = (element: IStateElement) => boolean;
/** state の差し替えを拒むなら throw する（拒まないなら何もしない） */
export type ReplacingStateHook = (element: IStateElement) => void;

export interface ILifecycleHooks {
  /** 聞く順（従来の分岐順: DCC 10 → ボリューム 20 → bind-component 30） */
  readonly order: number;
  readonly connecting?: ConnectingHook;
  readonly disconnecting?: DisconnectingHook;
  readonly reconnecting?: ReconnectingHook;
  readonly replacingState?: ReplacingStateHook;
}

const registry = new Map<string, ILifecycleHooks>();
let ordered: ILifecycleHooks[] = [];

/** 機能の install が呼ぶ（冪等） */
export function registerLifecycleHooks(feature: string, hooks: ILifecycleHooks): void {
  registry.set(feature, hooks);
  ordered = Array.from(registry.values()).sort((a, b) => a.order - b.order);
}

export function isLifecycleFeatureRegistered(feature: string): boolean {
  return registry.has(feature);
}

/**
 * 宣言（属性）が機能を要求したのに誰も引き取らなかった: 未 install として名指しで throw する
 * （readiness barrier、H5 / D13）。full / auto は \`bootstrapState()\` が install するので起きない。
 */
export function requireLifecycleFeature(feature: string, declaration: string): never {
  return raiseError(
    \`[wcs/feature-not-installed] \${declaration} needs the "\${feature}" feature: install it before connecting the element.\`,
  );
}

/** 接続を引き取る機能を探す。引き取り手が無ければ null（core が通常の初期化を続ける） */
export function runConnecting(element: IStateElement): Promise<void> | null {
  for (let i = 0; i < ordered.length; i++) {
    const claimed = ordered[i].connecting?.(element);
    if (claimed != null) {
      return claimed;
    }
  }
  return null;
}

/** 初期化済みの要素の再接続を引き取る機能を探す。引き取られたら true */
export function runReconnecting(element: IStateElement): boolean {
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].reconnecting?.(element) === true) {
      return true;
    }
  }
  return false;
}

/** state の差し替えを拒む機能に聞く（拒む機能は throw する） */
export function runReplacingState(element: IStateElement): void {
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].replacingState?.(element);
  }
}

/** 切断を引き取る機能を探す。引き取られたら true（core の後始末は走らない） */
export function runDisconnecting(element: IStateElement): boolean {
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].disconnecting?.(element) === true) {
      return true;
    }
  }
  return false;
}
`);

// 2. the volume feature owns its lifecycle and its per-element ledger
await writeOnce('src/webComponent/volumeLifecycle.ts', `/**
 * webComponent/volumeLifecycle.ts — ボリューム（\`<wcs-state mount="path">\`）のライフサイクル
 * （設計案 H3、S4）。独立ツリーを持たず、ロード完了でルートに接ぎ木する（volume.ts）。
 * 接続時にスロットを予約（D22）。ルートより先に接続されてもよい — ルート登録が保留分を引き取る（V5）。
 *
 * 従来 \`State\` の private メソッド（\`_initializeVolume\` / \`_acquireVolumeSlot\` / \`_releaseVolumeSlot\`）と
 * 5 つの private フィールドだったものを、要素ごとの台帳を持つこのモジュールへ移した。要素から要るのは
 * 内部面の 5 つ（\`connectedRootNode\` / \`clearConnectedRootNode\` / \`markInitialized\` /
 * \`settleInitialization\` / \`loadStateFromSource\`）だけ。
 */
import type { IStateElement } from "../components/types";
import { CLAIMED, ILifecycleHooks, registerLifecycleHooks } from "../core/lifecycleHooks";
import { config } from "../config";
import { raiseError } from "../raiseError";
import { getStateElement } from "../stateElementByName";
import { callVolumeLifecycle, graftOrQueueVolume, IVolumeGraftInfo, releaseVolumeSlot, reserveVolumeSlot, validateVolumeMountPath } from "./volume";

/** 要素ごとのボリュームの控え（従来の \`State\` の private フィールド 5 つ） */
interface IVolumeLedger {
  /** 接ぎ木済みの控え（\`$disconnectedCallback\` 用） */
  graftInfo: IVolumeGraftInfo | null;
  /** スロット予約済み・接ぎ木進行中（ロード完了前の再接続の再入ガード） */
  initializing: boolean;
  /**
   * 予約したマウントパス（#265）。枠を返した後に取り直すときもこれを使う —
   * \`mount\` 属性は書き換えられるので読み直さない。
   */
  mountPath: string | null;
  /**
   * いま枠を握っている rootNode（#265）。null は「握っていない」。解放はこの控えと
   * \`mountPath\` の組でだけ行う。切断時の rootNode（先に null になる）から読み直すと、
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

/** 控えている枠を返す（#265）。所有者の確認は \`releaseVolumeSlot\` が行う。 */
function releaseSlot(element: IStateElement, ledger: IVolumeLedger): void {
  if (ledger.slotRootNode === null) {
    return;
  }
  releaseVolumeSlot(ledger.slotRootNode, ledger.mountPath!, element);
  ledger.slotRootNode = null;
}

/**
 * 接ぎ木の直前に、\`rootNode\` のマウントの枠を取る（#265）。握っていれば真。ロード中・保留中に外れて
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
      \`[@wcstack/state] <\${config.tagNames.state} mount="\${mountPath}"> will not graft: another volume already holds \` +
      \`the "\${mountPath}" slot on this root. Keep one volume per mount path.\`,
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
      raiseError(\`"mount" cannot be combined with "bind-component".\`);
    }
    // name 併記は接続の冒頭の name チェックが mount 専用文言で先に落とす
    //（ここに同じ検査を置いても到達しない）
    if (el.hasAttribute("enable-ssr")) {
      // D14: スナップショットはルートに 1 本 — ボリューム側の enable-ssr は意味を持たない
      console.warn(\`[@wcstack/state] <\${config.tagNames.state} mount="\${mountPath}"> ignores "enable-ssr" — snapshots are per root tree (the root state element aggregates volume data).\`);
    }
    reserveVolumeSlot(rootNode, mountPath, element);
    // ルートが既に居れば今すぐ、まだなら登録時に（volume.ts の adoptVolumesOnRootRegistered）hook を付ける
    getStateElement(rootNode)?.markHasVolume?.();
    ledger.mountPath = mountPath;
    ledger.slotRootNode = rootNode;
  } catch (error) {
    // 設定エラーでも初期化待ちをウェッジさせない（\`_failInitialization\` と同じ規範 —
    // 未解決のまま投げると waitForStateInitialize がページ全体を無言で止める）。
    // ここを \`_failInitializeLoudly\` に載せないのは意図（#257 第 3 ラウンド）:
    // この要素はルートではないので、あちらの「この rootNode にルートは来ない」着地
    //（markBindingsUnavailable / failPendingVolumes）が**無関係なルートと兄弟
    // ボリュームを巻き添えにする**。promise を解決してから raise する点は
    // \`name=\` と同じクラスで、reject 側へ動かすのは別の設計判断
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
    console.error(\`[@wcstack/state] volume "\${mountPath}" failed to load.\`, error);
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
      \`Cannot replace the state of <\${config.tagNames.state} mount="\${mountPath}"> after it has loaded: \` +
      \`a volume's data is copied into the root tree when it grafts, so a new state would never reach the page. \` +
      \`Write the paths under "\${mountPath}" on the root state instead.\`,
    );
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
/** 冪等。full / auto では \`bootstrapState()\` の \`installVolumeGraft()\` が呼ぶ */
export function installVolumeLifecycle(): void {
  if (installed) return;
  installed = true;
  registerLifecycleHooks("scopes", volumeLifecycleHooks);
}

/**
 * D11（設計 §4-7）: ボリュームだけでルートの無いページを無言にしない。
 * 接ぎ木は保留キューで待つ（V5 — ルートが後から来れば成立する）ため throw はせず、
 * 接続内 throw は初期化待ちを永久未解決にする（\`_failInitialization\` の注記と同じ理由）。
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
      \`[@wcstack/state] <\${config.tagNames.state} mount="\${mountPath}"> has no root state tree to graft onto (D11). \` +
      \`A volume mounts onto the root tree — add a root <\${config.tagNames.state}> to this root node \` +
      \`(an empty <\${config.tagNames.state}></\${config.tagNames.state}> is enough). \` +
      \`If the root is added dynamically later, the graft will still complete and this report can be ignored.\`,
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
`);

// 3. the volume feature's install also registers its lifecycle
await patch('src/webComponent/volume.ts', 'installVolumeLifecycle()', [
  [`import { installScopeHooks } from "./addressHooks";\n`, `import { installScopeHooks } from "./addressHooks";\nimport { installVolumeLifecycle } from "./volumeLifecycle";\n`],
  [`  volumeGraftInstalled = true;\n  installScopeHooks();\n`, `  volumeGraftInstalled = true;\n  installScopeHooks();\n  installVolumeLifecycle();\n`],
]);

// 4. the element's internal surface for lifecycle features
await patch('src/components/types.ts', 'connectedRootNode', [
  [`  /** ボリュームがこのルートに予約・接ぎ木された: スコープ機能の hook を付ける（webComponent/addressHooks.ts） */\n  markHasVolume?(): void;\n`,
   `  /** ボリュームがこのルートに予約・接ぎ木された: スコープ機能の hook を付ける（webComponent/addressHooks.ts） */\n  markHasVolume?(): void;\n` +
   `  /**\n   * ライフサイクル機能（core/lifecycleHooks.ts、設計案 H3）へ開く内部面。接続を引き取った機能が\n   * 要素の初期化を所有するために要る最小限で、optional はテスト用モック互換のため。\n   */\n` +
   `  /** いま接続している rootNode（未接続は null）。公開の \`rootNode\` と違い throw しない */\n  readonly connectedRootNode?: Node | null;\n  clearConnectedRootNode?(): void;\n  /** 初期化完了の印（引き取った機能が自分の着地で立てる） */\n  markInitialized?(): void;\n  /** 初期化待ちの 3 つの promise を解決する（未解決のまま投げるとページが無言でウェッジする） */\n  settleInitialization?(): void;\n  /** \`state\` / \`src\` / 内包スクリプトからこの要素のソースを読む */\n  loadStateFromSource?(): Promise<Record<string, any>>;\n`],
]);

// 5. State: the branches leave, the internal surface arrives
await patch('src/components/State.ts', 'runConnecting(this)', [
  // imports: only the two that stay (the failed-root landing of `_failInitializeLoudly`, next slice)
  [`import { callVolumeLifecycle, clearFailedRootNode, failPendingVolumes, graftOrQueueVolume, installVolumeGraft, IVolumeGraftInfo, releaseVolumeSlot, reserveVolumeSlot, validateVolumeMountPath } from "../webComponent/volume";\n`,
   `import { clearFailedRootNode, failPendingVolumes } from "../webComponent/volume";\nimport { requireLifecycleFeature, runConnecting, runDisconnecting, runReconnecting, runReplacingState } from "../core/lifecycleHooks";\n`],
  // the five volume fields become the feature's per-element ledger
  [`  /** ボリューム（mount=）: 接ぎ木済みの控え（$disconnectedCallback 用） */\n  private _volumeGraftInfo: IVolumeGraftInfo | null = null;`,
   `  private _volumeDetachedFrom: Node | null = null;\n`,
   `  // ボリューム（mount=）の控え（接ぎ木情報・枠・再入ガード）は webComponent/volumeLifecycle.ts が\n  // 要素ごとに持つ（設計案 H3 — State はボリュームを知らない）\n`],
  // `_initializeVolume` moves to the feature
  [`  /**\n   * ボリューム（\`<wcs-state mount="path">\`）: 独立ツリーを持たず、ロード完了で`,
   `      () => this._acquireVolumeSlot(graftRootNode),\n    );\n  }\n\n`,
   ``],
  // the slot methods move with it
  [`  /** 控えている枠を返す（#265）。所有者の確認は \`releaseVolumeSlot\` が行う。 */\n  private _releaseVolumeSlot(): void {`,
   `    getStateElement(rootNode)?.markHasVolume?.();\n    this._volumeSlotRootNode = rootNode;\n    return true;\n  }\n\n`,
   ``],
  // connect: a feature claims it, or the barrier names the missing feature
  [`      // ボリューム（\`mount="path"\` — 接ぎ木・docs/state-mount-design.md §4-2）\n      if (this.hasAttribute("mount")) {`,
   `        await this._initializeVolume();\n        return;\n      }\n`,
   `      // この接続を引き取る機能（ボリューム \`mount=\` — webComponent/volumeLifecycle.ts。設計案 H3）。\n` +
   `      // 引き取った機能がこの接続の初期化を所有する（promise を返すのは引き取ったときだけなので、\n` +
   `      // 引き取り手の無い素の state に microtask の境界は増えない）\n` +
   `      const claimed = runConnecting(this);\n` +
   `      if (claimed !== null) {\n` +
   `        await claimed;\n` +
   `        return;\n` +
   `      }\n` +
   `      if (this.hasAttribute("mount")) {\n` +
   `        // 引き取り手の居ない \`mount=\` ＝ スコープ機能が未 install（readiness barrier、H5 / D13）。\n` +
   `        // full / auto では bootstrapState() が install するので起きない\n` +
   `        requireLifecycleFeature("scopes", \`the "mount" attribute\`);\n` +
   `      }\n`],
  // disconnect: the same shape
  [`  disconnectedCallback() {\n    if (this.hasAttribute("mount")) {`,
   `      this._rootNode = null;\n      return;\n    }\n    if (this._mountRecord !== null) {`,
   `  disconnectedCallback() {\n` +
   `    // この切断を引き取る機能（ボリューム — webComponent/volumeLifecycle.ts。設計案 H3）\n` +
   `    if (runDisconnecting(this)) {\n` +
   `      return;\n` +
   `    }\n` +
   `    if (this._mountRecord !== null) {`],
  // the orphan report moves with the feature
  [`/**\n * D11（設計 §4-7）: ボリュームだけでルートの無いページを無言にしない。`,
   `  } else {\n    setTimeout(check, 0);\n  }\n}\n`,
   ``],
  // the internal surface the lifecycle features drive the element through
  [`  get initialized(): boolean {\n    return this._initialized;\n  }\n`,
   `  get initialized(): boolean {\n    return this._initialized;\n  }\n\n` +
   `  /**\n   * ライフサイクル機能（core/lifecycleHooks.ts、設計案 H3）へ開く内部面。接続を引き取った機能が\n   * 要素の初期化を所有するために要る最小限。\n   */\n` +
   `  get connectedRootNode(): Node | null {\n    return this._rootNode;\n  }\n\n` +
   `  clearConnectedRootNode(): void {\n    this._rootNode = null;\n  }\n\n` +
   `  markInitialized(): void {\n    this._initialized = true;\n  }\n\n` +
   `  settleInitialization(): void {\n    this._resolveInitialize?.();\n    this._resolveLoading?.();\n    this._resolveConnectedCallback?.();\n  }\n\n` +
   `  loadStateFromSource(): Promise<Record<string, any>> {\n    return this._loadStateFromSource();\n  }\n`],
  // 初期化済みの要素の再接続も、同じ受け口が引き取る
  [`    } else if (this.hasAttribute("mount")) {\n      // 初期化済みボリュームの再接続（remove → append）: 接ぎ木・アクセサ・宣言は`,
   `      this._resolveConnectedCallback?.();\n      return;\n    } else if (this._mountRecord !== null) {`,
   `    } else if (runReconnecting(this)) {\n` +
   `      // 再接続を引き取った機能（初期化済みボリューム — webComponent/volumeLifecycle.ts。設計案 H3）\n` +
   `      this._resolveConnectedCallback?.();\n      return;\n    } else if (this._mountRecord !== null) {`],
  // state の差し替えを拒む機能（ロード済みボリューム）も受け口へ
  [`    // 読み込み済みのボリューム（#268）: 接ぎ木はロード完了時にデータをルートの木へ一度だけ複製する`,
   `    // D22 と同型の防御: 接ぎ木済みボリューム / マウント記録の居るツリーの丸ごと再 set は、`,
   `    // state の差し替えを拒む機能（ロード済みボリューム #268 — webComponent/volumeLifecycle.ts。設計案 H3）に聞く\n` +
   `    runReplacingState(this);\n` +
   `    // D22 と同型の防御: 接ぎ木済みボリューム / マウント記録の居るツリーの丸ごと再 set は、`],
]);

// 6. test-side: two tests drove the volume through `State` の private メソッド。入口が機能側へ移ったので、
// 同じことをライフサイクル hook の `connecting` で行う（引き取りの返り値がその初期化の promise）
await patch('__tests__/integration.volumeMount.test.ts', 'volumeLifecycleHooks', [
  [`    await expect((el as any)._initializeVolume()).rejects.toThrow(/cannot be combined/);\n`,
   `    const { volumeLifecycleHooks } = await import("../src/webComponent/volumeLifecycle");\n    await expect(volumeLifecycleHooks.connecting!(el as any)).rejects.toThrow(/cannot be combined/);\n`],
  [`    const done = (el as any)._initializeVolume();\n`,
   `    const { volumeLifecycleHooks } = await import("../src/webComponent/volumeLifecycle");\n    const done = volumeLifecycleHooks.connecting!(el as any)!;\n`],
]);
console.log('done');
