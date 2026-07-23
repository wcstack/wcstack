/**
 * ioNodeValidator のテスト — 組み込み wcs-* タグ契約との突き合わせ。
 * カタログは generated/builtinTags.generated.ts（wcBindable 由来）を実物で使う。
 */
import { describe, it, expect } from 'vitest';
import { validateIoNodes } from '../src/service/ioNodeValidator.js';
import { WcsDiagnosticCode } from '../src/core/diagnostics.js';

const STATE = (body: string) => `<wcs-state><script type="module">
export default {
${body}
};
</script></wcs-state>`;

describe('validateIoNodes: tag-member-unknown', () => {
  it('存在しないプロパティへのバインドを警告する（typo 提案付き）', () => {
    const html = `<wcs-fetch data-wcs="valu: users"></wcs-fetch>`;
    const diags = validateIoNodes(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.TagMemberUnknown);
    expect(diags[0].tag).toBe('wcs-fetch');
    expect(diags[0].member).toBe('valu');
    expect(diags[0].message).toContain('"value"'); // もしかして: "value"
    // range が "valu" を指す
    expect(html.slice(diags[0].start, diags[0].end)).toBe('valu');
  });

  it('正しい properties / inputs へのバインドは警告しない', () => {
    const html = `<wcs-fetch data-wcs="url: usersUrl; value: users; loading: busy; error: err"></wcs-fetch>`;
    expect(validateIoNodes(html)).toHaveLength(0);
  });

  it('スプレッド・構造・class/style/attr/on・DOM 汎用プロパティは対象外', () => {
    const html = `<wcs-fetch data-wcs="...: slot; if: cond; class.busy: busy; attr.data-x: v; onclick: go; hidden: h"></wcs-fetch>`;
    expect(validateIoNodes(html)).toHaveLength(0);
  });

  it('存在しない command を警告する', () => {
    const html = `<wcs-fetch data-wcs="command.reload: $command.reload"></wcs-fetch>`;
    const diags = validateIoNodes(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.TagMemberUnknown);
    expect(diags[0].member).toBe('reload');
    expect(diags[0].message).toContain('fetch'); // 宣言済み一覧に fetch がある
  });

  it('正しい command は警告しない', () => {
    const html = `<wcs-fetch data-wcs="command.fetch: $command.reload"></wcs-fetch>`;
    expect(validateIoNodes(html)).toHaveLength(0);
  });

  it('eventToken キーが生 DOM イベント名のときに警告する', () => {
    // wcs-fetch の wcBindable プロパティに "response" は無い（value が正）
    const html = `<wcs-fetch data-wcs="eventToken.response: responded"></wcs-fetch>`;
    const diags = validateIoNodes(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.TagMemberUnknown);
    expect(diags[0].message).toContain('プロパティ名');
  });

  it('eventToken キーが wcBindable プロパティ名なら警告しない', () => {
    const html = `<wcs-fetch data-wcs="eventToken.value: responded"></wcs-fetch>`;
    expect(validateIoNodes(html)).toHaveLength(0);
  });

  it('未知タグ（カタログ外の wcs-*）と契約なしヘルパータグは検査しない', () => {
    const html = `<wcs-unknown data-wcs="foo: bar"></wcs-unknown>
<wcs-fetch-header data-wcs="attr.name: n"></wcs-fetch-header>`;
    expect(validateIoNodes(html)).toHaveLength(0);
  });
});

describe('validateIoNodes: trigger-seeded-truthy', () => {
  it('trigger バインド先が true シードなら警告する', () => {
    const html = STATE(`  reload: true,`) +
      `<wcs-fetch data-wcs="trigger: reload"></wcs-fetch>`;
    const diags = validateIoNodes(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.TriggerSeededTruthy);
    expect(diags[0].statePath).toBe('reload');
  });

  it('false シードなら警告しない', () => {
    const html = STATE(`  reload: false,`) +
      `<wcs-fetch data-wcs="trigger: reload"></wcs-fetch>`;
    expect(validateIoNodes(html)).toHaveLength(0);
  });

  it('trigger 入力を持たないタグでは発火しない', () => {
    // wcs-broadcast に trigger は無い → tag-member-unknown 側で検出される
    const html = STATE(`  go: true,`) +
      `<wcs-broadcast data-wcs="trigger: go"></wcs-broadcast>`;
    const diags = validateIoNodes(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.TagMemberUnknown);
  });
});

describe('validateIoNodes: storage-seed-clobber', () => {
  it("value バインド先が '' シードなら警告する", () => {
    const html = STATE(`  username: '',`) +
      `<wcs-storage key="username" data-wcs="value: username"></wcs-storage>`;
    const diags = validateIoNodes(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.StorageSeedClobber);
    expect(diags[0].message).toContain('undefined');
  });

  it('null / [] / {} シードも警告する', () => {
    for (const seed of ['null', '[]', '{}']) {
      const html = STATE(`  saved: ${seed},`) +
        `<wcs-storage key="k" data-wcs="value: saved"></wcs-storage>`;
      const diags = validateIoNodes(html);
      expect(diags.map(d => d.code)).toContain(WcsDiagnosticCode.StorageSeedClobber);
    }
  });

  it('`#init=element` / `#init=auto` 修飾子付きは load-before-bind の解なので警告しない', () => {
    for (const mod of ['#init=element', '#init=auto']) {
      const html = STATE(`  username: '',`) +
        `<wcs-storage key="username" data-wcs="value${mod}: username"></wcs-storage>`;
      expect(validateIoNodes(html)).toHaveLength(0);
    }
  });

  it('修飾子付きの正当なメンバーは tag-member-unknown にならない', () => {
    const html = `<wcs-fetch data-wcs="value#init=state: users"></wcs-fetch>`;
    expect(validateIoNodes(html)).toHaveLength(0);
  });

  it('undefined シード・manual 付きは警告しない', () => {
    const seeded = STATE(`  username: undefined,`) +
      `<wcs-storage key="username" data-wcs="value: username"></wcs-storage>`;
    expect(validateIoNodes(seeded)).toHaveLength(0);

    const manual = STATE(`  username: '',`) +
      `<wcs-storage key="username" manual data-wcs="value: username"></wcs-storage>`;
    expect(validateIoNodes(manual)).toHaveLength(0);
  });
});
