export function resolveNodePath(root: Node, path: number[]): Node | null {
  let currentNode: Node | null = root;
  // childNodes[i] ではなく兄弟ポインタで辿る。複製したばかりの行では、childNodes に触れた
  // ノードごとに NodeList（と NodeRareData）が作られ、行の寿命のあいだ残る。行テンプレートの
  // 子は数個なので、辿る歩数は添字の分だけで済む（設計 R5）。
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
