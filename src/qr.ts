import { isHttpUrl } from "./cameras";
import readerWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

export interface QrReader {
  (image: ImageData): Promise<string | null>;
}

let readerPromise: Promise<QrReader | null> | null = null;

async function loadReader(): Promise<QrReader | null> {
  try {
    const module = await import("zxing-wasm/reader");
    module.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith(".wasm") ? readerWasmUrl : `${prefix}${path}`,
      },
    });
    return async (image: ImageData) => {
      const results = await module.readBarcodes(image, {
        formats: ["QRCode"],
        tryHarder: true,
        maxNumberOfSymbols: 1,
      });
      for (const result of results) {
        const text = result.text?.trim();
        if (text && isHttpUrl(text)) return text;
      }
      return null;
    };
  } catch (error) {
    console.warn("QR decoder failed to load", error);
    return null;
  }
}

export function getQrReader(): Promise<QrReader | null> {
  if (!readerPromise) readerPromise = loadReader();
  return readerPromise;
}

export function grabFrame(video: HTMLVideoElement, maxWidth = 640): ImageData | null {
  if (video.readyState < 2 || video.videoWidth === 0) return null;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}
