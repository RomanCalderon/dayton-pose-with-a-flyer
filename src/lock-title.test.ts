import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";
import { lockCapTopOffset, lockTitleAt, type LockTitleSettings } from "./lock-title";

const title: LockTitleSettings = {
  enabled: true,
  color: "#FFFFFF",
  opacity: 1,
  revealFraction: 0.2,
  fadeDelayMs: 1000,
  fadeDurationFraction: 0.5,
};

function opacities(elapsedMs: number): number[] {
  return lockTitleAt(elapsedMs, 10, title).words.map((word) => word.opacity);
}

describe("lock title timing", () => {
  it("fills a missing countdown.lockTitle from the defaults", () => {
    expect(parseConfig("{}").countdown.lockTitle).toEqual(title);
    const partial = parseConfig('{ "countdown": { "lockTitle": { "fadeDelayMs": 250 } } }');
    expect(partial.countdown.lockTitle).toEqual({ ...title, fadeDelayMs: 250 });
  });

  it("starts solid white and fades that opacity to zero", () => {
    const atHalf = lockTitleAt(500, 10, title);
    expect(atHalf.color).toBe("#FFFFFF");
    expect(atHalf.blockOpacity).toBe(1);
    expect(atHalf.fillOpacity).toBe(1);
    expect(lockTitleAt(1000, 10, title).fillOpacity).toBe(1);
    expect(lockTitleAt(3000, 10, title).fillOpacity).toBeCloseTo(0.6, 5);
    expect(lockTitleAt(6000, 10, title).fillOpacity).toBe(0);

    const dim = { ...title, color: "#FFEE00", opacity: 0.5 };
    expect(lockTitleAt(500, 10, dim)).toMatchObject({ color: "#FFEE00", fillOpacity: 0.5 });
    expect(lockTitleAt(3000, 10, dim).fillOpacity).toBeCloseTo(0.3, 5);
  });

  it("reveals LOCK, IN, THAT, and POSE across the first fifth of a 10s countdown", () => {
    expect(lockTitleAt(-1, 10, title).blockOpacity).toBe(0);
    expect(opacities(-1)).toEqual([0, 0, 0, 0]);

    const start = lockTitleAt(0, 10, title);
    expect(start.blockOpacity).toBe(1);
    expect(start.words.map((word) => word.visible)).toEqual([false, false, false, false]);
    expect(opacities(30)).toEqual([0.5, 0, 0, 0]);
    expect(opacities(60)).toEqual([1, 0, 0, 0]);
    expect(lockTitleAt(1000, 10, title).blockOpacity).toBe(1);
    expect(opacities(1000)).toEqual([1, 1, 0, 0]);

    const atPose = lockTitleAt(2000, 10, title);
    expect(atPose.blockOpacity).toBeCloseTo(0.8, 5);
    expect(atPose.words[2].opacity).toBe(1);
    expect(atPose.words[3].opacity).toBe(0);
    expect(atPose.words[3].visible).toBe(false);
    expect(lockTitleAt(2060, 10, title).words[3]).toMatchObject({ opacity: 1, visible: true });

    const atThree = lockTitleAt(3000, 10, title);
    expect(atThree.blockOpacity).toBeCloseTo(0.6, 5);
    expect(opacities(3000)).toEqual([1, 1, 1, 1]);
    expect(atThree.words.every((word) => word.visible)).toBe(true);

    const done = lockTitleAt(6000, 10, title);
    expect(done.blockOpacity).toBe(0);
    expect(done.words.map((word) => word.opacity)).toEqual([1, 1, 1, 1]);
    expect(lockTitleAt(7000, 10, title).blockOpacity).toBe(0);
  });

  it("hides the title when it is disabled", () => {
    const off = lockTitleAt(3000, 10, { ...title, enabled: false });
    expect(off.blockOpacity).toBe(0);
    expect(off.words.every((word) => !word.visible)).toBe(true);
  });

  it("offsets the line box by the measured cap height", () => {
    const shift = lockCapTopOffset({
      lineHeight: 587.02,
      fontAscent: 456,
      fontDescent: 114,
      capAscent: 400.72,
    });
    expect(shift).toBeCloseTo(63.79, 2);
  });
});
