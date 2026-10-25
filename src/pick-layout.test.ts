import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";
import {
  ARC_FONT,
  ARC_LIMIT,
  athleteArcName,
  estimateArcAdvance,
  fitArcFont,
  HEADSHOT_FRAME,
  headshotCrop,
  headshotLayerStyle,
  headshotShiftY,
  headshotWindowCenterX,
  layoutPickGrid,
  nameArcPath,
  pickColumns,
  pickPitch,
  PICK_OBSTACLES,
  rectInside,
  rectsOverlap,
  rosterOverflowMessage,
  showJersey,
  type Rect,
} from "./pick-layout";
import { createSession } from "./session";
import type { Athlete, RosterId } from "./types";
import { renderChrome, type ViewModel } from "./ui";

const grid = parseConfig("{}").pick.grid;

function rowsOf(n: number): number[] {
  const counts: number[] = [];
  for (const slot of layoutPickGrid(n, grid)) {
    counts[slot.row] = (counts[slot.row] ?? 0) + 1;
  }
  return counts;
}

describe("pick grid", () => {
  it("keeps the Figma pitch and origin", () => {
    expect(grid.button).toBe(275.145);
    expect(grid.gap).toBe(60);
    expect(pickPitch(grid)).toBeCloseTo(335.145, 3);
    expect(grid.origin).toEqual({ x: 130, y: 1009 });
    expect(grid.minColumns).toBe(7);
    expect(grid.maxColumns).toBe(11);
    expect(grid.row3Max).toBe(5);
    expect(grid.maxPlayers).toBe(27);
  });

  it("lays out the roster sizes Roman called out", () => {
    expect(rowsOf(1)).toEqual([1]);
    expect(rowsOf(5)).toEqual([5]);
    expect(rowsOf(7)).toEqual([7]);
    expect(rowsOf(8)).toEqual([7, 1]);
    expect(rowsOf(14)).toEqual([7, 7]);
    expect(rowsOf(19)).toEqual([7, 7, 5]);
    expect(rowsOf(20)).toEqual([8, 8, 4]);
    expect(rowsOf(21)).toEqual([8, 8, 5]);
    expect(rowsOf(22)).toEqual([9, 9, 4]);
    expect(rowsOf(23)).toEqual([9, 9, 5]);
    expect(rowsOf(24)).toEqual([10, 10, 4]);
    expect(rowsOf(25)).toEqual([10, 10, 5]);
    expect(rowsOf(26)).toEqual([11, 11, 4]);
    expect(rowsOf(27)).toEqual([11, 11, 5]);
    expect(pickColumns(19, grid)).toBe(7);
    expect(pickColumns(27, grid)).toBe(11);
  });

  it("matches the 19-player Figma anchor", () => {
    const slots = layoutPickGrid(19, grid);
    const last = slots[18];
    expect(last).toMatchObject({ row: 2, col: 4 });
    expect(last?.x).toBeCloseTo(1470.58, 2);
    expect(last?.y).toBeCloseTo(1679.29, 2);
    expect(slots[0]).toMatchObject({ x: 130, y: 1009, row: 0, col: 0 });
  });

  it("stops an 11-wide row just above the Wright-Patt keep-out and inside the stage", () => {
    const slots = layoutPickGrid(27, grid);
    const right = slots.find((slot) => slot.row === 0 && slot.col === 10);
    const row2 = slots.find((slot) => slot.row === 1 && slot.col === 10);
    expect(right).toBeDefined();
    expect(row2).toBeDefined();
    if (!right || !row2) return;
    const rightEdge = right.x + grid.button;
    const row2Bottom = row2.y + grid.button;
    expect(rightEdge).toBeCloseTo(3756.6, 1);
    expect(row2Bottom).toBeCloseTo(1619.29, 2);
    expect(row2Bottom).toBeLessThan(PICK_OBSTACLES.keepOut.y);
    expect(PICK_OBSTACLES.keepOut.y - row2Bottom).toBeLessThan(15);
    expect(rightEdge).toBeLessThan(PICK_OBSTACLES.stage.w);
  });

  it("shows the first 27 when the roster is larger", () => {
    expect(layoutPickGrid(28, grid)).toHaveLength(27);
    expect(layoutPickGrid(40, grid)).toHaveLength(27);
    expect(rosterOverflowMessage("mens", 30, 27)).toBe(
      "mens roster has 30 players; the pick grid shows the first 27",
    );
  });

  it("follows a tighter column cap from config", () => {
    const tight = { ...grid, maxColumns: 8, maxPlayers: 27 };
    const slots = layoutPickGrid(27, tight);
    expect(pickColumns(27, tight)).toBe(8);
    expect(slots).toHaveLength(21);
    const counts: number[] = [];
    for (const slot of slots) counts[slot.row] = (counts[slot.row] ?? 0) + 1;
    expect(counts).toEqual([8, 8, 5]);
  });

  it("keeps every button clear of the panel, keep-out, go back, headline, and stage edge", () => {
    const obstacles = [PICK_OBSTACLES.panel, PICK_OBSTACLES.keepOut, PICK_OBSTACLES.goBack, PICK_OBSTACLES.headline];
    for (let n = 1; n <= 27; n += 1) {
      const slots = layoutPickGrid(n, grid);
      expect(slots, `N=${n}`).toHaveLength(n);
      for (const slot of slots) {
        const button: Rect = { x: slot.x, y: slot.y, w: grid.button, h: grid.button };
        expect(rectInside(button, PICK_OBSTACLES.stage), `N=${n} stage`).toBe(true);
        for (const obstacle of obstacles) {
          expect(rectsOverlap(button, obstacle), `N=${n} ${obstacle.x},${obstacle.y}`).toBe(false);
        }
      }
    }
  });
});

describe("headshot crop", () => {
  const headshot = parseConfig("{}").pick.headshot;

  it("fills missing headshot keys from the defaults", () => {
    expect(headshot).toEqual({ zoom: 1.18, offsetX: 0, offsetY: 0 });
    expect(parseConfig("{}").pick.nameInset).toBe(12);
    const partial = parseConfig('{ "pick": { "headshot": { "zoom": 1.3 } } }');
    expect(partial.pick.headshot).toEqual({ zoom: 1.3, offsetX: 0, offsetY: 0 });
    expect(partial.pick.nameInset).toBe(12);
  });

  it("top-anchors a 564×2000 still on the head and shoulders", () => {
    const crop = headshotCrop(564, 2000, headshot);
    expect(crop.width).toBeGreaterThanOrEqual(HEADSHOT_FRAME.w);
    expect(crop.x).toBeCloseTo((HEADSHOT_FRAME.w - crop.width) / 2, 3);
    expect(crop.y).toBe(0);
    expect(crop.visibleFraction).toBeGreaterThan(0.28);
    expect(crop.visibleFraction).toBeLessThan(0.35);
  });

  it("keeps the image centred on the old window when the circle is the only clip", () => {
    const style = headshotLayerStyle({ zoom: 1.5, offsetX: 4, offsetY: 0.02 });
    expect(style).toBe("--hs-zoom:1.5;--hs-x:4px;--hs-y:-2%;--hs-left:137.414px;--hs-top:39.79px;--hs-width:177.468px");
    const width = HEADSHOT_FRAME.w * 1.5;
    expect(width).toBeCloseTo(266.202, 3);
    expect(headshotWindowCenterX() - width / 2).toBeLessThan(HEADSHOT_FRAME.x);
    expect(headshotWindowCenterX() + width / 2).toBeGreaterThan(HEADSHOT_FRAME.x + HEADSHOT_FRAME.w);
  });

  it("treats a small offsetY as a fraction and a larger one as pixels", () => {
    const fraction = headshotCrop(564, 2000, { ...headshot, offsetY: 0.02, offsetX: 4 });
    expect(fraction.y).toBeCloseTo(-0.02 * fraction.height, 3);
    expect(fraction.x).toBeCloseTo((HEADSHOT_FRAME.w - fraction.width) / 2 + 4, 3);
    const pixels = headshotCrop(564, 2000, { ...headshot, offsetY: 12 });
    expect(pixels.y).toBe(-12);
    expect(headshotShiftY(0)).toBe("0px");
    expect(headshotShiftY(0.02)).toBe("-2%");
    expect(headshotShiftY(12)).toBe("-12px");
  });
});

describe("name arc inset", () => {
  it("drops the arc about 12px from the Figma rim", () => {
    const original = nameArcPath(0);
    const inset = nameArcPath(12);
    expect(original.top).toBeCloseTo(19.401, 2);
    expect(original.radius).toBeCloseTo(118.524, 3);
    expect(inset.top - original.top).toBeCloseTo(12, 3);
    expect(inset.radius).toBeCloseTo(106.524, 3);
  });
});

describe("pick button text", () => {
  it("shrinks arc text once the advance passes 430px", () => {
    expect(estimateArcAdvance("FIRSTNAME LASTNAMELONG")).toBeCloseTo(394, 0);
    expect(fitArcFont(394).fontSize).toBe(ARC_FONT);
    expect(fitArcFont(394).textLength).toBeNull();
    const scaled = fitArcFont(500);
    expect(scaled.fontSize).toBeCloseTo(ARC_FONT * (ARC_LIMIT / 500), 3);
    expect(scaled.fontSize).toBeGreaterThanOrEqual(19);
    expect(scaled.textLength).toBeNull();
    const floored = fitArcFont(700);
    expect(floored.fontSize).toBe(19);
    expect(floored.textLength).toBe(ARC_LIMIT);
  });

  it("draws a name only when one exists and shows jersey 0", () => {
    expect(athleteArcName("casey", "alden")).toBe("CASEY ALDEN");
    expect(athleteArcName("  ", "")).toBe("");
    expect(showJersey(0)).toBe(true);
    expect(showJersey(0, { id: "m-0" })).toBe(true);
    expect(showJersey(7)).toBe(true);
    expect(showJersey(null)).toBe(false);
    expect(showJersey(undefined)).toBe(false);
    expect(showJersey(Number.NaN)).toBe(false);
    expect(showJersey(-1)).toBe(false);
    expect(showJersey(0, { id: "mascot-1" })).toBe(false);
    expect(showJersey(0, { id: "mascot-2" })).toBe(false);
    expect(showJersey(4, { id: "bird", type: "mascot" })).toBe(false);
    expect(showJersey(4, { id: "bird" }, ["bird"])).toBe(false);
    expect(showJersey(4, { id: "bird" }, ["other"])).toBe(true);
  });
});

describe("pick screen markup", () => {
  it("renders the headline, panel, and only the buttons that fit", () => {
    const women = Array.from({ length: 5 }, (_, index) =>
      person(`w${index}`, index === 0 ? "" : "Avery", index === 0 ? "" : "Lane", index === 3 ? 0 : index + 1, "womens"),
    );
    const empty = pickHtml(women, "womens", []);
    expect(empty).toContain("PICK UP TO\n  2 WOMEN\u2019S");
    expect(empty).toContain("PLAYERS");
    expect(empty).toContain("dayton-d-logo-white.svg");
    expect(empty).toContain("Swap Team");
    expect(empty).toContain("Let's go!");
    expect(empty).toContain("Go Back");
    expect(empty).toContain("disabled");
    expect(empty).not.toContain("is-ready");
    expect(empty.match(/class="headshot[" ]/g)).toHaveLength(5);
    expect(empty.match(/class="hs-name"/g)).toHaveLength(4);
    expect(empty).toContain(">AVERY LANE<");
    expect(empty.match(/class="jersey"/g)).toHaveLength(5);
    expect(empty).toContain(">0<");

    const selected = pickHtml(women, "womens", ["w1"]);
    expect(selected).toContain("is-selected");
    expect(selected).toContain("is-ready");
    expect(selected).toContain('data-action="lets-go"');

    const men = Array.from({ length: 30 }, (_, index) => person(`m${index}`, "Casey", "Alden", 4, "mens"));
    expect(pickHtml(men).match(/class="headshot[" ]/g)).toHaveLength(27);
  });
});

function person(id: string, firstName: string, lastName: string, jersey: number | null, team: RosterId): Athlete {
  return {
    id,
    firstName,
    lastName,
    jersey,
    team,
    headshot: `headshots/${id}.png`,
    clips: { left: "a.mp4", right: "b.mp4" },
  };
}

function pickHtml(team: Athlete[], roster: RosterId = "mens", selected: string[] = []): string {
  const config = parseConfig("{}");
  const session = { ...createSession(roster), screen: "pick" as const, selectedIds: selected };
  const view: ViewModel = {
    config,
    session,
    roster: { version: 1, teams: { mens: roster === "mens" ? team : [], womens: roster === "womens" ? team : [] } },
    assetUrl: (relative: string) => `/kiosk-assets/${relative}`,
    qrError: null,
    scanNotice: null,
    photoError: null,
    showStillThere: false,
    uploadStatus: "",
    debugOpen: false,
    cameraSummary: "",
    preferWebm: false,
    configPath: "",
    assetRoot: "",
    bundledAssetRoot: "",
    missingAssets: [],
    logPath: "",
    hasPhoto: true,
    flashOpacity: 0,
    measuredClips: {},
    backgroundUrl: null,
    backgroundWidth: 0,
    backgroundHeight: 0,
    version: "0.1.9",
  };
  return renderChrome(view);
}
