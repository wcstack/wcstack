import { describe, it, expect, beforeEach } from 'vitest';
import { addLoader } from '../src/addLoader.js';
import { config } from '../src/config.js';
import { ILoader } from '../src/types.js';

describe('addLoader', () => {
  beforeEach(() => {
    // Reset config.loaders if needed, but config is a singleton.
    // We can just test adding a new key.
  });

  it('should add a loader to config', () => {
    const loader: ILoader = {
      postfix: '.test',
      loader: async () => null
    };
    
    addLoader('test-loader', loader);
    
    expect(config.loaders['test-loader']).toBe(loader);
  });

  it('should overwrite existing loader', () => {
    const loader1: ILoader = {
      postfix: '.1',
      loader: async () => null
    };
    const loader2: ILoader = {
      postfix: '.2',
      loader: async () => null
    };
    
    addLoader('overwrite-test', loader1);
    expect(config.loaders['overwrite-test']).toBe(loader1);
    
    addLoader('overwrite-test', loader2);
    expect(config.loaders['overwrite-test']).toBe(loader2);
  });
});
