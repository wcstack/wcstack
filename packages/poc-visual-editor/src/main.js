// Entry point. Registers custom elements and wires the sample loader.
// Core flow (textarea ↔ state ↔ <pve-graph>) is fully declarative
// via wcstack in index.html. The sample loader stays in plain JS
// because async fetch inside a wcstack writable scope is awkward.

import './graph-canvas.js';
import './preview.js';

window.addEventListener('DOMContentLoaded', () => {
  const select = document.getElementById('sample-loader');
  const textarea = document.querySelector('textarea[data-wcs]');
  if (!select || !textarea) return;

  select.addEventListener('change', async (e) => {
    const url = e.target.value;
    if (!url) return;
    try {
      const res = await fetch(url);
      const text = await res.text();
      textarea.value = text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (err) {
      console.error('Failed to load sample:', err);
    } finally {
      e.target.value = '';
    }
  });
});
