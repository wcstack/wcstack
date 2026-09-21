// Survey §10.12 follow-up (round-3 §11 item 6): remove the iteration-protocol garbage of the
// clear in a sandbox copy of packages/state. `for...of` over arrays and Sets in the destroy
// path (Content.tryDestroy, applyChangeToFor's delete loop, the session's record loops) is
// replaced by index loops / Set.forEach, so that the clear of 10,000 rows allocates far less
// and the scavenge no longer lands inside its window. Semantics are unchanged. Every
// replacement asserts that its anchor exists exactly once; idempotent through markers.
//   node scripts/research/clearAllocPatch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: clearAllocPatch.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, 'src', rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const [anchor, replacement] of edits) {
    const count = anchor instanceof RegExp ? (code.match(new RegExp(anchor.source, 'g')) ?? []).length : code.split(anchor).length - 1;
    if (count !== 1) throw new Error(`${rel}: anchor found ${count} times: ${String(anchor).slice(0, 70)}`);
    code = code.replace(anchor, typeof replacement === 'function' ? replacement : () => replacement);
  }
  await writeFile(file, code);
  console.log('patched', rel);
}

// 1. Content.tryDestroy: index loops over the child nodes and the bindings
await patch('structural/createContent.ts', 'clear-alloc: index loops', [
  [`    session.destroyRecords();
    for (const node of this._childNodeArray) {`, `    session.destroyRecords();
    // clear-alloc: index loops (no iterator objects per row)
    const childNodes = this._childNodeArray;
    for (let i = 0; i < childNodes.length; i++) {
      const node = childNodes[i];`],
  [`    const bindings = getBindingsByContent(this);
    for (const binding of bindings) {
      if (recursiveBindingTypes.has(binding.bindingType)) {
        const contents = getContentSetByNode(binding.node);
        for (const content of contents) {
          if (!content.tryDestroy()) {
            content.unmount();
          }
        }
      }
    }
    this._mounted = false;
    return true;`, `    const bindings = getBindingsByContent(this);
    for (let i = 0; i < bindings.length; i++) {
      const binding = bindings[i];
      if (recursiveBindingTypes.has(binding.bindingType)) {
        getContentSetByNode(binding.node).forEach((content) => {
          if (!content.tryDestroy()) {
            content.unmount();
          }
        });
      }
    }
    this._mounted = false;
    return true;`],
]);

// 2. applyChangeToFor: the delete loop iterates the Set without result objects
await patch('apply/applyChangeToFor.ts', 'clear-alloc: Set.forEach', [
  // the closure cannot see TypeScript's narrowing of `contentMap`, so it reads a local copy
  [/    for\(const deleteIndex of diff\.deleteIndexSet\) \{\n([\s\S]*?)\n    \}\n    if \(fullDelete\) \{/, (m, body) => `    // clear-alloc: Set.forEach (no iterator result object per row)
    const map = contentMap;
    diff.deleteIndexSet.forEach((deleteIndex) => {
${body.replaceAll('contentMap.', 'map.')}
    });
    if (fullDelete) {`],
]);

// 3. BindingSession: skip the empty record Set in the clear path (the second hunk exists only on
//    the row-record prototype, where destroyRecords handles the row first; it is optional)
{
  const file = join(pkg, 'src/bindings/BindingSession.ts');
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes('clear-alloc: skip empty')) { console.log('already patched bindings/BindingSession.ts'); }
  else {
    const a1 = `  canWholesaleDestroy(): boolean {
    if (this.deferred.size > 0) return false;
    for (const record of this.records) {`;
    if (code.split(a1).length !== 2) throw new Error('BindingSession: canWholesaleDestroy anchor');
    code = code.replace(a1, () => `  canWholesaleDestroy(): boolean {
    if (this.deferred.size > 0) return false;
    if (this.records.size === 0) return true; // clear-alloc: skip empty (plan rows keep no records)
    for (const record of this.records) {`);
    const a2 = `      row.teardowns = null;
    }
    for (const record of this.records) {`;
    if (code.split(a2).length === 2) code = code.replace(a2, () => `      row.teardowns = null;
    }
    if (this.records.size === 0) return;
    for (const record of this.records) {`);
    await writeFile(file, code);
    console.log('patched bindings/BindingSession.ts');
  }
}
