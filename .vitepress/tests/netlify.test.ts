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

const HEADER_LINE = /^\s*([\w-]+)\s*=\s*"([^"]*)"/;

function parseHeaders() {
  const config = readFileSync(NETLIFY_CONFIG_PATH, "utf8");
  const headers = new Map<string, string>();
  for (const line of config.split("\n")) {
    const match = line.match(HEADER_LINE);
    if (match) {
      headers.set(match[1], match[2]);
    }
  }
  return headers;
}

function readHeader(headers: Map<string, string>, name: string) {
  const value = headers.get(name);
  if (value === undefined) {
    throw new Error(`Missing "${name}" header in netlify.toml`);
  }
  return value;
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

const headers = parseHeaders();

describe("netlify security headers", () => {
  it.each(Object.entries(STATIC_HEADERS))(
    "serves %s with the expected value",
    (name, expectedValue) => {
      expect(readHeader(headers, name)).toBe(expectedValue);
    },
  );

  it("sends an HSTS max-age of at least one year", () => {
    const maxAge = parseHstsMaxAge(
      readHeader(headers, "Strict-Transport-Security"),
    );
    expect(maxAge).toBeGreaterThanOrEqual(HSTS_MIN_MAX_AGE_SECONDS);
  });

  it("extends HSTS to all subdomains", () => {
    const directives = parseDirectives(
      readHeader(headers, "Strict-Transport-Security"),
    );
    expect(directives).toContain("includesubdomains");
  });
});

const CSP_HEADER_NAME = "Content-Security-Policy";
const GLOBAL_HEADERS_PATH = "/*";
const FONTS_HEADERS_PATH = "/fonts/*";

// Google Fonts hostnames the policy must NOT allow anywhere: fonts are self-hosted
// from /public/fonts (see .vitepress/theme/fonts.css), so every directive stays
// first-party-only. Matched as substrings so a subdomain/path/wildcard variant
// (e.g. *.gstatic.com, fonts.googleapis.com/css2) can't re-open the hole unseen.
const GOOGLE_FONTS_HOSTS = ["googleapis.com", "gstatic.com"];

// One year is the recommended immutable-asset cache floor; the fonts carry a ?v=
// cache-bust so an immutable one-year cache is safe.
const FONT_CACHE_MIN_MAX_AGE_SECONDS = 31536000;

function readHeadersBlockFor(forPath: string) {
  const config = readFileSync(NETLIFY_CONFIG_PATH, "utf8");
  const blocks = config
    .split(/^\[\[headers\]\]/m)
    .map((block) => block.split(/^\[(?!headers\.)/m)[0])
    .filter((block) => /^\s*for\s*=\s*"([^"]*)"/m.test(block));
  const matching = blocks.filter(
    (block) => block.match(/for\s*=\s*"([^"]*)"/)?.[1] === forPath,
  );
  // Netlify applies every matching block, so a stray second one would silently
  // change what ships; require exactly one to keep this assertion meaningful.
  if (matching.length !== 1) {
    throw new Error(
      `netlify.toml must have exactly one [[headers]] block for "${forPath}", found ${matching.length}`,
    );
  }
  return matching[0];
}

function readGlobalHeadersBlock() {
  return readHeadersBlockFor(GLOBAL_HEADERS_PATH);
}

function readBlockHeader(block: string, name: string) {
  const match = block.match(new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, "m"));
  if (!match) {
    throw new Error(`netlify.toml block is missing a "${name}" header`);
  }
  return match[1];
}

function readCspDirectives() {
  const match = readGlobalHeadersBlock().match(
    new RegExp(`^\\s*${CSP_HEADER_NAME}\\s*=\\s*"([^"]*)"`, "m"),
  );
  if (!match) {
    throw new Error(`netlify.toml is missing a ${CSP_HEADER_NAME} header`);
  }
  const directives = new Map<string, string[]>();
  for (const directive of match[1].split(";")) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    // CSP names are case-insensitive; browsers honor the first occurrence only.
    const key = name.toLowerCase();
    if (!key || directives.has(key)) {
      continue;
    }
    directives.set(key, sources);
  }
  return directives;
}

// A host-source splits into an optional scheme, a host (with optional port), and
// an optional path. Per the CSP spec the scheme and host are case-insensitive but
// the path is compared verbatim, so this captures scheme+host separately from it.
const HOST_SOURCE_PATTERN = /^([a-z][a-z0-9+.-]*:\/\/)?([^/]*)(\/.*)?$/i;

// Fold a single CSP source to a canonical casing for comparison. Quoted keyword
// sources ('self', 'none', 'unsafe-inline', nonces, hashes) fold whole because
// only their keyword casing is insignificant; a host-source folds just its
// scheme+host and preserves the case-sensitive path.
function normalizeSource(source: string) {
  if (source.startsWith("'")) {
    return source.toLowerCase();
  }
  const match = source.match(HOST_SOURCE_PATTERN);
  if (!match) {
    return source.toLowerCase();
  }
  const [, scheme = "", host = "", path = ""] = match;
  return `${scheme}${host}`.toLowerCase() + path;
}

// CSP source order and scheme/host casing are not semantically significant, so
// compare on a normalized (case-folded scheme+host, sorted) basis rather than
// asserting exact formatting. Paths stay case-sensitive per the CSP spec.
function normalizeSources(sources: string[] | undefined) {
  return [...(sources ?? [])].map(normalizeSource).sort();
}

function expectSources(
  directives: Map<string, string[]>,
  name: string,
  expected: string[],
) {
  expect(normalizeSources(directives.get(name))).toEqual(
    normalizeSources(expected),
  );
}

// Every directive the policy is allowed to carry; a new/removed one must be reviewed
// (a widening directive like script-src-elem would otherwise slip past named checks).
const EXPECTED_DIRECTIVES = [
  "default-src",
  "script-src",
  "style-src",
  "font-src",
  "img-src",
  "connect-src",
  "object-src",
  "base-uri",
  "frame-ancestors",
  "form-action",
];

describe("normalizeSources", () => {
  it("lowercases a mixed-case scheme and host", () => {
    expect(normalizeSources(["HTTPS://Fonts.GoogleAPIs.com"])).toEqual([
      "https://fonts.googleapis.com",
    ]);
  });

  it("folds the host but preserves a case-sensitive path", () => {
    expect(normalizeSources(["https://Example.com/SomePath"])).toEqual([
      "https://example.com/SomePath",
    ]);
  });

  it("preserves path casing across the port", () => {
    expect(normalizeSources(["https://Example.com:8080/Mixed/Case"])).toEqual([
      "https://example.com:8080/Mixed/Case",
    ]);
  });

  it("lowercases keyword and scheme sources", () => {
    expect(normalizeSources(["'SELF'", "'Unsafe-Inline'", "DATA:"])).toEqual([
      "'self'",
      "'unsafe-inline'",
      "data:",
    ]);
  });
});

describe("Content-Security-Policy header", () => {
  it("declares no directives beyond the reviewed set", () => {
    const directives = readCspDirectives();
    expect([...directives.keys()].sort()).toEqual(
      [...EXPECTED_DIRECTIVES].sort(),
    );
  });

  it("defines a self-scoped default fallback", () => {
    expectSources(readCspDirectives(), "default-src", ["'self'"]);
  });

  it("allows the inline VitePress bootstrap and JSON-LD scripts", () => {
    expectSources(readCspDirectives(), "script-src", [
      "'self'",
      "'unsafe-inline'",
    ]);
  });

  it("allows inline style attributes but no third-party stylesheet origin", () => {
    expectSources(readCspDirectives(), "style-src", [
      "'self'",
      "'unsafe-inline'",
    ]);
  });

  it("keeps fonts first-party only", () => {
    expectSources(readCspDirectives(), "font-src", ["'self'"]);
  });

  it("allows no Google Fonts host in any directive", () => {
    const offenders = [...readCspDirectives()].flatMap(([name, sources]) =>
      normalizeSources(sources)
        .filter((source) =>
          GOOGLE_FONTS_HOSTS.some((host) => source.includes(host)),
        )
        .map((source) => `${name}: ${source}`),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps images and network requests same-origin", () => {
    const directives = readCspDirectives();
    expectSources(directives, "img-src", ["'self'", "data:"]);
    expectSources(directives, "connect-src", ["'self'"]);
  });

  it("locks down framing, plugins, base URI, and form submissions", () => {
    const directives = readCspDirectives();
    expectSources(directives, "frame-ancestors", ["'none'"]);
    expectSources(directives, "object-src", ["'none'"]);
    expectSources(directives, "base-uri", ["'self'"]);
    expectSources(directives, "form-action", ["'self'"]);
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
