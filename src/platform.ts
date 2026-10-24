import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { parseConfig } from "./config";
import type { AppConfig, CameraList } from "./types";

export interface RuntimePaths {
  tauri: boolean;
  configPath: string;
  assetRoot: string;
  config: AppConfig;
  cameras: CameraList;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function joinAsset(root: string, relative: string): string {
  const rel = relative.replace(/^[/\\]+/, "");
  if (!isTauri()) return `/kiosk-assets/${rel.split("\\").join("/")}`;
  const sep = root.includes("\\") ? "\\" : "/";
  const base = root.replace(/[/\\]+$/, "");
  return `${base}${sep}${rel.split("/").join(sep)}`;
}

export function assetUrl(paths: RuntimePaths, relative: string): string {
  const full = joinAsset(paths.assetRoot, relative);
  if (!paths.tauri) return full;
  return convertFileSrc(full);
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
  }>("load_config");
  const cameras = await invoke<CameraList>("list_cameras");
  return {
    tauri: true,
    configPath: loaded.configPath,
    assetRoot: loaded.assetRoot,
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
