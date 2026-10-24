import type { RosterId, UploadResult } from "./types";

export interface UploadInput {
  participantId: string;
  interactiveId: string;
  extraFields: boolean;
  participantUrl: string;
  sessionId: string;
  capturedAt: string;
  athletes: string[];
  roster: RosterId;
}

/** `photo_<sessionId>.jpg`, with the id reduced to a safe filename token. */
export function uploadFilename(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]+/g, "").slice(0, 80);
  return `photo_${safe || "session"}.jpg`;
}

/**
 * Default body is `participant_id` plus `interactive_id` when that config is non-empty.
 * `extraFields` puts the old prototype fields back on the same request.
 */
export function uploadFields(input: UploadInput): Record<string, string> {
  const fields: Record<string, string> = {
    participant_id: input.participantId,
  };
  const interactive = input.interactiveId.trim();
  if (interactive) fields.interactive_id = interactive;
  if (input.extraFields) {
    fields.participantUrl = input.participantUrl;
    fields.sessionId = input.sessionId;
    fields.capturedAt = input.capturedAt;
    fields.athletes = JSON.stringify(input.athletes);
    fields.roster = input.roster;
  }
  return fields;
}

export function buildUploadForm(image: Blob, filename: string, fields: Record<string, string>): FormData {
  const form = new FormData();
  form.append("file", image, filename);
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

export function responseSnippet(body: string): string {
  return body.replace(/[\r\n]+/g, " ").trim().slice(0, 500);
}

export async function postPhoto(
  endpoint: string,
  image: Blob,
  filename: string,
  fields: Record<string, string>,
  timeoutMs: number,
): Promise<UploadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      body: buildUploadForm(image, filename, fields),
      signal: controller.signal,
    });
    const body = responseSnippet(await response.text());
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}`, body };
    }
    return { ok: true, status: response.status, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, error: message };
  } finally {
    clearTimeout(timer);
  }
}
