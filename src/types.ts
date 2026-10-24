import type { ParticipantIdConfig } from "./participant";

export type StartMode = "qr" | "touch";
export type RosterId = "mens" | "womens";
export type Side = "left" | "right";
export type SingleSide = Side | "random";
export type CameraMatchBy = "serial" | "usbPort" | "label" | "deviceId";
export type OnMissing = "error" | "fallback";
export type Screen =
  | "attract"
  | "pick"
  | "countdown"
  | "flash"
  | "adjust"
  | "preview"
  | "thanks";

export interface CameraMatch {
  by: CameraMatchBy;
  serial: string;
  usbPort: string;
  label: string;
  deviceId: string;
}

export interface CameraRoleConfig {
  role: string;
  match: CameraMatch;
  width: number;
  height: number;
  fps: number;
  mirrorPreview?: boolean;
  scanIntervalMs?: number;
}

export interface AppConfig {
  start: { mode: StartMode };
  idle: {
    timeoutSeconds: number;
    previewTimeoutSeconds: number;
    thankYouAutoReturnSeconds: number;
    stillThereWarningSeconds: number;
  };
  roster: { default: RosterId; maxSelections: number };
  athletes: { singleSelectionSide: SingleSide };
  features: {
    multitouchAdjust: boolean;
    plusMinusButtons: boolean;
    rotateButton: boolean;
    debugOverlay: boolean;
  };
  uploader: {
    baseUrl: string;
    uploadPath: string;
    requestTimeoutMs: number;
    /** Multipart name of the JPEG part. The arena uploader expects `image`. */
    fileField: string;
    /** Sent as interactive_id. Empty omits the field. */
    interactiveId: string;
    /** When true, also send the old prototype fields. Default requests stay on the contract. */
    extraFields: boolean;
  };
  qr: {
    participantId: ParticipantIdConfig;
  };
  assets: {
    root: string;
    rosterFile: string;
    headshotsDir: string;
    athleteVideosDir: string;
    /** Full-screen plate for attract, pick, preview, and thank-you. */
    background: string;
    /** Optional attract-only loop above the plate. Empty plays nothing. */
    attractVideo: string;
    takeawayFrame: string;
    fireVideo: string;
  };
  cameras: {
    photo: CameraRoleConfig;
    qr: CameraRoleConfig;
    onMissing: OnMissing;
  };
  output: {
    width: number;
    height: number;
    format: string;
    quality: number;
  };
  timing: {
    countdownFrom: number;
    walkInStartsAt: number;
    freezeBeforeCaptureMs: number;
    flashMs: number;
  };
  render: { stageResolution: [number, number] };
  window: {
    fullscreen: boolean;
    width: number;
    height: number;
    alwaysOnTop: boolean;
  };
  debug: {
    simulateScanUrl: string;
    allowKeyboard: boolean;
    showHints: boolean;
  };
  attract: {
    rotation: {
      enabled: boolean;
      holdMs: number;
      outMs: number;
      inMs: number;
      /** Stage pixels added to the resting center. Slide-off stays fully left of the stage. */
      offsetX: number;
      /** When true, opaque stills lose border-connected white. Transparent PNGs are left alone. */
      keyWhite: boolean;
    };
  };
  /**
   * Pick-screen player grid. Columns come from the roster size:
   * clamp(max(minColumns, ceil((N - row3Max) / 2)), minColumns, maxColumns).
   * Rows 1 and 2 take that many. Row 3 takes the rest, at most row3Max.
   */
  pick: {
    grid: PickGridConfig;
    /** Crop of the tall still inside the circular player button. */
    headshot: PickHeadshotConfig;
    /** Extra inset of the curved name, in stage px, past the Figma arc. */
    nameInset: number;
  };
}

export interface PickHeadshotConfig {
  /** Multiplier on the scale that makes the image as wide as the photo window. */
  zoom: number;
  /** Horizontal nudge in photo-window px. Positive moves the image to the right. */
  offsetX: number;
  /**
   * How far down the image the crop starts.
   * A value from -1 to 1 is a fraction of the image height. Any other value is pixels.
   */
  offsetY: number;
}

export interface PickGridConfig {
  /** Button diameter in stage px. */
  button: number;
  /** Gap between buttons. Pitch is button + gap. */
  gap: number;
  origin: { x: number; y: number };
  minColumns: number;
  maxColumns: number;
  /** Buttons in the row that shares its band with the action panel. */
  row3Max: number;
  /** Rosters larger than this show the first this many and raise an error. */
  maxPlayers: number;
}

export interface ClipMeta {
  layout: "stacked-alpha" | "vp9-alpha";
  width: number;
  height: number;
  fps?: number;
  durationSeconds?: number;
}

export interface Athlete {
  id: string;
  firstName: string;
  lastName: string;
  jersey: number;
  team: RosterId;
  headshot: string;
  /** Full-body attract cutout. When omitted, the attract loop uses `headshot`. */
  still?: string;
  placeholder?: boolean;
  clips: {
    left: string;
    right: string;
    leftWebm?: string;
    rightWebm?: string;
  };
}

export interface RosterMascot {
  id: string;
  still?: string;
  headshot?: string;
}

export interface RosterFile {
  version: number;
  note?: string;
  /** Optional. Missing entries are measured from the file; .webm is treated as VP9-alpha. */
  clipMeta?: Record<string, ClipMeta>;
  teams: Record<RosterId, Athlete[]>;
  /** Attract-only figures that are not on a pick roster. */
  mascots?: RosterMascot[];
}

export interface AthleteTransform {
  /** Center X in output pixels. */
  x: number;
  /** Center Y in output pixels. */
  y: number;
  scale: number;
}

export interface Session {
  screen: Screen;
  /** Raw QR text. Kept for logs and the debug overlay. */
  participantUrl: string | null;
  /** Id extracted for the uploader. Null until a valid scan. */
  participantId: string | null;
  sessionId: string;
  roster: RosterId;
  selectedIds: string[];
  sides: Record<string, Side>;
  transforms: Record<string, AthleteTransform>;
  selectedAdjustId: string | null;
  /** Whole seconds remaining during countdown, otherwise null. */
  countdown: number | null;
}

export interface ListedCamera {
  label: string;
  serial: string;
  usbPort: string;
  symlink: string;
  vendorId: string;
  productId: string;
  infrared: boolean;
}

export interface CameraList {
  platform: string;
  implemented: boolean;
  cameras: ListedCamera[];
  note: string;
}

export interface MediaDeviceLike {
  deviceId: string;
  label: string;
  kind: string;
}

export interface UploadResult {
  ok: boolean;
  status: number;
  error?: string;
  /** First ~500 characters of the response body. */
  body?: string;
}
