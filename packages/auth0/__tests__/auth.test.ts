import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Auth } from "../src/components/Auth";
import { AuthLogout } from "../src/components/AuthLogout";
import { registerComponents } from "../src/registerComponents";
import { bootstrapAuth } from "../src/bootstrapAuth";
import { config, setConfig, getConfig } from "../src/config";
import { raiseError } from "../src/raiseError";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger";

// registerComponents経由でカスタム要素を登録
registerComponents();

function createMockAuth0Client(overrides: Record<string, any> = {}) {
  return {
    isAuthenticated: vi.fn().mockResolvedValue(false),
    getUser: vi.fn().mockResolvedValue(null),
    getTokenSilently: vi.fn().mockResolvedValue("test-token"),
    loginWithRedirect: vi.fn().mockResolvedValue(undefined),
    loginWithPopup: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    handleRedirectCallback: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// @auth0/auth0-spa-jsのモック
vi.mock("@auth0/auth0-spa-js", () => ({
  createAuth0Client: vi.fn(),
}));

describe("raiseError", () => {
  it("[@wcstack/auth0]プレフィックス付きのエラーをスローする", () => {
    expect(() => raiseError("test error")).toThrow("[@wcstack/auth0] test error");
  });
});

describe("config", () => {
  it("デフォルト設定を取得できる", () => {
    expect(config.tagNames.auth).toBe("wcs-auth");
    expect(config.tagNames.authLogout).toBe("wcs-auth-logout");
    expect(config.autoTrigger).toBe(true);
    expect(config.triggerAttribute).toBe("data-authtarget");
  });

  it("getConfig()でフリーズされたコピーを取得できる", () => {
    const frozen = getConfig();
    expect(frozen.tagNames.auth).toBe("wcs-auth");
    expect(Object.isFrozen(frozen)).toBe(true);
    const frozen2 = getConfig();
    expect(frozen).toBe(frozen2);
  });

  it("setConfig()で部分的に設定を変更できる", () => {
    setConfig({ autoTrigger: false });
    expect(config.autoTrigger).toBe(false);
    setConfig({ autoTrigger: true });
    expect(config.autoTrigger).toBe(true);
  });

  it("setConfig()でtagNamesを変更できる", () => {
    setConfig({ tagNames: { auth: "my-auth" } });
    expect(config.tagNames.auth).toBe("my-auth");
    setConfig({ tagNames: { auth: "wcs-auth" } });
  });

  it("setConfig()でtriggerAttributeを変更できる", () => {
    setConfig({ triggerAttribute: "data-trigger" });
    expect(config.triggerAttribute).toBe("data-trigger");
    setConfig({ triggerAttribute: "data-authtarget" });
  });

  it("setConfig()後にgetConfig()のキャッシュがリセットされる", () => {
    const frozen1 = getConfig();
    setConfig({ autoTrigger: false });
    const frozen2 = getConfig();
    expect(frozen1).not.toBe(frozen2);
    setConfig({ autoTrigger: true });
  });
});

describe("bootstrapAuth", () => {
  it("設定なしで呼び出せる", () => {
    expect(() => bootstrapAuth()).not.toThrow();
  });

  it("設定付きで呼び出せる", () => {
    expect(() => bootstrapAuth({ autoTrigger: false })).not.toThrow();
    setConfig({ autoTrigger: true });
  });
});

describe("Auth (wcs-auth)", () => {
  let createAuth0Client: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import("@auth0/auth0-spa-js");
    createAuth0Client = (mod as any).createAuth0Client;
    createAuth0Client.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("カスタム要素として登録されている", () => {
    expect(customElements.get("wcs-auth")).toBeDefined();
  });

  it("wcBindableプロパティにtriggerが含まれる", () => {
    expect(Auth.wcBindable.properties).toHaveLength(6);
    expect(Auth.wcBindable.properties[5].name).toBe("trigger");
  });

  it("hasConnectedCallbackPromiseがtrueである", () => {
    expect(Auth.hasConnectedCallbackPromise).toBe(true);
  });

  it("observedAttributesが正しい", () => {
    expect(Auth.observedAttributes).toEqual([
      "domain", "client-id", "redirect-uri", "audience", "scope"
    ]);
  });

  describe("属性", () => {
    it("domain属性を取得・設定できる", () => {
      const el = document.createElement("wcs-auth") as Auth;
      expect(el.domain).toBe("");
      el.domain = "test.auth0.com";
      expect(el.domain).toBe("test.auth0.com");
    });

    it("clientId属性を取得・設定できる", () => {
      const el = document.createElement("wcs-auth") as Auth;
      expect(el.clientId).toBe("");
      el.clientId = "my-client-id";
      expect(el.clientId).toBe("my-client-id");
    });

    it("redirectUri属性を取得・設定できる", () => {
      const el = document.createElement("wcs-auth") as Auth;
      expect(el.redirectUri).toBe("");
      el.redirectUri = "/callback";
      expect(el.redirectUri).toBe("/callback");
    });

    it("audience属性を取得・設定できる", () => {
      const el = document.createElement("wcs-auth") as Auth;
      expect(el.audience).toBe("");
      el.audience = "https://api.example.com";
      expect(el.audience).toBe("https://api.example.com");
    });

    it("scope属性のデフォルト値はopenid profile email", () => {
      const el = document.createElement("wcs-auth") as Auth;
      expect(el.scope).toBe("openid profile email");
      el.scope = "openid email";
      expect(el.scope).toBe("openid email");
    });

    it("cacheLocation属性のデフォルト値はmemory", () => {
      const el = document.createElement("wcs-auth") as Auth;
      expect(el.cacheLocation).toBe("memory");
      el.cacheLocation = "localstorage";
      expect(el.cacheLocation).toBe("localstorage");
    });

    it("useRefreshTokens属性を取得・設定できる", () => {
      const el = document.createElement("wcs-auth") as Auth;
      expect(el.useRefreshTokens).toBe(false);
      el.useRefreshTokens = true;
      expect(el.useRefreshTokens).toBe(true);
      el.useRefreshTokens = false;
      expect(el.useRefreshTokens).toBe(false);
    });

    it("popup属性を取得・設定できる", () => {
      const el = document.createElement("wcs-auth") as Auth;
      expect(el.popup).toBe(false);
      el.popup = true;
      expect(el.popup).toBe(true);
      el.popup = false;
      expect(el.popup).toBe(false);
    });
  });

  describe("connectedCallback", () => {
    it("DOM追加時に非表示になる", () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValue(mockClient);

      const el = document.createElement("wcs-auth") as Auth;
      el.setAttribute("domain", "test.auth0.com");
      el.setAttribute("client-id", "client-id");
      document.body.appendChild(el);

      expect(el.style.display).toBe("none");
    });

    it("domain/clientIdが設定されていれば自動初期化する", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValue(mockClient);

      const el = document.createElement("wcs-auth") as Auth;
      el.setAttribute("domain", "test.auth0.com");
      el.setAttribute("client-id", "client-id");
      document.body.appendChild(el);

      await el.connectedCallbackPromise;

      expect(createAuth0Client).toHaveBeenCalledWith(expect.objectContaining({
        domain: "test.auth0.com",
        clientId: "client-id",
      }));
    });

    it("domain未設定時は自動初期化しない", () => {
      const el = document.createElement("wcs-auth") as Auth;
      el.setAttribute("client-id", "client-id");
      document.body.appendChild(el);

      expect(createAuth0Client).not.toHaveBeenCalled();
    });

    it("再接続時に初期化が二重に走らない", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValue(mockClient);

      const el = document.createElement("wcs-auth") as Auth;
      el.setAttribute("domain", "test.auth0.com");
      el.setAttribute("client-id", "client-id");

      // 初回接続
      document.body.appendChild(el);
      await el.connectedCallbackPromise;
      expect(createAuth0Client).toHaveBeenCalledTimes(1);

      // 切断→再接続
      el.remove();
      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      // 2回目のcreateAuth0Client呼び出しがないことを確認
      expect(createAuth0Client).toHaveBeenCalledTimes(1);
    });
  });

  describe("出力状態（Coreへの委譲）", () => {
    it("authenticated, user, token, loading, errorがCoreから委譲される", async () => {
      const mockUser = { sub: "auth0|123", name: "Test" };
      const mockClient = createMockAuth0Client({
        isAuthenticated: vi.fn().mockResolvedValue(true),
        getUser: vi.fn().mockResolvedValue(mockUser),
        getTokenSilently: vi.fn().mockResolvedValue("access-token"),
      });
      createAuth0Client.mockResolvedValue(mockClient);

      const el = document.createElement("wcs-auth") as Auth;
      el.setAttribute("domain", "test.auth0.com");
      el.setAttribute("client-id", "client-id");
      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      expect(el.authenticated).toBe(true);
      expect(el.user).toEqual(mockUser);
      expect(el.token).toBe("access-token");
      expect(el.loading).toBe(false);
      expect(el.error).toBeNull();
    });
  });

  describe("trigger", () => {
    it("trigger=trueでloginが実行される", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValue(mockClient);

      const el = document.createElement("wcs-auth") as Auth;
      el.setAttribute("domain", "test.auth0.com");
      el.setAttribute("client-id", "client-id");
      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      const triggerEvents: boolean[] = [];
      el.addEventListener("wcs-auth:trigger-changed", (e: Event) => {
        triggerEvents.push((e as CustomEvent).detail);
      });

      el.trigger = true;
      // loginWithRedirect完了を待つ
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockClient.loginWithRedirect).toHaveBeenCalled();
      expect(el.trigger).toBe(false);
      expect(triggerEvents).toContain(false);
    });

    it("trigger=falseでは何も起きない", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValue(mockClient);

      const el = document.createElement("wcs-auth") as Auth;
      el.setAttribute("domain", "test.auth0.com");
      el.setAttribute("client-id", "client-id");
      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      el.trigger = false;

      expect(mockClient.loginWithRedirect).not.toHaveBeenCalled();
      expect(el.trigger).toBe(false);
    });
  });

  describe("_buildClientOptions", () => {
    it("redirectUri/audience未設定時はauthorizationParamsに含まれない", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValue(mockClient);

      const el = document.createElement("wcs-auth") as Auth;
      el.setAttribute("domain", "test.auth0.com");
      el.setAttribute("client-id", "client-id");
      // redirectUri, audienceは未設定
      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      const callArgs = createAuth0Client.mock.calls[0][0];
      expect(callArgs.authorizationParams.redirect_uri).toBeUndefined();
      expect(callArgs.authorizationParams.audience).toBeUndefined();
    });

    it("redirectUri/audience設定時はauthorizationParamsに含まれる", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValue(mockClient);

      const el = document.createElement("wcs-auth") as Auth;
      el.setAttribute("domain", "test.auth0.com");
      el.setAttribute("client-id", "client-id");
      el.setAttribute("redirect-uri", "/callback");
      el.setAttribute("audience", "https://api.example.com");
      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      const callArgs = createAuth0Client.mock.calls[0][0];
      expect(callArgs.authorizationParams.redirect_uri).toBe("/callback");
      expect(callArgs.authorizationParams.audience).toBe("https://api.example.com");
    });
  });

  describe("初期化完了前の操作", () => {
    it("trigger=trueが初期化完了前でもレースしない", async () => {
      const mockClient = createMockAuth0Client();
      // 初期化を遅延させる
      createAuth0Client.mockImplementation(() => new Promise(resolve => {
        setTimeout(() => resolve(mockClient), 50);
      }));

      const el = document.createElement("wcs-auth") as Auth;
      el.setAttribute("domain", "test.auth0.com");
      el.setAttribute("client-id", "client-id");
      document.body.appendChild(el);

      // 初期化完了前にtriggerを設定
      el.trigger = true;

      // 初期化完了を待つ
      await el.connectedCallbackPromise;
      await new Promise(resolve => setTimeout(resolve, 100));

      // エラーなくloginが呼ばれていることを確認
      expect(mockClient.loginWithRedirect).toHaveBeenCalled();
    });

    it("login()が初期化完了前でもレースしない", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockImplementation(() => new Promise(resolve => {
        setTimeout(() => resolve(mockClient), 50);
      }));

      const el = document.createElement("wcs-auth") as Auth;
      el.setAttribute("domain", "test.auth0.com");
      el.setAttribute("client-id", "client-id");
      document.body.appendChild(el);

      // 初期化完了前にloginを呼ぶ — エラーにならない
      await el.login();

      expect(mockClient.loginWithRedirect).toHaveBeenCalled();
    });

    it("logout()が初期化完了前でもレースしない", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockImplementation(() => new Promise(resolve => {
        setTimeout(() => resolve(mockClient), 50);
      }));

      const el = document.createElement("wcs-auth") as Auth;
      el.setAttribute("domain", "test.auth0.com");
      el.setAttribute("client-id", "client-id");
      document.body.appendChild(el);

      await el.logout();

      expect(mockClient.logout).toHaveBeenCalled();
    });
  });

  describe("login/logout", () => {
    it("popup属性設定時はloginWithPopupを使用する", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValue(mockClient);

      const el = document.createElement("wcs-auth") as Auth;
      el.setAttribute("domain", "test.auth0.com");
      el.setAttribute("client-id", "client-id");
      el.setAttribute("popup", "");
      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      await el.login();

      expect(mockClient.loginWithPopup).toHaveBeenCalled();
      expect(mockClient.loginWithRedirect).not.toHaveBeenCalled();
    });

    it("logoutを呼び出せる", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValue(mockClient);

      const el = document.createElement("wcs-auth") as Auth;
      el.setAttribute("domain", "test.auth0.com");
      el.setAttribute("client-id", "client-id");
      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      await el.logout();

      expect(mockClient.logout).toHaveBeenCalled();
    });

    it("getTokenを呼び出せる", async () => {
      const mockClient = createMockAuth0Client({
        getTokenSilently: vi.fn().mockResolvedValue("new-token"),
      });
      createAuth0Client.mockResolvedValue(mockClient);

      const el = document.createElement("wcs-auth") as Auth;
      el.setAttribute("domain", "test.auth0.com");
      el.setAttribute("client-id", "client-id");
      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      const token = await el.getToken();
      expect(token).toBe("new-token");
    });
  });

  describe("clientプロパティ", () => {
    it("初期化後にAuth0クライアントにアクセスできる", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValue(mockClient);

      const el = document.createElement("wcs-auth") as Auth;
      el.setAttribute("domain", "test.auth0.com");
      el.setAttribute("client-id", "client-id");
      document.body.appendChild(el);
      await el.connectedCallbackPromise;

      expect(el.client).toBe(mockClient);
    });
  });
});

describe("AuthLogout (wcs-auth-logout)", () => {
  let createAuth0Client: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import("@auth0/auth0-spa-js");
    createAuth0Client = (mod as any).createAuth0Client;
    createAuth0Client.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("カスタム要素として登録されている", () => {
    expect(customElements.get("wcs-auth-logout")).toBeDefined();
  });

  it("target属性を取得・設定できる", () => {
    const el = document.createElement("wcs-auth-logout") as AuthLogout;
    expect(el.target).toBe("");
    el.target = "auth-id";
    expect(el.target).toBe("auth-id");
  });

  it("returnTo属性を取得・設定できる", () => {
    const el = document.createElement("wcs-auth-logout") as AuthLogout;
    expect(el.returnTo).toBe("");
    el.returnTo = "/";
    expect(el.returnTo).toBe("/");
  });

  it("クリックでtarget IDのwcs-authのlogoutを呼び出す", async () => {
    const mockClient = createMockAuth0Client();
    createAuth0Client.mockResolvedValue(mockClient);

    const authEl = document.createElement("wcs-auth") as Auth;
    authEl.id = "my-auth";
    authEl.setAttribute("domain", "test.auth0.com");
    authEl.setAttribute("client-id", "client-id");
    document.body.appendChild(authEl);
    await authEl.connectedCallbackPromise;

    const logoutEl = document.createElement("wcs-auth-logout") as AuthLogout;
    logoutEl.target = "my-auth";
    document.body.appendChild(logoutEl);

    logoutEl.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockClient.logout).toHaveBeenCalled();
  });

  it("return-to属性付きでログアウトできる", async () => {
    const mockClient = createMockAuth0Client();
    createAuth0Client.mockResolvedValue(mockClient);

    const authEl = document.createElement("wcs-auth") as Auth;
    authEl.id = "my-auth";
    authEl.setAttribute("domain", "test.auth0.com");
    authEl.setAttribute("client-id", "client-id");
    document.body.appendChild(authEl);
    await authEl.connectedCallbackPromise;

    const logoutEl = document.createElement("wcs-auth-logout") as AuthLogout;
    logoutEl.target = "my-auth";
    logoutEl.returnTo = "http://localhost/";
    document.body.appendChild(logoutEl);

    logoutEl.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockClient.logout).toHaveBeenCalledWith(
      expect.objectContaining({
        logoutParams: { returnTo: "http://localhost/" },
      })
    );
  });

  it("ドキュメント内の最初のwcs-authにフォールバックする", async () => {
    const mockClient = createMockAuth0Client();
    createAuth0Client.mockResolvedValue(mockClient);

    const authEl = document.createElement("wcs-auth") as Auth;
    authEl.setAttribute("domain", "test.auth0.com");
    authEl.setAttribute("client-id", "client-id");
    document.body.appendChild(authEl);
    await authEl.connectedCallbackPromise;

    const logoutEl = document.createElement("wcs-auth-logout") as AuthLogout;
    document.body.appendChild(logoutEl);

    logoutEl.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockClient.logout).toHaveBeenCalled();
  });

  it("最寄りの祖先wcs-authにフォールバックする", async () => {
    const mockClient = createMockAuth0Client();
    createAuth0Client.mockResolvedValue(mockClient);

    const authEl = document.createElement("wcs-auth") as Auth;
    authEl.setAttribute("domain", "test.auth0.com");
    authEl.setAttribute("client-id", "client-id");
    document.body.appendChild(authEl);
    await authEl.connectedCallbackPromise;

    // wcs-authの子要素としてlogoutを配置（target未指定）
    const logoutEl = document.createElement("wcs-auth-logout") as AuthLogout;
    authEl.appendChild(logoutEl);

    logoutEl.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockClient.logout).toHaveBeenCalled();
  });

  it("disconnectedCallbackでイベントリスナーが解除される", () => {
    const logoutEl = document.createElement("wcs-auth-logout") as AuthLogout;
    document.body.appendChild(logoutEl);
    logoutEl.remove();
    // disconnectedCallback後のクリックは何も起きない
    expect(() => logoutEl.click()).not.toThrow();
  });

  it("wcs-authが見つからない場合は何もしない", async () => {
    const logoutEl = document.createElement("wcs-auth-logout") as AuthLogout;
    logoutEl.target = "nonexistent";
    document.body.appendChild(logoutEl);

    // エラーが発生しないことを確認
    expect(() => logoutEl.click()).not.toThrow();
  });
});

describe("autoTrigger", () => {
  let createAuth0Client: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import("@auth0/auth0-spa-js");
    createAuth0Client = (mod as any).createAuth0Client;
    createAuth0Client.mockReset();
    unregisterAutoTrigger();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    unregisterAutoTrigger();
    document.body.innerHTML = "";
  });

  it("data-authtarget属性でloginをトリガーできる", async () => {
    const mockClient = createMockAuth0Client();
    createAuth0Client.mockResolvedValue(mockClient);

    registerAutoTrigger();

    const authEl = document.createElement("wcs-auth") as Auth;
    authEl.id = "auth1";
    authEl.setAttribute("domain", "test.auth0.com");
    authEl.setAttribute("client-id", "client-id");
    document.body.appendChild(authEl);
    await authEl.connectedCallbackPromise;

    const button = document.createElement("button");
    button.setAttribute("data-authtarget", "auth1");
    document.body.appendChild(button);

    button.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockClient.loginWithRedirect).toHaveBeenCalled();
  });

  it("対象がAuth要素でない場合は無視する", () => {
    registerAutoTrigger();

    const div = document.createElement("div");
    div.id = "not-auth";
    document.body.appendChild(div);

    const button = document.createElement("button");
    button.setAttribute("data-authtarget", "not-auth");
    document.body.appendChild(button);

    expect(() => button.click()).not.toThrow();
  });

  it("存在しないIDを指定した場合は無視する", () => {
    registerAutoTrigger();

    const button = document.createElement("button");
    button.setAttribute("data-authtarget", "nonexistent");
    document.body.appendChild(button);

    expect(() => button.click()).not.toThrow();
  });

  it("属性値が空の場合は無視する", () => {
    registerAutoTrigger();

    const button = document.createElement("button");
    button.setAttribute("data-authtarget", "");
    document.body.appendChild(button);

    expect(() => button.click()).not.toThrow();
  });

  it("unregisterAutoTrigger()で解除できる", async () => {
    const mockClient = createMockAuth0Client();
    createAuth0Client.mockResolvedValue(mockClient);

    // autoTriggerを無効化してconnectedCallbackでの再登録を防ぐ
    setConfig({ autoTrigger: false });

    registerAutoTrigger();
    unregisterAutoTrigger();

    const authEl = document.createElement("wcs-auth") as Auth;
    authEl.id = "auth1";
    authEl.setAttribute("domain", "test.auth0.com");
    authEl.setAttribute("client-id", "client-id");
    document.body.appendChild(authEl);
    await authEl.connectedCallbackPromise;

    const button = document.createElement("button");
    button.setAttribute("data-authtarget", "auth1");
    document.body.appendChild(button);

    button.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockClient.loginWithRedirect).not.toHaveBeenCalled();

    // 設定を元に戻す
    setConfig({ autoTrigger: true });
  });

  it("registerAutoTrigger()は重複登録しない", () => {
    registerAutoTrigger();
    registerAutoTrigger();
    // エラーなく呼び出せる
    unregisterAutoTrigger();
  });

  it("event.targetがElementでない場合は無視する", () => {
    registerAutoTrigger();

    // テキストノードからのイベントをシミュレート
    const textNode = document.createTextNode("text");
    document.body.appendChild(textNode);

    const event = new Event("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: textNode });
    document.dispatchEvent(event);

    // エラーなく処理される
  });

  it("data-authtarget属性のないクリックは無視する", () => {
    registerAutoTrigger();

    const button = document.createElement("button");
    document.body.appendChild(button);

    // data-authtarget属性なしのクリック
    expect(() => button.click()).not.toThrow();
  });
});
