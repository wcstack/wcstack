import type { FullConfig, Reporter, TestCase } from "@playwright/test/reporter";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Flaky tests in observe mode (docs/verification-practices-study.md §2.4). CI retries a failed test twice, and a test
 * that passes on a retry counts as passed: a defect that fails one attempt in three goes green 26 times in 27. This
 * reporter lists every test that passed only on a retry — in the job summary, and as a warning on its line — with
 * its first failure, so that each one is looked into: fixed, or deleted with the reason written down. It does not
 * fail the run; `failOnFlakyTests` does that, once the count has stayed at 0 for 10 runs in a row.
 *
 * When there is one, it also writes `flaky.json` (the same rows) into the output directory, and the workflow keeps that
 * directory as an artifact: the first failure's `error-context.md` (the error, the call log, an ARIA snapshot of the
 * page) and screenshot are there, and the retry's trace — which a passing job used to throw away
 * (docs/verification-practices-study.md §4.1).
 */
export default class FlakySummaryReporter implements Reporter {
  private readonly tests = new Set<TestCase>();
  private outputDir = "test-results";

  onBegin(config: FullConfig): void {
    this.outputDir = config.projects[0]?.outputDir ?? this.outputDir;
  }

  onTestEnd(test: TestCase): void {
    this.tests.add(test);
  }

  onEnd(): void {
    const flaky = [...this.tests].filter((t) => t.outcome() === "flaky");
    const rows = flaky.map((t) => {
      const file = relative(process.cwd(), t.location.file).replaceAll("\\", "/");
      const failed = t.results.find((r) => r.status !== "passed" && r.status !== "skipped");
      // the first line of the first failure, without the terminal colours
      const first = (failed?.error?.message ?? "").replace(/\x1b\[[0-9;]*m/g, "").split("\n").find((l) => l.trim()) ?? "";
      return { file, line: t.location.line, title: t.titlePath().slice(3).join(" › "), project: t.parent.project()?.name ?? "", first: first.trim() };
    });
    if (rows.length > 0) {
      mkdirSync(this.outputDir, { recursive: true });
      writeFileSync(join(this.outputDir, "flaky.json"), `${JSON.stringify(rows, null, 2)}\n`);
    }
    if (process.env.GITHUB_ACTIONS) {
      for (const r of rows) console.log(`::warning file=e2e/${r.file},line=${r.line}::flaky (passed on a retry) [${r.project}] ${r.title}: ${r.first}`);
    }
    const out = process.env.GITHUB_STEP_SUMMARY;
    if (!out) return;
    const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
    const lines = rows.length === 0
      ? ["### e2e: no flaky tests", ""]
      : [
          `### e2e: ${rows.length} flaky test${rows.length === 1 ? "" : "s"} (passed only on a retry)`,
          "",
          "| Test | Project | First failure |",
          "|---|---|---|",
          ...rows.map((r) => `| \`${r.file}:${r.line}\` ${cell(r.title)} | ${r.project} | ${cell(r.first)} |`),
          "",
          "Each one hides a failure: find its cause and fix it, or delete the test and write down why (docs/verification-practices-study.md §2.4).",
          "",
        ];
    appendFileSync(out, lines.join("\n") + "\n");
  }
}
