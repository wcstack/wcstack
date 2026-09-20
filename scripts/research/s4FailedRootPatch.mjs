// S4, seventh slice: the failed-root landing. When a root `<wcs-state>` fails to initialize, the
// volumes waiting for that root must be told (they would otherwise wait forever), and when the
// failed element itself leaves the DOM the mark must be cleared. Those were the last two calls
// from `State` into the volume feature. Two receptacles replace them — `initializeFailed` and
// `initializeFailureCleared` — and the core keeps only what is its own (`markBindingsUnavailable`).
// Applied to a sandbox copy carrying S3's three slices and S4's first six; anchors must match once.
//   node scripts/research/s4FailedRootPatch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: s4FailedRootPatch.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const [anchor, replacement] of edits) {
    const count = code.split(anchor).length - 1;
    if (count !== 1) throw new Error(`${rel}: anchor found ${count} times: ${anchor.slice(0, 70)}`);
    code = code.replace(anchor, () => replacement);
  }
  await writeFile(file, code);
  console.log('patched', rel);
}

// 1. two receptacles for the failed-root landing
await patch('src/core/lifecycleHooks.ts', 'InitializeFailedHook', [
  [`/** state の差し替えを拒むなら throw する（拒まないなら何もしない） */\n`,
   `/** ルート要素の初期化が失敗した（このルートノードを待っている機能に知らせる） */\nexport type InitializeFailedHook = (element: IStateElement, rootNode: Node, error: unknown) => void;\n/** 失敗したルート要素自身が DOM から消えた（「このルートにルートは来ない」はもう成り立たない） */\nexport type InitializeFailureClearedHook = (element: IStateElement, rootNode: Node) => void;\n/** state の差し替えを拒むなら throw する（拒まないなら何もしない） */\n`],
  [`  readonly replacingState?: ReplacingStateHook;\n`,
   `  readonly replacingState?: ReplacingStateHook;\n  readonly initializeFailed?: InitializeFailedHook;\n  readonly initializeFailureCleared?: InitializeFailureClearedHook;\n`],
  [`/** 切断を引き取る機能を探す。引き取られたら true（core の後始末は走らない） */\n`,
   `export function runInitializeFailed(element: IStateElement, rootNode: Node, error: unknown): void {\n  for (let i = 0; i < ordered.length; i++) {\n    ordered[i].initializeFailed?.(element, rootNode, error);\n  }\n}\n\nexport function runInitializeFailureCleared(element: IStateElement, rootNode: Node): void {\n  for (let i = 0; i < ordered.length; i++) {\n    ordered[i].initializeFailureCleared?.(element, rootNode);\n  }\n}\n\n/** 切断を引き取る機能を探す。引き取られたら true（core の後始末は走らない） */\n`],
]);

// 2. the volume feature answers both
await patch('src/webComponent/volumeLifecycle.ts', 'initializeFailed(', [
  [`import { callVolumeLifecycle, graftOrQueueVolume, IVolumeGraftInfo, releaseVolumeSlot, reserveVolumeSlot, validateVolumeMountPath } from "./volume";\n`,
   `import { callVolumeLifecycle, clearFailedRootNode, failPendingVolumes, graftOrQueueVolume, IVolumeGraftInfo, releaseVolumeSlot, reserveVolumeSlot, validateVolumeMountPath } from "./volume";\n`],
  [`  disconnecting(element) {\n`,
   `  initializeFailed(_element, rootNode) {\n    // このルートノードにルートは来ない: 保留中のボリュームを待たせ続けない（#257）\n    failPendingVolumes(rootNode);\n  },\n  initializeFailureCleared(_element, rootNode) {\n    // 落ちたルート要素**本人**が DOM から消えた ＝「このルートノードにルートは来ない」はもう\n    // 成り立たない（作者の復旧は取り除いて作り直す）。印が残ると、外してから修正版を接続する\n    // までの窓で接続したボリュームが即座に孤児化する\n    clearFailedRootNode(rootNode);\n  },\n  disconnecting(element) {\n`],
]);

// 3. State keeps only what is its own
await patch('src/components/State.ts', 'runInitializeFailed(this', [
  [`import { clearFailedRootNode, failPendingVolumes } from "../webComponent/volume";\n`, ``],
  [`import { requireLifecycleFeature, runConnecting, runDisconnecting, runPreparing, runReconnecting, runReplacingState } from "../core/lifecycleHooks";\n`,
   `import { requireLifecycleFeature, runConnecting, runDisconnecting, runInitializeFailed, runInitializeFailureCleared, runPreparing, runReconnecting, runReplacingState } from "../core/lifecycleHooks";\n`],
  [`      markBindingsUnavailable(this._rootNode, error);\n      failPendingVolumes(this._rootNode);\n`,
   `      markBindingsUnavailable(this._rootNode, error);\n      // このルートを待っている機能（保留中のボリューム）に知らせる（設計案 H3）\n      runInitializeFailed(this, this._rootNode, error);\n`],
  [`          clearFailedRootNode(this._rootNode);\n`,
   `          runInitializeFailureCleared(this, this._rootNode);\n`],
]);
console.log('done');
