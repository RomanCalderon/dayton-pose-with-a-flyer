import type { PickGridConfig } from "./types";

export interface PickSlot {
  index: number;
  row: number;
  col: number;
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fixed obstacles on the pick stage. Column count is config; these boxes are not. */
export const PICK_OBSTACLES = {
  panel: { x: 1896, y: 1759, w: 1070, h: 200 },
  keepOut: { x: 2970, y: 1630, w: 870, h: 430 },
  goBack: { x: 39, y: 2079, w: 150, h: 50 },
  headline: { x: -28, y: -14, w: 3373, h: 806 },
  stage: { x: 0, y: 0, w: 3840, h: 2160 },
} as const;

const TOP_ROWS = 2;

export const ARC_FONT = 24.275;
export const ARC_SPACING = 1.942;
export const ARC_LIMIT = 430;
export const ARC_MIN_FONT = 19;
export const ARC_DY = 8.69;

export function pickPitch(grid: PickGridConfig): number {
  return grid.button + grid.gap;
}

/**
 * Columns for a roster of `count` players.
 * clamp(max(minColumns, ceil((count - row3Max) / 2)), minColumns, maxColumns).
 */
export function pickColumns(count: number, grid: PickGridConfig): number {
  const raw = Math.ceil((count - grid.row3Max) / TOP_ROWS);
  return clamp(Math.max(grid.minColumns, raw), grid.minColumns, grid.maxColumns);
}

/** Top-anchored rows. Rows 1–2 share the column count. Row 3 stops at row3Max. */
export function layoutPickGrid(n: number, grid: PickGridConfig): PickSlot[] {
  const requested = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  const limited = Math.min(requested, Math.max(0, Math.floor(grid.maxPlayers)));
  if (limited === 0) return [];
  const columns = pickColumns(limited, grid);
  const caps = [columns, columns, Math.max(0, grid.row3Max)];
  const pitch = pickPitch(grid);
  const out: PickSlot[] = [];
  let index = 0;
  for (let row = 0; row < TOP_ROWS + 1 && index < limited; row += 1) {
    const take = Math.min(caps[row] ?? 0, limited - index);
    for (let col = 0; col < take; col += 1, index += 1) {
      out.push({
        index,
        row,
        col,
        x: grid.origin.x + col * pitch,
        y: grid.origin.y + row * pitch,
      });
    }
  }
  return out;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function rectInside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x - 1e-6 &&
    inner.y >= outer.y - 1e-6 &&
    inner.x + inner.w <= outer.x + outer.w + 1e-6 &&
    inner.y + inner.h <= outer.y + outer.h + 1e-6
  );
}

export function rosterOverflowMessage(roster: string, count: number, shown: number): string {
  return `${roster} roster has ${count} players; the pick grid shows the first ${shown}`;
}

/** Rough Arial Bold advance. The 22-character sample lands near 394px at the design size. */
export function estimateArcAdvance(text: string, fontSize = ARC_FONT): number {
  const spacing = ARC_SPACING * (fontSize / ARC_FONT);
  return text.length * fontSize * 0.658 + spacing * text.length;
}

export function fitArcFont(
  measured: number,
  fontSize = ARC_FONT,
): { fontSize: number; letterSpacing: number; dy: number; textLength: number | null } {
  const safe = measured > 0 && Number.isFinite(measured) ? measured : 0;
  const base = fontSize > 0 ? fontSize : ARC_FONT;
  let next = base;
  if (safe > ARC_LIMIT) next = Math.max(ARC_MIN_FONT, base * (ARC_LIMIT / safe));
  const predicted = safe * (next / base);
  return {
    fontSize: next,
    letterSpacing: ARC_SPACING * (next / ARC_FONT),
    dy: ARC_DY * (next / ARC_FONT),
    textLength: predicted > ARC_LIMIT + 0.01 ? ARC_LIMIT : null,
  };
}

export function athleteArcName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim().replace(/\s+/g, " ").toUpperCase();
}

export function showJersey(jersey: number): boolean {
  return Number.isFinite(jersey) && jersey !== 0;
}

function clamp(value: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}
