// S4, sixth slice: the three cheap imports left on `State.ts` after the feature moves.
//   * `RecursionRegistry` is only a TYPE there now (the getter's return type and a setter's
//     parameter), so `import type` removes the value edge entirely.
//   * `installScopeHooks()` / `installDccHooks()` were belt-and-braces calls from the element.
//     Installing a feature is the entry's job (`bootstrapState()` already does it for scopes) or
//     the feature's own (DCC installs its hooks where it binds the element).
// What is left afterwards is the DCC branch (`defineDCC`) and the failed-root landing
// (`clearFailedRootNode` / `failPendingVolumes`), both of which need a receptacle of their own.
// Applied to a sandbox copy carrying S3's three slices and S4's first five; anchors must match once.
//   node scripts/research/s4TrimStateImportsPatch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: s4TrimStateImportsPatch.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const [anchor, replacement] of edits) {
    const count = code.split(anchor).length - 1;
    if (count !== 1) throw new Error(`${rel}: anchor found ${count} times: ${anchor.slice(0, 70)}`);
    code = code.replace(anchor, () => replacement);
  }
  await writeFile(file, code);
  console.log('patched', rel);
}

// DCC installs its own address hooks where it binds the element (it already calls setBindableEventMap there)
await patch('src/dcc/defineDCC.ts', 'installDccHooks', [
  [`          stateEl.setBindableEventMap(DCCElement.bindableEventMap);\n`,
   `          // 書き込み後の bindable イベントを撃つ hook を、束ねる時点で install する（設計案 H1）\n          installDccHooks();\n          stateEl.setBindableEventMap(DCCElement.bindableEventMap);\n`],
]);
{
  const file = join(pkg, 'src/dcc/defineDCC.ts');
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (!code.includes('from "./addressHooks"')) {
    const anchor = code.match(/^import .*\n/m);
    code = code.replace(anchor[0], () => anchor[0] + `import { installDccHooks } from "./addressHooks";\n`);
    await writeFile(file, code);
    console.log('patched src/dcc/defineDCC.ts (import)');
  }
}

await patch('src/components/State.ts', 'import type { RecursionRegistry }', [
  [`import { RecursionRegistry } from "../recursion/registry";\n`, `import type { RecursionRegistry } from "../recursion/registry";\n`],
  // installing a feature is the entry's job (`bootstrapState()`), not the element's
  [`import { installDccHooks } from "../dcc/addressHooks";\n`, ``],
  [`import { installScopeHooks } from "../webComponent/addressHooks";\n`, ``],
  [`    // \`$bindables\` の束ね先になった: 書き込み後の bindable イベントを撃つ hook を付ける\n    installDccHooks();\n    this.attachAddressHooks("dcc", STATE_BINDABLES_NAME);\n`,
   `    // \`$bindables\` の束ね先になった: 書き込み後の bindable イベントを撃つ hook を付ける\n    // （install は dcc/defineDCC.ts が束ねる時点で済ませている）\n    this.attachAddressHooks("dcc", STATE_BINDABLES_NAME);\n`],
  [`  private _attachScopeHooks(declaration: string): void {\n    installScopeHooks();\n    this.attachAddressHooks("scopes", declaration);\n  }\n`,
   `  private _attachScopeHooks(declaration: string): void {\n    // install は \`bootstrapState()\` の \`installVolumeGraft()\` が済ませている（未 install は\n    // \`attachAddressHooks\` の readiness barrier が名指しで落とす — D13）\n    this.attachAddressHooks("scopes", declaration);\n  }\n`],
]);
// test-side: this unit test drives the element directly instead of going through `defineDCC`,
// so nothing installed the feature and the readiness barrier (D13) now fires — correctly. The test
// installs it itself, which is what a split entry's page would do.
await patch('__tests__/dcc.State.test.ts', 'installDccHooks', [
  [`    it('setBindableEventMapで設定できること', () => {\n      const stateEl = document.createElement(STATE_TAG) as State;\n`,
   `    it('setBindableEventMapで設定できること', () => {\n      installDccHooks();\n      const stateEl = document.createElement(STATE_TAG) as State;\n`],
]);
{
  const file = join(pkg, '__tests__/dcc.State.test.ts');
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (!code.includes('from "../src/dcc/addressHooks"')) {
    const anchor = code.match(/^import .*from ["']vitest["'];\n/m);
    if (anchor === null) throw new Error('dcc.State.test.ts: could not anchor the import');
    code = code.replace(anchor[0], () => anchor[0] + `import { installDccHooks } from "../src/dcc/addressHooks";\n`);
    await writeFile(file, code);
    console.log('patched __tests__/dcc.State.test.ts (import)');
  }
}
console.log('done');
