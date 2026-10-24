import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

function contentType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

/** Serve repo assets and config during `vite` / `tauri dev` without copying them. */
function serveTree(urlPrefix: string, dir: string): Plugin {
  const prefix = urlPrefix.endsWith("/") ? urlPrefix.slice(0, -1) : urlPrefix;
  return {
    name: `serve-${prefix.replace(/\W/g, "")}`,
    configureServer(server) {
      server.middlewares.use(prefix, (req, res, next) => {
        const raw = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const rel = raw.replace(/^\/+/, "");
        const file = path.resolve(dir, rel);
        if (!file.startsWith(path.resolve(dir))) {
          next();
          return;
        }
        if (!existsSync(file) || statSync(file).isDirectory()) {
          next();
          return;
        }
        const size = statSync(file).size;
        res.setHeader("Content-Type", contentType(file));
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "no-cache");
        const range = req.headers.range;
        const match = typeof range === "string" ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
        if (!match) {
          res.setHeader("Content-Length", size);
          createReadStream(file).pipe(res);
          return;
        }
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Number(match[2]) : size - 1;
        if (start >= size || end < start) {
          res.statusCode = 416;
          res.setHeader("Content-Range", `bytes */${size}`);
          res.end();
          return;
        }
        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        res.setHeader("Content-Length", end - start + 1);
        createReadStream(file, { start, end }).pipe(res);
      });
    },
  };
}

export default defineConfig({
  clearScreen: false,
  server: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 1420,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    outDir: "dist",
    assetsInlineLimit: 0,
  },
  plugins: [
    serveTree("/kiosk-assets", path.join(root, "assets")),
    serveTree("/kiosk-config", path.join(root, "config")),
  ],
});
