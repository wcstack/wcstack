import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WcsWorker } from "../src/components/Worker.js";
import { registerComponents } from "../src/registerComponents.js";
import { FakeWorker, installWorker, restoreWorker } from "./mocks.js";

registerComponents();

function makeElement(attrs: Record<string, string> = {}): WcsWorker {
  const el = document.createElement("wcs-worker") as WcsWorker;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

beforeEach(() => {
  installWorker();
  document.body.innerHTML = "";
});

afterEach(() => {
  restoreWorker();
  vi.useRealTimers();
});

describe("WcsWorker - 属性アクセサ", () => {
  it("src / type / name の getter/setter が属性をリフレクトする", () => {
    const el = makeElement();
    el.src = "w.js";
    el.type = "classic";
    el.name = "job";
    expect(el.getAttribute("src")).toBe("w.js");
    expect(el.getAttribute("type")).toBe("classic");
    expect(el.getAttribute("name")).toBe("job");
    expect(el.src).toBe("w.js");
    expect(el.type).toBe("classic");
    expect(el.name).toBe("job");
  });

  it("type は classic 以外は module に正規化される", () => {
    const el = makeElement();
    expect(el.type).toBe("module");
    el.setAttribute("type", "weird");
    expect(el.type).toBe("module");
  });

  it("空属性の既定値", () => {
    const el = makeElement();
    expect(el.src).toBe("");
    expect(el.name).toBe("");
  });

  it("boolean 属性 (manual / keep-alive / restart-on-error) の setter", () => {
    const el = makeElement();
    el.manual = true;
    el.keepAlive = true;
    el.restartOnError = true;
    expect(el.hasAttribute("manual")).toBe(true);
    expect(el.hasAttribute("keep-alive")).toBe(true);
    expect(el.hasAttribute("restart-on-error")).toBe(true);
    el.manual = false;
    el.keepAlive = false;
    el.restartOnError = false;
    expect(el.hasAttribute("manual")).toBe(false);
    expect(el.hasAttribute("keep-alive")).toBe(false);
    expect(el.hasAttribute("restart-on-error")).toBe(false);
  });

  it("maxRestarts は数値・既定 Infinity・NaN フォールバック", () => {
    const el = makeElement();
    expect(el.maxRestarts).toBe(Infinity);
    el.maxRestarts = 5;
    expect(el.maxRestarts).toBe(5);
    el.setAttribute("max-restarts", "abc");
    expect(el.maxRestarts).toBe(Infinity);
    el.setAttribute("max-restarts", "Infinity");
    expect(el.maxRestarts).toBe(Infinity);
  });

  it("maxRestarts の負数はそのまま透過し restart 完全抑止になる（観測可能挙動）", () => {
    const el = makeElement();
    // parseInt("-1", 10) === -1（NaN ではない）。Core 側で _restartCount(0) < -1
    // が常に false となり restart が一切起きない、観測可能な値として固定する。
    el.setAttribute("max-restarts", "-1");
    expect(el.maxRestarts).toBe(-1);
  });

  it("maxRestarts の空文字は既定 Infinity にフォールバック", () => {
    const el = makeElement();
    // 空文字は falsy なので parseInt を通らず Infinity 既定に落ちる。
    el.setAttribute("max-restarts", "");
    expect(el.maxRestarts).toBe(Infinity);
  });

  it("restartInterval は数値・既定 0・NaN フォールバック", () => {
    const el = makeElement();
    expect(el.restartInterval).toBe(0);
    el.restartInterval = 250;
    expect(el.restartInterval).toBe(250);
    el.setAttribute("restart-interval", "abc");
    expect(el.restartInterval).toBe(0);
  });

  it("restartInterval の負数はそのまま透過する", () => {
    const el = makeElement();
    // parseInt("-1", 10) === -1（NaN ではない）。setTimeout は負値を 0 と扱うため
    // 実害はないが getter は素直に透過させる契約を固定する。
    el.setAttribute("restart-interval", "-1");
    expect(el.restartInterval).toBe(-1);
  });

  it("restartInterval の空文字は既定 0 にフォールバック", () => {
    const el = makeElement();
    // 空文字は falsy なので parseInt を通らず 0 既定に落ちる。
    el.setAttribute("restart-interval", "");
    expect(el.restartInterval).toBe(0);
  });
});

describe("WcsWorker - 自動起動とライフサイクル", () => {
  it("connect 時に src があれば自動 spawn する", () => {
    const el = makeElement({ src: "w.js" });
    document.body.appendChild(el);
    expect(FakeWorker.created).toHaveLength(1);
    expect(el.running).toBe(true);
  });

  it("name 属性が Worker コンストラクタに渡る", () => {
    const el = makeElement({ src: "w.js", name: "job" });
    document.body.appendChild(el);
    expect(FakeWorker.last?.options?.name).toBe("job");
  });

  it("manual なら自動 spawn しない", () => {
    const el = makeElement({ src: "w.js", manual: "" });
    document.body.appendChild(el);
    expect(FakeWorker.created).toHaveLength(0);
  });

  it("src 無しでは spawn しない", () => {
    const el = makeElement();
    document.body.appendChild(el);
    expect(FakeWorker.created).toHaveLength(0);
  });

  it("接続後の src 属性変更で再 spawn する", () => {
    const el = makeElement();
    document.body.appendChild(el);
    el.setAttribute("src", "w.js");
    expect(FakeWorker.created).toHaveLength(1);
  });

  it("manual だと src 変更で spawn しない", () => {
    const el = makeElement({ manual: "" });
    document.body.appendChild(el);
    el.setAttribute("src", "w.js");
    expect(FakeWorker.created).toHaveLength(0);
  });

  it("未接続での src 設定は spawn しない", () => {
    const el = makeElement();
    el.setAttribute("src", "w.js");
    expect(FakeWorker.created).toHaveLength(0);
  });

  it("src 属性の除去 (newValue=null) では spawn しない", () => {
    const el = makeElement({ src: "w.js" });
    document.body.appendChild(el);
    expect(FakeWorker.created).toHaveLength(1);
    el.removeAttribute("src");
    expect(FakeWorker.created).toHaveLength(1);
  });

  it("disconnect で Worker を terminate する（既定）", () => {
    const el = makeElement({ src: "w.js" });
    document.body.appendChild(el);
    const w = FakeWorker.last!;
    el.remove();
    expect(w.terminated).toBe(true);
    expect(el.running).toBe(false);
  });

  it("keep-alive なら disconnect で terminate しない", () => {
    const el = makeElement({ src: "w.js", "keep-alive": "" });
    document.body.appendChild(el);
    const w = FakeWorker.last!;
    el.remove();
    expect(w.terminated).toBe(false);
    expect(el.running).toBe(true);
  });

  it("keep-alive + restart-on-error は保留 restart を disconnect で止めず、detached 要素で再 spawn する（README 記載の意図的リーク）", () => {
    vi.useFakeTimers();
    const el = makeElement({
      src: "w.js",
      "keep-alive": "",
      "restart-on-error": "",
      "restart-interval": "1000",
    });
    document.body.appendChild(el);
    // エラーで restart タイマーが予約される
    FakeWorker.last!.emitError({ message: "boom" });
    expect(FakeWorker.created).toHaveLength(1);
    // disconnect: keep-alive のため dispose() は呼ばれず、保留タイマーはキャンセルされない
    el.remove();
    // タイマー発火 → detached 要素のまま新しい worker が生成される（意図通りのリーク）
    vi.advanceTimersByTime(1000);
    expect(FakeWorker.created).toHaveLength(2);
    expect(el.running).toBe(true);
    // 後始末: 明示 terminate() が唯一の正しい停止方法
    el.terminate();
  });
});

describe("WcsWorker - コマンドと委譲 getter", () => {
  it("start() は restart オプションを Core に渡す", () => {
    vi.useFakeTimers();
    const el = makeElement({ src: "w.js", "restart-on-error": "", "restart-interval": "500" });
    document.body.appendChild(el);
    FakeWorker.last!.emitError({ message: "x" });
    vi.advanceTimersByTime(500);
    expect(FakeWorker.created).toHaveLength(2);
  });

  it("start() は src 無しでは Worker を生成せず Core に TypeError を立てさせる", () => {
    const el = makeElement();
    el.start();
    expect(FakeWorker.created).toHaveLength(0);
    // never-throw 契約: Shell でも沈黙せず error にエラーを表面化する
    expect(el.error).toEqual({ name: "TypeError", message: "src is required." });
  });

  it("post() / terminate() を Core に委譲する", () => {
    const el = makeElement({ src: "w.js" });
    document.body.appendChild(el);
    const w = FakeWorker.last!;
    el.post({ a: 1 }, undefined);
    expect(w.posted).toHaveLength(1);
    el.terminate();
    expect(w.terminated).toBe(true);
  });

  it("message / error / running を Core から委譲して読む", () => {
    const el = makeElement({ src: "w.js" });
    document.body.appendChild(el);
    FakeWorker.last!.emitMessage("hi");
    expect(el.message).toBe("hi");
    expect(el.error).toBeNull();
    expect(el.running).toBe(true);
  });
});

describe("WcsWorker - メタ宣言", () => {
  it("wcBindable に properties / inputs / commands を宣言している", () => {
    expect(WcsWorker.wcBindable.properties.map(p => p.name)).toContain("message");
    expect(WcsWorker.wcBindable.inputs?.map(i => i.name)).toContain("src");
    expect(WcsWorker.wcBindable.commands?.map(c => c.name)).toEqual(["start", "post", "terminate"]);
  });

  it("observedAttributes は src を監視する", () => {
    expect(WcsWorker.observedAttributes).toEqual(["src"]);
  });
});
