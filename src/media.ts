/** A fetch that returns the whole file. Used so playback does not depend on HTTP range requests. */
export interface AssetResponse {
  ok: boolean;
  status: number;
  blob: () => Promise<Blob>;
}

export type AssetFetch = (url: string, init: { signal: AbortSignal }) => Promise<AssetResponse>;

export async function fetchAssetBlob(url: string, timeoutMs: number, fetchImpl?: AssetFetch): Promise<Blob> {
  const impl: AssetFetch = fetchImpl ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await impl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`asset fetch ${response.status} ${url}`);
    const blob = await response.blob();
    if (blob.size === 0) throw new Error(`asset fetch empty ${url}`);
    return blob;
  } finally {
    clearTimeout(timer);
  }
}

/** Seek only when the element actually has a range. Asset-protocol URLs often report an empty seekable range. */
export function mediaIsSeekable(seekableLength: number, seekableEnd: number): boolean {
  return seekableLength > 0 && seekableEnd > 0.1;
}

export function isImagePath(relative: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(relative);
}

/**
 * A no-cors image from another origin (http://asset.localhost, or any other host)
 * displays in an <img> and then taints WebGL and canvas. blob:, data:, and the
 * page's own origin do not.
 */
export function urlIsCanvasSafe(src: string, pageHref = typeof location === "undefined" ? "http://localhost/" : location.href): boolean {
  if (!src) return false;
  try {
    const url = new URL(src, pageHref);
    if (url.protocol === "blob:" || url.protocol === "data:") return true;
    const page = new URL(pageHref);
    return url.origin === page.origin;
  } catch {
    return false;
  }
}

export function sourceIsCanvasSafe(source: CanvasImageSource): boolean {
  if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
    return urlIsCanvasSafe(source.currentSrc || source.src);
  }
  if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
    if (source.srcObject) return true;
    const src = source.currentSrc || source.src;
    if (!src) return false;
    return urlIsCanvasSafe(src);
  }
  return true;
}
