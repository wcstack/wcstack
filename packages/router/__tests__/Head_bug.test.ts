import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Head, _resetHeadStack } from '../src/components/Head';

describe('Head Bug Reproduction: Initial State Capture', () => {
  beforeEach(() => {
    // Reset DOM
    document.head.innerHTML = `
      <title>Initial Title</title>
      <meta name="description" content="Initial Description">
      <meta name="author" content="Initial Author">
    `;
    _resetHeadStack();
  });

  afterEach(() => {
    document.head.innerHTML = '';
    _resetHeadStack();
  });

  it('should restore original meta tag when only the second head overrides it', () => {
    // Scenario:
    // 1. Initial head has <meta name="description">
    // 2. First Head component connects (does NOT touch description)
    // 3. Second Head component connects (overrides description)
    // 4. Second Head disconnects
    // 5. Description should revert to Initial Description

    // 1. First Head: touches only title
    const head1 = document.createElement('wcs-head') as Head;
    head1.innerHTML = `<title>Page 1 Title</title>`; // Key: 'title'
    document.body.appendChild(head1);
    
    // First capture happens here.
    // Current implementation only captures keys present in head1 ('title')
    // It DOES NOT capture 'meta:description' because head1 doesn't have it.

    expect(document.title).toBe('Page 1 Title');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('Initial Description');

    // 2. Second Head: touches description
    const head2 = document.createElement('wcs-head') as Head;
    head2.innerHTML = `<meta name="description" content="Page 2 Description">`; // Key: 'meta:description'
    document.body.appendChild(head2);

    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('Page 2 Description');

    // 3. Second Head disconnects
    document.body.removeChild(head2);

    // BUG: If initial state of 'meta:description' wasn't captured, it won't be restored.
    // It will likely remain "Page 2 Description" or be removed entirely if logic is flawed.
    const descriptionMeta = document.querySelector('meta[name="description"]');
    
    // We expect it to be restored to initial
    expect(descriptionMeta?.getAttribute('content')).toBe('Initial Description');
  });
});
