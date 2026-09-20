// Survey §10.12 follow-up, second step (round-4 §11 item 6): the allocations left in the clear
// after clearAllocPatch.mjs are the per-node observer-skip marks (a WeakSet add per row, then a
// has/delete per removed node in the observer) and the teardown loops of the pooled rows. This
// patch (a) counts framework removals per parent instead of marking every node — the full clear
// removes all rows with one `textContent = ''`, so one count on the parent covers the single
// mutation record — and (b) turns the remaining `for...of` loops of unmount / deactivateContent /
// unbindLoopContextToContent / _teardownBindings into index loops. Semantics are unchanged; a
// parent whose count does not cover a record's removed nodes falls back to the per-node marks.
// Applied on top of clearAllocPatch.mjs in a sandbox copy; every anchor must match exactly once.
//   node scripts/research/clearAllocPatch2.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: clearAllocPatch2.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, 'src', rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const [anchor, replacement, all] of edits) {
    const count = anchor instanceof RegExp ? (code.match(new RegExp(anchor.source, 'g')) ?? []).length : code.split(anchor).length - 1;
    if (all ? count < 1 : count !== 1) throw new Error(`${rel}: anchor found ${count} times: ${String(anchor).slice(0, 70)}`);
    const fn = typeof replacement === 'function' ? replacement : () => replacement;
    code = all ? code.replaceAll(anchor, fn) : code.replace(anchor, fn);
  }
  await writeFile(file, code);
  console.log('patched', rel);
}

// (a) observer skip by parent count
await patch('bindings/observerSkip.ts', 'markObserverSkipRemovedChildren', [
  [`const observerSkipAddedNodes = new WeakSet<Node>();`, `// clear-alloc 2: framework removals counted per parent (one count covers a mutation record that
// removed that many children at once), instead of one WeakSet mark per removed node
const skipRemovedChildrenByParent = new WeakMap<Node, number>();

export function markObserverSkipRemovedChildren(parent: Node, count: number): void {
  skipRemovedChildrenByParent.set(parent, (skipRemovedChildrenByParent.get(parent) ?? 0) + count);
}

/** Consumes \`count\` framework removals of \`parent\`; false (and nothing consumed) when the count does not cover them. */
export function consumeObserverSkipRemovedChildren(parent: Node, count: number): boolean {
  const pending = skipRemovedChildrenByParent.get(parent);
  if (typeof pending === "undefined" || pending < count) {
    return false;
  }
  if (pending === count) {
    skipRemovedChildrenByParent.delete(parent);
  } else {
    skipRemovedChildrenByParent.set(parent, pending - count);
  }
  return true;
}

const observerSkipAddedNodes = new WeakSet<Node>();`],
]);

await patch('bindings/BindingSession.ts', 'consumeObserverSkipRemovedChildren', [
  [`import { consumeObserverSkipOnAdd, consumeObserverSkipOnRemove, decrementPendingObservation, hasPendingObservation, incrementPendingObservation } from "./observerSkip";`,
   `import { consumeObserverSkipOnAdd, consumeObserverSkipOnRemove, consumeObserverSkipRemovedChildren, decrementPendingObservation, hasPendingObservation, incrementPendingObservation } from "./observerSkip";`],
  [`    for (const mutation of mutations) {
      removed.push(...Array.from(mutation.removedNodes));
      added.push(...Array.from(mutation.addedNodes));
    }`, `    for (let m = 0; m < mutations.length; m++) {
      const mutation = mutations[m];
      const removedNodes = mutation.removedNodes;
      // clear-alloc 2: a record whose removed children are all framework removals (counted on the
      // parent by the clear) is skipped whole, without touching the per-node marks
      if (removedNodes.length === 0 || !consumeObserverSkipRemovedChildren(mutation.target, removedNodes.length)) {
        for (let i = 0; i < removedNodes.length; i++) removed.push(removedNodes[i]);
      }
      const addedNodes = mutation.addedNodes;
      for (let i = 0; i < addedNodes.length; i++) added.push(addedNodes[i]);
    }`],
]);

await patch('apply/applyChangeToFor.ts', 'markObserverSkipRemovedChildren', [
  [`import { getBindingsByContent } from "../bindings/bindingsByContent";`,
   `import { getBindingsByContent } from "../bindings/bindingsByContent";\nimport { markObserverSkipRemovedChildren } from "../bindings/observerSkip";`],
  [`    if (isOnlyNode) {
      const parentNode = bindingInfo.node.parentNode;
      parentNode.textContent = '';
      parentNode.appendChild(bindingInfo.node);
    }`, `    if (isOnlyNode) {
      const parentNode = bindingInfo.node.parentNode;
      // clear-alloc 2: the whole batch of children leaves in one mutation record; one count on the
      // parent lets the observer skip that record instead of consuming a mark per row
      markObserverSkipRemovedChildren(parentNode, parentNode.childNodes.length);
      parentNode.textContent = '';
      parentNode.appendChild(bindingInfo.node);
    }`],
]);

// (b) index loops in the teardown paths; per-node marks only when a node is actually removed here
await patch('structural/createContent.ts', 'clear-alloc 2', [
  // tryDestroy (already an index loop from clearAllocPatch.mjs)
  [`      markObserverSkipOnRemove(node);
      if (node.parentNode !== null) {
        node.parentNode.removeChild(node);
      }
    }
    const bindings = getBindingsByContent(this);
    for (let i = 0; i < bindings.length; i++) {`, `      // clear-alloc 2: mark only when this content removes the node itself (a batch removal by the
      // parent is counted there)
      if (node.parentNode !== null) {
        markObserverSkipOnRemove(node);
        node.parentNode.removeChild(node);
      }
    }
    const bindings = getBindingsByContent(this);
    for (let i = 0; i < bindings.length; i++) {`],
  // unmount
  [/    for\(const node of this\._childNodeArray\) \{\n([\s\S]*?)      markObserverSkipOnRemove\(node\);\n      if \(node\.parentNode !== null\) \{\n        node\.parentNode\.removeChild\(node\);\n      \}\n    \}/,
   (m, comments) => `    const childNodes = this._childNodeArray;
    for (let i = 0; i < childNodes.length; i++) {
      const node = childNodes[i];
${comments}      if (node.parentNode !== null) {
        markObserverSkipOnRemove(node);
        node.parentNode.removeChild(node);
      }
    }`],
  // unmount / _teardownBindings binding loops (both occurrences)
  [`    for(const binding of bindings) {
      if (recursiveBindingTypes.has(binding.bindingType)) {
        const contents = getContentSetByNode(binding.node);
        for (const content of contents) {
          content.unmount();
        }
      }
      clearStateAddressByBindingInfo(binding);
      clearAbsoluteStateAddressByBinding(binding);
    }`, `    for (let i = 0; i < bindings.length; i++) {
      const binding = bindings[i];
      if (recursiveBindingTypes.has(binding.bindingType)) {
        getContentSetByNode(binding.node).forEach((content) => { content.unmount(); });
      }
      clearStateAddressByBindingInfo(binding);
      clearAbsoluteStateAddressByBinding(binding);
    }`, true],
]);

await patch('structural/activateContent.ts', 'clear-alloc 2', [
  [`  const bindings = getBindingsByContent(content);
  const session = getBindingSessionByContent(content);
  for (const binding of bindings) {
    if (session !== null) {
      session.disposeBinding(binding);`, `  const bindings = getBindingsByContent(content);
  const session = getBindingSessionByContent(content);
  for (let i = 0; i < bindings.length; i++) { // clear-alloc 2
    const binding = bindings[i];
    if (session !== null) {
      session.disposeBinding(binding);`],
]);

await patch('bindings/bindLoopContextToContent.ts', 'clear-alloc 2', [
  [`  const nodes = getNodesByContent(content);
  for(const node of nodes) {
    setLoopContextByNode(node, null);
  }`, `  const nodes = getNodesByContent(content);
  for (let i = 0; i < nodes.length; i++) { // clear-alloc 2
    setLoopContextByNode(nodes[i], null);
  }`],
]);
