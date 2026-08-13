import { describe, it, expect } from "vitest";
import { readFileSync, statSync, readdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import config from "../config";

const THEME_DIR = resolve(process.cwd(), ".vitepress/theme");
const FONTS_CSS_PATH = resolve(THEME_DIR, "fonts.css");
const THEME_INDEX_PATH = resolve(THEME_DIR, "index.ts");
const PUBLIC_DIR = resolve(process.cwd(), "public");

// The two families the theme uses (see --font-display / --font-mono in style.css).
const EXPECTED_FAMILIES = ["Space Grotesk", "JetBrains Mono"];

// Self-hosted fonts must be served first-party from /public/fonts and stay
// non-blocking via font-display: swap.
const LOCAL_FONT_PATH_PREFIX = "/fonts/";
const WOFF2_FORMAT = 'format("woff2")';
const FONT_DISPLAY_SWAP = "swap";

// Neither origin may reappear anywhere in the head once fonts are self-hosted.
const GOOGLE_FONTS_ORIGINS = [
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];

const FONT_FACE_PATTERN = /@font-face\s*\{([^}]*)\}/g;
const FONT_URL_PATTERN = /url\(["']([^"')]+)["']\)/;
const FAMILY_PATTERN = /font-family:\s*["']([^"']+)["']/;
const DISPLAY_PATTERN = /font-display:\s*([a-z-]+)/;

function readFontFaces() {
  const css = readFileSync(FONTS_CSS_PATH, "utf8");
  const faces = [];
  let match;
  while ((match = FONT_FACE_PATTERN.exec(css))) {
    const body = match[1];
    faces.push({
      family: (body.match(FAMILY_PATTERN) || [])[1],
      display: (body.match(DISPLAY_PATTERN) || [])[1],
      url: (body.match(FONT_URL_PATTERN) || [])[1],
      raw: body,
    });
  }
  return faces;
}

// Case-exact existence check: macOS (APFS) is case-insensitive, the deployed
// Linux host is not, so a case mismatch would 404 only in production.
function isRealFileWithExactCase(filePath: string) {
  const stats = statSync(filePath, { throwIfNoEntry: false });
  if (!stats?.isFile()) {
    return false;
  }
  return readdirSync(dirname(filePath)).includes(basename(filePath));
}

function publicPathForFontUrl(fontUrl: string) {
  return resolve(PUBLIC_DIR, fontUrl.replace(/^\//, ""));
}

function headAsText() {
  return JSON.stringify(config.head ?? []);
}

describe("self-hosted @font-face declarations", () => {
  const faces = readFontFaces();

  it("declares at least one @font-face per expected family", () => {
    for (const family of EXPECTED_FAMILIES) {
      const familyFaces = faces.filter((face) => face.family === family);
      expect(familyFaces.length, family).toBeGreaterThan(0);
    }
  });

  it("only declares the expected families", () => {
    const families = new Set(faces.map((face) => face.family));
    expect([...families].sort()).toEqual([...EXPECTED_FAMILIES].sort());
  });

  it.each(readFontFaces())(
    "serves %o first-party as a local woff2 with display swap",
    (face) => {
      expect(face.url, "src url").toBeDefined();
      expect(face.url.startsWith(LOCAL_FONT_PATH_PREFIX), face.url).toBe(true);
      expect(face.raw).toContain(WOFF2_FORMAT);
      expect(face.display).toBe(FONT_DISPLAY_SWAP);
    },
  );

  it.each(readFontFaces())(
    "resolves %o to a real woff2 under public",
    (face) => {
      expect(
        isRealFileWithExactCase(publicPathForFontUrl(face.url)),
        face.url,
      ).toBe(true);
    },
  );

  it("loads no remote font origin from any @font-face src", () => {
    // Scan the declarations, not comments: a refresh-instruction comment may
    // cite the Google Fonts URL, but nothing the browser actually fetches may.
    const declarations = readFontFaces()
      .map((face) => face.raw)
      .join("\n");
    for (const origin of GOOGLE_FONTS_ORIGINS) {
      expect(declarations, origin).not.toContain(origin);
    }
  });
});

describe("theme wiring", () => {
  it("imports the self-hosted font stylesheet before the theme styles", () => {
    const index = readFileSync(THEME_INDEX_PATH, "utf8");
    const fontsImportIndex = index.indexOf('"./fonts.css"');
    const styleImportIndex = index.indexOf('"./style.css"');
    expect(fontsImportIndex, "fonts.css import").toBeGreaterThanOrEqual(0);
    expect(styleImportIndex, "style.css import").toBeGreaterThanOrEqual(0);
    expect(fontsImportIndex).toBeLessThan(styleImportIndex);
  });
});

describe("head no longer loads Google Fonts", () => {
  it("declares no Google Fonts preconnect or stylesheet link", () => {
    const head = headAsText();
    for (const origin of GOOGLE_FONTS_ORIGINS) {
      expect(head, origin).not.toContain(origin);
    }
  });
});
