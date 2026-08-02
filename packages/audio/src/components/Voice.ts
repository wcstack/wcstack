import { upgradeProperties } from "../protocol/upgradeProperties.js";
import { findAudioRoot } from "./AudioNodeShell.js";

/**
 * `<wcs-voice poly="N">` — turns its subtree into a patch template.
 *
 * Outside a voice the graph is live and monophonic (last-note priority, legato,
 * optional glide). Inside one, the whole subtree is instantiated afresh per held
 * note, which is what makes "markup as patch template" cheap: polyphony costs a
 * `poly` attribute rather than a second copy of the patch.
 *
 * It deliberately declares no `static wcBindable`. `poly` is **structural** — a
 * change rebuilds the graph and cuts every sounding voice — so advertising it as
 * a bindable input would invite exactly the reactive write that should not
 * happen. Set it in markup, not from state.
 */
export class WcsVoice extends HTMLElement {
  static observedAttributes = ["poly"];

  /** Marks this element for the patch compiler (tag names are configurable). */
  readonly isAudioVoice = true;

  readonly patchKey: string;

  private static _next = 0;

  constructor() {
    super();
    this.patchKey = `v${++WcsVoice._next}`;
  }

  get poly(): number {
    const raw = this.getAttribute("poly");
    const n = raw === null ? NaN : parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 8;
  }

  set poly(value: number) {
    this.setAttribute("poly", String(value));
  }

  connectedCallback(): void {
    // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
    upgradeProperties(this);
    findAudioRoot(this)?.requestRebuild();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    findAudioRoot(this)?.requestRebuild();
  }
}
