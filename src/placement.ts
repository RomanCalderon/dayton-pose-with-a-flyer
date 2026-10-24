import type { AthleteTransform, Side } from "./types";

export interface ClipSize {
  width: number;
  height: number;
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
