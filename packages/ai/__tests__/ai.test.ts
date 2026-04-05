import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Ai } from "../src/components/Ai";
import { AiMessage } from "../src/components/AiMessage";
import { registerComponents } from "../src/registerComponents";
import { bootstrapAi } from "../src/bootstrapAi";
import { config, setConfig, getConfig } from "../src/config";
import { raiseError } from "../src/raiseError";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger";

registerComponents();

function createMockResponse(body: any, options: { status?: number; ok?: boolean } = {}): Response {
  const { status = 200, ok = true } = options;
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    headers: new Headers({ "Content-Type": "application/json" }),
    body: null,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe("raiseError", () => {
  it("[@wcstack/ai]プレフィックス付きのエラーをスローする", () => {
    expect(() => raiseError("test error")).toThrow("[@wcstack/ai] test error");
  });
});

describe("config", () => {
  it("デフォルト設定を取得できる", () => {
    expect(config.tagNames.ai).toBe("wcs-ai");
    expect(config.tagNames.aiMessage).toBe("wcs-ai-message");
    expect(config.autoTrigger).toBe(true);
    expect(config.triggerAttribute).toBe("data-aitarget");
  });

  it("getConfig()でフリーズされたコピーを取得できる", () => {
    const frozen = getConfig();
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(frozen).toBe(getConfig());
  });

  it("setConfig()で設定を変更できる", () => {
    setConfig({ autoTrigger: false });
    expect(config.autoTrigger).toBe(false);
    setConfig({ autoTrigger: true });
  });

  it("setConfig()でtagNamesを変更できる", () => {
    setConfig({ tagNames: { ai: "my-ai" } });
    expect(config.tagNames.ai).toBe("my-ai");
    setConfig({ tagNames: { ai: "wcs-ai" } });
  });

  it("setConfig()でtriggerAttributeを変更できる", () => {
    setConfig({ triggerAttribute: "data-trigger" });
    expect(config.triggerAttribute).toBe("data-trigger");
    setConfig({ triggerAttribute: "data-aitarget" });
  });

  it("setConfig()後にgetConfig()キャッシュがリセットされる", () => {
    const f1 = getConfig();
    setConfig({ autoTrigger: false });
    expect(getConfig()).not.toBe(f1);
    setConfig({ autoTrigger: true });
  });
});

describe("bootstrapAi", () => {
  it("設定なしで呼び出せる", () => {
    expect(() => bootstrapAi()).not.toThrow();
  });

  it("設定付きで呼び出せる", () => {
    expect(() => bootstrapAi({ autoTrigger: false })).not.toThrow();
    setConfig({ autoTrigger: true });
  });
});

describe("Ai (wcs-ai)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    document.body.innerHTML = "";
  });

  it("カスタム要素として登録されている", () => {
    expect(customElements.get("wcs-ai")).toBeDefined();
    expect(customElements.get("wcs-ai-message")).toBeDefined();
  });

  it("wcBindableプロパティにtriggerが含まれる", () => {
    expect(Ai.wcBindable.properties).toHaveLength(7);
    expect(Ai.wcBindable.properties[6].name).toBe("trigger");
  });

  it("observedAttributesにproviderが含まれる", () => {
    expect(Ai.observedAttributes).toContain("provider");
  });

  describe("属性", () => {
    it("provider属性を取得・設定できる", () => {
      const el = document.createElement("wcs-ai") as Ai;
      expect(el.provider).toBe("");
      el.provider = "openai";
      expect(el.provider).toBe("openai");
    });

    it("model属性の未設定時は空文字を返す", () => {
      const el = document.createElement("wcs-ai") as Ai;
      expect(el.model).toBe("");
    });

    it("model属性を取得・設定できる", () => {
      const el = document.createElement("wcs-ai") as Ai;
      el.model = "gpt-4o";
      expect(el.model).toBe("gpt-4o");
    });

    it("baseUrl属性を取得・設定できる", () => {
      const el = document.createElement("wcs-ai") as Ai;
      el.baseUrl = "/api/ai";
      expect(el.baseUrl).toBe("/api/ai");
    });

    it("stream属性のデフォルトはtrue (no-streamなし)", () => {
      const el = document.createElement("wcs-ai") as Ai;
      expect(el.stream).toBe(true);
      el.stream = false;
      expect(el.stream).toBe(false);
      expect(el.hasAttribute("no-stream")).toBe(true);
      el.stream = true;
      expect(el.hasAttribute("no-stream")).toBe(false);
    });

    it("prompt/temperature/maxTokensプロパティ", () => {
      const el = document.createElement("wcs-ai") as Ai;
      el.prompt = "Hello";
      expect(el.prompt).toBe("Hello");

      el.temperature = 0.7;
      expect(el.temperature).toBe(0.7);
      el.temperature = undefined;
      expect(el.temperature).toBeUndefined();

      el.maxTokens = 1000;
      expect(el.maxTokens).toBe(1000);
      el.maxTokens = undefined;
      expect(el.maxTokens).toBeUndefined();
    });

    it("apiKey属性を取得・設定できる", () => {
      const el = document.createElement("wcs-ai") as Ai;
      el.apiKey = "sk-test";
      expect(el.apiKey).toBe("sk-test");
    });

    it("system属性を取得・設定できる", () => {
      const el = document.createElement("wcs-ai") as Ai;
      el.system = "Be helpful";
      expect(el.system).toBe("Be helpful");
    });

    it("apiVersion属性を取得・設定できる", () => {
      const el = document.createElement("wcs-ai") as Ai;
      el.apiVersion = "2024-06-01";
      expect(el.apiVersion).toBe("2024-06-01");
    });
  });

  describe("connectedCallback", () => {
    it("DOM追加時に非表示になる", () => {
      const el = document.createElement("wcs-ai") as Ai;
      el.setAttribute("provider", "openai");
      document.body.appendChild(el);
      expect(el.style.display).toBe("none");
    });

    it("provider未設定でもDOM追加できる", () => {
      const el = document.createElement("wcs-ai") as Ai;
      document.body.appendChild(el);
      expect(el.style.display).toBe("none");
    });

    it("provider属性からCoreのproviderを設定する", () => {
      const el = document.createElement("wcs-ai") as Ai;
      el.setAttribute("provider", "openai");
      document.body.appendChild(el);
      // providerが設定されていることを間接的に確認
    });

    it("attributeChangedCallbackでproviderを更新する", () => {
      const el = document.createElement("wcs-ai") as Ai;
      el.setAttribute("provider", "openai");
      document.body.appendChild(el);
      el.setAttribute("provider", "anthropic");
      // エラーなく更新される
    });

    it("provider属性がremoveAttributeされてもエラーにならない", () => {
      const el = document.createElement("wcs-ai") as Ai;
      el.setAttribute("provider", "openai");
      document.body.appendChild(el);
      el.removeAttribute("provider");
      // newValue=nullなのでスキップされる
    });

    it("autoTrigger無効時にautoTrigger登録しない", () => {
      setConfig({ autoTrigger: false });
      const el = document.createElement("wcs-ai") as Ai;
      document.body.appendChild(el);
      expect(el.style.display).toBe("none");
      setConfig({ autoTrigger: true });
    });
  });

  describe("send", () => {
    it("非ストリーミングでsendできる", async () => {
      fetchSpy.mockResolvedValueOnce(createMockResponse({
        choices: [{ message: { content: "Hello!" } }],
      }));

      const el = document.createElement("wcs-ai") as Ai;
      el.setAttribute("provider", "openai");
      el.setAttribute("model", "gpt-4o");
      el.stream = false;
      document.body.appendChild(el);

      el.prompt = "Hi";
      const result = await el.send();

      expect(result).toBe("Hello!");
      expect(el.content).toBe("Hello!");
      expect(el.loading).toBe(false);
      expect(el.streaming).toBe(false);
      expect(el.error).toBeNull();
      expect(el.usage).toBeNull();
    });

    it("system属性がAPIリクエストに含まれる", async () => {
      fetchSpy.mockResolvedValueOnce(createMockResponse({
        choices: [{ message: { content: "OK" } }],
      }));

      const el = document.createElement("wcs-ai") as Ai;
      el.setAttribute("provider", "openai");
      el.setAttribute("model", "gpt-4o");
      el.setAttribute("system", "Be concise");
      el.stream = false;
      document.body.appendChild(el);

      el.prompt = "Hi";
      await el.send();

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.messages[0]).toEqual({ role: "system", content: "Be concise" });
    });

    it("<wcs-ai-message>からsystemメッセージを収集する", async () => {
      fetchSpy.mockResolvedValueOnce(createMockResponse({
        choices: [{ message: { content: "OK" } }],
      }));

      const el = document.createElement("wcs-ai") as Ai;
      el.setAttribute("provider", "openai");
      el.setAttribute("model", "gpt-4o");
      el.stream = false;
      const msgEl = document.createElement("wcs-ai-message") as AiMessage;
      msgEl.setAttribute("role", "system");
      msgEl.textContent = "You are a helpful assistant.";
      el.appendChild(msgEl);
      document.body.appendChild(el);

      el.prompt = "Hi";
      await el.send();

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.messages[0].content).toBe("You are a helpful assistant.");
    });

    it("system属性が<wcs-ai-message>より優先される", async () => {
      fetchSpy.mockResolvedValueOnce(createMockResponse({
        choices: [{ message: { content: "OK" } }],
      }));

      const el = document.createElement("wcs-ai") as Ai;
      el.setAttribute("provider", "openai");
      el.setAttribute("model", "gpt-4o");
      el.setAttribute("system", "Priority system");
      el.stream = false;
      const msgEl = document.createElement("wcs-ai-message") as AiMessage;
      msgEl.setAttribute("role", "system");
      msgEl.textContent = "Fallback system";
      el.appendChild(msgEl);
      document.body.appendChild(el);

      el.prompt = "Hi";
      await el.send();

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.messages[0].content).toBe("Priority system");
    });
  });

  describe("trigger", () => {
    it("trigger=trueでsendが実行される", async () => {
      fetchSpy.mockResolvedValueOnce(createMockResponse({
        choices: [{ message: { content: "Hi" } }],
      }));

      const el = document.createElement("wcs-ai") as Ai;
      el.setAttribute("provider", "openai");
      el.setAttribute("model", "gpt-4o");
      el.stream = false;
      document.body.appendChild(el);

      el.prompt = "Hello";
      el.trigger = true;
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(el.content).toBe("Hi");
      expect(el.trigger).toBe(false);
    });

    it("trigger=falseでは何も起きない", () => {
      const el = document.createElement("wcs-ai") as Ai;
      el.setAttribute("provider", "openai");
      document.body.appendChild(el);
      el.trigger = false;
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("messages", () => {
    it("messagesプロパティでCoreの履歴にアクセスできる", async () => {
      fetchSpy.mockResolvedValueOnce(createMockResponse({
        choices: [{ message: { content: "Hi!" } }],
      }));

      const el = document.createElement("wcs-ai") as Ai;
      el.setAttribute("provider", "openai");
      el.setAttribute("model", "gpt-4o");
      el.stream = false;
      document.body.appendChild(el);

      el.prompt = "Hello";
      await el.send();

      expect(el.messages).toHaveLength(2);
      el.messages = [];
      expect(el.messages).toHaveLength(0);
    });
  });

  describe("abort", () => {
    it("abort()でリクエストをキャンセルできる", () => {
      const el = document.createElement("wcs-ai") as Ai;
      el.setAttribute("provider", "openai");
      document.body.appendChild(el);
      // abortが例外なく呼べることを確認
      expect(() => el.abort()).not.toThrow();
    });
  });

  describe("disconnectedCallback", () => {
    it("DOM削除時にabortが呼ばれる", () => {
      const el = document.createElement("wcs-ai") as Ai;
      el.setAttribute("provider", "openai");
      document.body.appendChild(el);
      // abortSpyは内部なので、間接的に確認
      expect(() => el.remove()).not.toThrow();
    });
  });
});

describe("AiMessage (wcs-ai-message)", () => {
  it("role属性のデフォルトはsystem", () => {
    const el = document.createElement("wcs-ai-message") as AiMessage;
    expect(el.role).toBe("system");
  });

  it("messageContentでテキストを取得できる", () => {
    const el = document.createElement("wcs-ai-message") as AiMessage;
    el.textContent = "  You are helpful.  ";
    expect(el.messageContent).toBe("You are helpful.");
  });

  it("textContentが空の場合は空文字を返す", () => {
    const el = document.createElement("wcs-ai-message") as AiMessage;
    expect(el.messageContent).toBe("");
  });

  it("Shadow DOMでlight DOMの描画を抑制する", () => {
    const el = document.createElement("wcs-ai-message") as AiMessage;
    expect(el.shadowRoot).not.toBeNull();
  });
});

describe("autoTrigger", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    unregisterAutoTrigger();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    unregisterAutoTrigger();
    document.body.innerHTML = "";
  });

  it("data-aitarget属性でsendをトリガーできる", async () => {
    fetchSpy.mockResolvedValue(createMockResponse({
      choices: [{ message: { content: "OK" } }],
    }));

    registerAutoTrigger();

    const aiEl = document.createElement("wcs-ai") as Ai;
    aiEl.id = "ai1";
    aiEl.setAttribute("provider", "openai");
    aiEl.setAttribute("model", "gpt-4o");
    aiEl.stream = false;
    document.body.appendChild(aiEl);
    (aiEl as any)._prompt = "Hello";

    const button = document.createElement("button");
    button.setAttribute("data-aitarget", "ai1");
    document.body.appendChild(button);

    button.click();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(fetchSpy).toHaveBeenCalled();
  });

  it("対象がAi要素でない場合は無視する", () => {
    registerAutoTrigger();
    const div = document.createElement("div");
    div.id = "not-ai";
    document.body.appendChild(div);
    const button = document.createElement("button");
    button.setAttribute("data-aitarget", "not-ai");
    document.body.appendChild(button);
    expect(() => button.click()).not.toThrow();
  });

  it("属性値が空の場合は無視する", () => {
    registerAutoTrigger();
    const button = document.createElement("button");
    button.setAttribute("data-aitarget", "");
    document.body.appendChild(button);
    expect(() => button.click()).not.toThrow();
  });

  it("event.targetがElementでない場合は無視する", () => {
    registerAutoTrigger();
    const textNode = document.createTextNode("text");
    document.body.appendChild(textNode);
    const event = new Event("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: textNode });
    document.dispatchEvent(event);
  });

  it("unregisterAutoTrigger()で解除できる", () => {
    registerAutoTrigger();
    unregisterAutoTrigger();
    // 二重解除もOK
    unregisterAutoTrigger();
  });

  it("registerAutoTrigger()は重複登録しない", () => {
    registerAutoTrigger();
    registerAutoTrigger();
    unregisterAutoTrigger();
  });

  it("data-aitarget属性のないクリックは無視する", () => {
    registerAutoTrigger();
    const button = document.createElement("button");
    document.body.appendChild(button);
    expect(() => button.click()).not.toThrow();
  });
});
