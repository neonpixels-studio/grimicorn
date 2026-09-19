import { createHash } from "node:crypto";

// Pure logic for the per-build Content-Security-Policy. VitePress emits a handful
// of inline bootstrap scripts (dark-mode/mac-os detection and __VP_SITE_DATA__)
// whose contents change per build, so a static netlify.toml cannot carry the
// 'sha256-...' hashes they need. This module hashes those scripts and assembles a
// Netlify `_headers` file at build time (see buildEnd in config.ts), letting
// script-src drop 'unsafe-inline'. Everything here is filesystem-free so it can be
// unit-tested against fixture HTML in isolation from the build.

const CSP_HASH_ALGORITHM = "sha256";
const GLOBAL_HEADERS_PATH = "/*";
const CSP_HEADER_NAME = "Content-Security-Policy";
// Netlify's `_headers` format is a path line followed by indented "Name: value".
const HEADER_INDENT = "  ";

const SELF = "'self'";
const NONE = "'none'";
const UNSAFE_INLINE = "'unsafe-inline'";
const DATA_SCHEME = "data:";
const SCRIPT_SRC_DIRECTIVE = "script-src";

// Google Analytics (GA4) is the one deliberate third-party exception to the
// otherwise first-party CSP (see the GA head entries in config.ts): the gtag
// loader is fetched from googletagmanager.com and measurement beacons are sent to
// google-analytics.com, with region1.google-analytics.com covering the regional
// (e.g. EU) collection endpoints. googletagmanager.com also appears in
// connect-src/img-src because gtag can fetch config from and beacon to it.
const GOOGLE_TAG_MANAGER_ORIGIN = "https://www.googletagmanager.com";
const GOOGLE_ANALYTICS_ORIGIN = "https://www.google-analytics.com";
const GOOGLE_ANALYTICS_REGION_ORIGIN = "https://region1.google-analytics.com";

// The attribute capture stops at the first '>', which assumes no unencoded '>'
// inside a quoted attribute value. VitePress only emits simple attributes here
// (id, type), so this holds; a raw '>' in an attribute would misalign the capture.
const SCRIPT_TAG_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const SRC_ATTRIBUTE_PATTERN = /\bsrc\s*=/i;
const TYPE_ATTRIBUTE_PATTERN =
  /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const MIME_PARAMETER_SEPARATOR = ";";

// script-src governs every script element the browser would run: executable JS (a
// bare/empty type or a JS MIME essence, including legacy aliases) plus import maps.
// A non-JS data block such as type="application/ld+json" is exempt and needs no
// hash. The MIME essence is matched with parameters (e.g. "; charset=utf-8")
// stripped, per the HTML spec's type-matching rules.
const EXECUTABLE_SCRIPT_TYPES = new Set([
  "",
  "module",
  "importmap",
  "text/javascript",
  "application/javascript",
  "text/ecmascript",
  "application/ecmascript",
  "application/x-javascript",
]);

function readScriptType(attributes: string) {
  const match = attributes.match(TYPE_ATTRIBUTE_PATTERN);
  if (!match) {
    return "";
  }
  const value = match[1] ?? match[2] ?? match[3] ?? "";
  const [essence] = value.split(MIME_PARAMETER_SEPARATOR);
  return essence.trim().toLowerCase();
}

function isExecutableInlineScript(attributes: string) {
  if (SRC_ATTRIBUTE_PATTERN.test(attributes)) {
    return false;
  }
  return EXECUTABLE_SCRIPT_TYPES.has(readScriptType(attributes));
}

// The CSP source token for a script's exact byte content, e.g. 'sha256-<base64>'.
// The browser hashes the element's UTF-8 text content verbatim, so the caller must
// pass the raw characters between the tags with no trimming.
export function hashInlineScript(scriptContent: string) {
  const digest = createHash(CSP_HASH_ALGORITHM)
    .update(scriptContent, "utf8")
    .digest("base64");
  return `'${CSP_HASH_ALGORITHM}-${digest}'`;
}

export function extractInlineScriptHashes(html: string) {
  const hashes: string[] = [];
  for (const match of html.matchAll(SCRIPT_TAG_PATTERN)) {
    const [, attributes, content] = match;
    if (!isExecutableInlineScript(attributes)) {
      continue;
    }
    hashes.push(hashInlineScript(content));
  }
  return hashes;
}

// Union of every executable inline script hash across all rendered pages, deduped
// and sorted so one `/*` CSP covers the whole site deterministically.
export function collectScriptHashes(htmlDocuments: string[]) {
  const hashes = htmlDocuments.flatMap(extractInlineScriptHashes);
  return [...new Set(hashes)].sort();
}

// Google Analytics is production-only (see ANALYTICS_ENABLED in config.ts), so its
// origins are added to the CSP only when analytics ships. Every non-production
// build then stays strictly first-party rather than advertising origins nothing
// loads from.
export function buildContentSecurityPolicy(
  scriptHashes: string[],
  includeAnalytics = false,
) {
  const analyticsScriptOrigins = includeAnalytics
    ? [GOOGLE_TAG_MANAGER_ORIGIN]
    : [];
  const analyticsImageOrigins = includeAnalytics
    ? [GOOGLE_TAG_MANAGER_ORIGIN, GOOGLE_ANALYTICS_ORIGIN]
    : [];
  const analyticsConnectOrigins = includeAnalytics
    ? [
        GOOGLE_TAG_MANAGER_ORIGIN,
        GOOGLE_ANALYTICS_ORIGIN,
        GOOGLE_ANALYTICS_REGION_ORIGIN,
      ]
    : [];
  const directives: Array<[string, string[]]> = [
    ["default-src", [SELF]],
    [SCRIPT_SRC_DIRECTIVE, [SELF, ...analyticsScriptOrigins, ...scriptHashes]],
    // Fonts are self-hosted from /public/fonts (see .vitepress/theme/fonts.css), so
    // style-src and font-src stay first-party-only — no Google Fonts origins.
    ["style-src", [SELF, UNSAFE_INLINE]],
    ["font-src", [SELF]],
    ["img-src", [SELF, DATA_SCHEME, ...analyticsImageOrigins]],
    ["connect-src", [SELF, ...analyticsConnectOrigins]],
    ["object-src", [NONE]],
    ["base-uri", [SELF]],
    ["frame-ancestors", [NONE]],
    ["form-action", [SELF]],
  ];
  return directives
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

export function buildHeadersFile(contentSecurityPolicy: string) {
  return `${GLOBAL_HEADERS_PATH}\n${HEADER_INDENT}${CSP_HEADER_NAME}: ${contentSecurityPolicy}\n`;
}
