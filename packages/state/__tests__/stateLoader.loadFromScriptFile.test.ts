import { describe, it, expect } from 'vitest';
import { loadFromScriptFile } from '../src/stateLoader/loadFromScriptFile';

describe('loadFromScriptFile', () => {
  it('data URLのモジュールを読み込めること', async () => {
    const code = 'export default { value: 123 }';
    const url = `data:text/javascript,${encodeURIComponent(code)}`;
    const data = await loadFromScriptFile(url);
    expect(data).toEqual({ value: 123 });
  });

  it('存在しないURLの場合はエラーになること', async () => {
    await expect(loadFromScriptFile('file:///not-found-module.js')).rejects.toThrow(/Failed to load script file/);
  });
});
