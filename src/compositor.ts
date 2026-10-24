import { sourceIsCanvasSafe } from "./media";
import type { AthleteTransform } from "./types";
import type { Bounds } from "./placement";
import { stackedSampleV } from "./placement";

export type AlphaLayout = "stacked-alpha" | "vp9-alpha" | "straight";

export interface AthleteLayer {
  source: CanvasImageSource;
  layout: AlphaLayout;
  transform: AthleteTransform;
  clipWidth: number;
  clipHeight: number;
  gray: boolean;
  outline: boolean;
}

export interface BackgroundLayer {
  source: CanvasImageSource;
  mirror: boolean;
  /** Intrinsic pixel size, used to fit the frame. */
  width: number;
  height: number;
  fit: "cover" | "contain";
}

const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUv;
out vec2 vUv;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vUv = aUv;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform int uMode;
uniform int uGray;
uniform int uMirror;
uniform vec4 uFill;
void main() {
  vec2 uv = vUv;
  if (uMirror == 1) uv.x = 1.0 - uv.x;
  vec3 rgb;
  float a;
  if (uMode == 1) {
    vec2 colorUv = vec2(uv.x, 0.5 + uv.y * 0.5);
    vec2 alphaUv = vec2(uv.x, uv.y * 0.5);
    rgb = texture(uTex, colorUv).rgb;
    a = texture(uTex, alphaUv).r;
  } else {
    vec4 sampleColor = texture(uTex, uv);
    rgb = sampleColor.rgb;
    a = uMode == 0 ? 1.0 : sampleColor.a;
  }
  if (uGray == 1) {
    float g = dot(rgb, vec3(0.299, 0.587, 0.114));
    rgb = vec3(g * 0.35 + 0.18);
  }
  if (uFill.a > 0.0) rgb = uFill.rgb;
  fragColor = vec4(rgb * a, a);
}`;

interface TextureSlot {
  texture: WebGLTexture;
  source: CanvasImageSource;
}

interface VideoCopy {
  canvas: HTMLCanvasElement;
  drawn: boolean;
}

export class Compositor {
  readonly canvas: HTMLCanvasElement;
  /** Per-frame failures are reported here and do not stop the caller. */
  onError: ((error: unknown) => void) | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private textures = new WeakMap<CanvasImageSource, TextureSlot>();
  private videoCopies = new WeakMap<HTMLVideoElement, VideoCopy>();
  private fallback: CanvasRenderingContext2D | null = null;
  private lost = false;
  readonly width: number;
  readonly height: number;

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext("webgl2", {
      premultipliedAlpha: true,
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      this.fallback = canvas.getContext("2d");
      return;
    }
    this.gl = gl;
    const program = createProgram(gl, VERT, FRAG);
    this.program = program;
    gl.useProgram(program);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
      this.report(new Error("webglcontextlost"));
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
    });
  }

  get usingWebGL(): boolean {
    return this.gl !== null && !this.contextLost;
  }

  get contextLost(): boolean {
    return this.lost || Boolean(this.gl?.isContextLost());
  }

  draw(background: BackgroundLayer | null, athletes: AthleteLayer[]): void {
    try {
      if (this.gl && this.program) {
        if (this.gl.isContextLost()) return;
        this.drawGl(background, athletes);
        return;
      }
      this.draw2d(background, athletes);
    } catch (error) {
      this.report(error);
    }
  }

  private drawGl(background: BackgroundLayer | null, athletes: AthleteLayer[]): void {
    const gl = this.gl;
    const program = this.program;
    if (!gl || !program) return;
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.disable(gl.BLEND);
    if (background && sourceReady(background.source)) {
      try {
        const cover = fitRect(background.fit, background.width, background.height, this.width, this.height);
        this.drawQuad(background.source, cover, 0, false, [0, 0, 0, 0], background.mirror);
      } catch (error) {
        this.report(error);
      }
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const athlete of athletes) {
      if (!sourceReady(athlete.source)) continue;
      try {
        const bounds = layerBounds(athlete);
        if (athlete.outline) {
          const pad = 0.045;
          const outlined: Bounds = {
            left: bounds.left - bounds.width * pad,
            top: bounds.top - bounds.height * pad,
            width: bounds.width * (1 + pad * 2),
            height: bounds.height * (1 + pad * 2),
          };
          const mode = athlete.layout === "stacked-alpha" ? 1 : 2;
          this.drawQuad(athlete.source, outlined, mode, false, [0, 0.675, 0.925, 1], false);
        }
        const mode = athlete.layout === "stacked-alpha" ? 1 : 2;
        this.drawQuad(athlete.source, bounds, mode, athlete.gray, [0, 0, 0, 0], false);
      } catch (error) {
        this.report(error);
      }
    }
  }

  private drawQuad(
    source: CanvasImageSource,
    bounds: Bounds,
    mode: number,
    gray: boolean,
    fill: [number, number, number, number],
    mirror: boolean,
  ): void {
    const gl = this.gl;
    const program = this.program;
    if (!gl || !program || !this.buffer) return;
    const texture = this.textureFor(source);
    if (!texture) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const uTex = gl.getUniformLocation(program, "uTex");
    const uMode = gl.getUniformLocation(program, "uMode");
    const uGray = gl.getUniformLocation(program, "uGray");
    const uMirror = gl.getUniformLocation(program, "uMirror");
    const uFill = gl.getUniformLocation(program, "uFill");
    gl.uniform1i(uTex, 0);
    gl.uniform1i(uMode, mode);
    gl.uniform1i(uGray, gray ? 1 : 0);
    gl.uniform1i(uMirror, mirror ? 1 : 0);
    gl.uniform4f(uFill, fill[0], fill[1], fill[2], fill[3]);
    const data = quadData(bounds, this.width, this.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * WebView2 throws InvalidStateError from texImage2D on an HTMLVideoElement after the first
   * camera frame. Copy the frame to a 2D canvas and upload that instead. A failed copy keeps
   * the previous canvas so one bad frame does not drop the layer forever.
   */
  private frameForUpload(source: CanvasImageSource): CanvasImageSource | null {
    if (!(source instanceof HTMLVideoElement)) return source;
    if (source.readyState < 2 || source.videoWidth === 0 || source.videoHeight === 0) return null;
    let slot = this.videoCopies.get(source);
    if (!slot) {
      slot = { canvas: document.createElement("canvas"), drawn: false };
      this.videoCopies.set(source, slot);
    }
    const canvas = slot.canvas;
    if (canvas.width !== source.videoWidth || canvas.height !== source.videoHeight) {
      canvas.width = source.videoWidth;
      canvas.height = source.videoHeight;
      slot.drawn = false;
    }
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return slot.drawn ? canvas : null;
    if (!sourceIsCanvasSafe(source)) {
      this.report(new Error(`blocked cross-origin video ${source.currentSrc || source.src}`));
      return null;
    }
    try {
      paintVideoFrame(ctx, source, canvas.width, canvas.height);
      slot.drawn = true;
      return canvas;
    } catch (error) {
      this.report(error);
      return slot.drawn ? canvas : null;
    }
  }

  private textureFor(source: CanvasImageSource): WebGLTexture | null {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return null;
    const upload = this.frameForUpload(source);
    if (!upload) return null;
    if (!sourceIsCanvasSafe(upload)) {
      const name = upload instanceof HTMLImageElement ? upload.currentSrc || upload.src : "image";
      this.report(new Error(`blocked cross-origin image ${name}`));
      return null;
    }
    try {
      const existing = this.textures.get(upload);
      if (existing) {
        gl.bindTexture(gl.TEXTURE_2D, existing.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, upload as TexImageSource);
        return existing.texture;
      }
      const texture = gl.createTexture();
      if (!texture) {
        this.report(new Error("Could not create a WebGL texture"));
        return null;
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, upload as TexImageSource);
      this.textures.set(upload, { texture, source: upload });
      return texture;
    } catch (error) {
      this.report(error);
      return null;
    }
  }

  private report(error: unknown): void {
    this.onError?.(error);
  }

  private draw2d(background: BackgroundLayer | null, athletes: AthleteLayer[]): void {
    const ctx = this.fallback ?? this.canvas.getContext("2d");
    if (!ctx) return;
    this.fallback = ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.width, this.height);
    if (background && sourceReady(background.source)) {
      try {
        const cover = fitRect(background.fit, background.width, background.height, this.width, this.height);
        ctx.save();
        if (background.mirror) {
          ctx.translate(this.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(background.source, cover.left, cover.top, cover.width, cover.height);
        ctx.restore();
      } catch (error) {
        this.report(error);
      }
    }
    for (const athlete of athletes) {
      if (!sourceReady(athlete.source)) continue;
      try {
        const bounds = layerBounds(athlete);
        drawAthlete2d(ctx, athlete, bounds);
      } catch (error) {
        this.report(error);
      }
    }
  }
}

export function fitRect(
  fit: "cover" | "contain",
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Bounds {
  const scale =
    fit === "contain"
      ? Math.min(dstW / Math.max(1, srcW), dstH / Math.max(1, srcH))
      : Math.max(dstW / Math.max(1, srcW), dstH / Math.max(1, srcH));
  const width = srcW * scale;
  const height = srcH * scale;
  return {
    left: (dstW - width) / 2,
    top: (dstH - height) / 2,
    width,
    height,
  };
}

function layerBounds(athlete: AthleteLayer): Bounds {
  const width = athlete.clipWidth * athlete.transform.scale;
  const height = athlete.clipHeight * athlete.transform.scale;
  return {
    left: athlete.transform.x - width / 2,
    top: athlete.transform.y - height / 2,
    width,
    height,
  };
}

function sourceReady(source: CanvasImageSource): boolean {
  if (source instanceof HTMLVideoElement) {
    return source.readyState >= 2 && source.videoWidth > 0;
  }
  if (source instanceof HTMLCanvasElement) return source.width > 0;
  if (source instanceof HTMLImageElement) return source.complete && source.naturalWidth > 0;
  return true;
}

function quadData(bounds: Bounds, canvasW: number, canvasH: number): Float32Array {
  const x0 = (bounds.left / canvasW) * 2 - 1;
  const x1 = ((bounds.left + bounds.width) / canvasW) * 2 - 1;
  const y0 = 1 - (bounds.top / canvasH) * 2;
  const y1 = 1 - ((bounds.top + bounds.height) / canvasH) * 2;
  // TRIANGLE_STRIP: top-left, top-right, bottom-left, bottom-right
  // uv.y is 1 at the head (top) and 0 at the feet, matching stackedSampleV.
  return new Float32Array([
    x0, y0, 0, 1,
    x1, y0, 1, 1,
    x0, y1, 0, 0,
    x1, y1, 1, 0,
  ]);
}

function createProgram(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Could not create a WebGL program");
  const vs = compile(gl, gl.VERTEX_SHADER, vert);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.bindAttribLocation(program, 1, "aUv");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "shader link failed");
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "shader compile failed");
  }
  return shader;
}

const maskCanvas = typeof document === "undefined" ? null : document.createElement("canvas");

function drawAthlete2d(ctx: CanvasRenderingContext2D, athlete: AthleteLayer, bounds: Bounds): void {
  if (athlete.layout !== "stacked-alpha") {
    ctx.save();
    if (athlete.gray) ctx.filter = "grayscale(1) brightness(0.7)";
    ctx.drawImage(athlete.source, bounds.left, bounds.top, bounds.width, bounds.height);
    ctx.restore();
    return;
  }
  const scratch = document.createElement("canvas");
  const dw = Math.max(1, Math.round(bounds.width));
  const dh = Math.max(1, Math.round(bounds.height));
  scratch.width = dw;
  scratch.height = dh;
  const sctx = scratch.getContext("2d");
  if (!sctx) return;
  const srcW = sourceWidth(athlete.source);
  const srcH = sourceHeight(athlete.source);
  const colorH = srcH / 2;
  sctx.drawImage(athlete.source, 0, 0, srcW, colorH, 0, 0, dw, dh);
  if (!maskCanvas) return;
  maskCanvas.width = dw;
  maskCanvas.height = dh;
  const mctx = maskCanvas.getContext("2d");
  if (!mctx) return;
  mctx.drawImage(athlete.source, 0, colorH, srcW, colorH, 0, 0, dw, dh);
  const pixels = mctx.getImageData(0, 0, dw, dh);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) data[i + 3] = data[i];
  mctx.putImageData(pixels, 0, 0);
  sctx.globalCompositeOperation = "destination-in";
  sctx.drawImage(maskCanvas, 0, 0);
  sctx.globalCompositeOperation = "source-over";
  if (athlete.outline) {
    ctx.drawImage(scratch, bounds.left - 8, bounds.top - 8, bounds.width + 16, bounds.height + 16);
  }
  if (athlete.gray) ctx.filter = "grayscale(1) brightness(0.7)";
  ctx.drawImage(scratch, bounds.left, bounds.top, bounds.width, bounds.height);
  ctx.filter = "none";
}

/** drawImage() of a WebGL canvas drops the athlete layers in Chromium. readPixels does not. */
function copyWebGL(ctx: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number): boolean {
  if (!(source instanceof HTMLCanvasElement)) return false;
  const gl = source.getContext("webgl2");
  if (!gl || source.width !== width || source.height !== height) return false;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const image = ctx.createImageData(width, height);
  const row = width * 4;
  for (let y = 0; y < height; y += 1) {
    const src = (height - 1 - y) * row;
    image.data.set(pixels.subarray(src, src + row), y * row);
  }
  ctx.putImageData(image, 0, 0);
  return true;
}

function sourceWidth(source: CanvasImageSource): number {
  if (source instanceof HTMLVideoElement) return source.videoWidth;
  if (source instanceof HTMLCanvasElement) return source.width;
  if (source instanceof HTMLImageElement) return source.naturalWidth;
  return 0;
}

function sourceHeight(source: CanvasImageSource): number {
  if (source instanceof HTMLVideoElement) return source.videoHeight;
  if (source instanceof HTMLCanvasElement) return source.height;
  if (source instanceof HTMLImageElement) return source.naturalHeight;
  return 0;
}

/**
 * Transparent pixels must replace the previous frame. source-over leaves the old
 * athlete wherever the new frame is clear, which is the walk-in smear on VP9-alpha.
 * Stacked files are opaque, and clearing them is the same full replace.
 */
export function paintVideoFrame(ctx: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number): void {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  ctx.restore();
}

export async function canvasToJpeg(source: CanvasImageSource, width: number, height: number, frame: CanvasImageSource | null, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Could not create the output canvas");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  try {
    if (!copyWebGL(ctx, source, width, height)) ctx.drawImage(source, 0, 0, width, height);
  } catch {
    // A tainted layer must not discard the rest of the capture.
  }
  if (frame && sourceIsCanvasSafe(frame)) {
    try {
      ctx.drawImage(frame, 0, 0, width, height);
    } catch {
      // The photo still encodes when the frame PNG is cross-origin.
    }
  }
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
  if (!blob) throw new Error("JPEG encode failed");
  return blob;
}

/** Referenced so the UV helper stays the documented contract for the shader. */
export const STACKED_HEAD_SAMPLE = stackedSampleV(1);
