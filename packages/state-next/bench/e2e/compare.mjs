// Compares two Playwright JSON reports (current vs next): which tests pass on one and not the other.
//   node compare.mjs <current.json> <next.json>
import { readFileSync } from "node:fs";
const [currentFile, nextFile] = process.argv.slice(2);
const load = (name) => {
  const out = new Map();
  const walk = (suite, file) => {
    for (const s of suite.suites ?? []) walk(s, s.file ?? file);
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests) {
        const r = t.results.at(-1);
        const err = r?.error?.message?.replace(/\x1b\[[0-9;]*m/g, "").split("\n").find((l) => l.trim()) ?? "";
        out.set(`${spec.file ?? file} › ${spec.title}`, { status: r?.status ?? t.status, err: err.slice(0, 200) });
      }
    }
  };
  walk(JSON.parse(readFileSync(name, "utf8")), "");
  return out;
};
const cur = load(currentFile);
const next = load(nextFile);
let both = 0, curOnly = [], nextOnly = [], neither = [];
for (const [k, c] of cur) {
  const n = next.get(k);
  const cp = c.status === "passed", np = n?.status === "passed";
  if (cp && np) both++;
  else if (cp) curOnly.push([k, n?.err ?? "(missing)"]);
  else if (np) nextOnly.push(k);
  else neither.push([k, c.err]);
}
console.log(`tests: ${cur.size}  both pass: ${both}  current only: ${curOnly.length}  next only: ${nextOnly.length}  neither: ${neither.length}`);
const byFile = new Map();
for (const [k, e] of curOnly) {
  const f = k.split(" › ")[0];
  if (!byFile.has(f)) byFile.set(f, []);
  byFile.get(f).push([k.slice(f.length + 3), e]);
}
for (const [f, list] of [...byFile].sort()) {
  console.log(`\n## ${f} (${list.length})`);
  for (const [t, e] of list) console.log(`- ${t}\n    ${e}`);
}
if (nextOnly.length) console.log(`\n## next only\n${nextOnly.join("\n")}`);
if (neither.length) console.log(`\n## neither\n${neither.map(([k, e]) => `${k}: ${e}`).join("\n")}`);
