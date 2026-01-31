import { describe, it, expect, afterEach } from 'vitest';
import { loadFromScriptJson } from '../src/stateLoader/loadFromScriptJson';

describe('loadFromScriptJson', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('application/jsonのscriptから読み込めること', () => {
    const script = document.createElement('script');
    script.id = 'state-json';
    script.type = 'application/json';
    script.textContent = JSON.stringify({ count: 1 });
    document.body.appendChild(script);

    const state = loadFromScriptJson('state-json');
    expect(state).toEqual({ count: 1 });
  });

  it('scriptが存在しない場合は空オブジェクトを返すこと', () => {
    const state = loadFromScriptJson('missing');
    expect(state).toEqual({});
  });

  it('typeがapplication/json以外の場合は空オブジェクトを返すこと', () => {
    const script = document.createElement('script');
    script.id = 'state-text';
    script.type = 'text/plain';
    script.textContent = JSON.stringify({ count: 2 });
    document.body.appendChild(script);

    const state = loadFromScriptJson('state-text');
    expect(state).toEqual({});
  });

  it('textContentが空の場合は空オブジェクトを返すこと', () => {
    const script = document.createElement('script');
    script.id = 'state-empty';
    script.type = 'application/json';
    script.textContent = '';
    document.body.appendChild(script);

    const state = loadFromScriptJson('state-empty');
    expect(state).toEqual({});
  });

  it('不正なJSONの場合はエラーになること', () => {
    const script = document.createElement('script');
    script.id = 'state-bad';
    script.type = 'application/json';
    script.textContent = '{bad json}';
    document.body.appendChild(script);

    expect(() => loadFromScriptJson('state-bad')).toThrow(/Failed to parse JSON/);
  });
});
