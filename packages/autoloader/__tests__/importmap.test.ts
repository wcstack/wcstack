import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadImportmap, buildMap } from '../src/importmap.js';

describe('importmap', () => {
  describe('loadImportmap', () => {
    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('should return null if no importmap script exists', () => {
      expect(loadImportmap()).toBeNull();
    });

    it('should return null if importmap script has no imports', () => {
      const script = document.createElement('script');
      script.type = 'importmap';
      script.innerHTML = JSON.stringify({});
      document.body.appendChild(script);
      expect(loadImportmap()).toBeNull();
    });

    it('should load imports from importmap script', () => {
      const script = document.createElement('script');
      script.type = 'importmap';
      script.innerHTML = JSON.stringify({
        imports: {
          'foo': 'bar'
        }
      });
      document.body.appendChild(script);
      
      const result = loadImportmap();
      expect(result).not.toBeNull();
      expect(result?.imports).toEqual({ 'foo': 'bar' });
    });

    it('should merge multiple importmaps', () => {
      const script1 = document.createElement('script');
      script1.type = 'importmap';
      script1.innerHTML = JSON.stringify({
        imports: {
          'foo': 'bar'
        }
      });
      document.body.appendChild(script1);

      const script2 = document.createElement('script');
      script2.type = 'importmap';
      script2.innerHTML = JSON.stringify({
        imports: {
          'baz': 'qux'
        }
      });
      document.body.appendChild(script2);

      const result = loadImportmap();
      expect(result?.imports).toEqual({
        'foo': 'bar',
        'baz': 'qux'
      });
    });

    it('should throw error on invalid JSON', () => {
      const script = document.createElement('script');
      script.type = 'importmap';
      script.innerHTML = '{ invalid json }';
      document.body.appendChild(script);

      expect(() => loadImportmap()).toThrow(/Failed to parse importmap JSON/);
    });
  });

  describe('buildMap', () => {
    it('should parse eager load components', () => {
      const importmap = {
        imports: {
          '@components/my-button': './components/button.js',
          '@components/my-input|loader1': './components/input.js',
          '@components/my-card|loader2,my-base-card': './components/card.js'
        }
      };

      const { loadMap, prefixMap } = buildMap(importmap);

      expect(prefixMap).toEqual({});
      expect(loadMap['my-button']).toEqual({
        key: '@components/my-button',
        tagName: 'my-button',
        loaderKey: null,
        extends: null,
        isNameSpaced: false
      });
      expect(loadMap['my-input']).toEqual({
        key: '@components/my-input|loader1',
        tagName: 'my-input',
        loaderKey: 'loader1',
        extends: null,
        isNameSpaced: false
      });
      expect(loadMap['my-card']).toEqual({
        key: '@components/my-card|loader2,my-base-card',
        tagName: 'my-card',
        loaderKey: 'loader2',
        extends: 'my-base-card',
        isNameSpaced: false
      });
    });

    it('should parse lazy load namespaces', () => {
      const importmap = {
        imports: {
          '@components/ui/': './components/ui/',
          '@components/form|loader1/': './components/form/'
        }
      };

      const { loadMap, prefixMap } = buildMap(importmap);

      expect(loadMap).toEqual({});
      expect(prefixMap['ui']).toEqual({
        key: '@components/ui/',
        prefix: 'ui',
        loaderKey: null,
        isNameSpaced: true
      });
      expect(prefixMap['form']).toEqual({
        key: '@components/form|loader1/',
        prefix: 'form',
        loaderKey: 'loader1',
        isNameSpaced: true
      });
    });

    it('should throw error for non-component keys that look like components but are invalid', () => {
      const importmap = {
        imports: {
          '@components/': './components/' // Invalid: empty prefix
        }
      };

      expect(() => buildMap(importmap)).toThrow(/Invalid importmap key/);
    });
    
    it('should throw error for invalid keys', () => {
        // Test cases that might throw errors based on implementation
        // The current implementation throws if prefix is empty or tagName is empty
        
        // Empty prefix (ends with /)
        expect(() => buildMap({ imports: { '@components/|loader/': './' } })).toThrow(/Invalid importmap key/);
        
        // Empty tagName (does not end with /)
        // "@components/|loader" -> tagNamePart is "|loader". split("|", 2) -> ["", "loader"]. tagName is empty.
        expect(() => buildMap({ imports: { '@components/|loader': './' } })).toThrow(/Invalid importmap key/);
    });
    it('should ignore keys that do not start with @', () => {
      const importmap = {
        imports: {
          'lodash': './lodash.js'
        }
      };
      const { prefixMap, loadMap } = buildMap(importmap);
      expect(prefixMap).toEqual({});
      expect(loadMap).toEqual({});
    });

    it('should throw error for invalid key (empty tag name)', () => {
      const importmap = {
        imports: {
          '@components//': './ui/'
        }
      };
      expect(() => buildMap(importmap)).toThrow("Invalid importmap key");
    });
  });
});
