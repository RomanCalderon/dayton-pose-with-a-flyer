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
/** Space between the player box and the button column. */
export const PM_EDGE_GAP = 24;

export interface PlusMinusPlacement {
  left: number;
  top: number;
  side: "right" | "left";
}

/**
 * Stage position for the +/− stack: vertically centred on the player, just
 * outside the right edge. Flips to the left when the right side would leave
 * the stage, then clamps the column inside the stage.
 */
export function plusMinusPosition(
  bounds: Bounds,
  outputWidth: number,
  outputHeight: number,
  stageWidth: number,
  stageHeight: number,
): PlusMinusPlacement {
  const sx = outputWidth > 0 ? stageWidth / outputWidth : 1;
  const sy = outputHeight > 0 ? stageHeight / outputHeight : 1;
  const boxLeft = bounds.left * sx;
  const boxTop = bounds.top * sy;
  const boxWidth = bounds.width * sx;
  const boxHeight = bounds.height * sy;
  const columnHeight = PM_BUTTON * 2 + PM_STACK_GAP;
  let side: PlusMinusPlacement["side"] = "right";
  let left = boxLeft + boxWidth + PM_EDGE_GAP;
  if (left + PM_BUTTON > stageWidth) {
    side = "left";
    left = boxLeft - PM_EDGE_GAP - PM_BUTTON;
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
