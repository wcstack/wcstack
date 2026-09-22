export function resolveNodePath(root: Node, path: number[]): Node | null {
  let currentNode: Node | null = root;
  // childNodes[i] ではなく兄弟ポインタで辿る。複製したばかりの行では、childNodes に触れた
  // ノードごとに NodeList（と NodeRareData）が作られ、行の寿命のあいだ残る。行テンプレートの
  // 子は数個なので、辿る歩数は添字の分だけで済む（設計 R5）。
  //
  // 負の添字は `childNodes[-1]`（= undefined → null）とは違い `firstChild` を返す。nodePath は
  // `getNodePath` が実 DOM を数えて作る内部の値で、負の数は生じない（範囲外は `null` で
  // `compileRowPlan` が不適格に倒す）ため、この差は観測されない。
  for (let i = 0; i < path.length; i++) {
    let remaining = path[i];
    currentNode = currentNode.firstChild;
    while (currentNode !== null && remaining > 0) {
      currentNode = currentNode.nextSibling;
      remaining--;
    }
    if (currentNode === null) break;
  }
  return currentNode;
}
