/**
 * bridge/featureBridge.ts — 機能どうしの受け口（要件 B13 / 配線設計 §7-1 の延長）。
 *
 * `core/*Hooks.ts` が「core → 機能」の受け口なのに対し、ここは **機能 → 別の機能** の受け口。
 * 分割エントリ（`@wcstack/state/features/*`）は 1 つの core チャンクを共有するが、機能どうしの
 * 静的 import は共有チャンクを作ってしまい、片方だけを入れたページがもう片方のコードごと
 * ダウンロードすることになる（実測: `features/scopes` → `watch/watchRuntime` の 1 本で
 * temporal ランタイムのほぼ全部、5.3 KB gzip が scopes に乗っていた）。
 *
 * 置く側は自分の `install()` で登録し、読む側は「無ければ何もしない / 名指しで落ちる」。
 * full（`@wcstack/state`）と `/auto` では `bootstrapState()` が全機能を入れるので挙動は変わらない。
 *
 * **このディレクトリはどの機能のものでもない**（`scripts/check-state-split.mjs` が
 * feature 間のコード混入を見るときの中立領域）。置けるのは受け口そのものだけで、
 * 実装は必ず機能側に置くこと。
 */
import type { IStateElement } from "../components/types";
import { featureNotInstalledMessage } from "../core/featureEntries";
import { raiseError } from "../raiseError";
import type { IWatchEntry } from "../watch/types";
import type { IMountOverlaySummary } from "../devtools/types";

/**
 * ボリュームの `$watch` 接頭辞登録（`scopes` が読み・`temporal` が置く）。
 * ボリュームの state は `State._state` セッターを通らない（`loadStateFromSource` の戻り値を
 * そのまま接ぎ木する）ので、宣言の readiness barrier もここで張る。
 */
export interface IVolumeWatchSupport {
  /** `$watch` のキーがパスとして妥当か（`watch/processWatchDeclaration.assertValidWatchPath`） */
  readonly assertValidPath: (path: string) => void;
  /** 翻訳済みの entry をルートの台帳へ追記する（`watch/watchRegistry.addVolumeWatchEntries`） */
  readonly addEntries: (stateElement: IStateElement, entries: readonly IWatchEntry[]) => void;
  /** 発火対象として起動する（`watch/watchRuntime.startWatch`） */
  readonly start: (stateElement: IStateElement) => void;
}

let volumeWatchSupport: IVolumeWatchSupport | null = null;

/** `temporal` の install（`installWatchRuntime`）が呼ぶ。冪等 */
export function setVolumeWatchSupport(support: IVolumeWatchSupport): void {
  volumeWatchSupport = support;
}

/**
 * ボリュームが `$watch` を宣言していたときだけ呼ぶ。`temporal` が未 install のページは
 * 黙って素通りさせず、他の宣言の barrier（要件 D13）と同じ文言で落とす。
 */
export function requireVolumeWatchSupport(mountPath: string): IVolumeWatchSupport {
  return volumeWatchSupport
    ?? raiseError(featureNotInstalledMessage("watch", `"$watch" in <wcs-state mount="${mountPath}">`));
}

/** マウントのオーバーレイ要約（`devtools` が読み・`scopes` が置く）。未 install なら空。 */
export type MountOverlayProvider = (stateElement: IStateElement) => IMountOverlaySummary[];

let mountOverlayProvider: MountOverlayProvider | null = null;

/** `scopes` の install（`installScopeHooks`）が呼ぶ。冪等 */
export function setMountOverlayProvider(provider: MountOverlayProvider): void {
  mountOverlayProvider = provider;
}

const NO_OVERLAYS: IMountOverlaySummary[] = [];

/** スコープ機能の入っていないページにマウントは存在しえないので、空で正しい */
export function getMountOverlays(stateElement: IStateElement): IMountOverlaySummary[] {
  return mountOverlayProvider === null ? NO_OVERLAYS : mountOverlayProvider(stateElement);
}

/** テスト用: 受け口を空へ戻す（barrier / 未 install の形を再現する）。 */
export function __resetFeatureBridgeForTest(): void {
  volumeWatchSupport = null;
  mountOverlayProvider = null;
}
