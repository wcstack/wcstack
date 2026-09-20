// S4, fifth slice (wiring design §3 H4): `$recursion` — the last declaration still interpreted by
// the core. It completes the context bag's story: the recursion feature PUBLISHES its registry into
// the bag and `$scan` CONSUMES it, so the core no longer has to know that one declaration feeds
// another. Two facts force the shape:
//   * `$recursion` is parsed BEFORE the core's own token / `$listKeys` parsing, while `$scan` is
//     parsed after (it needs the token names). Rather than guess that the order does not matter,
//     the receptacle names both points: `validateEarly` and `validate`.
//   * Forgetting the previous generation's generated accessors and swapping the registry happens
//     after every pure validation but still BEFORE the generation bump, which is its own point:
//     `preCommit`.
// Applied to a sandbox copy carrying S3's three slices and S4's first four; anchors must match once.
//   node scripts/research/s4RecursionDeclarationPatch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: s4RecursionDeclarationPatch.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const edit of edits) {
    if (edit.length === 3 && typeof edit[2] === 'string') {
      const [start, end, replacement] = edit;
      const s = code.indexOf(start);
      if (s === -1 || code.indexOf(start, s + 1) !== -1) throw new Error(`${rel}: start anchor not unique: ${start.slice(0, 70)}`);
      const e = code.indexOf(end, s);
      if (e === -1 || code.indexOf(end, e + 1) !== -1) throw new Error(`${rel}: end anchor not unique: ${end.slice(0, 70)}`);
      code = code.slice(0, s) + replacement + code.slice(e + end.length);
      continue;
    }
    const [anchor, replacement] = edit;
    const count = code.split(anchor).length - 1;
    if (count !== 1) throw new Error(`${rel}: anchor found ${count} times: ${anchor.slice(0, 70)}`);
    code = code.replace(anchor, () => replacement);
  }
  await writeFile(file, code);
  console.log('patched', rel);
}
async function writeOnce(rel, content) {
  const file = join(pkg, rel);
  const existing = await readFile(file, 'utf8').catch(() => null);
  if (existing !== null && existing.replaceAll('\r\n', '\n').includes(content.slice(0, 200))) { console.log('already written', rel); return; }
  await writeFile(file, content);
  console.log('wrote', rel);
}

// 1. two more points on the declaration timeline
await patch('src/core/declarationHooks.ts', 'runValidateEarly', [
  [` *   validate    世代を進める前（\`value\` しか読まない検証。ここで throw した再セットは世代を進めない）\n`,
   ` *   validateEarly  core 自身のトークン / \`$listKeys\` の解析より前（\`$recursion\` はここで解析される）\n` +
   ` *   validate    世代を進める前（\`value\` しか読まない検証。ここで throw した再セットは世代を進めない）\n` +
   ` *   preCommit   検証がすべて済み、まだ世代を進めていない点（旧世代の後始末と差し替え）\n`],
  [`  readonly validate?: (element: IStateElement, value: IState, ctx: IDeclarationContext) => void;\n`,
   `  readonly validateEarly?: (element: IStateElement, value: IState, ctx: IDeclarationContext) => void;\n  readonly validate?: (element: IStateElement, value: IState, ctx: IDeclarationContext) => void;\n  readonly preCommit?: (element: IStateElement, value: IState, ctx: IDeclarationContext) => void;\n`],
  [`export function runValidate(element: IStateElement, value: IState, ctx: IDeclarationContext): void {\n`,
   `export function runValidateEarly(element: IStateElement, value: IState, ctx: IDeclarationContext): void {\n  for (let i = 0; i < ordered.length; i++) {\n    ordered[i].validateEarly?.(element, value, ctx);\n  }\n}\n\nexport function runPreCommit(element: IStateElement, value: IState, ctx: IDeclarationContext): void {\n  for (let i = 0; i < ordered.length; i++) {\n    ordered[i].preCommit?.(element, value, ctx);\n  }\n}\n\nexport function runValidate(element: IStateElement, value: IState, ctx: IDeclarationContext): void {\n`],
]);

// 2. the recursion feature owns its declaration
await writeOnce('src/recursion/declarations.ts', `/**
 * recursion/declarations.ts — \`$recursion\` の宣言（設計案 H4、S4）。
 *
 * 文脈袋の作り手でもある: 構築したレジストリを袋に置き、\`$scan\` の検証がそれを読む
 * （\`**\` getter の展開形を \`from\` に書いた形を落とすため — D5）。core は「ある宣言が別の宣言に
 * 値を渡す」ことを知らなくてよくなった。
 *
 * 段の位置は従来の \`_state\` セッターのまま:
 *   validateEarly  core 自身のトークン / \`$listKeys\` の解析より前（\`value\` しか読まない）
 *   preCommit      旧世代の生成アクセサ・依存辺・キャッシュを忘れてから差し替える。世代を進める前
 *   apply          アンカーのリストパスの登録（\`_listPaths\` のクリアより後）
 */
import type { IStateElement } from "../components/types";
import type { IState } from "../types";
import { IDeclarationHooks, registerDeclarationHooks } from "../core/declarationHooks";
import { STATE_RECURSION_NAME } from "../define";
import { processRecursionDeclaration } from "./declaration";
import { RecursionRegistry } from "./registry";
import type { IRecursionSpec } from "./types";

const SPEC = "recursionSpec";
const REGISTRY = "recursionRegistry";

export const recursionDeclarationHooks: IDeclarationHooks = {
  // scan（8）より先に走り、袋にレジストリを置く
  order: 5,
  validateEarly(_element, value, ctx) {
    const spec = processRecursionDeclaration(value);
    ctx.set(SPEC, spec);
    ctx.set(REGISTRY, spec === null ? null : new RecursionRegistry(spec, value));
  },
  preCommit(element, _value, ctx) {
    // 旧世代の生成アクセサ（own）・それを指す依存辺・評価結果のキャッシュを忘れてから
    // 差し替える（recursion/generation.ts）。own の生成アクセサは、同じオブジェクトを再セットする
    // ときに \`getStateInfo\` が \`getterPaths\` へ拾い直す前に消えていなければならない。
    // 前世代の再帰レジストリが生やした具体パスは要素の除外集合に積む。経路情報の作り直し
    // （\`_rebuildPathInfo\`）はそこを除く — 新しい世代ではまだ実体化されていないため。
    const previous = element.recursionRegistry;
    if (previous !== null) {
      for (const path of previous.forgetGenerated(element, ctx.get<IState>("previousState") as IState)) {
        element.addGeneratedPath?.(path);
      }
    }
    const registry = ctx.get<RecursionRegistry | null>(REGISTRY) ?? null;
    element.setRecursionRegistry?.(registry);
    if (registry !== null) {
      // \`$recursion\` を宣言した state にだけ再帰の hook（\`**\` の束縛・再帰 getter の書き込み禁止）を付ける
      element.attachAddressHooks?.("recursion", STATE_RECURSION_NAME);
    }
  },
  apply(element, _value, ctx) {
    const spec = ctx.get<IRecursionSpec | null>(SPEC) ?? null;
    if (spec === null) {
      return;
    }
    // アンカーのリストパス（\`nodes.*\` なら \`nodes\`）は**宣言から静的に分かる**ので、
    // 展開を待たずに今すぐ登録する。
    //
    // これが無いと、再帰パスを一度読んだ後の再セットで構造書き込みが恒久的に落ちる。
    // 生成アクセサの \`setPathInfo\` が張った静的辺（\`nodes\` → \`nodes.*\`）は依存グラフに
    // 残るのに、\`_listPaths\` はセッターでクリアされ、次に再帰パスを読むまで張り直されない。
    // その隙間に構造書き込みが来ると \`walkDependency\` が「リストではないパス」として
    // \`nodes.*\` に到達し、listIndex を持たないアドレスで \`Cannot expand dynamic dependency…\`
    // になる（値は書かれるので、データと表示が乖離したまま自己回復しない）。
    element.addListPath(spec.anchorList);
  },
};

let installed = false;
/** 冪等。full / auto では \`bootstrapState()\` が呼ぶ */
export function installRecursionDeclarations(): void {
  if (installed) return;
  installed = true;
  registerDeclarationHooks("recursion", recursionDeclarationHooks);
}
`);

// 3. the full entry installs it
await patch('src/bootstrapState.ts', 'installRecursionDeclarations', [
  [`import { installScanDeclarations } from "./scan/declarations";\n`,
   `import { installScanDeclarations } from "./scan/declarations";\nimport { installRecursionDeclarations } from "./recursion/declarations";\n`],
  [`  installScanDeclarations();\n`, `  installScanDeclarations();\n  installRecursionDeclarations();\n`],
]);

// 4. the recursion hooks register themselves with the address-hook registry as before
await patch('src/recursion/declarations.ts', 'installRecursionHooks', [
  [`import { processRecursionDeclaration } from "./declaration";\n`,
   `import { installRecursionHooks } from "./addressHooks";\nimport { processRecursionDeclaration } from "./declaration";\n`],
  [`  installed = true;\n  registerDeclarationHooks("recursion", recursionDeclarationHooks);\n`,
   `  installed = true;\n  installRecursionHooks();\n  registerDeclarationHooks("recursion", recursionDeclarationHooks);\n`],
]);

// 5. the element's internal surface
await patch('src/components/types.ts', 'setRecursionRegistry', [
  [`  setBoundComponent?(component: Element | null, stateProp: string | null): void;\n`,
   `  setBoundComponent?(component: Element | null, stateProp: string | null): void;\n` +
   `  /** \`$recursion\` のレジストリ（宣言が無ければ null。\`hasRecursion\` の裏づけ） */\n  setRecursionRegistry?(registry: RecursionRegistry | null): void;\n` +
   `  /** 前世代の再帰レジストリが生やした具体パス（経路情報の作り直しから除く） */\n  addGeneratedPath?(path: string): void;\n`],
]);

// 6. State: the last declaration leaves
await patch('src/components/State.ts', 'runValidateEarly(this, value', [
  [`import { processRecursionDeclaration } from "../recursion/declaration";\n`, ``],
  [`import { installRecursionHooks } from "../recursion/addressHooks";\n`, ``],
  [`import { createDeclarationContext, runActivate, runApply, runApplyEarly, runDeactivate, runRegister, runValidate } from "../core/declarationHooks";\n`,
   `import { createDeclarationContext, runActivate, runApply, runApplyEarly, runDeactivate, runPreCommit, runRegister, runValidate, runValidateEarly } from "../core/declarationHooks";\n`],
  // validateEarly, where `$recursion` used to be parsed
  [`    const recursionSpec = processRecursionDeclaration(value);\n    const recursionRegistry = recursionSpec === null ? null : new RecursionRegistry(recursionSpec, value);\n`,
   `    // 宣言の段（設計案 H4）。文脈袋はこの set のぶんだけ作り、機能どうしの受け渡しに使う。\n` +
   `    // \`$recursion\` はここで解析され、構築したレジストリを袋に置く — \`$scan\` の検証がそれを読む\n` +
   `    const declarations = createDeclarationContext();\n` +
   `    declarations.set("previousState", previousState);\n` +
   `    runValidateEarly(this, value, declarations);\n`],
  // the remaining validate point only publishes the token names now
  [`    // 宣言の検証（設計案 H4 の validate）: 世代を進める前の、\`value\` しか読まない段。ここで throw した\n`,
   `    runValidate(this, value, declarations);\n`,
   `    // 検証の段（設計案 H4 の validate）: 世代を進める前の、\`value\` しか読まない段。ここで throw した\n` +
   `    // 再セットは世代を進めない。core が作ったトークン名を袋へ publish する（\`$scan\` の検証が読む）\n` +
   `    declarations.set("eventTokenNames", eventTokenNames);\n` +
   `    runValidate(this, value, declarations);\n`],
  // preCommit, where the old generation was cleaned up and the registry swapped
  [`    // 旧世代の生成アクセサ（own）・それを指す依存辺・評価結果のキャッシュを忘れてから\n`,
   `      this.attachAddressHooks("recursion", STATE_RECURSION_NAME);\n    }\n`,
   `    // 検証がすべて済み、まだ世代を進めていない点（設計案 H4 の preCommit）: 旧世代の後始末と\n` +
   `    // 差し替えがここに載る（\`$recursion\` — recursion/declarations.ts）\n` +
   `    runPreCommit(this, value, declarations);\n`],
  // the anchor list registration is the feature's `apply` now
  [`    // $recursion: 宣言が無ければ null のままで、読みのホットパスには一切入らない。\n`,
   `      this._listPaths.add(recursionSpec.anchorList);\n    }\n`,
   ``],
  // the internal surface
  [`  setBoundComponent(component: Element | null, stateProp: string | null): void {\n`,
   `  setRecursionRegistry(registry: RecursionRegistry | null): void {\n    this._recursionRegistry = registry;\n  }\n\n` +
   `  addGeneratedPath(path: string): void {\n    this._generatedPaths.add(path);\n  }\n\n` +
   `  setBoundComponent(component: Element | null, stateProp: string | null): void {\n`],
]);
console.log('done');
