import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadFromJsonFile } from '../src/stateLoader/loadFromJsonFile';

describe('loadFromJsonFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchに成功した場合はデータを返すこと', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    });
    vi.stubGlobal('fetch', fetchMock);

    const data = await loadFromJsonFile('/data.json');
    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/data.json');
  });

  // A 3.x exception the README states: a JSON file that cannot be fetched or parsed is logged
  // (prefix, URL, HTTP status) and the state starts empty; 4.0 rejects instead
  it('response.okがfalseの場合は URL と HTTP ステータスを載せて記録し、空オブジェクトを返すこと', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({})
    });
    vi.stubGlobal('fetch', fetchMock);

    const data = await loadFromJsonFile('/missing.json');
    expect(data).toEqual({});
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toEqual([
      '[@wcstack/state] Failed to load JSON file "/missing.json", so the state starts empty (4.0 rejects instead):',
      'HTTP 404 Not Found',
    ]);
    errorSpy.mockRestore();
  });

  it('fetchが失敗した場合は URL と元のエラーを載せて記録し、空オブジェクトを返すこと', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const networkError = new Error('network error');
    const fetchMock = vi.fn().mockRejectedValue(networkError);
    vi.stubGlobal('fetch', fetchMock);

    const data = await loadFromJsonFile('/error.json');
    expect(data).toEqual({});
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('"/error.json"');
    expect(errorSpy.mock.calls[0][1]).toBe(networkError);
    errorSpy.mockRestore();
  });

  it('JSON のパースに失敗した場合も URL と元のエラーを載せて記録し、空オブジェクトを返すこと', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const parseError = new SyntaxError('Unexpected token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw parseError; }
    });
    vi.stubGlobal('fetch', fetchMock);

    const data = await loadFromJsonFile('/broken.json');
    expect(data).toEqual({});
    expect(errorSpy.mock.calls[0][0]).toContain('"/broken.json"');
    expect(errorSpy.mock.calls[0][1]).toBe(parseError);
    errorSpy.mockRestore();
  });
});
