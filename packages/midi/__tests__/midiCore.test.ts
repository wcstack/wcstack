import { describe, it, expect, afterEach, vi } from "vitest";
import { MidiCore } from "../src/core/MidiCore";
import {
  FakeMidiAccess, FakeMidiInput, FakeMidiOutput,
  installMidi, removeMidi, removeNavigator,
  installPermissions, removePermissions, flush, record,
} from "./mocks";

describe("MidiCore", () => {
  afterEach(() => {
    removePermissions();
    removeMidi();
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("構築だけでは何も始まらない（request は撃たれない）", () => {
      const mock = installMidi();
      const core = new MidiCore();
      expect(mock.requestMIDIAccess).not.toHaveBeenCalled();
      expect(core.connected).toBe(false);
      expect(core.permission).toBe("prompt");
      expect(core.devices).toEqual([]);
      expect(core.message).toBeNull();
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("message 由来の派生 getter は未受信なら全て null", () => {
      const core = new MidiCore();
      expect(core.type).toBeNull();
      expect(core.channel).toBeNull();
      expect(core.note).toBeNull();
      expect(core.velocity).toBeNull();
      expect(core.control).toBeNull();
      expect(core.value).toBeNull();
    });

    it("コンストラクタに options を渡しても request はしない（記録するだけ）", async () => {
      const mock = installMidi();
      const core = new MidiCore({ input: "in-1", sysex: true });
      expect(mock.requestMIDIAccess).not.toHaveBeenCalled();
      await core.request();
      expect(mock.calls[0]).toEqual({ sysex: true });
    });
  });

  describe("request()", () => {
    it("成功で connected / permission=granted になり devices が publish される", async () => {
      installMidi();
      const core = new MidiCore();
      const devices = record(core, "wcs-midi:devices");
      await core.request();
      expect(core.connected).toBe(true);
      expect(core.permission).toBe("granted");
      expect(core.granted).toBe(true);
      expect(core.denied).toBe(false);
      expect(devices).toHaveLength(1);
      expect(core.devices).toEqual([
        { id: "in-1", name: "Keystation 49", manufacturer: "wcstack", direction: "input", state: "connected" },
        { id: "out-1", name: "Keystation 49", manufacturer: "wcstack", direction: "output", state: "connected" },
      ]);
    });

    it("sysex 未指定なら requestMIDIAccess({sysex:false}) を渡す", async () => {
      const mock = installMidi();
      await new MidiCore().request();
      expect(mock.calls[0]).toEqual({ sysex: false });
    });

    it("拒否されたら permission=denied・error が立つ（throw しない）", async () => {
      installMidi({ reject: Object.assign(new Error("denied by user"), { name: "SecurityError" }) });
      const core = new MidiCore();
      await expect(core.request()).resolves.toBeUndefined();
      expect(core.permission).toBe("denied");
      expect(core.denied).toBe(true);
      expect(core.connected).toBe(false);
      expect(core.error).toBe("denied by user");
      expect(core.errorInfo).toEqual({
        code: "not-allowed", phase: "start", recoverable: false, message: "denied by user",
      });
    });

    it("message を持たない rejection でも既定文言でエラー化する", async () => {
      installMidi({ reject: {} as Error });
      const core = new MidiCore();
      await core.request();
      expect(core.error).toBe("MIDI error");
      expect(core.errorInfo?.code).toBe("access-error");
    });

    it("requestMIDIAccess 不在なら permission=unsupported・API を撃たない", async () => {
      removeMidi();
      const core = new MidiCore();
      await core.request();
      expect(core.permission).toBe("unsupported");
      expect(core.unsupported).toBe(true);
      expect(core.error).toBe("unsupported");
      expect(core.errorInfo).toEqual({
        code: "capability-missing", phase: "probe", recoverable: false, message: "unsupported",
      });
    });

    it("navigator 自体が無い環境（SSR / worker）でも unsupported に落ちる", async () => {
      const restore = removeNavigator();
      try {
        const core = new MidiCore();
        await core.request();
        expect(core.permission).toBe("unsupported");
      } finally {
        restore();
      }
    });

    it("成功後に close→request すると再取得できる", async () => {
      const mock = installMidi();
      const core = new MidiCore();
      await core.request();
      core.close();
      expect(core.connected).toBe(false);
      await core.request();
      expect(core.connected).toBe(true);
      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(2);
    });

    it("ready は最後の request の settle を表す", async () => {
      installMidi();
      const core = new MidiCore();
      const promise = core.request();
      expect(core.ready).toBe(promise);
      await core.ready;
      expect(core.connected).toBe(true);
    });
  });

  describe("_gen 世代ガード", () => {
    it("in-flight 中に close() すると解決しても access を掴まない", async () => {
      installMidi();
      const core = new MidiCore();
      const promise = core.request();
      core.close();
      await promise;
      expect(core.connected).toBe(false);
      expect(core.permission).toBe("prompt");
    });

    it("in-flight 中に dispose() すると rejection も無視される", async () => {
      installMidi({ reject: new Error("nope") });
      const core = new MidiCore();
      const promise = core.request();
      core.dispose();
      await promise;
      expect(core.permission).toBe("prompt");
      expect(core.error).toBeNull();
    });

    it("連続 request では最後の1回だけが反映される", async () => {
      installMidi();
      const core = new MidiCore();
      const first = core.request();
      const second = core.request();
      await Promise.all([first, second]);
      expect(core.connected).toBe(true);
    });
  });

  describe("メッセージ受信", () => {
    it("入力ポートのメッセージが正規化されて publish される", async () => {
      const access = new FakeMidiAccess();
      const input = new FakeMidiInput("in-1", "Launchkey");
      access.inputs.set(input.id, input);
      installMidi({ access });
      const core = new MidiCore();
      const seen = record(core, "wcs-midi:message");
      await core.request();

      input.emit([0x90, 60, 127], 1234);

      expect(seen).toHaveLength(1);
      expect(seen[0].type).toBe("noteon");
      expect(seen[0].note).toBe(60);
      expect(seen[0].velocity).toBe(1);
      expect(seen[0].port).toBe("in-1");
      expect(seen[0].portName).toBe("Launchkey");
      expect(seen[0].timestamp).toBe(1234);
      expect(core.type).toBe("noteon");
      expect(core.note).toBe(60);
      expect(core.channel).toBe(1);
    });

    it("同じ内容の連打も別々の occurrence として毎回発火する（同値ガード無し）", async () => {
      const access = new FakeMidiAccess();
      const input = new FakeMidiInput("in-1");
      access.inputs.set(input.id, input);
      installMidi({ access });
      const core = new MidiCore();
      const seen = record(core, "wcs-midi:message");
      await core.request();

      input.emit([0x90, 60, 100]);
      input.emit([0x90, 60, 100]);
      input.emit([0x90, 60, 100]);

      expect(seen).toHaveLength(3);
    });

    it("data はメッセージごとに新しい Uint8Array（producer snapshot contract）", async () => {
      const access = new FakeMidiAccess();
      const input = new FakeMidiInput("in-1");
      access.inputs.set(input.id, input);
      installMidi({ access });
      const core = new MidiCore();
      const seen = record(core, "wcs-midi:message");
      await core.request();

      input.emit([0x90, 60, 100]);
      input.emit([0x90, 62, 100]);

      expect(seen[0].data).not.toBe(seen[1].data);
      expect([...seen[0].data]).toEqual([0x90, 60, 100]);
    });

    it("data が無いイベントは無視される", async () => {
      const access = new FakeMidiAccess();
      const input = new FakeMidiInput("in-1");
      access.inputs.set(input.id, input);
      installMidi({ access });
      const core = new MidiCore();
      const seen = record(core, "wcs-midi:message");
      await core.request();

      input.emitRaw({ data: null, target: input });

      expect(seen).toHaveLength(0);
      expect(core.message).toBeNull();
    });

    it("target / timeStamp が欠けても既定値で publish される", async () => {
      const access = new FakeMidiAccess();
      const input = new FakeMidiInput("in-1");
      access.inputs.set(input.id, input);
      installMidi({ access });
      const core = new MidiCore();
      const seen = record(core, "wcs-midi:message");
      await core.request();

      input.emitRaw({ data: new Uint8Array([0x90, 60, 100]) });

      expect(seen[0].port).toBe("");
      expect(seen[0].portName).toBe("");
      expect(seen[0].timestamp).toBe(0);
    });

    it("name が null のポートでも portName は空文字になる", async () => {
      const access = new FakeMidiAccess();
      const input = new FakeMidiInput("in-1", null);
      access.inputs.set(input.id, input);
      installMidi({ access });
      const core = new MidiCore();
      const seen = record(core, "wcs-midi:message");
      await core.request();

      input.emit([0x90, 60, 100]);

      expect(seen[0].portName).toBe("");
    });
  });

  describe("channel フィルタ", () => {
    const setup = async (channel: number | null) => {
      const access = new FakeMidiAccess();
      const input = new FakeMidiInput("in-1");
      access.inputs.set(input.id, input);
      installMidi({ access });
      const core = new MidiCore({ channel });
      const seen = record(core, "wcs-midi:message");
      await core.request();
      return { core, input, seen };
    };

    it("指定チャンネル以外は捨てる", async () => {
      const { input, seen } = await setup(3);
      input.emit([0x90, 60, 100]); // ch 1
      input.emit([0x92, 62, 100]); // ch 3
      expect(seen).toHaveLength(1);
      expect(seen[0].note).toBe(62);
    });

    it("境界（1 と 16）で正しく通る", async () => {
      const first = await setup(1);
      first.input.emit([0x90, 60, 100]);
      expect(first.seen).toHaveLength(1);

      const last = await setup(16);
      last.input.emit([0x9f, 60, 100]);
      expect(last.seen).toHaveLength(1);
    });

    it("channel を指定してもシステムメッセージ（channel=null）は通す", async () => {
      const { input, seen } = await setup(3);
      input.emit([0xf8]);
      expect(seen).toHaveLength(1);
      expect(seen[0].type).toBe("other");
    });

    it("channel 未指定なら全チャンネルを通す", async () => {
      const { input, seen } = await setup(null);
      input.emit([0x90, 60, 100]);
      input.emit([0x9f, 62, 100]);
      expect(seen).toHaveLength(2);
    });
  });

  describe("ポート選択", () => {
    const twoInputs = () => {
      const access = new FakeMidiAccess();
      access.inputs.set("a", new FakeMidiInput("a", "Alpha Controller"));
      access.inputs.set("b", new FakeMidiInput("b", "Beta Keyboard"));
      return access;
    };

    it("input 未指定なら全入力ポートを購読する", async () => {
      const access = twoInputs();
      installMidi({ access });
      const core = new MidiCore();
      const seen = record(core, "wcs-midi:message");
      await core.request();
      access.inputs.get("a")!.emit([0x90, 60, 100]);
      access.inputs.get("b")!.emit([0x90, 62, 100]);
      expect(seen).toHaveLength(2);
    });

    it("input を id で指定するとそのポートだけを購読する", async () => {
      const access = twoInputs();
      installMidi({ access });
      const core = new MidiCore({ input: "b" });
      const seen = record(core, "wcs-midi:message");
      await core.request();
      access.inputs.get("a")!.emit([0x90, 60, 100]);
      access.inputs.get("b")!.emit([0x90, 62, 100]);
      expect(seen).toHaveLength(1);
      expect(seen[0].note).toBe(62);
    });

    it("input は名前の前方一致（大文字小文字を無視）でも選べる", async () => {
      const access = twoInputs();
      installMidi({ access });
      const core = new MidiCore({ input: "alpha" });
      const seen = record(core, "wcs-midi:message");
      await core.request();
      access.inputs.get("a")!.emit([0x90, 60, 100]);
      access.inputs.get("b")!.emit([0x90, 62, 100]);
      expect(seen).toHaveLength(1);
      expect(seen[0].note).toBe(60);
    });

    it("input 空文字は未指定と同じ（全ポート）", async () => {
      const access = twoInputs();
      installMidi({ access });
      const core = new MidiCore({ input: "" });
      const seen = record(core, "wcs-midi:message");
      await core.request();
      access.inputs.get("a")!.emit([0x90, 60, 100]);
      expect(seen).toHaveLength(1);
    });

    it("setOptions で購読対象を差し替えられる（再 request 不要）", async () => {
      const access = twoInputs();
      const mock = installMidi({ access });
      const core = new MidiCore({ input: "a" });
      const seen = record(core, "wcs-midi:message");
      await core.request();

      core.setOptions({ input: "b" });
      access.inputs.get("a")!.emit([0x90, 60, 100]);
      access.inputs.get("b")!.emit([0x90, 62, 100]);

      expect(seen).toHaveLength(1);
      expect(seen[0].note).toBe(62);
      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(1);
    });

    it("name が null のポートは名前セレクタに一致しない（id なら一致する）", async () => {
      const access = new FakeMidiAccess();
      access.inputs.set("a", new FakeMidiInput("a", null));
      installMidi({ access });
      const core = new MidiCore({ input: "alpha" });
      const seen = record(core, "wcs-midi:message");
      await core.request();
      access.inputs.get("a")!.emit([0x90, 60, 100]);
      expect(seen).toHaveLength(0);

      core.setOptions({ input: "a" });
      access.inputs.get("a")!.emit([0x90, 60, 100]);
      expect(seen).toHaveLength(1);
    });

    it("access 未取得の setOptions は記録だけして何もしない", () => {
      installMidi();
      const core = new MidiCore();
      expect(() => core.setOptions({ input: "x" })).not.toThrow();
      expect(core.connected).toBe(false);
    });
  });

  describe("send()", () => {
    it("output 未指定なら最初の出力ポートへ送る", async () => {
      installMidi();
      const core = new MidiCore();
      await core.request();
      core.send([0x90, 60, 100], 42);
      const out = [...((core as any)._access.outputs.values())][0] as FakeMidiOutput;
      expect(out.sent).toEqual([{ data: [0x90, 60, 100], timestamp: 42 }]);
    });

    it("output を id / 名前前方一致で選べる", async () => {
      const access = new FakeMidiAccess();
      access.outputs.set("x", new FakeMidiOutput("x", "Alpha Out"));
      access.outputs.set("y", new FakeMidiOutput("y", "Beta Out"));
      installMidi({ access });
      const core = new MidiCore({ output: "beta" });
      await core.request();
      core.send([0xb0, 7, 64]);
      expect(access.outputs.get("y")!.sent).toHaveLength(1);
      expect(access.outputs.get("x")!.sent).toHaveLength(0);
    });

    it("出力ポートが無ければ黙って no-op（never-throw）", async () => {
      installMidi({ empty: true });
      const core = new MidiCore();
      await core.request();
      expect(() => core.send([0x90, 60, 100])).not.toThrow();
      expect(core.error).toBeNull();
    });

    it("該当する output が無ければ no-op", async () => {
      installMidi();
      const core = new MidiCore({ output: "nothing-like-this" });
      await core.request();
      expect(() => core.send([0x90, 60, 100])).not.toThrow();
    });

    it("access 未取得なら no-op", () => {
      installMidi();
      const core = new MidiCore();
      expect(() => core.send([0x90, 60, 100])).not.toThrow();
    });

    it("send() が throw したら error に出る（例外は伝播しない）", async () => {
      const access = new FakeMidiAccess();
      const out = new FakeMidiOutput("out-1");
      out.throwOnSend = new Error("port is closed");
      access.outputs.set(out.id, out);
      installMidi({ access });
      const core = new MidiCore();
      await core.request();

      expect(() => core.send([0x90, 60, 100])).not.toThrow();
      expect(core.error).toBe("port is closed");
      expect(core.errorInfo).toEqual({
        code: "send-failed", phase: "execute", recoverable: true, message: "port is closed",
      });
    });
  });

  describe("デバイス着脱（statechange）", () => {
    it("入力ポート追加で devices が再 publish され、新ポートも購読される", async () => {
      const access = new FakeMidiAccess();
      installMidi({ access });
      const core = new MidiCore();
      const devices = record(core, "wcs-midi:devices");
      const messages = record(core, "wcs-midi:message");
      await core.request();

      const added = access.addInput(new FakeMidiInput("late", "Hot Plug"));
      added.emit([0x90, 60, 100]);

      expect(core.devices.map((d) => d.id)).toEqual(["late"]);
      expect(messages).toHaveLength(1);
      expect(devices.length).toBeGreaterThanOrEqual(1);
    });

    it("name / manufacturer が null のポートは空文字として publish される", async () => {
      const access = new FakeMidiAccess();
      const port = new FakeMidiInput("a", null);
      port.manufacturer = null;
      access.inputs.set("a", port);
      installMidi({ access });
      const core = new MidiCore();
      await core.request();
      expect(core.devices[0]).toEqual({
        id: "a", name: "", manufacturer: "", direction: "input", state: "connected",
      });
    });

    it("devices は毎回新しい配列として publish される", async () => {
      const access = new FakeMidiAccess();
      installMidi({ access });
      const core = new MidiCore();
      const devices = record(core, "wcs-midi:devices");
      await core.request();
      access.addInput(new FakeMidiInput("a"));
      access.addInput(new FakeMidiInput("b"));
      expect(devices[0]).not.toBe(devices[1]);
    });

    it("内容が変わらない statechange では再 publish しない", async () => {
      const access = new FakeMidiAccess();
      access.inputs.set("a", new FakeMidiInput("a"));
      installMidi({ access });
      const core = new MidiCore();
      await core.request();
      const devices = record(core, "wcs-midi:devices");

      access.onstatechange?.({});
      access.onstatechange?.({});

      expect(devices).toHaveLength(0);
    });

    it("ポートの state が disconnected に変われば再 publish する", async () => {
      const access = new FakeMidiAccess();
      access.inputs.set("a", new FakeMidiInput("a"));
      installMidi({ access });
      const core = new MidiCore();
      await core.request();
      const devices = record(core, "wcs-midi:devices");

      access.disconnectInput("a");

      expect(devices).toHaveLength(1);
      expect(core.devices[0].state).toBe("disconnected");
    });

    it("ポートが減れば購読も外れる", async () => {
      const access = new FakeMidiAccess();
      const port = new FakeMidiInput("a");
      access.inputs.set("a", port);
      installMidi({ access });
      const core = new MidiCore();
      const messages = record(core, "wcs-midi:message");
      await core.request();

      access.removeInput("a");
      port.emit([0x90, 60, 100]);

      expect(messages).toHaveLength(0);
      expect(port.onmidimessage).toBeNull();
    });
  });

  describe("permission 監視", () => {
    it("Permissions API が答えるなら query 結果を publish する", async () => {
      installMidi();
      const permissions = installPermissions({ state: "prompt" });
      const core = new MidiCore({ sysex: true });
      const seen = record(core, "wcs-midi:permission");
      await core.request();
      await flush();

      expect(permissions.descriptors[0]).toEqual({ name: "midi", sysex: true });
      expect(seen).toContain("granted");
    });

    it("設定変更由来の change を state に流す", async () => {
      installMidi();
      const permissions = installPermissions({ state: "granted" });
      const core = new MidiCore();
      await core.request();
      await flush();

      permissions.statuses[0].change("denied");

      expect(core.permission).toBe("denied");
    });

    it("descriptor を理解しないブラウザでは query 失敗を無視し request の結果を使う", async () => {
      installMidi();
      installPermissions({ reject: true });
      const core = new MidiCore();
      await core.request();
      await flush();

      expect(core.permission).toBe("granted");
    });

    it("Permissions API 不在でも request の結果から permission が決まる", async () => {
      installMidi();
      removePermissions();
      const core = new MidiCore();
      await core.request();
      expect(core.permission).toBe("granted");
    });

    it("query 解決前に dispose すると listener を張らない", async () => {
      installMidi();
      const permissions = installPermissions({ state: "granted" });
      const core = new MidiCore();
      core.request();
      core.dispose();
      await flush();

      expect(permissions.statuses[0]).toBeDefined();
      permissions.statuses[0].change("denied");
      expect(core.permission).toBe("prompt");
    });

    it("2回目の request では query を撃ち直さない（購読済み）", async () => {
      installMidi();
      const permissions = installPermissions({ state: "granted" });
      const core = new MidiCore();
      await core.request();
      await flush();
      await core.request();
      await flush();

      expect(permissions.query).toHaveBeenCalledTimes(1);
    });
  });

  describe("observe() / dispose()", () => {
    it("auto 無しの observe は request しない", async () => {
      const mock = installMidi();
      const core = new MidiCore();
      await core.observe({ input: "in-1" });
      expect(mock.requestMIDIAccess).not.toHaveBeenCalled();
    });

    it("auto 付きの observe は request する", async () => {
      const mock = installMidi();
      const core = new MidiCore();
      await core.observe({ auto: true });
      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(1);
      expect(core.connected).toBe(true);
    });

    it("access 取得済みなら auto 付き observe でも再 request しない", async () => {
      const mock = installMidi();
      const core = new MidiCore();
      await core.observe({ auto: true });
      await core.observe({ auto: true, input: "in-1" });
      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(1);
    });

    it("dispose で全ポートの購読と statechange が外れる", async () => {
      const access = new FakeMidiAccess();
      const input = new FakeMidiInput("in-1");
      access.inputs.set(input.id, input);
      installMidi({ access });
      const core = new MidiCore();
      const messages = record(core, "wcs-midi:message");
      await core.request();

      core.dispose();

      expect(input.onmidimessage).toBeNull();
      expect(access.onstatechange).toBeNull();
      expect(core.connected).toBe(false);
      input.emit([0x90, 60, 100]);
      expect(messages).toHaveLength(0);
    });

    it("access 未取得でも dispose は安全", () => {
      const core = new MidiCore();
      expect(() => core.dispose()).not.toThrow();
    });

    it("permission 購読後の dispose は change listener も外す", async () => {
      installMidi();
      const permissions = installPermissions({ state: "granted" });
      const core = new MidiCore();
      await core.request();
      await flush();

      core.dispose();
      permissions.statuses[0].change("denied");

      expect(core.permission).toBe("granted");
    });
  });

  describe("同値ガード", () => {
    it("connected は変化時だけ発火する", async () => {
      installMidi();
      const core = new MidiCore();
      const seen = record(core, "wcs-midi:statechange");
      await core.request();
      core.close();
      core.close();
      expect(seen).toEqual([true, false]);
    });

    it("error は同じ値なら再発火しない・回復で null に戻る", async () => {
      const access = new FakeMidiAccess();
      const out = new FakeMidiOutput("out-1");
      out.throwOnSend = new Error("boom");
      access.outputs.set(out.id, out);
      installMidi({ access });
      const core = new MidiCore();
      await core.request();
      const seen = record(core, "wcs-midi:error");

      core.send([0x90, 60, 100]);
      core.send([0x90, 60, 100]);

      expect(seen).toEqual(["boom"]);

      out.throwOnSend = null;
      await core.request();
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("errorInfo は error と同時に遷移する", async () => {
      installMidi({ reject: new Error("nope") });
      const core = new MidiCore();
      const seen = record(core, "wcs-midi:error-info-changed");
      await core.request();
      expect(seen).toHaveLength(1);
      expect(seen[0].code).toBe("access-error");
    });
  });

  describe("wcBindable 宣言", () => {
    it("message 系は semantics=event、状態系は semantics=state", () => {
      const byName = new Map(MidiCore.wcBindable.properties.map((p) => [p.name, p]));
      expect(byName.get("message")!.semantics).toBe("event");
      expect(byName.get("note")!.semantics).toBe("event");
      expect(byName.get("devices")!.semantics).toBe("state");
      expect(byName.get("permission")!.semantics).toBe("state");
    });

    it("派生 getter は message イベントからフィールドを取り出す", () => {
      const byName = new Map(MidiCore.wcBindable.properties.map((p) => [p.name, p]));
      const event = new CustomEvent("wcs-midi:message", { detail: { note: 64, velocity: 0.5 } });
      expect(byName.get("note")!.getter!(event)).toBe(64);
      expect(byName.get("velocity")!.getter!(event)).toBe(0.5);
      expect(byName.get("control")!.getter!(new CustomEvent("x", { detail: null }))).toBeNull();
    });

    it("permission 由来の boolean getter が一致する", () => {
      const byName = new Map(MidiCore.wcBindable.properties.map((p) => [p.name, p]));
      const granted = new CustomEvent("wcs-midi:permission", { detail: "granted" });
      expect(byName.get("granted")!.getter!(granted)).toBe(true);
      expect(byName.get("denied")!.getter!(granted)).toBe(false);
      expect(byName.get("unsupported")!.getter!(new CustomEvent("x", { detail: "unsupported" }))).toBe(true);
    });

    it("commands は request / close / send の3つ", () => {
      expect(MidiCore.wcBindable.commands?.map((c) => c.name)).toEqual(["request", "close", "send"]);
    });
  });
});
