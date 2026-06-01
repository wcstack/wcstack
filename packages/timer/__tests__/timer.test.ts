import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapTimer } from "../src/bootstrapTimer";
import { setConfig } from "../src/config";
import { Timer } from "../src/components/Timer";
import { unregisterAutoTrigger } from "../src/autoTrigger";

function createTimer(attrs: Record<string, string> = {}): Timer {
  const el = document.createElement("wcs-timer") as Timer;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

describe("Timer (Shell)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setConfig({ autoTrigger: false, triggerAttribute: "data-timertarget", tagNames: { timer: "wcs-timer" } });
    bootstrapTimer();
  });

  afterEach(() => {
    unregisterAutoTrigger();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("接続時に自動で開始し display:none になる", () => {
    const el = createTimer({ interval: "1000" });
    document.body.appendChild(el);

    expect(el.style.display).toBe("none");
    expect(el.running).toBe(true);

    vi.advanceTimersByTime(2000);
    expect(el.tick).toBe(2);
  });

  it("manual では自動開始しない", () => {
    const el = createTimer({ interval: "1000", manual: "" });
    document.body.appendChild(el);
    expect(el.running).toBe(false);

    el.start();
    vi.advanceTimersByTime(1000);
    expect(el.tick).toBe(1);
  });

  it("切断時に停止する", () => {
    const el = createTimer({ interval: "1000" });
    document.body.appendChild(el);
    vi.advanceTimersByTime(1000);
    el.remove();

    expect(el.running).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(el.tick).toBe(1);
  });

  it("once は1回だけ発火する (repeat=1相当)", () => {
    const el = createTimer({ interval: "1000", once: "", manual: "" });
    document.body.appendChild(el);
    el.start();

    vi.advanceTimersByTime(5000);
    expect(el.tick).toBe(1);
    expect(el.running).toBe(false);
  });

  it("once タイマーを再 start すると毎回 1 回ずつ発火する", () => {
    const el = createTimer({ interval: "1000", once: "", manual: "" });
    document.body.appendChild(el);

    el.start();
    vi.advanceTimersByTime(5000);
    expect(el.tick).toBe(1);
    expect(el.running).toBe(false);

    // reset せず再 start。per-run 判定なので再び 1 回発火する
    el.start();
    vi.advanceTimersByTime(5000);
    expect(el.tick).toBe(2);
    expect(el.running).toBe(false);
  });

  it("repeat 属性は once より優先される", () => {
    const el = createTimer({ interval: "1000", once: "", repeat: "3", manual: "" });
    document.body.appendChild(el);
    el.start();

    vi.advanceTimersByTime(5000);
    expect(el.tick).toBe(3);
  });

  it("immediate 属性で start 直後に発火する", () => {
    const el = createTimer({ interval: "1000", immediate: "", manual: "" });
    document.body.appendChild(el);
    el.start();
    expect(el.tick).toBe(1);
  });

  it("interval のデフォルトは1000、不正値(NaN/0/負数)も1000にフォールバック", () => {
    const a = createTimer();
    expect(a.interval).toBe(1000);
    const b = createTimer({ interval: "abc" });
    expect(b.interval).toBe(1000);
    const c = createTimer({ interval: "250" });
    expect(c.interval).toBe(250);
    // 0 / 負数はホットループになるため 1000 にフォールバック
    expect(createTimer({ interval: "0" }).interval).toBe(1000);
    expect(createTimer({ interval: "-1" }).interval).toBe(1000);
  });

  it("interval=0 属性で接続しても暴走せず既定周期で動く", () => {
    const el = createTimer({ interval: "0" });
    document.body.appendChild(el);
    vi.advanceTimersByTime(1000);
    expect(el.tick).toBe(1);
  });

  it("repeat のデフォルトは0、不正値も0にフォールバック", () => {
    const a = createTimer();
    expect(a.repeat).toBe(0);
    const b = createTimer({ repeat: "xyz" });
    expect(b.repeat).toBe(0);
    const c = createTimer({ repeat: "5" });
    expect(c.repeat).toBe(5);
  });

  it("属性のセッター/ゲッターが対称に動く", () => {
    const el = createTimer();

    el.interval = 500;
    expect(el.getAttribute("interval")).toBe("500");
    expect(el.interval).toBe(500);

    el.repeat = 4;
    expect(el.getAttribute("repeat")).toBe("4");
    expect(el.repeat).toBe(4);

    el.once = true;
    expect(el.hasAttribute("once")).toBe(true);
    expect(el.once).toBe(true);
    el.once = false;
    expect(el.hasAttribute("once")).toBe(false);

    el.immediate = true;
    expect(el.hasAttribute("immediate")).toBe(true);
    expect(el.immediate).toBe(true);
    el.immediate = false;
    expect(el.hasAttribute("immediate")).toBe(false);

    el.manual = true;
    expect(el.hasAttribute("manual")).toBe(true);
    expect(el.manual).toBe(true);
    el.manual = false;
    expect(el.hasAttribute("manual")).toBe(false);
  });

  it("trigger=true で開始し trigger-changed を発火する", () => {
    const el = createTimer({ interval: "1000", manual: "" });
    document.body.appendChild(el);

    let fired = false;
    el.addEventListener("wcs-timer:trigger-changed", () => { fired = true; });

    el.trigger = true;
    expect(el.running).toBe(true);
    expect(el.trigger).toBe(false); // モーメンタリ: 即座に false に戻る
    expect(fired).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(el.tick).toBe(1);
  });

  it("trigger=false は何もしない", () => {
    const el = createTimer({ interval: "1000", manual: "" });
    document.body.appendChild(el);
    el.trigger = false;
    expect(el.running).toBe(false);
  });

  it("stop / reset / pause / resume コマンドが Core に委譲される", () => {
    const el = createTimer({ interval: "1000", manual: "" });
    document.body.appendChild(el);

    el.start();
    vi.advanceTimersByTime(1500);
    expect(el.tick).toBe(1);

    el.pause();
    expect(el.running).toBe(false);
    el.resume();
    expect(el.running).toBe(true);

    el.stop();
    expect(el.running).toBe(false);

    el.reset();
    expect(el.tick).toBe(0);
    expect(el.elapsed).toBe(0);
  });

  it("running中の interval 変更でインターバルが張り直される", () => {
    const el = createTimer({ interval: "1000" });
    document.body.appendChild(el);
    vi.advanceTimersByTime(1000);
    expect(el.tick).toBe(1);

    el.setAttribute("interval", "200");
    // count は保持され、新しい周期で進む
    vi.advanceTimersByTime(600);
    expect(el.tick).toBe(4); // 1 + 3
  });

  it("interval 変更は非running時には張り直さない", () => {
    const el = createTimer({ interval: "1000", manual: "" });
    document.body.appendChild(el);
    expect(el.running).toBe(false);

    el.setAttribute("interval", "200");
    expect(el.running).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(el.tick).toBe(0);
  });

  it("同値への interval 変更は無視する", () => {
    const el = createTimer({ interval: "1000" });
    document.body.appendChild(el);
    const stopSpy = vi.spyOn(el, "stop");
    el.setAttribute("interval", "1000");
    expect(stopSpy).not.toHaveBeenCalled();
  });

  it("未接続での interval 変更は張り直さない", () => {
    const el = createTimer({ interval: "1000" });
    // 未接続のまま属性変更
    el.setAttribute("interval", "200");
    expect(el.running).toBe(false);
  });

  it("autoTrigger 有効時は接続でクリックトリガを登録する", () => {
    setConfig({ autoTrigger: true });
    const el = createTimer({ interval: "1000", manual: "" });
    document.body.appendChild(el);

    const button = document.createElement("button");
    button.setAttribute("data-timertarget", el.id = "auto-timer");
    document.body.appendChild(button);

    button.click();
    expect(el.running).toBe(true);
  });

  it("observedAttributes は interval を含む", () => {
    expect(Timer.observedAttributes).toContain("interval");
  });

  it("wcBindable に trigger プロパティと inputs が追加されている", () => {
    const props = Timer.wcBindable.properties.map((p) => p.name);
    expect(props).toContain("trigger");
    expect(props).toContain("tick");

    const inputs = (Timer.wcBindable.inputs ?? []).map((i) => i.name);
    expect(inputs).toEqual(["interval", "once", "repeat", "immediate", "manual", "trigger"]);
  });
});
