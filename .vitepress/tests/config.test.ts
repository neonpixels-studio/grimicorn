import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import config from "../config";

const PUBLIC_DIR = resolve(process.cwd(), "public");

// Pinned from the SITE_URL constant in config.ts. That constant is not exported,
// so the expected value lives here; every on-site URL in the head must match it.
const EXPECTED_SITE_URL = "https://grimicorn.dev";

// theme-color must track the brand dark background, whose source of truth is the
// --color-bg custom property in the theme stylesheet — assert against that, not a
// second copy of the literal.
const THEME_STYLESHEET = resolve(process.cwd(), ".vitepress/theme/style.css");
const BRAND_BG_CUSTOM_PROPERTY = "--color-bg";
const BRAND_BG_PATTERN = new RegExp(
  `${BRAND_BG_CUSTOM_PROPERTY}\\s*:\\s*([^;]+);`,
  "g",
);
// The stylesheet and theme-color both use 6-digit hex; anything else fails loud
// rather than being silently normalized into a false match.
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const JSON_LD_MIME = "application/ld+json";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const IHDR_TYPE_OFFSET = 12;
const PNG_CHUNK_TYPE_LENGTH = 4;
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;
const PNG_HEADER_MIN_BYTES = 24;

// Base used only to resolve root-relative asset paths; ignored for absolute URLs.
const URL_RESOLUTION_BASE = "https://example.test";
const RESOLUTION_ORIGIN = new URL(URL_RESOLUTION_BASE).origin;

// The site's own origin, so absolute self-hosted hrefs count as local, not remote.
// Computed once; a schemeless or malformed hostname falls back rather than crashing collection.
const SITE_ORIGIN = (() => {
  const hostname = config.sitemap?.hostname;
  if (!hostname) {
    return RESOLUTION_ORIGIN;
  }
  const withScheme = hostname.includes("://")
    ? hostname
    : `https://${hostname}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return RESOLUTION_ORIGIN;
  }
})();

// rel tokens naming a page URL, not an on-disk asset — skipped when walking link hrefs.
// A denylist so any future asset-bearing rel is verified by default. `alternate` is
// handled separately: it names a page only when it carries hreflang (a feed link does not).
const PAGE_LINK_RELS = new Set(["canonical", "prev", "next"]);

const MIN_IMAGE_ALT_LENGTH = 20;
// X (Twitter) truncates image alt text beyond this many characters.
const MAX_IMAGE_ALT_LENGTH = 420;

// Landscape banner spec: platforms render summary_large_image at ~1.91:1.
const OG_IMAGE_FILE = "grimicorn-og.png";
const OG_EXPECTED_WIDTH = 1200;
const OG_EXPECTED_HEIGHT = 630;

// Site background (`--color-bg` in theme/style.css); the PWA splash must match it.
const SITE_BACKGROUND_COLOR = "#0a0a0b";

function readPngDimensions(filePath: string) {
  const buffer = readFileSync(filePath);
  if (buffer.length < PNG_HEADER_MIN_BYTES) {
    throw new Error(`${filePath} is truncated (${buffer.length} bytes)`);
  }
  const hasSignature = buffer
    .subarray(0, PNG_SIGNATURE.length)
    .equals(PNG_SIGNATURE);
  if (!hasSignature) {
    throw new Error(`${filePath} is not a PNG (bad signature)`);
  }
  const chunkType = buffer.toString(
    "ascii",
    IHDR_TYPE_OFFSET,
    IHDR_TYPE_OFFSET + PNG_CHUNK_TYPE_LENGTH,
  );
  if (chunkType !== "IHDR") {
    throw new Error(`${filePath} has no leading IHDR chunk`);
  }
  return {
    width: buffer.readUInt32BE(PNG_WIDTH_OFFSET),
    height: buffer.readUInt32BE(PNG_HEIGHT_OFFSET),
  };
}

type HeadEntry = NonNullable<typeof config.head>[number];

// Duplicate tags (two canonicals, two JSON-LD blocks) are exactly the defect this
// suite guards against, so every lookup insists on exactly one match.
function findHeadEntry(
  predicate: (_entry: HeadEntry) => boolean,
  description: string,
) {
  const head = config.head ?? [];
  const entries = head.filter(predicate);
  if (entries.length !== 1) {
    throw new Error(
      `Expected exactly one ${description} in config.head, found ${entries.length}`,
    );
  }
  return entries[0];
}

function findMetaContent(identifier: string) {
  const entry = findHeadEntry(
    ([tag, attributes]) =>
      tag === "meta" &&
      (attributes?.property ?? attributes?.name) === identifier,
    `meta tag "${identifier}"`,
  );
  const content = entry[1].content;
  if (content === undefined) {
    throw new Error(`Meta tag "${identifier}" has no content attribute`);
  }
  return content;
}

function findLinkHref(rel: string) {
  const entry = findHeadEntry(
    ([tag, attributes]) => tag === "link" && attributes?.rel === rel,
    `link tag for rel="${rel}"`,
  );
  const href = entry[1].href;
  if (href === undefined) {
    throw new Error(`Link tag rel="${rel}" has no href attribute`);
  }
  return href;
}

function readStructuredData() {
  const entry = findHeadEntry(
    ([tag, attributes]) =>
      tag === "script" && attributes?.type === JSON_LD_MIME,
    `${JSON_LD_MIME} script tag`,
  );
  const [, , rawJson] = entry;
  if (rawJson === undefined) {
    throw new Error(`${JSON_LD_MIME} script tag has no JSON body`);
  }
  const parsed = JSON.parse(rawJson);
  if (typeof parsed.url !== "string" || typeof parsed.image !== "string") {
    throw new Error(`${JSON_LD_MIME} payload is missing a string url/image`);
  }
  return parsed as { url: string; image: string };
}

function normalizeHexColor(value: string) {
  return value.trim().toLowerCase();
}

function readBrandBackgroundColor() {
  const stylesheet = readFileSync(THEME_STYLESHEET, "utf8");
  const matches = [...stylesheet.matchAll(BRAND_BG_PATTERN)];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${BRAND_BG_CUSTOM_PROPERTY} declaration in ${THEME_STYLESHEET}, found ${matches.length}`,
    );
  }
  const value = matches[0][1].trim();
  if (!HEX_COLOR_PATTERN.test(value)) {
    throw new Error(
      `${BRAND_BG_CUSTOM_PROPERTY} is not a hex literal: ${value}`,
    );
  }
  return value;
}

function decodePathname(pathname: string) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function publicPathForUrl(assetUrl: string) {
  const pathname = decodePathname(
    new URL(assetUrl, URL_RESOLUTION_BASE).pathname,
  ).replace(/^\//, "");
  return resolve(PUBLIC_DIR, pathname);
}

function resolveMetaImagePath(identifier: string) {
  return publicPathForUrl(findMetaContent(identifier));
}

function readWebManifest() {
  return JSON.parse(
    readFileSync(publicPathForUrl(findLinkHref("manifest")), "utf8"),
  );
}

// Confirms the path is a real file AND that its case matches disk, since macOS (APFS)
// is case-insensitive but the deployed Linux host is not — a case mismatch 404s in prod.
function isRealFileWithExactCase(filePath: string) {
  const stats = statSync(filePath, { throwIfNoEntry: false });
  if (!stats?.isFile()) {
    return false;
  }
  return readdirSync(dirname(filePath)).includes(basename(filePath));
}

function isLocalHref(href: string) {
  try {
    const { origin } = new URL(href, URL_RESOLUTION_BASE);
    return origin === RESOLUTION_ORIGIN || origin === SITE_ORIGIN;
  } catch {
    return false;
  }
}

function isPageLinkRel(attributes: Record<string, string> | undefined) {
  const tokens = (attributes?.rel ?? "").toLowerCase().trim().split(/\s+/);
  if (tokens.includes("alternate")) {
    return Boolean(attributes?.hreflang);
  }
  return tokens.some((token) => PAGE_LINK_RELS.has(token));
}

function collectLocalAssetHrefs() {
  const head = config.head ?? [];
  const hrefs = head
    .filter(([tag, attributes]) => tag === "link" && !isPageLinkRel(attributes))
    .map(([, attributes]) => attributes?.href)
    .filter((href): href is string => typeof href === "string")
    .filter(isLocalHref);
  return [...new Set(hrefs)];
}

describe("Web app manifest colors", () => {
  it("pins manifest and theme-color to the site background so the PWA splash does not flash white", () => {
    const manifest = readWebManifest();
    expect(findMetaContent("theme-color")).toBe(SITE_BACKGROUND_COLOR);
    expect(manifest.theme_color).toBe(SITE_BACKGROUND_COLOR);
    expect(manifest.background_color).toBe(SITE_BACKGROUND_COLOR);
  });
});

describe("Open Graph image metadata", () => {
  it("points twitter:image at the same asset as og:image", () => {
    expect(findMetaContent("twitter:image")).toBe(findMetaContent("og:image"));
  });

  it("serves a dedicated landscape banner asset", () => {
    expect(resolveMetaImagePath("og:image")).toBe(
      resolve(PUBLIC_DIR, "assets", OG_IMAGE_FILE),
    );
  });

  it("declares the 1200x630 landscape dimensions", () => {
    expect(findMetaContent("og:image:width")).toBe(String(OG_EXPECTED_WIDTH));
    expect(findMetaContent("og:image:height")).toBe(String(OG_EXPECTED_HEIGHT));
  });

  it("ships a landscape banner file matching the declared dimensions", () => {
    const { width, height } = readPngDimensions(
      resolveMetaImagePath("og:image"),
    );
    expect(width).toBe(OG_EXPECTED_WIDTH);
    expect(height).toBe(OG_EXPECTED_HEIGHT);
  });

  it("declares usable alt text for og:image and twitter:image", () => {
    const altText = findMetaContent("og:image:alt");
    expect(altText.trim().length).toBeGreaterThanOrEqual(MIN_IMAGE_ALT_LENGTH);
    expect(altText.trim().length).toBeLessThanOrEqual(MAX_IMAGE_ALT_LENGTH);
    expect(altText).not.toBe(findMetaContent("og:title"));
    expect(altText).not.toBe(findMetaContent("og:description"));
    expect(findMetaContent("twitter:image:alt")).toBe(altText);
  });
});

describe("Local head asset hrefs", () => {
  const localHrefs = collectLocalAssetHrefs();

  it("declares at least one local head href to verify", () => {
    expect(localHrefs.length).toBeGreaterThan(0);
  });

  it.each(localHrefs)("resolves %s to a real file under public", (href) => {
    expect(isRealFileWithExactCase(publicPathForUrl(href)), href).toBe(true);
  });
});

describe("Canonical URL", () => {
  it("points the canonical link at the site URL", () => {
    expect(findLinkHref("canonical")).toBe(EXPECTED_SITE_URL);
  });
});

describe("theme-color", () => {
  it("matches the brand dark background from the theme stylesheet", () => {
    expect(normalizeHexColor(findMetaContent("theme-color"))).toBe(
      normalizeHexColor(readBrandBackgroundColor()),
    );
  });
});

describe("Sitemap", () => {
  it("uses the site URL as its hostname", () => {
    expect(config.sitemap?.hostname).toBe(EXPECTED_SITE_URL);
  });
});

describe("Site URL consistency", () => {
  it("keeps every on-site URL in sync with the canonical link", () => {
    const canonical = findLinkHref("canonical");
    const ogImage = findMetaContent("og:image");
    const structuredData = readStructuredData();
    expect(findMetaContent("og:url")).toBe(canonical);
    expect(structuredData.url).toBe(canonical);
    expect(structuredData.image).toBe(ogImage);
    expect(ogImage.slice(0, canonical.length + 1)).toBe(`${canonical}/`);
  });
});
