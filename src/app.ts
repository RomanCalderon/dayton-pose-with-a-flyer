import {
  attractSlideTransform,
  attractSlideTransition,
  collectAttractStills,
  decodeImage,
  keyedStillUrl,
  shuffleAttractOrder,
  VITESSE_FONT_FILES,
  type AttractStill,
} from "./attract";
import { countdownDue, countdownRemainingMs, countdownShownSecond } from "./clock";
import {
  clampTransform,
  defaultTransform,
  hitTest,
  measuredColorSize,
  resolveClipLayout,
  transformForMeasuredSize,
} from "./placement";
import { matchCamera } from "./cameras";
import { extractParticipantId } from "./participant";
import { idleTimeoutMs, stillThereMs, thanksTimeoutMs } from "./idle";
import { formatLogLine, remember } from "./log";
import { fetchAssetBlob, isImagePath, mediaIsSeekable, sourceIsCanvasSafe, urlIsCanvasSafe } from "./media";
import { athleteSourceKind, playbackFrameReady } from "./playback";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  assetHitUrl,
  assetMissingMessage,
  assetServedMessage,
  isTauri,
  loadRuntime,
  normalizeAssetKey,
  pendingAssetSrc,
  readAppVersion,
  referencedAssetPaths,
  resolveAsset,
  setFullscreen,
  type AssetHit,
  type RuntimePaths,
} from "./platform";
import { getQrReader, grabFrame } from "./qr";
import { chooseSides, createSession, reduceSession, type SessionEvent } from "./session";
import type { AppConfig, AthleteTransform, MediaDeviceLike, RosterFile, Session, Side, UploadResult } from "./types";
import { postPhoto, responseSnippet, uploadEndpoint, uploadFields, uploadFilename } from "./upload";
import {
  canvasToJpeg,
  Compositor,
  type AthleteLayer,
  type AlphaLayout,
  type BackgroundLayer,
} from "./compositor";
import {
  STAGE_H,
  STAGE_W,
  canvasMode,
  clipSize,
  escapeHtml,
  findAthlete,
  logicalWindowSize,
  PHOTO_RECT,
  previewFit,
  previewHole,
  readPhysicalSize,
  attractVideoSource,
  renderChrome,
  renderDebug,
  stageScale,
  stageTransform,
  type ViewModel,
} from "./ui";

interface PointerPoint {
  x: number;
  y: number;
}

type ClipSource = "loading" | "blob" | "direct" | "poster";

interface LoadedClip {
  id: string;
  side: Side;
  video: HTMLVideoElement;
  poster: HTMLImageElement | null;
  /** Stacked or straight frame copied out of the video so later paints cannot go blank. */
  still: HTMLCanvasElement | null;
  layout: AlphaLayout;
  file: string;
  width: number;
  height: number;
  sourceNote: ClipSource;
  blobUrl: string | null;
  /** Bumped to ignore a blob fetch that finished after the clip was replaced. */
  generation: number;
  triedWebm: boolean;
  sizedFromMeta: boolean;
  /** Countdown draws this clip only after playback has presented a frame. */
  presented: boolean;
  /** Invalidates a frame callback from the previous countdown. */
  presentGeneration: number;
  onTime: (() => void) | null;
}

export class KioskApp {
  private paths!: RuntimePaths;
  private config!: AppConfig;
  private roster: RosterFile | null = null;
  private session: Session = createSession("mens");
  private compositor!: Compositor;
  private viewport!: HTMLElement;
  private stage!: HTMLElement;
  private appVersion = "";
  private fitGeneration = 0;
  private chrome!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private mediaPool!: HTMLElement;
  private debugHost!: HTMLElement;
  private statusHost!: HTMLElement;
  private photoVideo: HTMLVideoElement | null = null;
  private qrVideo: HTMLVideoElement | null = null;
  private frozenCamera: HTMLCanvasElement | null = null;
  private guestImage: HTMLImageElement | null = null;
  private frameImage: HTMLImageElement | null = null;
  private clips = new Map<string, LoadedClip>();
  private measuredClips = new Map<string, { width: number; height: number }>();
  private blobbedAssets = new Map<string, string>();
  private assetHits = new Map<string, AssetHit>();
  private assetPending = new Map<string, Promise<AssetHit>>();
  private missingAssets: string[] = [];
  private backgroundUrl: string | null = null;
  private backgroundWidth = 0;
  private backgroundHeight = 0;
  private localAssets = new Map<string, Promise<string | null>>();
  private assetRefresh = 0;
  private qrError: string | null = null;
  private scanNotice: string | null = null;
  private scanNoticeTimer = 0;
  private photoError: string | null = null;
  private uploadStatus = "";
  private debugOpen = false;
  private preferWebm = false;
  private showStillThere = false;
  private flashOpacity = 0;
  private sending = false;
  private raf = 0;
  private painting = false;
  private countdownStarted = 0;
  private countdownTimer = 0;
  private paintThrows = false;
  private logLines: string[] = [];
  private logPath = "";
  private recentLogs = new Map<string, number>();
  private walkStarted = false;
  private frozen = false;
  private capturing = false;
  private idleTimer = 0;
  private warningTimer = 0;
  private thanksTimer = 0;
  private qrTimer = 0;
  private pointers = new Map<number, PointerPoint>();
  private drag: { id: string; lastX: number; lastY: number } | null = null;
  private pinch: { id: string; startDist: number; startScale: number } | null = null;
  private devices: MediaDeviceLike[] = [];
  private attractTimer = 0;
  private attractToken = 0;
  private attractPhase: "idle" | "hold" | "out" | "in" = "idle";
  private attractOrder: AttractStill[] = [];
  private attractCursor = 0;
  private attractCache = new Map<string, string>();
  private attractPending = new Map<string, Promise<string | null>>();
  private attractOverrideFile = "";

  constructor(private readonly root: HTMLElement) {}

  async start(): Promise<void> {
    this.root.innerHTML = `<div id="viewport"><div id="stage"><canvas id="gl"></canvas><div id="chrome"></div><div id="media-pool" class="media-pool"></div></div></div>`;
    this.viewport = this.root.querySelector("#viewport") as HTMLElement;
    this.stage = this.root.querySelector("#stage") as HTMLElement;
    this.chrome = this.root.querySelector("#chrome") as HTMLElement;
    this.canvas = this.root.querySelector("#gl") as HTMLCanvasElement;
    this.mediaPool = this.root.querySelector("#media-pool") as HTMLElement;
    this.debugHost = document.createElement("div");
    this.debugHost.id = "debug-host";
    this.statusHost = document.createElement("div");
    this.statusHost.id = "status-host";
    document.body.append(this.debugHost, this.statusHost);
    this.paths = await loadRuntime();
    this.appVersion = await readAppVersion();
    this.config = this.paths.config;
    this.logPath = this.paths.logPath;
    this.applyDebugQuery();
    this.debugOpen = this.config.features.debugOverlay;
    this.session = createSession(this.config.roster.default);
    this.compositor = new Compositor(this.canvas, this.config.output.width, this.config.output.height);
    this.compositor.onError = (error) => this.logError("webgl", error);
    this.logLine(
      `boot version=${this.appVersion} config=${this.paths.configPath} assets=${this.paths.assetRoot || "(none)"} bundled=${this.paths.bundledAssetRoot || "(none)"}`,
    );
    const configuredAttract = this.config.assets.attractVideo.trim();
    if (configuredAttract && !attractVideoSource(configuredAttract)) {
      this.logLine(`attract video ignored legacy placeholder ${configuredAttract}`);
    }
    if (this.paths.assetOverrideRoot) {
      this.logLine(`asset override ${this.paths.assetOverrideRoot}`);
    }
    void this.loadVitesseOverride();
    this.bind();
    this.scheduleFit();
    await this.loadRoster();
    await this.prefetchReferencedAssets();
    await this.loadStillImages();
    this.applyFixture();
    this.render();
    await this.refreshDevices();
    if (this.session.screen === "attract") this.syncAttractCamera();
    if (this.session.screen === "countdown") this.beginCountdown();
  }

  private bind(): void {
    this.bindStageFit();
    this.chrome.addEventListener("click", (event) => this.onClick(event));
    this.stage.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.stage.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.stage.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.stage.addEventListener("pointercancel", (event) => this.onPointerUp(event));
    window.addEventListener("keydown", (event) => this.onKey(event));
    this.debugHost.addEventListener("click", (event) => this.onClick(event));
    window.addEventListener("error", (event) => {
      this.logError("window", event.error ?? event.message);
    });
    window.addEventListener("unhandledrejection", (event) => {
      this.logError("unhandledrejection", event.reason);
    });
    const bump = () => this.armIdle();
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
  }

  private bindStageFit(): void {
    const fit = () => this.scheduleFit();
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    if (this.viewport) new ResizeObserver(fit).observe(this.viewport);
    if (document.readyState === "complete") fit();
    else window.addEventListener("load", fit, { once: true });
    requestAnimationFrame(() => {
      fit();
      requestAnimationFrame(fit);
    });
    if (!isTauri()) return;
    void this.listenForNativeFit();
  }

  private async listenForNativeFit(): Promise<void> {
    try {
      const win = getCurrentWindow();
      await win.onResized(({ payload }) => {
        void this.fitPhysical(payload.width, payload.height);
      });
      await win.onScaleChanged((event) => {
        const size = readPhysicalSize(event.payload.size);
        const logical = size ? logicalWindowSize(size.width, size.height, event.payload.scaleFactor) : null;
        if (!logical) {
          this.scheduleFit();
          return;
        }
        this.fitGeneration += 1;
        if (!this.applyStageScale(logical.width, logical.height)) this.scheduleFit();
      });
    } catch (error) {
      this.logError("stage fit", error);
    }
  }

  private scheduleFit(): void {
    const generation = ++this.fitGeneration;
    this.fitViewport();
    if (!isTauri()) return;
    void this.fitNative(generation);
  }

  private async fitPhysical(width: number, height: number): Promise<void> {
    const generation = ++this.fitGeneration;
    try {
      const factor = await getCurrentWindow().scaleFactor();
      if (generation !== this.fitGeneration) return;
      const logical = logicalWindowSize(width, height, factor);
      if (logical && this.applyStageScale(logical.width, logical.height)) return;
    } catch (error) {
      if (generation !== this.fitGeneration) return;
      this.logError("stage fit", error);
    }
    if (generation === this.fitGeneration) this.fitViewport();
  }

  private async fitNative(generation: number): Promise<void> {
    try {
      const win = getCurrentWindow();
      const [factor, size] = await Promise.all([win.scaleFactor(), win.innerSize()]);
      if (generation !== this.fitGeneration) return;
      const logical = logicalWindowSize(size.width, size.height, factor);
      if (logical && this.applyStageScale(logical.width, logical.height)) return;
    } catch (error) {
      if (generation !== this.fitGeneration) return;
      this.logError("stage fit", error);
    }
    if (generation === this.fitGeneration) this.fitViewport();
  }

  private fitViewport(): void {
    const box = this.viewportBox();
    if (!box) return;
    this.applyStageScale(box.width, box.height);
  }

  private viewportBox(): { width: number; height: number } | null {
    const candidates = [
      this.measuredBox(this.viewport?.clientWidth, this.viewport?.clientHeight),
      this.measuredBox(window.visualViewport?.width, window.visualViewport?.height),
      this.measuredBox(window.innerWidth, window.innerHeight),
    ];
    for (const candidate of candidates) {
      if (candidate) return candidate;
    }
    return null;
  }

  private measuredBox(width: number | undefined, height: number | undefined): { width: number; height: number } | null {
    if (width === undefined || height === undefined || stageScale(width, height) === null) return null;
    return { width, height };
  }

  private applyStageScale(width: number, height: number): boolean {
    const transform = stageTransform(width, height);
    if (!transform) return false;
    this.stage.style.transform = transform;
    return true;
  }

  private async loadRoster(): Promise<void> {
    const file = this.config.assets.rosterFile;
    const url = await this.resolvedUrl(file);
    if (!url) throw new Error(`Roster not found (${file})`);
    const response = await fetch(url);
    if (!response.ok) {
      this.noteMissingAsset(file);
      throw new Error(`Roster not found at ${url}`);
    }
    this.roster = (await response.json()) as RosterFile;
  }

  private async prefetchReferencedAssets(): Promise<void> {
    const files = referencedAssetPaths(this.roster, this.config);
    await Promise.all(files.map((file) => this.resolveHit(file)));
  }

  private async loadStillImages(): Promise<void> {
    const [guest, frame] = await Promise.all([
      this.loadSafeImage("placeholders/guest.png"),
      this.loadSafeImage(this.config.assets.takeawayFrame),
      this.loadBackground(),
    ]);
    this.guestImage = guest;
    this.frameImage = frame;
  }

  private async loadBackground(): Promise<void> {
    const relative = this.config.assets.background.trim();
    this.backgroundUrl = null;
    this.backgroundWidth = 0;
    this.backgroundHeight = 0;
    if (!relative) {
      this.logLine("background fallback #002554 (assets.background is empty)");
      return;
    }
    const direct = await this.resolvedUrl(relative);
    if (!direct) {
      this.logLine(`background fallback #002554 ${relative}`);
      return;
    }
    try {
      const blob = await fetchAssetBlob(direct, 8000);
      const url = URL.createObjectURL(blob);
      const image = await loadImage(url);
      if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        URL.revokeObjectURL(url);
        throw new Error(`empty image ${relative}`);
      }
      this.backgroundUrl = url;
      this.backgroundWidth = image.naturalWidth;
      this.backgroundHeight = image.naturalHeight;
      const root = this.assetHits.get(normalizeAssetKey(relative))?.root ?? "";
      this.logLine(`background ${relative} ${image.naturalWidth}x${image.naturalHeight} root=${root}`);
    } catch (error) {
      this.logLine(`background fallback #002554 ${relative}`);
      this.logError(`background ${relative}`, error);
    }
  }

  private applyDebugQuery(): void {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    if (mode === "touch" || mode === "qr") {
      this.config = { ...this.config, start: { mode } };
    }
    if (params.get("paintThrows") === "1") this.paintThrows = true;
    if (params.get("webm") === "1") this.preferWebm = true;
    const scan = params.get("scan");
    if (scan) {
      this.config = {
        ...this.config,
        debug: { ...this.config.debug, simulateScanUrl: scan },
      };
    }
    const assets = params.get("assets");
    if (assets && /^https?:\/\//i.test(assets)) {
      this.paths = { ...this.paths, assetRoot: assets.replace(/\/$/, "") };
    }
    const rotation = { ...this.config.attract.rotation };
    const hold = Number(params.get("holdMs"));
    const outMs = Number(params.get("outMs"));
    const inMs = Number(params.get("inMs"));
    const offsetX = Number(params.get("offsetX"));
    if (params.has("holdMs") && Number.isFinite(hold) && hold >= 0) rotation.holdMs = hold;
    if (params.has("outMs") && Number.isFinite(outMs) && outMs >= 0) rotation.outMs = outMs;
    if (params.has("inMs") && Number.isFinite(inMs) && inMs >= 0) rotation.inMs = inMs;
    if (params.has("offsetX") && Number.isFinite(offsetX)) rotation.offsetX = offsetX;
    if (params.get("keyWhite") === "1") rotation.keyWhite = true;
    if (params.get("keyWhite") === "0") rotation.keyWhite = false;
    this.config = { ...this.config, attract: { rotation } };
    const still = params.get("still");
    if (still && /^https?:\/\//i.test(still)) this.attractOverrideFile = still;
  }

  private applyFixture(): void {
    const params = new URLSearchParams(window.location.search);
    const screen = params.get("screen");
    if (!screen || !this.roster) return;
    const roster = params.get("team") === "womens" ? "womens" : this.config.roster.default;
    this.session = { ...createSession(roster, "fixture"), roster };
    if (screen === "attract") return;
    if (this.config.start.mode === "touch") {
      this.session = reduceSession(this.session, { type: "touchStart", sessionId: "fixture" });
    } else {
      const raw = this.config.debug.simulateScanUrl;
      const participantId = extractParticipantId(raw, this.config.qr.participantId) ?? "";
      this.session = reduceSession(this.session, {
        type: "scan",
        url: raw,
        participantId,
        sessionId: "fixture",
      });
    }
    if (params.get("team") === "womens" && this.session.roster !== "womens") {
      this.session = reduceSession(this.session, { type: "toggleRoster" });
    }
    const count = Number(params.get("select") ?? (screen === "pick" ? "1" : "2"));
    const athletes = this.roster.teams[this.session.roster];
    for (let i = 0; i < Math.min(count, athletes.length); i += 1) {
      this.session = reduceSession(this.session, {
        type: "toggleAthlete",
        id: athletes[i].id,
        max: this.config.roster.maxSelections,
      });
    }
    if (screen === "pick") return;
    this.goLetsGo();
    if (screen === "countdown") return;
    if (screen === "flash") {
      this.session = reduceSession(this.session, { type: "flash" });
      this.flashOpacity = 0.85;
      return;
    }
    this.session = reduceSession(this.session, { type: "flash" });
    this.session = reduceSession(this.session, { type: "flashDone" });
    if (screen === "adjust") return;
    this.session = reduceSession(this.session, { type: "allDone" });
    if (screen === "preview") return;
    this.session = reduceSession(this.session, { type: "send" });
  }

  private dispatch(event: SessionEvent): void {
    const previous = this.session.screen;
    this.session = reduceSession(this.session, event);
    if (previous !== this.session.screen) this.onScreenChanged(previous);
    this.render();
  }

  private onScreenChanged(previous: Session["screen"]): void {
    if (previous === "countdown" || previous === "flash") this.pauseClips();
    if (!this.screenNeedsFrames()) this.stopFrames();
    if (this.session.screen === "attract") {
      this.stopPhoto();
      this.frozenCamera = null;
      this.syncAttractCamera();
    } else {
      this.stopQr();
    }
    if (this.session.screen === "countdown") this.beginCountdown();
    if (this.session.screen === "thanks") this.armThanks();
    else window.clearTimeout(this.thanksTimer);
    this.armIdle();
  }

  private render(): void {
    const view = this.view();
    this.chrome.innerHTML = renderChrome(view);
    const mode = canvasMode(this.session.screen);
    this.placeCanvas(mode);
    this.mountQrVideo();
    this.syncAttractRotation();
    this.punchPreviewHole();
    this.renderDebugPanel();
    this.renderStatusStrip();
    if (mode !== "hidden") {
      try {
        this.safePaint();
      } catch (error) {
        this.logError("paint", error);
      }
    }
  }

  private renderDebugPanel(): void {
    this.debugHost.innerHTML = renderDebug(this.view());
    this.refreshDebugLive();
  }

  private refreshDebugLive(): void {
    const live = this.debugHost.querySelector("#debug-live");
    if (!live) return;
    live.textContent = `${this.videoStatusText()}\n${this.logLines.slice(-8).join("\n")}`.trim();
  }

  private renderStatusStrip(): void {
    const missing = this.missingAssets;
    let text = "";
    if (missing.length > 0) {
      const extra = missing.length > 1 ? ` (+${missing.length - 1} more)` : "";
      text = `Missing asset ${missing[missing.length - 1]}${extra}`;
    } else {
      text = [...this.logLines].reverse().find((line) => line.includes(" ERROR ")) ?? "";
    }
    this.statusHost.innerHTML = text ? `<div class="status-strip">${escapeHtml(text)}</div>` : "";
  }

  private view(): ViewModel {
    return {
      config: this.config,
      session: this.session,
      roster: this.roster,
      assetUrl: (relative) => this.displayAssetUrl(relative),
      qrError: this.qrError,
      scanNotice: this.scanNotice,
      photoError: this.photoError,
      showStillThere: this.showStillThere,
      uploadStatus: this.uploadStatus,
      debugOpen: this.debugOpen,
      cameraSummary: this.cameraSummary(),
      preferWebm: this.preferWebm,
      configPath: this.paths?.configPath ?? "",
      assetRoot: this.paths?.assetRoot ?? "",
      bundledAssetRoot: this.paths?.bundledAssetRoot ?? "",
      missingAssets: this.missingAssets,
      logPath: this.logPath || this.paths?.logPath || "",
      hasPhoto: Boolean(this.photoVideo || this.frozenCamera),
      flashOpacity: this.flashOpacity,
      measuredClips: Object.fromEntries(this.measuredClips),
      backgroundUrl: this.backgroundUrl,
      backgroundWidth: this.backgroundWidth,
      backgroundHeight: this.backgroundHeight,
      version: this.appVersion,
    };
  }

  private cameraSummary(): string {
    const labels = this.devices.map((device) => device.label || device.deviceId.slice(0, 6)).join(", ");
    const listed = this.paths?.cameras.cameras.length
      ? ` · rust ${this.paths.cameras.cameras.map((camera) => `${camera.label}${camera.serial ? ` #${camera.serial}` : ""}`).join(", ")}`
      : "";
    return (labels || "none") + listed;
  }

  private onClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "touch-start") this.startTouch();
    else if (action === "simulate-scan") this.simulateScan();
    else if (action === "swap-team") this.dispatch({ type: "toggleRoster" });
    else if (action === "toggle-athlete" && target.dataset.id) {
      this.dispatch({
        type: "toggleAthlete",
        id: target.dataset.id,
        max: this.config.roster.maxSelections,
      });
      this.prewarmSelected();
    } else if (action === "lets-go") this.goLetsGo();
    else if (action === "go-back") this.dispatch({ type: "goBack" });
    else if (action === "try-again") this.tryAgain();
    else if (action === "all-done") this.dispatch({ type: "allDone" });
    else if (action === "send") void this.send();
    else if (action === "start-over") this.reset();
    else if (action === "scale") this.nudgeScale(Number(target.dataset.dir ?? "1"));
    else if (action === "toggle-webm") {
      this.preferWebm = !this.preferWebm;
      this.dropClips();
      this.render();
    } else if (action === "toggle-plusminus") {
      this.config = {
        ...this.config,
        features: { ...this.config.features, plusMinusButtons: !this.config.features.plusMinusButtons },
      };
      this.render();
    }
  }

  private onKey(event: KeyboardEvent): void {
    const key = event.key;
    if ((key === "n" || key === "N") && this.session.screen === "countdown") {
      event.preventDefault();
      this.skipCountdown();
      return;
    }
    if (!this.config.debug.allowKeyboard) return;
    if (key === "F2") {
      event.preventDefault();
      this.debugOpen = !this.debugOpen;
      this.render();
      return;
    }
    if (key === "f" || key === "F") {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      void setFullscreen(!document.fullscreenElement);
      return;
    }
    if (key === "Escape") {
      this.reset();
      return;
    }
    if (key === "Backspace") {
      this.dispatch({ type: "goBack" });
      return;
    }
    if (key === "s" || key === "S") {
      if (this.session.screen === "attract") {
        if (this.config.start.mode === "touch") this.startTouch();
        else this.simulateScan();
      }
      return;
    }
    if (key === "Enter") {
      this.primaryAction();
      return;
    }
    if (this.session.screen === "pick" && /^[1-9]$/.test(key)) {
      const athlete = this.roster?.teams[this.session.roster][Number(key) - 1];
      if (athlete) {
        this.dispatch({
          type: "toggleAthlete",
          id: athlete.id,
          max: this.config.roster.maxSelections,
        });
      }
      return;
    }
    if (this.session.screen !== "adjust") return;
    if (key === "Tab") {
      event.preventDefault();
      this.cycleAthlete();
      return;
    }
    if (key === "[") this.nudgeScale(-1);
    if (key === "]") this.nudgeScale(1);
    const step = event.shiftKey ? 40 : 16;
    if (key === "ArrowLeft") this.nudge(-step, 0);
    if (key === "ArrowRight") this.nudge(step, 0);
    if (key === "ArrowUp") this.nudge(0, -step);
    if (key === "ArrowDown") this.nudge(0, step);
  }

  private primaryAction(): void {
    if (this.session.screen === "attract") {
      if (this.config.start.mode === "touch") this.startTouch();
      return;
    }
    if (this.session.screen === "pick" && this.session.selectedIds.length > 0) this.goLetsGo();
    else if (this.session.screen === "adjust") this.dispatch({ type: "allDone" });
    else if (this.session.screen === "preview") void this.send();
  }

  private startTouch(): void {
    if (this.config.start.mode !== "touch" || this.session.screen !== "attract") return;
    this.dispatch({ type: "touchStart", sessionId: crypto.randomUUID() });
  }

  private simulateScan(): void {
    if (this.session.screen !== "attract" || this.config.start.mode !== "qr") return;
    this.acceptScan(this.config.debug.simulateScanUrl);
  }

  private acceptScan(raw: string): void {
    if (this.session.screen !== "attract" || this.config.start.mode !== "qr") return;
    const text = raw.trim();
    if (!text) return;
    const participantId = extractParticipantId(text, this.config.qr.participantId);
    if (!participantId) {
      this.logLine(`scan rejected raw=${text}`);
      this.scanNotice = "NO PARTICIPANT ID";
      this.render();
      window.clearTimeout(this.scanNoticeTimer);
      this.scanNoticeTimer = window.setTimeout(() => {
        this.scanNotice = null;
        if (this.session.screen === "attract") this.render();
      }, 4000);
      return;
    }
    this.scanNotice = null;
    window.clearTimeout(this.scanNoticeTimer);
    this.logLine(`scan participant_id=${participantId} raw=${text}`);
    this.dispatch({
      type: "scan",
      url: text,
      participantId,
      sessionId: crypto.randomUUID(),
    });
  }

  private reset(): void {
    this.dispatch({ type: "startOver", roster: this.config.roster.default });
  }

  private goLetsGo(): void {
    if (!this.roster || this.session.selectedIds.length === 0) return;
    const sides = chooseSides(
      this.session.selectedIds,
      this.config.athletes.singleSelectionSide,
      Math.random,
    );
    const transforms = this.transformsFor(sides);
    for (const id of this.session.selectedIds) this.ensureClip(id, sides[id]);
    this.dispatch({
      type: "letsGo",
      sides,
      transforms,
      countdownFrom: this.config.timing.countdownFrom,
    });
  }

  private tryAgain(): void {
    const transforms = this.transformsFor(this.session.sides);
    for (const id of this.session.selectedIds) this.ensureClip(id, this.session.sides[id]);
    this.frozenCamera = null;
    this.dispatch({
      type: "tryAgain",
      countdownFrom: this.config.timing.countdownFrom,
      transforms,
    });
  }

  private transformsFor(sides: Record<string, Side>): Record<string, AthleteTransform> {
    const transforms: Record<string, AthleteTransform> = {};
    if (!this.roster) return transforms;
    for (const [id, side] of Object.entries(sides)) {
      const athlete = findAthlete(this.roster, id);
      if (!athlete) continue;
      const file = athlete.clips[side];
      const size = clipSize(this.view(), file);
      transforms[id] = defaultTransform(
        side,
        this.config.output.width,
        this.config.output.height,
        size,
      );
    }
    return transforms;
  }

  private beginCountdown(): void {
    this.walkStarted = false;
    this.frozen = false;
    this.capturing = false;
    this.frozenCamera = null;
    this.countdownStarted = performance.now();
    void this.openPhoto();
    for (const id of this.session.selectedIds) {
      const clip = this.ensureClip(id, this.session.sides[id]);
      if (!clip) continue;
      clip.still = null;
      clip.presentGeneration += 1;
      this.clearPlaybackWatch(clip);
      this.setPresented(clip, false);
      clip.video.pause();
      rewindIfSeekable(clip.video);
    }
    this.stopCountdownClock();
    this.countdownTimer = window.setInterval(() => this.tickCountdown(), 100);
    this.tickCountdown();
    this.ensurePaintLoop();
  }

  /** Wall clock. A thrown paint cannot stop this interval. */
  private tickCountdown(): void {
    if (this.session.screen !== "countdown") {
      this.stopCountdownClock();
      return;
    }
    const remaining = countdownRemainingMs(
      this.countdownStarted,
      performance.now(),
      this.config.timing.countdownFrom,
    );
    if (countdownDue(remaining)) {
      this.capture();
      return;
    }
    const display = countdownShownSecond(remaining);
    if (display !== this.session.countdown) {
      this.session = reduceSession(this.session, { type: "countdown", seconds: display });
      this.render();
    }
    if (display <= this.config.timing.walkInStartsAt) this.startWalk();
    if (remaining <= this.config.timing.freezeBeforeCaptureMs && !this.frozen) {
      this.frozen = true;
      void this.holdLastFrame();
    }
    this.refreshDebugLive();
  }

  private skipCountdown(): void {
    if (this.session.screen !== "countdown") return;
    this.logLine("skip countdown");
    this.capture();
  }

  private capture(): void {
    if (this.capturing || this.session.screen !== "countdown") return;
    this.capturing = true;
    this.stopCountdownClock();
    void this.finishCapture().catch((error) => {
      this.logError("capture", error);
      if (this.session.screen === "countdown") this.forceFlash();
    });
  }

  private async finishCapture(): Promise<void> {
    try {
      await Promise.race([this.holdLastFrame(), wait(800)]);
    } catch (error) {
      this.logError("holdLastFrame", error);
    }
    if (this.session.screen !== "countdown") {
      this.capturing = false;
      return;
    }
    try {
      if (this.photoVideo && this.photoVideo.readyState >= 2 && this.photoVideo.videoWidth > 0) {
        this.frozenCamera = snapshotVideo(this.photoVideo);
      }
    } catch (error) {
      this.logError("camera snapshot", error);
    }
    this.forceFlash();
  }

  private forceFlash(): void {
    if (this.session.screen !== "countdown") return;
    this.pauseClips();
    this.session = reduceSession(this.session, { type: "flash" });
    this.flashOpacity = 0.92;
    this.render();
    this.ensurePaintLoop();
    const started = performance.now();
    const fade = (now: number) => {
      if (this.session.screen !== "flash") return;
      const t = (now - started) / Math.max(1, this.config.timing.flashMs);
      this.flashOpacity = Math.max(0, 0.92 * (1 - t));
      const flash = this.chrome.querySelector<HTMLElement>(".flash");
      if (flash) flash.style.opacity = String(this.flashOpacity);
      this.safePaint();
      if (t < 1) requestAnimationFrame(fade);
      else this.dispatch({ type: "flashDone" });
    };
    requestAnimationFrame(fade);
  }

  private screenNeedsFrames(): boolean {
    return this.session.screen === "countdown" || this.session.screen === "flash";
  }

  private stopFrames(): void {
    cancelAnimationFrame(this.raf);
    this.painting = false;
    this.stopCountdownClock();
  }

  private stopCountdownClock(): void {
    window.clearInterval(this.countdownTimer);
    this.countdownTimer = 0;
  }

  private ensurePaintLoop(): void {
    if (this.painting || !this.screenNeedsFrames()) return;
    this.painting = true;
    const frame = () => {
      if (!this.screenNeedsFrames()) {
        this.painting = false;
        return;
      }
      this.safePaint();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private safePaint(): void {
    try {
      this.paintFrame();
    } catch (error) {
      this.logError("paint", error);
    }
  }

  private paintFrame(): void {
    if (this.paintThrows) throw new Error("debug paint throw");
    const background = this.backgroundLayer();
    const athletes = this.athleteLayers();
    this.compositor.draw(background, athletes);
  }

  private backgroundLayer(): BackgroundLayer | null {
    if (this.frozenCamera) {
      return {
        source: this.frozenCamera,
        mirror: Boolean(this.config.cameras.photo.mirrorPreview),
        width: this.frozenCamera.width,
        height: this.frozenCamera.height,
        fit: "cover",
      };
    }
    if (this.photoVideo && this.photoVideo.videoWidth > 0) {
      return {
        source: this.photoVideo,
        mirror: Boolean(this.config.cameras.photo.mirrorPreview),
        width: this.photoVideo.videoWidth,
        height: this.photoVideo.videoHeight,
        fit: "cover",
      };
    }
    if (this.guestImage) {
      return {
        source: this.guestImage,
        mirror: false,
        width: this.guestImage.naturalWidth,
        height: this.guestImage.naturalHeight,
        fit: "contain",
      };
    }
    return null;
  }

  private athleteLayers(): AthleteLayer[] {
    if (!this.roster) return [];
    const selected = this.session.selectedAdjustId;
    return this.session.selectedIds.flatMap((id) => {
      const side = this.session.sides[id];
      const transform = this.session.transforms[id];
      const clip = this.clips.get(this.clipKey(id, side));
      if (!side || !transform || !clip) return [];
      const kind = athleteSourceKind({
        screen: this.session.screen,
        presented: clip.presented,
        hasStill: Boolean(clip.still),
        videoReady: clip.video.readyState >= 2 && sourceIsCanvasSafe(clip.video),
        hasPoster: Boolean(clip.poster && sourceIsCanvasSafe(clip.poster)),
      });
      let source: CanvasImageSource | null;
      switch (kind) {
        case "hidden":
          source = null;
          break;
        case "still":
          source = clip.still;
          break;
        case "video":
          source = clip.video;
          break;
        case "poster":
          source = clip.poster;
          break;
        default: {
          const neverKind: never = kind;
          source = neverKind;
        }
      }
      if (!source || clip.width <= 0 || clip.height <= 0) return [];
      const adjusting = this.session.screen === "adjust";
      return [{
        source,
        layout: clip.layout,
        transform,
        clipWidth: clip.width,
        clipHeight: clip.height,
        gray: adjusting && selected !== id,
        outline: adjusting && selected === id,
      }];
    });
  }

  private activeClips(): LoadedClip[] {
    return this.session.selectedIds
      .map((id) => this.clips.get(this.clipKey(id, this.session.sides[id])))
      .filter((clip): clip is LoadedClip => Boolean(clip));
  }

  private pauseClips(): void {
    for (const clip of this.activeClips()) clip.video.pause();
  }

  /** Park every selected clip on its last frame, which is the pose held for the still. */
  private async holdLastFrame(): Promise<void> {
    const waits = this.activeClips().map((clip) => this.parkOnLastFrame(clip));
    if (waits.length === 0) return;
    await Promise.all(waits);
    this.safePaint();
  }

  private parkOnLastFrame(clip: LoadedClip): Promise<void> {
    const video = clip.video;
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.currentTime >= video.duration - 0.08) {
      video.pause();
      clip.still = snapshotVideo(video);
      return Promise.resolve();
    }
    const target = Math.max(0, video.duration - 0.05);
    const canSeek = mediaIsSeekable(
      video.seekable.length,
      video.seekable.length > 0 ? video.seekable.end(video.seekable.length - 1) : 0,
    ) && video.seekable.end(video.seekable.length - 1) >= target;
    if (canSeek) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          video.removeEventListener("seeked", onSeeked);
          video.pause();
          clip.still = snapshotVideo(video);
          resolve();
        };
        const onSeeked = () => {
          // The decoded frame lags the seeked event by a paint.
          requestAnimationFrame(() => requestAnimationFrame(finish));
        };
        video.addEventListener("seeked", onSeeked);
        window.setTimeout(finish, 700);
        try {
          video.currentTime = target;
        } catch {
          finish();
        }
      });
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        video.removeEventListener("ended", finish);
        video.pause();
        clip.still = snapshotVideo(video);
        resolve();
      };
      video.addEventListener("ended", finish);
      video.playbackRate = 16;
      void video.play().catch(() => finish());
      window.setTimeout(finish, 1200);
    });
  }

  private clipKey(id: string, side: Side | undefined): string {
    return `${id}:${side ?? ""}:${this.preferWebm ? "webm" : "mp4"}`;
  }

  private ensureClip(id: string, side: Side | undefined): LoadedClip | null {
    if (!this.roster || !side) return null;
    const key = this.clipKey(id, side);
    const existing = this.clips.get(key);
    if (existing) return existing;
    const athlete = findAthlete(this.roster, id);
    if (!athlete) return null;
    const webm = side === "left" ? athlete.clips.leftWebm : athlete.clips.rightWebm;
    const mp4 = athlete.clips[side];
    const file = this.preferWebm && webm ? webm : mp4;
    const meta = this.roster.clipMeta?.[file];
    const layout: AlphaLayout = resolveClipLayout(file, meta?.layout);
    const sizedFromMeta = Boolean(meta?.width && meta?.height);
    const measured = this.measuredClips.get(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.width = meta?.width ?? measured?.width ?? 360;
    video.height = (meta?.height ?? measured?.height ?? 640) * (layout === "stacked-alpha" ? 2 : 1);
    const poster = document.createElement("img");
    const clip: LoadedClip = {
      id,
      side,
      video,
      poster,
      still: null,
      layout,
      file,
      width: sizedFromMeta ? meta!.width : measured?.width ?? 0,
      height: sizedFromMeta ? meta!.height : measured?.height ?? 0,
      sourceNote: "loading",
      blobUrl: null,
      generation: 1,
      triedWebm: Boolean(this.preferWebm && webm),
      sizedFromMeta,
      presented: false,
      presentGeneration: 0,
      onTime: null,
    };
    video.dataset.presented = "0";
    video.addEventListener("playing", () => this.onClipPlaying(clip));
    video.addEventListener("loadedmetadata", () => this.noteClipSize(clip));
    video.addEventListener("loadeddata", () => {
      this.noteClipSize(clip);
      this.logLine(`clip ready ${clip.file} readyState=${video.readyState} ${video.videoWidth}x${video.videoHeight} ${clip.sourceNote}`);
      this.revealClip(clip);
    });
    video.addEventListener("error", () => {
      const code = video.error?.code ?? 0;
      this.logError(`clip ${clip.file}`, `media error ${code}`);
      if (webm && !clip.triedWebm) {
        clip.triedWebm = true;
        clip.layout = "vp9-alpha";
        clip.generation += 1;
        void this.attachClipVideo(clip, webm, clip.generation);
        return;
      }
      this.fallBackToPoster(clip);
    });
    poster.addEventListener("load", () => this.revealClip(clip));
    this.mediaPool.append(video, poster);
    this.clips.set(key, clip);
    void this.attachPoster(clip, posterPath(file));
    void this.attachClipVideo(clip, file, clip.generation);
    return clip;
  }

  private noteClipSize(clip: LoadedClip): void {
    const size = measuredColorSize(clip.layout, clip.video.videoWidth, clip.video.videoHeight);
    if (size.height <= 0) return;
    this.measuredClips.set(clip.file, size);
    if (clip.sizedFromMeta) return;
    if (clip.width === size.width && clip.height === size.height) return;
    const previous = { width: clip.width, height: clip.height };
    clip.width = size.width;
    clip.height = size.height;
    if (this.session.sides[clip.id] !== clip.side) return;
    const current = this.session.transforms[clip.id];
    if (!current) return;
    const next = transformForMeasuredSize(
      clip.side,
      this.config.output.width,
      this.config.output.height,
      previous,
      size,
      current,
    );
    this.session = reduceSession(this.session, { type: "setTransform", id: clip.id, transform: next });
    if (this.session.screen !== "attract" && this.session.screen !== "pick" && this.session.screen !== "thanks") {
      this.render();
    }
  }

  private async attachClipVideo(clip: LoadedClip, file: string, generation: number): Promise<void> {
    const direct = await this.resolvedUrl(file);
    if (!direct) {
      this.fallBackToPoster(clip);
      return;
    }
    clip.file = file;
    clip.sourceNote = "loading";
    try {
      const blob = await fetchAssetBlob(direct, 8000);
      if (generation !== clip.generation) return;
      if (clip.blobUrl) URL.revokeObjectURL(clip.blobUrl);
      const url = URL.createObjectURL(blob);
      clip.blobUrl = url;
      clip.sourceNote = "blob";
      this.assignVideoSrc(clip, url);
      this.logLine(`clip blob ${file} bytes=${blob.size}`);
    } catch (error) {
      if (generation !== clip.generation) return;
      this.logError(`clip blob ${file}`, error);
      clip.sourceNote = "direct";
      this.assignVideoSrc(clip, direct);
      this.logLine(`clip direct ${file}`);
      this.armPosterFallback(clip, generation);
    }
  }

  private assignVideoSrc(clip: LoadedClip, url: string): void {
    clip.video.src = url;
    clip.video.load();
  }

  private armPosterFallback(clip: LoadedClip, generation: number): void {
    window.setTimeout(() => {
      if (generation !== clip.generation) return;
      if (clip.video.readyState >= 2 && clip.video.videoWidth > 0) return;
      this.logLine(`clip timeout ${clip.file} readyState=${clip.video.readyState}`);
      this.fallBackToPoster(clip);
    }, 4500);
  }

  private fallBackToPoster(clip: LoadedClip): void {
    clip.sourceNote = "poster";
    clip.generation += 1;
    if (clip.blobUrl) {
      URL.revokeObjectURL(clip.blobUrl);
      clip.blobUrl = null;
    }
    clip.video.pause();
    clip.video.removeAttribute("src");
    clip.video.load();
    this.logLine(`clip poster ${clip.file}`);
    this.revealClip(clip);
  }

  private revealClip(clip: LoadedClip): void {
    const holding = this.session.screen === "adjust" || this.session.screen === "preview" || this.session.screen === "flash";
    const video = clip.video;
    if (holding && Number.isFinite(video.duration) && video.duration > 0 && video.currentTime < 0.2) {
      const target = Math.max(0, video.duration - 0.05);
      if (mediaIsSeekable(video.seekable.length, video.seekable.length > 0 ? video.seekable.end(0) : 0)) {
        try {
          video.currentTime = target;
        } catch (error) {
          this.logError(`seek ${clip.file}`, error);
        }
      }
    }
    if (this.session.screen !== "attract" && this.session.screen !== "pick" && this.session.screen !== "thanks") {
      this.safePaint();
    }
    this.refreshDebugLive();
  }

  private dropClips(): void {
    for (const clip of this.clips.values()) this.releaseClip(clip);
    this.clips.clear();
  }

  private releaseClip(clip: LoadedClip): void {
    clip.generation += 1;
    clip.presentGeneration += 1;
    this.clearPlaybackWatch(clip);
    clip.video.pause();
    clip.video.removeAttribute("src");
    clip.video.load();
    clip.video.remove();
    clip.poster?.remove();
    if (clip.blobUrl) URL.revokeObjectURL(clip.blobUrl);
  }

  private startWalk(): void {
    if (this.walkStarted) return;
    this.walkStarted = true;
    for (const clip of this.activeClips()) this.playClip(clip);
  }

  private onClipPlaying(clip: LoadedClip): void {
    const generation = clip.presentGeneration;
    const video = clip.video;
    if (playbackFrameReady(true, false, video.currentTime)) {
      this.markPlaybackFrame(clip, generation, "time");
      return;
    }
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => {
        this.markPlaybackFrame(clip, generation, "rvfc");
      });
    }
    this.watchPlaybackTime(clip, generation);
  }

  private watchPlaybackTime(clip: LoadedClip, generation: number): void {
    this.clearPlaybackWatch(clip);
    const video = clip.video;
    const onTime = () => {
      if (video.currentTime <= 0) return;
      this.clearPlaybackWatch(clip);
      this.markPlaybackFrame(clip, generation, "time");
    };
    clip.onTime = onTime;
    video.addEventListener("timeupdate", onTime);
  }

  private clearPlaybackWatch(clip: LoadedClip): void {
    if (!clip.onTime) return;
    clip.video.removeEventListener("timeupdate", clip.onTime);
    clip.onTime = null;
  }

  private markPlaybackFrame(clip: LoadedClip, generation: number, via: "rvfc" | "time"): void {
    if (generation !== clip.presentGeneration || clip.presented) return;
    const fresh = playbackFrameReady(true, via === "rvfc", clip.video.currentTime);
    if (!fresh) return;
    this.setPresented(clip, true);
    this.logLine(`clip presented ${clip.file} via=${via} t=${clip.video.currentTime.toFixed(3)}`);
    if (this.session.screen === "countdown" || this.session.screen === "flash") this.safePaint();
    this.refreshDebugLive();
  }

  private setPresented(clip: LoadedClip, presented: boolean): void {
    clip.presented = presented;
    clip.video.dataset.presented = presented ? "1" : "0";
  }

  private placeCanvas(mode: "hidden" | "full" | "preview"): void {
    this.canvas.className = `mode-${mode}`;
    if (mode !== "preview") {
      this.canvas.style.left = "";
      this.canvas.style.top = "";
      this.canvas.style.transform = "";
      this.canvas.style.transformOrigin = "";
      return;
    }
    const fit = previewFit(STAGE_W, STAGE_H, PHOTO_RECT);
    this.canvas.style.left = `${fit.left}px`;
    this.canvas.style.top = `${fit.top}px`;
    this.canvas.style.transformOrigin = "top left";
    this.canvas.style.transform = `scale(${fit.scale})`;
  }

  private playClip(clip: LoadedClip): void {
    const video = clip.video;
    if (clip.sourceNote === "poster") return;
    if (video.readyState >= 2) {
      void video.play().catch((error) => this.logError(`play ${clip.file}`, error));
      return;
    }
    this.logLine(`clip waiting ${clip.file} readyState=${video.readyState} ${clip.sourceNote}`);
    const onReady = () => {
      video.removeEventListener("loadeddata", onReady);
      if (!this.walkStarted || this.session.screen !== "countdown") return;
      void video.play().catch((error) => this.logError(`play ${clip.file}`, error));
    };
    video.addEventListener("loadeddata", onReady);
  }

  private prewarmSelected(): void {
    for (const id of this.session.selectedIds) {
      this.ensureClip(id, "left");
      this.ensureClip(id, "right");
    }
  }

  private async refreshDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const listed = await navigator.mediaDevices.enumerateDevices();
      this.devices = listed
        .filter((device) => device.kind === "videoinput")
        .map((device) => ({ deviceId: device.deviceId, label: device.label, kind: device.kind }));
    } catch (error) {
      this.logError("enumerateDevices", error);
    }
  }

  private async syncAttractCamera(): Promise<void> {
    this.stopQr();
    if (this.config.start.mode !== "qr" || this.session.screen !== "attract") return;
    await this.refreshDevices();
    const photoPick = matchCamera({
      devices: this.devices,
      listed: this.paths.cameras.cameras,
      role: this.config.cameras.photo,
      onMissing: this.config.cameras.onMissing,
      usedIds: new Set(),
      errorCode: "CAM-PHOTO-01",
    });
    const used = new Set<string>();
    if (photoPick.deviceId) used.add(photoPick.deviceId);
    const qrPick = matchCamera({
      devices: this.devices,
      listed: this.paths.cameras.cameras,
      role: this.config.cameras.qr,
      onMissing: this.config.cameras.onMissing,
      usedIds: used,
      errorCode: "CAM-QR-01",
    });
    // A single webcam belongs to the photo. The side well stays blank.
    if (!qrPick.deviceId || qrPick.deviceId === photoPick.deviceId) {
      this.qrError = qrPick.error ?? "CAM-QR-01  Side camera not found";
      this.render();
      return;
    }
    this.qrError = qrPick.error;
    const video = await openStream(qrPick.deviceId, this.config.cameras.qr);
    if (!video) {
      this.qrError = "CAM-QR-01  Side camera not found";
      this.render();
      return;
    }
    this.qrVideo = video;
    this.qrError = null;
    this.render();
    void this.scanLoop();
  }

  private mountQrVideo(): void {
    const well = this.chrome.querySelector("#qr-well");
    if (well && this.qrVideo) well.appendChild(this.qrVideo);
  }

  private async scanLoop(): Promise<void> {
    const reader = await getQrReader();
    const interval = this.config.cameras.qr.scanIntervalMs ?? 150;
    const tick = async () => {
      if (this.session.screen !== "attract" || !this.qrVideo || !reader) return;
      const frame = grabFrame(this.qrVideo);
      if (frame) {
        const url = await reader(frame).catch(() => null);
        if (url && this.session.screen === "attract") {
          this.acceptScan(url);
          return;
        }
      }
      this.qrTimer = window.setTimeout(() => void tick(), interval);
    };
    this.qrTimer = window.setTimeout(() => void tick(), interval);
  }

  private async openPhoto(): Promise<void> {
    if (this.photoVideo) return;
    await this.refreshDevices();
    const pick = matchCamera({
      devices: this.devices,
      listed: this.paths.cameras.cameras,
      role: this.config.cameras.photo,
      onMissing: this.config.cameras.onMissing,
      usedIds: new Set(this.qrVideo?.srcObject ? [] : []),
      errorCode: "CAM-PHOTO-01",
    });
    if (!pick.deviceId && this.config.cameras.onMissing === "error" && pick.error) {
      this.photoError = pick.error;
      this.render();
      return;
    }
    const video = await openStream(pick.deviceId, this.config.cameras.photo);
    if (!video) {
      this.photoError = "CAM-PHOTO-01  Photo camera not found";
      this.render();
      return;
    }
    this.photoError = null;
    this.photoVideo = video;
    this.logLine(`photo camera readyState=${video.readyState} ${video.videoWidth}x${video.videoHeight}`);
    this.render();
  }

  private stopPhoto(): void {
    stopStream(this.photoVideo);
    this.photoVideo = null;
  }

  private stopQr(): void {
    window.clearTimeout(this.qrTimer);
    stopStream(this.qrVideo);
    this.qrVideo = null;
  }

  private async send(): Promise<void> {
    if (this.sending || this.session.screen !== "preview") return;
    this.sending = true;
    try {
      this.safePaint();
      if (this.config.start.mode === "touch") {
        this.uploadStatus = "discarded (touch mode)";
        this.logLine("upload skipped: touch mode");
        this.dispatch({ type: "send" });
        return;
      }
      const participantId = this.session.participantId ?? "";
      if (!participantId) {
        this.uploadStatus = "skipped (no participant_id)";
        this.logLine("upload skipped: no participant_id");
        this.dispatch({ type: "send" });
        return;
      }
      const blob = await canvasToJpeg(
        this.canvas,
        this.config.output.width,
        this.config.output.height,
        this.frameImage,
        this.config.output.quality,
      );
      const endpoint = uploadEndpoint(this.config.uploader.baseUrl, this.config.uploader.uploadPath);
      const filename = uploadFilename(this.session.sessionId);
      const fields = uploadFields({
        participantId,
        interactiveId: this.config.uploader.interactiveId,
        extraFields: this.config.uploader.extraFields,
        participantUrl: this.session.participantUrl ?? "",
        sessionId: this.session.sessionId,
        capturedAt: new Date().toISOString(),
        athletes: [...this.session.selectedIds],
        roster: this.session.roster,
      });
      const fieldList = Object.entries(fields).map(([name, value]) => ({ name, value }));
      const result = isTauri()
        ? await invoke<UploadResult>("upload_photo", {
            request: {
              endpoint,
              image: Array.from(new Uint8Array(await blob.arrayBuffer())),
              filename,
              fileField: this.config.uploader.fileField,
              fields: fieldList,
              timeoutMs: this.config.uploader.requestTimeoutMs,
            },
          })
        : await postPhoto(
            endpoint,
            blob,
            filename,
            fields,
            this.config.uploader.fileField,
            this.config.uploader.requestTimeoutMs,
          );
      this.noteUpload(result);
      this.dispatch({ type: "send" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.uploadStatus = `failed ${message} (continuing)`;
      this.logLine(`upload failed 0 ${message}`);
      this.dispatch({ type: "send" });
    } finally {
      this.sending = false;
    }
  }

  private noteUpload(result: UploadResult): void {
    const body = responseSnippet(result.body ?? "");
    if (result.ok) {
      this.uploadStatus = `accepted ${result.status}`;
      this.logLine(`upload ${result.status}${body ? ` ${body}` : ""}`);
      return;
    }
    const reason = result.error ?? `HTTP ${result.status}`;
    this.uploadStatus = `failed ${reason} (continuing)`;
    this.logLine(`upload failed ${result.status} ${reason}${body ? ` ${body}` : ""}`);
  }

  private armIdle(): void {
    window.clearTimeout(this.idleTimer);
    window.clearTimeout(this.warningTimer);
    this.showStillThere = false;
    const timeout = idleTimeoutMs(this.session.screen, this.config);
    if (timeout === null) return;
    const warningAt = stillThereMs(this.session.screen, this.config);
    if (warningAt !== null) {
      this.warningTimer = window.setTimeout(() => {
        this.showStillThere = true;
        this.render();
      }, warningAt);
    }
    this.idleTimer = window.setTimeout(() => {
      this.dispatch({ type: "idle", roster: this.config.roster.default });
    }, timeout);
  }

  private armThanks(): void {
    window.clearTimeout(this.thanksTimer);
    const timeout = thanksTimeoutMs(this.config);
    this.thanksTimer = window.setTimeout(() => {
      this.dispatch({ type: "thanksDone", roster: this.config.roster.default });
    }, timeout);
  }

  private outputPoint(event: PointerEvent): PointerPoint {
    const rect = this.stage.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * this.config.output.width;
    const y = ((event.clientY - rect.top) / rect.height) * this.config.output.height;
    return { x, y };
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.session.screen !== "adjust") return;
    if ((event.target as HTMLElement).closest("button")) return;
    const point = this.outputPoint(event);
    this.pointers.set(event.pointerId, point);
    this.stage.setPointerCapture(event.pointerId);
    const hit = this.athleteAt(point.x, point.y);
    if (hit) {
      this.session = reduceSession(this.session, { type: "selectAdjust", id: hit });
      this.drag = { id: hit, lastX: point.x, lastY: point.y };
      this.render();
    }
    if (this.pointers.size === 2 && this.config.features.multitouchAdjust && this.session.selectedAdjustId) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        id: this.session.selectedAdjustId,
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startScale: this.session.transforms[this.session.selectedAdjustId]?.scale ?? 1,
      };
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    const point = this.outputPoint(event);
    this.pointers.set(event.pointerId, point);
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const current = this.session.transforms[this.pinch.id];
      if (!current || this.pinch.startDist <= 0) return;
      const next = clampTransform(
        { ...current, scale: this.pinch.startScale * (dist / this.pinch.startDist) },
        this.config.output.width,
        this.config.output.height,
      );
      this.session = reduceSession(this.session, { type: "setTransform", id: this.pinch.id, transform: next });
      this.render();
      this.safePaint();
      return;
    }
    if (!this.drag || this.pointers.size !== 1) return;
    const current = this.session.transforms[this.drag.id];
    if (!current) return;
    const next = clampTransform(
      {
        ...current,
        x: current.x + (point.x - this.drag.lastX),
        y: current.y + (point.y - this.drag.lastY),
      },
      this.config.output.width,
      this.config.output.height,
    );
    this.drag.lastX = point.x;
    this.drag.lastY = point.y;
    this.session = reduceSession(this.session, { type: "setTransform", id: this.drag.id, transform: next });
    this.render();
    this.safePaint();
  }

  private onPointerUp(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) this.drag = null;
  }

  private athleteAt(x: number, y: number): string | null {
    if (!this.roster) return null;
    const ordered = [...this.session.selectedIds].reverse();
    for (const id of ordered) {
      const side = this.session.sides[id];
      const transform = this.session.transforms[id];
      const athlete = findAthlete(this.roster, id);
      if (!side || !transform || !athlete) continue;
      const size = clipSize(this.view(), athlete.clips[side]);
      if (hitTest(x, y, transform, size)) return id;
    }
    return null;
  }

  private nudge(dx: number, dy: number): void {
    const id = this.session.selectedAdjustId;
    if (!id) return;
    const current = this.session.transforms[id];
    if (!current) return;
    const next = clampTransform(
      { ...current, x: current.x + dx, y: current.y + dy },
      this.config.output.width,
      this.config.output.height,
    );
    this.session = reduceSession(this.session, { type: "setTransform", id, transform: next });
    this.render();
    this.safePaint();
  }

  private nudgeScale(direction: number): void {
    const id = this.session.selectedAdjustId;
    if (!id) return;
    const current = this.session.transforms[id];
    if (!current) return;
    const next = clampTransform(
      { ...current, scale: current.scale * (direction > 0 ? 1.08 : 1 / 1.08) },
      this.config.output.width,
      this.config.output.height,
    );
    this.session = reduceSession(this.session, { type: "setTransform", id, transform: next });
    this.render();
    this.safePaint();
  }

  private cycleAthlete(): void {
    const ids = this.session.selectedIds;
    if (ids.length === 0) return;
    const index = Math.max(0, ids.indexOf(this.session.selectedAdjustId ?? ids[0]));
    const next = ids[(index + 1) % ids.length];
    this.session = reduceSession(this.session, { type: "selectAdjust", id: next });
    this.render();
    this.safePaint();
  }

  private punchPreviewHole(): void {
    if (this.session.screen !== "preview") return;
    const bg = this.chrome.querySelector(".bg");
    if (!(bg instanceof HTMLElement)) return;
    bg.style.clipPath = previewHole(STAGE_W, STAGE_H, PHOTO_RECT);
  }

  private displayAssetUrl(relative: string): string {
    const key = normalizeAssetKey(relative);
    if (!key) return "";
    const cached = this.blobbedAssets.get(key);
    if (cached) return cached;
    const hit = this.assetHits.get(key);
    if (!hit) {
      void this.resolveHit(key).then(() => this.queueAssetRefresh());
      return pendingAssetSrc(key);
    }
    if (!hit.found) return pendingAssetSrc(key);
    const direct = assetHitUrl(this.paths.tauri, hit);
    if (isImagePath(key) && direct && !urlIsCanvasSafe(direct)) {
      void this.localAssetUrl(key).then((url) => {
        if (url && url !== direct) this.queueAssetRefresh();
      });
    }
    return direct;
  }

  private queueAssetRefresh(): void {
    window.clearTimeout(this.assetRefresh);
    this.assetRefresh = window.setTimeout(() => this.render(), 40);
  }

  private async localAssetUrl(relative: string, required = true): Promise<string | null> {
    const key = normalizeAssetKey(relative);
    const cached = this.blobbedAssets.get(key);
    if (cached) return cached;
    const direct = await this.resolvedUrl(key, required);
    if (!direct) return null;
    if (urlIsCanvasSafe(direct)) return direct;
    let pending = this.localAssets.get(key);
    if (!pending) {
      pending = this.fetchLocalAsset(key, direct);
      this.localAssets.set(key, pending);
    }
    return pending;
  }

  private async fetchLocalAsset(relative: string, direct: string): Promise<string | null> {
    try {
      const blob = await fetchAssetBlob(direct, 8000);
      const url = URL.createObjectURL(blob);
      this.blobbedAssets.set(relative, url);
      return url;
    } catch (error) {
      const missing = error instanceof Error && /asset fetch 404/.test(error.message);
      if (missing) this.noteMissingAsset(relative);
      else this.logError(`image ${relative}`, error);
      return null;
    }
  }

  private async loadSafeImage(relative: string): Promise<HTMLImageElement | null> {
    return loadImage(await this.localAssetUrl(relative));
  }

  private async attachPoster(clip: LoadedClip, file: string): Promise<void> {
    const url = await this.localAssetUrl(file, false);
    if (!url || !clip.poster) return;
    clip.poster.src = url;
  }

  private videoStatusText(): string {
    const gl = this.compositor
      ? `webgl ${this.compositor.usingWebGL ? "on" : "off"}${this.compositor.contextLost ? " lost" : ""}`
      : "webgl ?";
    const photo = this.photoVideo
      ? `photo ready=${this.photoVideo.readyState} ${this.photoVideo.videoWidth}x${this.photoVideo.videoHeight}`
      : "photo (none)";
    const clips = this.activeClips();
    const rows = clips.length === 0
      ? ["clips (none)"]
      : clips.map((clip) => {
          const video = clip.video;
          const err = video.error ? ` mediaError=${video.error.code}` : "";
          const duration = Number.isFinite(video.duration) ? video.duration.toFixed(2) : "?";
          return `${clip.file} ${clip.sourceNote} ready=${video.readyState} t=${video.currentTime.toFixed(2)}/${duration} shown=${clip.presented ? 1 : 0}${err}`;
        });
    return [gl, photo, ...rows].join("\n");
  }

  private logLine(message: string): void {
    const line = formatLogLine(new Date(), message);
    this.logLines = remember(this.logLines, line, 40);
    console.warn(line);
    if (this.debugHost) this.refreshDebugLive();
    if (this.statusHost) this.renderStatusStrip();
    void this.persistLog(line);
  }

  private logError(where: string, error: unknown): void {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const key = `${where}: ${detail}`;
    const now = performance.now();
    const prev = this.recentLogs.get(key) ?? Number.NEGATIVE_INFINITY;
    if (now - prev < 2000) return;
    this.recentLogs.set(key, now);
    this.logLine(`ERROR ${key}`);
  }

  private async persistLog(line: string): Promise<void> {
    if (!isTauri()) return;
    try {
      const path = await invoke<string>("append_log", { line });
      if (path && path !== this.logPath) {
        this.logPath = path;
        this.refreshDebugLive();
      }
    } catch (error) {
      console.warn("append_log failed", error);
    }
  }

  private async loadVitesseOverride(): Promise<void> {
    if (!this.paths.tauri) return;
    for (const file of VITESSE_FONT_FILES) {
      const hit = await this.resolveHit(file, false);
      if (!hit.found) continue;
      const url = assetHitUrl(true, hit);
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength < 16) continue;
        const face = new FontFace("Vitesse Override", buffer, { weight: "700", style: "normal" });
        await face.load();
        document.fonts.add(face);
        document.documentElement.style.setProperty("--vitesse-family", '"Vitesse Override", "Vitesse"');
        this.logLine(`vitesse override ${file} root=${hit.root}`);
        return;
      } catch (error) {
        this.logError(`vitesse ${file}`, error);
      }
    }
  }

  private attractSource(): AttractStill[] {
    if (this.attractOverrideFile) return [{ id: "override", file: this.attractOverrideFile }];
    return collectAttractStills(this.roster);
  }

  private ensureAttractOrder(): void {
    if (this.attractOrder.length > 0) return;
    this.attractOrder = shuffleAttractOrder(this.attractSource(), Math.random);
    this.attractCursor = 0;
  }

  private currentAttract(): AttractStill | null {
    if (this.attractOrder.length === 0) return null;
    return this.attractOrder[this.attractCursor] ?? null;
  }

  private nextAttract(): AttractStill | null {
    if (this.attractOrder.length === 0) return null;
    return this.attractOrder[(this.attractCursor + 1) % this.attractOrder.length] ?? null;
  }

  private advanceAttract(): void {
    if (this.attractOrder.length === 0) return;
    const previous = this.currentAttract()?.id ?? "";
    if (this.attractCursor + 1 >= this.attractOrder.length) {
      this.attractOrder = shuffleAttractOrder(this.attractSource(), Math.random, previous);
      this.attractCursor = 0;
      return;
    }
    this.attractCursor += 1;
  }

  private stopAttractRotation(): void {
    if (this.attractPhase === "idle" && this.attractTimer === 0) return;
    window.clearTimeout(this.attractTimer);
    this.attractTimer = 0;
    this.attractToken += 1;
    this.attractPhase = "idle";
  }

  private syncAttractRotation(): void {
    if (this.session.screen !== "attract") {
      this.stopAttractRotation();
      return;
    }
    this.ensureAttractOrder();
    if (!this.config.attract.rotation.enabled) {
      this.stopAttractRotation();
      void this.warmAttract(this.currentAttract());
      this.paintAttractPlayer(false);
      return;
    }
    if (this.attractPhase === "idle") {
      if (this.attractOrder.length === 0) return;
      void this.warmAttract(this.currentAttract());
      void this.warmAttract(this.nextAttract());
      this.beginAttractHold();
      return;
    }
    const slide = this.chrome.querySelector<HTMLElement>(".player-slide");
    if (!slide || slide.dataset.phase !== this.attractPhase) this.paintAttractPlayer(false);
  }

  private beginAttractHold(): void {
    this.attractPhase = "hold";
    this.paintAttractPlayer(false);
    const token = this.attractToken;
    this.attractTimer = window.setTimeout(() => {
      if (token !== this.attractToken || this.session.screen !== "attract") return;
      this.beginAttractOut();
    }, this.config.attract.rotation.holdMs);
  }

  private beginAttractOut(): void {
    this.attractPhase = "out";
    this.paintAttractPlayer(true);
    const token = this.attractToken;
    this.attractTimer = window.setTimeout(() => {
      void this.finishAttractOut(token);
    }, this.config.attract.rotation.outMs);
  }

  private async finishAttractOut(token: number): Promise<void> {
    if (token !== this.attractToken || this.session.screen !== "attract") return;
    this.advanceAttract();
    await this.warmAttract(this.currentAttract());
    if (token !== this.attractToken || this.session.screen !== "attract") return;
    this.beginAttractIn(token);
  }

  private beginAttractIn(token: number): void {
    this.attractPhase = "out";
    this.paintAttractPlayer(false);
    requestAnimationFrame(() => {
      if (token !== this.attractToken || this.session.screen !== "attract") return;
      this.attractPhase = "in";
      this.paintAttractPlayer(true);
      this.attractTimer = window.setTimeout(() => {
        if (token !== this.attractToken || this.session.screen !== "attract") return;
        this.beginAttractHold();
      }, this.config.attract.rotation.inMs);
    });
  }

  private paintAttractPlayer(animate: boolean): void {
    const slide = this.chrome.querySelector<HTMLElement>(".player-slide");
    const img = this.chrome.querySelector<HTMLImageElement>(".player-still");
    if (!slide || !img) return;
    const still = this.currentAttract();
    const url = still ? this.attractCache.get(still.file) ?? "" : "";
    if (url) {
      img.src = url;
      img.dataset.file = still?.file ?? "";
    }
    const phase = this.attractPhase === "out" ? "out" : "in";
    const rotation = this.config.attract.rotation;
    slide.style.transition = animate ? attractSlideTransition(phase, rotation.outMs, rotation.inMs) : "none";
    slide.style.transform = attractSlideTransform(phase, rotation.offsetX);
    slide.dataset.phase = this.attractPhase;
  }

  private async warmAttract(still: AttractStill | null): Promise<void> {
    if (!still || this.session.screen !== "attract") return;
    const url = await this.cachedAttractUrl(still.file);
    if (!url || this.session.screen !== "attract") return;
    if (this.currentAttract()?.file !== still.file) return;
    const img = this.chrome.querySelector<HTMLImageElement>(".player-still");
    if (img && img.dataset.file !== still.file) this.paintAttractPlayer(false);
  }

  private cachedAttractUrl(file: string): Promise<string | null> {
    const cached = this.attractCache.get(file);
    if (cached) return Promise.resolve(cached);
    const pending = this.attractPending.get(file);
    if (pending) return pending;
    const token = this.attractToken;
    const job = this.fetchAttractUrl(file).then((url) => {
      this.attractPending.delete(file);
      if (!url) return null;
      if (token !== this.attractToken || this.session.screen !== "attract") {
        URL.revokeObjectURL(url);
        return null;
      }
      this.attractCache.set(file, url);
      return url;
    });
    this.attractPending.set(file, job);
    return job;
  }

  private async fetchAttractUrl(file: string): Promise<string | null> {
    try {
      const blob = /^https?:\/\//i.test(file)
        ? await fetchAssetBlob(file, 8000)
        : await this.fetchAttractBlob(file);
      const url = await keyedStillUrl(blob, this.config.attract.rotation.keyWhite);
      try {
        await decodeImage(url);
      } catch (error) {
        this.logError(`attract still decode ${file}`, error);
      }
      return url;
    } catch (error) {
      const missing = error instanceof Error && error.message.startsWith("missing still");
      if (!missing) this.logError(`attract still ${file}`, error);
      return null;
    }
  }

  private async fetchAttractBlob(relative: string): Promise<Blob> {
    const direct = await this.resolvedUrl(relative);
    if (!direct) throw new Error(`missing still ${relative}`);
    return fetchAssetBlob(direct, 8000);
  }

  private resolveHit(relative: string, required = true): Promise<AssetHit> {
    const key = normalizeAssetKey(relative);
    const cached = this.assetHits.get(key);
    if (cached) {
      if (required && !cached.found) this.noteMissingAsset(key);
      return Promise.resolve(cached);
    }
    const pending = this.assetPending.get(key);
    if (pending) {
      return pending.then((hit) => {
        if (required && !hit.found) this.noteMissingAsset(key);
        return hit;
      });
    }
    const job = this.fetchHit(key, required);
    this.assetPending.set(key, job);
    return job;
  }

  private async fetchHit(key: string, required: boolean): Promise<AssetHit> {
    let hit: AssetHit;
    try {
      hit = await resolveAsset(this.paths, key);
    } catch (error) {
      this.logError(`asset ${key}`, error);
      hit = { relative: key, path: "", root: "", found: false };
    }
    this.assetPending.delete(key);
    this.assetHits.set(key, hit);
    if (hit.found) {
      if (this.paths.tauri) this.logLine(assetServedMessage(key, hit.root));
    } else if (required) {
      this.noteMissingAsset(key);
    }
    return hit;
  }

  private async resolvedUrl(relative: string, required = true): Promise<string> {
    const hit = await this.resolveHit(relative, required);
    if (!hit.found) return "";
    return assetHitUrl(this.paths.tauri, hit);
  }

  private noteMissingAsset(relative: string): void {
    const key = normalizeAssetKey(relative);
    if (!key || this.missingAssets.includes(key)) return;
    this.missingAssets.push(key);
    this.logError(`asset ${key}`, assetMissingMessage());
  }
}

function snapshotVideo(video: HTMLVideoElement): HTMLCanvasElement | null {
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0);
  } catch {
    return null;
  }
  return canvas;
}

function rewindIfSeekable(video: HTMLVideoElement): void {
  const end = video.seekable.length > 0 ? video.seekable.end(video.seekable.length - 1) : 0;
  if (!mediaIsSeekable(video.seekable.length, end)) return;
  try {
    video.currentTime = 0;
  } catch {
    // Seeking can throw before the media element accepts a position.
  }
}

function posterPath(file: string): string {
  return file.replace(/\.mp4$|\.webm$/, ".png");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function openStream(
  deviceId: string | null,
  role: AppConfig["cameras"]["photo"],
): Promise<HTMLVideoElement | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  const videoConstraints = (exact: boolean): MediaTrackConstraints => {
    const video: MediaTrackConstraints = {
      width: { ideal: role.width },
      height: { ideal: role.height },
      frameRate: { ideal: role.fps },
    };
    if (deviceId) video.deviceId = exact ? { exact: deviceId } : deviceId;
    return video;
  };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints(true) });
    return attach(stream);
  } catch {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints(false) });
      return attach(stream);
    } catch {
      return null;
    }
  }
}

async function attach(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  return video;
}

function stopStream(video: HTMLVideoElement | null): void {
  const stream = video?.srcObject;
  if (stream instanceof MediaStream) {
    for (const track of stream.getTracks()) track.stop();
  }
  if (video) video.srcObject = null;
}

function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
