import { PatchVoice } from "../types.js";
import { NodeInstance } from "./builders.js";

/** One sounding (or releasing) note and the graph instance backing it. */
export interface VoiceAllocation {
  note: number;
  instances: Map<string, NodeInstance>;
  gates: NonNullable<NodeInstance["gate"]>[];
  gain: GainNode;
  released: boolean;
  /**
   * Audio-clock time at which this voice may be reclaimed. Deliberately not a
   * timer: background tabs throttle `setTimeout` to roughly once a minute while
   * audio keeps rendering, so a timer-based reclaim leaks voices exactly when a
   * page is left playing in the background.
   */
  freeAt: number;
}

/** A `<wcs-voice>` template plus the notes currently allocated from it. */
export class VoiceAllocator {
  readonly def: PatchVoice;
  readonly active: VoiceAllocation[] = [];

  constructor(def: PatchVoice) {
    this.def = def;
  }

  get poly(): number {
    return Math.max(this.def.poly, 1);
  }

  /** Notes still sounding — a released voice is no longer one of them. */
  get sounding(): number {
    return this.active.filter((a) => !a.released).length;
  }

  /** Voices still holding audio nodes, released-but-not-yet-reclaimed included. */
  get allocated(): number {
    return this.active.length;
  }

  add(allocation: VoiceAllocation): void {
    this.active.push(allocation);
  }

  /** Voices playing `note` that have not been released yet. */
  matching(note: number): VoiceAllocation[] {
    return this.active.filter((a) => a.note === note && !a.released);
  }

  /** Oldest sounding voice — the one note stealing takes when `poly` is full. */
  oldest(): VoiceAllocation | undefined {
    return this.active.find((a) => !a.released);
  }

  /** Begin the release tail. `freeAt` is on the audio clock, never wall-clock. */
  release(allocation: VoiceAllocation, t: number): void {
    allocation.released = true;
    let tail = 0.08;
    if (allocation.gates.length > 0) {
      for (const gate of allocation.gates) gate.off(t);
      tail = Math.max(...allocation.gates.map((g) => g.release()), tail);
    } else {
      allocation.gain.gain.setTargetAtTime(0, t, tail / 3);
    }
    // setTargetAtTime approaches its target exponentially; three time constants
    // is ~95%, and the extra 0.3s covers the tail below audibility.
    allocation.freeAt = t + tail * 3 + 0.3;
  }

  /** Steal: a fast fade so the reused voice does not click. */
  steal(allocation: VoiceAllocation, t: number): void {
    allocation.released = true;
    allocation.gain.gain.cancelScheduledValues(t);
    allocation.gain.gain.setTargetAtTime(0, t, 0.01);
    allocation.freeAt = t + 0.08;
  }

  /** Reclaim every released voice whose tail has elapsed on the audio clock. */
  sweep(now: number): void {
    for (const allocation of [...this.active]) {
      if (allocation.released && allocation.freeAt <= now) this.dispose(allocation);
    }
  }

  dispose(allocation: VoiceAllocation): void {
    for (const inst of allocation.instances.values()) inst.dispose?.();
    try { allocation.gain.disconnect(); } catch { /* already detached */ }
    const i = this.active.indexOf(allocation);
    if (i !== -1) this.active.splice(i, 1);
  }

  disposeAll(): void {
    for (const allocation of [...this.active]) this.dispose(allocation);
  }
}
