/**
 * counterAssistLint.test.ts — 継ぎ目アプリ counter-assist（LLM の回答のコンソール・ワーカーでの CSV の取り込み・SSE の
 * 呼び出し表示 — 片方のページは @wcstack/signals、片方は state）で見つかった lint（4.33）。作者がわざとした 25 の誤りに
 * lint は何も言わなかった（著者の決定 2026-11-28 — docs/v4-direction-2026-10.md §5.29）。
 *
 *   1. `wcs/stream-declaration` — ランタイムが取り込むときに拒む `$stream` のエントリ（error）
 *   2. `wcs/html-sink-input` — フォームの部品が書き戻すパスを HTML の書き込み先に束ねる（warning）
 *   3. `wcs/signals-dual-entry` — @wcstack/signals のコアが 2 つになる読み込み（error）。ページが読むローカルの module も
 *      数える。そうしたページ（と wcs/lint-version-behind が見るページ）は `nothing to check:` に載らない
 *   4. `wcs/event-before-binding` — 自分で始まる I/O ノードの `eventToken.` の最初の回が失われる（warning）
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { runValidation } from '../src/core/cli/runValidation.js';
import { validatePackageLoads, loadRulesApply } from '../src/service/packageLoadValidator.js';
import { validateStreamDeclarations } from '../src/service/streamDeclarationValidator.js';
import { validateEventsBeforeBinding } from '../src/service/eventBeforeBindingValidator.js';
import { BUILTIN_TAGS } from '../src/service/generated/builtinTags.generated.js';
import { ENGINE_VERSION } from '../src/service/wcsManifest.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics.js';
import type { FileReader } from '../src/service/statePathResolver.js';

const reader = (files: Record<string, string>): FileReader => (p: string) => files[p];
const validate = (html: string, locale = 'en', files: Record<string, string> = {}): WcsDiagnostic[] =>
  validateDocument(html, { locale, fileReader: reader(files) });
const ofCode = (diags: readonly WcsDiagnostic[], code: string): WcsDiagnostic[] => diags.filter((d) => d.code === code);
const textOf = (html: string, d: WcsDiagnostic): string => html.slice(d.start, d.end);
const statePage = (state: string, body = ''): string => `<wcs-state><script type="module">
export default {
${state}
};
</script></wcs-state>
${body}`;

// ---------------------------------------------------------------------------------------------------------------------
describe('1. wcs/stream-declaration — ランタイムが取り込むときに拒む $stream のエントリ', () => {
  const streams = (html: string, locale = 'en', files: Record<string, string> = {}): WcsDiagnostic[] =>
    ofCode(validate(html, locale, files), WcsDiagnosticCode.StreamDeclaration);
  const SOURCE = 'source: (req, signal) => openAnswerStream(req, signal)';

  it('fold があって initial の無いエントリを、エントリの名前の上に error（counter-assist の誤り 4 — ページ全体が死んだ）', () => {
    const html = statePage(`  request: null,
  $stream: {
    answer: {
      args: (s) => s.request,
      ${SOURCE},
      fold: foldAnswer,
    },
  },`);
    const found = streams(html);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([['error', 'answer']]);
    expect(found[0].message).toContain('$stream entry "answer": fold needs an initial value.');
    expect(found[0].message).toContain('initial: ""');
    expect(streams(html, 'ja')[0].message).toContain('initial がありません');
  });

  it('source の無いエントリを error（ランタイムと同じ順: source が先 — initial も無くても source だけを言う）', () => {
    const html = statePage(`  $stream: { ticks: { fold: (a, c) => a + c } },`);
    const found = streams(html);
    expect(found.map((d) => textOf(html, d))).toEqual(['ticks']);
    expect(found[0].message).toContain('needs a source function');
    expect(found[0].message).not.toContain('initial value');
  });

  it('initial があれば値が undefined でも黙る（ランタイムは "initial" in def）。fold が無ければ initial は要らない', () => {
    expect(streams(statePage(`  $stream: { a: { ${SOURCE}, fold: (x, c) => c, initial: undefined } },`))).toEqual([]);
    expect(streams(statePage(`  $stream: { a: { ${SOURCE} } },`))).toEqual([]);
    expect(streams(statePage(`  $stream: { a: { ${SOURCE}, args: (s) => s.q } },`))).toEqual([]);
  });

  it('メソッド・省略記法・getter・引用符付きのキー・TypeScript の型も読む', () => {
    const shorthand = statePage(`  $stream: { a: { source, fold } },`);
    expect(streams(shorthand).map((d) => textOf(shorthand, d))).toEqual(['a']);
    expect(streams(statePage(`  $stream: { a: { source, fold, initial } },`))).toEqual([]);
    const method = statePage(`  $stream: {
    "answer": {
      async *source(req, signal) { yield 1; },
      fold(acc: Answer, chunk: Chunk): Answer { return { ...acc, n: acc.n + 1 }; },
    },
  },`);
    expect(streams(method).map((d) => textOf(method, d))).toEqual(['answer']);
    expect(streams(statePage(`  $stream: { a: { ${SOURCE}, fold(a, c) { return a; }, get initial() { return 0; } } },`))).toEqual([]);
    expect(streams(statePage(`  $stream: { a: { ${SOURCE}, 'fold': (a, c) => a, "initial": 0 } as const },`))).toEqual([]);
    const satisfies = statePage(`  $stream: { a: { ${SOURCE}, fold: (a, c) => a } satisfies StreamDef },`);
    expect(streams(satisfies).map((d) => textOf(satisfies, d))).toEqual(['a']);
  });

  it('確かでないものは読まない: オブジェクトリテラルでないエントリ・spread・計算されたキー・後に書いた spread・同じ名前の後のエントリ', () => {
    expect(streams(statePage(`  $stream: { a: answerStream, b: makeStream({ fold }), c: cond ? { fold } : x },`))).toEqual([]);
    expect(streams(statePage(`  $stream: { a: { ...base, fold: (a, c) => a } },`))).toEqual([]);
    expect(streams(statePage(`  $stream: { a: { [key]: 1, fold: (a, c) => a } },`))).toEqual([]);
    expect(streams(statePage(`  $stream: { a: { fold: (a, c) => a } || other },`))).toEqual([]);
    // a spread after the entry may replace it; one before it may not
    expect(streams(statePage(`  $stream: { a: { fold: (a, c) => a }, ...more },`))).toEqual([]);
    const before = statePage(`  $stream: { ...more, a: { fold: (a, c) => a } },`);
    expect(streams(before).map((d) => textOf(before, d))).toEqual(['a']);
    // a top-level spread after $stream may replace the whole declaration
    expect(streams(statePage(`  $stream: { a: { fold: (a, c) => a } },\n  ...shared,`))).toEqual([]);
    // the later entry of the same name is the one the runtime reads
    expect(streams(statePage(`  $stream: { a: { fold: (a, c) => a }, a: { ${SOURCE} } },`))).toEqual([]);
    // $stream itself not an object literal, or $stream in a string / a comment
    expect(streams(statePage(`  $stream: streams,\n  note: "$stream: { a: { fold } }", // $stream: { b: {} }`))).toEqual([]);
  });

  it('ボリューム（wcs/volume-declaration が言う）と bind-component の state は見ない', () => {
    const volume = `<wcs-state></wcs-state><wcs-state mount="cart"><script type="module">export default { $stream: { a: { fold: (x, c) => x } } };</script></wcs-state>`;
    expect(validateStreamDeclarations(volume)).toEqual([]);
    expect(ofCode(validate(volume), WcsDiagnosticCode.VolumeDeclaration)).toHaveLength(1);
    const component = `<template><wcs-state bind-component="state"><script type="module">export default { $stream: { a: { fold: (x, c) => x } } };</script></wcs-state></template>`;
    expect(validateStreamDeclarations(component)).toEqual([]);
  });

  it('src= のファイルの state はファイルの位置（origin）で報告し、CLI はそのファイルに出す', () => {
    const file = `export default defineState({\n  request: null,\n  $stream: {\n    answer: { source: (r, s) => open(r, s), fold: foldAnswer },\n  },\n});\n`;
    const html = `<wcs-state src="./js/console-state.js"></wcs-state>\n<p data-wcs="textContent: request"></p>`;
    const found = streams(html, 'en', { './js/console-state.js': file });
    expect(found.map((d) => [textOf(html, d), d.origin?.path, file.slice(d.origin!.start, d.origin!.end)]))
      .toEqual([['./js/console-state.js', './js/console-state.js', 'answer']]);
    const cli = runValidation([{ source: 'public/index.html', text: html, kind: 'html', fileReader: reader({ './js/console-state.js': file }) }], { locale: 'en', errorsOnly: true });
    expect(cli.lines.map((l) => l.replace(/^(\S+ \S+ \S+).*$/, '$1'))).toEqual(['public/js/console-state.js:4:5 error wcs/stream-declaration']);
    expect(cli.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('2. wcs/html-sink-input — フォームの部品が書き戻すパスを HTML の書き込み先に束ねる', () => {
  const sinks = (html: string, locale = 'en'): WcsDiagnostic[] => ofCode(validate(html, locale), WcsDiagnosticCode.HtmlSinkInput);
  const STATE = '  question: "", choice: "a", note: "", n: 0, flag: false, turns: [{ q: "" }],';

  it('<textarea> の value: が書き戻すパスを html: に束ねると、書き込み先のパスの上に warning', () => {
    const html = statePage(STATE, `<textarea data-wcs="value: question"></textarea>\n<p data-wcs="html: question"></p>`);
    const found = sinks(html);
    expect(found.map((d) => [d.severity, textOf(html, d), d.statePath])).toEqual([['warning', 'question', 'question']]);
    expect(found[0].message).toContain('"html: question"');
    expect(found[0].message).toContain('<textarea>');
    expect(found[0].message).toContain('unless a filter sanitizes it');
    expect(found[0].message).toContain('textContent: question');
    expect(sinks(html, 'ja')[0].message).toContain('フィルタが消毒するのでなければ');
  });

  it('innerHTML: / outerHTML: / srcdoc: も、<input> の文字の入力と <select> も同じ。書き込み先の束縛ごとに 1 回', () => {
    const html = statePage(STATE, `<input data-wcs="value: question"><input type="search" data-wcs="value#onchange: note">
<select data-wcs="value: choice"><option>a</option></select>
<div data-wcs="innerHTML: question"></div><div data-wcs="outerHTML: note"></div><iframe data-wcs="srcdoc: choice"></iframe>
<div data-wcs="class.x: flag; .innerHTML: question"></div>`);
    expect(sinks(html).map((d) => textOf(html, d))).toEqual(['question', 'note', 'choice', 'question']);
  });

  it('書き込み先のフィルタでは黙らない（消毒するかは見えない）', () => {
    const html = statePage(STATE, `<textarea data-wcs="value|trim: question"></textarea><p data-wcs="html: question|markdown"></p>`);
    const found = sinks(html);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('"html: question|markdown"');
  });

  it('for: の中の .x は list.*.x として比べる', () => {
    const html = statePage(STATE, `<template data-wcs="for: turns"><textarea data-wcs="value: .q"></textarea></template>
<template data-wcs="for: turns"><div data-wcs="html: .q"></div></template>`);
    expect(sinks(html).map((d) => [textOf(html, d), d.statePath])).toEqual([['.q', 'turns.*.q']]);
  });

  it('打たない部品・#ro・カスタム要素・別のパス・テキストの束縛では黙る（メソッドが写したパス — counter-assist の実際の形 — は比べない）', () => {
    for (const control of [
      '<input type="number" data-wcs="value: question">', '<input type="checkbox" data-wcs="value: question">',
      '<input type="hidden" data-wcs="value: question">', '<input type="range" data-wcs="value: question">',
      '<input type="date" data-wcs="value: question">', '<textarea data-wcs="value#ro: question"></textarea>',
      '<my-editor data-wcs="value: question"></my-editor>', '<textarea data-wcs="textContent: question"></textarea>',
    ]) {
      expect(sinks(statePage(STATE, `${control}<p data-wcs="html: question"></p>`)), control).toEqual([]);
    }
    expect(sinks(statePage(STATE, `<textarea data-wcs="value: question"></textarea><p data-wcs="textContent: question; title: question"></p>`))).toEqual([]);
    // the console's shape: the typed question is copied into turns by ask(), and the row shows .q
    const copied = statePage(STATE, `<textarea data-wcs="value: question"></textarea>
<template data-wcs="for: turns"><p data-wcs="html: .q"></p></template>`);
    expect(sinks(copied)).toEqual([]);
  });

  it('data-wcs-ignore の中は言わない', () => {
    const html = statePage(STATE, `<textarea data-wcs="value: question"></textarea><div data-wcs-ignore><p data-wcs="html: question"></p></div>`);
    expect(sinks(html)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('3. wcs/signals-dual-entry — @wcstack/signals のコアが 2 つになる読み込み', () => {
  const V = '4.32.0';
  const JSD = `https://cdn.jsdelivr.net/npm/@wcstack/signals@${V}`;
  const dual = (html: string, files: Record<string, string> = {}, locale = 'en'): WcsDiagnostic[] =>
    validatePackageLoads(html, locale, reader(files)).filter((d) => d.code === WcsDiagnosticCode.SignalsDualEntry);
  const module = (...specs: string[]): string => `<script type="module">\n${specs.map((s, i) => `import { x${i} } from "${s}";`).join('\n')}\n</script>`;

  it('呼び出し表示（誤り 17b）: ページが読むローカルの module の中の jsDelivr の +esm と dist のファイル — module の位置で error、ページでは読み込んだ src に', () => {
    const html = `<!doctype html><head><script type="module" src="./js/queue/display-main.js"></script></head><body><main id="display"></main></body>`;
    const display = `// 呼び出し表示
import "https://cdn.jsdelivr.net/npm/@wcstack/sse@${V}/dist/auto.min.js";
import { signal } from "${JSD}/+esm";
import {
  computed, createRoot, h, render,
} from "${JSD}/dist/dom.esm.min.js";
import { foldQueue } from "./fold.js";
`;
    const files = { 'js/queue/display-main.js': 'import { mountDisplay } from "./display.js";\nmountDisplay();', 'js/queue/display.js': display, 'js/queue/fold.js': 'export const foldQueue = 1;' };
    const found = dual(html, files);
    expect(found.map((d) => [d.severity, textOf(html, d), d.origin?.path, display.slice(d.origin!.start, d.origin!.end)]))
      .toEqual([['error', './js/queue/display-main.js', 'js/queue/display.js', `${JSD}/dist/dom.esm.min.js`]]);
    expect(found[0].message).toContain(`"${JSD}/+esm"`);
    expect(found[0].message).toContain('@wcstack/signals/dom has all of them');
    expect(found[0].origin!.startPosition).toEqual({ line: 6, column: 9 });

    // the CLI: in the module, and the page is no longer "nothing to check"
    const cli = runValidation([{ source: 'public/display.html', text: html, kind: 'html', fileReader: reader(files) }], { locale: 'en', errorsOnly: true });
    expect(cli.lines.map((l) => l.replace(/^(\S+ \S+ \S+).*$/, '$1'))).toEqual(['public/js/queue/display.js:6:9 error wcs/signals-dual-entry']);
    expect(cli.nothingToCheck).toEqual([]);
    expect(cli.notes.some((n) => n.startsWith('nothing to check'))).toBe(false);
    // the fixed display (one entry): clean, and checked
    const fixed = { ...files, 'js/queue/display.js': display.replace(`import { signal } from "${JSD}/+esm";\n`, '') };
    expect(dual(html, fixed)).toEqual([]);
    const clean = runValidation([{ source: 'public/display.html', text: html, kind: 'html', fileReader: reader(fixed) }], { locale: 'en' });
    expect([clean.errorCount, clean.warningCount, clean.nothingToCheck]).toEqual([0, 0, []]);
  });

  it('esm.run の本体と dist のファイルの /dom（誤り 17）、esm.run・esm.sh・+esm の 2 つのエントリを error', () => {
    for (const [a, b] of [
      [`https://esm.run/@wcstack/signals@${V}`, `${JSD}/dist/dom.esm.min.js`],
      ['https://esm.run/@wcstack/signals', 'https://esm.run/@wcstack/signals/dom'],
      [`https://esm.run/@wcstack/signals@${V}/dom`, `https://esm.run/@wcstack/signals@${V}`],
      [`https://esm.sh/@wcstack/signals@${V}`, `https://esm.sh/@wcstack/signals@${V}/dom?bundle`],
      [`${JSD}/dom/+esm`, `${JSD}/+esm`],
      [`${JSD}/dist/index.esm.js/+esm`, `${JSD}/dist/dom.esm.js`],
    ]) {
      const html = module(a, b);
      const found = dual(html);
      expect(found.map((d) => [d.severity, textOf(html, d)]), `${a} + ${b}`).toEqual([['error', b]]);
    }
  });

  it('<script src> と inline の import の組み合わせも数える', () => {
    const html = `<script type="module" src="https://esm.run/@wcstack/signals"></script>\n${module('https://esm.run/@wcstack/signals/dom')}`;
    expect(dual(html).map((d) => textOf(html, d))).toEqual(['https://esm.run/@wcstack/signals/dom']);
  });

  it('同じビルドの dist のファイルの 2 つのエントリはコアのチャンクを共有するので黙る。ビルドが違えば（.esm.js と .esm.min.js）error', () => {
    expect(dual(module(`${JSD}/dist/index.esm.js`, `${JSD}/dist/dom.esm.js`))).toEqual([]);
    expect(dual(module(`${JSD}/dist/index.esm.min.js`, `${JSD}/dist/dom.esm.min.js`))).toEqual([]);
    expect(dual(module('../../packages/signals/dist/index.esm.js', '../../packages/signals/dist/dom.esm.js'))).toEqual([]);
    // the module's relative import is read from the page: the same directory as the page's own script
    expect(dual(`<script type="module" src="../../packages/signals/dist/index.esm.js"></script><script type="module" src="./js/app.js"></script>`,
      { 'js/app.js': 'import { h } from "../../../packages/signals/dist/dom.esm.js";' })).toEqual([]);
    const builds = module(`${JSD}/dist/index.esm.js`, `${JSD}/dist/dom.esm.min.js`);
    expect(dual(builds).map((d) => textOf(builds, d))).toEqual([`${JSD}/dist/dom.esm.min.js`]);
    const repoBuilds = module('/packages/signals/dist/index.esm.js', '/packages/signals/dist/dom.esm.min.js');
    expect(dual(repoBuilds).map((d) => textOf(repoBuilds, d))).toEqual(['/packages/signals/dist/dom.esm.min.js']);
    // two directories at full URLs (two CDNs) are two copies; two written as paths may be one directory: not said
    const cdns = module(`${JSD}/dist/index.esm.js`, `https://unpkg.com/@wcstack/signals@${V}/dist/dom.esm.js`);
    expect(dual(cdns).map((d) => d.severity)).toEqual(['error']);
    expect(dual(module('/packages/signals/dist/index.esm.js', '../../packages/signals/dist/dom.esm.js'))).toEqual([]);
  });

  it('2 つの版は、どこからでも、同じエントリでも error（版を言う）', () => {
    const html = module(`https://cdn.jsdelivr.net/npm/@wcstack/signals@4.31.0/dist/dom.esm.js`, `${JSD}/dist/dom.esm.js`);
    const found = dual(html);
    expect(found.map((d) => textOf(html, d))).toEqual([`${JSD}/dist/dom.esm.js`]);
    expect(found[0].message).toContain(`two versions of @wcstack/signals (${V} and 4.31.0)`);
    expect(dual(html, {}, 'ja')[0].message).toContain('2 つの版');
  });

  it('import map が名前を送る先で判断する（CDN の束ねは error、dist のファイルは黙る）。map の無い裸の名前はバンドラのもので黙る', () => {
    const map = (imports: Record<string, string>) => `<script type="importmap">${JSON.stringify({ imports })}</script>`;
    const both = module('@wcstack/signals', '@wcstack/signals/dom');
    const cdn = `${map({ '@wcstack/signals': 'https://esm.run/@wcstack/signals', '@wcstack/signals/dom': 'https://esm.run/@wcstack/signals/dom' })}\n${both}`;
    expect(dual(cdn).map((d) => [d.severity, textOf(cdn, d)])).toEqual([['error', '@wcstack/signals/dom']]);
    const prefix = `${map({ '@wcstack/signals': `${JSD}/+esm`, '@wcstack/signals/': `https://esm.run/@wcstack/signals@${V}/` })}\n${both}`;
    expect(dual(prefix).map((d) => d.severity)).toEqual(['error']);
    const files = `${map({ '@wcstack/signals': `${JSD}/dist/index.esm.js`, '@wcstack/signals/dom': `${JSD}/dist/dom.esm.js` })}\n${both}`;
    expect(dual(files)).toEqual([]);
    expect(dual(both)).toEqual([]);
  });

  it('1 つのエントリだけ・同じ URL を 2 回・コメントの中は黙る', () => {
    expect(dual(module('https://esm.run/@wcstack/signals/dom'))).toEqual([]);
    expect(dual(module(`${JSD}/+esm`, `${JSD}/+esm`))).toEqual([]);
    const commented = `<!-- import from "https://esm.run/@wcstack/signals" too -->
<script type="module">
// import { signal } from "https://esm.run/@wcstack/signals";
import { signal, h } from "https://esm.run/@wcstack/signals/dom";
</script>`;
    expect(dual(commented)).toEqual([]);
    const local = `<script type="module" src="./app.js"></script>`;
    expect(dual(local, { 'app.js': `/* import "${JSD}/+esm"; */\nimport { h } from "${JSD}/dist/dom.esm.js";` })).toEqual([]);
  });

  it('両方のエントリを CDN に割り当てた import map は、ページが /dom だけを import しても warning（docs/seam-apps.md、signals-shop）', () => {
    const map = (imports: Record<string, string>) => `<script type="importmap">${JSON.stringify({ imports })}</script>`;
    const html = `${map({ '@wcstack/signals': 'https://esm.run/@wcstack/signals', '@wcstack/signals/dom': 'https://esm.run/@wcstack/signals/dom' })}
<script type="module" src="./cart-model.js"></script>
<script type="module">import { h } from "@wcstack/signals/dom";</script>`;
    const found = dual(html);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([['warning', '@wcstack/signals']]);
    expect(dual(map({ '@wcstack/signals/dom': 'https://esm.run/@wcstack/signals/dom' }))).toEqual([]);
    expect(dual(map({ '@wcstack/signals': '/packages/signals/dist/index.esm.js', '@wcstack/signals/dom': '/packages/signals/dist/dom.esm.js' }))).toEqual([]);
    expect(dual(`<script type="importmap">{ not json</script>`)).toEqual([]);
  });

  it('validateDocument からも出る（ページの所見として 1 回）', () => {
    const html = module('https://esm.run/@wcstack/signals', 'https://esm.run/@wcstack/signals/dom');
    expect(ofCode(validate(html), WcsDiagnosticCode.SignalsDualEntry).map((d) => d.severity)).toEqual(['error']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('3b. signals のページ: wcs/lint-version-behind と nothing to check', () => {
  const [major, minor] = ENGINE_VERSION.split('.').map(Number);
  const newer = `${major}.${minor + 1}.0`;
  const html = `<script type="module" src="./app.js"></script>\n<main id="app"></main>`;

  it('ローカルの module の中の、lint より新しい minor の固定にも warning（module の位置で）', () => {
    const app = `import { signal, h } from "https://cdn.jsdelivr.net/npm/@wcstack/signals@${newer}/dist/dom.esm.js";\n`;
    const found = validatePackageLoads(html, 'en', reader({ 'app.js': app })).filter((d) => d.code === WcsDiagnosticCode.LintVersionBehind);
    expect(found.map((d) => [textOf(html, d), d.origin?.path, app.slice(d.origin!.start, d.origin!.end)]))
      .toEqual([['./app.js', 'app.js', `@wcstack/signals@${newer}`]]);
    const cli = runValidation([{ source: 'display.html', text: html, kind: 'html', fileReader: reader({ 'app.js': app }) }], { locale: 'en' });
    expect(cli.lines.map((l) => l.replace(/^(\S+ \S+ \S+).*$/, '$1'))).toEqual(['app.js:1:57 warning wcs/lint-version-behind']);
    expect(cli.nothingToCheck).toEqual([]);
    // directly on the page, as before
    const direct = `<script type="module">import { h } from "https://esm.run/@wcstack/signals@${newer}/dom";</script>`;
    expect(validatePackageLoads(direct, 'en').map((d) => d.code)).toEqual([WcsDiagnosticCode.LintVersionBehind]);
  });

  it('wcstack を読み込まないローカルのスクリプト・読めないスクリプトのページは、今までどおり nothing to check', () => {
    expect(loadRulesApply(html, reader({ 'app.js': 'console.log(1);' }))).toBe(false);
    expect(loadRulesApply(html, reader({}))).toBe(false);
    expect(loadRulesApply(html)).toBe(false);
    expect(loadRulesApply(html, reader({ 'app.js': 'import { h } from "https://esm.run/@wcstack/signals/dom";' }))).toBe(true);
    const cli = runValidation([{ source: 'page.html', text: html, kind: 'html', fileReader: reader({ 'app.js': 'console.log(1);' }) }]);
    expect(cli.nothingToCheck).toEqual(['page.html']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('4. wcs/event-before-binding — 自分で始まる I/O ノードの eventToken. の最初の回', () => {
  const STATE = '<wcs-state src="./js/control-state.js"></wcs-state>';
  const events = (html: string, locale = 'en'): WcsDiagnostic[] =>
    ofCode(validateDocument(html, { locale }), WcsDiagnosticCode.EventBeforeBinding);

  it('生成カタログが semantics: "event" の出力を持つ', () => {
    expect(BUILTIN_TAGS['wcs-sse'].events).toEqual(['message']);
    expect(BUILTIN_TAGS['wcs-ws'].events).toEqual(['message']);
    expect(BUILTIN_TAGS['wcs-broadcast'].events).toEqual(['message']);
    expect(BUILTIN_TAGS['wcs-fetch'].events).toBeUndefined();
  });

  it('リテラルの url の <wcs-sse> の eventToken.message: を、トークンの左辺の上に warning（counter-assist — 8 人待ちで 0 人と出た）', () => {
    const html = `${STATE}\n<wcs-sse url="/api/queue/stream" events="snapshot,call" data-wcs="eventToken.message: queueEvent; connected: sseConnected"></wcs-sse>`;
    const found = events(html);
    expect(found.map((d) => [d.severity, textOf(html, d), d.tag, d.member])).toEqual([['warning', 'eventToken.message', 'wcs-sse', 'message']]);
    expect(found[0].message).toContain('url: <path>');
    expect(found[0].message).toContain('message: <path> seeds the state');
    expect(found[0].message).toContain("(the stream's snapshot)");
    expect(events(html, 'ja')[0].message).toContain('state のファイルが読み込まれて');
  });

  it('<wcs-ws> の url と <wcs-broadcast> の name も同じ', () => {
    const html = `${STATE}
<wcs-ws url="wss://example.test/chat" data-wcs="eventToken.message: chat"></wcs-ws>
<wcs-broadcast name="orders" data-wcs="eventToken.message: order"></wcs-broadcast>`;
    expect(events(html).map((d) => [d.tag, textOf(html, d)])).toEqual([['wcs-ws', 'eventToken.message'], ['wcs-broadcast', 'eventToken.message']]);
    expect(events(html)[1].message).toContain('name: <path>');
    // the snapshot is <wcs-sse>'s example only
    expect(events(html).map((d) => d.message.includes('snapshot'))).toEqual([false, false]);
    expect(events(html, 'ja')[1].message).toContain('最初の message はトークンが付く前に');
  });

  it('始める属性を束ねる・無い・空・manual・出力をプロパティとしても束ねる・spread では黙る（control.html の直し方）', () => {
    for (const tag of [
      '<wcs-sse events="snapshot" data-wcs="eventToken.message: queueEvent; connected: c; url: streamUrl"></wcs-sse>',
      '<wcs-sse url="/s" data-wcs="eventToken.message: e; url: streamUrl"></wcs-sse>',
      '<wcs-sse url="/s" data-wcs="attr.url: streamUrl; eventToken.message: e"></wcs-sse>',
      '<wcs-sse url="/s" data-wcs=".url: streamUrl; eventToken.message: e"></wcs-sse>',
      '<wcs-sse data-wcs="eventToken.message: e"></wcs-sse>',
      '<wcs-sse url="" data-wcs="eventToken.message: e"></wcs-sse>',
      '<wcs-sse url="/s" manual data-wcs="eventToken.message: e; command.connect: $command.open"></wcs-sse>',
      '<wcs-sse url="/s" data-wcs="eventToken.message: e; message: lastEvent"></wcs-sse>',
      '<wcs-sse url="/s" data-wcs="...: sse; eventToken.message: e"></wcs-sse>',
      '<wcs-sse url="/s" data-wcs="eventToken.connected: up; eventToken.error: down"></wcs-sse>',
      '<wcs-sse url="/s" data-wcs="message: last"></wcs-sse>',
      '<wcs-broadcast data-wcs="eventToken.message: e"></wcs-broadcast>',
    ]) {
      expect(events(`${STATE}\n${tag}`), tag).toEqual([]);
    }
  });

  it('<template> の中（束ねてから挿入される）・<wcs-state> の無い断片・コメントの中は黙る', () => {
    const sse = '<wcs-sse url="/s" data-wcs="eventToken.message: e"></wcs-sse>';
    expect(events(`${STATE}\n<template data-wcs="if: open">${sse}</template>`)).toEqual([]);
    expect(events(`<wcs-router><template><wcs-route path="/"><template>${sse}</template></wcs-route></template></wcs-router>`)).toEqual([]);
    expect(validateEventsBeforeBinding(sse)).toEqual([]);
    expect(events(`${STATE}\n<!-- ${sse} -->`)).toEqual([]);
  });

  it('インラインの state でも言う（state のスクリプトの読み込みは接続を待たない）', () => {
    const html = `<wcs-state><script type="module">export default { e: null, $eventTokens: ["queueEvent"], $on: { queueEvent(s, ev) {} } };</script></wcs-state>
<wcs-sse url="/s" data-wcs="eventToken.message: queueEvent"></wcs-sse>`;
    expect(events(html).map((d) => textOf(html, d))).toEqual(['eventToken.message']);
  });
});
