import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const gzipAsync = promisify(gzip);

// Minimal static server for the built VitePress site, used by the Playwright smoke
// test and by Lighthouse CI (.github/workflows/lighthouse.yml, lighthouserc.cjs).
// Its one job that `vitepress preview` can't do: apply the per-build
// Content-Security-Policy from the generated dist/_headers file, so both consumers
// exercise the site under the exact CSP Netlify serves in production. A hash
// mismatch that blocks VitePress's inline bootstrap (and therefore hydration and
// every interactive behavior) then fails the test instead of shipping silently.
// It also gzips compressible responses (see COMPRESSIBLE_EXTENSIONS) so the
// Lighthouse LCP/byte-budget numbers aren't measured against artificially
// uncompressed bytes — Netlify compresses these same content types at its edge
// (Brotli for browsers that support it, so real production transfers are slightly
// smaller than what gzip measures here), and serving them raw would make every
// text-asset transfer look slower than production ever is. It still applies only
// the CSP and this compression — not netlify.toml's other static headers
// (Cache-Control, X-Frame-Options, HSTS, etc.) — so neither consumer can catch a
// regression in those.
//
// candidateFiles and parseGlobalContentSecurityPolicy are pure (no filesystem, no
// import.meta.url) and exported so the traversal guard and the _headers parser get
// unit coverage (see .vitepress/tests/serve-dist.test.ts), mirroring the
// filesystem-free design of .vitepress/headers.ts. The dist directory is resolved
// only when the server actually boots, so importing this module stays side-effect-free.

const HEADERS_FILENAME = "_headers";
const INDEX_FILENAME = "index.html";
const NOT_FOUND_FILENAME = "404.html";
const CSP_HEADER_NAME = "Content-Security-Policy";
const CSP_LINE_PREFIX = `${CSP_HEADER_NAME}:`;
// The `_headers` block whose policy applies to every path — the only place a CSP
// is written (see buildHeadersFile in .vitepress/headers.ts).
const GLOBAL_HEADERS_PATH = "/*";
const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 4319;
const OK_STATUS = 200;
const NOT_FOUND_STATUS = 404;
const INTERNAL_ERROR_STATUS = 500;
const PLAIN_TEXT_TYPE = "text/plain; charset=utf-8";

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
  [".txt", PLAIN_TEXT_TYPE],
  [".xml", "application/xml"],
]);
const DEFAULT_CONTENT_TYPE = "application/octet-stream";

function contentTypeFor(filePath) {
  return (
    CONTENT_TYPES.get(extname(filePath).toLowerCase()) ?? DEFAULT_CONTENT_TYPE
  );
}

// Extensions Netlify's edge compresses in production (text formats only — the
// image/font formats above are already compressed at rest, so gzipping them again
// would just spend CPU for zero benefit or a larger payload). Kept as its own set
// rather than reusing CONTENT_TYPES' keys so adding a future binary type doesn't
// silently start compressing it.
const COMPRESSIBLE_EXTENSIONS = new Set([
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".svg",
  ".txt",
  ".xml",
]);

// Pure so it's unit-testable without spinning up the server (mirrors
// contentTypeFor's own filesystem-free shape).
export function isCompressibleFile(filePath) {
  return COMPRESSIBLE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

const GZIP_CODING = "gzip";
const ENCODING_QUALITY_PREFIX = "q=";
const DEFAULT_ENCODING_QUALITY = 1;

// One "gzip" or "gzip;q=0.5"-shaped Accept-Encoding token, lowercased so the
// case-insensitive coding compares reliably (this server only ever matches the
// literal "gzip" coding, not the "*"/"x-gzip" forms RFC 9110 also allows — this
// harness only ever sees real Chrome via Lighthouse/Playwright, which sends
// "gzip" explicitly, so that narrower match is intentional, not an oversight).
// An unparseable quality (missing, empty, or not a number — Number.parseFloat
// returns NaN for all three, unlike the bare Number() constructor, which treats
// "" as 0) is treated as the default 1 rather than propagating NaN, so a
// malformed q= can't accidentally disable compression for the whole request.
function parseEncodingToken(rawToken) {
  const [coding, ...parameters] = rawToken.trim().toLowerCase().split(";");
  const qualityParameter = parameters
    .map((parameter) => parameter.trim())
    .find((parameter) => parameter.startsWith(ENCODING_QUALITY_PREFIX));
  const parsedQuality = Number.parseFloat(
    qualityParameter?.slice(ENCODING_QUALITY_PREFIX.length) ?? "",
  );
  const quality = Number.isNaN(parsedQuality)
    ? DEFAULT_ENCODING_QUALITY
    : parsedQuality;
  return { coding: coding.trim(), quality };
}

// Pure header-parsing helper, same shape as parseGlobalContentSecurityPolicy:
// takes the raw header value rather than reading `request` directly, so it can be
// unit-tested without a real IncomingMessage. Rejects an explicit "gzip;q=0"
// (the client asking NOT to receive gzip) rather than matching on substring, and
// a missing/malformed header just falls back to serving uncompressed — deciding
// this wrong is not worth failing the request over.
export function clientAcceptsGzip(acceptEncodingHeader) {
  return (acceptEncodingHeader ?? "")
    .split(",")
    .filter((token) => token.trim().length > 0)
    .map(parseEncodingToken)
    .some((token) => token.coding === GZIP_CODING && token.quality > 0);
}

// A `_headers` path line starts at column 0; header lines under it are indented.
function isPathLine(line) {
  return line.length > 0 && !/^\s/.test(line);
}

// The CSP value on an indented header line, or null if the line isn't one — or is
// an empty policy, which is treated as absent so it can't silently pass as a
// no-op "allow everything" policy. Returning null keeps the parser flat.
function cspValueFrom(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith(CSP_LINE_PREFIX)) {
    return null;
  }
  const value = trimmed.slice(CSP_LINE_PREFIX.length).trim();
  return value.length > 0 ? value : null;
}

// Extracts the global `/*` block's Content-Security-Policy from _headers text,
// scoped to that block so a future path-scoped block can't be picked up by
// mistake. Filesystem-free so it's unit-testable against fixture text. Throws on a
// missing or empty policy rather than returning "" — the whole point of this
// server is to enforce the real policy, so a silent no-op would be worse than loud.
export function parseGlobalContentSecurityPolicy(headersText) {
  let inGlobalBlock = false;
  for (const line of headersText.split("\n")) {
    if (isPathLine(line)) {
      inGlobalBlock = line.trim() === GLOBAL_HEADERS_PATH;
      continue;
    }
    const policy = cspValueFrom(line);
    if (inGlobalBlock && policy) {
      return policy;
    }
  }
  throw new Error(
    `No non-empty ${CSP_HEADER_NAME} for ${GLOBAL_HEADERS_PATH} in ${HEADERS_FILENAME}`,
  );
}

// Re-read per request (not cached) so a rebuild between runs of a reused server can
// never serve a stale policy alongside fresh HTML. It's one small file on loopback
// for a handful of requests.
async function readContentSecurityPolicy(headersFile) {
  const headersText = await readFile(headersFile, "utf8");
  return parseGlobalContentSecurityPolicy(headersText);
}

// Decodes a percent-encoded path, returning null on malformed input rather than
// letting a URIError from a stray "%" crash the request.
function decodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

// The candidate files a request path may resolve to under distDir, in order: the
// path itself, then the clean-URL forms VitePress emits (foo -> foo.html,
// foo/ -> foo/index.html). Returns an empty list for a malformed path or one that
// escapes distDir (the trailing-separator check rejects sibling dirs like
// "dist-backup" that share the prefix), so those fall through to a real 404 rather
// than a misleading 200. Pure: distDir is passed in, not read from the module.
export function candidateFiles(distDir, requestUrl) {
  const decodedPath = decodePathname(requestUrl.split("?")[0].split("#")[0]);
  if (decodedPath === null) {
    return [];
  }
  if (decodedPath === "/") {
    return [join(distDir, INDEX_FILENAME)];
  }
  const resolved = normalize(join(distDir, decodedPath));
  if (resolved !== distDir && !resolved.startsWith(distDir + sep)) {
    return [];
  }
  return [resolved, `${resolved}.html`, join(resolved, INDEX_FILENAME)];
}

async function isReadableFile(filePath) {
  const stats = await stat(filePath).catch(() => null);
  return stats?.isFile() ?? false;
}

async function firstReadableFile(candidateList) {
  for (const candidate of candidateList) {
    const readable = await isReadableFile(candidate);
    if (readable) {
      return candidate;
    }
  }
  return null;
}

// Gzips `body` when both the file type and the requesting client's
// Accept-Encoding allow it. Returns the bytes to send, the Content-Encoding header
// value to attach (undefined when uncompressed, so the caller can omit the header
// entirely rather than sending an empty one), and whether this response's body
// depends on Accept-Encoding at all — true for every compressible file, not just
// the ones actually compressed this time, since an uncompressed response for a
// compressible file still varies by that header (a client that didn't ask for
// gzip got different bytes than one that did/will). Exported for direct unit
// coverage (decoding the gzip path back with zlib) beyond what testing
// isCompressibleFile/clientAcceptsGzip individually already implies.
export async function compressIfEligible(
  body,
  fileToServe,
  acceptEncodingHeader,
) {
  if (!isCompressibleFile(fileToServe)) {
    return { bytes: body, contentEncoding: undefined, variesByEncoding: false };
  }
  if (!clientAcceptsGzip(acceptEncodingHeader)) {
    return { bytes: body, contentEncoding: undefined, variesByEncoding: true };
  }
  return {
    bytes: await gzipAsync(body),
    contentEncoding: GZIP_CODING,
    variesByEncoding: true,
  };
}

// Pure so the Content-Encoding/Vary logic (easy to silently break — dropping
// Content-Encoding would serve garbled gzip bytes as if they were plain text;
// dropping Vary would fail nothing visibly, just let a cache reuse the wrong
// variant) gets direct unit coverage without a real HTTP round trip.
export function buildResponseHeaders(
  fileToServe,
  contentSecurityPolicy,
  { contentEncoding, variesByEncoding },
) {
  return {
    "Content-Type": contentTypeFor(fileToServe),
    [CSP_HEADER_NAME]: contentSecurityPolicy,
    ...(contentEncoding ? { "Content-Encoding": contentEncoding } : {}),
    // Tells any cache in front of this response (and Lighthouse/Playwright, which
    // both run against it directly) that the body depends on this header, so a
    // response fetched under one Accept-Encoding is never reused for a client
    // that asked for something different — whether or not this particular
    // response happened to be compressed.
    ...(variesByEncoding ? { Vary: "Accept-Encoding" } : {}),
  };
}

async function serveFile(request, response, paths, contentSecurityPolicy) {
  const candidates = candidateFiles(paths.distDir, request.url ?? "/");
  const match = await firstReadableFile(candidates);
  const fileToServe = match ?? paths.notFoundFile;
  const status = match ? OK_STATUS : NOT_FOUND_STATUS;
  const body = await readFile(fileToServe);
  const { bytes, contentEncoding, variesByEncoding } = await compressIfEligible(
    body,
    fileToServe,
    request.headers["accept-encoding"],
  );

  response.writeHead(
    status,
    buildResponseHeaders(fileToServe, contentSecurityPolicy, {
      contentEncoding,
      variesByEncoding,
    }),
  );
  response.end(bytes);
}

// Wraps each request so a rejected path (malformed URL, a directory, a missing
// 404.html, a broken _headers file) becomes a 500 with a readable message instead
// of an unhandled rejection that takes the whole server — and the suite — down. The
// policy is still attached when it was resolved, so an unexpected error never
// silently relaxes the CSP the harness exists to enforce.
function createRequestHandler(paths) {
  return async (request, response) => {
    let contentSecurityPolicy;
    try {
      contentSecurityPolicy = await readContentSecurityPolicy(
        paths.headersFile,
      );
      await serveFile(request, response, paths, contentSecurityPolicy);
    } catch (error) {
      const headers = { "Content-Type": PLAIN_TEXT_TYPE };
      if (contentSecurityPolicy) {
        headers[CSP_HEADER_NAME] = contentSecurityPolicy;
      }
      response.writeHead(INTERNAL_ERROR_STATUS, headers);
      response.end(String(error?.message ?? error));
    }
  };
}

function resolvePort() {
  const rawPort = process.argv[2] ?? process.env.PORT ?? String(DEFAULT_PORT);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid port: ${rawPort}`);
  }
  return port;
}

function resolvePaths() {
  const distDir = fileURLToPath(new URL("../dist", import.meta.url));
  return {
    distDir,
    headersFile: join(distDir, HEADERS_FILENAME),
    notFoundFile: join(distDir, NOT_FOUND_FILENAME),
  };
}

async function start() {
  const port = resolvePort();
  const paths = resolvePaths();
  const server = createServer(createRequestHandler(paths));
  server.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
  server.listen(port, LOOPBACK_HOST, () => {
    console.log(`Serving ${paths.distDir} on http://${LOOPBACK_HOST}:${port}`);
  });
}

// Only boot the server when run directly (node serve-dist.mjs); stay inert when
// imported by the unit tests so they can exercise the pure helpers in isolation.
const isRunDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isRunDirectly) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
