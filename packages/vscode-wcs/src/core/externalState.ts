/**
 * core/externalState.ts
 *
 * The script rules for a state loaded with `src=`. The validators read the `<script type="module">` inside
 * `<wcs-state>`; a state in a file of its own had only its paths checked (a 7GUIs evaluation found every script
 * rule silent there — `wcs/nested-assign`, `wcs/array-mutation`, `wcs/on-handler-this`, …). The page is validated
 * a second time with each such script inside its element, as the page would be with the state inline
 * (`inlineExternalStates`), and each finding is mapped back (`locateInlined`): one in an inserted script to its file,
 * one in the page to the page.
 *
 * pure (DOM / vscode / node fs 非依存): the files come through the `FileReader`.
 */

import { parseWcsStateElements, type AttributeSpan } from "../language/htmlParse.js";
import { readStateScriptFile, type FileReader } from "../service/statePathResolver.js";
import { createPositionMapper, type LineColumn } from "./offsetToPosition.js";

const OPEN = '<script type="module">';
const CLOSE = "</script>";

/** One state file put inside its element. Offsets `at` / `contentAt` are in the inlined page. */
export interface InlinedState {
  /** The file read, as the page names it (relative to the HTML file): the `.ts` beside a `.js`, when there is one. */
  readonly path: string;
  /** The file's text (offsets into the file are into this). */
  readonly text: string;
  /** Where the inserted `<script>` starts, and where its content starts. */
  readonly at: number;
  readonly contentAt: number;
  /** The length of what was inserted (the `<script>` tags and the content). */
  readonly length: number;
  /** The `src` attribute's value in the page: where a finding in the file is shown in the page (the IDE). */
  readonly valueStart: number;
  readonly valueEnd: number;
  /** 1-based line and column of an offset into the file. */
  readonly position: (offset: number) => LineColumn;
}

export interface InlinedPage {
  readonly text: string;
  readonly states: readonly InlinedState[];
}

/**
 * The page with each `<wcs-state src="….js|.ts">` the reader can read holding its script inline: the script goes
 * right after the start tag, and `src` (and `json`, which `src` overrides) become spaces of the same length, so
 * the page's own offsets before each insertion stay as they are. Left out: a `state=` element (the runtime reads
 * that one instead), a `bind-component` one (its sources are refused — `wcs/bind-component-source`), a `.json`
 * file (no script rules). Null when no state is inlined.
 */
export function inlineExternalStates(html: string, stateTagName: string, fileReader: FileReader): InlinedPage | null {
  let text = "";
  let from = 0;
  let shift = 0;
  const states: InlinedState[] = [];
  for (const element of parseWcsStateElements(html, stateTagName)) {
    const src = element.srcSpan;
    if (src === undefined || element.srcAttr === undefined || element.stateAttr !== undefined || element.bindComponent) continue;
    const file = readStateScriptFile(element.srcAttr, fileReader);
    if (file === undefined) continue;
    const blanks: AttributeSpan[] = [src];
    if (element.jsonSpan !== undefined) blanks.push(element.jsonSpan);
    blanks.sort((a, b) => a.start - b.start);
    for (const span of blanks) {
      text += html.slice(from, span.start) + " ".repeat(span.end - span.start);
      from = span.end;
    }
    text += html.slice(from, element.tagEnd);
    from = element.tagEnd;
    // a `</script` in the file (a string, a comment) would end the inserted element: the same length, not a tag
    const content = file.text.replace(/<\/(script)/gi, "<\\$1");
    const at = element.tagEnd + shift;
    const length = OPEN.length + content.length + CLOSE.length;
    text += OPEN + content + CLOSE;
    states.push({
      path: file.path,
      text: file.text,
      at,
      contentAt: at + OPEN.length,
      length,
      valueStart: src.valueStart,
      valueEnd: src.valueEnd,
      position: createPositionMapper(file.text),
    });
    shift += length;
  }
  if (states.length === 0) return null;
  return { text: text + html.slice(from), states };
}

/**
 * Where an offset of the inlined page is: in an inserted state (`state`, and the offset into its file — clamped to
 * the file, for one on the inserted tags), or in the page (the page's own offset).
 */
export function locateInlined(page: InlinedPage, offset: number): { readonly state?: InlinedState; readonly offset: number } {
  let shift = 0;
  for (const state of page.states) {
    if (offset < state.at) break;
    if (offset < state.at + state.length) {
      return { state, offset: Math.min(Math.max(offset - state.contentAt, 0), state.text.length) };
    }
    shift += state.length;
  }
  return { offset: offset - shift };
}
