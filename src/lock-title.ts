export const LOCK_WORDS = ["LOCK", "IN", "THAT", "POSE"] as const;
export const LOCK_FONT_SIZE = 569.92;
export const LOCK_LINE_HEIGHT = 587.02;
/** Quick fade as each word appears. */
export const LOCK_FADE_IN_MS = 60;

export interface LockTitleSettings {
  enabled: boolean;
  /** Solid fill. The fade is applied separately as element opacity. */
  color: string;
  /** Opacity while the block is still holding, before the fade. */
  opacity: number;
  /** POSE appears this fraction of the countdown after the first camera frame. */
  revealFraction: number;
  /** Block stays at full strength for this long after the first frame. */
  fadeDelayMs: number;
  /** Block then fades to 0 over this fraction of the countdown. */
  fadeDurationFraction: number;
}

export interface LockWordState {
  text: (typeof LOCK_WORDS)[number];
  /** 0 until the word's reveal time, then rises to 1 over the fade-in. */
  opacity: number;
  visible: boolean;
}

export interface LockTitleState {
  /** Fade curve. 1 until fadeDelayMs, then down to 0. */
  blockOpacity: number;
  /** blockOpacity times the configured starting opacity. Applied to the element. */
  fillOpacity: number;
  color: string;
  words: LockWordState[];
}

/**
 * Distance from the top of a line box to the cap top.
 * Used when `text-box-trim` is unavailable, so LOCK's caps still sit on y=0.
 */
export function lockCapTopOffset(metrics: {
  lineHeight: number;
  fontAscent: number;
  fontDescent: number;
  capAscent: number;
}): number {
  const content = metrics.fontAscent + metrics.fontDescent;
  const halfLeading = (metrics.lineHeight - content) / 2;
  return halfLeading + metrics.fontAscent - metrics.capAscent;
}

/**
 * Title state `elapsedMs` after the first live camera frame.
 * Word i appears at i * R / 3, where R is `revealFraction` of the countdown.
 * The block holds until `fadeDelayMs`, then fades over `fadeDurationFraction` of the countdown.
 */
export function lockTitleAt(
  elapsedMs: number,
  durationSeconds: number,
  title: LockTitleSettings,
  fadeInMs = LOCK_FADE_IN_MS,
): LockTitleState {
  const hidden = LOCK_WORDS.map((text) => ({ text, opacity: 0, visible: false }));
  const color = title.color || "#FFFFFF";
  const startOpacity = Number.isFinite(title.opacity) ? title.opacity : 1;
  if (!title.enabled || elapsedMs < 0 || !Number.isFinite(elapsedMs)) {
    return { blockOpacity: 0, fillOpacity: 0, color, words: hidden };
  }
  const durationMs = Math.max(0, durationSeconds) * 1000;
  const revealWindow = durationMs * title.revealFraction;
  const fadeDuration = durationMs * title.fadeDurationFraction;
  let blockOpacity = 1;
  if (elapsedMs > title.fadeDelayMs) {
    blockOpacity = fadeDuration <= 0 ? 0 : Math.max(0, 1 - (elapsedMs - title.fadeDelayMs) / fadeDuration);
  }
  const steps = LOCK_WORDS.length - 1;
  const words = LOCK_WORDS.map((text, index) => {
    const appearAt = steps === 0 ? 0 : (index * revealWindow) / steps;
    if (elapsedMs < appearAt) return { text, opacity: 0, visible: false };
    const opacity = fadeInMs <= 0 ? 1 : Math.min(1, (elapsedMs - appearAt) / fadeInMs);
    return { text, opacity, visible: opacity > 0 };
  });
  return { blockOpacity, fillOpacity: blockOpacity * startOpacity, color, words };
}
