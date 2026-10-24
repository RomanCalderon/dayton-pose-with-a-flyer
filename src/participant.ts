export type ParticipantIdFrom = "auto" | "raw" | "query" | "pathSegment" | "regex";

export interface ParticipantIdConfig {
  from: ParticipantIdFrom;
  /** Query parameter used by `query`, and tried first by `auto`. */
  param: string;
  /** Path segment. Negative indexes count from the end, so -1 is the last segment. */
  segment: number;
  /** Regular expression for `regex`. The first capture group wins, otherwise the whole match. */
  pattern: string;
}

const AUTO_PARAMS = ["participant_id", "participantId", "pid", "id"];

export function extractParticipantId(raw: string, config: ParticipantIdConfig): string | null {
  const text = raw.trim();
  if (!text) return null;
  switch (config.from) {
    case "raw":
      return text;
    case "query":
      return queryValue(text, [config.param]);
    case "pathSegment":
      return pathValue(text, config.segment);
    case "regex":
      return regexValue(text, config.pattern);
    case "auto":
      return autoValue(text, config.param);
    default: {
      const neverFrom: never = config.from;
      return neverFrom;
    }
  }
}

function autoValue(text: string, preferredParam: string): string | null {
  if (!looksLikeUrl(text)) return text;
  const fromQuery = queryValue(text, [preferredParam, ...AUTO_PARAMS]);
  if (fromQuery) return fromQuery;
  return pathValue(text, -1);
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function parsedUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function queryValue(value: string, names: string[]): string | null {
  const url = parsedUrl(value);
  if (!url) return null;
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const found = url.searchParams.get(key)?.trim();
    if (found) return found;
  }
  return null;
}

function pathValue(value: string, segment: number): string | null {
  const url = parsedUrl(value);
  const path = url ? url.pathname : value;
  const parts = path.split("/").flatMap((part) => {
    if (!part) return [];
    try {
      const decoded = decodeURIComponent(part).trim();
      return decoded ? [decoded] : [];
    } catch {
      const trimmed = part.trim();
      return trimmed ? [trimmed] : [];
    }
  });
  if (parts.length === 0 || !Number.isFinite(segment)) return null;
  const index = segment < 0 ? parts.length + segment : segment;
  if (index < 0 || index >= parts.length) return null;
  return parts[index] ?? null;
}

function regexValue(value: string, pattern: string): string | null {
  const source = pattern.trim();
  if (!source) return null;
  let expression: RegExp;
  try {
    expression = new RegExp(source);
  } catch {
    return null;
  }
  const match = expression.exec(value);
  if (!match) return null;
  const captured = (match[1] ?? match[0]).trim();
  return captured || null;
}
