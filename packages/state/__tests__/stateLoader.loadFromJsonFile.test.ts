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

  it('response.okがfalseの場合は空オブジェクトを返すこと', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
      json: async () => ({})
    });
    vi.stubGlobal('fetch', fetchMock);

    const data = await loadFromJsonFile('/missing.json');
    expect(data).toEqual({});
    errorSpy.mockRestore();
  });

  it('fetchが失敗した場合は空オブジェクトを返すこと', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn().mockRejectedValue(new Error('network error'));
    vi.stubGlobal('fetch', fetchMock);

    const data = await loadFromJsonFile('/error.json');
    expect(data).toEqual({});
    errorSpy.mockRestore();
  });
});
