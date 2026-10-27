import type {
  AthleteTransform,
  RosterId,
  Screen,
  Session,
  Side,
  SingleSide,
} from "./types";

export type SessionEvent =
  | { type: "scan"; url: string; participantId: string; sessionId: string }
  | { type: "touchStart"; sessionId: string }
  | { type: "toggleRoster" }
  | { type: "toggleAthlete"; id: string; max: number }
  | { type: "goBack" }
  | {
      type: "letsGo";
      sides: Record<string, Side>;
      transforms: Record<string, AthleteTransform>;
      countdownFrom: number;
    }
  | { type: "countdown"; seconds: number }
  | { type: "flash" }
  | { type: "flashDone" }
  | { type: "selectAdjust"; id: string }
  | { type: "clearAdjust" }
  | { type: "setTransform"; id: string; transform: AthleteTransform }
  | { type: "tryAgain"; countdownFrom: number; transforms: Record<string, AthleteTransform> }
  | { type: "allDone" }
  | { type: "send" }
  | { type: "startOver"; roster: RosterId }
  | { type: "idle"; roster: RosterId }
  | { type: "thanksDone"; roster: RosterId };

export function createSession(roster: RosterId, sessionId = ""): Session {
  return {
    screen: "attract",
    participantUrl: null,
    participantId: null,
    sessionId,
    roster,
    selectedIds: [],
    sides: {},
    transforms: {},
    selectedAdjustId: null,
    countdown: null,
  };
}

export function chooseSides(
  ids: string[],
  mode: SingleSide,
  rng: () => number,
): Record<string, Side> {
  if (ids.length <= 0) return {};
  if (ids.length === 1) {
    const side: Side = mode === "random" ? (rng() < 0.5 ? "left" : "right") : mode;
    return { [ids[0]]: side };
  }
  return { [ids[0]]: "left", [ids[1]]: "right" };
}

function cleared(roster: RosterId): Session {
  return createSession(roster);
}

export function reduceSession(session: Session, event: SessionEvent): Session {
  switch (event.type) {
    case "scan": {
      if (session.screen !== "attract") return session;
      const participantId = event.participantId.trim();
      if (!participantId) return session;
      return {
        ...createSession(session.roster, event.sessionId),
        screen: "pick",
        participantUrl: event.url,
        participantId,
      };
    }
    case "touchStart": {
      if (session.screen !== "attract") return session;
      return {
        ...createSession(session.roster, event.sessionId),
        screen: "pick",
        participantUrl: null,
      };
    }
    case "toggleRoster": {
      if (session.screen !== "pick") return session;
      const roster: RosterId = session.roster === "mens" ? "womens" : "mens";
      return { ...session, roster, selectedIds: [] };
    }
    case "toggleAthlete": {
      if (session.screen !== "pick") return session;
      const selected = session.selectedIds.includes(event.id);
      if (selected) {
        return {
          ...session,
          selectedIds: session.selectedIds.filter((id) => id !== event.id),
        };
      }
      if (session.selectedIds.length >= event.max) return session;
      return { ...session, selectedIds: [...session.selectedIds, event.id] };
    }
    case "goBack": {
      if (session.screen === "pick" || session.screen === "countdown") {
        return cleared(session.roster);
      }
      return session;
    }
    case "letsGo": {
      if (session.screen !== "pick" || session.selectedIds.length === 0) return session;
      const first = session.selectedIds[0];
      return {
        ...session,
        screen: "countdown",
        sides: event.sides,
        transforms: event.transforms,
        selectedAdjustId: first,
        countdown: event.countdownFrom,
      };
    }
    case "countdown": {
      if (session.screen !== "countdown" && session.screen !== "flash") return session;
      return { ...session, screen: "countdown", countdown: event.seconds };
    }
    case "flash": {
      if (session.screen !== "countdown") return session;
      return { ...session, screen: "flash", countdown: 0 };
    }
    case "flashDone": {
      if (session.screen !== "flash") return session;
      return { ...session, screen: "adjust", countdown: null };
    }
    case "selectAdjust": {
      if (session.screen !== "adjust") return session;
      if (!session.selectedIds.includes(event.id)) return session;
      return { ...session, selectedAdjustId: event.id };
    }
    case "clearAdjust": {
      if (session.screen !== "adjust" || session.selectedAdjustId === null) return session;
      return { ...session, selectedAdjustId: null };
    }
    case "setTransform": {
      if (session.screen !== "adjust") return session;
      return {
        ...session,
        transforms: { ...session.transforms, [event.id]: event.transform },
      };
    }
    case "tryAgain": {
      if (session.screen !== "adjust" && session.screen !== "preview") return session;
      return {
        ...session,
        screen: "countdown",
        countdown: event.countdownFrom,
        transforms: event.transforms,
      };
    }
    case "allDone": {
      if (session.screen !== "adjust") return session;
      return { ...session, screen: "preview", countdown: null };
    }
    case "send": {
      if (session.screen !== "preview") return session;
      return { ...session, screen: "thanks" };
    }
    case "startOver":
    case "idle":
      return cleared(event.roster);
    case "thanksDone": {
      if (session.screen !== "thanks") return session;
      return cleared(event.roster);
    }
    default: {
      const neverEvent: never = event;
      return neverEvent;
    }
  }
}

/** Output px. A clean tap can jitter this far without becoming a drag. */
export const TAP_MOVE_PX = 8;

export function tapMoved(dx: number, dy: number, slop = TAP_MOVE_PX): boolean {
  return dx * dx + dy * dy > slop * slop;
}

/**
 * Pointer-up on the adjust screen. A clean tap that started on empty space
 * deselects. Chrome, visible artwork, drags, pinches, and resizes keep the selection.
 */
export function adjustTapAction(input: {
  onPlayer: boolean;
  onChrome: boolean;
  moved: boolean;
  pinched: boolean;
}): "deselect" | "keep" {
  if (input.onChrome || input.onPlayer || input.moved || input.pinched) return "keep";
  return "deselect";
}

export function screenAllowsIdle(screen: Screen): boolean {
  return screen === "pick" || screen === "adjust" || screen === "preview";
}
