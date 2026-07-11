/**
 * stream.dcc.test.ts
 *
 * DCC（data-wc-definition）× `$streams` の特性化テスト（設計正本 §7-2）。
 *
 * 固定する現挙動:
 * - **DCC 定義要素**（`data-wc-definition` を持つホスト内の `<wcs-state>`）は
 *   `_initializeDCC` 経路で `_state` セッターを通らないため、`$streams` 宣言は
 *   パースも起動もされない（宣言があっても無視される）。
 * - **DCC インスタンス内の `<wcs-state>`**（defineDCC が template 化した定義の
 *   clone）は通常経路（`_initialize` → `_state` セッター =
 *   processStreamsDeclaration → connectedCallback の startStreams）を通り、
 *   `$streams` はインスタンスごとに独立して起動・切断される。
 *
 * loadFromInnerScript は動的 import（happy-dom では実行不可）のためモックし、
 * 呼び出しごとに新しい state オブジェクト＋fake source を払い出す
 * （dcc.State.test.ts のモック流儀）。定義ホストは dcc.State.test.ts と同じく
 * detached のまま connectedCallback を直接呼ぶ（インスタンス側は実際に
 * document へ接続して custom element upgrade 経由の実経路を通す）。
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("../src/stateLoader/loadFromInnerScript", () => ({
  loadFromInnerScript: vi.fn(),
}));

import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { loadFromInnerScript } from "../src/stateLoader/loadFromInnerScript";
import { getActiveStateElements } from "../src/stream/activeStateElements";
import { getStreamEntries } from "../src/stream/streamRegistry";
import type { IState } from "../src/types";
import { makeManualAsyncGenerator } from "./helpers/fakeStreamSources";
import { flushAsync } from "./helpers/streamTestUtils";

const loadFromInnerScriptMock = vi.mocked(loadFromInnerScript);

beforeAll(() => {
  bootstrapState();
});

interface IStreamStateRecord {
  state: IState;
  source: ReturnType<typeof vi.fn>;
  m: ReturnType<typeof makeManualAsyncGenerator<string>>;
}

/**
 * loadFromInnerScript を「呼び出しごとに $streams 宣言入りの新しい state を返す」
 * 実装に差し替え、払い出した state / source / manual generator の記録を返す。
 */
function installStreamStateLoader(): IStreamStateRecord[] {
  const records: IStreamStateRecord[] = [];
  loadFromInnerScriptMock.mockReset(); // 呼び出し回数をテスト間で累積させない
  loadFromInnerScriptMock.mockImplementation(async () => {
    const m = makeManualAsyncGenerator<string>();
    const source = vi.fn(() => m.iterable);
    const state: IState = {
      $streams: {
        tokens: {
          source,
          fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
          initial: "",
        },
      },
    };
    records.push({ state, source, m });
    return state;
  });
  return records;
}

/**
 * data-wc-definition 付きホスト（ShadowRoot 内に inline script 持ちの <wcs-state>）
 * を detached で組み立てる。script の中身はモック済みローダーが読まないため空でよい。
 */
function buildDefinitionHost(tagName: string): { defHost: HTMLElement; defStateEl: State } {
  const defHost = document.createElement(tagName);
  defHost.setAttribute("data-wc-definition", "");
  const defShadow = defHost.attachShadow({ mode: "open" });
  const defStateEl = document.createElement("wcs-state") as State;
  const script = document.createElement("script");
  script.setAttribute("type", "module");
  defStateEl.appendChild(script);
  defShadow.appendChild(defStateEl);
  return { defHost, defStateEl };
}

describe("DCC × $streams の特性化（設計正本 §7-2）", () => {
  it("DCC 定義要素の <wcs-state> では $streams が無視されること（_initializeDCC 経路は _state セッターを通らない）", async () => {
    const records = installStreamStateLoader();
    const { defStateEl } = buildDefinitionHost("x-stream-dcc-def");

    await defStateEl.connectedCallback();
    await defStateEl.connectedCallbackPromise;

    // 定義は defineDCC に渡り custom element は登録されるが、
    // 定義側の <wcs-state> に対しては $streams のパース（registry 登録）も
    // 起動（activeStateElements 登録・source 呼び出し）も行われない
    expect(customElements.get("x-stream-dcc-def")).toBeDefined();
    expect(loadFromInnerScriptMock).toHaveBeenCalledTimes(1);
    expect(getStreamEntries(defStateEl).size).toBe(0);
    expect(getActiveStateElements().has(defStateEl)).toBe(false);
    expect(records[0].source).not.toHaveBeenCalled();
    // 値プロパティの実体化（§1-3）も行われない（processStreamsDeclaration 未到達）
    expect("tokens" in records[0].state).toBe(false);
  });

  it("DCC インスタンス内の <wcs-state> では $streams が通常経路で起動し、インスタンスの切断で止まること", async () => {
    const records = installStreamStateLoader();
    const { defStateEl } = buildDefinitionHost("x-stream-dcc-inst");
    await defStateEl.connectedCallback();
    await defStateEl.connectedCallbackPromise;
    expect(records[0].source).not.toHaveBeenCalled(); // 定義側は起動しない（前テストと同じ機序）

    // インスタンス生成: defineDCC が clone する template 内の <wcs-state> は
    // 通常経路（_initialize → _state セッター → startStreams）を通る
    const instance = document.createElement("x-stream-dcc-inst");
    document.body.appendChild(instance);
    const instStateEl = (instance as HTMLElement & { stateElement: State | null }).stateElement;
    expect(instStateEl).not.toBeNull();
    await instStateEl!.connectedCallbackPromise;

    expect(loadFromInnerScriptMock).toHaveBeenCalledTimes(2); // 定義 + インスタンス
    const entry = getStreamEntries(instStateEl!).get("tokens")!;
    expect(entry).toBeDefined();
    expect(entry.status).toBe("active");
    expect(getActiveStateElements().has(instStateEl!)).toBe(true);
    expect(records[1].source).toHaveBeenCalledTimes(1);
    expect(records[1].state.tokens).toBe(""); // initial で起動（§1-3 / §2-2）

    // チャンクは通常どおり fold されインスタンスの state に反映される
    records[1].m.push("a");
    records[1].m.push("b");
    await flushAsync();
    expect(records[1].state.tokens).toBe("ab");

    // インスタンスの切断で abort → idle（ライフサイクル所有権は通常どおり、§5-1）
    instance.remove();
    expect(entry.status).toBe("idle");
    expect(entry.controller).toBeNull();
    expect(getActiveStateElements().has(instStateEl!)).toBe(false);
    // 定義側の source は最後まで呼ばれない
    expect(records[0].source).not.toHaveBeenCalled();
  });
});
