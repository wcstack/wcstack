/**
 * externalState.test.ts — `<wcs-state src>` の外部 state にもスクリプトの規則をかける（core/externalState.ts）。
 *
 * 7GUIs の評価（4.2.0）で、同じスクリプトをインラインに置けば error 3・warning 1 が出るのに、`src="./state.js"`
 * では 0 件だった。外部 state はパスの検査にしか使われていなかった。
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateDocument } from '../src/core/validateDocument.js';
import { runValidation } from '../src/core/cli/runValidation.js';
import { inlineExternalStates, locateInlined } from '../src/core/externalState.js';
import { createWcsCompletionPlugin } from '../src/service/wcsCompletionPlugin';

const STATE = `export default {
  items: [{ on: false }],
  label: "x",
  hidden: 1,
  $commandTokens: ["focusIt"],
  $renderedCallback(paths) {
    if (paths.includes("hidden")) this.$command.focusIt.emit();
  },
  rename() { this.items[0].on = true; this.items.push({ on: true }); },
  save(e) { this.label = "s"; },
  $on: { tick(state) { this.label = "z"; } },
};
`;
const MARKUP = `<p data-wcs="textContent: label"></p><ul><template data-wcs="for: items"><li data-wcs="class.on: .on"></li></template></ul>`
  + `<form data-wcs="onsubmit: save"></form><p data-wcs="textContent: lable2"></p>`;

const reader = (files: Record<string, string>) => (path: string): string | undefined => files[path];
const codes = (ds: readonly { code: string }[]): string[] => ds.map((d) => d.code).sort();
/** 1-based line and column of `offset` in `text`. */
const at = (text: string, offset: number) => {
  const before = text.slice(0, offset);
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
};

describe('外部 state（<wcs-state src>）にもスクリプトの規則をかける', () => {
  it('インラインに置いたときと同じ code を出し、ファイルの中の指摘は src の値の上に、ファイルの中の位置（origin）を持って出る', () => {
    const inline = validateDocument(`<wcs-state><script type="module">${STATE}</script></wcs-state>${MARKUP}`, { locale: 'en' });
    const html = `<wcs-state src="./state.js"></wcs-state>${MARKUP}`;
    const found = validateDocument(html, { locale: 'en', fileReader: reader({ './state.js': STATE }) });
    expect(codes(found)).toEqual(codes(inline));
    const inFile = found.filter((d) => d.origin !== undefined);
    expect(codes(inFile)).toEqual(['wcs/array-mutation', 'wcs/nested-assign', 'wcs/on-handler-this', 'wcs/updated-callback-unbound']);
    const value = html.indexOf('./state.js');
    for (const d of inFile) {
      expect([d.start, d.end]).toEqual([value, value + './state.js'.length]);
      expect(d.origin!.path).toBe('./state.js');
      expect(d.origin!.startPosition).toEqual(at(STATE, d.origin!.start));
      expect(d.origin!.endPosition).toEqual(at(STATE, d.origin!.end));
    }
    const nested = inFile.find((d) => d.code === 'wcs/nested-assign')!;
    expect(STATE.slice(nested.origin!.start, nested.origin!.end)).toMatch(/^this\.items\[0\]\.on/);
    const push = inFile.find((d) => d.code === 'wcs/array-mutation')!;
    expect(STATE.slice(push.origin!.start, push.origin!.end)).toContain('push');
    // the page's own findings: once each, where they are in the page — one only the handler in the file tells
    // (`save` does not prevent the submit), and a path the page alone already reported
    const own = found.filter((d) => d.origin === undefined);
    expect(own.map((d) => [d.code, html.slice(d.start, d.end)])).toEqual([
      ['wcs/submit-without-prevent', 'onsubmit'],
      ['wcs/binding-path-missing', 'lable2'],
    ]);
  });

  it('CLI はファイルの中の指摘をそのファイル（state.js:行:列）で報告し、同じファイルを読む 2 ページでも 1 回だけ数える', () => {
    const html = `<wcs-state src="./state.js"></wcs-state>${MARKUP}`;
    const fileReader = reader({ './state.js': STATE });
    const result = runValidation([
      { source: 'app/a.html', text: html, kind: 'html', fileReader },
      { source: 'app/b.html', text: html, kind: 'html', fileReader },
    ], { locale: 'en' });
    const inState = result.lines.filter((l) => l.startsWith('app/state.js:'));
    expect(inState).toHaveLength(4);
    const nested = STATE.indexOf('this.items[0].on');
    const { line, column } = at(STATE, nested);
    expect(inState).toContain(result.lines.find((l) => l.startsWith(`app/state.js:${line}:${column} error wcs/nested-assign `)));
    // nothing of the file's under the pages; each page keeps its own findings
    for (const page of ['app/a.html', 'app/b.html']) {
      expect(result.lines.filter((l) => l.startsWith(`${page}:`)).map((l) => l.split(' ')[2])).toEqual(['wcs/submit-without-prevent', 'wcs/binding-path-missing']);
    }
    // the file's 3 errors once (not once per page)
    expect(result.errorCount).toBe(3);
    expect(result.exitCode).toBe(1);
  });

  it('.js の隣に .ts があればそれを読み、その名前で報告する', () => {
    const html = `<wcs-state src="./state.js"></wcs-state>`;
    const found = validateDocument(html, { locale: 'en', fileReader: reader({ './state.ts': STATE }) });
    const nested = found.find((d) => d.code === 'wcs/nested-assign')!;
    expect(nested.origin!.path).toBe('./state.ts');
  });

  it('読めない src・.json・state= と併記したもの・bind-component の state は差し込まない', () => {
    const files = reader({ './state.js': STATE, './state.json': '{"a":1}' });
    for (const html of [
      `<wcs-state src="./missing.js"></wcs-state>`,
      `<wcs-state src="./state.json"></wcs-state>`,
      `<script type="application/json" id="s">{"a":1}</script><wcs-state state="s" src="./state.js"></wcs-state>`,
      `<my-el><wcs-state bind-component="state" src="./state.js"></wcs-state></my-el>`,
    ]) {
      expect(inlineExternalStates(html, 'wcs-state', files)).toBeNull();
    }
    // a bound component's src is refused, once, as before
    const refused = validateDocument(`<my-el><wcs-state bind-component="state" src="./state.js"></wcs-state></my-el>`, { locale: 'en', fileReader: files });
    expect(codes(refused)).toEqual(['wcs/bind-component-source']);
  });

  it('ファイルの中の </script> で差し込んだ要素が終わらず、その後ろの指摘も正しい位置に出る', () => {
    const state = `export default {\n  items: [],\n  add() { const s = "</script>"; this.items.push(s); },\n};\n`;
    const found = validateDocument(`<wcs-state src="./s.js"></wcs-state>`, { locale: 'en', fileReader: reader({ './s.js': state }) });
    const push = found.find((d) => d.code === 'wcs/array-mutation')!;
    expect(state.slice(push.origin!.start, push.origin!.end)).toContain('push');
  });

  it('複数の外部 state（ボリューム）があっても、それぞれのファイルとページの位置に戻る', () => {
    const a = `export default { list: [], add() { this.list.push(1); } };\n`;
    const b = `export default { user: { name: "" }, rename() { this.user.name = "x"; } };\n`;
    const html = `<wcs-state src="./root.js"></wcs-state><wcs-state mount="a" src="./a.js"></wcs-state>`
      + `<wcs-state mount="b" json='{"x":1}' src="./b.js"></wcs-state><p data-wcs="textContent: b.user.nmae"></p>`;
    const found = validateDocument(html, { locale: 'en', fileReader: reader({ './root.js': 'export default { t: 1 };\n', './a.js': a, './b.js': b }) });
    const push = found.find((d) => d.code === 'wcs/array-mutation')!;
    expect(push.origin!.path).toBe('./a.js');
    expect(html.slice(push.start, push.end)).toBe('./a.js');
    const nested = found.find((d) => d.code === 'wcs/nested-assign')!;
    expect(nested.origin!.path).toBe('./b.js');
    expect(b.slice(nested.origin!.start, nested.origin!.end)).toMatch(/^this\.user\.name/);
    const typo = found.filter((d) => d.code === 'wcs/binding-path-missing');
    expect(typo.map((d) => html.slice(d.start, d.end))).toEqual(['b.user.nmae']);
  });

  it('差し込んだページの位置を、元のページかファイルの位置へ戻す（locateInlined）', () => {
    const html = `<i></i><wcs-state src="./a.js"></wcs-state><b></b><wcs-state src="./b.js"></wcs-state><u></u>`;
    const page = inlineExternalStates(html, 'wcs-state', reader({ './a.js': 'AAAA', './b.js': 'BB' }))!;
    const [sa, sb] = page.states;
    expect(page.text.slice(sa.contentAt, sa.contentAt + 4)).toBe('AAAA');
    expect(page.text.slice(sb.contentAt, sb.contentAt + 2)).toBe('BB');
    // `src` is blanked with the same length: the page's own offsets stay
    expect(page.text.indexOf('<b></b>')).toBe(html.indexOf('<b></b>') + sa.length);
    expect(locateInlined(page, 3)).toEqual({ offset: 3 });
    expect(locateInlined(page, sa.contentAt + 2)).toEqual({ state: sa, offset: 2 });
    expect(locateInlined(page, page.text.indexOf('<b></b>'))).toEqual({ offset: html.indexOf('<b></b>') });
    expect(locateInlined(page, sb.contentAt + 1)).toEqual({ state: sb, offset: 1 });
    expect(locateInlined(page, page.text.indexOf('<u></u>'))).toEqual({ offset: html.indexOf('<u></u>') });
    // (on the inserted tags: clamped to the file)
    expect(locateInlined(page, sa.at)).toEqual({ state: sa, offset: 0 });
    expect(locateInlined(page, sa.at + sa.length - 1)).toEqual({ state: sa, offset: 4 });
  });

  it('IDE はファイルの中の指摘を src の値の上に出し、文面の頭にファイルの位置を、関連情報にファイルへのリンクを付ける', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wcs-external-state-'));
    writeFileSync(join(dir, 'state.js'), STATE);
    const html = `<wcs-state src="./state.js"></wcs-state>${MARKUP}`;
    const uri = pathToFileURL(join(dir, 'page.html')).toString();
    const lineStarts = [0];
    for (let i = 0; i < html.length; i++) if (html[i] === '\n') lineStarts.push(i + 1);
    const document = {
      uri,
      languageId: 'html',
      version: 1,
      getText: () => html,
      positionAt: (offset: number) => {
        let line = 0;
        while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
        return { line, character: offset - lineStarts[line] };
      },
    };
    const instance = createWcsCompletionPlugin().create({ env: { locale: 'en' } } as never);
    const diagnostics = instance.provideDiagnostics!(document as never, undefined as never) as {
      code: string; message: string; range: { start: { character: number } };
      relatedInformation?: { location: { uri: string; range: { start: { line: number; character: number } } } }[];
    }[];
    const nested = diagnostics.find((d) => d.code === 'wcs/nested-assign')!;
    const { line, column } = at(STATE, STATE.indexOf('this.items[0].on'));
    expect(nested.range.start.character).toBe(html.indexOf('./state.js'));
    expect(nested.message.startsWith(`./state.js:${line}:${column}: `)).toBe(true);
    expect(nested.relatedInformation![0].location.uri).toBe(pathToFileURL(join(dir, 'state.js')).toString());
    expect(nested.relatedInformation![0].location.range.start).toEqual({ line: line - 1, character: column - 1 });
    // a finding in the page has neither
    const typo = diagnostics.find((d) => d.code === 'wcs/binding-path-missing')!;
    expect(typo.relatedInformation).toBeUndefined();
  });
});
