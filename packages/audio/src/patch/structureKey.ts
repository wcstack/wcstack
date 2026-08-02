import { Patch, PatchNode } from "../types.js";

const nodeKey = (n: PatchNode): string =>
  `${n.kind}#${n.key}@${n.id ?? ""}|${(n.out ?? []).join(",")}|${n.param ?? ""}` +
  `|${n.note ? 1 : 0}|${n.master ? 1 : 0}(${(n.children ?? []).map(nodeKey).join(" ")})`;

/**
 * Serialize everything about a patch that affects graph **topology** — kinds,
 * keys, ids, routing, nesting, voice templates — and deliberately nothing about
 * its **values**.
 *
 * That split is what makes `setPatch()` self-classifying: a patch differing only
 * in numbers produces the same key and is applied as a live update, while any
 * structural difference triggers a rebuild. Callers can therefore re-submit the
 * whole patch on any change without deciding which kind of change it was, and a
 * redundant re-submission is free (ADR-14 G5: idempotent `setPatch`).
 */
export function structureKey(patch: Patch): string {
  const nodes = patch.nodes.map(nodeKey).join(" ");
  const voices = (patch.voices ?? [])
    .map((v) => `voice#${v.key}*${v.poly}(${v.nodes.map(nodeKey).join(" ")})`)
    .join(" ");
  return `${nodes}||${voices}`;
}
