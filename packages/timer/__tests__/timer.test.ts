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

  it("trigger=true で開始し trigger-changed をちょうど1回 detail=false で発火する", () => {
    const el = createTimer({ interval: "1000", manual: "" });
    document.body.appendChild(el);

    const details: unknown[] = [];
    el.addEventListener("wcs-timer:trigger-changed", (e) => details.push((e as CustomEvent).detail));

    el.trigger = true;
    expect(el.running).toBe(true);
    expect(el.trigger).toBe(false); // モーメンタリ: 即座に false に戻る
    // ちょうど1回、detail はモーメンタリ復帰の false
    expect(details).toEqual([false]);

    vi.advanceTimersByTime(1000);
    expect(el.tick).toBe(1);
  });

  it("既に running 中の trigger=true でも start は no-op だが trigger-changed は1回出る", () => {
    // Timer.ts の不変条件: false→true の書き込みごとに必ず1回 change-back イベントが出る
    // （start() が「既に running」で no-op になっても通知は出る）
    const el = createTimer({ interval: "1000" });
    document.body.appendChild(el); // 自動起動で running
    expect(el.running).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(el.tick).toBe(1);

    const details: unknown[] = [];
    el.addEventListener("wcs-timer:trigger-changed", (e) => details.push((e as CustomEvent).detail));
    const startSpy = vi.spyOn((el as any)._core, "start");

    el.trigger = true;
    expect(el.trigger).toBe(false);
    expect(el.running).toBe(true); // 変わらず稼働中
    // Core.start は呼ばれるが running 中につき no-op（タイマーは二重に張られない）
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(details).toEqual([false]); // それでも change-back は1回

    // 二重に張られていないことを確認: 1000ms で 1 tick だけ進む
    vi.advanceTimersByTime(1000);
    expect(el.tick).toBe(2);
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

  it("immediate 稼働中の interval 変更で余分な即時 tick が出ない", () => {
    const el = createTimer({ interval: "1000", immediate: "" });
    document.body.appendChild(el);
    expect(el.tick).toBe(1); // 接続時の即時1回
    vi.advanceTimersByTime(1000);
    expect(el.tick).toBe(2);

    el.setAttribute("interval", "500"); // 周期差し替え（即時再発火しないこと）
    expect(el.tick).toBe(2);

    vi.advanceTimersByTime(500);
    expect(el.tick).toBe(3); // 新周期で進む
  });

  it("repeat 稼働中の interval 変更で合計発火回数が変わらない", () => {
    const el = createTimer({ interval: "1000", repeat: "3" });
    document.body.appendChild(el);
    vi.advanceTimersByTime(2000);
    expect(el.tick).toBe(2); // 3 回中 2 回

    el.setAttribute("interval", "500"); // 残り 1 回ぶんの進捗を維持
    vi.advanceTimersByTime(500);
    expect(el.tick).toBe(3);
    expect(el.running).toBe(false); // 再ベースラインされず合計 3 回で停止

    vi.advanceTimersByTime(5000);
    expect(el.tick).toBe(3);
  });

  it("repeat の負数は 0 (無制限) に正規化される", () => {
    const el = createTimer({ repeat: "-3" });
    expect(el.repeat).toBe(0);
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

  it("手動起動で稼働中の manual タイマーも live interval 変更を反映する", () => {
    // manual は「起動可否」の判断であって「稼働中の周期差し替え可否」とは直交。
    // 明示 start() で稼働中なら、manual でも周期は張り直される。
    const el = createTimer({ interval: "1000", manual: "" });
    document.body.appendChild(el);
    el.start();
    vi.advanceTimersByTime(1000);
    expect(el.tick).toBe(1);

    el.setAttribute("interval", "200");
    vi.advanceTimersByTime(600);
    expect(el.tick).toBe(4); // 1 + 3（新周期 200ms）
  });

  it("interval/repeat は Number() 厳密パースで単位付き文字列を弾く", () => {
    // parseInt なら "100px" -> 100 と通るが、Number() なら NaN -> 既定へフォールバック
    expect(createTimer({ interval: "100px" }).interval).toBe(1000);
    expect(createTimer({ repeat: "3px" }).repeat).toBe(0);
    // 空文字・空白のみも既定へ
    expect(createTimer({ interval: " " }).interval).toBe(1000);
    expect(createTimer({ repeat: "" }).repeat).toBe(0);
    // 正常値はそのまま
    expect(createTimer({ interval: "250" }).interval).toBe(250);
    expect(createTimer({ repeat: "5" }).repeat).toBe(5);
  });

  it("interval 変更は changeInterval に委譲され、同値変更では委譲せず張り直さない", () => {
    const el = createTimer({ interval: "1000" });
    document.body.appendChild(el);
    vi.advanceTimersByTime(1000);
    expect(el.tick).toBe(1);

    // attributeChangedCallback は stop()+start() ではなく changeInterval に委譲する
    const changeSpy = vi.spyOn((el as any)._core, "changeInterval");

    // 同値変更: oldValue===newValue なので attributeChangedCallback がガードし、
    // changeInterval へ委譲されない（=タイマーは一切張り直されない）
    el.setAttribute("interval", "1000");
    expect(changeSpy).not.toHaveBeenCalled();

    // 旧周期 (1000ms) のまま進み、余分な tick は出ない
    vi.advanceTimersByTime(1000);
    expect(el.tick).toBe(2);

    // 非同値変更では changeInterval に新しい周期で委譲され、実際に張り直される
    el.setAttribute("interval", "200");
    expect(changeSpy).toHaveBeenCalledWith(200);
    vi.advanceTimersByTime(600);
    expect(el.tick).toBe(5); // 2 + 3（新周期 200ms で 3 回）
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

  it("static hasConnectedCallbackPromise が false", () => {
    expect(Timer.hasConnectedCallbackPromise).toBe(false);
  });

  it("wcBindable に trigger プロパティと inputs が追加されている", () => {
    const props = Timer.wcBindable.properties.map((p) => p.name);
    expect(props).toContain("trigger");
    expect(props).toContain("tick");

    const inputs = (Timer.wcBindable.inputs ?? []).map((i) => i.name);
    expect(inputs).toEqual(["interval", "once", "repeat", "immediate", "manual", "trigger"]);

    // 属性を持つ input には attribute ヒントを付与（geolocation/debounce と整合）。
    // trigger はモーメンタリ命令プロパティで対応属性が無いためヒント無し。
    const byName = Object.fromEntries((Timer.wcBindable.inputs ?? []).map((i) => [i.name, i.attribute]));
    expect(byName).toEqual({
      interval: "interval",
      once: "once",
      repeat: "repeat",
      immediate: "immediate",
      manual: "manual",
      trigger: undefined,
    });
  });
});
