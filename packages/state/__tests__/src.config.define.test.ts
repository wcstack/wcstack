import { describe, it, expect } from 'vitest';
import { config } from '../src/config';
import { DELIMITER, WILDCARD } from '../src/define';

describe('config', () => {
  it('デフォルト設定が存在すること', () => {
    expect(config.bindAttributeName).toBe('data-wcs');
    expect(config.commentTextPrefix).toBe('wcs-text');
    expect(config.tagNames.state).toBe('wcs-state');
  });
});

describe('define', () => {
  it('DELIMITERとWILDCARDが定義されていること', () => {
    expect(DELIMITER).toBe('.');
    expect(WILDCARD).toBe('*');
  });
});
