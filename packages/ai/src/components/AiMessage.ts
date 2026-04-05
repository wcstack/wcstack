export class AiMessage extends HTMLElement {
  constructor() {
    super();
    // スロットなしのShadow DOMでlight DOM（メッセージテキスト）の描画を抑制
    this.attachShadow({ mode: "open" });
  }

  get role(): string {
    return this.getAttribute("role") || "system";
  }

  get messageContent(): string {
    return this.textContent?.trim() || "";
  }
}
