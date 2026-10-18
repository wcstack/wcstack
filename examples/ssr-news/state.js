// The state of ssr-news, loaded by <wcs-state enable-ssr src="./state.js"> — on the server through
// renderToString({ resolveModule }), in the browser from /state.js. A src state keeps the page free of
// inline script, so a strict Content-Security-Policy needs no nonce for it.

/** @typedef {{ id: number, title: string, summary: string, publishedAt: string }} Summary */
/** @typedef {{ id: number, title: string, body: string, publishedAt: string }} Article */
/** @typedef {{ id: number | string, author: string, text: string, postedAt: string, pending?: boolean }} Comment */
export default {
  /** @type {Summary[]} */
  articles: [],

  // ---- router (outputs of <wcs-router>)
  routeParams: {},
  routeName: "",

  // ---- the article of the current route (loaded by a <wcs-fetch>, on the server too)
  /** @type {Article | null} */
  article: null,
  articleFor: null,          // the id `article` / `articleStatus` belong to
  articleStatus: 0,          // 0 with articleFor set = the request failed (network)
  articleLoading: false,
  articleRetry: false,

  // ---- its comments
  /** @type {Comment[]} */
  comments: [],
  commentsFor: null,
  commentsStatus: 0,
  commentsLoading: false,
  commentsRetry: false,

  // ---- the comment form
  draft: { author: "", text: "" },
  fieldErrors: { text: null },
  formError: "",
  failNext: false,           // (test) ask the server to fail the next post
  postUrl: null,
  postBody: null,
  postTrigger: false,
  postLoading: false,
  pendingId: null,

  // ---- reader preferences (from <wcs-storage>; the server cannot see them)
  /** @type {string | null} */
  fontSize: null,            // "s" | "m" | "l"
  /** @type {number[] | null} */
  readIds: null,
  get fontChoice() { return this.fontSize ?? "m"; },
  set fontChoice(v) { this.fontSize = v; },
  get fontSizeCss() { return { s: "0.875rem", m: "1rem", l: "1.25rem" }[this.fontChoice] ?? "1rem"; },
  get readList() { return Array.isArray(this.readIds) ? this.readIds : []; },
  get "articles.*.isRead"() { return this.readList.includes(this["articles.*.id"]); },
  get readCount() { return this.readList.length; },

  // ---- the page's own secret and a destructive method (what injected markup would reach)
  apiKey: "pk_live_reader_7f3a",
  wipe() { this.readIds = []; this.formError = "wipe() ran: reading history cleared"; },

  // Mark an article read once it is shown (watches run on the client only).
  $watch: {
    shownArticle(a) {
      if (a && !this.readList.includes(a.id)) this.readIds = [...this.readList, a.id];
    },
  },

  // The list, where the page is rendered: on the server (the client skips it when it hydrates), or in
  // the browser when there is no usable snapshot. The article and its comments are the <wcs-fetch>
  // elements' — the server waits for a request a binding started (4.3).
  async $connectedCallback() {
    const res = await fetch("/api/articles").catch(() => null);   // null = the API could not be reached
    this.articles = res?.ok ? await res.json() : [];
  },

  get "articles.*.published"() { return new Date(this["articles.*.publishedAt"]); },
  get "articles.*.href"() { return "/articles/" + this["articles.*.id"]; },
  get articleId() { return this.routeName === "article" ? this["routeParams.id"] ?? null : null; },
  // A url only while the current route's article is not loaded yet, or failed (so that Retry, a
  // trigger, has a url to fetch). Once the server loaded it, the snapshot holds it and the id it
  // belongs to: the url is null on the client, and hydration fetches nothing.
  get articleUrl() { const id = this.articleId; return id && (this.articleFor !== id || this.articleFailed) ? "/api/articles/" + id : null; },
  get commentsUrl() { const id = this.articleId; return id && (this.commentsFor !== id || this.commentsFailed) ? "/api/articles/" + id + "/comments" : null; },
  // The article only when it is the route's (not the previous one while the next loads).
  get shownArticle() { return this.articleId !== null && this.articleFor === this.articleId ? this.article : null; },
  get articleMissing() { return this.articleId !== null && this.articleFor === this.articleId && this.articleStatus === 404; },
  get articleFailed() { return this.articleId !== null && this.articleFor === this.articleId && (this.articleStatus === 0 || this.articleStatus >= 500); },
  get commentsFailed() { return this.articleId !== null && this.commentsFor === this.articleId && (this.commentsStatus === 0 || this.commentsStatus >= 500); },
  // trigger is a no-op while url is empty: set only the one that failed (its url is kept).
  retry() { if (this.articleFailed) this.articleRetry = true; if (this.commentsFailed) this.commentsRetry = true; },
  get articlePublished() { return this.shownArticle ? new Date(this["article.publishedAt"]) : null; },
  get pageTitle() {
    if (this.shownArticle) return this["article.title"] + " — SSR News";
    return this.articleMissing ? "Article not found — SSR News" : "SSR News";
  },
  get pageDescription() { return this.shownArticle ? this["article.body"].slice(0, 150) : "Local news, server-rendered."; },
  get commentAction() { return "/articles/" + this.articleId + "/comments"; },
  get posting() { return this.pendingId !== null || this.postLoading; },
  get "comments.*.posted"() { return new Date(this["comments.*.postedAt"]); },

  submitComment() {
    if (this.posting || this.articleId === null) return;          // one post at a time
    const author = this["draft.author"].trim() || "anonymous";
    const text = this["draft.text"];
    const tempId = "pending-" + Date.now();
    this.fieldErrors = { text: null };
    this.formError = "";
    // Optimistic: the comment shows at once, marked pending.
    this.comments = this.comments.concat({ id: tempId, author, text, postedAt: new Date().toISOString(), pending: true });
    this.pendingId = tempId;
    this.postUrl = "/api/articles/" + this.articleId + "/comments" + (this.failNext ? "?fail=1" : "");
    this.postBody = { author, text };           // body is one-shot: a new object every time
    this.postTrigger = true;
  },

  $eventTokens: ["articleLoaded", "articleError", "commentsLoaded", "commentsError", "postResponded", "postFailed"],
  $on: {
    articleLoaded(state, event) {
      const { status, value } = event.detail ?? {};
      if (!status) return;                        // a network failure arrives on articleError
      state.articleStatus = status;
      state.article = status === 200 ? value : null;
      state.articleFor = state.articleId;
    },
    articleError(state, event) {
      const error = event.detail;
      if (!error) return;                         // the reset to null when a request starts
      state.articleStatus = error.status ?? 0;
      state.article = null;
      state.articleFor = state.articleId;
    },
    commentsLoaded(state, event) {
      const { status, value } = event.detail ?? {};
      if (!status) return;
      state.commentsStatus = status;
      state.comments = status === 200 && Array.isArray(value) ? value : [];
      state.commentsFor = state.articleId;
    },
    commentsError(state, event) {
      const error = event.detail;
      if (!error) return;
      state.commentsStatus = error.status ?? 0;
      state.comments = [];
      state.commentsFor = state.articleId;
    },
    postResponded(state, event) {
      const { status, value } = event.detail ?? {};
      if (status !== 201) return;                 // failures arrive on postFailed
      const pending = state.pendingId;
      state.comments = state.comments.map((c) => (c.id === pending ? value : c));
      state.pendingId = null;
      state.draft = { author: state["draft.author"], text: "" };
    },
    postFailed(state, event) {
      const error = event.detail;
      if (!error) return;                         // the reset to null when a request starts
      const pending = state.pendingId;
      state.comments = state.comments.filter((c) => c.id !== pending);   // take it back
      state.pendingId = null;
      if (error.status === 422) {
        let parsed = null;
        try { parsed = JSON.parse(error.body); } catch { parsed = null; }
        state.fieldErrors = { text: null, ...(parsed?.errors ?? {}) };
        state.formError = "Please fix the comment.";
      } else {
        state.formError = "The comment could not be posted (" + (error.status ? "HTTP " + error.status : "network error") + "). Try again.";
      }
    },
  },
};
