/**
 * objectSpreadSeed.test.ts — a key seeded with an object literal that spreads a module constant
 * (`draft: { ...EMPTY_DRAFT }` with `const EMPTY_DRAFT = { title: "", … }`).
 *
 * From the homeroom seam app (written on 4.2.0, upgraded to 4.10.1): every binding under such a key was a
 * `wcs/binding-path-missing` — and a real typo (`draft.titel`) the same warning, so the two could not be told apart.
 * The spread's literal is read where it stands (moduleValues.ts follows the name through the module's constants and
 * imports), a later key replacing an earlier one as when the object is built. A spread it cannot read (a call, a `let`,
 * an import it cannot read) leaves the object's keys open — not "missing": `wcs/path-dynamic-unknown` (info) says so once,
 * at the key, when the page binds under it, as for a key whose value it cannot read.
 */
import { describe, it, expect } from 'vitest';
import { analyzeStatePaths } from '../src/service/stateAnalyzer';
import { getStatePathIndex, isUnresolvedPath, type FileReader } from '../src/service/statePathResolver';
import { validateDocument } from '../src/core/validateDocument';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics';

const HOMEROOM = `const EMPTY_DRAFT = { title: "", body: "", cat: "general" };
const EMPTY_FORM_ERRORS = { title: "", cat: "", body: "" };
export default {
  draft: { ...EMPTY_DRAFT },
  formErrors: { ...EMPTY_FORM_ERRORS },
  reset() { this.draft = { ...EMPTY_DRAFT }; },
};`;

const names = (script: string): string[] => analyzeStatePaths(script).map((p) => p.path);
const page = (script: string, body: string): string => `<wcs-state><script type="module">
${script}
</script></wcs-state>
${body}`;
const reader = (files: Record<string, string>): FileReader => (path: string) => files[path];
const findings = (html: string, fileReader?: FileReader): WcsDiagnostic[] =>
  validateDocument(html, { locale: 'en', ...(fileReader !== undefined ? { fileReader } : {}) })
    .filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing || d.code === WcsDiagnosticCode.PathDynamicUnknown);

describe('analyzeStatePaths — 種のオブジェクトリテラルの spread', () => {
  it('モジュールの const（オブジェクトリテラル）の spread のキーを、その場所に書いたキーとして読むこと（homeroom）', () => {
    expect(names(HOMEROOM)).toEqual([
      'draft', 'draft.title', 'draft.body', 'draft.cat',
      'formErrors', 'formErrors.title', 'formErrors.cat', 'formErrors.body',
      'reset',
    ]);
    expect(analyzeStatePaths(HOMEROOM).filter((p) => p.opaque !== undefined)).toEqual([]);
  });

  it('入れ子のリテラル・別の名前・Object.freeze・spread の中の spread も辿ること', () => {
    const paths = names(`const BASE = { id: 0, meta: { tags: [], owner: { name: "" } } };
const MORE = Object.freeze({ ...BASE, note: "" });
const ALIAS = MORE;
export default {
  form: { draft: { ...ALIAS } },
  plain: { ...{ inline: true } },
  none: { ...null, kept: 1 },
};`);
    expect(paths).toEqual(expect.arrayContaining([
      'form.draft.id', 'form.draft.note', 'form.draft.meta.tags', 'form.draft.meta.tags.*', 'form.draft.meta.owner.name',
      'plain.inline', 'none.kept',
    ]));
  });

  it('同じ名前のキーは後に書いた方が勝つこと（オブジェクトを作るときと同じ）', () => {
    const paths = analyzeStatePaths(`const EMPTY = { title: "", meta: { a: 1 } };
export default {
  before: { title: 0, ...EMPTY },
  after: { ...EMPTY, meta: { b: 2 }, extra: true },
};`);
    const hint = (path: string) => paths.find((p) => p.path === path)?.typeHint;
    expect([hint('before.title'), hint('after.extra')]).toEqual(['string', 'boolean']);
    expect(paths.filter((p) => p.path.startsWith('after.meta.')).map((p) => p.path)).toEqual(['after.meta.b']);
    expect(paths.filter((p) => p.path === 'before.title')).toHaveLength(1);
  });

  it('配列の種の先頭の行の spread も行のキーとして読むこと', () => {
    expect(names(`const ROW = { id: 0, label: "" };
export default { rows: [{ ...ROW, done: false }] };`)).toEqual(['rows', 'rows.*', 'rows.length', 'rows.*.id', 'rows.*.label', 'rows.*.done']);
  });

  it('import した const は、読めるファイルなら同じように読むこと', () => {
    const paths = analyzeStatePaths(`import { EMPTY_DRAFT } from "./defaults.js";
export default { draft: { ...EMPTY_DRAFT } };`, { fileReader: reader({ 'defaults.js': 'export const EMPTY_DRAFT = { title: "", cat: "general" };' }), path: '' });
    expect(paths.map((p) => p.path)).toEqual(['draft', 'draft.title', 'draft.cat']);
    expect(paths.find((p) => p.path === 'draft')?.opaque).toBeUndefined();
  });

  it('名前空間の import のメンバー（`...M.DEFAULT_SOUND`）も、読めるファイルなら同じように読むこと（music-room）', () => {
    const files = reader({ 'lib/music.js': 'export const DEFAULT_SOUND = Object.freeze({ wave: "sawtooth", env: { attack: 0.01 } });\nexport const PRESET = DEFAULT_SOUND;' });
    const paths = analyzeStatePaths(`import * as M from "./lib/music.js";
export default {
  sound: { ...M.DEFAULT_SOUND, volume: 0.8 },
  preset: M.PRESET,
  frozen: Object.freeze({ ...M . PRESET }),
};`, { fileReader: files, path: '' });
    expect(paths.map((p) => p.path)).toEqual([
      'sound', 'sound.wave', 'sound.env', 'sound.env.attack', 'sound.volume',
      'preset', 'preset.wave', 'preset.env', 'preset.env.attack',
      'frozen', 'frozen.wave', 'frozen.env', 'frozen.env.attack',
    ]);
    expect(paths.filter((p) => p.opaque !== undefined)).toEqual([]);
  });

  it('読めない名前空間のメンバー（ファイルが無い・export に無い名前・素の指定子）は、どこから import したかを持つ opaque にすること', () => {
    const paths = analyzeStatePaths(`import * as M from "./lib/music.js";
import * as R from "remote-lib";
export default {
  gone: { ...M.MISSING },
  remote: { ...R.DEFAULTS },
  value: M.MISSING,
  plain: { ...Config.DEFAULTS },
};`, { fileReader: reader({ 'lib/music.js': 'export const DEFAULT_SOUND = { wave: "sine" };' }), path: '' });
    const opaque = (path: string) => paths.find((p) => p.path === path)?.opaque;
    expect(opaque('gone')).toEqual({ spread: '...M.MISSING', from: './lib/music.js' });
    expect(opaque('remote')).toEqual({ spread: '...R.DEFAULTS', from: 'remote-lib' });
    expect(opaque('value')).toEqual({ name: 'M.MISSING', from: './lib/music.js' });
    // a member of a name that is not a namespace import is a spread it cannot read, as before
    expect(opaque('plain')).toEqual({ spread: '...Config.DEFAULTS' });
  });

  it('読めない spread（呼び出し・let・読めない import）は、そのキーの下を開いた形（opaque）にし、書いたキーは読むこと', () => {
    const paths = analyzeStatePaths(`import { REMOTE } from "./remote.js";
let LATER = { a: 1 };
export default {
  call: { ...makeDraft(), known: 1 },
  lt: { ...LATER },
  imp: { ...REMOTE },
  rows: [{ ...rowOf(), id: 0 }],
};`);
    const opaque = (path: string) => paths.find((p) => p.path === path)?.opaque;
    expect(opaque('call')).toEqual({ spread: '...makeDraft()' });
    expect(opaque('lt')).toEqual({ spread: '...LATER' });
    expect(opaque('imp')).toEqual({ spread: '...REMOTE', from: './remote.js' });
    expect(opaque('rows.*')).toEqual({ spread: '...rowOf()' });
    expect(paths.map((p) => p.path)).toEqual(expect.arrayContaining(['call.known', 'rows.*.id']));
  });

  it('JSDoc の @type で形を宣言したキーは、読めない spread があっても開いた形にしないこと', () => {
    const paths = analyzeStatePaths(`export default {
  /** @type {{ title: string, cat: string }} */
  draft: { ...makeDraft() },
};`);
    expect(paths.find((p) => p.path === 'draft')?.opaque).toBeUndefined();
    expect(paths.map((p) => p.path)).toEqual(['draft', 'draft.title', 'draft.cat']);
  });
});

describe('validateDocument — spread を種にしたキーへの束縛', () => {
  it('spread のキーへの束縛は報告せず、打ち間違い（draft.titel）だけを warning で報告すること（homeroom）', () => {
    const html = page(HOMEROOM, `<input data-wcs="value: draft.title">
<input data-wcs="value: draft.titel">
<select data-wcs="value: draft.cat"></select>
<p data-wcs="textContent: formErrors.title"></p>
<p data-wcs="textContent: formErrors.body"></p>`);
    const found = findings(html);
    expect(found.map((d) => [d.code, html.slice(d.start, d.end)])).toEqual([[WcsDiagnosticCode.BindingPathMissing, 'draft.titel']]);
    expect(found[0].message).toContain('Path "draft.titel" does not exist');
  });

  it('読めない spread のキーの下は黙り、キーの上に info を 1 回だけ出すこと（ほかのキーの打ち間違いは報告する）', () => {
    const html = page(`export default {
  draft: { ...makeDraft(), known: 1 },
  count: 0,
};`, `<p data-wcs="textContent: draft.title"></p>
<p data-wcs="textContent: draft.whatever"></p>
<p data-wcs="textContent: cuont"></p>`);
    const found = findings(html);
    expect(found.map((d) => [d.code, d.severity, html.slice(d.start, d.end)])).toEqual([
      [WcsDiagnosticCode.PathDynamicUnknown, 'info', 'draft'],
      [WcsDiagnosticCode.BindingPathMissing, 'warning', 'cuont'],
    ]);
    expect(found[0].message).toBe('The keys ...makeDraft() brings into "draft" cannot be read statically, so the 2 paths bound under it are not checked. Spread a const of the module bound to an object literal, give the key a JSDoc @type with its shape, or declare it in the stateSchema of wcstack.manifest.json to have them checked');
  });

  it('読めない import の spread は、どこから import したかも言うこと（ja）', () => {
    const html = page(`import { EMPTY } from "./defaults.js";
export default { draft: { ...EMPTY } };`, '<p data-wcs="textContent: draft.title"></p>');
    const [info] = validateDocument(html, { locale: 'ja', fileReader: reader({}) }).filter((d) => d.code === WcsDiagnosticCode.PathDynamicUnknown);
    expect(info.message).toBe('...EMPTY（"./defaults.js" から import）が "draft" に持ち込むキーは静的に読めないので、その下に束ねたパス（1 件）は検査していません。オブジェクトリテラルを束縛するモジュールの const を spread するか、キーに形を表す JSDoc の @type を付けるか、wcstack.manifest.json の stateSchema に宣言すると検査されます');
    const { scopes } = getStatePathIndex(html, 'wcs-state', reader({}));
    expect(scopes.opaquePaths).toEqual(['draft']);
    expect([isUnresolvedPath('draft.title', scopes), isUnresolvedPath('draft', scopes)]).toEqual([true, false]);
  });

  it('読める import の spread なら、打ち間違いを報告すること', () => {
    const html = page(`import { EMPTY } from "./defaults.js";
export default { draft: { ...EMPTY } };`, '<p data-wcs="textContent: draft.title"></p>\n<p data-wcs="textContent: draft.titel"></p>');
    const found = findings(html, reader({ 'defaults.js': 'export const EMPTY = { title: "" };' }));
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['draft.titel']);
  });

  it('名前空間の import のメンバーの spread のキーへの束縛は info にならず、打ち間違いだけを報告すること（music-room）', () => {
    const html = page(`import * as M from "./lib/music.js";
export default { sound: { ...M.DEFAULT_SOUND } };`, `<select data-wcs="value: sound.wave"></select>
<input type="range" data-wcs="value: sound.attack">
<input type="range" data-wcs="value: sound.atack">`);
    const found = findings(html, reader({ 'lib/music.js': 'export const DEFAULT_SOUND = { wave: "sawtooth", attack: 0.01, release: 0.3 };' }));
    expect(found.map((d) => [d.code, html.slice(d.start, d.end)])).toEqual([[WcsDiagnosticCode.BindingPathMissing, 'sound.atack']]);
    // without the file, the keys stay open: one info at the key, naming the import
    const [info, ...rest] = findings(html, reader({}));
    expect(rest).toEqual([]);
    expect(info.message).toBe('The keys ...M.DEFAULT_SOUND (imported from "./lib/music.js") brings into "sound" cannot be read statically, so the 3 paths bound under it are not checked. Spread a const of the module bound to an object literal, give the key a JSDoc @type with its shape, or declare it in the stateSchema of wcstack.manifest.json to have them checked');
  });
});
