/**
 * SSR 時に HTML 属性で表現できないプロパティバインディングを蓄積するストア。
 * ハイドレーション時にクライアント側で復元する。
 */

export interface ISsrPropertyEntry {
  propName: string;
  value: unknown;
}

// node → プロパティエントリのリスト
const store: WeakMap<Node, ISsrPropertyEntry[]> = new WeakMap();

export function addSsrProperty(node: Node, propName: string, value: unknown): void {
  let entries = store.get(node);
  if (!entries) {
    entries = [];
    store.set(node, entries);
  }
  // 同じプロパティの既存エントリは上書き
  const existing = entries.find(e => e.propName === propName);
  if (existing) {
    existing.value = value;
  } else {
    entries.push({ propName, value });
  }
}

export function getSsrProperties(node: Node): ISsrPropertyEntry[] {
  return store.get(node) ?? [];
}

export function getAllSsrPropertyNodes(): Node[] {
  // WeakMap は列挙不可なので、別途トラッキングが必要
  return Array.from(trackedNodes);
}

const trackedNodes: Set<Node> = new Set();

export function trackSsrPropertyNode(node: Node): void {
  trackedNodes.add(node);
}

export function clearSsrPropertyStore(): void {
  trackedNodes.clear();
}
