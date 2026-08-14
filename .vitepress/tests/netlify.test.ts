import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const NETLIFY_CONFIG_PATH = resolve(process.cwd(), "netlify.toml");

// One year is the recommended HSTS floor for an HTTPS-only site; we serve two.
const HSTS_MIN_MAX_AGE_SECONDS = 31536000;

const STATIC_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const GLOBAL_HEADERS_PATH = "/*";
const FONTS_HEADERS_PATH = "/fonts/*";

// netlify.toml now carries more than one [[headers]] block (a global one and the
// /fonts/* cache block), so header lookups must be scoped to a single block —
// flattening every `Name = "value"` line into one map would let the wrong block's
// value satisfy an assertion. This isolates the block whose `for` matches, and
// fails loud if it is duplicated (Netlify would apply both, changing what ships).
function readHeadersBlockFor(forPath: string) {
  const config = readFileSync(NETLIFY_CONFIG_PATH, "utf8");
  const blocks = config
    .split(/^\[\[headers\]\]/m)
    .map((block) => block.split(/^\[(?!headers\.)/m)[0])
    .filter((block) => /^\s*for\s*=\s*"([^"]*)"/m.test(block));
  const matching = blocks.filter(
    (block) => block.match(/for\s*=\s*"([^"]*)"/)?.[1] === forPath,
  );
  if (matching.length !== 1) {
    throw new Error(
      `netlify.toml must have exactly one [[headers]] block for "${forPath}", found ${matching.length}`,
    );
  }
  return matching[0];
}

function readBlockHeader(block: string, name: string) {
  const match = block.match(new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, "m"));
  if (!match) {
    throw new Error(`netlify.toml block is missing a "${name}" header`);
  }
  return match[1];
}

function parseDirectives(headerValue: string) {
  return headerValue
    .split(";")
    .map((directive) => directive.trim().toLowerCase());
}

function parseHstsMaxAge(headerValue: string) {
  const match = headerValue.match(/(?:^|;\s*)max-age\s*=\s*(\d+)/i);
  if (!match) {
    throw new Error(`HSTS header has no max-age directive: "${headerValue}"`);
  }
  return Number(match[1]);
}

// Cache-Control delimits directives with commas (HSTS uses semicolons), so this
// matches a max-age token after any whitespace/comma/semicolon boundary.
function parseCacheMaxAge(headerValue: string) {
  const match = headerValue.match(/(?:^|[\s;,])max-age\s*=\s*(\d+)/i);
  if (!match) {
    throw new Error(`Cache-Control has no max-age directive: "${headerValue}"`);
  }
  return Number(match[1]);
}

// One year is the recommended immutable-asset cache floor; the fonts carry a ?v=
// cache-bust so an immutable one-year cache is safe.
const FONT_CACHE_MIN_MAX_AGE_SECONDS = 31536000;

const globalHeadersBlock = readHeadersBlockFor(GLOBAL_HEADERS_PATH);

describe("netlify security headers", () => {
  it.each(Object.entries(STATIC_HEADERS))(
    "serves %s with the expected value",
    (name, expectedValue) => {
      expect(readBlockHeader(globalHeadersBlock, name)).toBe(expectedValue);
    },
  );

  it("sends an HSTS max-age of at least one year", () => {
    const maxAge = parseHstsMaxAge(
      readBlockHeader(globalHeadersBlock, "Strict-Transport-Security"),
    );
    expect(maxAge).toBeGreaterThanOrEqual(HSTS_MIN_MAX_AGE_SECONDS);
  });

  it("extends HSTS to all subdomains", () => {
    const directives = parseDirectives(
      readBlockHeader(globalHeadersBlock, "Strict-Transport-Security"),
    );
    expect(directives).toContain("includesubdomains");
  });
});

// The CSP carries per-build 'sha256-...' hashes for VitePress's inline scripts, so
// it is generated into .vitepress/dist/_headers by the buildEnd hook (logic in
// .vitepress/headers.ts, covered by headers.test.ts). netlify.toml must not also
// declare one: netlify.toml takes precedence over _headers for a shared header
// name, so a static CSP here would silently override the hashed policy and restore
// 'unsafe-inline'. Match the header only where it is assigned a value (`=`), so the
// explanatory comment in netlify.toml does not trip this guard.
const CSP_HEADER_ASSIGNMENT = /^\s*Content-Security-Policy\s*=/im;

describe("Content-Security-Policy", () => {
  it("is generated into _headers, never declared statically in netlify.toml", () => {
    const config = readFileSync(NETLIFY_CONFIG_PATH, "utf8");
    expect(CSP_HEADER_ASSIGNMENT.test(config)).toBe(false);
  });
});

describe("self-hosted font caching", () => {
  const fontsBlock = readHeadersBlockFor(FONTS_HEADERS_PATH);
  const cacheControl = readBlockHeader(fontsBlock, "Cache-Control");

  it("caches fonts for at least one year", () => {
    const maxAge = parseCacheMaxAge(cacheControl);
    expect(maxAge).toBeGreaterThanOrEqual(FONT_CACHE_MIN_MAX_AGE_SECONDS);
  });

  it("marks the font cache immutable so repeat visits skip revalidation", () => {
    expect(cacheControl.toLowerCase()).toContain("immutable");
  });
});
