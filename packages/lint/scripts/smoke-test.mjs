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
const missingPathHtml = join(workDir, "missing-path.html");
// stateSchema 発見（D8）: HTML と同じディレクトリの wcstack.manifest.json を自動で読み、
// 宣言済み state の未存在パスは error に上がる（D6）。tmp 下なので repo の CI gate は走査しない。
const schemaDir = join(workDir, "schema");
mkdirSync(schemaDir);
const schemaHtml = join(schemaDir, "index.html");
writeFileSync(join(schemaDir, "wcstack.manifest.json"), JSON.stringify({
  schemaVersion: 1,
  kind: "application",
  manifestExtensions: {
    "wcstack.application": {
      version: 1,
      states: { default: { stateSchema: { type: "object", properties: { message: { type: "string" } } } } },
    },
  },
}));
writeFileSync(schemaHtml, `<!doctype html>
<wcs-state json='{"message": "hi"}'></wcs-state>
<div data-wcs="textContent: message"></div>
<div data-wcs="textContent: mesage"></div>
`);
writeFileSync(cleanHtml, "<!doctype html>\n<html><body><p>hello</p></body></html>\n");
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

// 対になる検査: warning severity は exit code を変えない(CLI 契約)。上のケースが
// error に上がった際、この契約の検査が道連れで消えかけた。severity を動かすときは
// error/warning 両側のケースが残っているかを確かめること。
check("unresolvable path → warning wcs/binding-path-missing, exit 0", ["--lang=en", missingPathHtml], {
  exit: 0,
  stdout: [/warning wcs\/binding-path-missing /, "0 error(s), 1 warning(s)"],
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

rmSync(workDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length}/${caseCount} smoke case(s) failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`\nall ${caseCount} smoke cases passed`);
