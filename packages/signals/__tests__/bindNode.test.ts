import { describe, it, expect } from "vitest";
import { bindNode, nodeSource, WcBindableDescriptor } from "../src/bindNode.js";
import { signal, computed, effect, flushSync } from "../src/reactive.js";

// A minimal wc-bindable-shaped node: EventTarget + properties (one with a custom
// getter reading event.detail, one read straight off the instance), one input,
// one command. Mirrors the shape of any wcstack async-IO node.
class FakeNode extends EventTarget {
  static wcBindable: WcBindableDescriptor = {
    properties: [
      { name: "value", event: "fake:response", getter: (e: Event) => (e as CustomEvent).detail },
      { name: "loading", event: "fake:loading-changed" },
    ],
    inputs: [{ name: "url" }],
    commands: [{ name: "run" }],
  };

  value: unknown = null;
  loading = false;
  url = "";
  ran: string[] = [];

  run(): void {
    this.ran.push(this.url);
    this.loading = true;
    this.dispatchEvent(new CustomEvent("fake:loading-changed"));
    this.value = `result:${this.url}`;
    this.dispatchEvent(new CustomEvent("fake:response", { detail: this.value }));
    this.loading = false;
    this.dispatchEvent(new CustomEvent("fake:loading-changed"));
  }
}

describe("bindNode", () => {
  it("properties をイベント購読でシグナル化する（getter 経由）", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    expect(bound.signals.value.peek()).toBeNull(); // 初期値はノードの現在値
    node.dispatchEvent(new CustomEvent("fake:response", { detail: "hello" }));
    expect(bound.signals.value.peek()).toBe("hello");
  });

  it("getter の無い property はインスタンスから直接読む", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    node.loading = true;
    node.dispatchEvent(new CustomEvent("fake:loading-changed"));
    expect(bound.signals.loading.peek()).toBe(true);
  });

  it("set で input を書き込める", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    bound.set("url", "/api/x");
    expect(node.url).toBe("/api/x");
  });

  it("command でメソッドを呼べる", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    bound.set("url", "/api/y");
    bound.command("run");
    expect(node.ran).toEqual(["/api/y"]);
  });

  it("descriptor 省略時は target.constructor.wcBindable を使う", () => {
    const node = new FakeNode();
    const bound = bindNode(node);
    node.dispatchEvent(new CustomEvent("fake:response", { detail: 99 }));
    expect(bound.signals.value.peek()).toBe(99);
  });

  it("descriptor が無ければ例外を投げる", () => {
    const bare = new EventTarget() as EventTarget & Record<string, any>;
    expect(() => bindNode(bare)).toThrow(/no wc-bindable descriptor/);
  });

  it("dispose 後はイベントでシグナルが更新されない", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    bound.dispose();
    node.dispatchEvent(new CustomEvent("fake:response", { detail: "after-dispose" }));
    expect(bound.signals.value.peek()).toBeNull();
  });

  it("dispose 後の set/command は use-after-dispose 例外を投げる（アダプタは inert）", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    bound.dispose();
    // dispose 後はアダプタ全体が死ぬ。素通しせず例外で気付かせる。
    expect(() => bound.set("url", "/after")).toThrow(/after dispose/);
    expect(() => bound.command("run")).toThrow(/after dispose/);
    expect(node.url).toBe(""); // node には一切作用していない
    expect(node.ran).toEqual([]);
  });

  it("dispose は冪等（二度呼んでも安全）", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    bound.dispose();
    expect(() => bound.dispose()).not.toThrow();
  });

  it("未宣言の input への set は例外を投げる", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    expect(() => bound.set("nope", 1)).toThrow(/not a declared input/);
  });

  it("未宣言の command 呼び出しは例外を投げる", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    expect(() => bound.command("nope")).toThrow(/not a declared command/);
  });

  it("宣言済みだが関数でない command は TypeError を投げる", () => {
    const node = new FakeNode() as FakeNode & Record<string, unknown>;
    const desc: WcBindableDescriptor = {
      properties: [],
      commands: [{ name: "notAFn" }],
    };
    (node as Record<string, unknown>).notAFn = 123; // 関数でない
    const bound = bindNode(node, desc);
    expect(() => bound.command("notAFn")).toThrow(TypeError);
  });

  it("購読後の再 seed で bindNode 時点のノード値を取りこぼさない", () => {
    const node = new FakeNode();
    node.loading = true; // bind 前にすでに値が立っている
    const bound = bindNode(node, FakeNode.wcBindable);
    // イベント無しでも、購読後の再 seed により現在値が反映される
    expect(bound.signals.loading.peek()).toBe(true);
  });

  it("inputs/commands を省略した descriptor でも未宣言名は弾く", () => {
    const node = new FakeNode();
    const desc: WcBindableDescriptor = { properties: [] }; // inputs/commands 無し
    const bound = bindNode(node, desc);
    expect(() => bound.set("url", "x")).toThrow(/not a declared input/);
    expect(() => bound.command("run")).toThrow(/not a declared command/);
  });

  it("シグナル → effect で DOM 更新まで通る（エンドツーエンド）", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    const el = document.createElement("div");

    effect(() => {
      el.textContent = String(bound.signals.value.get() ?? "");
    });
    flushSync();
    expect(el.textContent).toBe(""); // 初期 null

    bound.set("url", "/api/z");
    bound.command("run");
    flushSync();
    expect(el.textContent).toBe("result:/api/z");
  });
});

// A node with observable write/command side-effects, for the signal→element
// surfaces (bindInput / bindCommand).
class CountingNode extends EventTarget {
  static wcBindable: WcBindableDescriptor = {
    properties: [{ name: "value", event: "cn:value", getter: (e: Event) => (e as CustomEvent).detail }],
    inputs: [{ name: "url" }],
    commands: [{ name: "go" }],
  };

  writes = 0;
  calls: unknown[][] = [];
  private _url = "";

  get url(): string {
    return this._url;
  }
  set url(v: string) {
    this.writes++;
    this._url = v;
  }

  go(...args: unknown[]): void {
    this.calls.push(args);
  }
}

describe("bindNode.on（event-token stream）", () => {
  it("既定 fold は latest（直近値で置換）", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    const s = bound.on("value");
    expect(s.peek()).toBeUndefined();
    node.dispatchEvent(new CustomEvent("fake:response", { detail: "a" }));
    expect(s.peek()).toBe("a");
    node.dispatchEvent(new CustomEvent("fake:response", { detail: "b" }));
    expect(s.peek()).toBe("b");
  });

  it("同値でも毎回通知する（state ではなく occurrence のストリーム）", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    const s = bound.on("value");
    let runs = 0;
    effect(() => {
      s.get();
      runs++;
    });
    flushSync();
    expect(runs).toBe(1);
    node.dispatchEvent(new CustomEvent("fake:response", { detail: "x" }));
    flushSync();
    node.dispatchEvent(new CustomEvent("fake:response", { detail: "x" })); // 同値
    flushSync();
    expect(runs).toBe(3); // 同値でも 2 回の emit が両方とも通知された
  });

  it("reduce fold で畳み込める（emit ごとに集約）", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    const count = bound.on<number, unknown>("value", { fold: (acc = 0) => acc + 1, initial: 0 });
    node.dispatchEvent(new CustomEvent("fake:response", { detail: "_" }));
    node.dispatchEvent(new CustomEvent("fake:response", { detail: "_" }));
    node.dispatchEvent(new CustomEvent("fake:response", { detail: "_" }));
    expect(count.peek()).toBe(3);
  });

  it("getter の無い property は値スナップショットを畳む", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    const s = bound.on("loading");
    node.loading = true;
    node.dispatchEvent(new CustomEvent("fake:loading-changed"));
    expect(s.peek()).toBe(true);
  });

  it("未宣言 property の on は例外", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    expect(() => bound.on("nope")).toThrow(/not a declared property/);
  });

  it("dispose 後は on が例外、既存ストリームも更新停止", () => {
    const node = new FakeNode();
    const bound = bindNode(node, FakeNode.wcBindable);
    const s = bound.on("value");
    bound.dispose();
    node.dispatchEvent(new CustomEvent("fake:response", { detail: "z" }));
    expect(s.peek()).toBeUndefined();
    expect(() => bound.on("value")).toThrow(/after dispose/);
  });
});

describe("bindNode.bindInput（signal → property writeback）", () => {
  it("signal を property へ反映し、same-value では書き込まない", () => {
    const node = new CountingNode();
    const bound = bindNode(node, CountingNode.wcBindable);
    const url = signal(""); // ノードの初期 url と同値
    bound.bindInput("url", url);
    flushSync();
    expect(node.writes).toBe(0); // 初期 "" === "" → 書き込みスキップ（same-value ガード）

    url.set("/a");
    flushSync();
    expect(node.writes).toBe(1);
    expect(node.url).toBe("/a");
  });

  it("書き戻しが無限ループしない（computed を介した echo）", () => {
    const node = new CountingNode();
    const bound = bindNode(node, CountingNode.wcBindable);
    // value signal は node の "cn:value" から、url は signal から。url を value に
    // echo する computed を作り bindInput で戻す → same-value ガードで収束。
    const base = signal("/a");
    const url = computed(() => base.get());
    bound.bindInput("url", url);
    flushSync();
    expect(node.url).toBe("/a");
    const writesAfterFirst = node.writes;
    flushSync(); // 追加の flush でも再書き込みされない
    expect(node.writes).toBe(writesAfterFirst);
  });

  it("返り値の disposer で個別に writeback を止められる", () => {
    const node = new CountingNode();
    const bound = bindNode(node, CountingNode.wcBindable);
    const url = signal("/a");
    const stop = bound.bindInput("url", url);
    flushSync();
    const writes = node.writes;
    stop(); // adapter 全体ではなくこの binding だけ止める
    url.set("/b");
    flushSync();
    expect(node.writes).toBe(writes);
  });

  it("未宣言 input の bindInput は例外", () => {
    const node = new CountingNode();
    const bound = bindNode(node, CountingNode.wcBindable);
    expect(() => bound.bindInput("nope", signal(1))).toThrow(/not a declared input/);
  });

  it("dispose で writeback effect も停止", () => {
    const node = new CountingNode();
    const bound = bindNode(node, CountingNode.wcBindable);
    const url = signal("/a");
    bound.bindInput("url", url);
    flushSync();
    const writes = node.writes;
    bound.dispose();
    url.set("/b");
    flushSync();
    expect(node.writes).toBe(writes); // dispose 後は反映されない
    expect(() => bound.bindInput("url", url)).toThrow(/after dispose/);
  });
});

describe("bindNode.bindCommand（command-token: trigger 変化で emit）", () => {
  it("初期値では発火せず、変化でコマンドを起動する（既定 args = [value]）", () => {
    const node = new CountingNode();
    const bound = bindNode(node, CountingNode.wcBindable);
    const trigger = signal(0);
    bound.bindCommand("go", trigger);
    flushSync();
    expect(node.calls).toEqual([]); // mount では起動しない

    trigger.set(1);
    flushSync();
    trigger.set(2);
    flushSync();
    expect(node.calls).toEqual([[1], [2]]);
  });

  it("返り値の disposer で個別に command 起動を止められる", () => {
    const node = new CountingNode();
    const bound = bindNode(node, CountingNode.wcBindable);
    const trigger = signal(0);
    const stop = bound.bindCommand("go", trigger);
    flushSync();
    stop();
    trigger.set(1);
    flushSync();
    expect(node.calls).toEqual([]);
  });

  it("mapArgs で呼び出し引数を整形できる", () => {
    const node = new CountingNode();
    const bound = bindNode(node, CountingNode.wcBindable);
    const t = signal("");
    bound.bindCommand("go", t, (v) => [v, `${v}!`]);
    flushSync();
    t.set("x");
    flushSync();
    expect(node.calls).toEqual([["x", "x!"]]);
  });

  it("未宣言 command / 非関数 command は bind 時に例外", () => {
    const node = new CountingNode() as CountingNode & Record<string, unknown>;
    const bound = bindNode(node, CountingNode.wcBindable);
    expect(() => bound.bindCommand("nope", signal(0))).toThrow(/not a declared command/);

    const desc: WcBindableDescriptor = { properties: [], commands: [{ name: "notFn" }] };
    (node as Record<string, unknown>).notFn = 123;
    const bound2 = bindNode(node, desc);
    expect(() => bound2.bindCommand("notFn", signal(0))).toThrow(TypeError);
  });

  it("dispose で command 起動も停止", () => {
    const node = new CountingNode();
    const bound = bindNode(node, CountingNode.wcBindable);
    const trigger = signal(0);
    bound.bindCommand("go", trigger);
    flushSync();
    bound.dispose();
    trigger.set(1);
    flushSync();
    expect(node.calls).toEqual([]);
    expect(() => bound.bindCommand("go", trigger)).toThrow(/after dispose/);
  });
});

// A node with both a start command and a cancel command, for nodeSource.
class AbortableNode extends EventTarget {
  static wcBindable: WcBindableDescriptor = {
    properties: [{ name: "value", event: "an:value", getter: (e: Event) => (e as CustomEvent).detail }],
    inputs: [{ name: "url" }],
    commands: [{ name: "run" }, { name: "abort" }, { name: "halt" }],
  };

  ran: string[] = [];
  aborted = 0;
  halted = 0;

  run(url: string): Promise<string> {
    this.ran.push(url);
    return Promise.resolve(`r:${url}`);
  }
  abort(): void {
    this.aborted++;
  }
  halt(): void {
    this.halted++;
  }
}

describe("nodeSource（resource×ノード cancel ブリッジ）", () => {
  it("source として run を呼び、AbortSignal を既定の abort コマンドへ橋渡す", () => {
    const node = new AbortableNode();
    const bound = bindNode(node, AbortableNode.wcBindable);
    const ac = new AbortController();
    const src = nodeSource(bound, (b, url: string) => b.command("run", url) as Promise<string>);
    void src("/x", ac.signal);
    expect(node.ran).toEqual(["/x"]);
    expect(node.aborted).toBe(0);
    ac.abort();
    expect(node.aborted).toBe(1); // abort signal → abort command
  });

  it("abort コマンド名を上書きできる", () => {
    const node = new AbortableNode();
    const bound = bindNode(node, AbortableNode.wcBindable);
    const ac = new AbortController();
    const src = nodeSource(bound, (b, url: string) => b.command("run", url) as Promise<string>, { abort: "halt" });
    void src("/y", ac.signal);
    ac.abort();
    expect(node.halted).toBe(1);
    expect(node.aborted).toBe(0);
  });

  it("dispose 済みアダプタへの abort は未処理例外にならず握りつぶす", () => {
    const node = new AbortableNode();
    const bound = bindNode(node, AbortableNode.wcBindable);
    const ac = new AbortController();
    const src = nodeSource(bound, (b, url: string) => b.command("run", url) as Promise<string>);
    void src("/x", ac.signal);
    bound.dispose(); // adapter が先に死ぬ（共有オーナーのteardown順）
    // abort listener は bound.command を同期的に呼ぶが use-after-dispose 例外を握りつぶす
    expect(() => ac.abort()).not.toThrow();
    expect(node.aborted).toBe(0); // command は走らない（abort されなかった）
  });

  it("dispose 以外の abort コマンド例外は reportError へ送られabort を壊さない", () => {
    class ThrowingAbort extends EventTarget {
      static wcBindable: WcBindableDescriptor = {
        properties: [{ name: "value", event: "ta:value" }],
        commands: [{ name: "run" }, { name: "abort" }],
      };
      run(): Promise<void> {
        return Promise.resolve();
      }
      abort(): void {
        throw new Error("boom in abort");
      }
    }
    const node = new ThrowingAbort();
    const bound = bindNode(node, ThrowingAbort.wcBindable);
    const ac = new AbortController();
    const src = nodeSource(bound, (b) => b.command("run") as Promise<void>);
    void src(undefined as never, ac.signal);

    const reported: unknown[] = [];
    const g = globalThis as { reportError?: (e: unknown) => void };
    const prev = g.reportError;
    g.reportError = (e) => reported.push(e);
    try {
      expect(() => ac.abort()).not.toThrow(); // abort 自体は壊れない
    } finally {
      g.reportError = prev;
    }
    expect(reported).toHaveLength(1);
    expect((reported[0] as Error).message).toBe("boom in abort");
  });

  it("reportError が無い環境では console.error へフォールバックする", () => {
    class ThrowingAbort2 extends EventTarget {
      static wcBindable: WcBindableDescriptor = {
        properties: [{ name: "value", event: "ta2:value" }],
        commands: [{ name: "run" }, { name: "abort" }],
      };
      run(): Promise<void> {
        return Promise.resolve();
      }
      abort(): void {
        throw new Error("boom2");
      }
    }
    const node = new ThrowingAbort2();
    const bound = bindNode(node, ThrowingAbort2.wcBindable);
    const ac = new AbortController();
    const src = nodeSource(bound, (b) => b.command("run") as Promise<void>);
    void src(undefined as never, ac.signal);

    const g = globalThis as { reportError?: (e: unknown) => void };
    const prev = g.reportError;
    delete g.reportError; // reportError 不在を模す
    const errors: unknown[] = [];
    const origErr = console.error;
    console.error = (e: unknown) => errors.push(e);
    try {
      expect(() => ac.abort()).not.toThrow();
    } finally {
      console.error = origErr;
      g.reportError = prev;
    }
    expect((errors[0] as Error).message).toBe("boom2");
  });
});
