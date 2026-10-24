import type { UploadMeta, UploadResult } from "./types";

export const UPLOAD_FILENAME = "photo_2560x1440.jpg";

/** Field contract for the local uploader. `athletes` is a JSON array string. */
export function uploadFields(meta: UploadMeta): Record<string, string> {
  return {
    participantUrl: meta.participantUrl,
    sessionId: meta.sessionId,
    capturedAt: meta.capturedAt,
    athletes: JSON.stringify(meta.athletes),
    roster: meta.roster,
  };
}

export function buildUploadForm(image: Blob, meta: UploadMeta): FormData {
  const form = new FormData();
  form.append("image", image, UPLOAD_FILENAME);
  const fields = uploadFields(meta);
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  return form;
}

export function uploadEndpoint(baseUrl: string, uploadPath: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = uploadPath.startsWith("/") ? uploadPath : `/${uploadPath}`;
  return `${base}${path}`;
}

export async function postPhoto(
  endpoint: string,
  image: Blob,
  meta: UploadMeta,
  timeoutMs: number,
): Promise<UploadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      body: buildUploadForm(image, meta),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, error: message };
  } finally {
    clearTimeout(timer);
  }
}
