/**
 * integration.volumeSlotRelease.test.ts — `<wcs-state mount="…">` のマウントの枠の寿命（#265）。
 *
 * 旧挙動: 枠の台帳（webComponent/volumeShared.ts）は予約するだけで手放す経路が無かった。
 * 接ぎ木しないまま終わったボリューム（ロード中に外れた・孤児・ロード失敗・接ぎ木失敗）も枠を
 * rootNode が生きている限り握り続け、同じマウントパスで作り直した要素は "already mounted" で
 * 弾かれた（その throw は promise を待つ側に届かず、作者に見えるのは「データが現れない」だけ）。
 * 復旧はページの読み直ししか無かった。
 *
 * 契約（1 本ずつ固定する）:
 *  - 手放すのは**所有者が一致するときだけ**。予約した要素が自分で控えた (rootNode, mountPath) を
 *    渡し、台帳は予約した要素と突き合わせる — 死んだ要素の後始末が生きている要素の枠を奪わない。
 *  - 手放すのは持ち主だけで、読みの寛容（予約下の読みは undefined）は残る。
 *  - 接ぎ木しないまま決着したボリュームは枠を手放す（孤児・ロード失敗・接ぎ木失敗）。
 *  - ロード中（ルート待ちの保留中を含む）に外れたボリュームは、外れた時点で枠を手放す。決着前に
 *    付け直せば取り直して接ぎ木する。外れている間に別の要素が枠を取っていれば横取りせず、
 *    報告を 1 件出して接ぎ木しない。
 *  - 接ぎ木済みのボリュームは外しても枠を握ったまま（データはツリーに残る）。
 *
 * 枠を手放したかは「別の要素が同じマウントパスを予約・接ぎ木できるか」で見る。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { isPathUnderReservedVolume, releaseVolumeSlot, reserveVolumeSlot } from "../src/webComponent/volume";

beforeAll(() => {
  bootstrapState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

let seq = 0;
const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve));

const makeHost = (): { host: HTMLElement; shadowRoot: ShadowRoot } => {
  const host = document.createElement(`volslot-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  document.body.appendChild(host);
  return { host, shadowRoot };
};

const volume = (mountPath: string): State => {
  const element = document.createElement("wcs-state") as State;
  element.setAttribute("mount", mountPath);
  return element;
};

const root = (json: string): State => {
  const element = document.createElement("wcs-state") as State;
  element.setAttribute("json", json);
  return element;
};

const readRoot = (rootElement: State, path: string): unknown => {
  let value: unknown;
  rootElement.createState("readonly", (state: any) => { value = state[path]; });
  return value;
};

/** 別の要素がこのマウントパスを今予約できるか（できたら、その予約は残る）。 */
const takenByAnother = (rootNode: Node, mountPath: string): boolean => {
  try {
    reserveVolumeSlot(rootNode, mountPath, {});
    return false;
  } catch {
    return true;
  }
};

describe("枠の台帳: 所有者が一致するときだけ手放す", () => {
  it("予約した要素は手放せ、別の要素の解放・台帳の無い rootNode の解放は何もしない", () => {
    const rootNode = document.createDocumentFragment();
    const owner = {};
    const other = {};
    reserveVolumeSlot(rootNode, "cfg", owner);

    releaseVolumeSlot(rootNode, "cfg", other);
    expect(() => reserveVolumeSlot(rootNode, "cfg", other), "別の要素の解放では手放さない").toThrow(/already mounted/);

    releaseVolumeSlot(rootNode, "cfg", owner);
    expect(isPathUnderReservedVolume(rootNode, "cfg"), "読みの寛容は残る").toBe(true);
    reserveVolumeSlot(rootNode, "cfg", other); // 手放した枠は別の要素が予約できる

    releaseVolumeSlot(document.createDocumentFragment(), "cfg", other);
    expect(() => reserveVolumeSlot(rootNode, "cfg", owner), "台帳の無い rootNode の解放は無関係").toThrow(/already mounted/);
  });
});

describe("ロード中に外れたボリューム", () => {
  it("外れた時点で枠を手放し、同じマウントパスで作り直した要素が接ぎ木できる", async () => {
    const { host, shadowRoot } = makeHost();
    const rootElement = root(`{"count":1}`);
    shadowRoot.appendChild(rootElement);
    await rootElement.connectedCallbackPromise;
    const stale = volume("i18n");
    shadowRoot.appendChild(stale);

    // ソースが来ないまま外す（setInitialState 待ちのロードは決着しない）
    stale.remove();
    const fresh = volume("i18n");
    shadowRoot.appendChild(fresh);
    fresh.setInitialState({ lang: "ja" });
    await fresh.connectedCallbackPromise;
    await flush();
    expect(readRoot(rootElement, "i18n.lang")).toBe("ja"); // 旧: fresh は already mounted で接ぎ木しない
    host.remove();
  });

  it("決着前に付け直せば枠を取り直し、接ぎ木する", async () => {
    const { host, shadowRoot } = makeHost();
    shadowRoot.innerHTML = `<p id="lang" data-wcs="textContent: i18n.lang"></p>`;
    const rootElement = root(`{"count":1}`);
    const volumeElement = volume("i18n");
    shadowRoot.append(volumeElement, rootElement);
    await flush();

    volumeElement.remove();
    shadowRoot.insertBefore(volumeElement, rootElement);
    expect(takenByAnother(shadowRoot, "i18n"), "付け直した時点で取り直す").toBe(true);

    volumeElement.setInitialState({ lang: "en" });
    await volumeElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    expect(shadowRoot.querySelector("#lang")!.textContent).toBe("en");
    host.remove();
  });

  it("外れている間に別の要素が枠を取っていれば、付け直しても横取りせず、報告して接ぎ木しない", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, shadowRoot } = makeHost();
    const rootElement = root(`{"count":1}`);
    shadowRoot.appendChild(rootElement);
    await rootElement.connectedCallbackPromise;
    const first = volume("i18n");
    shadowRoot.appendChild(first);

    first.remove();
    const second = volume("i18n");
    shadowRoot.appendChild(second);
    second.setInitialState({ lang: "second" });
    await second.connectedCallbackPromise;
    await flush();
    expect(readRoot(rootElement, "i18n.lang")).toBe("second");

    shadowRoot.appendChild(first);
    const reports = errorSpy.mock.calls.map((args) => String(args[0]))
      .filter((message) => message.includes(`mount="i18n"> was re-attached while loading`));
    expect(reports).toHaveLength(1);

    first.setInitialState({ lang: "first" });
    await first.connectedCallbackPromise;
    await flush();
    expect(readRoot(rootElement, "i18n.lang"), "付け直した要素は接ぎ木しない").toBe("second");

    first.remove();
    expect(takenByAnother(shadowRoot, "i18n"), "枠を持たない要素の切断は、持ち主の枠を奪わない").toBe(true);
    host.remove();
  });

  it("ルート待ちの保留中に外れた要素は、ルートが来ても接ぎ木しない", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // D11（ルートの居ないボリューム）の報告
    const { host, shadowRoot } = makeHost();
    const volumeElement = volume("i18n");
    shadowRoot.appendChild(volumeElement);
    volumeElement.setInitialState({ lang: "queued" });
    await flush();
    await flush();

    volumeElement.remove();
    const rootElement = root(`{"count":1}`);
    shadowRoot.appendChild(rootElement);
    await rootElement.connectedCallbackPromise;
    await volumeElement.connectedCallbackPromise;
    await flush();
    let grafted = true;
    rootElement.createState("readonly", (state: any) => { grafted = "i18n" in state; });
    expect(grafted).toBe(false);
    expect(takenByAnother(shadowRoot, "i18n"), "枠は手放されている").toBe(false);
    host.remove();
  });

  it("ルート待ちの保留中に外れても、ルートが来る前に付け直せば接ぎ木する", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, shadowRoot } = makeHost();
    const volumeElement = volume("i18n");
    shadowRoot.appendChild(volumeElement);
    volumeElement.setInitialState({ lang: "queued" });
    await flush();
    await flush();

    volumeElement.remove();
    shadowRoot.appendChild(volumeElement);

    const rootElement = root(`{"count":1}`);
    shadowRoot.appendChild(rootElement);
    await rootElement.connectedCallbackPromise;
    await volumeElement.connectedCallbackPromise;
    await flush();
    expect(readRoot(rootElement, "i18n.lang")).toBe("queued");
    host.remove();
  });
});

describe("接ぎ木しないまま決着したボリューム", () => {
  it("孤児（ルートの初期化失敗）は枠を手放し、壊れたルートとボリュームを作り直せば読み直さずに復旧する", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, shadowRoot } = makeHost();
    const orphan = volume("i18n");
    const brokenRoot = document.createElement("wcs-state") as State;
    shadowRoot.append(orphan, brokenRoot);
    orphan.setInitialState({ lang: "en" });
    await flush();
    await flush();

    brokenRoot.setInitialState({ items: [], $listKeys: { "items.*": "id" } });
    await expect(brokenRoot.connectedCallbackPromise).rejects.toThrow(/must be the list path itself/);
    await orphan.connectedCallbackPromise;
    expect(errorSpy.mock.calls.map((args) => String(args[0])).join(" | ")).toContain(`volume "i18n" was not grafted`);

    // 作者の復旧: 壊れたルートと孤児を取り除いて作り直す
    brokenRoot.remove();
    orphan.remove();
    await flush();
    const freshVolume = volume("i18n");
    shadowRoot.appendChild(freshVolume);
    freshVolume.setInitialState({ lang: "ja" });
    const fixedRoot = root(`{"count":1}`);
    shadowRoot.insertBefore(fixedRoot, shadowRoot.firstChild);
    await fixedRoot.connectedCallbackPromise;
    await freshVolume.connectedCallbackPromise;
    await flush();
    expect(readRoot(fixedRoot, "i18n.lang")).toBe("ja"); // 旧: undefined（作り直した要素が already mounted）
    host.remove();
  });

  it("ロードに失敗したボリュームは枠を手放し、配下の読みは undefined のまま、同じパスの新しい要素が接ぎ木できる", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, shadowRoot } = makeHost();
    shadowRoot.innerHTML = `<wcs-state json='{"count":1}'></wcs-state><wcs-state mount="cfg" json='{broken'></wcs-state>`;
    const rootElement = shadowRoot.querySelector("wcs-state:not([mount])") as State;
    const failed = shadowRoot.querySelector("wcs-state[mount]") as State;
    await rootElement.connectedCallbackPromise;
    await failed.connectedCallbackPromise;
    expect(readRoot(rootElement, "cfg"), "読みの寛容は残る（失敗を 1 ボリュームに閉じる）").toBeUndefined();

    const replacement = volume("cfg");
    shadowRoot.appendChild(replacement);
    replacement.setInitialState({ x: 1 });
    await replacement.connectedCallbackPromise;
    await flush();
    expect(readRoot(rootElement, "cfg.x")).toBe(1);

    // 所有者の確認: 決着済みの要素を後から取り除いても、生きている要素の枠は奪わない
    failed.remove();
    expect(takenByAnother(shadowRoot, "cfg")).toBe(true);
    host.remove();
  });

  it("接ぎ木に失敗した（ルートのキーと衝突した）ボリュームも枠を手放す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, shadowRoot } = makeHost();
    shadowRoot.innerHTML = `<wcs-state mount="cfg"></wcs-state><wcs-state json='{"cfg":1}'></wcs-state>`;
    const failed = shadowRoot.querySelector("wcs-state[mount]") as State;
    const rootElement = shadowRoot.querySelector("wcs-state:not([mount])") as State;
    failed.setInitialState({ x: 1 });
    await rootElement.connectedCallbackPromise;
    await failed.connectedCallbackPromise;
    await flush();
    expect(readRoot(rootElement, "cfg")).toBe(1);
    expect(takenByAnother(shadowRoot, "cfg")).toBe(false);
    host.remove();
  });
});

describe("接ぎ木済みのボリューム", () => {
  it("外しても枠を握ったまま（データはツリーに残る）", async () => {
    const { host, shadowRoot } = makeHost();
    const volumeElement = volume("i18n");
    const rootElement = root(`{"count":1}`);
    shadowRoot.append(volumeElement, rootElement);
    volumeElement.setInitialState({ lang: "en" });
    await rootElement.connectedCallbackPromise;
    await volumeElement.connectedCallbackPromise;
    await flush();

    volumeElement.remove();
    expect(takenByAnother(shadowRoot, "i18n")).toBe(true);
    expect(readRoot(rootElement, "i18n.lang")).toBe("en");
    host.remove();
  });
});
