import { describe, it, expect } from 'vitest';
import { config, setConfig } from '../src/config';
import { DELIMITER, WILDCARD } from '../src/define';

describe('config', () => {
  it('デフォルト設定が存在すること', () => {
    expect(config.bindAttributeName).toBe('data-wcs');
    expect(config.commentTextPrefix).toBe('wcs-text');
    expect(config.tagNames.state).toBe('wcs-state');
  });
});

describe('setConfig', () => {
  it('tagNamesを変更できること', () => {
    setConfig({ tagNames: { state: 'custom-state' } });
    expect(config.tagNames.state).toBe('custom-state');
    // restore
    setConfig({ tagNames: { state: 'wcs-state' } });
  });

  it('bindAttributeNameを変更できること', () => {
    setConfig({ bindAttributeName: 'data-custom' });
    expect(config.bindAttributeName).toBe('data-custom');
    setConfig({ bindAttributeName: 'data-wcs' });
  });

  it('commentTextPrefixを変更できること', () => {
    setConfig({ commentTextPrefix: 'custom-text' });
    expect(config.commentTextPrefix).toBe('custom-text');
    setConfig({ commentTextPrefix: 'wcs-text' });
  });

  it('commentForPrefixを変更できること', () => {
    setConfig({ commentForPrefix: 'custom-for' });
    expect(config.commentForPrefix).toBe('custom-for');
    setConfig({ commentForPrefix: 'wcs-for' });
  });

  it('commentIfPrefixを変更できること', () => {
    setConfig({ commentIfPrefix: 'custom-if' });
    expect(config.commentIfPrefix).toBe('custom-if');
    setConfig({ commentIfPrefix: 'wcs-if' });
  });

  it('commentElseIfPrefixを変更できること', () => {
    setConfig({ commentElseIfPrefix: 'custom-elseif' });
    expect(config.commentElseIfPrefix).toBe('custom-elseif');
    setConfig({ commentElseIfPrefix: 'wcs-elseif' });
  });

  it('commentElsePrefixを変更できること', () => {
    setConfig({ commentElsePrefix: 'custom-else' });
    expect(config.commentElsePrefix).toBe('custom-else');
    setConfig({ commentElsePrefix: 'wcs-else' });
  });

  it('localeを変更できること', () => {
    setConfig({ locale: 'ja-JP' });
    expect(config.locale).toBe('ja-JP');
    setConfig({ locale: 'en' });
  });

  it('debugを変更できること', () => {
    setConfig({ debug: true });
    expect(config.debug).toBe(true);
    setConfig({ debug: false });
  });

  it('enableMustacheを変更できること', () => {
    setConfig({ enableMustache: false });
    expect(config.enableMustache).toBe(false);
    setConfig({ enableMustache: true });
  });

  it('指定されていないプロパティは変更されないこと', () => {
    setConfig({});
    expect(config.bindAttributeName).toBe('data-wcs');
    expect(config.commentTextPrefix).toBe('wcs-text');
    expect(config.tagNames.state).toBe('wcs-state');
    expect(config.locale).toBe('en');
    expect(config.debug).toBe(false);
    expect(config.enableMustache).toBe(true);
  });
});

describe('define', () => {
  it('DELIMITERとWILDCARDが定義されていること', () => {
    expect(DELIMITER).toBe('.');
    expect(WILDCARD).toBe('*');
  });
});
