import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerHandler } from '../src/handler.js';
import * as importmapModule from '../src/importmap.js';
import * as eagerLoadModule from '../src/eagerload.js';
import * as lazyLoadModule from '../src/lazyLoad.js';
import { config } from '../src/config.js';

describe('registerHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should do nothing if no importmap is found', async () => {
    vi.spyOn(importmapModule, 'loadImportmap').mockReturnValue(null);
    const buildMapSpy = vi.spyOn(importmapModule, 'buildMap');

    await registerHandler();

    expect(buildMapSpy).not.toHaveBeenCalled();
  });

  it('should process eager load components', async () => {
    const mockImportmap = { imports: {} };
    const mockLoadMap = { 'my-tag': {} as any };
    const mockPrefixMap = {};

    vi.spyOn(importmapModule, 'loadImportmap').mockReturnValue(mockImportmap);
    vi.spyOn(importmapModule, 'buildMap').mockReturnValue({
      loadMap: mockLoadMap,
      prefixMap: mockPrefixMap
    } as any);
    
    const eagerLoadSpy = vi.spyOn(eagerLoadModule, 'eagerLoad').mockResolvedValue();
    const lazyLoadSpy = vi.spyOn(lazyLoadModule, 'handlerForLazyLoad').mockResolvedValue();

    await registerHandler();

    expect(eagerLoadSpy).toHaveBeenCalledWith(mockLoadMap, config.loaders);
  });

  it('should setup lazy load on DOMContentLoaded', async () => {
    const mockImportmap = { imports: {} };
    const mockLoadMap = {};
    const mockPrefixMap = { 'ui': {} as any };

    vi.spyOn(importmapModule, 'loadImportmap').mockReturnValue(mockImportmap);
    vi.spyOn(importmapModule, 'buildMap').mockReturnValue({
      loadMap: mockLoadMap,
      prefixMap: mockPrefixMap
    } as any);
    
    vi.spyOn(eagerLoadModule, 'eagerLoad').mockResolvedValue();
    const lazyLoadSpy = vi.spyOn(lazyLoadModule, 'handlerForLazyLoad').mockResolvedValue();

    await registerHandler();

    // Trigger DOMContentLoaded
    document.dispatchEvent(new Event('DOMContentLoaded'));

    // Wait for async event handler
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(lazyLoadSpy).toHaveBeenCalledWith(document, config, mockPrefixMap);
  });

  it('should throw if eagerLoad fails', async () => {
    const mockImportmap = { imports: {} };
    vi.spyOn(importmapModule, 'loadImportmap').mockReturnValue(mockImportmap);
    vi.spyOn(importmapModule, 'buildMap').mockReturnValue({ loadMap: {}, prefixMap: {} } as any);
    vi.spyOn(eagerLoadModule, 'eagerLoad').mockRejectedValue(new Error('Eager load failed'));

    await expect(registerHandler()).rejects.toThrow('Failed to eager load components: Error: Eager load failed');
  });
});
