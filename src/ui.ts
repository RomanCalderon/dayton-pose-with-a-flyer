import { DEFAULT_CONFIG } from "./config";
import { resolveClipSize, transformBounds, type ClipSize } from "./placement";
import {
  athleteArcName,
  estimateArcAdvance,
  fitArcFont,
  headshotShiftY,
  layoutPickGrid,
  nameArcPath,
  showJersey,
} from "./pick-layout";
import { LOCK_WORDS } from "./lock-title";
import type { AppConfig, Athlete, PickGridConfig, PickHeadshotConfig, RosterFile, Session } from "./types";

export const STAGE_W = 3840;
export const STAGE_H = 2160;

/** Stage-space photo well. Matches the 2560×1440 takeaway JPEG 1:1. */
export const PHOTO_RECT = { x: 640, y: 162, w: 2560, h: 1440 };

export interface ViewModel {
  config: AppConfig;
  session: Session;
  roster: RosterFile | null;
  assetUrl: (relative: string) => string;
  qrError: string | null;
  scanNotice: string | null;
  photoError: string | null;
  showStillThere: boolean;
  uploadStatus: string;
  debugOpen: boolean;
  cameraSummary: string;
  preferWebm: boolean;
  configPath: string;
  assetRoot: string;
  bundledAssetRoot: string;
  missingAssets: string[];
  logPath: string;
  hasPhoto: boolean;
  flashOpacity: number;
  measuredClips: Record<string, ClipSize>;
  /** Blob URL of the static plate. Null falls back to solid navy. */
  backgroundUrl: string | null;
  backgroundWidth: number;
  backgroundHeight: number;
  /** Running app version. Tauri `getVersion` in the shell, package.json in the browser. */
  version: string;
}

export interface StageBox {
  width: number;
  height: number;
}

/** CSS scale that fits the 3840×2160 stage into a viewport. Null when the size is not usable. */
export function stageScale(width: number, height: number): number | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = Math.min(width / STAGE_W, height / STAGE_H);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return scale;
}

export function stageTransform(width: number, height: number): string | null {
  const scale = stageScale(width, height);
  if (scale === null) return null;
  return `translate(-50%, -50%) scale(${scale})`;
}

/** Physical window pixels divided by the monitor scale factor. */
export function logicalWindowSize(width: number, height: number, scaleFactor: number): StageBox | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !(scaleFactor > 0) || !Number.isFinite(scaleFactor)) {
    return null;
  }
  return { width: width / scaleFactor, height: height / scaleFactor };
}

/** Tauri resize payloads are `{ width, height }` or `{ Physical: { width, height } }`. */
export function readPhysicalSize(value: unknown): StageBox | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { width?: unknown; height?: unknown; Physical?: { width?: unknown; height?: unknown } };
  const source = record.Physical ?? record;
  if (typeof source.width !== "number" || typeof source.height !== "number") return null;
  if (!Number.isFinite(source.width) || !Number.isFinite(source.height)) return null;
  return { width: source.width, height: source.height };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

export function renderChrome(view: ViewModel): string {
  const screen = view.session.screen;
  if (!view.roster && screen !== "attract") {
    return `<div class="boot">Loading roster…</div>`;
  }
  let body = "";
  switch (screen) {
    case "attract":
      body = renderAttract(view);
      break;
    case "pick":
      body = renderPick(view);
      break;
    case "countdown":
    case "flash":
      body = renderCountdown(view);
      break;
    case "adjust":
      body = renderAdjust(view);
      break;
    case "preview":
      body = renderPreview(view);
      break;
    case "thanks":
      body = renderThanks(view);
      break;
    default: {
      const neverScreen: never = screen;
      body = neverScreen;
    }
  }
  const warning = view.showStillThere
    ? `<div class="still-there">STILL THERE?</div>`
    : "";
  return `${body}${warning}`;
}

export function canvasMode(screen: Session["screen"]): "hidden" | "full" | "preview" {
  if (screen === "countdown" || screen === "flash" || screen === "adjust") return "full";
  if (screen === "preview") return "preview";
  return "hidden";
}

/**
 * Cover-fit position for the plate. A 16:9 file fills the stage. A taller file
 * (the Figma fill is 3840×2320 in this 3840×2160 frame) is centered, then shifted
 * up 31px so the visible window matches that crop.
 */
export function backgroundObjectPosition(
  imageWidth: number,
  imageHeight: number,
  stageW = STAGE_W,
  stageH = STAGE_H,
): string {
  if (imageWidth <= 0 || imageHeight <= 0) return "center center";
  const scale = Math.max(stageW / imageWidth, stageH / imageHeight);
  const overflow = imageHeight * scale - stageH;
  if (overflow <= 0.5) return "center center";
  const offset = -overflow / 2 - 31;
  const percent = Math.round((offset / -overflow) * 100 * 1000) / 1000;
  return `center ${percent}%`;
}

/** The generated attract loop is a picture of the pre-plate diagonal screen. */
export const LEGACY_ATTRACT_VIDEO = "attract/loop.mp4";

export function attractVideoSource(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === LEGACY_ATTRACT_VIDEO) return "";
  return value.trim();
}

function background(view: ViewModel, withVideo: boolean): string {
  const photo = view.backgroundUrl
    ? `<img class="bg-photo" alt="" src="${escapeHtml(view.backgroundUrl)}" style="object-position:${escapeHtml(backgroundObjectPosition(view.backgroundWidth, view.backgroundHeight))}" />`
    : "";
  const attract = attractVideoSource(view.config.assets.attractVideo);
  const attractSrc = withVideo && attract ? view.assetUrl(attract) : "";
  const video = attractSrc
    ? `<video class="bg-video" src="${escapeHtml(attractSrc)}" autoplay muted loop playsinline></video>`
    : "";
  return `<div class="bg" aria-hidden="true">
    <div class="bg-navy"></div>
    ${photo}
    ${video}
  </div>`;
}

function mark(tone: "red" | "white" | "navy"): string {
  return `<span class="mark mark-${tone}" aria-hidden="true">D</span>`;
}

function renderAttract(view: ViewModel): string {
  const touch = view.config.start.mode === "touch";
  const hint = view.config.debug.showHints
    ? `<p class="key-hint">${touch ? "Press S or tap anywhere to start" : "Press S to simulate a QR scan"} · F2 debug · F fullscreen</p>`
    : "";
  const panel = touch
    ? `<button class="touch-start" data-action="touch-start">TOUCH TO START</button>`
    : renderRegisterCard(view);
  const touchAttr = touch ? ` data-action="touch-start"` : "";
  return `<section class="screen attract${touch ? " is-touch" : ""}"${touchAttr}>
    ${background(view, true)}
    <h1 class="attract-title">POSE WITH
A FLYER</h1>
    <div class="player-slot" aria-hidden="true">
      <div class="player-slide">
        <img class="player-still" alt="" />
      </div>
    </div>
    ${panel}
    ${hint}
  </section>`;
}

function renderRegisterCard(view: ViewModel): string {
  const logo = view.assetUrl("branding/dayton-d-logo-red.svg");
  const qr = view.assetUrl("branding/qr.png");
  return `<aside class="register-card">
    <div class="register-title">
      <img class="register-logo" alt="" src="${escapeHtml(logo)}" />
      <p class="register-word">REGISTER HERE</p>
    </div>
    <div class="register-body">
      <div class="register-panels">
        <div class="register-panel register-panel-dark">
          <div class="register-tab">1</div>
          <p class="register-copy">IF YOU DON'T HAVE A CODE, SCAN TO REGISTER</p>
          <img class="register-qr" alt="Registration QR code" src="${escapeHtml(qr)}" />
        </div>
        <div class="register-panel register-panel-red">
          <div class="register-tab">2</div>
          <p class="register-copy register-copy-right">HOLD YOUR UNIQUE CODE IN FRONT OF SIDE CAMERA TO PLAY</p>
          <div class="qr-well" id="qr-well"></div>
        </div>
      </div>
    </div>
  </aside>`;
}

function teamWord(roster: Session["roster"]): string {
  return roster === "womens" ? "WOMEN\u2019S" : "MEN\u2019S";
}

function renderPick(view: ViewModel): string {
  const roster = view.roster;
  const athletes = roster ? roster.teams[view.session.roster] : [];
  const grid = view.config.pick.grid;
  const slots = layoutPickGrid(athletes.length, grid);
  const ready = view.session.selectedIds.length > 0;
  const cards = slots
    .map((slot) => {
      const athlete = athletes[slot.index];
      if (!athlete) return "";
      return headshotButton(
        view,
        athlete,
        slot,
        view.session.selectedIds.includes(athlete.id),
        grid.button,
        view.config.pick.headshot,
        view.config.pick.nameInset,
      );
    })
    .join("");
  const count = view.config.roster.maxSelections;
  const main = `PICK UP TO\n  ${count} ${teamWord(view.session.roster)}`;
  const go = ready
    ? `<button class="pick-go is-ready" type="button" data-action="lets-go">Let's go!</button>`
    : `<button class="pick-go" type="button" disabled>Let's go!</button>`;
  return `<section class="screen pick">
    ${background(view, false)}
    <header class="pick-title">
      <div class="main">${escapeHtml(main)}</div>
      <div class="players">PLAYERS</div>
    </header>
    <div class="headshots">${cards}</div>
    <div class="pick-panel">
      <img class="pick-logo" alt="" src="${escapeHtml(view.assetUrl("branding/dayton-d-logo-white.svg"))}" width="160" height="100" />
      <div class="pick-panel-actions">
        <button class="pick-swap" type="button" data-action="swap-team">Swap Team</button>
        ${go}
      </div>
    </div>
    <button class="pick-back" type="button" data-action="go-back">Go Back</button>
  </section>`;
}

export function headshotSlots(
  count: number,
  grid: PickGridConfig = DEFAULT_CONFIG.pick.grid,
): Array<{ x: number; y: number }> {
  return layoutPickGrid(count, grid).map(({ x, y }) => ({ x, y }));
}

function headshotButton(
  view: ViewModel,
  athlete: Athlete,
  slot: { x: number; y: number; index: number },
  selected: boolean,
  size: number,
  headshot: PickHeadshotConfig,
  nameInset: number,
): string {
  const name = athleteArcName(athlete.firstName, athlete.lastName);
  const badge = showJersey(athlete.jersey) ? `<span class="jersey">${escapeHtml(String(athlete.jersey))}</span>` : "";
  const photoStyle = `--hs-zoom:${headshot.zoom};--hs-x:${headshot.offsetX}px;--hs-y:${headshotShiftY(headshot.offsetY)}`;
  return `<button class="headshot${selected ? " is-selected" : ""}" type="button" style="left:${slot.x}px;top:${slot.y}px;width:${size}px;height:${size}px" data-action="toggle-athlete" data-id="${escapeHtml(athlete.id)}" aria-pressed="${selected}">
    <span class="headshot-photo" style="${photoStyle}"><img alt="" src="${escapeHtml(view.assetUrl(athlete.headshot))}" /></span>
    ${nameArc(name, slot.index, nameInset)}
    ${badge}
  </button>`;
}

function nameArc(name: string, index: number, inset: number): string {
  if (!name) return "";
  const fit = fitArcFont(estimateArcAdvance(name));
  const id = `hs-arc-${index}`;
  const arc = nameArcPath(inset);
  const length = fit.textLength === null ? "" : ` textLength="${fit.textLength}" lengthAdjust="spacingAndGlyphs"`;
  return `<svg class="hs-name" viewBox="0 0 275.145 275.145" width="275.145" height="275.145" aria-hidden="true">
    <path id="${id}" fill="none" d="${arc.d}"/>
    <text font-family="Arial, 'Liberation Sans', sans-serif" font-weight="700" font-size="${trimNum(fit.fontSize)}" letter-spacing="${trimNum(fit.letterSpacing)}" fill="#000" dy="${trimNum(fit.dy)}" dx="0.97">
      <textPath href="#${id}" startOffset="50%" text-anchor="middle"${length}>${escapeHtml(name)}</textPath>
    </text>
  </svg>`;
}

function trimNum(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function renderCountdown(view: ViewModel): string {
  const second = view.session.countdown ?? view.config.timing.countdownFrom;
  const error = view.photoError ? `<div class="photo-error">${escapeHtml(view.photoError)}</div>` : "";
  const flash = view.session.screen === "flash"
    ? `<div class="flash" style="opacity:${view.flashOpacity}"></div>`
    : "";
  const lock = view.config.countdown.lockTitle.enabled
    ? `<div class="lock" style="opacity:0">${LOCK_WORDS.map((word) => `<span style="opacity:0">${word}</span>`).join("")}</div>`
    : "";
  return `<section class="screen countdown">
    ${error}
    <div class="look">
      <svg class="look-svg" viewBox="0 0 300 300" aria-hidden="true">
        <defs>
          <path id="look-arc" d="M52,168 A98,98 0 0,0 248,168" />
        </defs>
        <circle cx="150" cy="156" r="126" fill="none" stroke="#ffffff" stroke-width="10"/>
        <text class="look-label" fill="#ffffff" font-size="15" font-weight="700" letter-spacing="1.4">
          <textPath href="#look-arc" startOffset="50%" text-anchor="middle">STAND IN CENTER &amp; LOOK HERE</textPath>
        </text>
        <circle cx="150" cy="168" r="54" fill="#00ACEC"/>
        <ellipse cx="150" cy="168" rx="34" ry="20" fill="none" stroke="#ffffff" stroke-width="5"/>
        <circle cx="150" cy="168" r="9" fill="#ffffff"/>
      </svg>
      <div class="look-count">${second}</div>
    </div>
    ${lock}
    <button class="corner-btn corner-light" data-action="go-back">GO BACK</button>
    ${flash}
  </section>`;
}

function renderAdjust(view: ViewModel): string {
  const controls = view.config.features.plusMinusButtons ? plusMinus(view) : "";
  return `<section class="screen adjust">
    ${controls}
    <div class="dock">
      <div class="dock-label">TAP &amp; HOLD PLAYER TO ADJUST</div>
      ${mark("white")}
      <button class="pill pill-ghost" data-action="try-again">TRY AGAIN</button>
      <button class="pill pill-go" data-action="all-done">ALL DONE!</button>
    </div>
    <button class="corner-btn corner-light" data-action="start-over">RESET</button>
  </section>`;
}

function plusMinus(view: ViewModel): string {
  const id = view.session.selectedAdjustId;
  if (!id || !view.roster) return "";
  const athlete = findAthlete(view.roster, id);
  const transform = view.session.transforms[id];
  const side = view.session.sides[id];
  if (!athlete || !transform || !side) return "";
  const clip = clipSize(view, athlete.clips[side]);
  const bounds = transformBounds(transform, clip);
  const sx = STAGE_W / view.config.output.width;
  const sy = STAGE_H / view.config.output.height;
  const left = (bounds.left + bounds.width / 2) * sx;
  const block = 272;
  const foot = (bounds.top + bounds.height * 0.78) * sy;
  const top = Math.max(160, Math.min(foot, STAGE_H - 220 - block));
  return `<div class="pm" style="left:${left}px;top:${top}px">
    <button class="pm-btn" data-action="scale" data-dir="1" aria-label="Larger">+</button>
    <button class="pm-btn" data-action="scale" data-dir="-1" aria-label="Smaller">−</button>
  </div>`;
}

function renderPreview(view: ViewModel): string {
  const rect = PHOTO_RECT;
  const logo = view.assetUrl("branding/dayton-d-logo-white.svg");
  return `<section class="screen preview">
    ${background(view, false)}
    <p class="side-word side-thats" aria-hidden="true"><span>that\u2019s</span></p>
    <p class="side-word side-money" aria-hidden="true"><span>money</span></p>
    <img class="frame-overlay" alt="" src="${escapeHtml(view.assetUrl(view.config.assets.takeawayFrame))}" style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px" />
    <div class="pick-panel preview-panel">
      <img class="pick-logo" alt="" src="${escapeHtml(logo)}" width="160" height="100" />
      <div class="pick-panel-actions">
        <button class="pick-swap preview-try" type="button" data-action="try-again">TRY AGAIN</button>
        <button class="preview-send" type="button" data-action="send">SEND!</button>
      </div>
    </div>
    <button class="pick-back" type="button" data-action="start-over">START OVER</button>
  </section>`;
}

function renderThanks(view: ViewModel): string {
  const emailed = view.config.start.mode === "qr"
    ? `<p class="thanks-sub">YOUR PHOTO WILL BE EMAILED<br>TO THE ADDRESS PROVIDED</p>`
    : "";
  return `<section class="screen thanks">
    ${background(view, false)}
    <div class="thanks-copy">
      <h1>THANK<br>YOU</h1>
      ${mark("white")}
    </div>
      ${emailed}
  </section>`;
}

export function renderDebug(view: ViewModel): string {
  if (!view.debugOpen) return "";
  const session = view.session;
  const logPath = view.logPath || "browser console only";
  return `<aside class="debug">
    <strong>Pose with a Flyer · debug</strong>
    <div>version ${escapeHtml(view.version || "(unknown)")}</div>
    <div>screen ${escapeHtml(session.screen)} · mode ${escapeHtml(view.config.start.mode)} · roster ${escapeHtml(session.roster)}</div>
    <div>scan ${escapeHtml(session.participantUrl ?? "(none)")}</div>
    <div>participant_id ${escapeHtml(session.participantId ?? "(none)")}</div>
    <div>athletes ${escapeHtml(session.selectedIds.join(", ") || "(none)")} · webm ${view.preferWebm ? "prefer" : "fallback"}</div>
    <div>cameras ${escapeHtml(view.cameraSummary)}</div>
    <div>upload ${escapeHtml(view.uploadStatus || "(idle)")}</div>
    <div>config ${escapeHtml(view.configPath || "(unresolved)")}</div>
    <div>assets ${escapeHtml(view.assetRoot || "(no custom root)")}</div>
    <div>bundled ${escapeHtml(view.bundledAssetRoot || "(unresolved)")}</div>
    <div>missing ${escapeHtml(view.missingAssets.join(", ") || "(none)")}</div>
    <div>log ${escapeHtml(logPath)}</div>
    <pre id="debug-live" class="debug-log"></pre>
    <div class="debug-keys">S scan/start · Enter primary · Esc reset · Backspace back · N skip countdown · arrows nudge · [ ] scale · Tab next athlete · F fullscreen · F2 hide</div>
    <div class="debug-row">
      <button data-action="simulate-scan">Simulate scan</button>
      <button data-action="toggle-webm">Toggle WebM</button>
      <button data-action="toggle-plusminus">${view.config.features.plusMinusButtons ? "Hide +/−" : "Show +/−"}</button>
    </div>
  </aside>`;
}

export function findAthlete(roster: RosterFile, id: string): Athlete | null {
  return roster.teams.mens.find((athlete) => athlete.id === id)
    ?? roster.teams.womens.find((athlete) => athlete.id === id)
    ?? null;
}

export function clipSize(view: ViewModel, file: string): { width: number; height: number } {
  return resolveClipSize(view.roster?.clipMeta?.[file], view.measuredClips[file]);
}

/** Even-odd hole so the preview background does not cover the live composite. */
export function previewHole(stageW: number, stageH: number, rect: { x: number; y: number; w: number; h: number }): string {
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  return `path(evenodd, "M0 0 H${stageW} V${stageH} H0 Z M${rect.x} ${rect.y} H${right} V${bottom} H${rect.x} Z")`;
}

export interface PreviewFit {
  left: number;
  top: number;
  scale: number;
}

/**
 * Scale the full stage-sized canvas into the preview well. The well and the
 * output are both 16:9, so the uploaded JPEG is shown whole, not cropped.
 */
export function previewFit(
  stageW: number,
  stageH: number,
  rect: { x: number; y: number; w: number; h: number },
): PreviewFit {
  const scale = Math.min(rect.w / stageW, rect.h / stageH);
  const drawnW = stageW * scale;
  const drawnH = stageH * scale;
  return {
    left: rect.x + (rect.w - drawnW) / 2,
    top: rect.y + (rect.h - drawnH) / 2,
    scale,
  };
}
