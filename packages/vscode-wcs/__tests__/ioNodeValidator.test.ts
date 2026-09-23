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

describe('validateIoNodes: on-prefixed-member（明示のプロパティ形、@wcstack/state 3.1）', () => {
  it('"on" で始まるメンバーをドット無しで束縛すると警告し、書かれた修飾子込みの形を提案する', () => {
    // Fixed by review — 提案文が修飾子を落として ".once:" と言っていた（`#ro` を書き直す手が増える）
    const html = `<wcs-timer data-wcs="once#ro: isOnce"></wcs-timer>`;
    const diags = validateIoNodes(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.OnPrefixedMember);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].member).toBe('once');
    expect(diags[0].message).toContain('".once#ro:"');
    expect(diags[0].message).toContain('"ce"');
  });

  it('修飾子が無いときは従来どおり ".once:" を提案する', () => {
    const diags = validateIoNodes(`<wcs-timer data-wcs="once: isOnce"></wcs-timer>`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('".once:"');
  });

  // Fixed by review — 正本パーサが [wcs/binding-syntax] で落とす形に、別の理由の
  // tag-member-unknown を重ねていた（同じ 1 か所に紛らわしい 2 件）。
  it('正本パーサが落とす形（"..once:" / ".:"）には tag-member-unknown を重ねないこと', () => {
    expect(validateIoNodes(`<wcs-timer data-wcs="..once: isOnce"></wcs-timer>`)).toHaveLength(0);
    expect(validateIoNodes(`<wcs-timer data-wcs=".: isOnce"></wcs-timer>`)).toHaveLength(0);
  });

  // Fixed by review（サイクル 5）— 拒否語の手書きリストが 5 語で、正本の 6 語目
  // `state`（VOLUME_INJECTION_PROP）が抜けていた。dist が src に追いついた瞬間に
  // `.state.x:` が binding-syntax(error) + tag-member-unknown(warning) の二重報告になる。
  it('明示プロパティ形の名前空間の語（state を含む 6 語）には tag-member-unknown を重ねないこと', () => {
    for (const head of ['class', 'style', 'attr', 'command', 'eventToken', 'state']) {
      expect(validateIoNodes(`<wcs-timer data-wcs=".${head}.x: v"></wcs-timer>`), head).toHaveLength(0);
      expect(validateIoNodes(`<wcs-timer data-wcs=".${head}: v"></wcs-timer>`), head).toHaveLength(0);
    }
    // 名前空間でない語は従来どおり契約と突き合わせる（過剰抑制していないことの対照）
    const diags = validateIoNodes(`<wcs-timer data-wcs=".stateish: v"></wcs-timer>`);
    expect(diags.map(d => d.member)).toEqual(['stateish']);
  });

  it('".once:" はメンバーとして照合し、未知の ".name:" は tag-member-unknown にする', () => {
    expect(validateIoNodes(`<wcs-timer data-wcs=".once: isOnce"></wcs-timer>`)).toHaveLength(0);
    const diags = validateIoNodes(`<wcs-timer data-wcs=".onse: isOnce"></wcs-timer>`);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.TagMemberUnknown);
    expect(diags[0].member).toBe('onse');
  });

  it('メンバーでない "on*"（イベント）とドットの後の名前空間は対象外', () => {
    expect(validateIoNodes(`<wcs-timer data-wcs="onclick: go; .class.x: y; .command.start: z"></wcs-timer>`)).toHaveLength(0);
  });
});

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

  // Fixed by review — 式の分割が独自の括弧深度実装のままで引用符を見ておらず、
  // フィルタ引数・パス中の `;` を区切りとして拾って偽の tag-member-unknown を出していた。
  // 正本（@wcstack/state/parser の splitBindTexts）は引用符の外の `;` だけで区切る（要件 B1）。
  it('引用符の中の ";" は式の区切りではない（偽陽性を出さない）', () => {
    const html = `<wcs-timer data-wcs="interval: 'a;b'; bogus: flag"></wcs-timer>`;
    const diags = validateIoNodes(html);
    expect(diags.map(d => d.member)).toEqual(['bogus']);
    expect(html.slice(diags[0].start, diags[0].end)).toBe('bogus');
  });

  it('括弧の中の ";" は区切りとして扱う（ランタイムと同値）', () => {
    // 正本は括弧深度を見ない — `f(a;b)` は 2 式。2 つ目の左辺 "b)" が未知メンバーになる
    const html = `<wcs-timer data-wcs="interval: n|padStart(2;0)"></wcs-timer>`;
    const diags = validateIoNodes(html);
    expect(diags.map(d => d.member)).toEqual(['0)']);
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

describe('validateIoNodes: spread-no-bindable', () => {
  it('wcBindable 無宣言タグへの spread を error にすること（ランタイムは raiseError）', () => {
    const html = `<wcs-fetch-header data-wcs="...: headers"></wcs-fetch-header>`;
    const diagnostics = validateIoNodes(html);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(WcsDiagnosticCode.SpreadNoBindable);
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].tag).toBe('wcs-fetch-header');
    // range は '...' トークンを指す
    expect(html.slice(diagnostics[0].start, diagnostics[0].end)).toBe('...');
  });

  it('宣言のあるタグへの spread と、無宣言タグの通常バインドは対象外', () => {
    // wcs-fetch は宣言あり → spread 合法。無宣言タグの value: 等は従来どおり沈黙
    const html = `
<wcs-fetch data-wcs="...: fetchX"></wcs-fetch>
<wcs-fetch-header data-wcs="value: x"></wcs-fetch-header>`;
    expect(validateIoNodes(html)).toHaveLength(0);
  });

  it('空の wcBindable（wcs-noise）への spread は合法な 0 展開として沈黙すること', () => {
    const html = `<wcs-noise data-wcs="...: cfg"></wcs-noise>`;
    expect(validateIoNodes(html)).toHaveLength(0);
  });

  it('複数式の中の spread だけを指し、他の式は巻き込まないこと', () => {
    const html = `<wcs-fetch-body data-wcs="value: x; ...: body"></wcs-fetch-body>`;
    const diagnostics = validateIoNodes(html);
    expect(diagnostics).toHaveLength(1);
    expect(html.slice(diagnostics[0].start, diagnostics[0].end)).toBe('...');
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
