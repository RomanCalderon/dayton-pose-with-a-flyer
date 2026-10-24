import { lockWordsForCountdown } from "./session";
import type { AppConfig, Athlete, RosterFile, Session } from "./types";
import { resolveClipSize, transformBounds, type ClipSize } from "./placement";

export const STAGE_W = 3840;
export const STAGE_H = 2160;

export const PHOTO_RECT = { x: 470, y: 130, w: 2900, h: 1631 };

export interface ViewModel {
  config: AppConfig;
  session: Session;
  roster: RosterFile | null;
  assetUrl: (relative: string) => string;
  qrError: string | null;
  photoError: string | null;
  showStillThere: boolean;
  uploadStatus: string;
  debugOpen: boolean;
  cameraSummary: string;
  preferWebm: boolean;
  configPath: string;
  assetRoot: string;
  logPath: string;
  hasPhoto: boolean;
  flashOpacity: number;
  measuredClips: Record<string, ClipSize>;
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

function background(view: ViewModel, withVideo: boolean): string {
  const grain = view.assetUrl("textures/grain.png");
  const video = withVideo
    ? `<video class="bg-video" src="${escapeHtml(view.assetUrl(view.config.assets.attractVideo))}" autoplay muted loop playsinline></video>`
    : "";
  return `<div class="bg" aria-hidden="true">
    <div class="bg-navy"></div>
    <div class="bg-diagonal"></div>
    ${video}
    <div class="bg-grid"></div>
    <div class="bg-grain" style="background-image:url('${escapeHtml(grain)}')"></div>
  </div>`;
}

function sponsor(): string {
  return `<aside class="sponsor">
    <div class="sponsor-copy">
      <div class="sponsor-name">Wright-Patt</div>
      <div class="sponsor-sub">CREDIT UNION, INC.</div>
      <div class="sponsor-tag">BANKING DONE WRIGHT</div>
    </div>
  </aside>`;
}

function mark(tone: "red" | "white" | "navy"): string {
  return `<span class="mark mark-${tone}" aria-hidden="true">D</span>`;
}

function silhouette(): string {
  return `<svg class="hero-player" viewBox="0 0 360 760" aria-hidden="true">
    <ellipse cx="168" cy="730" rx="70" ry="16" fill="#000"/>
    <path fill="#000" d="M150 250c-8 70-10 140-6 250l-28 190h-46l-20-170 36-160-40-90 28-20 48 70 28-40c-30-50-34-90-20-140 18-8 40-8 52 8 10 48-6 92-18 132l36 48 52-78 30 16-46 96 34 150-18 176h-48l-24-190c2-80 0-160-8-218z"/>
    <circle cx="176" cy="118" r="52" fill="#000"/>
    <path fill="#000" d="M128 108c8-48 40-78 78-70 20 4 36 24 40 46-30 4-70-6-96-20-8 12-16 28-22 44z"/>
    <circle cx="92" cy="430" r="46" fill="#000"/>
    <path fill="#000" d="M70 390c20 8 36 28 40 52 8-30 28-40 48-36l18 70-30 16-16-48c-16 6-30 24-34 48l-36 8c-6-40-8-78 10-110z"/>
  </svg>`;
}

function renderAttract(view: ViewModel): string {
  const touch = view.config.start.mode === "touch";
  const hint = view.config.debug.showHints
    ? `<p class="key-hint">${touch ? "Press S or tap anywhere to start" : "Press S to simulate a QR scan"} · F2 debug · F fullscreen</p>`
    : "";
  const panel = touch
    ? `<button class="touch-start" data-action="touch-start">TOUCH TO START</button>`
    : renderQrCard(view);
  const touchAttr = touch ? ` data-action="touch-start"` : "";
  return `<section class="screen attract${touch ? " is-touch" : ""}"${touchAttr}>
    ${background(view, true)}
    ${silhouette()}
    <h1 class="mega"><span>POSE WITH</span><span>A FLYER</span></h1>
    ${panel}
    ${hint}
    ${sponsor()}
  </section>`;
}

function renderQrCard(view: ViewModel): string {
  const qr = view.assetUrl("branding/register-qr.png");
  const well = view.qrError
    ? `<div class="qr-error"><strong>${escapeHtml(view.qrError)}</strong></div>`
    : `<div class="qr-well" id="qr-well"></div>`;
  return `<div class="qr-card">
    <div class="qr-head">
      ${mark("red")}
      <div class="qr-register">REGISTER HERE</div>
    </div>
    <div class="qr-split">
      <div class="qr-step qr-step-dark">
        <div class="step-no">1</div>
        <p>IF YOU DON'T HAVE<br>A CODE, SCAN TO<br>REGISTER</p>
        <img class="reg-qr" alt="Registration QR code" src="${escapeHtml(qr)}" />
        <div class="qr-url">QRCO.DE/FLYERPOSE</div>
      </div>
      <div class="qr-step qr-step-red">
        <div class="step-no">2</div>
        <p>HOLD YOUR UNIQUE<br>CODE IN FRONT OF SIDE<br>CAMERA TO PLAY</p>
        ${well}
      </div>
    </div>
  </div>`;
}

function teamWord(roster: Session["roster"]): string {
  return roster === "womens" ? "WOMEN'S" : "MEN'S";
}

function renderPick(view: ViewModel): string {
  const roster = view.roster;
  const athletes = roster ? roster.teams[view.session.roster] : [];
  const slots = headshotSlots(athletes.length);
  const ready = view.session.selectedIds.length > 0;
  const cards = athletes
    .map((athlete, index) => headshotButton(view, athlete, slots[index], view.session.selectedIds.includes(athlete.id)))
    .join("");
  return `<section class="screen pick">
    ${background(view, false)}
    <header class="pick-title">
      <div class="pick-kicker">PICK UP TO</div>
      <div class="pick-count">${view.config.roster.maxSelections} <span>${teamWord(view.session.roster)}</span></div>
      <div class="pick-players">PLAYERS</div>
    </header>
    <div class="headshots">${cards}</div>
    <div class="pick-actions">
      ${mark("white")}
      <button class="pill pill-ghost" data-action="swap-team">SWAP TEAM</button>
      <button class="pill pill-go ${ready ? "" : "is-disabled"}" ${ready ? 'data-action="lets-go"' : "disabled"}>LET'S GO!</button>
    </div>
    <button class="corner-btn" data-action="go-back">GO BACK</button>
    ${sponsor()}
  </section>`;
}

export function headshotSlots(count: number): Array<{ x: number; y: number }> {
  const size = 275;
  const gapX = 34;
  const gapY = 42;
  const rows = count === 19 ? [8, 7, 4] : packRows(count, 8);
  const widest = Math.max(...rows);
  const slots: Array<{ x: number; y: number }> = [];
  rows.forEach((cols, row) => {
    for (let col = 0; col < cols; col += 1) {
      const rowOffset = ((widest - cols) * (size + gapX)) / 2;
      slots.push({
        x: 64 + rowOffset + col * (size + gapX),
        y: 980 + row * (size + gapY),
      });
    }
  });
  return slots;
}

function packRows(count: number, width: number): number[] {
  const rows: number[] = [];
  let left = count;
  while (left > 0) {
    const take = Math.min(width, left);
    rows.push(take);
    left -= take;
  }
  return rows.length > 0 ? rows : [0];
}

function headshotButton(
  view: ViewModel,
  athlete: Athlete,
  slot: { x: number; y: number } | undefined,
  selected: boolean,
): string {
  const pos = slot ?? { x: 0, y: 0 };
  const name = `${athlete.firstName} ${athlete.lastName}`;
  const arc = `arc-${athlete.id}`;
  return `<button class="headshot ${selected ? "is-selected" : ""}" style="left:${pos.x}px;top:${pos.y}px" data-action="toggle-athlete" data-id="${escapeHtml(athlete.id)}" aria-pressed="${selected}">
    <span class="headshot-photo"><img alt="" src="${escapeHtml(view.assetUrl(athlete.headshot))}" /></span>
    <svg class="headshot-name" viewBox="0 0 275 275" aria-hidden="true">
      <defs><path id="${arc}" d="M36,150 A101,101 0 0,1 239,150" /></defs>
      <text><textPath href="#${arc}" startOffset="50%" text-anchor="middle">${escapeHtml(name)}</textPath></text>
    </svg>
    <span class="jersey">${athlete.jersey}</span>
  </button>`;
}

function renderCountdown(view: ViewModel): string {
  const second = view.session.countdown ?? view.config.timing.countdownFrom;
  const words = lockWordsForCountdown(second, view.config.timing.countdownFrom);
  const wordHtml = ["LOCK", "IN", "THAT", "POSE"]
    .map((word) => `<span class="${words.includes(word) ? "is-on" : ""}">${word}</span>`)
    .join("");
  const error = view.photoError ? `<div class="photo-error">${escapeHtml(view.photoError)}</div>` : "";
  const fpo = view.hasPhoto ? "" : `<div class="fpo-badge">FPO</div>`;
  const flash = view.session.screen === "flash"
    ? `<div class="flash" style="opacity:${view.flashOpacity}"></div>`
    : "";
  return `<section class="screen countdown">
    ${error}
    ${fpo}
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
    <div class="lock">${wordHtml}</div>
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
  const fire = view.assetUrl(view.config.assets.fireVideo);
  const rect = PHOTO_RECT;
  return `<section class="screen preview">
    ${background(view, false)}
    <div class="vert vert-left" aria-hidden="true">${letters("THAT'S")}</div>
    <div class="vert vert-right" aria-hidden="true">${letters("MONEY")}</div>
    <img class="frame-overlay" alt="" src="${escapeHtml(view.assetUrl(view.config.assets.takeawayFrame))}" style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px" />
    <video class="fire-layer" src="${escapeHtml(fire)}" autoplay muted loop playsinline></video>
    <div class="dock dock-preview">
      ${mark("white")}
      <button class="pill pill-ghost" data-action="try-again">TRY AGAIN</button>
      <button class="pill pill-send" data-action="send">SEND!</button>
    </div>
    <button class="corner-btn" data-action="start-over">START OVER</button>
    ${sponsor()}
  </section>`;
}

function letters(word: string): string {
  return word.split("").map((letter) => `<span>${escapeHtml(letter)}</span>`).join("");
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
    ${sponsor()}
  </section>`;
}

export function renderDebug(view: ViewModel): string {
  if (!view.debugOpen) return "";
  const session = view.session;
  const logPath = view.logPath || "browser console only";
  return `<aside class="debug">
    <strong>Pose with a Flyer · debug</strong>
    <div>screen ${escapeHtml(session.screen)} · mode ${escapeHtml(view.config.start.mode)} · roster ${escapeHtml(session.roster)}</div>
    <div>url ${escapeHtml(session.participantUrl ?? "(none)")}</div>
    <div>athletes ${escapeHtml(session.selectedIds.join(", ") || "(none)")} · webm ${view.preferWebm ? "prefer" : "fallback"}</div>
    <div>cameras ${escapeHtml(view.cameraSummary)}</div>
    <div>upload ${escapeHtml(view.uploadStatus || "(idle)")}</div>
    <div>config ${escapeHtml(view.configPath || "(unresolved)")}</div>
    <div>assets ${escapeHtml(view.assetRoot || "(unresolved)")}</div>
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
