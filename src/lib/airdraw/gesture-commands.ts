import type { Gesture } from "./types";

export type HandCommand = "undo" | "redo" | "next-color" | "clear";

export const COMMAND_CONFIG = {
  /** Holding a still open hand this long clears the screen. */
  holdClearMs: 2000,
  /** The hold ring only appears after this delay, so a short pause shows nothing. */
  holdShowMs: 350,
  /** Max palm drift (fraction of the stage) that still counts as "still". */
  holdStillRadius: 0.04,
  /** A swipe must travel this fraction of the stage width… */
  swipeMinDx: 0.22,
  /** …within this time window. */
  swipeWindowMs: 450,
  /** A fist must be held this long to change the color. */
  fistHoldMs: 300,
  /** No new command right after one fired. */
  cooldownMs: 800,
};

type Sample = { x: number; y: number; t: number };

/**
 * Turns stable gestures + palm position into one-shot commands:
 * open hand swipe left = undo, swipe right = redo, fist = next color,
 * still open hand for 2 s = clear. Positions are 0..1 stage fractions.
 */
export class GestureCommands {
  private trail: Sample[] = [];
  private holdStart: Sample | null = null;
  private holdFired = false;
  private fistStart: number | null = null;
  private fistFired = false;
  private cooldownUntil = 0;

  constructor(private cfg = COMMAND_CONFIG) {}

  update(
    gesture: Gesture,
    pos: { x: number; y: number } | null,
    t: number,
  ): { command: HandCommand | null; holdProgress: number } {
    const cfg = this.cfg;
    let command: HandCommand | null = null;
    let holdProgress = 0;
    const ready = t >= this.cooldownUntil;

    // Fist → next color
    if (gesture === "fist") {
      if (this.fistStart === null) this.fistStart = t;
      if (!this.fistFired && ready && t - this.fistStart >= cfg.fistHoldMs) {
        this.fistFired = true;
        command = "next-color";
      }
    } else {
      this.fistStart = null;
      this.fistFired = false;
    }

    if (gesture === "open" && pos) {
      const s = { x: pos.x, y: pos.y, t };
      this.trail.push(s);
      while (this.trail.length && t - this.trail[0]!.t > cfg.swipeWindowMs)
        this.trail.shift();

      // Swipe
      const first = this.trail[0];
      if (!command && ready && first) {
        const dx = s.x - first.x;
        const dy = s.y - first.y;
        if (
          Math.abs(dx) >= cfg.swipeMinDx &&
          Math.abs(dy) < Math.abs(dx) * 0.6
        ) {
          command = dx < 0 ? "undo" : "redo";
          this.trail = [];
          this.holdStart = null;
        }
      }

      // Hold still
      if (!command) {
        if (
          !this.holdStart ||
          Math.hypot(s.x - this.holdStart.x, s.y - this.holdStart.y) >
            cfg.holdStillRadius
        ) {
          this.holdStart = s;
        } else if (!this.holdFired) {
          const elapsed = t - this.holdStart.t;
          if (elapsed >= cfg.holdClearMs && ready) {
            command = "clear";
            this.holdFired = true;
          } else if (elapsed >= cfg.holdShowMs) {
            holdProgress = Math.min(1, elapsed / cfg.holdClearMs);
          }
        }
      }
    } else {
      this.trail = [];
      this.holdStart = null;
      this.holdFired = false;
    }

    if (command) this.cooldownUntil = t + cfg.cooldownMs;
    return { command, holdProgress };
  }

  reset() {
    this.trail = [];
    this.holdStart = null;
    this.holdFired = false;
    this.fistStart = null;
    this.fistFired = false;
  }
}
