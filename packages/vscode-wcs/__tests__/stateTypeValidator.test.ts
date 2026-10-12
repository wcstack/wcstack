import { describe, it, expect } from 'vitest';
import { validateStateTypes } from '../src/service/stateTypeValidator';

describe('validateStateTypes', () => {
  it('@type {string} に null を指定すると warning', () => {
    const html = `<wcs-state><script type="module">
export default {
  /** @type {string} */
  label: null,
};
    </script></wcs-state>`;
    const diags = validateStateTypes(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('"null"');
    expect(diags[0].message).toContain('@type {string}');
  });

  it('@type {string|null} に null は OK', () => {
    const html = `<wcs-state><script type="module">
export default {
  /** @type {string|null} */
  label: null,
};
    </script></wcs-state>`;
    const diags = validateStateTypes(html);
    expect(diags).toHaveLength(0);
  });

  it('@type {boolean} に 0 を指定すると warning', () => {
    const html = `<wcs-state><script type="module">
export default {
  /** @type {boolean} */
  active: 0,
};
    </script></wcs-state>`;
    const diags = validateStateTypes(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('"number"');
  });

  it('@type {number} に 0 は OK', () => {
    const html = `<wcs-state><script type="module">
export default {
  /** @type {number} */
  count: 0,
};
    </script></wcs-state>`;
    const diags = validateStateTypes(html);
    expect(diags).toHaveLength(0);
  });

  it('@type {boolean} に true は OK', () => {
    const html = `<wcs-state><script type="module">
export default {
  /** @type {boolean} */
  ok: true,
};
    </script></wcs-state>`;
    const diags = validateStateTypes(html);
    expect(diags).toHaveLength(0);
  });

  it('@type {number[]} に [] は OK', () => {
    const html = `<wcs-state><script type="module">
export default {
  /** @type {number[]} */
  scores: [],
};
    </script></wcs-state>`;
    const diags = validateStateTypes(html);
    expect(diags).toHaveLength(0);
  });

  it('@type {string} に "hello" は OK', () => {
    const html = `<wcs-state><script type="module">
export default {
  /** @type {string} */
  name: "hello",
};
    </script></wcs-state>`;
    const diags = validateStateTypes(html);
    expect(diags).toHaveLength(0);
  });

  it('複数の不整合を同時に検出する', () => {
    const html = `<wcs-state><script type="module">
export default {
  /** @type {string} */
  label: 123,
  /** @type {boolean} */
  active: "yes",
};
    </script></wcs-state>`;
    const diags = validateStateTypes(html);
    expect(diags).toHaveLength(2);
  });

  it('JSDoc なしのプロパティは検証しない', () => {
    const html = `<wcs-state><script type="module">
export default {
  count: 0,
  name: null,
};
    </script></wcs-state>`;
    const diags = validateStateTypes(html);
    expect(diags).toHaveLength(0);
  });

  it('wcs-state がない場合は空', () => {
    const html = `<div>hello</div>`;
    const diags = validateStateTypes(html);
    expect(diags).toHaveLength(0);
  });
});

describe('validateStateTypes — 入れ子の型・@typedef・何でも受ける型', () => {
  const page = (body: string) => `<wcs-state><script type="module">
${body}
    </script></wcs-state>`;

  it('入れ子の {…} を含む型も検証すること（読めずに素通りしていた）', () => {
    const ok = page(`export default {
  /** @type {{ id: number, name: string }[] | null} */
  catalog: null,
};`);
    expect(validateStateTypes(ok)).toHaveLength(0);
    const ng = page(`export default {
  /** @type {{ id: number, name: string }[]} */
  catalog: null,
};`);
    const diags = validateStateTypes(ng);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('{ id: number, name: string }[]');
  });

  it('@typedef の名前を解決すること（オブジェクトの型にオブジェクトの値は OK）', () => {
    const html = page(`/** @typedef {{ id: number }} Product */
export default {
  /** @type {Product} */
  selected: { id: 1 },
  /** @type {Product | null} */
  current: null,
  /** @type {Product} */
  broken: null,
};`);
    const diags = validateStateTypes(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('@type {Product}');
  });

  it('any / unknown / * と関数型は検証しないこと', () => {
    const html = page(`export default {
  /** @type {any} */
  a: null,
  /** @type {unknown} */
  b: 1,
  /** @type {*} */
  c: "x",
  /** @type {(n: number) => void} */
  d: null,
};`);
    expect(validateStateTypes(html)).toHaveLength(0);
  });

  it('説明文を含む複数行の JSDoc も読むこと', () => {
    const html = page(`export default {
  /**
   * The user's name.
   * @type {string}
   */
  label: null,
};`);
    expect(validateStateTypes(html)).toHaveLength(1);
  });
});
