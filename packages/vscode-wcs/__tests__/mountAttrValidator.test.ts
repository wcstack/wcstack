/**
 * `wcs/mount-path-invalid` — `<wcs-state mount="...">` の値検証（v2）。
 * runtime（state の validateVolumeMountPath）が raise する値を同条件・同文言で
 * 編集時 error にする（name= の fail-fast 鏡映と対称）。
 */
import { describe, it, expect } from 'vitest';
import { validateMountAttributes, findMountPathProblem } from '../src/service/mountAttrValidator';
import { validateDocument } from '../src/core/validateDocument';
import { WcsDiagnosticCode } from '../src/core/diagnostics';

const slice = (html: string, d: { start: number; end: number }) => html.slice(d.start, d.end);

describe('findMountPathProblem（runtime と同条件）', () => {
  it('runtime が raise する値をすべて検出すること', () => {
    expect(findMountPathProblem('')).toBe('empty');
    expect(findMountPathProblem('a..b')).toBe('emptySegment');
    expect(findMountPathProblem('a.*')).toBe('wildcard');
    expect(findMountPathProblem('$x')).toBe('reserved');
    expect(findMountPathProblem('a.#m')).toBe('reserved');
    expect(findMountPathProblem('a@b')).toBe('reserved');
    // 予約文字は位置を問わない（runtime も includes で見る）
    expect(findMountPathProblem('a#b')).toBe('reserved');
    expect(findMountPathProblem('a$b')).toBe('reserved');
  });

  it('妥当な静的パスは null を返すこと', () => {
    expect(findMountPathProblem('i18n')).toBeNull();
    expect(findMountPathProblem('app.i18n.dict')).toBeNull();
  });
});

describe('validateMountAttributes', () => {
  it('ワイルドカードの mount 値に error を出し、値を範囲にすること', () => {
    const html = `<wcs-state mount="a.*" json='{}'></wcs-state>`;
    const diags = validateMountAttributes(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.MountPathInvalid);
    expect(diags[0].severity).toBe('error');
    expect(slice(html, diags[0])).toBe('a.*');
    expect(diags[0].message).toContain('must be static');
  });

  it('空セグメント・予約文字（先頭/中間）にも error を出すこと', () => {
    for (const [bad, fragment] of [
      ['a..b', 'empty segment'],
      ['$x', 'reserved characters'],
      ['a#b', 'reserved characters'],
      ['a@b', 'reserved characters'],
    ] as const) {
      const html = `<wcs-state mount="${bad}"></wcs-state>`;
      const diags = validateMountAttributes(html);
      expect(diags, bad).toHaveLength(1);
      expect(diags[0].message, bad).toContain(fragment);
      expect(slice(html, diags[0]), bad).toBe(bad);
    }
  });

  it('空の mount 値は属性全体を範囲にして error を出すこと', () => {
    const html = `<wcs-state mount="" json='{}'></wcs-state>`;
    const diags = validateMountAttributes(html);
    expect(diags).toHaveLength(1);
    expect(slice(html, diags[0])).toBe('mount=""');
    expect(diags[0].message).toContain('non-empty');
  });

  it('妥当な mount 値と mount 無しの <wcs-state> には出さないこと', () => {
    const html = `<wcs-state mount="app.i18n" json='{}'></wcs-state><wcs-state json='{}'></wcs-state>`;
    expect(validateMountAttributes(html)).toHaveLength(0);
  });

  it('ja ロケールでは日本語メッセージになること', () => {
    const html = `<wcs-state mount="a.*"></wcs-state>`;
    const diags = validateMountAttributes(html, 'wcs-state', 'ja');
    expect(diags[0].message).toContain('ワイルドカード');
  });

  it('validateDocument が同じ code / severity で含めること', () => {
    const html = `<wcs-state mount="$bad" json='{}'></wcs-state>`;
    const diags = validateDocument(html).filter((d) => d.code === WcsDiagnosticCode.MountPathInvalid);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
  });
});
