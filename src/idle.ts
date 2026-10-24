import type { AppConfig, Screen } from "./types";
import { screenAllowsIdle } from "./session";

export function idleTimeoutMs(screen: Screen, config: AppConfig): number | null {
  if (!screenAllowsIdle(screen)) return null;
  const seconds =
    screen === "adjust" || screen === "preview"
      ? config.idle.previewTimeoutSeconds
      : config.idle.timeoutSeconds;
  if (seconds <= 0) return null;
  return seconds * 1000;
}

export function thanksTimeoutMs(config: AppConfig): number {
  return Math.max(0, config.idle.thankYouAutoReturnSeconds) * 1000;
}

export function stillThereMs(screen: Screen, config: AppConfig): number | null {
  const total = idleTimeoutMs(screen, config);
  const warning = config.idle.stillThereWarningSeconds;
  if (total === null || warning <= 0) return null;
  const at = total - warning * 1000;
  return at > 0 ? at : 0;
}
