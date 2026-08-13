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
const GOOGLE_FONTS_STYLESHEET_ORIGIN = "https://fonts.googleapis.com";
const GOOGLE_FONTS_FILE_ORIGIN = "https://fonts.gstatic.com";
const SCRIPT_SRC_DIRECTIVE = "script-src";

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

export function buildContentSecurityPolicy(scriptHashes: string[]) {
  const directives: Array<[string, string[]]> = [
    ["default-src", [SELF]],
    [SCRIPT_SRC_DIRECTIVE, [SELF, ...scriptHashes]],
    ["style-src", [SELF, UNSAFE_INLINE, GOOGLE_FONTS_STYLESHEET_ORIGIN]],
    ["font-src", [SELF, GOOGLE_FONTS_FILE_ORIGIN]],
    ["img-src", [SELF, DATA_SCHEME]],
    ["connect-src", [SELF]],
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
