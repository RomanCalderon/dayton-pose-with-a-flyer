import type { RosterFile } from "./types";

/** Files probed under the machine asset folder, in order. The bundled face is separate. */
export const VITESSE_FONT_FILES = [
  "fonts/Vitesse-Bold.woff2",
  "fonts/Vitesse-Bold.woff",
  "fonts/Vitesse-Bold.otf",
  "fonts/Vitesse-Bold.ttf",
] as const;

export type VitesseFontFile = (typeof VITESSE_FONT_FILES)[number];

/** Center of the placeholder figure on the 3840-wide stage. */
export const PLAYER_CENTER_X = 624.56;

export interface AttractStill {
  id: string;
  file: string;
}

interface StillSource {
  id: string;
  still?: string;
  headshot?: string;
}

/** Resting pose is centered on `PLAYER_CENTER_X` plus `offsetX`. The exit stays fully off the left. */
export function attractSlideTransform(phase: "in" | "out", offsetX = 0): string {
  const shift = Number.isFinite(offsetX) ? offsetX : 0;
  switch (phase) {
    case "in":
      return `translateX(calc(-50% + ${shift}px))`;
    case "out":
      return "translateX(calc(-100% - 625px))";
    default: {
      const neverPhase: never = phase;
      return neverPhase;
    }
  }
}

export function attractSlideTransition(phase: "in" | "out", outMs: number, inMs: number): string {
  switch (phase) {
    case "in":
      return `transform ${inMs}ms ease-out`;
    case "out":
      return `transform ${outMs}ms ease-in`;
    default: {
      const neverPhase: never = phase;
      return neverPhase;
    }
  }
}

function stillFile(person: StillSource): string {
  return (person.still ?? person.headshot ?? "").trim();
}

/** Men, women, then mascots. A repeated id (the mascot on both teams) is kept once. */
export function collectAttractStills(roster: RosterFile | null): AttractStill[] {
  if (!roster) return [];
  const people: StillSource[] = [
    ...roster.teams.mens,
    ...roster.teams.womens,
    ...(roster.mascots ?? []),
  ];
  const seen = new Set<string>();
  const stills: AttractStill[] = [];
  for (const person of people) {
    const file = stillFile(person);
    if (!file || seen.has(person.id)) continue;
    seen.add(person.id);
    stills.push({ id: person.id, file });
  }
  return stills;
}

export function shuffleAttractOrder(
  stills: readonly AttractStill[],
  random: () => number,
  avoidFirstId = "",
): AttractStill[] {
  const next = stills.slice();
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = next[i];
    next[i] = next[j];
    next[j] = swap;
  }
  if (avoidFirstId && next.length > 1 && next[0].id === avoidFirstId) {
    const swap = next[0];
    next[0] = next[1];
    next[1] = swap;
  }
  return next;
}

export function imageHasTransparency(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

function whiteDistance(r: number, g: number, b: number): number {
  return Math.max(255 - r, 255 - g, 255 - b);
}

/**
 * Removes near-white pixels connected to the image border, then feathers one
 * pixel of the fringe. Interior white (a jersey) stays. Callers skip this when
 * the file already has alpha or when keying is disabled.
 */
export function keyConnectedWhite(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = 28,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(source);
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return data;
  const count = width * height;
  const removed = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  const push = (index: number): void => {
    if (removed[index]) return;
    const offset = index * 4;
    if (data[offset + 3] === 0) return;
    if (whiteDistance(data[offset], data[offset + 1], data[offset + 2]) > tolerance) return;
    removed[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) push(index - 1);
    if (x + 1 < width) push(index + 1);
    if (y > 0) push(index - width);
    if (y + 1 < height) push(index + width);
  }
  const feather = 20;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    if (removed[index]) {
      data[offset + 3] = 0;
      continue;
    }
    const x = index % width;
    const y = (index - x) / width;
    const neighbor =
      (x > 0 && removed[index - 1] === 1)
      || (x + 1 < width && removed[index + 1] === 1)
      || (y > 0 && removed[index - width] === 1)
      || (y + 1 < height && removed[index + width] === 1);
    if (!neighbor) continue;
    const dist = whiteDistance(data[offset], data[offset + 1], data[offset + 2]);
    if (dist <= tolerance || dist > tolerance + feather) continue;
    data[offset + 3] = Math.round((255 * (dist - tolerance)) / feather);
  }
  return data;
}

/** Original blob when keying is off or the PNG already has alpha. */
export async function keyedStillUrl(blob: Blob, keyWhite: boolean): Promise<string> {
  if (!keyWhite || typeof document === "undefined" || typeof createImageBitmap !== "function") {
    return URL.createObjectURL(blob);
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return URL.createObjectURL(blob);
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (imageHasTransparency(image.data)) return URL.createObjectURL(blob);
    const keyed = keyConnectedWhite(image.data, canvas.width, canvas.height);
    image.data.set(keyed);
    ctx.putImageData(image, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) return URL.createObjectURL(blob);
    return URL.createObjectURL(png);
  } finally {
    bitmap.close();
  }
}

export function decodeImage(url: string): Promise<void> {
  const image = new Image();
  image.src = url;
  if (typeof image.decode === "function") return image.decode();
  return new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("image decode failed"));
  });
}
