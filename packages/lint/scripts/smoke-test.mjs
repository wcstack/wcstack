// smoke-test.mjs — 配布物 dist/cli.cjs の実行スモークテスト。
//
// validator core のロジックは packages/vscode-wcs 側のユニットテスト(276本)が
// 担保する。ここで検査するのは「npm で配る単一ファイル CLI が、node 直叩きで
// CLI 契約(exit code / 出力形式 / 安定 diagnostic code)どおりに動くこと」だけ。
//
// fixture は一時ディレクトリに生成する。リポジトリ内に *.html / *.manifest.json
// として置くと、CI の wcs-validate job(repo 全体を error severity で gate)が
// 意図的に壊した fixture を拾って build を落とすため、コミットしてはならない。

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

// warning severity は exit code を変えない(CLI 契約)ことも同時に検査する。
check("destructive array mutation → warning wcs/array-mutation, exit 0", ["--lang=en", mutationHtml], {
  exit: 0,
  stdout: [/warning wcs\/array-mutation /, "0 error(s), 1 warning(s)"],
});

rmSync(workDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length}/${caseCount} smoke case(s) failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`\nall ${caseCount} smoke cases passed`);
