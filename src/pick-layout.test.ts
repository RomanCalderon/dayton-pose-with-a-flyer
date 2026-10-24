import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";
import {
  ARC_FONT,
  ARC_LIMIT,
  athleteArcName,
  estimateArcAdvance,
  fitArcFont,
  layoutPickGrid,
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

  it("draws a name only when one exists and hides jersey 0", () => {
    expect(athleteArcName("casey", "alden")).toBe("CASEY ALDEN");
    expect(athleteArcName("  ", "")).toBe("");
    expect(showJersey(0)).toBe(false);
    expect(showJersey(Number.NaN)).toBe(false);
    expect(showJersey(7)).toBe(true);
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
    expect(empty.match(/class="jersey"/g)).toHaveLength(4);

    const selected = pickHtml(women, "womens", ["w1"]);
    expect(selected).toContain("is-selected");
    expect(selected).toContain("is-ready");
    expect(selected).toContain('data-action="lets-go"');

    const men = Array.from({ length: 30 }, (_, index) => person(`m${index}`, "Casey", "Alden", 4, "mens"));
    expect(pickHtml(men).match(/class="headshot[" ]/g)).toHaveLength(27);
  });
});

function person(id: string, firstName: string, lastName: string, jersey: number, team: RosterId): Athlete {
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
