// The page's state logic, headless: the real public/state.js mounted with @wcstack/testing under happy-dom.
// The I/O nodes are not registered here; a tiny wc-bindable element stands in for them so the real $on
// handlers run on the same event-token surface the page uses.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { mount, settle } from "@wcstack/testing";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// public/index.html has <wcs-state src="./state.js">; resolveModule (4.9) maps the URL the page names to the file,
// and imports the module anew for each mount, so tests do not share a state object.
const PUBLIC = fileURLToPath(new URL("../.." + "/public/", import.meta.url));
const resolveModule = (url) => join(PUBLIC, url.pathname);

class FakeNode extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "message", event: "fake:message" },
      { name: "value", event: "fake:response" },
      { name: "error", event: "fake:error" },
    ],
  };
  emit(kind, detail) { this.dispatchEvent(new CustomEvent("fake:" + kind, { detail, bubbles: true })); }
}
beforeAll(() => { if (!customElements.get("fake-node")) customElements.define("fake-node", FakeNode); });

const PAGE = `
  <wcs-state src="./state.js"></wcs-state>
  <fake-node id="ws" data-wcs="eventToken.message: wsReceived"></fake-node>
  <fake-node id="questions" data-wcs="eventToken.value: questionsLoaded"></fake-node>
  <fake-node id="save" data-wcs="eventToken.value: saveResponded; eventToken.error: saveFailed"></fake-node>
  <fake-node id="absence" data-wcs="eventToken.value: absenceResponded; eventToken.error: absenceFailed"></fake-node>
  <h1 id="heading" data-wcs="textContent: listHeading"></h1>
  <ul id="tabs"><template data-wcs="for: tabs"><li class="tab" data-wcs="textContent: .label"></li></template></ul>
  <ol id="qs"><template data-wcs="for: questions"><li class="q" data-wcs="textContent: .text"></li></template></ol>
  <p id="title-error" data-wcs="textContent: formErrors.title"></p>
  <p id="date-error" data-wcs="textContent: absenceErrors.date"></p>
  <div id="app" data-wcs="class.text-large: largeText"></div>
`;
const TEACHER = { token: "t-1", user: { id: "sato", name: "佐藤 先生", role: "teacher" } };
const PARENT = { token: "p-1", user: { id: "tanaka", name: "田中 花子", role: "parent", child: "田中 一郎" } };

let app;
const $ = (sel) => app.root.querySelector(sel);
const read = (fn) => app.state().read(fn);
const write = async (fn) => { await app.state().write(fn); await settle(); };

beforeEach(async () => {
  history.replaceState(null, "", "/");
  app = await mount(PAGE, { resolveModule });
});
afterEach(() => app.unmount());

describe("お知らせ一覧の状態", () => {
  it("?cat= で見出しと取りに行く URL が決まり、タブはその区分へのリンクを持つ", async () => {
    await write((s) => { s.session = PARENT; s.routeName = "notices"; s.query = { cat: "homework", page: "2" }; });
    // the current tab is the router's (<wcs-link query-keys="cat">, 4.12): the state gives each tab its link
    expect(read((s) => s.tabs.map((_t, i) => s[`tabs.${i}.href`]))).toContain("/notices?cat=homework");
    expect($("#heading").textContent).toBe("お知らせ（宿題）");
    expect(read((s) => s.listUrl)).toBe("/api/notices?cat=homework&page=2");
  });
  it("知らない区分と不正なページ番号は無視する", async () => {
    await write((s) => { s.session = PARENT; s.routeName = "notices"; s.query = { cat: "zzz", page: "-4" }; });
    expect(read((s) => s.listUrl)).toBe("/api/notices?cat=&page=1");
    // the current tab is the router's (<wcs-link query-keys="cat">): "すべて" links to the list without a category
    expect(read((s) => s["tabs.0.href"])).toBe("/notices");
    // page 1 of every notice: an empty query, current only where the URL has none (router 4.11)
    expect(read((s) => s["pageNumbers.0.to"])).toBe("/notices?");
  });
  it("ログアウト中やほかのページでは何も取りに行かない", async () => {
    await write((s) => { s.routeName = "notices"; });
    expect(read((s) => s.listUrl)).toBeNull();
    await write((s) => { s.session = PARENT; s.routeName = "settings"; });
    expect(read((s) => s.listUrl)).toBeNull();
  });
  it("ページ送りを応答から作り、空の区分はそう言う", async () => {
    await write((s) => {
      s.session = PARENT; s.routeName = "notices"; s.query = { cat: "health", page: "1" };
      s.listFetch = { value: { items: [], page: 1, pages: 1, total: 0 }, loading: false, error: null, status: 200 };
    });
    expect(read((s) => s.listEmpty)).toBe(true);
    expect(read((s) => s.emptyText)).toBe("「保健」のお知らせはまだありません。");
    await write((s) => { s["listFetch.value"] = { items: [], page: 1, pages: 3, total: 25 }; });
    expect(read((s) => s.pageNumbers)).toEqual([1, 2, 3]);
    expect(read((s) => s["pageNumbers.1.to"])).toBe("/notices?cat=health&page=2");
    expect(read((s) => s["pageNumbers.0.to"])).toBe("/notices?cat=health");
  });
});

describe("質問と回答", () => {
  const q = (id, text, answer = null) => ({ id, from: "田中 花子", text, at: "2026-10-31T09:00:00+09:00", answer });
  beforeEach(async () => {
    await write((s) => { s.session = PARENT; s.routeName = "notice"; s.routeParams = { id: 3 }; });
  });

  it("GET とソケットで届いたものをマージする — 失わず、重ねない", async () => {
    $("#questions").emit("response", { status: 200, value: [q(1, "一"), q(2, "二")] });
    await settle();
    $("#ws").emit("message", { type: "question", question: q(3, "三") });
    await settle();
    // a refetch after a reconnect that has 1–3 and the new 4
    $("#questions").emit("response", { status: 200, value: [q(1, "一"), q(2, "二"), q(3, "三"), q(4, "四")] });
    await settle();
    $("#ws").emit("message", { type: "question", question: q(4, "四") });   // and the socket repeats 4
    await settle();
    expect([...app.root.querySelectorAll(".q")].map((li) => li.textContent)).toEqual(["一", "二", "三", "四"]);
  });

  it("回答をその質問に付ける", async () => {
    $("#questions").emit("response", { status: 200, value: [q(1, "一")] });
    await settle();
    $("#ws").emit("message", { type: "answer", questionId: 1, answer: { text: "はい", at: "2026-10-31T10:00:00+09:00" } });
    await settle();
    expect(read((s) => s["questions.0.answerText"])).toBe("はい");
    expect(read((s) => s["questions.0.answered"])).toBe(true);
  });

  it("入力した質問はサーバーが送り返すまで残す", async () => {
    $("#questions").emit("response", { status: 200, value: [] });
    await write((s) => { s.wsConnected = true; s.askText = "上履きは？"; });
    await write((s) => s.ask());
    expect(read((s) => s.askText)).toBe("上履きは？");
    $("#ws").emit("message", { type: "question", question: q(9, "上履きは？") });
    await settle();
    expect(read((s) => s.askText)).toBe("");
    expect(read((s) => s.pendingAsk)).toBe("");
  });

  it("ソケットの認証エラーはもう一度ログインを求める", async () => {
    $("#ws").emit("message", { type: "auth-error" });
    await settle();
    expect(read((s) => s.reauth)).toBe(true);
  });

  it("お知らせが変わると前のお知らせの質問を捨てる", async () => {
    $("#questions").emit("response", { status: 200, value: [q(1, "一")] });
    await settle();
    await write((s) => { s.routeParams = { id: 4 }; });
    expect(read((s) => s.questions.length)).toBe(0);
  });
});

describe("お知らせのフォーム", () => {
  beforeEach(async () => {
    await write((s) => { s.session = TEACHER; s.routeName = "notice-new"; });
  });

  it("入力すると未保存になり、router に離脱の確認を頼む", async () => {
    expect(read((s) => s.discardPrompt)).toBeNull();
    await write((s) => { s["draft.title"] = "遠足"; });
    expect(read((s) => s.dirty)).toBe(true);
    expect(read((s) => s.discardPrompt)).toMatch(/保存していない変更/);
  });

  it("422 のエラーはそれぞれの欄の隣に出る", async () => {
    await write((s) => { s["draft.title"] = ""; s.saveNotice(); });
    $("#save").emit("error", { status: 422, statusText: "", body: JSON.stringify({ errors: { title: "タイトルを入力してください。" } }) });
    await settle();
    expect($("#title-error").textContent).toBe("タイトルを入力してください。");
    expect(read((s) => s.saving)).toBe(false);
  });

  it("日付の無い時刻は送る前に断る", async () => {
    await write((s) => { s["draft.deadlineTime"] = "09:00"; s.saveNotice(); });
    expect(read((s) => s["formErrors.deadline"])).toBe("日付も入力してください。");
    expect(read((s) => s["saveFetch.trigger"])).toBe(false);
  });

  it("保存のたびに新しい body のオブジェクトを作る（fetch の body は使い捨て）", async () => {
    await write((s) => { s["draft.title"] = "A"; s["draft.body"] = "B"; s.saveNotice(); });
    const first = read((s) => s["saveFetch.body"]);
    expect(first).toEqual({ title: "A", cat: "general", body: "B", deadline: null });
    expect(read((s) => s["saveFetch.method"])).toBe("POST");
  });

  it("保存の 401 はログインを求め、下書きは残す", async () => {
    await write((s) => { s["draft.title"] = "下書き"; s.saveNotice(); });
    $("#save").emit("error", { status: 401, statusText: "", body: "{}" });
    await settle();
    expect(read((s) => s.reauth)).toBe(true);
    expect(read((s) => s.retryAfterLogin)).toBe("saveNotice");
    expect(read((s) => s["draft.title"])).toBe("下書き");
  });

  it("保存の後は未保存のものが無く、お知らせへ行く（履歴のフォームを置き換える）", async () => {
    await write((s) => { s["draft.title"] = "A"; s["draft.body"] = "B"; s.saveNotice(); });
    $("#save").emit("response", { status: 201, value: { id: 42, title: "A" } });
    await settle();
    expect(read((s) => s.replaceUrl)).toBe("/notices/42");
    expect(read((s) => s.dirty)).toBe(false);
  });
});

describe("ほかのタブでのセッションの変化", () => {
  it("ほかでのログアウトは、未保存の無いページを next 付きでログインへ送る", async () => {
    // "where I am" comes from location (the router's path lags a frame under view transitions, 4.10.1)
    history.replaceState(null, "", "/notices?cat=event");
    await write((s) => { s.session = PARENT; s.routeName = "notices"; s.path = "/notices"; s.query = { cat: "event" }; });
    await write((s) => { s.session = null; });
    expect(read((s) => s.replaceUrl)).toBe("/login?next=%2Fnotices%3Fcat%3Devent");
  });
  it("…ただし未保存のフォームは残し、その上でログインを求める", async () => {
    await write((s) => { s.session = TEACHER; s.routeName = "notice-new"; s.path = "/notices/new"; });
    await write((s) => { s["draft.title"] = "書きかけ"; });
    await write((s) => { s.session = null; });
    expect(read((s) => s.reauth)).toBe(true);
    expect(read((s) => s.replaceUrl)).toBeNull();
    expect(read((s) => s["draft.title"])).toBe("書きかけ");
  });
  it("ログインのページでログインすると next へ行く（アプリの中だけ）", async () => {
    await write((s) => { s.routeName = "login"; s.query = { next: "/notices/7" }; });
    await write((s) => { s.session = PARENT; });
    expect(read((s) => s.replaceUrl)).toBe("/notices/7");
  });
});

describe("欠席連絡", () => {
  it("今日の日付で始まり、422 は日付の隣に出る", async () => {
    await write((s) => { s.session = PARENT; s.routeName = "absence-new"; });
    expect(read((s) => s["absence.date"])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(read((s) => s.dirty)).toBe(false);
    await write((s) => { s["absence.date"] = "2020-01-01"; s.submitAbsence(); });
    $("#absence").emit("error", { status: 422, statusText: "", body: JSON.stringify({ errors: { date: "30日より前の日付は届け出できません。" } }) });
    await settle();
    expect($("#date-error").textContent).toBe("30日より前の日付は届け出できません。");
    expect(read((s) => s.dirty)).toBe(true);
  });
});

describe("設定", () => {
  it("初めての訪問では既定のまま（storage は null を読む）、読んだ値は整える", async () => {
    await write((s) => { s.savedPrefs = null; });
    expect(read((s) => s.prefs)).toEqual({ textSize: "normal", showAttachments: true });
    await write((s) => { s.savedPrefs = { textSize: "large", showAttachments: false }; });
    expect($("#app").classList.contains("text-large")).toBe(true);
    await write((s) => { s.savedPrefs = { textSize: "huge" }; });
    expect(read((s) => s.prefs)).toEqual({ textSize: "normal", showAttachments: true });
  });
  it("保存する値は 2 つの入力に従う", async () => {
    await write((s) => { s["prefs.showAttachments"] = false; });
    expect(read((s) => s.savedPrefs)).toEqual({ textSize: "normal", showAttachments: false });
  });
});
