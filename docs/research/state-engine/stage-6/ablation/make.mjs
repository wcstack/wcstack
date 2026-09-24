// Ablation builds of state-next: copy src, apply string patches, bundle with esbuild.
import { build } from "file:///C:/Users/kikuzawa/Documents/git/wcstack/wcstack-state-engine/packages/state-next/node_modules/esbuild/lib/main.js";
import { cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
const SRC = "C:/Users/kikuzawa/Documents/git/wcstack/wcstack-state-engine/packages/state-next/src";
const OUT = process.argv[2];
const variants = {
  base: [],
  noevent: [["dom/view.ts", "export function attachEvent(engine: Engine, node: Node, s: Spec, row: StateRow | null): void {", "export function attachEvent(engine: Engine, node: Node, s: Spec, row: StateRow | null): void {\n  if (row !== null) return;"]],
  noclass: [["dom/view.ts", "      default: {\n        const p = s.pattern!;", "      default: {\n        if (s.kind === K_CLASS) break;\n        const p = s.pattern!;"]],
  textonly: [
    ["dom/view.ts", "export function attachEvent(engine: Engine, node: Node, s: Spec, row: StateRow | null): void {", "export function attachEvent(engine: Engine, node: Node, s: Spec, row: StateRow | null): void {\n  if (row !== null) return;"],
    ["dom/view.ts", "      default: {\n        const p = s.pattern!;", "      default: {\n        if (s.kind === K_CLASS) break;\n        const p = s.pattern!;"],
  ],
  classplain: [["dom/view.ts", "let v = this.engine.read(this.pattern, this.row);", "let v = this.kind === K_CLASS ? false : this.engine.read(this.pattern, this.row);"]],
  // text bindings written directly, no Binding object / registration
  bare: [
    ["dom/view.ts", "export function attachEvent(engine: Engine, node: Node, s: Spec, row: StateRow | null): void {", "export function attachEvent(engine: Engine, node: Node, s: Spec, row: StateRow | null): void {\n  if (row !== null) return;"],
    ["dom/view.ts", "      default: {\n        const p = s.pattern!;", "      default: {\n        if (s.kind === K_CLASS) break;\n        if (s.kind === K_TEXT) { (node as any).data = String((row!.item as any)[s.pattern!.last]); break; }\n        const p = s.pattern!;"],
  ],
};
for (const [name, patches] of Object.entries(variants)) {
  const dir = `${OUT}/${name}`;
  rmSync(dir, { recursive: true, force: true });
  cpSync(SRC, `${dir}/src`, { recursive: true });
  for (const [file, from, to] of patches) {
    const f = `${dir}/src/${file}`;
    const s = readFileSync(f, "utf8");
    if (!s.includes(from)) throw new Error(`${name}: patch not found in ${file}: ${from.slice(0, 60)}`);
    writeFileSync(f, s.replace(from, to));
  }
  await build({ entryPoints: [`${dir}/src/auto.ts`], bundle: true, minify: true, format: "esm", target: "es2022", outfile: `${OUT}/${name}.min.js`, legalComments: "none", logLevel: "error" });
  console.log("built", name);
}
