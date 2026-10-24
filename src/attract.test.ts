import { describe, expect, it } from "vitest";
import {
  attractSlideTransform,
  collectAttractStills,
  imageHasTransparency,
  keyConnectedWhite,
  shuffleAttractOrder,
  VITESSE_FONT_FILES,
  type AttractStill,
} from "./attract";
import { parseConfig } from "./config";
import type { RosterFile } from "./types";

describe("attract stills", () => {
  const roster: RosterFile = {
    version: 1,
    teams: {
      mens: [
        { id: "m-0", firstName: "", lastName: "", jersey: 0, team: "mens", headshot: "STILL/Men/M-0.png", clips: { left: "a", right: "b" } },
        { id: "mascot-1", firstName: "", lastName: "", jersey: 0, team: "mens", headshot: "STILL/Mascot/Mascot-1.png", clips: { left: "a", right: "b" } },
      ],
      womens: [
        { id: "w-7", firstName: "", lastName: "", jersey: 7, team: "womens", still: "STILL/Women/W-7.png", headshot: "headshots/w-7.png", clips: { left: "a", right: "b" } },
        { id: "mascot-1", firstName: "", lastName: "", jersey: 0, team: "womens", headshot: "STILL/Mascot/Mascot-1.png", clips: { left: "a", right: "b" } },
      ],
    },
    mascots: [{ id: "mascot-2", still: "stills/mascot.png" }],
  };

  it("collects men, women, and mascots once, preferring still over headshot", () => {
    expect(collectAttractStills(roster).map((still) => `${still.id}:${still.file}`)).toEqual([
      "m-0:STILL/Men/M-0.png",
      "mascot-1:STILL/Mascot/Mascot-1.png",
      "w-7:STILL/Women/W-7.png",
      "mascot-2:stills/mascot.png",
    ]);
    expect(collectAttractStills(null)).toEqual([]);
  });

  it("shuffles through every still before a repeat", () => {
    const stills = collectAttractStills(roster);
    const order = shuffleAttractOrder(stills, () => 0);
    expect(new Set(order.map((still) => still.id)).size).toBe(stills.length);
    const again = shuffleAttractOrder(stills, () => 0, order[order.length - 1].id);
    expect(again[0].id).not.toBe(order[order.length - 1].id);
  });

  it("does not repeat the still that just played when the deck restarts", () => {
    const stills: AttractStill[] = [
      { id: "a", file: "a.png" },
      { id: "b", file: "b.png" },
    ];
    const order = shuffleAttractOrder(stills, () => 0.99, "b");
    expect(order[0].id).toBe("a");
  });
});

describe("attract motion and keying", () => {
  it("slides with translateX only", () => {
    expect(attractSlideTransform("in")).toBe("translateX(-50%)");
    expect(attractSlideTransform("out")).toContain("translateX");
    expect(attractSlideTransform("out")).not.toContain("translateY");
  });

  it("leaves an already-transparent still unchanged and keys only border white", () => {
    const clear = new Uint8ClampedArray([0, 0, 0, 0]);
    expect(imageHasTransparency(clear)).toBe(true);
    const opaque = new Uint8ClampedArray(5 * 5 * 4);
    for (let i = 0; i < 25; i += 1) {
      opaque[i * 4] = 255;
      opaque[i * 4 + 1] = 255;
      opaque[i * 4 + 2] = 255;
      opaque[i * 4 + 3] = 255;
    }
    const center = 12;
    for (const index of [6, 7, 8, 11, 13, 16, 17, 18]) {
      const offset = index * 4;
      opaque[offset] = 189;
      opaque[offset + 1] = 22;
      opaque[offset + 2] = 52;
    }
    const jersey = center * 4;
    expect(imageHasTransparency(opaque)).toBe(false);
    const keyed = keyConnectedWhite(opaque, 5, 5, 10);
    expect(keyed[3]).toBe(0);
    expect(keyed[jersey + 3]).toBe(255);
    expect(keyed[jersey]).toBe(255);
    expect(keyed[11 * 4 + 3]).toBe(255);
    expect(keyed[11 * 4]).toBe(189);
  });

  it("defaults keying off", () => {
    expect(parseConfig("{}").attract.rotation).toEqual({
      enabled: true,
      holdMs: 6000,
      outMs: 700,
      inMs: 900,
      keyWhite: false,
    });
    expect(VITESSE_FONT_FILES).toEqual([
      "fonts/Vitesse-Bold.woff2",
      "fonts/Vitesse-Bold.woff",
      "fonts/Vitesse-Bold.otf",
      "fonts/Vitesse-Bold.ttf",
    ]);
  });
});
