import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { WcsMidi } from "../src/components/Midi";
import { MidiCore } from "../src/core/MidiCore";
import { registerComponents } from "../src/registerComponents";
import {
  FakeMidiAccess, FakeMidiInput, FakeMidiOutput,
  installMidi, removeMidi, installPermissions, removePermissions, record, flush,
} from "./mocks";

const make = (attrs: Record<string, string> = {}): WcsMidi => {
  const el = document.createElement("wcs-midi") as WcsMidi;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
};

const mount = (el: WcsMidi): WcsMidi => {
  document.body.appendChild(el);
  return el;
};

describe("<wcs-midi>", () => {
  beforeAll(() => {
    registerComponents();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    removePermissions();
    removeMidi();
    vi.restoreAllMocks();
  });

  describe("接続と自動要求", () => {
    it("接続しただけでは request しない", async () => {
      const mock = installMidi();
      const el = mount(make());
      await el.connectedCallbackPromise;
      expect(mock.requestMIDIAccess).not.toHaveBeenCalled();
    });

    it("auto 属性付きなら接続時に request する", async () => {
      const mock = installMidi();
      const el = mount(make({ auto: "" }));
      await el.connectedCallbackPromise;
      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(1);
      expect(el.connected).toBe(true);
    });

    it("command.request で明示的に取得できる", async () => {
      installMidi();
      const el = mount(make());
      await el.request();
      expect(el.connected).toBe(true);
      expect(el.granted).toBe(true);
    });

    it("connectedCallbackPromise は SSR 用に await できる", async () => {
      installMidi();
      const el = mount(make({ auto: "" }));
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    });

    it("display:none を自分で設定する（描画を持たない）", () => {
      installMidi();
      const el = mount(make());
      expect(el.style.display).toBe("none");
    });

    it("切断で購読が外れる", async () => {
      const access = new FakeMidiAccess();
      const input = new FakeMidiInput("in-1");
      access.inputs.set(input.id, input);
      installMidi({ access });
      const el = mount(make({ auto: "" }));
      await el.connectedCallbackPromise;

      el.remove();

      expect(input.onmidimessage).toBeNull();
      expect(el.connected).toBe(false);
    });
  });

  // router は遷移で同じノードを入れ直し、state は新しい params からの入力をマイクロタスクで書く
  // （timing-and-firing-contract §23、docs/seam-apps.md の shift-desk）
  describe("要求の判断はマイクロタスクで、そのときの入力で", () => {
    it("入れ直しの間に sysex が書かれると、前の sysex では要求せず、新しい sysex で 1 回だけ要求する", async () => {
      const mock = installMidi();
      const el = mount(make({ auto: "" }));
      await el.connectedCallbackPromise;
      expect(mock.calls).toEqual([{ sysex: false }]);

      // state のマイクロタスクは、router が中身を入れ直す前に積まれている
      queueMicrotask(() => { el.sysex = true; });
      el.remove();
      document.body.appendChild(el);
      await el.connectedCallbackPromise;
      expect(mock.calls).toEqual([{ sysex: false }, { sysex: true }]);
      expect(el.connected).toBe(true);
    });

    it("入れ直しの間に auto が外されると、要求しない", async () => {
      const mock = installMidi();
      const el = mount(make({ auto: "" }));
      await el.connectedCallbackPromise;

      queueMicrotask(() => { el.auto = false; });
      el.remove();
      document.body.appendChild(el);
      await el.connectedCallbackPromise;
      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(1);
      expect(el.connected).toBe(false);
    });

    it("判断の前に外した要素は要求せず、connectedCallbackPromise も解ける", async () => {
      const mock = installMidi();
      const el = mount(make({ auto: "" }));
      el.remove();
      await el.connectedCallbackPromise;
      await flush();
      expect(mock.requestMIDIAccess).not.toHaveBeenCalled();
    });

    it("同じタスクで接続の後に auto が書かれると、要求する", async () => {
      const mock = installMidi();
      const el = mount(make());
      el.auto = true;
      await el.connectedCallbackPromise;
      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(1);
      expect(el.connected).toBe(true);
    });

    it("同じタスクで接続の後に auto が外されると、要求しない", async () => {
      const mock = installMidi();
      const el = mount(make({ auto: "" }));
      el.auto = false;
      await el.connectedCallbackPromise;
      expect(mock.requestMIDIAccess).not.toHaveBeenCalled();
    });

    it("同じタスクで接続の後に close() が呼ばれると、auto でも要求しない", async () => {
      const mock = installMidi();
      const el = mount(make({ auto: "" }));
      el.close();
      await el.connectedCallbackPromise;
      await flush();
      expect(mock.requestMIDIAccess).not.toHaveBeenCalled();
      expect(el.connected).toBe(false);
    });

    it("close() の後に同じタスクで入れ直すと、次の判断は auto に従って要求する", async () => {
      const mock = installMidi();
      const el = mount(make({ auto: "" }));
      el.close();
      el.remove();
      document.body.appendChild(el);
      await el.connectedCallbackPromise;
      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(1);
      expect(el.connected).toBe(true);
    });

    it("close() で取り消した判断の後の接続は、また auto に従う", async () => {
      const mock = installMidi();
      const el = mount(make({ auto: "" }));
      el.close();
      await el.connectedCallbackPromise;
      el.remove();
      document.body.appendChild(el);
      await el.connectedCallbackPromise;
      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(1);
      expect(el.connected).toBe(true);
    });

    it("判断の前の request() も、いまの sysex で要求する", async () => {
      const mock = installMidi();
      const el = mount(make({ sysex: "" }));
      await el.request();
      expect(mock.calls).toEqual([{ sysex: true }]);
      expect(el.connected).toBe(true);
    });

    it("接続の後に変えた sysex も、request() が要求に使う", async () => {
      const mock = installMidi();
      const el = mount(make());
      await el.connectedCallbackPromise;
      el.sysex = true;
      await el.request();
      expect(mock.calls).toEqual([{ sysex: true }]);
    });

    it("同じタスクで接続の後に request() が呼ばれると、auto でも要求は 1 回だけ（§23.3）", async () => {
      const mock = installMidi();
      const el = mount(make({ auto: "" }));
      const explicit = el.request();
      await el.connectedCallbackPromise;
      await explicit;
      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(1);
      expect(el.connected).toBe(true);
    });
  });

  // router はルートを出るとその要素を文書から外し、入り直すと同じ要素を戻す。state は束縛を
  // 保ち、出力の値をイベントからしか知らない（timing-and-firing-contract §22 / §23、決定 Q2）
  describe("ルートを出て戻る（外して入れ直す）", () => {
    const keyboard = (): { access: FakeMidiAccess; input: FakeMidiInput } => {
      const access = new FakeMidiAccess();
      const input = new FakeMidiInput("in-1", "Keystation 49");
      access.inputs.set(input.id, input);
      access.outputs.set("out-1", new FakeMidiOutput("out-1", "Keystation 49"));
      return { access, input };
    };

    it("外すと connected: false と devices: [] を知らせる。permission は変えない（§22）", async () => {
      installMidi();
      removePermissions();
      const el = mount(make());
      await el.request();
      expect(el.devices).toHaveLength(2);
      const devices = record(el, "wcs-midi:devices");
      const connected = record(el, "wcs-midi:statechange");
      const permission = record(el, "wcs-midi:permission");

      el.remove();

      expect(connected).toEqual([false]);
      expect(devices).toEqual([[]]);
      expect(el.devices).toEqual([]);
      expect(permission).toEqual([]);
      expect(el.permission).toBe("granted");
    });

    it("request() で取った要素は、戻すと自分で取り直し、メッセージが届く", async () => {
      const { access, input } = keyboard();
      const mock = installMidi({ access });
      removePermissions();
      const el = mount(make());
      await el.request();
      el.remove();

      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(2);
      expect(el.connected).toBe(true);
      expect(el.devices.map((d) => d.id)).toEqual(["in-1", "out-1"]);
      const seen = record(el, "wcs-midi:message");
      input.emit([0x90, 60, 100]);
      expect(seen).toHaveLength(1);
      expect(seen[0].type).toBe("noteon");
    });

    it("query が granted と答えるなら取り直す", async () => {
      const mock = installMidi();
      const permissions = installPermissions({ state: "granted" });
      const el = mount(make());
      await el.request();
      await flush();
      el.remove();

      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      expect(permissions.descriptors.at(-1)).toEqual({ name: "midi", sysex: false });
      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(2);
      expect(el.connected).toBe(true);
    });

    it.each(["prompt", "denied"])("外れている間に権限が %s になれば、戻しても要求しない（プロンプトを出さない）", async (state) => {
      const mock = installMidi();
      installPermissions({ state: "granted" });
      const el = mount(make());
      await el.request();
      await flush();
      el.remove();
      installPermissions({ state });

      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(1);
      expect(el.connected).toBe(false);
      expect(el.devices).toEqual([]);
    });

    it("sysex で取った要素は、sysex の権限がまだ granted なら sysex で取り直す", async () => {
      const mock = installMidi();
      const permissions = installPermissions({ state: "granted" });
      const el = mount(make({ sysex: "" }));
      await el.request();
      await flush();
      el.remove();

      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      expect(permissions.descriptors.at(-1)).toEqual({ name: "midi", sysex: true });
      expect(mock.calls).toEqual([{ sysex: true }, { sysex: true }]);
      expect(el.connected).toBe(true);
    });

    it("入れ直しの間に書かれた sysex で権限を尋ね、その sysex で取り直す（§23）", async () => {
      const mock = installMidi();
      const permissions = installPermissions({ state: "granted" });
      const el = mount(make());
      await el.request();
      await flush();

      // state のマイクロタスクは、router が中身を入れ直す前に積まれている
      queueMicrotask(() => { el.sysex = true; });
      el.remove();
      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      expect(permissions.descriptors.at(-1)).toEqual({ name: "midi", sysex: true });
      expect(mock.calls).toEqual([{ sysex: false }, { sysex: true }]);
    });

    it("一度も request() していない要素は、戻しても要求しない", async () => {
      const mock = installMidi();
      removePermissions();
      const el = mount(make());
      await el.connectedCallbackPromise;
      el.remove();

      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      expect(mock.requestMIDIAccess).not.toHaveBeenCalled();
    });

    it("close() で手放してから外した要素は、戻しても要求しない", async () => {
      const mock = installMidi();
      removePermissions();
      const el = mount(make());
      await el.request();
      el.close();
      el.remove();

      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(1);
      expect(el.connected).toBe(false);
    });

    it("戻したのと同じタスクの close() は取り直しを取り消す（§23.3）", async () => {
      const mock = installMidi();
      removePermissions();
      const el = mount(make());
      await el.request();
      el.remove();

      document.body.appendChild(el);
      el.close();
      await el.connectedCallbackPromise;
      await flush();

      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(1);
      expect(el.connected).toBe(false);
    });

    it("戻したのと同じタスクの request() が判断を引き取り、要求は 1 回だけ", async () => {
      const mock = installMidi();
      removePermissions();
      const el = mount(make());
      await el.request();
      el.remove();

      document.body.appendChild(el);
      const explicit = el.request();
      await el.connectedCallbackPromise;
      await explicit;
      await flush();

      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(2);
      expect(el.connected).toBe(true);
    });

    it("権限の答えを待つ間にまた外すと要求せず、次に戻せば取り直す", async () => {
      const mock = installMidi();
      installPermissions({ state: "granted" });
      const el = mount(make());
      await el.request();
      await flush();
      el.remove();

      document.body.appendChild(el);
      await Promise.resolve(); // 判断のマイクロタスク（query を投げる）
      el.remove();
      await flush();
      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(1);

      document.body.appendChild(el);
      await el.connectedCallbackPromise;
      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(2);
      expect(el.connected).toBe(true);
    });

    it("取り直しが拒否された要素は、次に戻しても要求しない", async () => {
      const mock = installMidi();
      removePermissions();
      const el = mount(make());
      await el.request();
      el.remove();
      mock.requestMIDIAccess.mockImplementation((options: any) => {
        mock.calls.push(options);
        return Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" }));
      });

      document.body.appendChild(el);
      await el.connectedCallbackPromise;
      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(2);
      expect(el.denied).toBe(true);
      el.remove();
      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(2);
    });
  });

  describe("属性 ↔ プロパティ", () => {
    it("input / output は属性と往復する", () => {
      const el = make();
      expect(el.input).toBe("");
      el.input = "Launchkey";
      expect(el.getAttribute("input")).toBe("Launchkey");
      el.output = "Synth";
      expect(el.output).toBe("Synth");
    });

    it("channel は数値として読み書きでき、null で属性が消える", () => {
      const el = make();
      expect(el.channel).toBeNull();
      el.channel = 5;
      expect(el.getAttribute("channel")).toBe("5");
      expect(el.channel).toBe(5);
      el.channel = null;
      expect(el.hasAttribute("channel")).toBe(false);
    });

    it("数値でない channel 属性は null として扱う", () => {
      const el = make({ channel: "abc" });
      expect(el.channel).toBeNull();
    });

    it("sysex / auto は boolean 属性として往復する", () => {
      const el = make();
      expect(el.sysex).toBe(false);
      el.sysex = true;
      expect(el.hasAttribute("sysex")).toBe(true);
      el.sysex = false;
      expect(el.hasAttribute("sysex")).toBe(false);
      el.auto = true;
      expect(el.auto).toBe(true);
    });

    it("undefined はマークアップに書かれた属性へ戻し、null は属性を外す（P1 / P2）", () => {
      const host = document.createElement("div");
      host.innerHTML = '<wcs-midi input="Launchkey" output="Synth" channel="3" sysex auto></wcs-midi>';
      const el = host.firstElementChild as WcsMidi;
      el.input = "Other";
      el.output = "Other";
      el.channel = 5;
      el.sysex = false;
      el.auto = false;
      el.input = undefined;
      el.output = undefined;
      el.channel = undefined;
      el.sysex = undefined;
      el.auto = undefined;
      expect(el.input).toBe("Launchkey");
      expect(el.output).toBe("Synth");
      expect(el.channel).toBe(3);
      expect(el.sysex).toBe(true);
      expect(el.auto).toBe(true);
      // toggleAttribute と違い undefined を何度書いても反転しない
      el.sysex = undefined;
      el.auto = undefined;
      expect(el.sysex).toBe(true);
      expect(el.auto).toBe(true);
      el.input = null;
      el.output = null;
      el.channel = null;
      el.sysex = null;
      el.auto = null;
      for (const name of ["input", "output", "channel", "sysex", "auto"]) {
        expect(el.hasAttribute(name)).toBe(false);
      }
      expect(el.input).toBe("");
      expect(el.channel).toBeNull();
    });

    it("属性の無い要素に undefined を書いても属性は付かない（文字列 \"undefined\" にも反転にもならない）", () => {
      const el = make();
      el.input = undefined;
      el.channel = undefined;
      el.sysex = undefined;
      el.auto = undefined;
      for (const name of ["input", "channel", "sysex", "auto"]) {
        expect(el.hasAttribute(name)).toBe(false);
      }
    });

    it("sysex 属性は requestMIDIAccess に渡る", async () => {
      const mock = installMidi();
      const el = mount(make({ auto: "", sysex: "" }));
      await el.connectedCallbackPromise;
      expect(mock.calls[0]).toEqual({ sysex: true });
    });

    it("upgrade 前に代入されたプロパティが取り込まれる", async () => {
      const mock = installMidi();
      const el = document.createElement("wcs-midi") as WcsMidi;
      // 未 upgrade 相当: own データプロパティで accessor をシャドウする
      delete (el as any).input;
      Object.defineProperty(el, "input", { value: "Launchkey", writable: true, configurable: true });
      mount(el);
      await el.connectedCallbackPromise;
      expect(el.getAttribute("input")).toBe("Launchkey");
      expect(mock.requestMIDIAccess).not.toHaveBeenCalled();
    });
  });

  describe("属性の live 更新", () => {
    it("接続中の input 変更は再 request せず購読を張り替える", async () => {
      const access = new FakeMidiAccess();
      access.inputs.set("a", new FakeMidiInput("a", "Alpha"));
      access.inputs.set("b", new FakeMidiInput("b", "Beta"));
      const mock = installMidi({ access });
      const el = mount(make({ auto: "", input: "a" }));
      await el.connectedCallbackPromise;
      const seen = record(el, "wcs-midi:message");

      el.setAttribute("input", "b");
      access.inputs.get("a")!.emit([0x90, 60, 100]);
      access.inputs.get("b")!.emit([0x90, 62, 100]);

      expect(mock.requestMIDIAccess).toHaveBeenCalledTimes(1);
      expect(seen).toHaveLength(1);
      expect(seen[0].note).toBe(62);
    });

    it("同じ値への setAttribute は何もしない", async () => {
      installMidi();
      const el = mount(make({ auto: "", channel: "3" }));
      await el.connectedCallbackPromise;
      const spy = vi.spyOn(el.core, "setOptions");
      el.setAttribute("channel", "3");
      expect(spy).not.toHaveBeenCalled();
    });

    it("未接続での属性変更は Core に触らない", () => {
      installMidi();
      const el = make();
      const spy = vi.spyOn(el.core, "setOptions");
      el.setAttribute("input", "a");
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("委譲", () => {
    it("Core の観測値をそのまま返す", async () => {
      const access = new FakeMidiAccess();
      const input = new FakeMidiInput("in-1", "Keys");
      access.inputs.set(input.id, input);
      installMidi({ access });
      const el = mount(make({ auto: "" }));
      await el.connectedCallbackPromise;

      input.emit([0xb0, 7, 100]);

      expect(el.type).toBe("controlchange");
      expect(el.control).toBe(7);
      expect(el.value).toBe(100);
      expect(el.note).toBeNull();
      expect(el.velocity).toBeNull();
      expect(el.message?.portName).toBe("Keys");
      expect(el.devices).toHaveLength(1);
      expect(el.permission).toBe("granted");
      expect(el.denied).toBe(false);
      expect(el.unsupported).toBe(false);
      expect(el.error).toBeNull();
      expect(el.errorInfo).toBeNull();
    });

    it("command.send は Core へ素通しする（位置引数保持）", async () => {
      const access = new FakeMidiAccess();
      const out = new FakeMidiOutput("out-1");
      access.outputs.set(out.id, out);
      installMidi({ access });
      const el = mount(make({ auto: "" }));
      await el.connectedCallbackPromise;

      el.send([0x90, 60, 100], 99);

      expect(out.sent).toEqual([{ data: [0x90, 60, 100], timestamp: 99 }]);
    });

    it("command.close で切断できる", async () => {
      installMidi();
      const el = mount(make({ auto: "" }));
      await el.connectedCallbackPromise;
      el.close();
      expect(el.connected).toBe(false);
    });

    it("core getter でヘッドレス Core に到達できる", () => {
      const el = make();
      expect(el.core).toBeInstanceOf(MidiCore);
    });

    it("非対応環境では unsupported が立つ", async () => {
      removeMidi();
      const el = mount(make({ auto: "" }));
      await el.connectedCallbackPromise;
      expect(el.unsupported).toBe(true);
      expect(el.error).toBe("unsupported");
      expect(el.errorInfo?.code).toBe("capability-missing");
    });

    // API が無ければプロンプトも無い — request() を待たず接続で知らせる（v4-direction §5.3）
    it("非対応環境では auto が無くても接続で unsupported を知らせる", async () => {
      removeMidi();
      const el = make();
      const permission = record(el, "wcs-midi:permission");
      const errorInfo = record(el, "wcs-midi:error-info-changed");
      mount(el);
      await el.connectedCallbackPromise;
      expect(permission).toEqual(["unsupported"]);
      expect(el.permission).toBe("unsupported");
      expect(el.error).toBe("unsupported");
      expect(errorInfo.map((info) => info?.code)).toEqual(["capability-missing"]);
    });

    it("判断の前に外した非対応環境の要素は何も報告しない", async () => {
      removeMidi();
      const el = make();
      const permission = record(el, "wcs-midi:permission");
      mount(el);
      el.remove();
      await el.connectedCallbackPromise;
      await flush();
      expect(permission).toEqual([]);
      expect(el.permission).toBe("prompt");
    });
  });

  describe("wcBindable 宣言", () => {
    it("Core の properties を継承しつつ inputs を足す", () => {
      expect(WcsMidi.wcBindable.properties).toBe(MidiCore.wcBindable.properties);
      expect(WcsMidi.wcBindable.inputs?.map((i) => i.name)).toEqual([
        "input", "output", "channel", "sysex", "auto",
      ]);
    });

    it("hasConnectedCallbackPromise を宣言する（SSR 用）", () => {
      expect(WcsMidi.hasConnectedCallbackPromise).toBe(true);
    });

    it("observedAttributes は live 更新できる3つ", () => {
      expect(WcsMidi.observedAttributes).toEqual(["input", "output", "channel"]);
    });
  });
});
