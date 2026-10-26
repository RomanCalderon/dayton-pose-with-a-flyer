import type { AthleteTransform, Side } from "./types";

export interface ClipSize {
  width: number;
  height: number;
}

export type ClipLayout = "stacked-alpha" | "vp9-alpha" | "straight";

/** Operators can omit clipMeta. WebM files are VP9-with-alpha; everything else is stacked. */
export function resolveClipLayout(file: string, layout: string | undefined): ClipLayout {
  if (layout === "stacked-alpha" || layout === "vp9-alpha" || layout === "straight") return layout;
  if (file.toLowerCase().endsWith(".webm")) return "vp9-alpha";
  return "stacked-alpha";
}

export function resolveClipSize(
  meta: { width?: number; height?: number } | undefined,
  measured?: ClipSize,
): ClipSize {
  if (meta?.width && meta.height) return { width: meta.width, height: meta.height };
  if (measured && measured.width > 0 && measured.height > 0) return measured;
  return { width: 0, height: 0 };
}

/** videoHeight of a stacked file includes the alpha half. The quad uses the color half. */
export function measuredColorSize(layout: ClipLayout, videoWidth: number, videoHeight: number): ClipSize {
  if (videoWidth <= 0 || videoHeight <= 0) return { width: 0, height: 0 };
  if (layout === "stacked-alpha") return { width: videoWidth, height: videoHeight / 2 };
  return { width: videoWidth, height: videoHeight };
}

export function sameTransform(a: AthleteTransform, b: AthleteTransform): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.scale - b.scale) < 0.0001;
}

/**
 * Keep the on-screen height when a real frame size replaces a guess.
 * An untouched default placement is recomputed so a 1440×2160 clip stands at the edge.
 */
export function transformForMeasuredSize(
  side: Side,
  outputWidth: number,
  outputHeight: number,
  previousSize: ClipSize,
  nextSize: ClipSize,
  current: AthleteTransform,
): AthleteTransform {
  const guess = previousSize.height > 0 ? previousSize : { width: 360, height: 640 };
  const initial = defaultTransform(side, outputWidth, outputHeight, guess);
  if (previousSize.height <= 0 || sameTransform(current, initial)) {
    return defaultTransform(side, outputWidth, outputHeight, nextSize);
  }
  const scale = nextSize.height > 0 ? current.scale * (previousSize.height / nextSize.height) : current.scale;
  return clampTransform({ ...current, scale }, outputWidth, outputHeight);
}

/** Default center and scale so a cropped athlete stands at a screen edge. */
export function defaultTransform(
  side: Side,
  outputWidth: number,
  outputHeight: number,
  clip: ClipSize,
): AthleteTransform {
  const targetH = outputHeight * 0.92;
  const scale = clip.height > 0 ? targetH / clip.height : 1;
  const drawW = clip.width * scale;
  const x = side === "left" ? drawW * 0.42 : outputWidth - drawW * 0.42;
  const y = outputHeight * 0.5;
  return { x, y, scale };
}

export function clampTransform(transform: AthleteTransform, outputWidth: number, outputHeight: number): AthleteTransform {
  const scale = clamp(transform.scale, 0.25, 2.8);
  return {
    x: clamp(transform.x, outputWidth * -0.2, outputWidth * 1.2),
    y: clamp(transform.y, outputHeight * -0.1, outputHeight * 1.15),
    scale,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Size-button stack. Matches `.pm-btn` (128px) and the 16px column gap. */
export const PM_BUTTON = 128;
export const PM_STACK_GAP = 16;
/** Default gap between the visible player and the button column. `adjust.sizeButtons.offsetX`. */
export const PM_EDGE_GAP = 24;

export interface PlusMinusPlacement {
  left: number;
  top: number;
  side: "right" | "left";
}

/** Alpha above this counts as visible artwork. 16 ignores mask compression noise. */
export const OPAQUE_ALPHA_THRESHOLD = 16;

export type OpaqueMask = "alpha" | "stacked-red";

/**
 * Stacked mp4s store the silhouette in the bottom half and are otherwise opaque.
 * A poster PNG is already the color frame, so it uses the real alpha channel.
 */
export function opaqueMaskFor(layout: ClipLayout, sourceHeight: number, clipHeight: number): OpaqueMask {
  if (layout === "stacked-alpha" && clipHeight > 0 && sourceHeight >= clipHeight * 1.5) return "stacked-red";
  return "alpha";
}

/**
 * Opaque box in clip pixels, origin at the top-left of the drawn frame.
 * `stacked-red` reads the mask half (red channel) and reports it in color-frame space.
 * Returns null when the buffer is unreadable or no pixel clears the threshold.
 */
export function opaqueClipBounds(
  data: ArrayLike<number>,
  width: number,
  height: number,
  mask: OpaqueMask,
  threshold = OPAQUE_ALPHA_THRESHOLD,
): Bounds | null {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return null;
  const stacked = mask === "stacked-red";
  const colorHeight = stacked ? height / 2 : height;
  if (colorHeight <= 0) return null;
  const y0 = stacked ? colorHeight : 0;
  let minX = width;
  let minY = colorHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = y0; y < height; y += 1) {
    const row = y * width * 4;
    const localY = y - y0;
    for (let x = 0; x < width; x += 1) {
      const sample = data[row + x * 4 + (stacked ? 0 : 3)];
      if (sample <= threshold) continue;
      if (x < minX) minX = x;
      if (localY < minY) minY = localY;
      if (x > maxX) maxX = x;
      if (localY > maxY) maxY = localY;
    }
  }
  if (maxX < 0 || maxY < 0) return null;
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/** Scale a clip-pixel box with the athlete. The origin is the top-left of the full clip. */
export function mapClipBounds(local: Bounds, clip: ClipSize, transform: AthleteTransform): Bounds {
  const frame = transformBounds(transform, clip);
  return {
    left: frame.left + local.left * transform.scale,
    top: frame.top + local.top * transform.scale,
    width: local.width * transform.scale,
    height: local.height * transform.scale,
  };
}

/**
 * Stage position for the +/− stack: vertically centred on the player, `offsetX`
 * outside the right edge. The same offset is used when the column flips left.
 * A negative offset overlaps the artwork. The column is then clamped on stage.
 */
export function plusMinusPosition(
  bounds: Bounds,
  outputWidth: number,
  outputHeight: number,
  stageWidth: number,
  stageHeight: number,
  offsetX = PM_EDGE_GAP,
): PlusMinusPlacement {
  const gap = Number.isFinite(offsetX) ? offsetX : PM_EDGE_GAP;
  const sx = outputWidth > 0 ? stageWidth / outputWidth : 1;
  const sy = outputHeight > 0 ? stageHeight / outputHeight : 1;
  const boxLeft = bounds.left * sx;
  const boxTop = bounds.top * sy;
  const boxWidth = bounds.width * sx;
  const boxHeight = bounds.height * sy;
  const columnHeight = PM_BUTTON * 2 + PM_STACK_GAP;
  let side: PlusMinusPlacement["side"] = "right";
  let left = boxLeft + boxWidth + gap;
  if (left + PM_BUTTON > stageWidth) {
    side = "left";
    left = boxLeft - gap - PM_BUTTON;
  }
  left = clamp(left, 0, Math.max(0, stageWidth - PM_BUTTON));
  const top = clamp(boxTop + (boxHeight - columnHeight) / 2, 0, Math.max(0, stageHeight - columnHeight));
  return { left, top, side };
}

export function transformBounds(transform: AthleteTransform, clip: ClipSize): Bounds {
  const width = clip.width * transform.scale;
  const height = clip.height * transform.scale;
  return {
    left: transform.x - width / 2,
    top: transform.y - height / 2,
    width,
    height,
  };
}

export function hitTest(
  x: number,
  y: number,
  transform: AthleteTransform,
  clip: ClipSize,
): boolean {
  const bounds = transformBounds(transform, clip);
  return x >= bounds.left && y >= bounds.top && x <= bounds.left + bounds.width && y <= bounds.top + bounds.height;
}

/**
 * Stacked-alpha sampling with UNPACK_FLIP_Y_WEBGL.
 * uvY is 0 at the athlete's feet and 1 at the head.
 */
export function stackedSampleV(uvY: number): { colorV: number; alphaV: number } {
  return {
    colorV: 0.5 + uvY * 0.5,
    alphaV: uvY * 0.5,
  };
}
