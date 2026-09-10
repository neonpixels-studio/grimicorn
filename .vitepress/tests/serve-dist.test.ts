import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  candidateFiles,
  parseGlobalContentSecurityPolicy,
  isCompressibleFile,
  clientAcceptsGzip,
  compressIfEligible,
  buildResponseHeaders,
} from "../e2e/serve-dist.mjs";

// Unit coverage for the security-relevant pure logic in the e2e static server: the
// traversal guard (a regression here would silently serve files outside dist) and
// the _headers CSP parser (a regression would serve the wrong policy, or an empty
// no-op one, while the browser smoke test still passed). Mirrors the filesystem-free
// unit-testing approach of .vitepress/headers.ts.

// A stand-in build directory: candidateFiles takes it as an argument, so the tests
// never touch a real filesystem.
const DIST = join("/site", "dist");
// Shared fixture paths for the compression tests below (isCompressibleFile,
// compressIfEligible, buildResponseHeaders): one representative compressible file
// and one representative already-compressed one.
const HTML_PATH = join(DIST, "index.html");
const FONT_PATH = join(DIST, "fonts/space-grotesk.woff2");

describe("candidateFiles", () => {
  it("maps the site root to index.html", () => {
    expect(candidateFiles(DIST, "/")).toEqual([join(DIST, "index.html")]);
  });

  it("offers the path plus its clean-URL forms for a nested request", () => {
    expect(candidateFiles(DIST, "/assets/app.js")).toEqual([
      join(DIST, "assets/app.js"),
      join(DIST, "assets/app.js.html"),
      join(DIST, "assets/app.js", "index.html"),
    ]);
  });

  it("strips the query and hash before resolving", () => {
    expect(candidateFiles(DIST, "/?v=1#top")).toEqual([
      join(DIST, "index.html"),
    ]);
  });

  it("returns no candidates for a path that escapes dist", () => {
    expect(candidateFiles(DIST, "/../secret")).toEqual([]);
  });

  it("returns no candidates for a sibling directory sharing the dist prefix", () => {
    expect(candidateFiles(DIST, "/../dist-backup/secret")).toEqual([]);
  });

  it("returns no candidates for a malformed percent-encoded path", () => {
    expect(candidateFiles(DIST, "/%")).toEqual([]);
  });
});

describe("parseGlobalContentSecurityPolicy", () => {
  it("extracts the policy from the global block", () => {
    const headers = "/*\n  Content-Security-Policy: default-src 'self'\n";
    expect(parseGlobalContentSecurityPolicy(headers)).toBe(
      "default-src 'self'",
    );
  });

  it("ignores a path-scoped block and returns the global one", () => {
    const headers = [
      "/api/*",
      "  Content-Security-Policy: script-src 'none'",
      "/*",
      "  Content-Security-Policy: default-src 'self'",
      "",
    ].join("\n");
    expect(parseGlobalContentSecurityPolicy(headers)).toBe(
      "default-src 'self'",
    );
  });

  it("throws when only a non-global block carries a policy", () => {
    const headers = "/api/*\n  Content-Security-Policy: script-src 'none'\n";
    expect(() => parseGlobalContentSecurityPolicy(headers)).toThrow();
  });

  it("throws on an empty policy rather than serving a no-op one", () => {
    const headers = "/*\n  Content-Security-Policy:\n";
    expect(() => parseGlobalContentSecurityPolicy(headers)).toThrow();
  });

  it("throws when no policy is present at all", () => {
    const headers = "/*\n  X-Frame-Options: DENY\n";
    expect(() => parseGlobalContentSecurityPolicy(headers)).toThrow();
  });
});

describe("isCompressibleFile", () => {
  it("treats text-based build output as compressible", () => {
    expect(isCompressibleFile(HTML_PATH)).toBe(true);
    expect(isCompressibleFile(join(DIST, "assets/app.js"))).toBe(true);
    expect(isCompressibleFile(join(DIST, "assets/style.css"))).toBe(true);
    expect(isCompressibleFile(join(DIST, "images/sitemap.svg"))).toBe(true);
  });

  it("treats already-compressed binary formats as not compressible", () => {
    expect(isCompressibleFile(join(DIST, "assets/grimicorn-hero.avif"))).toBe(
      false,
    );
    expect(isCompressibleFile(join(DIST, "assets/grimicorn-hero.webp"))).toBe(
      false,
    );
    expect(isCompressibleFile(FONT_PATH)).toBe(false);
  });

  it("is case-insensitive on the extension", () => {
    expect(isCompressibleFile(join(DIST, "INDEX.HTML"))).toBe(true);
  });

  it("treats a path with no extension as not compressible", () => {
    expect(isCompressibleFile(join(DIST, "LICENSE"))).toBe(false);
  });
});

describe("clientAcceptsGzip", () => {
  it("accepts a header that lists gzip among other encodings", () => {
    expect(clientAcceptsGzip("gzip, deflate, br")).toBe(true);
  });

  it("rejects a header that omits gzip", () => {
    expect(clientAcceptsGzip("br, deflate")).toBe(false);
  });

  it("rejects a missing header rather than throwing", () => {
    expect(clientAcceptsGzip(undefined)).toBe(false);
  });

  it("is case-insensitive on the coding", () => {
    expect(clientAcceptsGzip("GZIP")).toBe(true);
  });

  it("rejects an explicit gzip;q=0 (the client opting out)", () => {
    expect(clientAcceptsGzip("gzip;q=0, br")).toBe(false);
  });

  it("rejects an empty header", () => {
    expect(clientAcceptsGzip("")).toBe(false);
  });

  it("accepts a non-zero fractional weight", () => {
    expect(clientAcceptsGzip("br;q=1.0, gzip;q=0.5")).toBe(true);
  });

  it("treats a malformed or empty weight as the default rather than rejecting", () => {
    expect(clientAcceptsGzip("gzip;q=abc")).toBe(true);
    expect(clientAcceptsGzip("gzip;q=")).toBe(true);
  });

  it("tolerates whitespace around the q= parameter", () => {
    expect(clientAcceptsGzip("gzip ; q=0")).toBe(false);
  });

  it("rejects a zero weight spelled with extra precision", () => {
    expect(clientAcceptsGzip("gzip;q=0.000")).toBe(false);
  });

  it("rejects a negative weight rather than treating it as positive", () => {
    expect(clientAcceptsGzip("gzip;q=-1")).toBe(false);
  });

  it("finds q= after another parameter", () => {
    expect(clientAcceptsGzip("gzip;foo=bar;q=0")).toBe(false);
  });
});

describe("compressIfEligible", () => {
  const body = Buffer.from("<html>".repeat(50));

  it("gzips a compressible file for a client that accepts gzip", async () => {
    const result = await compressIfEligible(body, HTML_PATH, "gzip, br");
    expect(result.contentEncoding).toBe("gzip");
    expect(result.variesByEncoding).toBe(true);
    expect(gunzipSync(result.bytes)).toEqual(body);
  });

  it("serves a compressible file uncompressed, but still Vary, for a client without gzip", async () => {
    const result = await compressIfEligible(body, HTML_PATH, "br");
    expect(result.contentEncoding).toBeUndefined();
    expect(result.variesByEncoding).toBe(true);
    expect(result.bytes).toEqual(body);
  });

  it("serves a compressible file uncompressed when Accept-Encoding is missing", async () => {
    const result = await compressIfEligible(body, HTML_PATH, undefined);
    expect(result.contentEncoding).toBeUndefined();
    expect(result.variesByEncoding).toBe(true);
    expect(result.bytes).toEqual(body);
  });

  it("never compresses an already-compressed format, even if gzip is accepted", async () => {
    const result = await compressIfEligible(body, FONT_PATH, "gzip");
    expect(result.contentEncoding).toBeUndefined();
    expect(result.variesByEncoding).toBe(false);
    expect(result.bytes).toEqual(body);
  });
});

describe("buildResponseHeaders", () => {
  const CSP = "default-src 'self'";

  it("sets Content-Encoding and Vary for a compressed response", () => {
    const headers = buildResponseHeaders(HTML_PATH, CSP, {
      contentEncoding: "gzip",
      variesByEncoding: true,
    });
    expect(headers["Content-Encoding"]).toBe("gzip");
    expect(headers.Vary).toBe("Accept-Encoding");
    expect(headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(headers["Content-Security-Policy"]).toBe(CSP);
  });

  it("sets Vary but not Content-Encoding for an uncompressed-but-compressible response", () => {
    const headers = buildResponseHeaders(HTML_PATH, CSP, {
      contentEncoding: undefined,
      variesByEncoding: true,
    });
    expect(headers["Content-Encoding"]).toBeUndefined();
    expect(headers.Vary).toBe("Accept-Encoding");
  });

  it("sets neither header for a format that never varies by encoding", () => {
    const headers = buildResponseHeaders(FONT_PATH, CSP, {
      contentEncoding: undefined,
      variesByEncoding: false,
    });
    expect(headers["Content-Encoding"]).toBeUndefined();
    expect(headers.Vary).toBeUndefined();
    expect(headers["Content-Type"]).toBe("font/woff2");
  });
});
