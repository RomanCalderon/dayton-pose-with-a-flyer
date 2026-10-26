import { describe, expect, it } from "vitest";
import { matchCamera, pinConfigured, isHttpUrl } from "./cameras";
import { parseConfig, stripJsonComments } from "./config";
import { idleTimeoutMs, stillThereMs, thanksTimeoutMs } from "./idle";
import {
  clampTransform,
  defaultTransform,
  hitTest,
  measuredColorSize,
  resolveClipLayout,
  resolveClipSize,
  stackedSampleV,
  transformForMeasuredSize,
} from "./placement";
import { urlIsCanvasSafe } from "./media";
import { athleteSourceKind, playbackFrameReady } from "./playback";
import { chooseSides, createSession, reduceSession } from "./session";
import type { AppConfig, Athlete, RosterFile, Screen } from "./types";
import { extractParticipantId, type ParticipantIdConfig } from "./participant";
import { buildUploadForm, jpegFieldName, uploadEndpoint, uploadFields, uploadFilename } from "./upload";
import { GUEST_PLACEHOLDER_FILE, guestStandInLayer } from "./compositor";
import { assetMissingMessage, assetServedMessage, referencedAssetPaths } from "./platform";
import {
  attractVideoSource,
  backgroundObjectPosition,
  escapeHtml,
  headshotSlots,
  logicalWindowSize,
  PHOTO_RECT,
  previewFit,
  readPhysicalSize,
  renderChrome,
  renderDebug,
  STAGE_H,
  STAGE_W,
  stageScale,
  stageTransform,
  type ViewModel,
} from "./ui";

const base = parseConfig("{}");

describe("config", () => {
  it("strips comments outside strings", () => {
    const text = `{
      // mode
      "start": { "mode": "touch" }, /* block */
      "note": "keep // this"
    }`;
    const config = parseConfig(text);
    expect(config.start.mode).toBe("touch");
    expect(stripJsonComments(text)).toContain("keep // this");
  });

  it("fills defaults for a partial file", () => {
    const config = parseConfig(`{ "idle": { "timeoutSeconds": 15 } }`);
    expect(config.idle.timeoutSeconds).toBe(15);
    expect(config.idle.previewTimeoutSeconds).toBe(90);
    expect(config.output.width).toBe(2560);
    expect(config.output.quality).toBe(0.9);
  });
});

describe("session", () => {
  it("walks the approved flow and clears on idle", () => {
    let session = createSession("mens");
    session = reduceSession(session, {
      type: "scan",
      url: "https://example.test/participants/1",
      participantId: "1",
      sessionId: "abc",
    });
    expect(session.screen).toBe("pick");
    expect(session.participantUrl).toContain("participants/1");
    expect(session.participantId).toBe("1");
    session = reduceSession(session, { type: "toggleAthlete", id: "m01", max: 2 });
    session = reduceSession(session, { type: "toggleAthlete", id: "m02", max: 2 });
    session = reduceSession(session, { type: "toggleAthlete", id: "m03", max: 2 });
    expect(session.selectedIds).toEqual(["m01", "m02"]);
    session = reduceSession(session, { type: "toggleAthlete", id: "m01", max: 2 });
    expect(session.selectedIds).toEqual(["m02"]);
    session = reduceSession(session, { type: "toggleRoster" });
    expect(session.roster).toBe("womens");
    expect(session.selectedIds).toEqual([]);
    session = reduceSession(session, { type: "toggleAthlete", id: "w01", max: 2 });
    const sides = chooseSides(session.selectedIds, "left", () => 0);
    session = reduceSession(session, {
      type: "letsGo",
      sides,
      transforms: { w01: { x: 1, y: 2, scale: 1 } },
      countdownFrom: 10,
    });
    expect(session.screen).toBe("countdown");
    expect(session.sides.w01).toBe("left");
    session = reduceSession(session, { type: "flash" });
    session = reduceSession(session, { type: "flashDone" });
    expect(session.screen).toBe("adjust");
    session = reduceSession(session, { type: "allDone" });
    session = reduceSession(session, { type: "send" });
    expect(session.screen).toBe("thanks");
    session = reduceSession(session, { type: "idle", roster: "mens" });
    expect(session.screen).toBe("attract");
    expect(session.participantUrl).toBeNull();
    expect(session.participantId).toBeNull();
    expect(session.roster).toBe("mens");
  });

  it("puts one athlete on a random side and two on opposite sides", () => {
    expect(chooseSides(["a"], "random", () => 0.1).a).toBe("left");
    expect(chooseSides(["a"], "random", () => 0.9).a).toBe("right");
    expect(chooseSides(["a"], "right", () => 0).a).toBe("right");
    expect(chooseSides(["a", "b"], "left", () => 0)).toEqual({ a: "left", b: "right" });
  });

  it("does not start without a selection and ignores scans off the attract screen", () => {
    let session = createSession("mens");
    session = reduceSession(session, {
      type: "letsGo",
      sides: {},
      transforms: {},
      countdownFrom: 10,
    });
    expect(session.screen).toBe("attract");
    session = reduceSession(session, { type: "touchStart", sessionId: "t" });
    session = reduceSession(session, {
      type: "scan",
      url: "https://example.test/x",
      participantId: "x",
      sessionId: "nope",
    });
    expect(session.participantUrl).toBeNull();
    expect(session.screen).toBe("pick");
    const rejected = reduceSession(createSession("mens"), {
      type: "scan",
      url: "https://example.test/",
      participantId: "  ",
      sessionId: "no",
    });
    expect(rejected.screen).toBe("attract");
    expect(rejected.participantId).toBeNull();
  });
});

describe("idle", () => {
  it("uses the longer window on adjust and preview and skips the countdown", () => {
    expect(idleTimeoutMs("pick", base)).toBe(60_000);
    expect(idleTimeoutMs("adjust", base)).toBe(90_000);
    expect(idleTimeoutMs("preview", base)).toBe(90_000);
    expect(idleTimeoutMs("countdown", base)).toBeNull();
    expect(idleTimeoutMs("attract", base)).toBeNull();
    expect(thanksTimeoutMs(base)).toBe(8_000);
    expect(stillThereMs("pick", base)).toBeNull();
    const warned = parseConfig(`{ "idle": { "stillThereWarningSeconds": 10 } }`);
    expect(stillThereMs("pick", warned)).toBe(50_000);
  });
});

describe("cameras", () => {
  const devices = [
    { deviceId: "photo", label: "Kiosk Brio Photo", kind: "videoinput" },
    { deviceId: "qr", label: "Kiosk Brio QR", kind: "videoinput" },
    { deviceId: "mic", label: "Mic", kind: "audioinput" },
  ];

  it("matches friendly names and falls back when nothing is pinned", () => {
    const pinned = matchCamera({
      devices,
      listed: [],
      role: {
        ...base.cameras.photo,
        match: { ...base.cameras.photo.match, by: "label", label: "Kiosk Brio Photo" },
      },
      onMissing: "error",
      usedIds: new Set(),
      errorCode: "CAM-PHOTO-01",
    });
    expect(pinned.deviceId).toBe("photo");
    const loose = matchCamera({
      devices: [{ deviceId: "only", label: "Integrated Camera", kind: "videoinput" }],
      listed: [],
      role: base.cameras.photo,
      onMissing: "fallback",
      usedIds: new Set(),
      errorCode: "CAM-PHOTO-01",
    });
    expect(loose.deviceId).toBe("only");
    expect(loose.error).toBeNull();
  });

  it("does not guess when a pinned serial is missing and onMissing is error", () => {
    const missing = matchCamera({
      devices,
      listed: [{ label: "Other", serial: "999", usbPort: "", symlink: "", vendorId: "", productId: "", infrared: false }],
      role: {
        ...base.cameras.qr,
        match: { ...base.cameras.qr.match, by: "serial", serial: "29317058" },
      },
      onMissing: "error",
      usedIds: new Set(["photo"]),
      errorCode: "CAM-QR-01",
    });
    expect(missing.deviceId).toBeNull();
    expect(missing.error).toContain("CAM-QR-01");
    expect(pinConfigured(base.cameras.photo.match)).toBe(false);
    expect(isHttpUrl("https://qrco.de/FLYERPOSE")).toBe(true);
    expect(isHttpUrl("not a url")).toBe(false);
  });

  it("maps a pinned serial through the friendly name Rust reports", () => {
    const pick = matchCamera({
      devices,
      listed: [{
        label: "Kiosk Brio QR",
        serial: "29317058",
        usbPort: "PCIROOT(0)#USB(3)",
        symlink: "\\\\?\\usb#vid_046d",
        vendorId: "046D",
        productId: "085E",
        infrared: false,
      }],
      role: {
        ...base.cameras.qr,
        match: { ...base.cameras.qr.match, by: "serial", serial: "29317058" },
      },
      onMissing: "error",
      usedIds: new Set(),
      errorCode: "CAM-QR-01",
    });
    expect(pick.deviceId).toBe("qr");
  });
});

describe("placement and upload", () => {
  it("stands a single crop on the requested edge", () => {
    const left = defaultTransform("left", 2560, 1440, { width: 360, height: 640 });
    const right = defaultTransform("right", 2560, 1440, { width: 360, height: 640 });
    expect(left.x).toBeLessThan(2560 / 2);
    expect(right.x).toBeGreaterThan(2560 / 2);
    expect(hitTest(left.x, left.y, left, { width: 360, height: 640 })).toBe(true);
    const clamped = clampTransform({ x: 99999, y: -99999, scale: 9 }, 2560, 1440);
    expect(clamped.scale).toBeLessThanOrEqual(2.8);
    expect(clamped.x).toBeLessThanOrEqual(2560 * 1.2);
  });

  it("sizes a real VP9 frame when clipMeta is omitted", () => {
    expect(resolveClipLayout("WEBM/Men/M-0-L.webm", undefined)).toBe("vp9-alpha");
    expect(resolveClipLayout("athletes/left_dribble.mp4", undefined)).toBe("stacked-alpha");
    expect(resolveClipLayout("athletes/left_dribble.webm", "stacked-alpha")).toBe("stacked-alpha");
    expect(resolveClipSize(undefined, undefined)).toEqual({ width: 0, height: 0 });
    expect(resolveClipSize({ width: 1440, height: 2160 }, { width: 10, height: 10 })).toEqual({
      width: 1440,
      height: 2160,
    });
    expect(measuredColorSize("vp9-alpha", 1440, 2160)).toEqual({ width: 1440, height: 2160 });
    expect(measuredColorSize("stacked-alpha", 360, 1280)).toEqual({ width: 360, height: 640 });
    const fitted = defaultTransform("left", 2560, 1440, { width: 1440, height: 2160 });
    expect(fitted.scale * 2160).toBeCloseTo(1440 * 0.92);
    expect(fitted.x).toBeLessThan(2560 / 2);
    const guessed = defaultTransform("right", 2560, 1440, { width: 360, height: 640 });
    const corrected = transformForMeasuredSize(
      "right",
      2560,
      1440,
      { width: 0, height: 0 },
      { width: 1440, height: 2160 },
      guessed,
    );
    expect(corrected.scale * 2160).toBeCloseTo(1440 * 0.92);
    expect(corrected.x).toBeGreaterThan(2560 / 2);
  });

  it("treats asset.localhost images as unsafe for WebGL", () => {
    const page = "http://tauri.localhost/";
    expect(urlIsCanvasSafe("http://asset.localhost/assets/frames/takeaway_v1.png", page)).toBe(false);
    expect(urlIsCanvasSafe("blob:http://tauri.localhost/8d0c2c9a-1", page)).toBe(true);
    expect(urlIsCanvasSafe("http://tauri.localhost/kiosk-assets/frames/takeaway_v1.png", page)).toBe(true);
  });

  it("samples stacked alpha with the head at the top of the frame", () => {
    expect(stackedSampleV(1)).toEqual({ colorV: 1, alphaV: 0.5 });
    expect(stackedSampleV(0)).toEqual({ colorV: 0.5, alphaV: 0 });
  });

  it("builds the uploader contract", () => {
    expect(uploadEndpoint("http://localhost:5001/", "upload")).toBe("http://localhost:5001/upload");
    const input = {
      participantId: "1001",
      interactiveId: "",
      extraFields: false,
      participantUrl: "https://example.test/checkin?participant_id=1001",
      sessionId: "abc",
      capturedAt: "2026-10-24T12:00:00.000Z",
      athletes: ["m01", "m02"],
      roster: "mens" as const,
    };
    expect(uploadFields(input)).toEqual({ participant_id: "1001" });
    expect(uploadFields({ ...input, interactiveId: "  booth-a  " })).toEqual({
      participant_id: "1001",
      interactive_id: "booth-a",
    });
    expect(uploadFields({ ...input, extraFields: true })).toEqual({
      participant_id: "1001",
      participantUrl: "https://example.test/checkin?participant_id=1001",
      sessionId: "abc",
      capturedAt: "2026-10-24T12:00:00.000Z",
      athletes: '["m01","m02"]',
      roster: "mens",
    });
    expect(uploadFilename("abc")).toBe("photo_abc.jpg");
    expect(uploadFilename("a/b c")).toBe("photo_abc.jpg");
    expect(jpegFieldName("image")).toBe("image");
    expect(jpegFieldName("bad name")).toBe("image");
    expect(jpegFieldName("")).toBe("image");
    const image = new Blob([Uint8Array.from([1, 2, 3])], { type: "image/jpeg" });
    const form = buildUploadForm(image, "photo_abc.jpg", { participant_id: "1001", "bad name": "nope" }, "image");
    expect(form.get("file")).toBeNull();
    expect(form.get("bad name")).toBeNull();
    expect(form.get("participant_id")).toBe("1001");
    const part = form.get("image");
    expect(part).toBeInstanceOf(File);
    expect(part instanceof File ? part.name : "").toBe("photo_abc.jpg");
  });

  it("extracts a participant id from the configured QR shape", () => {
    const auto: ParticipantIdConfig = { from: "auto", param: "participant_id", segment: -1, pattern: "" };
    expect(extractParticipantId("1001", auto)).toBe("1001");
    expect(extractParticipantId("  demo-001  ", auto)).toBe("demo-001");
    expect(extractParticipantId("https://example.test/checkin?participant_id=1001", auto)).toBe("1001");
    expect(extractParticipantId("https://example.test/checkin?participantId=77&id=9", auto)).toBe("77");
    expect(extractParticipantId("https://example.test/p?pid=4", auto)).toBe("4");
    expect(extractParticipantId("https://example.test/p?id=9", auto)).toBe("9");
    expect(extractParticipantId("https://example.test/participants/demo-001/", auto)).toBe("demo-001");
    expect(extractParticipantId("https://example.test/", auto)).toBeNull();
    expect(extractParticipantId("   ", auto)).toBeNull();
    expect(extractParticipantId("https://example.test/p?code=55", { ...auto, param: "code" })).toBe("55");
    expect(extractParticipantId("https://example.test/p?id=9", { ...auto, from: "query", param: "id" })).toBe("9");
    expect(extractParticipantId("https://example.test/p?id=9", { ...auto, from: "query", param: "missing" })).toBeNull();
    expect(extractParticipantId("https://example.test/a/b/c", { ...auto, from: "pathSegment", segment: -2 })).toBe("b");
    expect(extractParticipantId("https://example.test/a/b/c", { ...auto, from: "pathSegment", segment: 0 })).toBe("a");
    expect(extractParticipantId("card PID-44", { ...auto, from: "regex", pattern: "PID-(\\d+)" })).toBe("44");
    expect(extractParticipantId("https://example.test/p?id=9", { ...auto, from: "raw" })).toBe("https://example.test/p?id=9");
    expect(extractParticipantId("card", { ...auto, from: "regex", pattern: "[" })).toBeNull();
  });

  it("hides a countdown athlete until playback presents a frame", () => {
    expect(playbackFrameReady(false, true, 1)).toBe(false);
    expect(playbackFrameReady(true, false, 0)).toBe(false);
    expect(playbackFrameReady(true, true, 0)).toBe(true);
    expect(playbackFrameReady(true, false, 0.04)).toBe(true);
    const waiting = {
      screen: "countdown" as const,
      presented: false,
      hasStill: true,
      videoReady: true,
      hasPoster: true,
    };
    expect(athleteSourceKind(waiting)).toBe("hidden");
    expect(athleteSourceKind({ ...waiting, presented: true })).toBe("still");
    expect(athleteSourceKind({ ...waiting, presented: true, hasStill: false })).toBe("video");
    expect(athleteSourceKind({ ...waiting, presented: true, hasStill: false, videoReady: false })).toBe("hidden");
    expect(athleteSourceKind({ ...waiting, screen: "adjust" })).toBe("still");
    expect(athleteSourceKind({ ...waiting, screen: "preview", hasStill: false })).toBe("video");
    expect(athleteSourceKind({ ...waiting, screen: "flash", hasStill: false, videoReady: false })).toBe("poster");
    expect(athleteSourceKind({ ...waiting, screen: "attract" })).toBe("hidden");
  });

  it("fits the whole 16:9 capture inside the preview well", () => {
    const fit = previewFit(STAGE_W, STAGE_H, PHOTO_RECT);
    const drawnW = STAGE_W * fit.scale;
    const drawnH = STAGE_H * fit.scale;
    expect(fit.left).toBeGreaterThanOrEqual(PHOTO_RECT.x);
    expect(fit.top).toBeGreaterThanOrEqual(PHOTO_RECT.y);
    expect(fit.left + drawnW).toBeLessThanOrEqual(PHOTO_RECT.x + PHOTO_RECT.w + 0.01);
    expect(fit.top + drawnH).toBeLessThanOrEqual(PHOTO_RECT.y + PHOTO_RECT.h + 0.01);
    expect(Math.min(PHOTO_RECT.w - drawnW, PHOTO_RECT.h - drawnH)).toBeLessThan(1);
    expect(drawnW / drawnH).toBeCloseTo(16 / 9, 4);
  });

  it("lays out 19 headshots and escapes copy", () => {
    expect(headshotSlots(19)).toHaveLength(19);
    expect(escapeHtml(`A&B <tag>`)).toBe("A&amp;B &lt;tag&gt;");
  });
});

describe("defaults", () => {
  it("matches the kiosk timing and output decisions", () => {
    expect(base.start.mode).toBe("qr");
    expect(base.roster.default).toBe("mens");
    expect(base.roster.maxSelections).toBe(2);
    expect(base.timing.countdownFrom).toBe(10);
    expect(base.timing.walkInStartsAt).toBe(6);
    expect(base.timing.freezeBeforeCaptureMs).toBe(2000);
    expect(base.output.format).toBe("image/jpeg");
    expect(base.uploader.baseUrl).toBe("http://localhost:5001");
    expect(base.uploader.uploadPath).toBe("/upload");
    expect(base.uploader.fileField).toBe("image");
    expect(base.uploader.interactiveId).toBe("");
    expect(base.uploader.extraFields).toBe(false);
    expect(base.qr.participantId.from).toBe("auto");
    expect(extractParticipantId(base.debug.simulateScanUrl, base.qr.participantId)).toBe("1001");
    expect(base.assets.background).toBe("branding/background.jpg");
    expect(base.assets.attractVideo).toBe("");
    expect(base.attract.rotation.keyWhite).toBe(false);
    expect(base.attract.rotation.holdMs).toBe(6000);
    expect(base.attract.rotation.offsetX).toBe(100);
    expect(base.pick.grid).toEqual({
      button: 275.145,
      gap: 60,
      origin: { x: 130, y: 1009 },
      minColumns: 7,
      maxColumns: 11,
      row3Max: 5,
      maxPlayers: 27,
    });
    expect(base.pick.headshot).toEqual({ zoom: 1.18, offsetX: 0, offsetY: 0 });
    expect(base.pick.nameInset).toBe(12);
    expect(base.capture.guestPlaceholder).toBe(true);
    expect(base.countdown.lockTitle).toEqual({
      enabled: true,
      color: "#FFFFFF",
      opacity: 1,
      revealFraction: 0.2,
      fadeDelayMs: 1000,
      fadeDurationFraction: 0.5,
    });
  });
});

function viewFor(
  screen: Screen,
  assets: Partial<AppConfig["assets"]> = {},
  backgroundUrl: string | null = "blob:http://localhost/bg",
): ViewModel {
  const roster: RosterFile = { version: 1, teams: { mens: [] as Athlete[], womens: [] as Athlete[] } };
  return {
    config: { ...base, assets: { ...base.assets, ...assets } },
    session: { ...createSession("mens"), screen },
    roster,
    assetUrl: (relative) => `/kiosk-assets/${relative}`,
    qrError: null,
    scanNotice: null,
    photoError: null,
    showStillThere: false,
    uploadStatus: "",
    debugOpen: false,
    cameraSummary: "",
    preferWebm: false,
    configPath: "",
    assetRoot: "",
    bundledAssetRoot: "",
    missingAssets: [],
    logPath: "",
    hasPhoto: true,
    flashOpacity: 0,
    measuredClips: {},
    backgroundUrl,
    backgroundWidth: backgroundUrl ? 3840 : 0,
    backgroundHeight: backgroundUrl ? 2320 : 0,
    version: "0.1.7",
  };
}

function chrome(screen: Screen, assets: Partial<AppConfig["assets"]> = {}, backgroundUrl: string | null = "blob:http://localhost/bg"): string {
  return renderChrome(viewFor(screen, assets, backgroundUrl));
}

function thanksChrome(participantId: string | null, mode: "qr" | "touch"): string {
  const view = viewFor("thanks");
  return renderChrome({
    ...view,
    config: { ...view.config, start: { mode } },
    session: { ...view.session, participantId },
  });
}

describe("background plate", () => {
  it("cover-fits a taller plate with the Figma vertical shift", () => {
    expect(backgroundObjectPosition(3840, 2320)).toBe("center 69.375%");
    expect(backgroundObjectPosition(3840, 2160)).toBe("center center");
    expect(backgroundObjectPosition(1920, 1080)).toBe("center center");
    expect(backgroundObjectPosition(0, 0)).toBe("center center");
  });

  it("paints the plate on attract, pick, preview, and thank-you only", () => {
    for (const screen of ["attract", "pick", "preview", "thanks"] as const) {
      const html = chrome(screen);
      expect(html, screen).toContain("bg-photo");
      expect(html, screen).toContain("bg-navy");
      expect(html, screen).not.toContain("sponsor");
      expect(html, screen).not.toContain("bg-diagonal");
      expect(html, screen).not.toContain("bg-video");
    }
    expect(chrome("attract")).toContain("object-position:center 69.375%");
    expect(PHOTO_RECT).toEqual({ x: 640, y: 162, w: 2560, h: 1440 });
    const preview = chrome("preview");
    expect(preview).toContain("frame-overlay");
    expect(preview).toContain("frames/takeaway_v1.png");
    expect(preview).toContain("side-thats");
    expect(preview).toContain("that\u2019s");
    expect(preview).toContain("side-money");
    expect(preview).toContain(">money<");
    expect(preview).toContain("preview-panel");
    expect(preview).toContain("dayton-d-logo-white.svg");
    expect(preview).toContain("preview-try");
    expect(preview).toContain("preview-send");
    expect(preview).toContain("TRY AGAIN");
    expect(preview).toContain("SEND!");
    expect(preview).toContain("pick-back");
    expect(preview).toContain("START OVER");
    expect(preview).not.toContain("fire-layer");
    expect(preview).not.toContain("dock-preview");
    expect(preview).not.toContain("Look Good");
    expect(preview).not.toContain("vert-left");
    for (const screen of ["countdown", "flash", "adjust"] as const) {
      expect(chrome(screen), screen).not.toContain("bg-photo");
    }
    const countdown = chrome("countdown");
    expect(countdown).not.toContain("FPO");
    expect(countdown).not.toContain("fpo-badge");
    expect(countdown).toContain(">LOCK<");
    expect(countdown).toContain(">IN<");
    expect(countdown).toContain(">THAT<");
    expect(countdown).toContain(">POSE<");
    expect(countdown).toContain("lookhere-badge.svg");
    expect(countdown).toContain("look-count");
    expect(countdown).toContain(">10<");
    expect(countdown).toContain("START OVER");
    expect(countdown).toContain('data-action="start-over"');
    expect(countdown).not.toContain("GO BACK");
    expect(countdown).not.toContain("go-back");
    const adjust = chrome("adjust");
    expect(adjust).toContain("TAP &amp; HOLD PLAYER TO ADJUST");
    expect(adjust).toContain("dayton-d-logo-white.svg");
    expect(adjust).toContain("pick-swap");
    expect(adjust).toContain("TRY AGAIN");
    expect(adjust).toContain("pick-go is-ready");
    expect(adjust).toContain("ALL DONE!");
    expect(adjust).toContain("START OVER");
    expect(adjust).toContain('data-action="start-over"');
    expect(adjust).not.toContain("RESET");
    expect(adjust).not.toContain("pill");
    expect(adjust).not.toContain("mark-white");
    expect(adjust).not.toContain("dock-preview");
    expect(chrome("attract", {}, null)).not.toContain("bg-photo");
    expect(chrome("attract", {}, null)).toContain("bg-navy");
    const withLoop = chrome("attract", { attractVideo: "attract/custom.mp4" });
    expect(withLoop).toContain("bg-video");
    expect(withLoop).toContain("/kiosk-assets/attract/custom.mp4");
    expect(chrome("pick", { attractVideo: "attract/custom.mp4" })).not.toContain("bg-video");
    expect(chrome("attract", { attractVideo: "   " })).not.toContain("bg-video");
    expect(chrome("attract", { attractVideo: "attract/loop.mp4" })).not.toContain("bg-video");
    expect(chrome("attract", { attractVideo: ".\\attract\\loop.mp4" })).not.toContain("bg-video");
    const attract = chrome("attract");
    expect(attract).toContain("attract-title");
    expect(attract).toContain("POSE WITH");
    expect(attract).toContain("A FLYER");
    expect(attract).toContain("player-slot");
    expect(attract).toContain("REGISTER HERE");
    expect(attract).toContain("register-card");
    expect(attract).toContain('id="qr-well"');
    expect(attract).toContain("branding/qr.png");
    expect(attract).toContain("dayton-d-logo-red.svg");
    expect(attract).not.toContain("hero-player");
    expect(attract).not.toContain("sponsored");
    expect(chrome("attract", {}, "blob:http://localhost/bg").includes("TOUCH TO START")).toBe(false);
    const touch = renderChrome({
      ...viewFor("attract"),
      config: { ...base, start: { mode: "touch" } },
    });
    expect(touch).toContain("touch-start");
    expect(touch).not.toContain("register-card");
    expect(attractVideoSource("attract/custom.mp4")).toBe("attract/custom.mp4");
    expect(attractVideoSource(" attract/loop.mp4 ")).toBe("");
  });
});

describe("thank-you email line", () => {
  it("shows the email lines after a scan and hides them when the scan was bypassed", () => {
    const scanned = thanksChrome("1001", "qr");
    expect(scanned).toContain(">THANK</span><span>YOU<");
    expect(scanned).toContain("YOUR PHOTO WILL BE EMAILED");
    expect(scanned).toContain("TO THE ADDRESS PROVIDED");
    expect(scanned).not.toContain("PROVIDED.");
    expect(scanned).toContain("thanks-logo");
    expect(scanned).toContain("dayton-d-logo-white.svg");
    expect(scanned).not.toContain("sponsor");
    expect(scanned).not.toContain("mark-white");

    const touch = thanksChrome(null, "touch");
    expect(touch).toContain(">THANK</span><span>YOU<");
    expect(touch).toContain("thanks-logo");
    expect(touch).not.toContain("YOUR PHOTO WILL BE EMAILED");
    expect(touch).not.toContain("TO THE ADDRESS PROVIDED");
    expect(touch).not.toContain("sponsor");

    const bypassed = thanksChrome(null, "qr");
    expect(bypassed).toContain(">THANK</span><span>YOU<");
    expect(bypassed).not.toContain("YOUR PHOTO WILL BE EMAILED");
    expect(bypassed).toContain("thanks-text");
  });
});

describe("asset search", () => {
  it("asks for every screen file, including branding added after a custom root", () => {
    const athlete: Athlete = {
      id: "m01",
      firstName: "A",
      lastName: "Flyer",
      jersey: 1,
      team: "mens",
      headshot: "headshots/m01.png",
      still: "stills/pose-a.png",
      clips: { left: "athletes/left.mp4", right: "athletes/right.mp4" },
    };
    const roster: RosterFile = {
      version: 1,
      teams: { mens: [athlete], womens: [] },
      mascots: [{ id: "mascot", still: "stills/mascot.png" }],
    };
    const files = referencedAssetPaths(roster, {
      ...base,
      assets: { ...base.assets, attractVideo: "attract/loop.mp4" },
    });
    expect(files).toContain("branding/dayton-d-logo-red.svg");
    expect(files).toContain("branding/lookhere-badge.svg");
    expect(files).toContain("branding/qr.png");
    expect(files).toContain("branding/background.jpg");
    expect(files).toContain("frames/takeaway_v1.png");
    expect(files).toContain("fx/fire.mp4");
    expect(files).toContain("headshots/m01.png");
    expect(files).toContain("stills/pose-a.png");
    expect(files).toContain("stills/mascot.png");
    expect(files).toContain("athletes/left.mp4");
    expect(files).toContain(GUEST_PLACEHOLDER_FILE);
    expect(files).not.toContain("attract/loop.mp4");
    expect(assetServedMessage("branding/qr.png", "C:/DaytonKiosk/assets")).toBe(
      "asset branding/qr.png root=C:/DaytonKiosk/assets",
    );
    expect(assetMissingMessage()).toBe("missing from the custom root and the bundled assets folder");
  });
});

describe("guest placeholder", () => {
  const guest = { source: { kind: "guest" } as unknown as CanvasImageSource, width: 640, height: 360 };

  it("fills a missing key with true and skips the file when false", () => {
    expect(parseConfig("{}").capture.guestPlaceholder).toBe(true);
    expect(parseConfig('{ "capture": {} }').capture.guestPlaceholder).toBe(true);
    const off = parseConfig('{ "capture": { "guestPlaceholder": false } }');
    expect(off.capture.guestPlaceholder).toBe(false);

    const shown = guestStandInLayer(true, guest);
    expect(shown).toMatchObject({ source: guest.source, mirror: false, width: 640, height: 360, fit: "contain" });
    expect(guestStandInLayer(false, guest)).toBeNull();
    expect(guestStandInLayer(true, null)).toBeNull();

    const roster: RosterFile = { version: 1, teams: { mens: [], womens: [] } };
    expect(referencedAssetPaths(roster, parseConfig("{}"))).toContain(GUEST_PLACEHOLDER_FILE);
    expect(referencedAssetPaths(roster, off)).not.toContain(GUEST_PLACEHOLDER_FILE);
  });
});

describe("stage fit", () => {
  it("scales the stage to the viewport and ignores an unknown size", () => {
    const scale = Math.min(1600 / STAGE_W, 900 / STAGE_H);
    expect(stageScale(1600, 900)).toBe(scale);
    expect(stageTransform(1600, 900)).toBe(`translate(-50%, -50%) scale(${scale})`);
    expect(stageScale(1920, 1080)).toBe(0.5);
    expect(stageScale(0, 900)).toBeNull();
    expect(stageScale(100, 0)).toBeNull();
    expect(stageScale(-10, 100)).toBeNull();
    expect(stageScale(Number.NaN, 100)).toBeNull();
    expect(stageScale(Number.POSITIVE_INFINITY, 100)).toBeNull();
    expect(stageTransform(0, 900)).toBeNull();
  });

  it("converts a native window size into css pixels", () => {
    expect(logicalWindowSize(3200, 1800, 2)).toEqual({ width: 1600, height: 900 });
    expect(logicalWindowSize(1600, 900, 1)).toEqual({ width: 1600, height: 900 });
    expect(logicalWindowSize(1600, 900, 0)).toBeNull();
    expect(logicalWindowSize(1600, 900, Number.NaN)).toBeNull();
    expect(readPhysicalSize({ width: 3200, height: 1800 })).toEqual({ width: 3200, height: 1800 });
    expect(readPhysicalSize({ Physical: { width: 10, height: 20 } })).toEqual({ width: 10, height: 20 });
    expect(readPhysicalSize(null)).toBeNull();
    expect(readPhysicalSize({ width: "1600", height: 900 })).toBeNull();
  });
});

describe("debug overlay", () => {
  it("shows the running app version", () => {
    const view = viewFor("attract");
    view.debugOpen = true;
    expect(renderDebug(view)).toContain("version 0.1.7");
    view.debugOpen = false;
    expect(renderDebug(view)).toBe("");
    view.debugOpen = true;
    view.version = "";
    expect(renderDebug(view)).toContain("version (unknown)");
  });
});
