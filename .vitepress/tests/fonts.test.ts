import { describe, it, expect } from "vitest";
import { readFileSync, statSync, readdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import config from "../config";
import { DISALLOWED_ORIGINS } from "../origins";

const THEME_DIR = resolve(process.cwd(), ".vitepress/theme");
const THEME_INDEX_PATH = resolve(THEME_DIR, "index.ts");
const STYLE_CSS_PATH = resolve(THEME_DIR, "style.css");
const PUBLIC_DIR = resolve(process.cwd(), "public");

// index.ts pulls the @font-face declarations in via this side-effect stylesheet
// import. The theme wiring test asserts the (comment-stripped) import graph still
// contains it, so a commented-out or renamed import fails CI instead of silently
// shipping a page with no custom fonts. FONTS_CSS_PATH resolves from the same
// specifier so the two stay in lockstep.
const FONTS_STYLESHEET_IMPORT = "./fonts.css";
const FONTS_CSS_PATH = resolve(THEME_DIR, FONTS_STYLESHEET_IMPORT);

// The families are not hand-copied: they derive from the theme's live values so a
// rename in style.css that isn't mirrored in fonts.css (or the preloads) fails CI
// rather than silently falling back to system fonts. The theme renders copy with
// --font-display and code with --font-mono; the first quoted entry in each stack
// is the custom face, the rest are system fallbacks.
const THEME_FONT_VARS = ["--font-display", "--font-mono"];
// Opening and closing quotes must agree (backreference), so a typo'd `"Foo'`
// fails here rather than surfacing later as a confusing font-file lookup miss.
const CUSTOM_FAMILY_PATTERN = /^(["'])([^"']+)\1$/;

// The theme tokens live in style.css's @theme block(s). Scope parsing to those
// blocks, comments stripped, so a redefinition in a scoped/conditional rule
// elsewhere — or a commented-out line that would otherwise win "last declaration" —
// can't stand in for the value the page actually renders with. Tailwind v4 merges
// multiple @theme blocks (later declaration wins), so read every one, not just the
// first, or a second block's override would render a family this test never checks.
// The blocks hold flat token declarations, so a body ends at its first `}`.
const THEME_BLOCK_PATTERN = /@theme\b[^{]*\{([^}]*)\}/g;

function themeBlockBodies(css: string) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...withoutComments.matchAll(THEME_BLOCK_PATTERN)];
  if (!blocks.length) {
    throw new Error("style.css has no @theme block to read font vars from");
  }
  return blocks.map((block) => block[1]).join("\n");
}

function customFamilyForVar(themeBody: string, varName: string) {
  // Anchor on a property boundary so --font-display can't be hijacked by a longer
  // name (--vp-font-display), terminate on ; or } so a semicolon-less declaration
  // doesn't run into the next rule, and take the last match (cascade winner).
  const pattern = new RegExp(`(?:^|[;{\\s])${varName}\\s*:\\s*([^;}]+)`, "g");
  const declarations = [...themeBody.matchAll(pattern)];
  if (!declarations.length) {
    throw new Error(`@theme is missing the ${varName} custom property`);
  }
  const firstEntry = declarations[declarations.length - 1][1]
    .split(",")[0]
    .trim();
  const family = firstEntry.match(CUSTOM_FAMILY_PATTERN);
  if (!family) {
    throw new Error(
      `${varName}'s first family "${firstEntry}" is not a quoted custom face`,
    );
  }
  return family[2];
}

function readThemeFontFamilies() {
  const themeBodies = themeBlockBodies(readFileSync(STYLE_CSS_PATH, "utf8"));
  return THEME_FONT_VARS.map((varName) =>
    customFamilyForVar(themeBodies, varName),
  );
}

// Derived lazily and memoized: a malformed @theme throws, and doing that at module
// scope would abort the whole file — including the DISALLOWED_ORIGINS security
// scans below — so only the family-dependent assertions fail instead.
let cachedThemeFontFamilies: string[] | undefined;
function expectedFamilies() {
  cachedThemeFontFamilies ??= readThemeFontFamilies();
  return cachedThemeFontFamilies;
}

// index.ts imports stylesheets for their side effects; parse the specifiers so the
// wiring test sees a live import, not one buried in a comment. The match is anchored
// to line start (after optional indentation): a commented-out `// import ...` puts
// the marker before `import`, so it can't satisfy the anchor — no `//`-stripping
// (which would corrupt a protocol-relative `import "//cdn/x.css"`) is needed. Block
// comments are stripped first for the `/* import "./fonts.css"; */` case.
const CSS_IMPORT_PATTERN = /^[^\S\n]*import\s+["']([^"']+\.css)["']/gm;

function themeStylesheetImports() {
  const source = readFileSync(THEME_INDEX_PATH, "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  return [...source.matchAll(CSS_IMPORT_PATTERN)].map((match) => match[1]);
}

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

// Neither origin may reappear anywhere in the head once fonts are self-hosted. The
// list is shared with the build-output scan (see .vitepress/origins.ts) so both
// guards move together.
const GOOGLE_FONTS_ORIGINS = DISALLOWED_ORIGINS;

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
    for (const family of expectedFamilies()) {
      const familyFaces = faces.filter((face) => face.family === family);
      expect(familyFaces.length, family).toBeGreaterThan(0);
    }
  });

  it("only declares the expected families", () => {
    const families = new Set(faces.map((face) => face.family));
    expect([...families].sort()).toEqual([...expectedFamilies()].sort());
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

describe("theme font families", () => {
  it("derives a distinct custom family from each theme font var", () => {
    // map() already guarantees the count, so the real drift this guards is two
    // vars resolving to the same family: that would make the derived set a
    // duplicate pair and silently invert the per-family preload assertion below.
    expect(new Set(expectedFamilies()).size).toBe(THEME_FONT_VARS.length);
  });
});

// The parsing helpers are the whole point of this file — they must fail when the
// theme drifts. Exercise their guards directly with inline CSS so a regex
// regression surfaces here instead of silently returning the wrong family.
describe("theme font var parsing", () => {
  it("takes the last declaration (cascade winner) across @theme blocks", () => {
    const css =
      '@theme { --font-display: "First", sans-serif; }\n' +
      '@theme { --font-display: "Last", sans-serif; }';
    expect(customFamilyForVar(themeBlockBodies(css), "--font-display")).toBe(
      "Last",
    );
  });

  it("is not hijacked by a longer property name", () => {
    const css =
      '@theme { --vp-font-display: "Wrong", sans-serif; --font-display: "Right", sans-serif; }';
    expect(customFamilyForVar(themeBlockBodies(css), "--font-display")).toBe(
      "Right",
    );
  });

  it("throws when the first family is unquoted", () => {
    const body = "--font-mono: ui-monospace, monospace;";
    expect(() => customFamilyForVar(body, "--font-mono")).toThrow();
  });

  it("throws when opening and closing quotes disagree", () => {
    const body = "--font-display: \"Mismatch', sans-serif;";
    expect(() => customFamilyForVar(body, "--font-display")).toThrow();
  });

  it("throws when the var is absent", () => {
    expect(() =>
      customFamilyForVar("--color-bg: #000;", "--font-mono"),
    ).toThrow(/missing the --font-mono/);
  });

  it("throws when style.css has no @theme block", () => {
    expect(() => themeBlockBodies(":root { --font-mono: 'X'; }")).toThrow(
      /no @theme block/,
    );
  });
});

describe("theme wiring", () => {
  it("imports the self-hosted font stylesheet as a live (non-comment) import", () => {
    // Comment-stripped, so an `import "./fonts.css"` left commented out fails here
    // instead of passing a bare substring check while the faces never load.
    expect(
      themeStylesheetImports(),
      "theme/index.ts must import ./fonts.css",
    ).toContain(FONTS_STYLESHEET_IMPORT);
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

  it("preloads exactly one latin subset per family with no duplicates", () => {
    // Compare the real, non-deduped preload families against the derived set: a
    // duplicate preload of one family (with the other dropped) fails this equality
    // where a Set comparison would pass. The length check is redundant with it but
    // kept for a clearer failure message when the counts differ.
    const families = expectedFamilies();
    expect(preloads, "one font preload per family").toHaveLength(
      families.length,
    );
    const preloadedFamilies = preloads.map((attributes) =>
      familyByUrl.get(attributes.href),
    );
    expect([...preloadedFamilies].sort()).toEqual([...families].sort());
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
