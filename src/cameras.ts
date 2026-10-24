import type {
  CameraMatch,
  CameraRoleConfig,
  ListedCamera,
  MediaDeviceLike,
  OnMissing,
} from "./types";

export interface CameraPick {
  deviceId: string | null;
  error: string | null;
  label: string | null;
}

const PLACEHOLDER = /^<|^REPLACE_WITH/i;

export function pinConfigured(match: CameraMatch): boolean {
  switch (match.by) {
    case "serial":
      return Boolean(match.serial) && !PLACEHOLDER.test(match.serial);
    case "usbPort":
      return Boolean(match.usbPort) && !PLACEHOLDER.test(match.usbPort);
    case "label":
      return Boolean(match.label.trim());
    case "deviceId":
      return Boolean(match.deviceId.trim());
    default: {
      const neverBy: never = match.by;
      return neverBy;
    }
  }
}

function videoInputs(devices: MediaDeviceLike[]): MediaDeviceLike[] {
  return devices.filter((device) => device.kind === "videoinput");
}

function labelsMatch(deviceLabel: string, wanted: string): boolean {
  const a = deviceLabel.trim().toLowerCase();
  const b = wanted.trim().toLowerCase();
  return a.length > 0 && b.length > 0 && (a === b || a.includes(b) || b.includes(a));
}

function listedFor(match: CameraMatch, listed: ListedCamera[]): ListedCamera | null {
  if (match.by === "serial" && match.serial) {
    return listed.find((camera) => camera.serial.toLowerCase() === match.serial.toLowerCase()) ?? null;
  }
  if (match.by === "usbPort" && match.usbPort) {
    return listed.find((camera) => camera.usbPort.toLowerCase() === match.usbPort.toLowerCase()) ?? null;
  }
  if (match.by === "label" && match.label) {
    return listed.find((camera) => labelsMatch(camera.label, match.label)) ?? null;
  }
  return null;
}

/**
 * Pick a browser deviceId for a role.
 * Rust can see USB serials; the web layer can only see label and deviceId.
 * When a serial is pinned, we match the FriendlyName Rust reported for that serial.
 */
export function matchCamera(options: {
  devices: MediaDeviceLike[];
  listed: ListedCamera[];
  role: CameraRoleConfig;
  onMissing: OnMissing;
  usedIds: ReadonlySet<string>;
  errorCode: string;
}): CameraPick {
  const devices = videoInputs(options.devices).filter((device) => !options.usedIds.has(device.deviceId));
  const match = options.role.match;
  const pinned = pinConfigured(match);

  const fail = (message: string): CameraPick => ({
    deviceId: null,
    error: message,
    label: null,
  });

  const fallback = (): CameraPick => {
    if (options.onMissing === "error" && pinned) {
      return fail(`${options.errorCode}  Camera not found`);
    }
    const device = devices.find((item) => !/infrared|virtual/i.test(item.label)) ?? devices[0];
    if (!device) return fail(`${options.errorCode}  Camera not found`);
    return { deviceId: device.deviceId, error: null, label: device.label || "Camera" };
  };

  if (!pinned) return fallback();

  if (match.by === "deviceId") {
    const device = devices.find((item) => item.deviceId === match.deviceId);
    return device
      ? { deviceId: device.deviceId, error: null, label: device.label }
      : fallback();
  }

  if (match.by === "label") {
    const device = devices.find((item) => labelsMatch(item.label, match.label));
    return device
      ? { deviceId: device.deviceId, error: null, label: device.label }
      : fallback();
  }

  const listed = listedFor(match, options.listed.filter((camera) => !camera.infrared));
  if (!listed) return fallback();
  const device =
    devices.find((item) => labelsMatch(item.label, listed.label)) ??
    (listed.label ? null : null);
  if (!device) {
    // Serial is present at the USB layer but the browser labels are still identical.
    if (options.onMissing === "error") {
      return fail(`${options.errorCode}  ${listed.label || "Pinned camera"} is connected but its Windows name is not unique`);
    }
    return fallback();
  }
  return { deviceId: device.deviceId, error: null, label: device.label };
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
