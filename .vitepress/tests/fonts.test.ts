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
const FONT_DISPLAY_SWAP = "swap";

// Both families are variable fonts (one woff2 per subset spans the axis), so each
// face must declare the weight range the theme uses rather than a single weight.
const VARIABLE_WEIGHT_RANGE_PATTERN = /font-weight:\s*400\s+700\s*;/;
// Quote-style-agnostic so a Prettier change can't break the format assertion.
const WOFF2_FORMAT_PATTERN = /format\(\s*["']woff2["']\s*\)/;
// woff2 files start with the "wOF2" magic, so a truncated download or a renamed
// HTML error page fails loud instead of silently falling back to a system font.
const WOFF2_SIGNATURE = "wOF2";

// Neither origin may reappear anywhere in the head once fonts are self-hosted.
const GOOGLE_FONTS_ORIGINS = [
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];

const FAMILY_PATTERN = /font-family:\s*["']([^"']+)["']/;
const DISPLAY_PATTERN = /font-display:\s*([a-z-]+)/;
// Quotes are optional in CSS url(), so accept url(x), url('x') and url("x").
const FONT_URL_PATTERN = /url\(\s*["']?([^"')]+)["']?\s*\)/;

function readFontFaces() {
  // The /g regex is created per call so its lastIndex never leaks between calls.
  const fontFacePattern = /@font-face\s*\{([^}]*)\}/g;
  const css = readFileSync(FONTS_CSS_PATH, "utf8");
  const faces = [];
  let match;
  while ((match = fontFacePattern.exec(css))) {
    const body = match[1];
    const family = (body.match(FAMILY_PATTERN) || [])[1];
    const url = (body.match(FONT_URL_PATTERN) || [])[1];
    faces.push({
      family,
      url,
      display: (body.match(DISPLAY_PATTERN) || [])[1],
      raw: body,
      // A compact label keeps the it.each titles readable (the raw body is multiline).
      label: `${family} ${url}`,
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

// Drop the ?v= cache-bust query before resolving to a path on disk.
function publicPathForFontUrl(fontUrl: string) {
  const withoutQuery = fontUrl.split("?")[0];
  return resolve(PUBLIC_DIR, withoutQuery.replace(/^\//, ""));
}

function readWoff2Signature(filePath: string) {
  return readFileSync(filePath)
    .subarray(0, WOFF2_SIGNATURE.length)
    .toString("latin1");
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

  it.each(faces)(
    "serves $label first-party as a variable woff2 with display swap",
    (face) => {
      expect(face.url, "src url").toBeDefined();
      expect(face.url.startsWith(LOCAL_FONT_PATH_PREFIX), face.url).toBe(true);
      expect(face.raw).toMatch(WOFF2_FORMAT_PATTERN);
      expect(face.raw).toMatch(VARIABLE_WEIGHT_RANGE_PATTERN);
      expect(face.display).toBe(FONT_DISPLAY_SWAP);
    },
  );

  it.each(faces)("resolves $label to a real woff2 under public", (face) => {
    const fontFilePath = publicPathForFontUrl(face.url);
    expect(isRealFileWithExactCase(fontFilePath), face.url).toBe(true);
    expect(readWoff2Signature(fontFilePath), face.url).toBe(WOFF2_SIGNATURE);
  });

  it("loads no remote font origin from any @font-face src", () => {
    // Scan the declarations, not comments: a refresh-instruction comment may
    // cite the Google Fonts URL, but nothing the browser actually fetches may.
    const declarations = faces.map((face) => face.raw).join("\n");
    for (const origin of GOOGLE_FONTS_ORIGINS) {
      expect(declarations, origin).not.toContain(origin);
    }
  });
});

describe("theme wiring", () => {
  it("imports the self-hosted font stylesheet so the faces load", () => {
    const index = readFileSync(THEME_INDEX_PATH, "utf8");
    expect(index).toContain('"./fonts.css"');
  });
});

describe("head no longer loads Google Fonts", () => {
  it("declares no Google Fonts preconnect or stylesheet link", () => {
    const head = headAsText();
    for (const origin of GOOGLE_FONTS_ORIGINS) {
      expect(head, origin).not.toContain(origin);
    }
  });

  it("keeps base at root so the root-absolute font urls resolve", () => {
    expect(config.base ?? "/", "root-absolute font urls assume base '/'").toBe(
      "/",
    );
  });
});

// The preload hrefs in config.ts duplicate the fonts.css urls (including the ?v=
// cache-bust), so a stale version or a deleted preload would silently double-fetch
// or drop the early hint. These assertions keep the two files in lockstep.
const LATIN_SUBSET_MARKER = "-latin.woff2";
const FONT_MIME_TYPE = "font/woff2";

function preloadedFontAttributes(): Record<string, string>[] {
  const head = config.head ?? [];
  return head
    .filter(([tag]) => tag === "link")
    .map(([, attributes]) => (attributes ?? {}) as Record<string, string>)
    .filter(
      (attributes) => attributes.rel === "preload" && attributes.as === "font",
    );
}

describe("self-hosted font preloads", () => {
  const faces = readFontFaces();
  const declaredUrls = new Set(faces.map((face) => face.url));
  const familyByUrl = new Map(faces.map((face) => [face.url, face.family]));
  const preloads = preloadedFontAttributes();
  const preloadRows = preloads.map((attributes) => [
    attributes.href,
    attributes,
  ]);

  it("preloads exactly one latin subset per family", () => {
    // Check per-family coverage, not just the count: two preloads of the same
    // family (with the other dropped) must not pass.
    const preloadedFamilies = preloads.map((attributes) =>
      familyByUrl.get(attributes.href),
    );
    expect([...new Set(preloadedFamilies)].sort()).toEqual(
      [...EXPECTED_FAMILIES].sort(),
    );
  });

  it.each(preloadRows)(
    "preloads %s against a declared @font-face url",
    (href, attributes) => {
      const preloadAttributes = attributes as Record<string, string>;
      // A stale ?v= drops the href out of the declared set and fails here.
      expect(declaredUrls, href as string).toContain(href);
      expect(href as string).toContain(LATIN_SUBSET_MARKER);
      expect(preloadAttributes.type, "type").toBe(FONT_MIME_TYPE);
      // Font fetches are always CORS-mode; a missing crossorigin double-fetches.
      expect(preloadAttributes.crossorigin, "crossorigin").toBeDefined();
    },
  );
});

// Any @import or scoped <style> pulling from Google Fonts would now be blocked
// by the tightened CSP with no test failure and only a console error, so couple
// the CSP change to the removal of every last theme reference.
const STYLE_SOURCE_EXTENSIONS = [".css", ".vue"];

function collectThemeStyleFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      return collectThemeStyleFiles(entryPath);
    }
    const isStyleSource = STYLE_SOURCE_EXTENSIONS.some((extension) =>
      entry.name.endsWith(extension),
    );
    return isStyleSource ? [entryPath] : [];
  });
}

// Strip comments so a refresh-instruction comment citing the Google Fonts URL is
// not mistaken for a resource the browser actually loads.
function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

// index.md is the only content file outside the theme dir that can carry inline
// styles or an @import, so it is scanned alongside the theme stylesheets.
const CONTENT_INDEX = resolve(process.cwd(), "index.md");

function collectFirstPartyScanTargets() {
  return [...collectThemeStyleFiles(THEME_DIR), CONTENT_INDEX];
}

describe("theme stylesheets stay first-party", () => {
  it("finds theme stylesheets to scan", () => {
    // A zero-length it.each below would report as passing and cover nothing.
    expect(collectThemeStyleFiles(THEME_DIR).length).toBeGreaterThan(0);
  });

  it.each(collectFirstPartyScanTargets())(
    "%s references no Google Fonts origin",
    (filePath) => {
      const contents = stripComments(readFileSync(filePath, "utf8"));
      for (const origin of GOOGLE_FONTS_ORIGINS) {
        expect(contents, origin).not.toContain(origin);
      }
    },
  );
});
