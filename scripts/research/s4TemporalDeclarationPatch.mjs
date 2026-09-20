// S4, second slice (wiring design §3 H4, §8): the declaration receptacle, applied to the temporal
// features `$streams` and `$watch`. The `_state` setter is the most order-sensitive code in the
// package (its own comments say which validations run before and after the generation bump, and
// `integration.stateGenerationReset.test.ts` pins each one), so the receptacle is a set of PHASES,
// not one "walk the reserved keys" call: `apply` (after the new getterPaths / setterPaths are
// collected), `register` (after `_rebuildPathInfo` and `$scan`'s dependency registration),
// `activate` (a re-set while connected, and the tail of a connect) and `deactivate` (disconnect).
// Features are asked in ascending `order` for apply / register / activate and in DESCENDING order
// for deactivate, which is what keeps "watch is enabled before streams, and torn down after them".
// `$scan` deliberately stays in the core for now: its validation runs BEFORE the generation bump and
// needs two values other features produce (`$eventTokens`'s names and the recursion registry), so it
// needs a per-set context bag between features — the next slice's problem, recorded in §8-4.
// Applied to a sandbox copy of packages/state that carries the three S3 slices and S4's first;
// every anchor must match exactly once.
//   node scripts/research/s4TemporalDeclarationPatch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: s4TemporalDeclarationPatch.mjs <sandbox>/packages/state');
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
await writeOnce('src/core/declarationHooks.ts', `/**
 * core/declarationHooks.ts — 宣言の受け口（設計案 H4、S4）。
 *
 * \`_state\` セッターはこのパッケージで最も順序に敏感なコードで、どの検証が世代を進める前に走り
 * どれが後かがそのままテスト（\`integration.stateGenerationReset.test.ts\`）で固定されている。
 * だから受け口は「予約キーを走査して handler に渡す」1 点ではなく、**段（phase）**にした。
 * 機能は自分が要る段だけ実装し、core は各段を従来の分岐があった位置で呼ぶ。
 *
 *   apply       新しい getterPaths / setterPaths の収集後（\`$streams\` の衝突検査がそれを見る）
 *   register    \`_rebuildPathInfo\` と \`$scan\` の登録の後（依存グラフへの登録）
 *   activate    接続中の再 set と、接続の末尾（起動の可否と二重起動ガードは機能側が持つ）
 *   deactivate  切断
 *
 * apply / register / activate は \`order\` の昇順、**deactivate は降順**で聞く。
 * これが「watch は stream より先に起動し、後に停止する」を番号だけで保つ
 * （従来 \`State\` に直書きされていた順序契約）。
 */
import type { IStateElement } from "../components/types";
import type { IState } from "../types";

export interface IDeclarationHooks {
  /** 聞く順（watch 10 → streams 20。deactivate はこの逆順） */
  readonly order: number;
  readonly apply?: (element: IStateElement, value: IState) => void;
  readonly register?: (element: IStateElement, value: IState) => void;
  /**
   * \`captured\` が null なら \`_state\` セッターからの起動（接続中の再 set）、
   * 数値なら接続の末尾からの起動で、その接続で捕捉した世代（陳腐な connect の再開を弾く）。
   */
  readonly activate?: (element: IStateElement, captured: number | null) => void;
  readonly deactivate?: (element: IStateElement) => void;
}

const registry = new Map<string, IDeclarationHooks>();
let ordered: IDeclarationHooks[] = [];
let reversed: IDeclarationHooks[] = [];

/** 機能の install が呼ぶ（冪等） */
export function registerDeclarationHooks(feature: string, hooks: IDeclarationHooks): void {
  registry.set(feature, hooks);
  ordered = Array.from(registry.values()).sort((a, b) => a.order - b.order);
  reversed = ordered.slice().reverse();
}

export function isDeclarationFeatureRegistered(feature: string): boolean {
  return registry.has(feature);
}

export function runApply(element: IStateElement, value: IState): void {
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].apply?.(element, value);
  }
}

export function runRegister(element: IStateElement, value: IState): void {
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].register?.(element, value);
  }
}

export function runActivate(element: IStateElement, captured: number | null): void {
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].activate?.(element, captured);
  }
}

/** 停止は起動の逆順（stream を止めてから watch を外す） */
export function runDeactivate(element: IStateElement): void {
  for (let i = 0; i < reversed.length; i++) {
    reversed[i].deactivate?.(element);
  }
}
`);

// 2. watch owns its declaration and its activation (order 10: enabled before streams, torn down after)
await patch('src/watch/watchRuntime.ts', 'watchDeclarationHooks', [
  [`import { clearPrevValues, getPrevValue } from "./prevValues";\n`,
   `import { clearPrevValues, getPrevValue } from "./prevValues";\nimport { IDeclarationHooks, registerDeclarationHooks } from "../core/declarationHooks";\nimport { STATE_SCAN_NAME, STATE_WATCH_NAME } from "../define";\nimport { inSsr } from "../config";\nimport { clearComputedSnapshots } from "./computedSnapshots";\nimport { processWatchDeclaration } from "./processWatchDeclaration";\nimport { clearWatchRegistry, deactivateWatch } from "./watchRegistry";\n`],
  [`export const __private__ = {\n`,
   `/**
 * \`$watch\` の宣言とライフサイクル（設計案 H4）。従来 \`State\` の \`_state\` セッターと
 * connectedCallback / disconnectedCallback に直書きされていた分岐で、順序の理由は各所に残した。
 */
export const watchDeclarationHooks: IDeclarationHooks = {
  // stream より先に起動し、後に停止する（受け口が deactivate を逆順で回す）
  order: 10,
  register(element, value) {
    // $watch: 旧宣言のハンドラが残らないよう registry を落としてから新宣言を解析する。
    // _pathSet.clear() の後であること（依存グラフ登録をやり直す必要がある、
    // docs/state-watch-hook-design.md §8）。宣言が無ければ watchPaths は null で、
    // setByAddress の旧値キャプチャには一切入らない（§10 のゼロコスト契約）。
    clearWatchRegistry(element);
    // computed の前回評価値も宣言と寿命を共にする（旧宣言の値を新しい watch の
    // prev として渡さない）。切断では消さない — 再接続の初回評価が上書きする。
    clearComputedSnapshots(element);
    const watchPaths = processWatchDeclaration(element, value);
    element.setWatchPaths?.(watchPaths);
    if (watchPaths !== null || element.scanPaths != null) {
      // 旧値の台帳（\`$watch\` の prev・\`$scan\` の from）は watch 機能の hook が書き込み時に記録する
      element.attachAddressHooks?.("watch", watchPaths !== null ? STATE_WATCH_NAME : STATE_SCAN_NAME);
    }
  },
  activate(element, captured) {
    // SSR では走らせない — ハンドラの副作用がサーバとクライアントで二重に実行されるため
    // （docs/state-watch-hook-design.md §11）。rootNode ガード: \$connectedCallback の await 中に
    // 切断された場合は起動しない。世代ガード（接続末尾のみ）: await 中に「切断 → 即再接続」された
    // 場合、新 connect が rootNode を再設定済みでガードを素通りするため、世代不一致で陳腐化した
    // connect の再開を検出して skip する。
    // 再入不要: 接続中の再 set は下の宣言側で startWatch 済みだが、startWatch は Set への add で
    // 冪等なので \$streams のような世代ガードは要らない。
    if (inSsr() || element.connectedRootNode == null) {
      return;
    }
    if (captured === null ? element.initialized !== true : captured !== element.connectGeneration) {
      return;
    }
    startWatch(element);
  },
  deactivate(element) {
    // watch は発火対象から外すだけで registry は保持する（stream の abortAllStreams と
    // 同じ二段構え、設計書 §9）。registry まで捨てると、_state セッターが再度走らない
    // 再接続で宣言を作り直せず watch が二度と発火しない。
    deactivateWatch(element);
  },
};

export const __private__ = {\n`],
  [`  watchRuntimeInstalled = true;\n  registerFeatureHooks("watch", watchAddressHooks);\n`,
   `  watchRuntimeInstalled = true;\n  registerFeatureHooks("watch", watchAddressHooks);\n  registerDeclarationHooks("watch", watchDeclarationHooks);\n`],
]);

// 3. streams the same (order 20), carrying their own double-start generation ledger
await patch('src/stream/streamRuntime.ts', 'streamDeclarationHooks', [
  [`import { registerFeatureHooks } from "../core/addressHooks";\n`,
   `import { registerFeatureHooks } from "../core/addressHooks";\nimport { IDeclarationHooks, registerDeclarationHooks } from "../core/declarationHooks";\nimport { STATE_STREAMS_NAME } from "../define";\nimport { inSsr } from "../config";\nimport { processStreamsDeclaration } from "./processStreamsDeclaration";\nimport { clearStreamNamespace } from "./streamNamespace";\nimport { abortAllStreams, clearStreamRegistry } from "./streamRegistry";\n`],
  [`export function installStreamRuntime(): void {\n`,
   `/**
 * \`_state\` セッター側の startStreams が走った connect 世代（接続末尾の startStreams との
 * 二重起動防止、設計書 §2-3。世代が進めば不一致となり自然に無効化される — サイクル単位の
 * フラグリセット相当）。従来 \`State\` の private フィールドだった。
 */
const startedGenerationByElement = new WeakMap<IStateElement, number>();

/**
 * \`$streams\` の宣言とライフサイクル（設計案 H4）。
 */
export const streamDeclarationHooks: IDeclarationHooks = {
  // watch の後に起動し、先に停止する（受け口が deactivate を逆順で回す）
  order: 20,
  apply(element, value) {
    // $streams: 再 set 時の二重起動防止のため旧 stream を abort ＋ registry 全削除してから
    // 新宣言をパースする（clearEventTokenRegistry → processOnDeclaration と同じ再配線パターン）。
    // getterPaths / setterPaths の収集後であること（宣言バリデーションが衝突検査で参照する）。
    // namespace proxy の memo も破棄して古い proxy を捨てる（clearCommandNamespace と対称）。
    clearStreamNamespace(element);
    clearStreamRegistry(element);
    processStreamsDeclaration(element, value);
    // hook は要素の寿命の間は付いたまま（再 set で \$streams が消えても、残った \$streamStatus /
    // \$streamError の束縛は名前空間の null を読む — 従来の core 直結と同じ振る舞い）
    if (typeof (value as Record<string, unknown>)[STATE_STREAMS_NAME] !== "undefined") {
      element.attachAddressHooks?.("streams", STATE_STREAMS_NAME);
    }
  },
  activate(element, captured) {
    // rootNode ガード: \$connectedCallback の await 中に切断された場合は起動しない。ガードなしだと
    // startStream 内の createState が rootNode 解決の raiseError で throw し、
    // connectedCallbackPromise が永遠に未解決になる（「未接続の entry は restart しない」設計書 §3-2）。
    if (inSsr() || element.connectedRootNode == null) {
      return;
    }
    if (captured === null) {
      // 接続中の再 set（S13）: 新宣言で即再起動する。初回（初期化中）は起動せず、接続の末尾が担う
      if (element.initialized !== true) {
        return;
      }
      startStreams(element);
      // \$connectedCallback 実行中の再 set（setInitialState）では、ここで新宣言が起動済みのため
      // 接続末尾の startStreams を skip させる。skip しないと同一 connect サイクルで新宣言の
      // source が 2 回起動する（1 回目は即 abort — switchMap 意味論で状態は壊れないが、
      // 副作用を持つ source が 2 回発火してしまう）
      startedGenerationByElement.set(element, element.connectGeneration ?? 0);
      return;
    }
    // 接続の末尾: 世代ガード（陳腐な connect の再開を弾く）と、宣言側で起動済みの世代を skip する
    if (captured !== element.connectGeneration || startedGenerationByElement.get(element) === captured) {
      return;
    }
    startStreams(element);
  },
  deactivate(element) {
    // stream は abort のみで registry は保持する（再接続時に同じ宣言から initial で
    // 再起動できる、設計書 §5-1 / §5-2）。namespace proxy の memo は破棄する
    // （clearCommandNamespace と対称。registry は残るため再接続後の初回アクセスで
    // 同内容の proxy が再生成される）。
    abortAllStreams(element);
    clearStreamNamespace(element);
  },
};

export function installStreamRuntime(): void {\n`],
  [`  streamRuntimeInstalled = true;\n  registerFeatureHooks("streams", streamAddressHooks);\n`,
   `  streamRuntimeInstalled = true;\n  registerFeatureHooks("streams", streamAddressHooks);\n  registerDeclarationHooks("streams", streamDeclarationHooks);\n`],
]);

// 4. the element's internal surface grows by two
await patch('src/components/types.ts', 'connectGeneration', [
  [`  /** \`state\` / \`src\` / 内包スクリプトからこの要素のソースを読む */\n  loadStateFromSource?(): Promise<Record<string, any>>;\n`,
   `  /** \`state\` / \`src\` / 内包スクリプトからこの要素のソースを読む */\n  loadStateFromSource?(): Promise<Record<string, any>>;\n` +
   `  /** 接続の世代（接続の末尾の起動が、陳腐化した connect の再開を弾くために照合する） */\n  readonly connectGeneration?: number;\n` +
   `  /** \`$watch\` / ボリュームの合流が決めた監視パス（setByAddress の旧値キャプチャのゲート） */\n  setWatchPaths?(paths: ReadonlySet<string> | null): void;\n`],
]);

// 5. State: the declarations and the start/stop leave
await patch('src/components/State.ts', 'runApply(this, value)', [
  [`import { processStreamsDeclaration } from "../stream/processStreamsDeclaration";\n`, ``],
  [`import { clearStreamNamespace } from "../stream/streamNamespace";\n`, ``],
  [`import { abortAllStreams, clearStreamRegistry } from "../stream/streamRegistry";\n`, ``],
  [`import { installStreamRuntime, startStreams } from "../stream/streamRuntime";\n`, ``],
  [`import { processWatchDeclaration } from "../watch/processWatchDeclaration";\n`, ``],
  [`import { clearComputedSnapshots } from "../watch/computedSnapshots";\n`, ``],
  [`import { clearWatchRegistry, deactivateWatch } from "../watch/watchRegistry";\n`, ``],
  [`import { installWatchRuntime, startWatch } from "../watch/watchRuntime";\n`,
   `import { runActivate, runApply, runDeactivate, runRegister } from "../core/declarationHooks";\n`],
  [`import { STATE_STREAMS_NAME as STATE_STREAMS_DECLARATION, STATE_RECURSION_NAME, STATE_WATCH_NAME, STATE_SCAN_NAME, STATE_BINDABLES_NAME } from "../define";\n`,
   `import { STATE_RECURSION_NAME, STATE_WATCH_NAME, STATE_BINDABLES_NAME } from "../define";\n`],
  // the double-start generation is the stream feature's bookkeeping now
  [`  // _state セッター側の startStreams が走った connect 世代\n`,
   `  private _streamsStartedGeneration: number = 0;\n`,
   ``],
  // apply: `$streams` needs the freshly collected getterPaths / setterPaths
  [`    // $streams: 再 set 時の二重起動防止のため旧 stream を abort ＋ registry 全削除してから\n`,
   `      this.attachAddressHooks("streams", STATE_STREAMS_DECLARATION);\n    }\n`,
   `    // 宣言の反映（設計案 H4 の apply）: パス収集の後に走る段。\`$streams\` の衝突検査が\n` +
   `    // 新しい getterPaths / setterPaths を見るので、この位置でなければならない（stream/streamRuntime.ts）\n` +
   `    runApply(this, value);\n`],
  // register: after `_rebuildPathInfo` and `$scan`'s registration
  [`    // $watch: 旧宣言のハンドラが残らないよう registry を落としてから新宣言を解析する。\n`,
   `      this.attachAddressHooks("watch", this._watchPaths !== null ? STATE_WATCH_NAME : STATE_SCAN_NAME);\n    }\n`,
   `    // 依存グラフ登録の段（設計案 H4 の register）: \`_rebuildPathInfo\` と \`$scan\` の登録の後。\n` +
   `    // \`$watch\` はここで宣言を解析し直す（watch/watchRuntime.ts）\n` +
   `    runRegister(this, value);\n`],
  // activate from the setter (a re-set while connected)
  [`    // 接続中の再 set（S13）は新宣言で即再起動する。\n`,
   `      this._streamsStartedGeneration = this._connectGeneration;\n    }\n`,
   `    // 接続中の再 set（S13）は新宣言で即再起動する（設計案 H4 の activate）。起動の可否・\n` +
   `    // 二重起動ガード・SSR の除外は機能側が持つ。初回（_initialize 中）は初期化前なので\n` +
   `    // ここでは起動されず、接続の末尾の activate が担う\n` +
   `    runActivate(this, null);\n`],
  // activate at the tail of a connect
  [`    // _rootNode ガード: $connectedCallback の await 中に切断された場合は起動しない。\n`,
   `      startStreams(this);\n    }\n`,
   `    // $connectedCallback 完了後の起動（設計案 H4 の activate）。捕捉した世代を渡し、\n` +
   `    // 「切断 → 即再接続」で陳腐化した connect の再開からの起動は機能側が弾く\n` +
   `    runActivate(this, connectGeneration);\n`],
  // deactivate on disconnect
  [`        // stream は abort のみで registry は保持する（再接続時に同じ宣言から\n`,
   `        deactivateWatch(this);\n`,
   `        // 機能の停止（設計案 H4 の deactivate。起動の逆順 — stream を止めてから watch を外す）\n` +
   `        runDeactivate(this);\n`],
  // the root's merged volume watch paths only need the hooks attached (install is bootstrapState's)
  [`    // ルートが \`$watch\` を宣言していなくても、合流した watch パスの旧値は同じ hook が記録する\n    installWatchRuntime();\n`,
   `    // ルートが \`$watch\` を宣言していなくても、合流した watch パスの旧値は同じ hook が記録する\n`],
  // the internal surface
  [`  loadStateFromSource(): Promise<Record<string, any>> {\n    return this._loadStateFromSource();\n  }\n`,
   `  loadStateFromSource(): Promise<Record<string, any>> {\n    return this._loadStateFromSource();\n  }\n\n` +
   `  get connectGeneration(): number {\n    return this._connectGeneration;\n  }\n\n` +
   `  setWatchPaths(paths: ReadonlySet<string> | null): void {\n    this._watchPaths = paths;\n  }\n`],
]);
console.log('done');
