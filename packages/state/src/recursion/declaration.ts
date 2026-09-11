/**
 * recursion/declaration.ts
 *
 * `$recursion: { <anchor>: <repeat> }` 宣言を検証して仕様に落とす
 * （docs/state-recursive-path-impl-plan.md §1-1）。宣言が無ければ null で、
 * その state は再帰の経路にまったく入らない（`$listKeys` と同じゼロコスト規約）。
 *
 * 初版が受け付けるのは **単一の自己再帰** だけ。アンカーも反復サブパスも
 * 「固定プロパティ列 + 末尾の `.*` ひとつ」に限る。途中のワイルドカード・複数宣言・
 * 相互再帰は、黙って別の意味に解釈せず明示的に拒否する。
 */

import { DELIMITER, RECURSION_WILDCARD, STATE_RECURSION_NAME, WILDCARD } from "../define";
import { raiseError } from "../raiseError";
import type { IState } from "../types";
import { IRecursionSpec } from "./types";

/** `a.b.*` の形（末尾だけがワイルドカード・空セグメント無し・`**` 無し）か。 */
function assertNodePath(kind: string, path: string): string[] {
  if (typeof path !== "string" || path.length === 0) {
    raiseError(`[wcs/recursion-declaration-invalid] ${STATE_RECURSION_NAME} ${kind} must be a non-empty string.`);
  }
  const segments = path.split(DELIMITER);
  if (segments.some((segment) => segment.length === 0)) {
    raiseError(`[wcs/recursion-declaration-invalid] ${STATE_RECURSION_NAME} ${kind} "${path}" must not contain empty path segments.`);
  }
  if (segments.length < 2) {
    raiseError(
      `[wcs/recursion-declaration-invalid] ${STATE_RECURSION_NAME} ${kind} "${path}" must name a list element: ` +
      `a property path ending with "${DELIMITER}${WILDCARD}" (for example "nodes${DELIMITER}${WILDCARD}").`
    );
  }
  if (segments[segments.length - 1] !== WILDCARD) {
    raiseError(
      `[wcs/recursion-declaration-invalid] ${STATE_RECURSION_NAME} ${kind} "${path}" must end with "${DELIMITER}${WILDCARD}" ` +
      `— it names the element of the list, not the list itself.`
    );
  }
  // 予約セグメント。マウントのマーカー（`#m1`）と `$` 名前空間は raw state に実体を
  // 持たないので、再帰のアンカーにはなり得ない（checkDeclaredPath が同じ 2 つで
  // 早期 return しているのと対称）。
  if (segments[0].charCodeAt(0) === 36 /* '$' */) {
    raiseError(
      `[wcs/recursion-declaration-invalid] ${STATE_RECURSION_NAME} ${kind} "${path}" must not start with "$" — that namespace is reserved.`
    );
  }
  if (path.indexOf("#") !== -1) {
    raiseError(
      `[wcs/recursion-declaration-invalid] ${STATE_RECURSION_NAME} ${kind} "${path}" must not contain "#" — that segment is reserved for mounts.`
    );
  }
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] === WILDCARD) {
      raiseError(
        `[wcs/recursion-declaration-invalid] ${STATE_RECURSION_NAME} ${kind} "${path}" must have exactly one "${WILDCARD}", at the end. ` +
        `Wildcards in the middle are not supported in this version.`
      );
    }
    if (segments[i] === RECURSION_WILDCARD) {
      raiseError(
        `[wcs/recursion-declaration-invalid] ${STATE_RECURSION_NAME} ${kind} "${path}" must not contain "${RECURSION_WILDCARD}" — ` +
        `the declaration is what gives "${RECURSION_WILDCARD}" its meaning.`
      );
    }
  }
  return segments;
}

/**
 * `$recursion` 宣言を検証して仕様にする。宣言が無ければ null（＝ゼロコスト経路）。
 */
export function processRecursionDeclaration(state: IState): IRecursionSpec | null {
  const declared = (state as Record<string, unknown>)[STATE_RECURSION_NAME];
  if (typeof declared === "undefined") {
    return null;
  }
  if (typeof declared !== "object" || declared === null) {
    raiseError(
      `[wcs/recursion-declaration-invalid] ${STATE_RECURSION_NAME} must be an object mapping one anchor path to its repeating sub-path ` +
      `(for example { "nodes.*": "children.*" }).`
    );
  }
  const entries = Object.entries(declared as Record<string, unknown>);
  if (entries.length === 0) {
    raiseError(`[wcs/recursion-declaration-invalid] ${STATE_RECURSION_NAME} must declare exactly one anchor; it is empty.`);
  }
  if (entries.length > 1) {
    raiseError(
      `[wcs/recursion-declaration-invalid] ${STATE_RECURSION_NAME} declares ${entries.length} anchors (${entries.map(([k]) => `"${k}"`).join(", ")}). ` +
      `This version supports exactly one self-recursive anchor per state.`
    );
  }
  const [anchor, repeat] = entries[0];
  assertNodePath("anchor", anchor);
  if (typeof repeat !== "string") {
    raiseError(
      `[wcs/recursion-declaration-invalid] ${STATE_RECURSION_NAME} entry "${anchor}" must map to the repeating sub-path as a string ` +
      `(for example "children${DELIMITER}${WILDCARD}").`
    );
  }
  assertNodePath("repeating sub-path", repeat);
  // 反復サブパスが相対か絶対かは**名前の形では判定できない**。`{ "nodes.*": "nodes.*" }`
  // は `{ nodes: [{ nodes: [...] }] }` という自己相似な木の最も自然な綴りなので、
  // 「アンカーと同じ語で始まる」ことを理由に拒否してはならない。
  const anchorSegments = anchor.split(DELIMITER);
  const recursiveAnchor = anchorSegments.slice(0, -1).join(DELIMITER) + DELIMITER + RECURSION_WILDCARD;
  return Object.freeze({ anchor, repeat, recursiveAnchor });
}
