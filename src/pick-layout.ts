import type { PickGridConfig, PickHeadshotConfig } from "./types";

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

/** Figma photo window inside the 275.145 button. */
export const HEADSHOT_FRAME = { x: 48.68, y: 39.79, w: 177.468, h: 236.625 };

/** Figma name arc before the extra inset. Centre (137.952, 137.925), radius 118.524. */
export const NAME_ARC = { cx: 137.952, cy: 137.925, radius: 118.524 };

export function headshotOffsetY(offsetY: number, imageHeight: number): number {
  if (Math.abs(offsetY) <= 1) return offsetY * imageHeight;
  return offsetY;
}

/**
 * Place a still in the photo window. Width is the cover-width times zoom.
 * The image is centered horizontally and anchored to the top, then nudged.
 */
export function headshotCrop(
  imageWidth: number,
  imageHeight: number,
  headshot: PickHeadshotConfig,
  frameW = HEADSHOT_FRAME.w,
  frameH = HEADSHOT_FRAME.h,
): { x: number; y: number; width: number; height: number; visibleFraction: number } {
  const zoom = headshot.zoom > 0 ? headshot.zoom : 1;
  const scale = (frameW / imageWidth) * zoom;
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const shift = headshotOffsetY(headshot.offsetY, height);
  return {
    x: (frameW - width) / 2 + headshot.offsetX,
    y: shift === 0 ? 0 : -shift,
    width,
    height,
    visibleFraction: frameH / height,
  };
}

/** CSS translateY for the same offset. Percentages are of the image itself. */
export function headshotShiftY(offsetY: number): string {
  if (offsetY === 0) return "0px";
  if (Math.abs(offsetY) <= 1) return `${Math.round(-offsetY * 1000) / 10}%`;
  return `${-offsetY}px`;
}

/** Horizontal centre of the old photo window. The image stays centred there inside the circle. */
export function headshotWindowCenterX(frame = HEADSHOT_FRAME): number {
  return frame.x + frame.w / 2;
}

/**
 * Variables for the photo `<img>`. Width is the old window times zoom, the top
 * stays on the old window's top, and the image is centred on that window.
 * The button circle is the only clip.
 */
export function headshotLayerStyle(headshot: PickHeadshotConfig, frame = HEADSHOT_FRAME): string {
  const zoom = headshot.zoom > 0 ? headshot.zoom : 1;
  return `--hs-zoom:${cssNum(zoom)};--hs-x:${cssNum(headshot.offsetX)}px;--hs-y:${headshotShiftY(headshot.offsetY)};--hs-left:${cssNum(headshotWindowCenterX(frame))}px;--hs-top:${cssNum(frame.y)}px;--hs-width:${cssNum(frame.w)}px`;
}

function cssNum(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

export function nameArcPath(inset: number): { d: string; radius: number; top: number } {
  const radius = NAME_ARC.radius - inset;
  const top = NAME_ARC.cy - radius;
  const bottom = NAME_ARC.cy + radius;
  const n = (value: number) => String(Math.round(value * 1000) / 1000);
  const d = `M${n(NAME_ARC.cx)} ${n(bottom)} A${n(radius)} ${n(radius)} 0 0 1 ${n(NAME_ARC.cx)} ${n(top)} A${n(radius)} ${n(radius)} 0 0 1 ${n(NAME_ARC.cx)} ${n(bottom)}`;
  return { d, radius, top };
}

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

export interface JerseyEntry {
  id?: string;
  /** Roster type. `"mascot"` never draws a badge. */
  type?: string | null;
}

/** Ids that start with `mascot`, ignoring case, are mascots. */
export function isMascotId(id: string | null | undefined): boolean {
  return (id ?? "").trim().toLowerCase().startsWith("mascot");
}

/**
 * A finite jersey of 0 or more draws the badge, including #0.
 * Missing, null, and non-numeric values hide it. Mascots hide it too:
 * an id prefixed `mascot`, `type: "mascot"`, or an id on the roster mascot list.
 */
export function showJersey(
  jersey: number | null | undefined,
  entry?: JerseyEntry,
  mascotIds?: readonly string[],
): boolean {
  if (entry && isMascotEntry(entry, mascotIds)) return false;
  return typeof jersey === "number" && Number.isFinite(jersey) && jersey >= 0;
}

function isMascotEntry(entry: JerseyEntry, mascotIds?: readonly string[]): boolean {
  if (isMascotId(entry.id)) return true;
  if ((entry.type ?? "").trim().toLowerCase() === "mascot") return true;
  const id = (entry.id ?? "").trim().toLowerCase();
  if (!id || !mascotIds) return false;
  return mascotIds.some((mascotId) => mascotId.trim().toLowerCase() === id);
}

function clamp(value: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}
