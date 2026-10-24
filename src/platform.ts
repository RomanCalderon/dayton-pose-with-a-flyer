import { getVersion } from "@tauri-apps/api/app";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { version as packageVersion } from "../package.json" with { type: "json" };
import { parseConfig } from "./config";
import type { AppConfig, CameraList, RosterFile, RosterMascot } from "./types";
import { attractVideoSource } from "./ui";

export interface RuntimePaths {
  tauri: boolean;
  configPath: string;
  /** Custom or machine folder. Empty when that directory is not there. */
  assetRoot: string;
  /** Install `assets/` folder. Files missing from `assetRoot` are served from here. */
  bundledAssetRoot: string;
  /** Machine folder checked before `assetRoot` for a single file. Empty when absent. */
  assetOverrideRoot: string;
  /** Absolute kiosk.log path in the desktop shell. Empty in the browser. */
  logPath: string;
  config: AppConfig;
  cameras: CameraList;
}

export interface AssetHit {
  relative: string;
  path: string;
  root: string;
  found: boolean;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Shell version from Tauri, or the package version when the page is open in a browser. */
export async function readAppVersion(): Promise<string> {
  if (isTauri()) {
    try {
      const version = (await getVersion()).trim();
      if (version) return version;
    } catch {
      // Fall through to the package version baked into this frontend.
    }
  }
  return packageVersion;
}

/** 1×1 transparent GIF. Keeps an unresolved image from requesting the page itself. */
export const PENDING_ASSET_SRC =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

export function pendingAssetSrc(relative: string): string {
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(relative)) return PENDING_ASSET_SRC;
  return "";
}

export function normalizeAssetKey(relative: string): string {
  return relative.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

export function assetServedMessage(relative: string, root: string): string {
  return `asset ${normalizeAssetKey(relative)} root=${root}`;
}

export function assetMissingMessage(): string {
  return "missing from the custom root and the bundled assets folder";
}

/** One working URL. In the shell, Rust stats the custom root and then the install folder. */
export async function resolveAsset(paths: RuntimePaths, relative: string): Promise<AssetHit> {
  const key = normalizeAssetKey(relative);
  if (!key) return { relative: "", path: "", root: "", found: false };
  if (!paths.tauri) {
    const http = /^https?:\/\//i.test(paths.assetRoot);
    const root = http ? paths.assetRoot.replace(/\/$/, "") : "/kiosk-assets";
    return { relative: key, path: `${root}/${key}`, root, found: true };
  }
  return invoke<AssetHit>("resolve_asset", { relative: key });
}

export function assetHitUrl(tauri: boolean, hit: AssetHit): string {
  if (!hit.found || !hit.path) return "";
  if (!tauri) return hit.path;
  return convertFileSrc(hit.path);
}

/** Files the screens ask for. Each one is resolved on its own. */
export function referencedAssetPaths(roster: RosterFile | null, config: AppConfig): string[] {
  const files = [
    config.assets.rosterFile,
    config.assets.takeawayFrame,
    config.assets.fireVideo,
    "placeholders/guest.png",
    "branding/dayton-d-logo-red.svg",
    "branding/qr.png",
  ];
  const background = config.assets.background.trim();
  if (background) files.push(background);
  const attract = attractVideoSource(config.assets.attractVideo);
  if (attract) files.push(attract);
  if (roster) {
    for (const athlete of [...roster.teams.mens, ...roster.teams.womens]) {
      files.push(athlete.headshot, athlete.clips.left, athlete.clips.right);
      if (athlete.still?.trim()) files.push(athlete.still);
    }
    for (const mascot of roster.mascots ?? []) {
      pushMascot(files, mascot);
    }
  }
  return uniqueAssetKeys(files);
}

function pushMascot(files: string[], mascot: RosterMascot): void {
  if (mascot.still?.trim()) files.push(mascot.still);
  if (mascot.headshot?.trim()) files.push(mascot.headshot);
}

function uniqueAssetKeys(files: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of files) {
    const key = normalizeAssetKey(file);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export async function loadRuntime(): Promise<RuntimePaths> {
  if (!isTauri()) {
    const response = await fetch("/kiosk-config/kiosk.json");
    if (!response.ok) throw new Error(`Could not read kiosk.json (${response.status})`);
    const config = parseConfig(await response.text());
    return {
      tauri: false,
      configPath: "/kiosk-config/kiosk.json",
      assetRoot: "/kiosk-assets",
      bundledAssetRoot: "/kiosk-assets",
      assetOverrideRoot: "",
      logPath: "",
      config,
      cameras: {
        platform: "browser",
        implemented: false,
        cameras: [],
        note: "list_cameras runs in the Tauri shell. The browser build uses the first webcam.",
      },
    };
  }
  const loaded = await invoke<{
    configText: string;
    configPath: string;
    assetRoot: string;
    bundledAssetRoot?: string;
    assetOverrideRoot?: string;
    logPath: string;
  }>("load_config");
  const cameras = await invoke<CameraList>("list_cameras");
  return {
    tauri: true,
    configPath: loaded.configPath,
    assetRoot: loaded.assetRoot,
    bundledAssetRoot: loaded.bundledAssetRoot ?? "",
    assetOverrideRoot: loaded.assetOverrideRoot ?? "",
    logPath: loaded.logPath,
    config: parseConfig(loaded.configText),
    cameras,
  };
}

export async function setFullscreen(fullscreen: boolean): Promise<void> {
  if (!isTauri()) {
    if (fullscreen) await document.documentElement.requestFullscreen().catch(() => undefined);
    else if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    return;
  }
  await getCurrentWindow().setFullscreen(fullscreen);
}
