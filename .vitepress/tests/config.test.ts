import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import config from "../config";
import {
  OG_WIDTH,
  OG_HEIGHT,
  OG_IMAGE_FILENAME,
} from "../../og-banner-spec.mjs";
import { ASSET_CACHE_BUST } from "../asset-cache-bust";

const PUBLIC_DIR = resolve(process.cwd(), "public");

// Pinned from the SITE_URL constant in config.ts. That constant is not exported,
// so the expected value lives here; every on-site URL in the head must match it.
const EXPECTED_SITE_URL = "https://grimicorn.dev";

// theme-color must track the brand dark background, whose source of truth is the
// --color-bg custom property in the theme stylesheet — assert against that, not a
// second copy of the literal.
const THEME_STYLESHEET = resolve(process.cwd(), ".vitepress/theme/style.css");
const BRAND_BG_CUSTOM_PROPERTY = "--color-bg";
// Anchored to a declaration boundary: the char before the property must be a
// non-identifier char (start of input, whitespace, `{`, or `;`), so a sibling whose
// name ends with the full `--color-bg` token (e.g. `--accent--color-bg`) can't match
// on a substring. The value runs to the next `;`, block-closing `}`, or end of input,
// so a final declaration that omits its trailing semicolon still matches. The lazy
// value group plus trailing `\s*` stop the capture from absorbing the whitespace
// before a `}` or EOF terminator.
const BRAND_BG_PATTERN = new RegExp(
  `(?<![\\w-])${BRAND_BG_CUSTOM_PROPERTY}\\s*:\\s*([^;}]+?)\\s*(?:;|}|$)`,
  "g",
);
// The stylesheet and theme-color both use 6-digit hex; anything else fails loud
// rather than being silently normalized into a false match.
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const JSON_LD_MIME = "application/ld+json";

// The hero <picture> in GrimicornPage.vue is the LCP element; config must preload
// its first (avif) source so the fetch starts during HTML parse. These pin the
// contract: the preload must point at the same avif the picture prefers, gated by
// type, hinted high-priority, and scoped to every page except the 404.
const HERO_COMPONENT = resolve(
  process.cwd(),
  ".vitepress/theme/components/GrimicornPage.vue",
);
const HERO_AVIF_TYPE = "image/avif";
const HERO_PRELOAD_PRIORITY = "high";
// Isolates the hero <picture> by its unique ref before reading the avif source, so
// the test can't silently start asserting against the portrait picture (which has a
// structurally identical avif <source>) if the template is reordered. The inner
// group is tempered — `(?!</picture>)` stops it crossing a closing tag — so a
// picture placed before the hero can't be swallowed into the match.
const HERO_PICTURE_PATTERN =
  /<picture\b[^>]*>((?:(?!<\/picture>)[\s\S])*?ref="imageHeroRef"(?:(?!<\/picture>)[\s\S])*?)<\/picture>/;
const SOURCE_TAG_PATTERN = /<source\b[^>]*>/g;
const SRCSET_ATTRIBUTE_PATTERN = /\bsrcset="([^"]+)"/;
// The hero sources bind their srcset from the shared cache-bust helper
// (`:srcset="withAssetCacheBust('/assets/...')"`), so the raw attribute holds the
// helper call rather than a literal URL. This unwraps the asset path argument so the
// preloaded avif can be compared against the real URL the component renders.
const CACHE_BUST_HELPER_PATTERN =
  /withAssetCacheBust\(\s*["']([^"']+)["']\s*\)/;
// A `media` attribute makes a <source> conditional; the preloaded href is
// unconditional, so the hero's first source must carry none or an avif client on the
// excluded viewport fetches a different file than the preload pulled. The leading
// whitespace requirement avoids matching hyphenated attributes like `data-media`.
const MEDIA_ATTRIBUTE_PATTERN = /\smedia\s*=/;
// srcset separates its candidate images with commas; a single-candidate srcset
// (no comma) is the precondition for preloading via a plain `href`.
const SRCSET_CANDIDATE_SEPARATOR = ",";

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

// Landscape banner: platforms render summary_large_image at ~1.91:1. These are
// the canonical contract, pinned here (like EXPECTED_SITE_URL above) rather than
// imported, so the shared spec and the shipped asset are checked against a fixed
// external requirement; config is verified separately via its rendered meta tags.
// A drift in the spec, config, or the asset fails loud.
const OG_IMAGE_FILE = "grimicorn-og.png";
const OG_EXPECTED_WIDTH = 1200;
const OG_EXPECTED_HEIGHT = 630;

// The generator must import the shared spec, not re-inline the dimensions, or the
// producer can drift from config even though config tracks the spec.
const OG_GENERATOR_SCRIPT = resolve(
  process.cwd(),
  "scripts/generate-og-banner.mjs",
);
// Captures the binding list so we assert the real symbols are imported (robust)
// rather than banning bare numerals (which miss `1200x630` and hit stray values).
const SHARED_SPEC_IMPORT_PATTERN =
  /import\s*\{([^}]*)\}\s*from\s*["']\.\.\/og-banner-spec\.mjs["']/;
const REQUIRED_SPEC_BINDINGS = ["OG_WIDTH", "OG_HEIGHT", "OG_IMAGE_FILENAME"];

// CSS has block comments only, so the stylesheet scan strips just `/* ... */` — a
// commented-out `--color-bg` must not be counted. Kept separate from the line-comment
// rule because `^\s*//` would delete legal CSS (e.g. a protocol-relative `//cdn…` URL
// on its own line), so each caller strips only the grammar its source actually uses.
function stripBlockComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

// JS/TS sources (the generator-import scan) also carry `//` line comments; a
// commented-out import must not satisfy the drift assertion.
function stripComments(source: string) {
  return stripBlockComments(source).replace(/^\s*\/\/.*$/gm, "");
}

// robots.txt and llms.txt carry literal site URLs and marketing copy with no
// framework binding, so a domain move or copy change strands them silently. These
// guards recouple them to the config source of truth (the canonical URL and
// config.description).
const ROBOTS_TXT = resolve(PUBLIC_DIR, "robots.txt");
const LLMS_TXT = resolve(PUBLIC_DIR, "llms.txt");
const SITEMAP_PATHNAME = "/sitemap.xml";
const ROBOTS_SITEMAP_PATTERN = /^Sitemap:[ \t]*(\S+)[ \t]*$/gm;
const LLMS_DESCRIPTION_PATTERN = /^>[ \t]*(.+)$/gm;

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

type TransformHeadContext = Parameters<
  NonNullable<typeof config.transformHead>
>[0];

// Mirrors AppLayout's own gate: the hero (and its preload) belongs on every page
// except the 404, which VitePress flags with pageData.isNotFound.
async function headForPage(pageData: { isNotFound?: boolean }) {
  const transformHead = config.transformHead;
  if (typeof transformHead !== "function") {
    throw new Error("config.transformHead is not defined");
  }
  const context = { pageData } as TransformHeadContext;
  const transformed = (await transformHead(context)) ?? [];
  // The page's real head is the site-wide config.head plus the per-page additions,
  // so the negative test catches a site-wide hero preload if one is ever reintroduced.
  return [...((config.head ?? []) as HeadEntry[]), ...transformed];
}

function filterPreloadImageEntries(head: HeadEntry[]) {
  return head.filter(
    ([tag, attributes]) =>
      tag === "link" &&
      attributes?.rel === "preload" &&
      attributes?.as === "image",
  );
}

function findPreloadImageAttributes(head: HeadEntry[]) {
  const entries = filterPreloadImageEntries(head);
  if (entries.length !== 1) {
    throw new Error(
      `Expected exactly one preload link for the hero image, found ${entries.length}`,
    );
  }
  const attributes = entries[0][1];
  if (!attributes) {
    throw new Error("Hero preload link entry has no attributes");
  }
  return attributes;
}

function findPreloadImageHref(head: HeadEntry[]) {
  const href = findPreloadImageAttributes(head).href;
  if (href === undefined) {
    throw new Error("Preload link has no href attribute");
  }
  return href;
}

function readHeroPictureMarkup() {
  const markup = readFileSync(HERO_COMPONENT, "utf8");
  const pictureMatch = markup.match(HERO_PICTURE_PATTERN);
  if (!pictureMatch) {
    throw new Error(
      `Could not find the hero <picture> (ref="imageHeroRef") in ${HERO_COMPONENT}`,
    );
  }
  return pictureMatch[1];
}

function readHeroFirstSourceTag() {
  const sources = [...readHeroPictureMarkup().matchAll(SOURCE_TAG_PATTERN)].map(
    ([tag]) => tag,
  );
  if (sources.length === 0) {
    throw new Error(
      `The hero <picture> in ${HERO_COMPONENT} has no <source> tags`,
    );
  }
  return sources[0];
}

function readHeroAvifSrcset() {
  const srcsetMatch = readHeroFirstSourceTag().match(SRCSET_ATTRIBUTE_PATTERN);
  if (!srcsetMatch) {
    throw new Error(
      `The hero's first <source> has no srcset in ${HERO_COMPONENT}`,
    );
  }
  return srcsetMatch[1];
}

// The first candidate URL of the avif srcset — the target a plain `href` preload
// must equal while the srcset stays single-candidate. The srcset is bound from the
// shared cache-bust helper, so resolve that call to the real URL; fall back to a
// literal srcset so a future revert to an inline URL still verifies loud.
function readHeroAvifUrl() {
  const srcset = readHeroAvifSrcset().trim();
  const helperMatch = srcset.match(CACHE_BUST_HELPER_PATTERN);
  if (helperMatch) {
    return `${helperMatch[1]}${ASSET_CACHE_BUST}`;
  }
  return srcset.split(/\s+/)[0];
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

// One hex contract for both sides of the comparison: the CSS source and the
// manifest/meta colors are all held to a 6-digit literal, so `#fff` vs `#ffffff`
// (identical to a browser) fails loud with a clear message instead of a confusing diff.
function normalizeHexColor(value: unknown, description: string) {
  if (typeof value !== "string") {
    throw new Error(`${description} is not a string color: ${String(value)}`);
  }
  const normalized = value.trim().toLowerCase();
  if (!HEX_COLOR_PATTERN.test(normalized)) {
    throw new Error(
      `${description} is not a 6-digit hex literal: ${normalized}`,
    );
  }
  return normalized;
}

// Missing/typo'd manifest color keys are exactly the desync this suite guards
// against; normalizeHexColor fails loud on the missing value with a keyed
// message, so a dropped color surfaces as a readable failure, not a crash.
function readManifestColor(manifest: Record<string, unknown>, key: string) {
  return normalizeHexColor(manifest[key], `manifest ${key}`);
}

// Parse the single brand background literal out of a stylesheet source. Comments
// must be stripped first; otherwise a commented-out `/* --color-bg: ... */`
// declaration counts as a real match and trips the "exactly one" guard. Pure over
// its input (source and label) so the comment-stripping can be exercised in
// isolation, and so failures name the source the caller actually passed.
function extractBrandBackgroundColor(stylesheet: string, sourceLabel: string) {
  const value = extractSingleCapture(
    stripBlockComments(stylesheet),
    BRAND_BG_PATTERN,
    `${BRAND_BG_CUSTOM_PROPERTY} declaration in ${sourceLabel}`,
  );
  return normalizeHexColor(
    value,
    `${BRAND_BG_CUSTOM_PROPERTY} in ${sourceLabel}`,
  );
}

function readBrandBackgroundColor() {
  return extractBrandBackgroundColor(
    readFileSync(THEME_STYLESHEET, "utf8"),
    THEME_STYLESHEET,
  );
}

// Duplicate directives (two Sitemap lines, two Home links) are exactly the drift
// this guards against, so every extraction insists on exactly one match.
function extractSingleCapture(
  source: string,
  pattern: RegExp,
  description: string,
) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${description}, found ${matches.length}`,
    );
  }
  return matches[0][1].trim();
}

function extractMarkdownLinkUrl(source: string, label: string) {
  const pattern = new RegExp(`\\[${label}\\]\\(([^)\\s]+)\\)`, "g");
  return extractSingleCapture(source, pattern, `"${label}" link`);
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

describe("Hex color normalization", () => {
  it("rejects shorthand hex so #fff cannot masquerade as #ffffff", () => {
    expect(() => normalizeHexColor("#fff", "test color")).toThrow(
      /test color is not a 6-digit hex literal/,
    );
  });

  it("reports a missing manifest color key with the key in the message", () => {
    expect(() => readManifestColor({}, "theme_color")).toThrow(
      /manifest theme_color is not a string color/,
    );
  });

  it("lowercases and trims so casing and whitespace cannot cause a false mismatch", () => {
    expect(normalizeHexColor("  #1A1A1A ", "test color")).toBe("#1a1a1a");
  });
});

describe("Web app manifest colors", () => {
  it("pins the manifest colors to the site background so the PWA splash does not flash white", () => {
    // Source of truth is `--color-bg` in the theme stylesheet, read at test time,
    // so a CSS change that desyncs the PWA splash color fails this suite loudly.
    // The `theme-color` meta tag is asserted separately in describe("theme-color").
    const brandBackground = normalizeHexColor(
      readBrandBackgroundColor(),
      BRAND_BG_CUSTOM_PROPERTY,
    );
    const manifest = readWebManifest();
    expect(readManifestColor(manifest, "theme_color")).toBe(brandBackground);
    expect(readManifestColor(manifest, "background_color")).toBe(
      brandBackground,
    );
  });
});

describe("Web app manifest icons", () => {
  const manifestIconSources: string[] = (readWebManifest().icons ?? []).map(
    (icon: { src: string }) => icon.src,
  );

  it("declares at least one manifest icon to verify", () => {
    expect(manifestIconSources.length).toBeGreaterThan(0);
  });

  it.each(manifestIconSources)(
    "resolves icon src %s to a real file under public",
    (src) => {
      expect(isRealFileWithExactCase(publicPathForUrl(src)), src).toBe(true);
    },
  );
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

  it("pins the shared spec to the canonical landscape contract", () => {
    expect(OG_WIDTH).toBe(OG_EXPECTED_WIDTH);
    expect(OG_HEIGHT).toBe(OG_EXPECTED_HEIGHT);
    expect(OG_IMAGE_FILENAME).toBe(OG_IMAGE_FILE);
  });

  it("has the generator import the shared spec instead of re-inlining it", () => {
    const code = stripComments(readFileSync(OG_GENERATOR_SCRIPT, "utf8"));
    const [, bindingList = ""] = code.match(SHARED_SPEC_IMPORT_PATTERN) ?? [];
    const imported = bindingList.split(",").map((binding) => binding.trim());
    for (const binding of REQUIRED_SPEC_BINDINGS) {
      expect(imported, binding).toContain(binding);
    }
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

describe("Hero image preload", () => {
  it("preloads the hero picture's avif source on content pages to improve LCP", async () => {
    const head = await headForPage({ isNotFound: false });
    const attributes = findPreloadImageAttributes(head);
    expect(attributes.href).toBe(readHeroAvifUrl());
    expect(attributes.type).toBe(HERO_AVIF_TYPE);
    expect(attributes.fetchpriority).toBe(HERO_PRELOAD_PRIORITY);
  });

  it("keeps avif as the hero picture's first, unconditional source so the preload matches what avif clients fetch", () => {
    const firstSource = readHeroFirstSourceTag();
    expect(firstSource).toContain(`type="${HERO_AVIF_TYPE}"`);
    expect(firstSource).not.toMatch(MEDIA_ATTRIBUTE_PATTERN);
  });

  it("preloads via href only while the hero avif source stays a single bare candidate", () => {
    // A responsive srcset (multiple candidates OR a width/density descriptor) needs
    // imagesrcset/imagesizes on the preload, not href, or an avif client can
    // double-download. Reject a comma (extra candidate) and any whitespace (a
    // descriptor), so either addition fails loud and forces the imagesrcset change.
    const srcset = readHeroAvifSrcset().trim();
    expect(srcset).not.toContain(SRCSET_CANDIDATE_SEPARATOR);
    expect(srcset.split(/\s+/)).toHaveLength(1);
  });

  it("resolves the preloaded avif to a real file under public", async () => {
    const head = await headForPage({ isNotFound: false });
    const href = findPreloadImageHref(head);
    expect(isRealFileWithExactCase(publicPathForUrl(href)), href).toBe(true);
  });

  it("does not preload the hero on the 404 page, which renders no hero", async () => {
    const head = await headForPage({ isNotFound: true });
    expect(filterPreloadImageEntries(head)).toHaveLength(0);
  });
});

describe("Canonical URL", () => {
  it("points the canonical link at the site URL", () => {
    expect(findLinkHref("canonical")).toBe(EXPECTED_SITE_URL);
  });
});

describe("theme-color", () => {
  it("matches the brand dark background from the theme stylesheet", () => {
    expect(
      normalizeHexColor(findMetaContent("theme-color"), "theme-color meta"),
    ).toBe(
      normalizeHexColor(readBrandBackgroundColor(), BRAND_BG_CUSTOM_PROPERTY),
    );
  });
});

describe("brand background color parsing", () => {
  const FIXTURE_LABEL = "<fixture>";

  it("ignores a commented-out --color-bg declaration when counting the literal", () => {
    const stylesheetWithCommentedDuplicate = [
      "/* legacy: --color-bg: #123456; */",
      ":root {",
      "  --color-bg: #0a0a0b;",
      "  /* --color-bg: #ffffff; */",
      "}",
    ].join("\n");
    expect(
      extractBrandBackgroundColor(
        stylesheetWithCommentedDuplicate,
        FIXTURE_LABEL,
      ),
    ).toBe("#0a0a0b");
  });

  it("fails loud, naming the source, on two real --color-bg declarations", () => {
    const stylesheetWithRealDuplicate = [
      ":root {",
      "  --color-bg: #0a0a0b;",
      "  --color-bg: #ffffff;",
      "}",
    ].join("\n");
    expect(() =>
      extractBrandBackgroundColor(stylesheetWithRealDuplicate, FIXTURE_LABEL),
    ).toThrow(/<fixture>[\s\S]*found 2/);
  });

  it("fails loud, naming the source, when every --color-bg declaration is commented out", () => {
    const stylesheetWithOnlyComments = [
      ":root {",
      "  /* --color-bg: #0a0a0b; */",
      "}",
    ].join("\n");
    expect(() =>
      extractBrandBackgroundColor(stylesheetWithOnlyComments, FIXTURE_LABEL),
    ).toThrow(/<fixture>[\s\S]*found 0/);
  });

  it("fails loud, naming the source, when --color-bg is not a hex literal", () => {
    const stylesheetWithNonHex = [
      ":root {",
      "  --color-bg: var(--brand-ink);",
      "}",
    ].join("\n");
    expect(() =>
      extractBrandBackgroundColor(stylesheetWithNonHex, FIXTURE_LABEL),
    ).toThrow(/<fixture>[\s\S]*var\(--brand-ink\)/);
  });

  it("does not treat a protocol-relative url() line as a comment when scanning CSS", () => {
    const stylesheetWithProtocolRelativeUrl = [
      ":root {",
      "  --color-bg: #0a0a0b;",
      "  background: url(",
      "    //cdn.example.com/bg.png",
      "  );",
      "}",
    ].join("\n");
    expect(
      extractBrandBackgroundColor(
        stylesheetWithProtocolRelativeUrl,
        FIXTURE_LABEL,
      ),
    ).toBe("#0a0a0b");
  });

  it("does not match a sibling custom property that ends with --color-bg", () => {
    const stylesheetWithSibling = [
      ":root {",
      "  --panel-color-bg: #ffffff;",
      "  --accent--color-bg: #eeeeee;",
      "  background: var(--color-bg);",
      "  --color-bg: #0a0a0b;",
      "}",
    ].join("\n");
    expect(
      extractBrandBackgroundColor(stylesheetWithSibling, FIXTURE_LABEL),
    ).toBe("#0a0a0b");
  });

  it("fails loud when only a sibling ending in --color-bg is present", () => {
    const stylesheetWithOnlySibling = [
      ":root {",
      "  --accent--color-bg: #eeeeee;",
      "}",
    ].join("\n");
    expect(() =>
      extractBrandBackgroundColor(stylesheetWithOnlySibling, FIXTURE_LABEL),
    ).toThrow(/<fixture>[\s\S]*found 0/);
  });

  it("does not match a sibling custom property that starts with --color-bg", () => {
    const stylesheetWithSuffixSibling = [
      ":root {",
      "  --color-bg-hover: #ffffff;",
      "  --color-bg: #0a0a0b;",
      "}",
    ].join("\n");
    expect(
      extractBrandBackgroundColor(stylesheetWithSuffixSibling, FIXTURE_LABEL),
    ).toBe("#0a0a0b");
  });

  it("matches a final --color-bg declaration that omits its trailing semicolon", () => {
    const stylesheetWithoutTrailingSemicolon = [
      ":root {",
      "  --color-bg: #0a0a0b",
      "}",
    ].join("\n");
    expect(
      extractBrandBackgroundColor(
        stylesheetWithoutTrailingSemicolon,
        FIXTURE_LABEL,
      ),
    ).toBe("#0a0a0b");
  });

  it("matches a --color-bg declaration terminated by end of input", () => {
    expect(
      extractBrandBackgroundColor("--color-bg: #0a0a0b", FIXTURE_LABEL),
    ).toBe("#0a0a0b");
  });

  it("still matches a normal semicolon-terminated --color-bg declaration", () => {
    const stylesheetWithSemicolon = [
      ":root {",
      "  --color-bg: #0a0a0b;",
      "}",
    ].join("\n");
    expect(
      extractBrandBackgroundColor(stylesheetWithSemicolon, FIXTURE_LABEL),
    ).toBe("#0a0a0b");
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

describe("robots.txt", () => {
  it("points its Sitemap directive at the config site URL", () => {
    const siteUrl = findLinkHref("canonical");
    const robots = readFileSync(ROBOTS_TXT, "utf8");
    const sitemapUrl = extractSingleCapture(
      robots,
      ROBOTS_SITEMAP_PATTERN,
      "Sitemap directive",
    );
    expect(sitemapUrl).toBe(`${siteUrl}${SITEMAP_PATHNAME}`);
  });
});

describe("llms.txt", () => {
  it("keeps its marketing description in sync with the config description", () => {
    const llms = readFileSync(LLMS_TXT, "utf8");
    const description = extractSingleCapture(
      llms,
      LLMS_DESCRIPTION_PATTERN,
      "description blockquote",
    );
    expect(description).toBe(config.description);
  });

  it("points its on-site links at the config site URL", () => {
    const siteUrl = findLinkHref("canonical");
    const llms = readFileSync(LLMS_TXT, "utf8");
    expect(extractMarkdownLinkUrl(llms, "Home")).toBe(`${siteUrl}/`);
    expect(extractMarkdownLinkUrl(llms, "Sitemap")).toBe(
      `${siteUrl}${SITEMAP_PATHNAME}`,
    );
  });
});
