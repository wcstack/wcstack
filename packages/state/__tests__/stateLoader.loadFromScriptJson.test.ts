import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadFromScriptJson } from '../src/stateLoader/loadFromScriptJson';

describe('loadFromScriptJson', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
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

  // A 3.x exception the README states: no JSON script in the document is not a failure, but it
  // is not silent either — one warning naming the id, where it was looked up, and the empty start
  it('scriptが存在しない場合は id を名指しで 1 回 warn して空オブジェクトを返すこと', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const state = loadFromScriptJson('missing');
    expect(state).toEqual({});
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toBe(
      '[@wcstack/state] state="missing": no <script type="application/json" id="missing"> in the document (3.x does not look inside shadow roots), so the state starts empty.',
    );
  });

  it('typeがapplication/json以外の場合も同じ warn を出して空オブジェクトを返すこと', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const script = document.createElement('script');
    script.id = 'state-text';
    script.type = 'text/plain';
    script.textContent = JSON.stringify({ count: 2 });
    document.body.appendChild(script);

    const state = loadFromScriptJson('state-text');
    expect(state).toEqual({});
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('id="state-text"');
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

    // JSON.parse's SyntaxError itself (was: a new "Failed to parse JSON from script element:…" Error)
    let error: unknown;
    try {
      loadFromScriptJson('state-bad');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SyntaxError);
    expect((error as Error).message).not.toMatch(/Failed to parse JSON/);
  });
});
