import type { Session } from "./types";

export type AthleteSourceKind = "hidden" | "video" | "still" | "poster";

/**
 * Countdown may reveal a clip only after `playing` and a freshly presented frame.
 * `requestVideoFrameCallback` counts even when the first presented sample is still
 * at time 0. A later `currentTime` does too, for runtimes without that callback.
 */
export function playbackFrameReady(playing: boolean, frameCallback: boolean, currentTime: number): boolean {
  return playing && (frameCallback || currentTime > 0);
}

/**
 * Walk-in draws nothing until playback has presented a frame, including posters
 * and the PNG still. Adjust, preview, and the capture flash keep the held pose,
 * and a clip that never started still falls back to that still or poster there.
 */
export function athleteSourceKind(input: {
  screen: Session["screen"];
  presented: boolean;
  hasStill: boolean;
  videoReady: boolean;
  hasPoster: boolean;
}): AthleteSourceKind {
  switch (input.screen) {
    case "countdown":
      if (!input.presented) return "hidden";
      if (input.hasStill) return "still";
      if (input.videoReady) return "video";
      return "hidden";
    case "flash":
    case "adjust":
    case "preview":
      if (input.hasStill) return "still";
      if (input.videoReady) return "video";
      if (input.hasPoster) return "poster";
      return "hidden";
    case "attract":
    case "pick":
    case "thanks":
      return "hidden";
    default: {
      const neverScreen: never = input.screen;
      return neverScreen;
    }
  }
}
