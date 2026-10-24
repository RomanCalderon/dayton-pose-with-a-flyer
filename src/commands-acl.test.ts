import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deniedAssetHit, invokeErrorText } from "./platform";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

function walkTypeScript(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walkTypeScript(full));
    else if (entry.endsWith(".ts")) files.push(full);
  }
  return files;
}

function permissionFor(command: string): string {
  return `allow-${command.replaceAll("_", "-")}`;
}

describe("tauri command permissions", () => {
  it("registers every handler command and every frontend invoke in the manifest and the capability", () => {
    const lib = read("src-tauri/src/lib.rs");
    const handler = lib.match(/generate_handler!\s*\[([\s\S]*?)\]/);
    expect(handler, "invoke_handler").toBeTruthy();
    const fromHandler = [...handler![1].matchAll(/\b([a-z][a-z0-9_]*)\b/g)].map((match) => match[1]);

    const fromInvoke: string[] = [];
    for (const file of walkTypeScript(path.join(root, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/invoke(?:<[^>]*>)?\(\s*["']([a-z0-9_]+)["']/g)) {
        fromInvoke.push(match[1]);
      }
    }

    const build = read("src-tauri/build.rs");
    const manifest = build.match(/commands\(\s*&\[([\s\S]*?)\]/);
    expect(manifest, "build.rs commands").toBeTruthy();
    const fromBuild = [...manifest![1].matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]);

    const capabilities = read("src-tauri/capabilities/default.json");
    const permissions = [...capabilities.matchAll(/"(allow-[a-z0-9-]+)"/g)].map((match) => match[1]);

    const required = [...new Set([...fromHandler, ...fromInvoke])];
    expect(required).toEqual(expect.arrayContaining(["load_config", "resolve_asset", "list_cameras", "upload_photo", "append_log"]));

    const missingBuild = required.filter((command) => !fromBuild.includes(command));
    const missingPermission = required.filter((command) => !permissions.includes(permissionFor(command)));
    expect(missingBuild, "commands missing from build.rs").toEqual([]);
    expect(missingPermission, "commands missing from capabilities/default.json").toEqual([]);
  });
});

describe("denied asset lookup", () => {
  it("keeps the invoke error instead of calling the file missing", () => {
    expect(invokeErrorText("resolve_asset not allowed. Command not found")).toBe(
      "resolve_asset not allowed. Command not found",
    );
    expect(invokeErrorText(new Error("permission denied"))).toBe("permission denied");
    expect(invokeErrorText({ message: "capability missing" })).toBe("capability missing");
    const hit = deniedAssetHit("roster.json", "resolve_asset not allowed");
    expect(hit).toEqual({
      relative: "roster.json",
      path: "",
      root: "",
      found: false,
      error: "resolve_asset not allowed",
    });
    expect(hit.error).toBeTruthy();
  });
});
