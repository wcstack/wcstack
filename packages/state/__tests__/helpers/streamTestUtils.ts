/**
 * __tests__/helpers/streamTestUtils.ts
 *
 * stream.*.test.ts 統合テスト共通の非同期駆動・ホスト組み立てヘルパ。
 * stream.lifecycle / stream.companion / stream.restart / stream.namespaceResolution
 * で重複していた flushAsync / waitFor / connectHost の共通化（挙動不変のリファクタ。
 * connectHost はホストタグ名プレフィックスだけがファイル間差分だったため、
 * プレフィックスを引数化したファクトリ makeConnectHost として抽出）。
 *
 * State は型としてのみ参照する（import type）。ランタイム依存を持たないため、
 * consumeSource 等の純粋な単体テストからも flushAsync だけを軽量に import できる。
 * connectHost を使う側は bootstrapState() 済み（<wcs-state> 定義済み）であること。
 */

import type { State } from "../../src/components/State";
import type { IState } from "../../src/types";

/** マイクロタスクを出し切る（updater の drain と consume ループの双方を進める） */
export const flushAsync = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

/** 条件成立までマクロタスクを進める（再接続の connectedCallback 完了待ちなど） */
export async function waitFor(cond: () => boolean, tries = 20): Promise<void> {
  for (let i = 0; i < tries && !cond(); i++) {
    await flushAsync();
  }
}

export interface IConnectedStreamHost {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  stateEl: State;
}

/**
 * ShadowRoot 内に <wcs-state> と任意のマークアップを持つホストを組み立てて接続する
 * connectHost を、ホストタグ名プレフィックスを固定して払い出すファクトリ。
 * ShadowRoot 単位で state 名前空間と binding 構築が閉じるため、テスト間で干渉しない
 * （プレフィックスはテストファイルごとに一意にする）。
 */
export function makeConnectHost(
  tagPrefix: string,
): (markup: string, initialState: IState) => Promise<IConnectedStreamHost> {
  let hostSeq = 0;
  return async function connectHost(
    markup: string,
    initialState: IState,
  ): Promise<IConnectedStreamHost> {
    const host = document.createElement(`${tagPrefix}-${++hostSeq}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `${markup}<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState(initialState);
    await stateEl.connectedCallbackPromise;
    return { host, shadowRoot, stateEl };
  };
}
