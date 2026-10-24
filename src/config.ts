import type { AppConfig } from "./types";

export const DEFAULT_CONFIG: AppConfig = {
  start: { mode: "qr" },
  idle: {
    timeoutSeconds: 60,
    previewTimeoutSeconds: 90,
    thankYouAutoReturnSeconds: 8,
    stillThereWarningSeconds: 0,
  },
  roster: { default: "mens", maxSelections: 2 },
  athletes: { singleSelectionSide: "random" },
  features: {
    multitouchAdjust: true,
    // On for the desktop prototype so a mouse can resize. Venue configs can turn it off.
    plusMinusButtons: true,
    rotateButton: false,
    debugOverlay: false,
  },
  uploader: {
    baseUrl: "http://localhost:5001",
    uploadPath: "/upload",
    requestTimeoutMs: 8000,
    fileField: "image",
    interactiveId: "",
    extraFields: false,
  },
  qr: {
    participantId: {
      from: "auto",
      param: "participant_id",
      segment: -1,
      pattern: "",
    },
  },
  assets: {
    root: "",
    rosterFile: "roster.json",
    headshotsDir: "headshots",
    athleteVideosDir: "athletes",
    background: "branding/background.jpg",
    attractVideo: "",
    takeawayFrame: "frames/takeaway_v1.png",
    fireVideo: "fx/fire.mp4",
  },
  cameras: {
    photo: {
      role: "top-center user feed + photo",
      match: { by: "label", serial: "", usbPort: "", label: "", deviceId: "" },
      width: 1280,
      height: 720,
      fps: 30,
      mirrorPreview: true,
    },
    qr: {
      role: "side QR scanner",
      match: { by: "label", serial: "", usbPort: "", label: "", deviceId: "" },
      width: 1280,
      height: 720,
      fps: 30,
      scanIntervalMs: 150,
    },
    // Prototype default. A pinned kiosk should set this to "error".
    onMissing: "fallback",
  },
  output: {
    width: 2560,
    height: 1440,
    format: "image/jpeg",
    quality: 0.9,
  },
  timing: {
    countdownFrom: 10,
    walkInStartsAt: 6,
    freezeBeforeCaptureMs: 2000,
    flashMs: 300,
  },
  render: { stageResolution: [2560, 1440] },
  window: {
    fullscreen: false,
    width: 1600,
    height: 900,
    alwaysOnTop: false,
  },
  debug: {
    simulateScanUrl: "https://example.test/checkin?participant_id=1001",
    allowKeyboard: true,
    showHints: true,
  },
  attract: {
    rotation: {
      enabled: true,
      holdMs: 6000,
      outMs: 700,
      inMs: 900,
      offsetX: 100,
      keyWhite: false,
    },
  },
  pick: {
    grid: {
      button: 275.145,
      gap: 60,
      origin: { x: 130, y: 1009 },
      minColumns: 7,
      maxColumns: 11,
      row3Max: 5,
      maxPlayers: 27,
    },
    headshot: {
      zoom: 1.18,
      offsetX: 0,
      offsetY: 0,
    },
    nameInset: 12,
  },
};

/** Strip // and block comments without touching strings. */
export function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (inString) {
      out += c;
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && input[i + 1] === "/") {
      i += 1;
      while (i + 1 < input.length && input[i + 1] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeValue(base: unknown, patch: unknown): unknown {
  if (Array.isArray(base)) {
    return Array.isArray(patch) ? patch : base;
  }
  if (isRecord(base) && isRecord(patch)) {
    const next: Record<string, unknown> = { ...base };
    for (const key of Object.keys(patch)) {
      next[key] = key in base ? mergeValue(base[key], patch[key]) : patch[key];
    }
    return next;
  }
  return patch === undefined ? base : patch;
}

export function parseConfig(text: string): AppConfig {
  const parsed: unknown = JSON.parse(stripJsonComments(text));
  if (!isRecord(parsed)) {
    throw new Error("kiosk config must be a JSON object");
  }
  return mergeValue(DEFAULT_CONFIG, parsed) as AppConfig;
}

export function mergeConfig(patch: unknown): AppConfig {
  if (!isRecord(patch)) return structuredClone(DEFAULT_CONFIG);
  return mergeValue(DEFAULT_CONFIG, patch) as AppConfig;
}
