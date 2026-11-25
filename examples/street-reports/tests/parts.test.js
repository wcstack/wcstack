// components.test.jsx → the parts. Pagination and CommentForm became Declarative Custom Components; each is
// mounted from its own file in front of a small page, as @wcstack/testing's README shows.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mount, settle, fire } from '@wcstack/testing';

const part = (name) => readFileSync(new URL('../public/parts/' + name, import.meta.url), 'utf8');
const shadow = (app, selector) => app.root.querySelector(selector).shadowRoot;

describe('<sr-pagination> (Pagination.jsx)', () => {
  const page = (pageNo, total) => `
    <wcs-state>
      <script type="module">
        export default {
          page: ${pageNo}, total: ${total}, chosen: [],
          $eventTokens: ["pageChosen"],
          $on: { pageChosen(state, event) { state.chosen = state.chosen.concat(event.detail); } },
        };
      </script>
    </wcs-state>
    <sr-pagination id="pager" data-wcs="page#ro: page; totalPages#ro: total; eventToken.page: pageChosen"></sr-pagination>`;

  it('shows the position, disables the ends and reports the page asked for', async () => {
    const app = await mount(part('pagination.html') + page(1, 3));
    const root = shadow(app, '#pager');
    const [prev, next] = root.querySelectorAll('button');
    expect(root.querySelector('span').textContent).toBe('1 / 3 ページ');
    expect(prev.disabled).toBe(true);
    fire(next, 'click');
    await settle();
    expect(app.state().read((s) => s.chosen)).toEqual([2]);

    await app.state().write((s) => { s.page = 3; });
    await settle();
    expect(root.querySelector('span').textContent).toBe('3 / 3 ページ');
    expect(root.querySelectorAll('button')[1].disabled).toBe(true);
    app.unmount();
  });

  it('renders nothing for a single page', async () => {
    const app = await mount(part('pagination.html') + page(1, 1));
    expect(shadow(app, '#pager').querySelector('nav')).toBeNull();
    app.unmount();
  });
});

describe('<sr-comment-form> (CommentForm.jsx)', () => {
  // The page side of onSubmit: answers each request with done() or failed(), as state/app.js addComment does.
  const page = (fail) => `
    <wcs-state>
      <script type="module">
        export default {
          sent: [],
          $commandTokens: ["commentSent", "commentFailed"],
          $eventTokens: ["commentRequested"],
          $on: {
            commentRequested(state, event) {
              state.sent = state.sent.concat(event.detail.body);
              state.$command.${fail ? 'commentFailed' : 'commentSent'}.emit();
            },
          },
        };
      </script>
    </wcs-state>
    <sr-comment-form id="form" data-wcs="eventToken.request: commentRequested; command.done: $command.commentSent; command.failed: $command.commentFailed"></sr-comment-form>`;

  const type = async (textarea, value) => {
    textarea.value = value;
    fire(textarea, 'input');
    await settle();
  };

  it('counts characters and disables 送信 when blank or too long', async () => {
    const app = await mount(part('comment-form.html') + page(false));
    const root = shadow(app, '#form');
    const textarea = root.querySelector('textarea');
    const send = root.querySelector('button');
    expect(root.querySelector('#counter').textContent).toBe('0 / 500');
    expect(send.disabled).toBe(true);
    await type(textarea, '  ');
    expect(send.disabled).toBe(true);
    await type(textarea, 'x'.repeat(501));
    expect(root.querySelector('#counter').textContent).toBe('501 / 500');
    expect(send.disabled).toBe(true);
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    app.unmount();
  });

  it('submits with Ctrl+Enter, clears the text and keeps the focus', async () => {
    const app = await mount(part('comment-form.html') + page(false));
    const root = shadow(app, '#form');
    const textarea = root.querySelector('textarea');
    await type(textarea, '確認しました');
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, composed: true }));
    await settle();
    await settle();
    expect(app.state().read((s) => s.sent)).toEqual(['確認しました']);
    expect(textarea.value).toBe('');
    expect(root.activeElement).toBe(textarea);
    app.unmount();
  });

  it('keeps the text and shows an error when sending fails', async () => {
    const app = await mount(part('comment-form.html') + page(true));
    const root = shadow(app, '#form');
    const textarea = root.querySelector('textarea');
    await type(textarea, '送れない');
    fire(root.querySelector('form'), 'submit');
    await settle();
    await settle();
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(textarea.value).toBe('送れない');
    app.unmount();
  });
});
