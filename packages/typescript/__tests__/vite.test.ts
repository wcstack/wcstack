import { describe, it, expect, afterAll } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build, createServer, type InlineConfig, type Plugin } from "vite";
import defaultExport, { wcstack } from "../src/vite";
import { makeTempDir } from "./helpers";

/**
 * A real `vite build` (and the dev server's HTML transform) over fixture projects written to a temp
 * dir. The checks are what a page needs in production: the state file exists at the URL the
 * attribute names, its `export default` survives, and the inline state / guard stay in the page.
 */
const tmp = makeTempDir("wcs-vite-");
afterAll(() => tmp.cleanup());

const PAGE = `<!doctype html>
<html>
<head>
  <script type="module" src="./src/main.ts"></script>
</head>
<body>
  <!-- <wcs-state src="./commented-out.ts"></wcs-state> -->
  <wcs-state src="./src/state.ts"></wcs-state>
  <wcs-state mount="i18n" src="src/i18n.ts"></wcs-state>
  <wcs-state mount="settings" src="/settings.json"></wcs-state>
  <wcs-state mount="legacy" src="/legacy-state.js"></wcs-state>
  <wcs-state mount="remote" src="https://cdn.example.com/remote-state.js"></wcs-state>
  <wcs-router>
    <wcs-route path="/admin">
      <wcs-guard-handler>
        <script type="module">export default () => "GUARD_MARK".length > 0;</script>
      </wcs-guard-handler>
    </wcs-route>
  </wcs-router>
  <template id="card"><wcs-state><script type="module">export default { text: "TEMPLATE_MARK" };</script></wcs-state></template>
</body>
</html>
`;

const COUNTER = `<!doctype html>
<html>
<head><script type="module" src="/src/main.ts"></script></head>
<body>
  <wcs-state>
    <script type="module">export default { count: "INLINE_MARK" };</script>
  </wcs-state>
</body>
</html>
`;

/** A project: two pages, a state sharing a module with the page's script, a volume, a JSON and a public state. */
function project(name: string, extra: Record<string, string> = {}): string {
  const files: Record<string, string> = {
    "index.html": PAGE,
    "counter.html": COUNTER,
    "src/shared.ts": `export const shared = (s: string): string => "SHARED_MARK:" + s;\n`,
    "src/main.ts": `import { shared } from "./shared";\n(globalThis as any).__main = shared("main");\n`,
    "src/state.ts": `import { shared } from "./shared";
export default {
  label: shared("state"),
  get upper(): string { return this.label.toUpperCase(); },
};
`,
    "src/i18n.ts": `export default { hello: "I18N_MARK" };\n`,
    "settings.json": `{ "theme": "dark" }\n`,
    "public/legacy-state.js": `export default { legacy: true };\n`,
    ...extra,
  };
  for (const [file, text] of Object.entries(files)) tmp.write(`${name}/${file}`, text);
  return join(tmp.dir, name);
}

function config(root: string, plugins: Plugin[], more: InlineConfig = {}): InlineConfig {
  return {
    root,
    configFile: false,
    logLevel: "silent",
    plugins,
    ...more,
    build: {
      outDir: join(root, "dist"),
      emptyOutDir: true,
      minify: false,
      rolldownOptions: { input: { main: join(root, "index.html"), counter: join(root, "counter.html") } },
      ...more.build,
    },
  };
}

const read = (root: string, file: string): string => readFileSync(join(root, "dist", file), "utf8");
const srcOf = (page: string, mount: string | null): string => {
  const html = page.replace(/<!--[\s\S]*?-->/g, "");
  const tag = mount === null
    ? /<wcs-state src="([^"]+)"><\/wcs-state>/.exec(html)
    : new RegExp(`<wcs-state mount="${mount}" src="([^"]+)">`).exec(html);
  return tag![1];
};
/** Every emitted JavaScript file of the build, concatenated. */
const allJs = (root: string): string =>
  readdirSync(join(root, "dist", "assets")).filter((f) => f.endsWith(".js")).map((f) => read(root, `assets/${f}`)).join("\n");

describe("wcstack() — vite build", () => {
  it("state ファイルを chunk として出し、src をその URL に書き換え、export default を保つ（ページの bundle とモジュールを共有する）", async () => {
    const root = project("build");
    await build(config(root, [wcstack()]));
    const html = read(root, "index.html");

    const stateUrl = srcOf(html, null);
    expect(stateUrl).toMatch(/^\/assets\/state-[\w-]+\.js$/);
    const state = (await import(pathToFileURL(join(root, "dist", stateUrl)).href)).default;
    expect(state.label).toBe("SHARED_MARK:state");
    expect(state.upper).toBe("SHARED_MARK:STATE");
    // shared.ts は 1 回だけ出る（state の chunk とページの chunk が共有する）
    expect(allJs(root).split("SHARED_MARK").length - 1).toBe(1);

    // mount のボリュームも同じ
    const i18nUrl = srcOf(html, "i18n");
    expect(i18nUrl).toMatch(/^\/assets\/i18n-[\w-]+\.js$/);
    expect((await import(pathToFileURL(join(root, "dist", i18nUrl)).href)).default).toEqual({ hello: "I18N_MARK" });

    // .json はアセット（エンジンは .json の URL を fetch する）、publicDir のファイルはそのまま、外部 URL は触らない
    const jsonUrl = srcOf(html, "settings");
    expect(jsonUrl).toMatch(/^\/assets\/settings-[\w-]+\.json$/);
    expect(JSON.parse(read(root, jsonUrl.slice(1)))).toEqual({ theme: "dark" });
    expect(srcOf(html, "legacy")).toBe("/legacy-state.js");
    expect(existsSync(join(root, "dist", "legacy-state.js"))).toBe(true);
    expect(srcOf(html, "remote")).toBe("https://cdn.example.com/remote-state.js");
    // コメントの中は触らない（ファイルが無くてもビルドは落ちない）
    expect(html).toContain(`<!-- <wcs-state src="./commented-out.ts"></wcs-state> -->`);
  });

  it("<wcs-state> と <wcs-guard-handler> のインラインの module script はページに残り、vite-ignore は出力に残らない", async () => {
    const root = project("inline");
    await build(config(root, [wcstack()]));
    const html = read(root, "index.html");
    expect(html).toMatch(/<wcs-guard-handler>\s*<script\s+type="module">export default \(\) => "GUARD_MARK"/);
    expect(html).toMatch(/<wcs-state>\s*<script\s+type="module">export default \{ text: "TEMPLATE_MARK" \};<\/script><\/wcs-state>/);
    expect(read(root, "counter.html")).toMatch(/<wcs-state>\s*<script\s+type="module">export default \{ count: "INLINE_MARK" \};<\/script>/);
    expect(html + read(root, "counter.html")).not.toContain("vite-ignore");
    // ページ自身のスクリプトは今までどおり bundle される
    expect(html).toMatch(/<script type="module" crossorigin src="\/assets\/main-[\w-]+\.js"><\/script>/);
    expect(allJs(root)).not.toContain("GUARD_MARK");
    expect(allJs(root)).not.toContain("INLINE_MARK");
  });

  it("base: \"/app/\" — URL は base の下", async () => {
    const root = project("base");
    await build(config(root, [wcstack()], { base: "/app/" }));
    const html = read(root, "index.html");
    expect(srcOf(html, null)).toMatch(/^\/app\/assets\/state-[\w-]+\.js$/);
    expect(srcOf(html, "settings")).toMatch(/^\/app\/assets\/settings-[\w-]+\.json$/);
    expect(srcOf(html, "legacy")).toBe("/app/legacy-state.js");
  });

  it("base: \"./\" — HTML の置き場所からの相対 URL（入れ子のページは ../）", async () => {
    const root = project("relative", {
      "pages/inner.html": `<!doctype html><html><body><wcs-state src="../src/state.ts"></wcs-state><wcs-state mount="legacy" src="/legacy-state.js"></wcs-state></body></html>\n`,
    });
    await build(config(root, [wcstack()], {
      base: "./",
      build: { rolldownOptions: { input: { main: join(root, "index.html"), inner: join(root, "pages/inner.html") } } },
    }));
    expect(srcOf(read(root, "index.html"), null)).toMatch(/^\.\/assets\/state-[\w-]+\.js$/);
    const inner = read(root, "pages/inner.html");
    expect(srcOf(inner, null)).toMatch(/^\.\.\/assets\/state-[\w-]+\.js$/);
    expect(srcOf(inner, "legacy")).toBe("../legacy-state.js");
    // 2 つのページの同じファイルは 1 つの chunk
    expect(srcOf(inner, null).slice(1)).toBe(srcOf(read(root, "index.html"), null));
  });

  it("<base href> に従って解決し、ファイルの無い src はそれを名指ししてビルドを落とす", async () => {
    const root = project("base-href", {
      "pages/a.html": `<!doctype html><html><head><base href="/"></head><body><wcs-state src="src/state.ts"></wcs-state></body></html>\n`,
    });
    await build(config(root, [wcstack()], { build: { rolldownOptions: { input: { a: join(root, "pages/a.html") } } } }));
    expect(srcOf(read(root, "pages/a.html"), null)).toMatch(/^\/assets\/state-[\w-]+\.js$/);

    tmp.write("base-href/missing.html", `<!doctype html><html><body><wcs-state src="./src/nope.ts"></wcs-state></body></html>\n`);
    await expect(build(config(root, [wcstack()], { build: { rolldownOptions: { input: { m: join(root, "missing.html") } } } })))
      .rejects.toThrow(/<wcs-state src="\.\/src\/nope\.ts"> in missing\.html: no such file .*src\/nope\.ts/);
  });

  it("タグ名を変えたページ（tagNames）", async () => {
    const root = project("renamed", {
      "renamed.html": `<!doctype html><html><body><app-state src="./src/state.ts"></app-state><app-guard><script type="module">export default () => "RENAMED_GUARD";</script></app-guard></body></html>\n`,
    });
    await build(config(root, [wcstack({ tagNames: { state: "app-state", guardHandler: "app-guard" } })], {
      build: { rolldownOptions: { input: { r: join(root, "renamed.html") } } },
    }));
    const html = read(root, "renamed.html");
    expect(/<app-state src="([^"]+)">/.exec(html)![1]).toMatch(/^\/assets\/state-[\w-]+\.js$/);
    expect(html).toContain(`export default () => "RENAMED_GUARD";`);
  });

  it("wcstack タグの無いページは触らない。default export も同じ関数", async () => {
    const root = project("plain", { "plain.html": `<!doctype html><html><body><script type="module" src="./src/main.ts"></script></body></html>\n` });
    await build(config(root, [defaultExport()], { build: { rolldownOptions: { input: { p: join(root, "plain.html") } } } }));
    expect(read(root, "plain.html")).toMatch(/src="\/assets\/p-[\w-]+\.js"/);
    expect(defaultExport).toBe(wcstack);
  });

  it("対照: プラグインが無ければ Vite 8 は src を残して state を出さず、インラインの state とガードをページから取り出す（使われない export default は bundle からも消える）", async () => {
    const root = project("control");
    await build(config(root, []));
    const html = read(root, "index.html");
    expect(srcOf(html, null)).toBe("./src/state.ts");
    expect(readdirSync(join(root, "dist", "assets")).some((f) => f.startsWith("state-"))).toBe(false);
    expect(html).not.toContain("GUARD_MARK");
    expect(read(root, "counter.html")).not.toContain("INLINE_MARK");
    expect(allJs(root)).not.toContain("INLINE_MARK");
  });
});

describe("wcstack() — dev server", () => {
  async function transform(root: string, plugins: Plugin[], url: string, originalUrl?: string, base = "/app/"): Promise<string> {
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      base,
      plugins,
      server: { middlewareMode: true, hmr: false, watch: null },
    });
    try {
      return await server.transformIndexHtml(url, readFileSync(join(root, url.slice(1)), "utf8"), originalUrl);
    } finally {
      await server.close();
    }
  }

  it("インラインの state とガードはページに残る。src はファイルを出さず、絶対パスに base を付けるだけ", async () => {
    const root = project("dev", {
      "abs.html": `<!doctype html><html><body><wcs-state src="/src/state.ts"></wcs-state><wcs-state mount="r" src="https://cdn.example.com/s.js"></wcs-state><wcs-state mount="i" src="src/i18n.ts"></wcs-state></body></html>\n`,
    });
    const html = await transform(root, [wcstack()], "/index.html");
    expect(html).toMatch(/<script\s+type="module">export default \(\) => "GUARD_MARK"/);
    expect(html).toContain(`<script  type="module">export default { text: "TEMPLATE_MARK" };</script>`);
    expect(html).not.toContain("vite-ignore");
    expect(html).not.toMatch(/html-proxy/);
    expect(srcOf(html, null)).toBe("./src/state.ts");

    const abs = await transform(root, [wcstack()], "/abs.html");
    expect(srcOf(abs, null)).toBe("/app/src/state.ts");
    expect(srcOf(abs, "r")).toBe("https://cdn.example.com/s.js");
    expect(srcOf(abs, "i")).toBe("src/i18n.ts");
    // base が "/" なら絶対パスはそのまま
    expect(srcOf(await transform(root, [wcstack()], "/abs.html", undefined, "/"), null)).toBe("/src/state.ts");
  });

  it("SPA のフォールバックで深い URL に index.html を出すときは、相対の src を Vite の <script src> と同じく絶対にする（<base> のあるページは除く）", async () => {
    const root = project("dev-fallback");
    const deep = await transform(root, [wcstack()], "/index.html", "/app/books/1");
    expect(srcOf(deep, null)).toBe("/app/src/state.ts");
    expect(srcOf(deep, "i18n")).toBe("/app/src/i18n.ts");
    expect(srcOf(deep, "remote")).toBe("https://cdn.example.com/remote-state.js");

    tmp.write("dev-fallback/index.html", PAGE.replace("<head>", `<head><base href="/app/">`));
    const withBase = await transform(root, [wcstack()], "/index.html", "/app/books/1");
    expect(srcOf(withBase, null)).toBe("./src/state.ts");
  });

  it("対照: プラグインが無ければ dev でもインラインの state は html-proxy のモジュールに置き換わる", async () => {
    const root = project("dev-control");
    const html = await transform(root, [], "/counter.html");
    expect(html).not.toContain("INLINE_MARK");
    expect(html).toMatch(/<wcs-state>\s*<script type="module" src="\/app\/counter\.html\?html-proxy&amp;index=0\.js"><\/script>/);
  });
});
