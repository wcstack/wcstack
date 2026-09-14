/**
 * scan/initialValue.ts
 *
 * 出力に置く `initial` の複製と、「出力がいま `initial` と同じ値か」の判定
 * （docs/state-scan-design.md D6 / D7・§5-9）。
 *
 * 実体化と reset が宣言の `initial` をそのまま置くと、出力が `initial` の間に子パスへ書いた値
 * （`$watch` ハンドラの注記など）が宣言の `initial` 自体を書き換える。以後の reset はその値に戻し、
 * 出力が同じ参照なので書き込みもしない。そこで plain なデータは複製して置く。
 *
 * plain なデータ: プロトタイプが `Array.prototype` / `Object.prototype` / null で、凍結されておらず、
 * 自前のプロパティがすべて列挙できる文字列キーのデータプロパティ（配列は添字と `length` だけ）の
 * 配列とオブジェクト。判定は property descriptor で行い、getter を実行しない。それ以外
 * （getter / setter・Symbol キー・列挙できないプロパティ・配列の追加プロパティ・Array のサブクラス・
 * 凍結された値・関数・クラスのインスタンス・Map / Set・Date・DOM ノード）は参照のまま置く。
 *
 * 「reset で出力が既に `initial` なら書かない」は、参照ではなく値で見る。plain なデータは中身を再帰で
 * 比べ、それ以外は同一性で比べる。訪れた対を覚えるので、形の違う循環でも止まる。
 */

type PlainKind = "array" | "object";

const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;

function isEnumerableData(target: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(target, key) as PropertyDescriptor;
  return descriptor.enumerable === true && "value" in descriptor;
}

/** plain なデータならその種類、そうでなければ null（参照のまま扱う）。 */
function plainKind(value: unknown): PlainKind | null {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return null;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    const plainArray = proto === Array.prototype && Reflect.ownKeys(value).every(
      (key) => key === "length" || (typeof key === "string" && ARRAY_INDEX.test(key) && isEnumerableData(value, key)),
    );
    return plainArray ? "array" : null;
  }
  const plainObject = (proto === Object.prototype || proto === null) && Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && isEnumerableData(value, key),
  );
  return plainObject ? "object" : null;
}

function cloneValue(value: unknown, copies: Map<object, unknown>): unknown {
  const kind = plainKind(value);
  if (kind === null) {
    return value;
  }
  const source = value as Record<string, unknown>;
  const known = copies.get(source);
  if (typeof known !== "undefined") {
    return known;
  }
  let copy: Record<string, unknown>;
  if (kind === "array") {
    // 穴はそのまま（添字のキーだけを写す）
    copy = new Array((value as unknown[]).length) as unknown as Record<string, unknown>;
  } else {
    copy = Object.getPrototypeOf(value) === null ? Object.create(null) : {};
  }
  copies.set(source, copy);
  for (const key of Object.keys(source)) {
    copy[key] = cloneValue(source[key], copies);
  }
  return copy;
}

/** plain なデータを再帰で複製する。それ以外の値は参照のまま返す（循環と共有参照も保つ）。 */
export function cloneInitial<T>(initial: T): T {
  return cloneValue(initial, new Map()) as T;
}

function sameValue(current: unknown, initial: unknown, compared: Map<object, Set<object>>): boolean {
  if (Object.is(current, initial)) {
    return true;
  }
  // 宣言側の種類を先に決め、配列の長さ・キーの数が違えば、出力側の descriptor を見ずに抜ける
  // （大きく積み上がった出力を空の initial と比べるたびに、出力の大きさに比例させない）
  const kind = plainKind(initial);
  if (kind === null || typeof current !== "object" || current === null) {
    return false;
  }
  const left = current as Record<string, unknown>;
  const right = initial as Record<string, unknown>;
  if (kind === "array") {
    if (!Array.isArray(current) || current.length !== (initial as unknown[]).length) {
      return false;
    }
  } else if (Array.isArray(current) || Object.keys(left).length !== Object.keys(right).length) {
    return false;
  }
  if (plainKind(current) !== kind) {
    return false;
  }
  // 訪れた対を出力側の値ごとの集合で覚える。形の違う循環（自己循環と 2 段の循環など）でも、同じ対の 2 回目で止まる
  let seen = compared.get(left);
  if (typeof seen === "undefined") {
    seen = new Set();
    compared.set(left, seen);
  } else if (seen.has(right)) {
    return true;
  }
  seen.add(right);
  if (kind === "array") {
    for (let index = 0; index < (current as unknown[]).length; index++) {
      if (!sameValue(left[index], right[index], compared)) {
        return false;
      }
    }
    return true;
  }
  return Object.keys(right).every(
    (key) => Object.prototype.hasOwnProperty.call(left, key) && sameValue(left[key], right[key], compared),
  );
}

/** 出力が `initial` と同じ値か（plain なデータは中身を、それ以外は同一性を比べる）。 */
export function isSameAsInitial(current: unknown, initial: unknown): boolean {
  return sameValue(current, initial, new Map());
}

/**
 * 実体化・fold・reset が出力に置いた関数値と、その出力名（docs/state-scan-design.md D7・§5-9 の C5-14）。
 *
 * fold が関数を返す出力は、再セットの宣言検査で state の関数値として見える。それがこの出力に置いた値なら
 * 累積で、メソッドとの衝突ではない。どの世代の state オブジェクトに書かれたか（世代を進めた後に throw した
 * 再セットの後は、新しい `__state` にだけ書かれる）に依らず判定できるよう、値そのものを記録する。
 * 関数は WeakMap のキーなので、出力から外れれば記録ごと回収される。
 */
const outputNamesByFunction: WeakMap<object, Set<string>> = new WeakMap();

/** 出力に置いた値を記録する（関数のときだけ残す）。 */
export function recordOutputValue(name: string, value: unknown): void {
  if (typeof value !== "function") {
    return;
  }
  const names = outputNamesByFunction.get(value);
  if (typeof names === "undefined") {
    outputNamesByFunction.set(value, new Set([name]));
  } else {
    names.add(name);
  }
}

/** その関数値を、実体化・fold・reset がこの出力に置いたことがあるか。 */
export function wasPlacedOnOutput(name: string, value: unknown): boolean {
  return typeof value === "function" && outputNamesByFunction.get(value)?.has(name) === true;
}
