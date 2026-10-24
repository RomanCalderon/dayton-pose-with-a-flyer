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
