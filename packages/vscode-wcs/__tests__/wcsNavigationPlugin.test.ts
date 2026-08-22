import { describe, it, expect } from 'vitest';
import { createWcsNavigationPlugin } from '../src/service/wcsNavigationPlugin';

/**
 * Volar アダプタ層の薄い検証。判断ロジックは wiringLens.test.ts が担うので、
 * ここは「オフセット ⇔ Position 変換と LSP 形の組み立て」と html ガードだけを見る。
 */

const SAMPLE = [
  '<wcs-state>',
  '  <script type="module">',
  '    export default { count: 0, items: [{ label: 1 }] };',
  '  </script>',
  '</wcs-state>',
  '<div data-wcs="textContent: count | fix(0)"></div>',
  '<template data-wcs="for: items">',
  '  <span data-wcs="textContent: .label"></span>',
  '</template>',
  '',
].join('\n');

interface IPosition {
  line: number;
  character: number;
}

function docOf(text: string, languageId: string = 'html') {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }
  return {
    uri: 'file:///test.html',
    languageId,
    version: 1,
    lineCount: lineStarts.length,
    getText: () => text,
    offsetAt: (position: IPosition) => lineStarts[position.line] + position.character,
    positionAt: (offset: number): IPosition => {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
      return { line, character: offset - lineStarts[line] };
    },
  };
}

function positionOf(text: string, needle: string, token: string): IPosition {
  const offset = text.indexOf(needle) + needle.indexOf(token) + Math.floor(token.length / 2);
  const doc = docOf(text);
  return doc.positionAt(offset);
}

function instantiate() {
  const plugin = createWcsNavigationPlugin();
  const context = { env: { locale: 'en' } } as never;
  return { plugin, instance: plugin.create(context) };
}

const cancellationToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as never;

describe('wcsNavigationPlugin', () => {
  it('capabilities が hover / definition / references / inlay を宣言すること', () => {
    const { plugin } = instantiate();
    expect(plugin.capabilities.hoverProvider).toBe(true);
    expect(plugin.capabilities.definitionProvider).toBe(true);
    expect(plugin.capabilities.referencesProvider).toBe(true);
    expect(plugin.capabilities.inlayHintProvider).toEqual({});
  });

  it('provideHover が markdown と range を返すこと', () => {
    const { instance } = instantiate();
    const document = docOf(SAMPLE);
    const hover = instance.provideHover!(
      document as never,
      positionOf(SAMPLE, 'textContent: count', 'count'),
      cancellationToken,
    ) as { contents: { kind: string; value: string }; range: { start: IPosition; end: IPosition } };
    expect(hover.contents.kind).toBe('markdown');
    expect(hover.contents.value).toContain('`count`');
    // range が count のスパンを指す
    const start = document.offsetAt(hover.range.start);
    const end = document.offsetAt(hover.range.end);
    expect(SAMPLE.slice(start, end)).toBe('count');
  });

  it('provideDefinition が同一ドキュメントへの LocationLink を返すこと', () => {
    const { instance } = instantiate();
    const document = docOf(SAMPLE);
    const links = instance.provideDefinition!(
      document as never,
      positionOf(SAMPLE, 'textContent: count', 'count'),
      cancellationToken,
    ) as { targetUri: string; targetRange: { start: IPosition; end: IPosition } }[];
    expect(links).toHaveLength(1);
    expect(links[0].targetUri).toBe(document.uri);
    const start = document.offsetAt(links[0].targetRange.start);
    const end = document.offsetAt(links[0].targetRange.end);
    expect(SAMPLE.slice(start, end)).toBe('count');
  });

  it('provideReferences が includeDeclaration を尊重すること', () => {
    const { instance } = instantiate();
    const document = docOf(SAMPLE);
    const position = positionOf(SAMPLE, 'textContent: count', 'count');
    const withDecl = instance.provideReferences!(
      document as never, position, { includeDeclaration: true } as never, cancellationToken,
    ) as unknown[];
    const withoutDecl = instance.provideReferences!(
      document as never, position, { includeDeclaration: false } as never, cancellationToken,
    ) as unknown[];
    expect(withDecl.length).toBe(withoutDecl.length + 1);
  });

  it('provideInlayHints が範囲内のヒントを paddingLeft 付きで返すこと', () => {
    const { instance } = instantiate();
    const document = docOf(SAMPLE);
    const hints = instance.provideInlayHints!(
      document as never,
      { start: document.positionAt(0), end: document.positionAt(SAMPLE.length) } as never,
      cancellationToken,
    ) as { label: string; paddingLeft: boolean }[];
    const labels = hints.map((h) => h.label).sort();
    expect(labels).toEqual(['= items.*.label', '→ string']);
    for (const hint of hints) expect(hint.paddingLeft).toBe(true);
  });

  it('html 以外のドキュメントには何も返さないこと', () => {
    const { instance } = instantiate();
    const document = docOf(SAMPLE, 'typescript');
    const position = positionOf(SAMPLE, 'textContent: count', 'count');
    expect(instance.provideHover!(document as never, position, cancellationToken)).toBeUndefined();
    expect(instance.provideDefinition!(document as never, position, cancellationToken)).toBeUndefined();
    expect(
      instance.provideReferences!(document as never, position, { includeDeclaration: true } as never, cancellationToken),
    ).toBeUndefined();
    expect(
      instance.provideInlayHints!(
        document as never,
        { start: document.positionAt(0), end: document.positionAt(SAMPLE.length) } as never,
        cancellationToken,
      ),
    ).toBeUndefined();
  });
});
