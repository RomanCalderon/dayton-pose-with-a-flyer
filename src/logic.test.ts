import { describe, expect, it } from "vitest";
import { matchCamera, pinConfigured, isHttpUrl } from "./cameras";
import { parseConfig, stripJsonComments } from "./config";
import { idleTimeoutMs, stillThereMs, thanksTimeoutMs } from "./idle";
import { clampTransform, defaultTransform, hitTest, stackedSampleV } from "./placement";
import { chooseSides, createSession, lockWordsForCountdown, reduceSession } from "./session";
import { UPLOAD_FILENAME, uploadEndpoint, uploadFields } from "./upload";
import { escapeHtml, headshotSlots } from "./ui";

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
      sessionId: "abc",
    });
    expect(session.screen).toBe("pick");
    expect(session.participantUrl).toContain("participants/1");
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
    expect(session.roster).toBe("mens");
  });

  it("puts one athlete on a random side and two on opposite sides", () => {
    expect(chooseSides(["a"], "random", () => 0.1).a).toBe("left");
    expect(chooseSides(["a"], "random", () => 0.9).a).toBe("right");
    expect(chooseSides(["a"], "right", () => 0).a).toBe("right");
    expect(chooseSides(["a", "b"], "left", () => 0)).toEqual({ a: "left", b: "right" });
  });

  it("builds the lock-in line one word per second", () => {
    expect(lockWordsForCountdown(10, 10)).toEqual(["LOCK"]);
    expect(lockWordsForCountdown(9, 10)).toEqual(["LOCK", "IN"]);
    expect(lockWordsForCountdown(7, 10)).toEqual(["LOCK", "IN", "THAT", "POSE"]);
    expect(lockWordsForCountdown(1, 10)).toEqual(["LOCK", "IN", "THAT", "POSE"]);
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
    session = reduceSession(session, { type: "scan", url: "https://example.test/x", sessionId: "nope" });
    expect(session.participantUrl).toBeNull();
    expect(session.screen).toBe("pick");
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

  it("samples stacked alpha with the head at the top of the frame", () => {
    expect(stackedSampleV(1)).toEqual({ colorV: 1, alphaV: 0.5 });
    expect(stackedSampleV(0)).toEqual({ colorV: 0.5, alphaV: 0 });
  });

  it("builds the uploader contract", () => {
    expect(uploadEndpoint("http://127.0.0.1:8765/", "uploads")).toBe("http://127.0.0.1:8765/uploads");
    expect(uploadFields({
      participantUrl: "https://example.test/participants/demo-001",
      sessionId: "abc",
      capturedAt: "2026-10-24T12:00:00.000Z",
      athletes: ["m01", "m02"],
      roster: "mens",
    })).toEqual({
      participantUrl: "https://example.test/participants/demo-001",
      sessionId: "abc",
      capturedAt: "2026-10-24T12:00:00.000Z",
      athletes: '["m01","m02"]',
      roster: "mens",
    });
    expect(UPLOAD_FILENAME).toBe("photo_2560x1440.jpg");
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
  });
});
