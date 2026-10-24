/// <reference types="node" />
import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import { countdownDue, countdownRemainingMs, countdownShownSecond } from "./clock";
import { formatLogLine, remember } from "./log";
import { fetchAssetBlob, mediaIsSeekable, type AssetFetch } from "./media";

describe("countdown clock", () => {
  it("counts from wall time and reaches zero without a video clock", () => {
    const started = 1_000;
    expect(countdownRemainingMs(started, started, 10)).toBe(10_000);
    expect(countdownShownSecond(10_000)).toBe(10);
    expect(countdownShownSecond(9_900)).toBe(10);
    expect(countdownShownSecond(9_000)).toBe(9);
    expect(countdownShownSecond(1)).toBe(1);
    expect(countdownDue(0)).toBe(true);
    expect(countdownDue(-5)).toBe(true);
    expect(countdownDue(1)).toBe(false);
  });
});

describe("asset blob fetch", () => {
  it("aborts a hung download", async () => {
    const hung: AssetFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
        });
      });
    await expect(fetchAssetBlob("http://asset.localhost/athletes/m01_left.mp4", 30, hung)).rejects.toThrow(/aborted/i);
  });

  it("rejects an empty body", async () => {
    const empty: AssetFetch = async () => ({ ok: true, status: 200, blob: async () => new Blob([]) });
    await expect(fetchAssetBlob("http://asset.localhost/athletes/m01_left.mp4", 1000, empty)).rejects.toThrow(/empty/);
  });

  it("reads a whole file from a server that does not honor range requests", async () => {
    const server = createServer((request, response) => {
      if (request.headers.range) {
        response.writeHead(200, { "Content-Type": "video/mp4" });
        response.end(Buffer.from("ranged"));
        return;
      }
      response.writeHead(200, { "Content-Type": "video/mp4", "Accept-Ranges": "none" });
      response.end(Buffer.from("full-clip"));
    });
    const port = await listen(server);
    try {
      const blob = await fetchAssetBlob(`http://127.0.0.1:${port}/athletes/m01_left.mp4`, 2000);
      expect(await blob.text()).toBe("full-clip");
    } finally {
      await close(server);
    }
  });

  it("treats an empty seekable range as not seekable", () => {
    expect(mediaIsSeekable(0, 0)).toBe(false);
    expect(mediaIsSeekable(1, 0)).toBe(false);
    expect(mediaIsSeekable(1, 4)).toBe(true);
  });
});

describe("debug log", () => {
  it("keeps a bounded ring and one line per event", () => {
    let lines: string[] = [];
    for (let i = 0; i < 5; i += 1) lines = remember(lines, `line ${i}`, 3);
    expect(lines).toEqual(["line 2", "line 3", "line 4"]);
    const stamped = formatLogLine(new Date("2026-10-24T12:00:00.000Z"), "ERROR paint:\nbad");
    expect(stamped).toBe("2026-10-24T12:00:00.000Z ERROR paint: bad");
  });
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("test server has no port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
