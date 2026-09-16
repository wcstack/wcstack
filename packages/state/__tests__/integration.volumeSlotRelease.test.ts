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
 *  - ロード中・ルート待ちの保留中に外れたボリュームは、外れた時点で枠を手放す。枠は接ぎ木の直前
 *    （ロードの完了・ルートの登録）に取り直し、空いていれば接ぎ木する — 外れたままでも、別の root へ
 *    移っていても従来どおり。その間に別の要素が枠を取っていれば、報告を 1 件出して接ぎ木しない。
 *  - 接ぎ木済みのボリュームは外しても枠を握ったまま（データはツリーに残る）。`$connectedCallback` の
 *    同期の throw は接ぎ木の失敗にしない。
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

const notGraftedReports = (spy: { mock: { calls: unknown[][] } }, mountPath: string): string[] =>
  spy.mock.calls.map((args) => String(args[0])).filter((message) => message.includes(`mount="${mountPath}"> will not graft`));

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

  it("同じ root の中で付け直した（並べ替えた）なら、その場で枠を取り直して接ぎ木する", async () => {
    const { host, shadowRoot } = makeHost();
    shadowRoot.innerHTML = `<p id="lang" data-wcs="textContent: i18n.lang"></p>`;
    const rootElement = root(`{"count":1}`);
    const volumeElement = volume("i18n");
    shadowRoot.append(volumeElement, rootElement);
    await flush();

    volumeElement.remove();
    shadowRoot.insertBefore(volumeElement, rootElement);
    // 並べ替えの一瞬に、後から来た同じパスのボリュームへ枠を渡さない
    expect(takenByAnother(shadowRoot, "i18n"), "付け直した時点で取り直している").toBe(true);
    volumeElement.setInitialState({ lang: "en" });
    await volumeElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    expect(shadowRoot.querySelector("#lang")!.textContent).toBe("en");
    expect(takenByAnother(shadowRoot, "i18n")).toBe(true);
    host.remove();
  });

  it("外れている間に別の要素が枠を取っていれば、付け直しても横取りせず、ロードの完了で報告して接ぎ木しない", async () => {
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
    expect(notGraftedReports(errorSpy, "i18n"), "付け直しただけでは取り直さない（取るのは接ぎ木の直前）").toEqual([]);

    first.setInitialState({ lang: "first" });
    await first.connectedCallbackPromise;
    await flush();
    expect(notGraftedReports(errorSpy, "i18n")).toHaveLength(1);
    expect(readRoot(rootElement, "i18n.lang"), "付け直した要素は接ぎ木しない").toBe("second");

    first.remove();
    expect(takenByAnother(shadowRoot, "i18n"), "枠を持たない要素の切断は、持ち主の枠を奪わない").toBe(true);
    host.remove();
  });
});

describe("ルート待ちの保留中に外れたボリューム", () => {
  it("ルートが来れば、外れたままでも接ぎ木する（付け直すと $connectedCallback がもう一度呼ばれる）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // D11（ルートの居ないボリューム）の報告
    const { host, shadowRoot } = makeHost();
    let connected = 0;
    const volumeElement = volume("i18n");
    shadowRoot.appendChild(volumeElement);
    volumeElement.setInitialState({ lang: "queued", $connectedCallback() { connected++; } });
    await flush();
    await flush();

    volumeElement.remove();
    const rootElement = root(`{"count":1}`);
    shadowRoot.appendChild(rootElement);
    await rootElement.connectedCallbackPromise;
    await volumeElement.connectedCallbackPromise;
    await flush();
    expect(readRoot(rootElement, "i18n.lang")).toBe("queued");
    expect(connected).toBe(1);
    expect(takenByAnother(shadowRoot, "i18n"), "ルートが来た時点で取り直している").toBe(true);

    shadowRoot.appendChild(volumeElement);
    await flush();
    expect(connected).toBe(2);
    host.remove();
  });

  it("外れている間に同じパスの別のボリュームが保留に積まれていたら、ルートが来ても二重に接ぎ木しない（報告 1 件）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, shadowRoot } = makeHost();
    const first = volume("i18n");
    shadowRoot.appendChild(first);
    first.setInitialState({ lang: "first" });
    await flush();
    await flush();

    first.remove();
    const second = volume("i18n");
    shadowRoot.appendChild(second);
    second.setInitialState({ lang: "second" });
    await flush();
    await flush();

    const rootElement = root(`{"count":1}`);
    shadowRoot.appendChild(rootElement);
    await rootElement.connectedCallbackPromise;
    await first.connectedCallbackPromise;
    await second.connectedCallbackPromise;
    await flush();
    expect(readRoot(rootElement, "i18n.lang")).toBe("second");
    expect(notGraftedReports(errorSpy, "i18n")).toHaveLength(1);
    host.remove();
  });

  it("別の root へ移しても、移した先の同じパスの別ボリュームを妨げず、元の root にルートが来ればそこへ接ぎ木する", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const a = makeHost();
    const b = makeHost();
    const moved = volume("i18n");
    a.shadowRoot.appendChild(moved);
    moved.setInitialState({ lang: "fromA" });
    await flush();
    await flush();

    b.shadowRoot.appendChild(moved); // 保留のまま B へ移す
    const rootB = root(`{"count":1}`);
    b.shadowRoot.appendChild(rootB);
    await rootB.connectedCallbackPromise;
    const other = volume("i18n");
    b.shadowRoot.appendChild(other);
    other.setInitialState({ lang: "W" });
    await other.connectedCallbackPromise;
    await flush();
    expect(readRoot(rootB, "i18n.lang"), "移した先の枠を握らない").toBe("W");

    const rootA = root(`{"count":1}`);
    a.shadowRoot.appendChild(rootA);
    await rootA.connectedCallbackPromise;
    await moved.connectedCallbackPromise;
    await flush();
    expect(readRoot(rootA, "i18n.lang")).toBe("fromA");
    a.host.remove();
    b.host.remove();
  });

  it("ルートが来る前に付け直しても接ぎ木する", async () => {
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

  it("$connectedCallback が同期で投げても接ぎ木は済んだものとして扱い、枠を握ったまま", async () => {
    // 旧: 同期の throw が接ぎ木の失敗（failed to graft）として扱われ、データが載ったまま枠を返していた
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, shadowRoot } = makeHost();
    const volumeElement = volume("cfg");
    const rootElement = root(`{"count":1}`);
    shadowRoot.append(volumeElement, rootElement);
    volumeElement.setInitialState({ a: 1, $connectedCallback() { throw new Error("boom"); } });
    await rootElement.connectedCallbackPromise;
    await volumeElement.connectedCallbackPromise;
    await flush();

    const messages = errorSpy.mock.calls.map((args) => String(args[0]));
    expect(messages.some((message) => message.includes(`volume "cfg" $connectedCallback failed`))).toBe(true);
    expect(messages.some((message) => message.includes(`volume "cfg" failed to graft`))).toBe(false);
    expect(readRoot(rootElement, "cfg.a")).toBe(1);
    expect(takenByAnother(shadowRoot, "cfg")).toBe(true);
    host.remove();
  });
});
