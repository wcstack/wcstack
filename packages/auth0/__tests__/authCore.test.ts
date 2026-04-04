import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuthCore } from "../src/core/AuthCore";

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

describe("AuthCore", () => {
  let createAuth0Client: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import("@auth0/auth0-spa-js");
    createAuth0Client = (mod as any).createAuth0Client;
    createAuth0Client.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("EventTargetを継承している", () => {
    const core = new AuthCore();
    expect(core).toBeInstanceOf(EventTarget);
  });

  it("wcBindableプロパティが正しく定義されている", () => {
    expect(AuthCore.wcBindable.protocol).toBe("wc-bindable");
    expect(AuthCore.wcBindable.version).toBe(1);
    expect(AuthCore.wcBindable.properties).toHaveLength(5);
    expect(AuthCore.wcBindable.properties[0].name).toBe("authenticated");
    expect(AuthCore.wcBindable.properties[1].name).toBe("user");
    expect(AuthCore.wcBindable.properties[2].name).toBe("token");
    expect(AuthCore.wcBindable.properties[3].name).toBe("loading");
    expect(AuthCore.wcBindable.properties[4].name).toBe("error");
  });

  it("初期状態が正しい", () => {
    const core = new AuthCore();
    expect(core.authenticated).toBe(false);
    expect(core.user).toBeNull();
    expect(core.token).toBeNull();
    expect(core.loading).toBe(false);
    expect(core.error).toBeNull();
    expect(core.client).toBeNull();
    expect(core.initPromise).toBeNull();
  });

  it("HTMLElementではなくEventTargetベースである", () => {
    const core = new AuthCore();
    expect(core).toBeInstanceOf(EventTarget);
    expect(core).not.toBeInstanceOf(HTMLElement);
  });

  describe("initialize", () => {
    it("domain未指定時にエラーをスローする", () => {
      const core = new AuthCore();
      expect(() => core.initialize({ domain: "", clientId: "id" })).toThrow(
        "[@wcstack/auth0] domain attribute is required."
      );
    });

    it("clientId未指定時にエラーをスローする", () => {
      const core = new AuthCore();
      expect(() => core.initialize({ domain: "test.auth0.com", clientId: "" })).toThrow(
        "[@wcstack/auth0] client-id attribute is required."
      );
    });

    it("Auth0クライアントを初期化できる（未認証）", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      const events: string[] = [];
      core.addEventListener("wcs-auth:loading-changed", () => events.push("loading"));
      core.addEventListener("wcs-auth:authenticated-changed", () => events.push("authenticated"));

      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

      expect(core.authenticated).toBe(false);
      expect(core.user).toBeNull();
      expect(core.token).toBeNull();
      expect(core.loading).toBe(false);
      expect(core.client).toBe(mockClient);
      expect(events).toContain("loading");
      expect(events).toContain("authenticated");
    });

    it("Auth0クライアントを初期化できる（認証済み）", async () => {
      const mockUser = { sub: "auth0|123", name: "Test User", email: "test@example.com" };
      const mockClient = createMockAuth0Client({
        isAuthenticated: vi.fn().mockResolvedValue(true),
        getUser: vi.fn().mockResolvedValue(mockUser),
        getTokenSilently: vi.fn().mockResolvedValue("access-token-123"),
      });
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

      expect(core.authenticated).toBe(true);
      expect(core.user).toEqual(mockUser);
      expect(core.token).toBe("access-token-123");
      expect(core.loading).toBe(false);
    });

    it("getUser()がundefinedを返した場合はnullになる", async () => {
      const mockClient = createMockAuth0Client({
        isAuthenticated: vi.fn().mockResolvedValue(true),
        getUser: vi.fn().mockResolvedValue(undefined),
        getTokenSilently: vi.fn().mockResolvedValue("token"),
      });
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

      expect(core.user).toBeNull();
    });

    it("getTokenSilently()がundefinedを返した場合はnullになる", async () => {
      const mockClient = createMockAuth0Client({
        isAuthenticated: vi.fn().mockResolvedValue(true),
        getUser: vi.fn().mockResolvedValue({ sub: "auth0|123" }),
        getTokenSilently: vi.fn().mockResolvedValue(undefined),
      });
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

      expect(core.token).toBeNull();
    });

    it("トークン取得失敗時もエラーにならない", async () => {
      const mockClient = createMockAuth0Client({
        isAuthenticated: vi.fn().mockResolvedValue(true),
        getUser: vi.fn().mockResolvedValue({ sub: "auth0|123" }),
        getTokenSilently: vi.fn().mockRejectedValue(new Error("token error")),
      });
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

      expect(core.authenticated).toBe(true);
      expect(core.token).toBeNull();
      expect(core.error).toBeNull();
    });

    it("initPromiseが設定される", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      const promise = core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

      expect(core.initPromise).toBe(promise);
      await promise;
    });

    it("リダイレクトコールバックでcode/stateのみ除去し他のパラメータは保持する", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const savedHref = globalThis.location.href;
      const savedSearch = globalThis.location.search;

      // happy-domのlocationを直接書き換え
      Object.defineProperty(globalThis.location, "search", { value: "?code=abc&state=xyz&returnTo=/dashboard&utm_source=email", configurable: true });
      Object.defineProperty(globalThis.location, "href", { value: "http://localhost/callback?code=abc&state=xyz&returnTo=/dashboard&utm_source=email", configurable: true });

      const replaceStateSpy = vi.spyOn(globalThis.history, "replaceState");

      try {
        const core = new AuthCore();
        await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

        expect(mockClient.handleRedirectCallback).toHaveBeenCalled();
        const calledUrl = replaceStateSpy.mock.calls[0][2] as string;
        expect(calledUrl).not.toContain("code=");
        expect(calledUrl).not.toContain("state=");
        expect(calledUrl).toContain("returnTo=");
        expect(calledUrl).toContain("utm_source=email");
      } finally {
        Object.defineProperty(globalThis.location, "search", { value: savedSearch, configurable: true });
        Object.defineProperty(globalThis.location, "href", { value: savedHref, configurable: true });
        replaceStateSpy.mockRestore();
      }
    });

    it("リダイレクトコールバックを処理する", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const savedHref = globalThis.location.href;
      const savedSearch = globalThis.location.search;

      Object.defineProperty(globalThis.location, "search", { value: "?code=abc&state=xyz", configurable: true });
      Object.defineProperty(globalThis.location, "href", { value: "http://localhost/callback?code=abc&state=xyz", configurable: true });

      const replaceStateSpy = vi.spyOn(globalThis.history, "replaceState");

      try {
        const core = new AuthCore();
        await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

        expect(mockClient.handleRedirectCallback).toHaveBeenCalled();
        expect(replaceStateSpy).toHaveBeenCalled();
      } finally {
        Object.defineProperty(globalThis.location, "search", { value: savedSearch, configurable: true });
        Object.defineProperty(globalThis.location, "href", { value: savedHref, configurable: true });
        replaceStateSpy.mockRestore();
      }
    });

    it("初期化時にerrorクリアイベントが発火する", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      const errorEvents: any[] = [];
      core.addEventListener("wcs-auth:error", (e: Event) => {
        errorEvents.push((e as CustomEvent).detail);
      });

      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

      // error=nullのイベントが発火していること（バインディング先が観測可能）
      expect(errorEvents).toContain(null);
    });

    it("初期化エラーを処理できる", async () => {
      createAuth0Client.mockRejectedValueOnce(new Error("init failed"));

      const core = new AuthCore();
      const errors: any[] = [];
      core.addEventListener("wcs-auth:error", (e: Event) => {
        errors.push((e as CustomEvent).detail);
      });

      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

      expect(core.error).toBeInstanceOf(Error);
      expect(core.loading).toBe(false);
      // error=null（初期化冒頭クリア）とError（初期化失敗）の2回
      expect(errors).toHaveLength(2);
      expect(errors[0]).toBeNull();
      expect(errors[1]).toBeInstanceOf(Error);
    });
  });

  describe("target指定", () => {
    it("target未指定時はイベントが自身にディスパッチされる", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      const events: string[] = [];
      core.addEventListener("wcs-auth:loading-changed", () => events.push("loading"));

      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

      expect(events.length).toBeGreaterThan(0);
    });

    it("target指定時はイベントがtargetにディスパッチされる", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const target = new EventTarget();
      const core = new AuthCore(target);
      const coreEvents: string[] = [];
      const targetEvents: string[] = [];

      core.addEventListener("wcs-auth:loading-changed", () => coreEvents.push("loading"));
      target.addEventListener("wcs-auth:loading-changed", () => targetEvents.push("loading"));

      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

      expect(coreEvents).toEqual([]);
      expect(targetEvents.length).toBeGreaterThan(0);
    });
  });

  describe("login", () => {
    it("クライアント未初期化時にエラーをスローする", async () => {
      const core = new AuthCore();
      await expect(core.login()).rejects.toThrow("[@wcstack/auth0] Auth0 client is not initialized.");
    });

    it("loginWithRedirectを呼び出す", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });
      await core.login();

      expect(mockClient.loginWithRedirect).toHaveBeenCalled();
    });

    it("login()でloadingがtrueになりerrorがクリアされる", async () => {
      const mockClient = createMockAuth0Client();
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

      const events: Array<{ name: string; detail: any }> = [];
      core.addEventListener("wcs-auth:loading-changed", (e: Event) => {
        events.push({ name: "loading", detail: (e as CustomEvent).detail });
      });
      core.addEventListener("wcs-auth:error", (e: Event) => {
        events.push({ name: "error", detail: (e as CustomEvent).detail });
      });

      await core.login();

      // loading=trueとerror=nullのイベントが発火していることを確認
      expect(events.some(e => e.name === "loading" && e.detail === true)).toBe(true);
      expect(events.some(e => e.name === "error" && e.detail === null)).toBe(true);
    });

    it("ログインエラーを処理できる", async () => {
      const mockClient = createMockAuth0Client({
        loginWithRedirect: vi.fn().mockRejectedValue(new Error("login failed")),
      });
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });
      await core.login();

      expect(core.error).toBeInstanceOf(Error);
      expect(core.loading).toBe(false);
    });
  });

  describe("loginWithPopup", () => {
    it("クライアント未初期化時にエラーをスローする", async () => {
      const core = new AuthCore();
      await expect(core.loginWithPopup()).rejects.toThrow("[@wcstack/auth0] Auth0 client is not initialized.");
    });

    it("ポップアップログイン後に状態を同期する", async () => {
      const mockUser = { sub: "auth0|456", name: "Popup User" };
      const mockClient = createMockAuth0Client({
        isAuthenticated: vi.fn().mockResolvedValue(true),
        getUser: vi.fn().mockResolvedValue(mockUser),
        getTokenSilently: vi.fn().mockResolvedValue("popup-token"),
      });
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

      // 初期化後にisAuthenticatedの戻り値を変更
      mockClient.isAuthenticated.mockResolvedValue(true);

      await core.loginWithPopup();

      expect(core.authenticated).toBe(true);
      expect(core.user).toEqual(mockUser);
      expect(core.loading).toBe(false);
    });

    it("ポップアップログインエラーを処理できる", async () => {
      const mockClient = createMockAuth0Client({
        loginWithPopup: vi.fn().mockRejectedValue(new Error("popup blocked")),
      });
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });
      await core.loginWithPopup();

      expect(core.error).toBeInstanceOf(Error);
      expect(core.loading).toBe(false);
    });
  });

  describe("logout", () => {
    it("クライアント未初期化時にエラーをスローする", async () => {
      const core = new AuthCore();
      await expect(core.logout()).rejects.toThrow("[@wcstack/auth0] Auth0 client is not initialized.");
    });

    it("ログアウト後に状態をリセットする", async () => {
      const mockClient = createMockAuth0Client({
        isAuthenticated: vi.fn().mockResolvedValue(true),
        getUser: vi.fn().mockResolvedValue({ sub: "auth0|123" }),
        getTokenSilently: vi.fn().mockResolvedValue("token"),
      });
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

      expect(core.authenticated).toBe(true);

      await core.logout();

      expect(core.authenticated).toBe(false);
      expect(core.user).toBeNull();
      expect(core.token).toBeNull();
    });

    it("ログアウトエラーを処理できる", async () => {
      const mockClient = createMockAuth0Client({
        logout: vi.fn().mockRejectedValue(new Error("logout failed")),
      });
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });
      await core.logout();

      expect(core.error).toBeInstanceOf(Error);
    });

    it("ログアウト成功時にerrorがクリアされる", async () => {
      const mockClient = createMockAuth0Client({
        getTokenSilently: vi.fn().mockRejectedValue(new Error("token error")),
        isAuthenticated: vi.fn().mockResolvedValue(true),
        getUser: vi.fn().mockResolvedValue({ sub: "auth0|123" }),
      });
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

      // getTokenで失敗させてerrorを入れる
      await core.getToken();
      expect(core.error).toBeInstanceOf(Error);

      // logoutの成功でerrorがクリアされることを確認
      await core.logout();
      expect(core.error).toBeNull();
    });
  });

  describe("getToken", () => {
    it("クライアント未初期化時にエラーをスローする", async () => {
      const core = new AuthCore();
      await expect(core.getToken()).rejects.toThrow("[@wcstack/auth0] Auth0 client is not initialized.");
    });

    it("アクセストークンを取得できる", async () => {
      const mockClient = createMockAuth0Client({
        getTokenSilently: vi.fn().mockResolvedValue("fresh-token"),
      });
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });
      const token = await core.getToken();

      expect(token).toBe("fresh-token");
      expect(core.token).toBe("fresh-token");
    });

    it("getTokenSilently()がundefinedを返した場合はnullになる（getToken経由）", async () => {
      const mockClient = createMockAuth0Client({
        getTokenSilently: vi.fn().mockResolvedValue(undefined),
      });
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });
      const token = await core.getToken();

      expect(token).toBeNull();
      expect(core.token).toBeNull();
    });

    it("トークン取得エラーを処理できる", async () => {
      const mockClient = createMockAuth0Client({
        getTokenSilently: vi.fn()
          .mockResolvedValueOnce("initial-token") // initialize時
          .mockRejectedValueOnce(new Error("token refresh failed")), // getToken時
        isAuthenticated: vi.fn().mockResolvedValue(true),
        getUser: vi.fn().mockResolvedValue({ sub: "auth0|123" }),
      });
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });
      const token = await core.getToken();

      expect(token).toBeNull();
      expect(core.error).toBeInstanceOf(Error);
    });

    it("トークン取得成功時にerrorがクリアされる", async () => {
      const mockClient = createMockAuth0Client({
        loginWithPopup: vi.fn().mockRejectedValue(new Error("popup failed")),
        getTokenSilently: vi.fn().mockResolvedValue("recovered-token"),
      });
      createAuth0Client.mockResolvedValueOnce(mockClient);

      const core = new AuthCore();
      await core.initialize({ domain: "test.auth0.com", clientId: "client-id" });

      // loginWithPopupで失敗させてerrorを入れる
      await core.loginWithPopup();
      expect(core.error).toBeInstanceOf(Error);

      // getTokenの成功でerrorがクリアされることを確認
      const token = await core.getToken();
      expect(token).toBe("recovered-token");
      expect(core.error).toBeNull();
    });
  });
});
