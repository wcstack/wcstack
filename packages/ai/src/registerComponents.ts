import { Ai } from "./components/Ai.js";
import { AiMessage } from "./components/AiMessage.js";
import { config } from "./config.js";

export function registerComponents(): void {
  if (!customElements.get(config.tagNames.ai)) {
    customElements.define(config.tagNames.ai, Ai);
  }
  if (!customElements.get(config.tagNames.aiMessage)) {
    customElements.define(config.tagNames.aiMessage, AiMessage);
  }
}
