import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Minimal static server for the built VitePress site, used only by the Playwright
// smoke test. Its one job that `vitepress preview` can't do: apply the per-build
// Content-Security-Policy from the generated dist/_headers file, so the smoke test
// exercises the site under the exact CSP Netlify serves in production. A hash
// mismatch that blocks VitePress's inline bootstrap (and therefore hydration and
// every interactive behavior) then fails the test instead of shipping silently.
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

async function serveFile(request, response, paths, contentSecurityPolicy) {
  const candidates = candidateFiles(paths.distDir, request.url ?? "/");
  const match = await firstReadableFile(candidates);
  const fileToServe = match ?? paths.notFoundFile;
  const status = match ? OK_STATUS : NOT_FOUND_STATUS;
  const body = await readFile(fileToServe);

  response.writeHead(status, {
    "Content-Type": contentTypeFor(fileToServe),
    [CSP_HEADER_NAME]: contentSecurityPolicy,
  });
  response.end(body);
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
