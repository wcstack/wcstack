// smoke-test.mjs — 配布物 dist/cli.cjs の実行スモークテスト。
//
// validator core のロジックは packages/vscode-wcs 側のユニットテスト一式が
// 担保する。ここで検査するのは「npm で配る単一ファイル CLI が、node 直叩きで
// CLI 契約(exit code / 出力形式 / 安定 diagnostic code)どおりに動くこと」だけ。
//
// fixture は一時ディレクトリに生成する。リポジトリ内に *.html / *.manifest.json
// として置くと、CI の wcs-validate job(repo 全体を error severity で gate)が
// 意図的に壊した fixture を拾って build を落とすため、コミットしてはならない。

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(pkgRoot, "dist", "cli.cjs");

if (!existsSync(cli)) {
  console.error("dist/cli.cjs not found — run `npm run build` first.");
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), "wcstack-lint-smoke-"));
const cleanHtml = join(workDir, "clean.html");
const brokenManifest = join(workDir, "broken.manifest.json");
const mutationHtml = join(workDir, "mutation.html");
const namedStateHtml = join(workDir, "named-state.html");
const missingPathHtml = join(workDir, "missing-path.html");
const untrackedReadHtml = join(workDir, "untracked-read.html");
const recursionOkHtml = join(workDir, "recursion-ok.html");
const recursionBadHtml = join(workDir, "recursion-bad.html");
const recursionSpreadHtml = join(workDir, "recursion-spread.html");
const scanOkHtml = join(workDir, "scan-ok.html");
const scanBadHtml = join(workDir, "scan-bad.html");
// stateSchema 発見（D8）: HTML と同じディレクトリの wcstack.manifest.json を自動で読み、
// 宣言済み state の未存在パスは error に上がる（D6）。tmp 下なので repo の CI gate は走査しない。
const schemaDir = join(workDir, "schema");
mkdirSync(schemaDir);
const schemaHtml = join(schemaDir, "index.html");
writeFileSync(join(schemaDir, "wcstack.manifest.json"), JSON.stringify({
  schemaVersion: 2,
  kind: "application",
  manifestExtensions: {
    "wcstack.application": {
      version: 2,
      stateSchema: { type: "object", properties: { message: { type: "string" } } },
    },
  },
}));
writeFileSync(schemaHtml, `<!doctype html>
<wcs-state json='{"message": "hi"}'></wcs-state>
<div data-wcs="textContent: message"></div>
<div data-wcs="textContent: mesage"></div>
`);
writeFileSync(namedStateHtml, `<!doctype html>
<html><body><wcs-state name="cart" json='{"total":1}'></wcs-state><p data-wcs="textContent: x@cart"></p></body></html>
`);
writeFileSync(cleanHtml, "<!doctype html>\n<html><body><p>hello</p></body></html>\n");
writeFileSync(untrackedReadHtml, `<!doctype html>
<html><body>
<wcs-state><script type="module">
export default { form: { name: "" }, get label() { return this.form.name; } };
</script></wcs-state>
<input data-wcs="value: form.name">
</body></html>
`);
// $recursion（再帰パス）。`**` はオーサリング層だけの記号なので、
// 「展開形の具体パスは何段でも通る」と「data-wcs の `**` は error」を対で固定する。
writeFileSync(recursionOkHtml, `<!doctype html>
<html><body>
<wcs-state><script type="module">
export default {
  $recursion: { "nodes.*": "children.*" },
  nodes: [{ value: 1, children: [] }],
  get "nodes.**.total"() {
    return this["nodes.**.value"] + this.$getAll("nodes.**.children.*.total").reduce((a, b) => a + b, 0);
  },
};
</script></wcs-state>
<template data-wcs="for: nodes">
  <b data-wcs="textContent: nodes.*.total"></b>
  <template data-wcs="for: nodes.*.children">
    <b data-wcs="textContent: nodes.*.children.*.total"></b>
  </template>
</template>
</body></html>
`);
writeFileSync(recursionBadHtml, `<!doctype html>
<html><body>
<wcs-state><script type="module">
export default {
  $recursion: { "nodes.*": "children.*" },
  nodes: [],
  get "nodes.**.total"() { return 0; },
};
</script></wcs-state>
<b data-wcs="textContent: nodes.**.total"></b>
</body></html>
`);
// spread で宣言を持ち込む state（`...tree` の中身は静的に読めない）。「未宣言」と断定して
// error（exit 1）にしてはならない — 正当なコードで CI が赤になる形（第 2 サイクルで実測）。
writeFileSync(recursionSpreadHtml, `<!doctype html>
<html><body>
<wcs-state><script type="module">
const tree = { $recursion: { "nodes.*": "children.*" } };
export default {
  ...tree,
  nodes: [],
  get "nodes.**.total"() { return 0; },
  get treeTotal() { return this.$getAll("nodes.**.value", []).reduce((a, b) => a + b, 0); },
};
</script></wcs-state>
</body></html>
`);
writeFileSync(brokenManifest, "{ this is not json\n");
writeFileSync(mutationHtml, `<!doctype html>
<wcs-state><script type="module">
export default {
  items: [],
  add(item) { this.items.push(item); },
};
</script></wcs-state>
`);
writeFileSync(missingPathHtml, `<!doctype html>
<wcs-state><script type="module">
export default { message: "hi" };
</script></wcs-state>
<div data-wcs="textContent: missingPath"></div>
`);

// $scan（時間軸の累積）。宣言の形と getter source は runtime（scan/processScanDeclaration.ts）と
// 同じ code の error。正しい宣言（from / on / resetOn）は出力が候補パスとして実体化され無診断。
writeFileSync(scanOkHtml, `<!doctype html>
<wcs-state><script type="module">
export default {
  page: 1,
  $eventTokens: ["pageArrived"],
  $streams: { pageResult: { args: (s) => s.page, source: (page, signal) => load(page, signal) } },
  $scan: {
    feed: { from: "pageResult", initial: { items: [] }, fold: (acc, chunk) => acc },
    log: { on: "pageArrived", initial: [], fold: (acc, event) => [...acc, event.detail], resetOn: ["page"] },
  },
};
</script></wcs-state>
<p data-wcs="textContent: feed.items.length"></p>
`);
writeFileSync(scanBadHtml, `<!doctype html>
<wcs-state><script type="module">
export default {
  get total() { return 1; },
  $eventTokens: ["tick"],
  $scan: {
    count: { on: "tikc", initial: 0, fold: (acc) => acc + 1 },
    sum: { from: "total", initial: 0, fold: (acc, cur) => acc + cur },
  },
};
</script></wcs-state>
`);

const failures = [];
let caseCount = 0;

/**
 * CLI を起動し、期待 exit code と stdout/stderr の包含を検査する。
 * expect: { exit, stdout?: (string|RegExp)[], stderr?: (string|RegExp)[] }
 */
function check(title, args, expect) {
  caseCount++;
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  const problems = [];
  if (result.status !== expect.exit) {
    problems.push(`exit code: expected ${expect.exit}, got ${result.status}`);
  }
  for (const [stream, patterns] of [["stdout", expect.stdout], ["stderr", expect.stderr]]) {
    for (const pattern of patterns ?? []) {
      const text = result[stream] ?? "";
      const hit = pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);
      if (!hit) problems.push(`${stream}: expected ${pattern}, got:\n${text || "(empty)"}`);
    }
  }
  if (problems.length > 0) {
    failures.push(`✗ ${title}\n    ${problems.join("\n    ")}`);
    console.error(`✗ ${title}`);
  } else {
    console.log(`✓ ${title}`);
  }
}

check("no args → usage on stderr, exit 2", [], {
  exit: 2,
  stderr: ["usage: wcs-validate"],
});

check("clean HTML → exit 0, zero errors/warnings", ["--lang=en", cleanHtml], {
  exit: 0,
  stdout: ["0 error(s), 0 warning(s)"],
});

check("broken manifest JSON → exit 1, stable code + source:line:col", ["--lang=en", brokenManifest], {
  exit: 1,
  stdout: [/broken\.manifest\.json:\d+:\d+ error wcs\/manifest-broken /],
});

check("diagnostic code is language-independent (--lang=ja)", ["--lang=ja", brokenManifest], {
  exit: 1,
  stdout: ["error wcs/manifest-broken"],
});

check("--errors-only keeps error lines visible", ["--lang=en", "--errors-only", brokenManifest], {
  exit: 1,
  stdout: ["error wcs/manifest-broken"],
});

check("unreadable file → exit 2", ["--lang=en", join(workDir, "no-such-file.html")], {
  exit: 2,
  stderr: ["cannot read"],
});

// error severity は exit code を 1 にする(CLI 契約)。この family は非リアクティブ
// 代入 = DOM が黙って更新されない欠陥なので error（docs/array-mutation-diagnostic-design.md）。
check("destructive array mutation → error wcs/array-mutation, exit 1", ["--lang=en", mutationHtml], {
  exit: 1,
  stdout: [/error wcs\/array-mutation /, "1 error(s), 0 warning(s)"],
});

// v2: 名前次元は撤去 — name 属性 / @name は runtime の fail-fast と同じ文言の error。
// severity を warning に戻すと release スモークが契約ドリフトとして落ちる（#183 の教訓）。
check("named state (name= / @name) → error wcs/named-state-deprecated, exit 1", ["--lang=en", namedStateHtml], {
  exit: 1,
  stdout: [/error wcs\/named-state-deprecated /],
});

// 対になる検査: warning severity は exit code を変えない(CLI 契約)。上のケースが
// error に上がった際、この契約の検査が道連れで消えかけた。severity を動かすときは
// error/warning 両側のケースが残っているかを確かめること。
check("unresolvable path → warning wcs/binding-path-missing, exit 0", ["--lang=en", missingPathHtml], {
  exit: 0,
  stdout: [/warning wcs\/binding-path-missing /, "0 error(s), 1 warning(s)"],
});

// getter 本体の AST 解析に依存する唯一の診断。acorn が cli.cjs に同梱されていなければ
// この warning は出ない(typescript と違い external ではなく inline — esbuild.config.js)。
// severity は warning: ルートを丸ごと置換する設計なら壊れない条件付きの欠陥。
check("nested read inside a getter → warning wcs/getter-untracked-read, exit 0", ["--lang=en", untrackedReadHtml], {
  exit: 0,
  stdout: [/warning wcs\/getter-untracked-read /, "0 error(s), 1 warning(s)"],
});

// $recursion の展開形は何段でも「存在する」— 深さを畳んで候補に当てる規則が
// バンドルに載っていないと、深い具体パスが binding-path-missing で warning に化ける。
check("recursive tree: expanded concrete paths are clean, exit 0", ["--lang=en", recursionOkHtml], {
  exit: 0,
  stdout: ["0 error(s), 0 warning(s)"],
});

// `**` はオーサリング層だけの記号。data-wcs に書くと runtime は PathInfo の不変条件で
// throw する ＝ ページごと止まるので error(exit 1)。
check("`**` in data-wcs → error wcs/recursion-unsupported, exit 1", ["--lang=en", recursionBadHtml], {
  exit: 1,
  stdout: [/error wcs\/recursion-unsupported /, "1 error(s), 0 warning(s)"],
});
check("$recursion brought in by a spread is not reported as undeclared, exit 0", ["--lang=en", recursionSpreadHtml], {
  exit: 0,
  stdout: ["0 error(s), 0 warning(s)"],
});

// --strict は exit code の閾値だけを warning に下げる(severity は不変)。error 側 /
// warning 側 / clean の三点で固定する: severity を動かす変更が strict の契約を道連れに
// しないよう、上の error/warning ペアと同じ対称性をここでも保つ。
check("--strict: warning → exit 1, severity label unchanged, summary marked (strict)", ["--lang=en", "--strict", missingPathHtml], {
  exit: 1,
  stdout: [/warning wcs\/binding-path-missing /, "0 error(s), 1 warning(s), 0 info (strict)"],
});

check("--strict: error → exit 1 as before", ["--lang=en", "--strict", brokenManifest], {
  exit: 1,
  stdout: [/error wcs\/manifest-broken /, "(strict)"],
});

check("--strict: clean HTML → still exit 0", ["--lang=en", "--strict", cleanHtml], {
  exit: 0,
  stdout: ["0 error(s), 0 warning(s), 0 info (strict)"],
});

check("--strict + --errors-only: warning hidden from output but still fails", ["--lang=en", "--strict", "--errors-only", missingPathHtml], {
  exit: 1,
  stdout: ["0 error(s), 1 warning(s), 0 info (strict)"],
});

// stateSchema が宣言された state（同ディレクトリの wcstack.manifest.json を自動発見）では、
// 同じ typo が warning でなく error になり exit 1（D6 / D8）。manifest は引数に渡していない。
check("nearest wcstack.manifest.json declares stateSchema → typo is error wcs/path-nonexistent, exit 1", ["--lang=en", schemaHtml], {
  exit: 1,
  stdout: [/index\.html:\d+:\d+ error wcs\/path-nonexistent .*"mesage"/, "1 error(s), 0 warning(s)"],
});

check("$scan declarations with from / on / resetOn are clean, exit 0", ["--lang=en", scanOkHtml], {
  exit: 0,
  stdout: ["0 error(s), 0 warning(s)"],
});

// 未宣言トークンと getter source は runtime が読み込み時に raise する形 ＝ error（exit 1）。
check("$scan: undeclared token + getter source → errors wcs/scan-declaration-invalid and wcs/scan-source-computed, exit 1", ["--lang=en", scanBadHtml], {
  exit: 1,
  stdout: [/error wcs\/scan-declaration-invalid /, /error wcs\/scan-source-computed /, "2 error(s), 0 warning(s)"],
});

rmSync(workDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length}/${caseCount} smoke case(s) failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`\nall ${caseCount} smoke cases passed`);
