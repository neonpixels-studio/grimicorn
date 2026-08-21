import { afterEach, describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertBuildOutputHasNoDisallowedOrigins,
  findDisallowedOrigins,
  scanBuildOutput,
} from "../scan-origins";
import { DISALLOWED_ORIGINS } from "../origins";

const GOOGLE_FONTS_STYLESHEET = `${DISALLOWED_ORIGINS[0]}/css2?family=Space+Grotesk`;
const CLEAN_HTML = "<link rel='stylesheet' href='/assets/style.css'>";

const createdDirs: string[] = [];

function makeDistDir() {
  const dir = mkdtempSync(join(tmpdir(), "grimicorn-origins-"));
  createdDirs.push(dir);
  return dir;
}

function writeFile(dir: string, relativePath: string, contents: string) {
  const target = join(dir, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, contents);
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("findDisallowedOrigins", () => {
  it("returns nothing for first-party-only text", () => {
    expect(findDisallowedOrigins(CLEAN_HTML)).toEqual([]);
  });

  it("flags a re-introduced Google Fonts origin", () => {
    expect(findDisallowedOrigins(GOOGLE_FONTS_STYLESHEET)).toEqual([
      DISALLOWED_ORIGINS[0],
    ]);
  });

  it("reports every distinct disallowed origin present", () => {
    const text = DISALLOWED_ORIGINS.join(" ");
    expect(findDisallowedOrigins(text).sort()).toEqual(
      [...DISALLOWED_ORIGINS].sort(),
    );
  });
});

describe("scanBuildOutput", () => {
  it("walks nested output and finds no origins in clean HTML/CSS/JS", () => {
    const dir = makeDistDir();
    writeFile(dir, "index.html", CLEAN_HTML);
    writeFile(dir, "assets/style.css", "body{color:#fff}");
    writeFile(dir, "assets/app.js", "console.log('ok')");
    expect(scanBuildOutput(dir)).toEqual([]);
  });

  it("reports the file and origin when a disallowed origin is rendered", () => {
    const dir = makeDistDir();
    writeFile(
      dir,
      "assets/style.css",
      `@import url(${GOOGLE_FONTS_STYLESHEET});`,
    );
    expect(scanBuildOutput(dir)).toEqual([
      { file: join(dir, "assets/style.css"), origin: DISALLOWED_ORIGINS[0] },
    ]);
  });

  it("ignores non-resource files that legitimately cite third-party URLs", () => {
    const dir = makeDistDir();
    // License and namespace files carry unrelated third-party URLs by design and are
    // not fetched as resources, so they stay out of the scan surface.
    writeFile(dir, "fonts/OFL.txt", GOOGLE_FONTS_STYLESHEET);
    writeFile(dir, "sitemap.xml", GOOGLE_FONTS_STYLESHEET);
    expect(scanBuildOutput(dir)).toEqual([]);
  });
});

describe("assertBuildOutputHasNoDisallowedOrigins", () => {
  it("does not throw on clean output", () => {
    const dir = makeDistDir();
    writeFile(dir, "index.html", CLEAN_HTML);
    expect(() => assertBuildOutputHasNoDisallowedOrigins(dir)).not.toThrow();
  });

  it("throws naming the origin and file when one is present", () => {
    const dir = makeDistDir();
    writeFile(dir, "index.html", `<link href="${GOOGLE_FONTS_STYLESHEET}">`);
    expect(() => assertBuildOutputHasNoDisallowedOrigins(dir)).toThrow(
      DISALLOWED_ORIGINS[0],
    );
    expect(() => assertBuildOutputHasNoDisallowedOrigins(dir)).toThrow(
      /index\.html/,
    );
  });
});
