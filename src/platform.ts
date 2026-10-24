import { getVersion } from "@tauri-apps/api/app";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { version as packageVersion } from "../package.json" with { type: "json" };
import { parseConfig } from "./config";
import type { AppConfig, CameraList } from "./types";

export interface RuntimePaths {
  tauri: boolean;
  configPath: string;
  assetRoot: string;
  /** Machine folder checked before `assetRoot` for a single file. Empty when absent. */
  assetOverrideRoot: string;
  /** Absolute kiosk.log path in the desktop shell. Empty in the browser. */
  logPath: string;
  config: AppConfig;
  cameras: CameraList;
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

export function joinAsset(root: string, relative: string): string {
  const rel = relative.replace(/^[/\\]+/, "");
  if (!isTauri()) {
    if (/^https?:\/\//i.test(root)) return `${root.replace(/\/$/, "")}/${rel.split("\\").join("/")}`;
    return `/kiosk-assets/${rel.split("\\").join("/")}`;
  }
  const sep = root.includes("\\") ? "\\" : "/";
  const base = root.replace(/[/\\]+$/, "");
  return `${base}${sep}${rel.split("/").join(sep)}`;
}

export function assetFileUrl(tauri: boolean, root: string, relative: string): string {
  const full = joinAsset(root, relative);
  if (!tauri) return full;
  return convertFileSrc(full);
}

/** Override directory first, then the bundled asset root. Duplicates are dropped. */
export function assetSearchRoots(overrideRoot: string, assetRoot: string): string[] {
  const roots: string[] = [];
  for (const root of [overrideRoot, assetRoot]) {
    const trimmed = root.trim();
    if (!trimmed || roots.includes(trimmed)) continue;
    roots.push(trimmed);
  }
  return roots;
}

export function assetUrl(paths: RuntimePaths, relative: string): string {
  return assetFileUrl(paths.tauri, paths.assetRoot, relative);
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
    assetOverrideRoot?: string;
    logPath: string;
  }>("load_config");
  const cameras = await invoke<CameraList>("list_cameras");
  return {
    tauri: true,
    configPath: loaded.configPath,
    assetRoot: loaded.assetRoot,
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
