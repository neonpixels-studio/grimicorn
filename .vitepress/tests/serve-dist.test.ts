import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  candidateFiles,
  parseGlobalContentSecurityPolicy,
} from "../e2e/serve-dist.mjs";

// Unit coverage for the security-relevant pure logic in the e2e static server: the
// traversal guard (a regression here would silently serve files outside dist) and
// the _headers CSP parser (a regression would serve the wrong policy, or an empty
// no-op one, while the browser smoke test still passed). Mirrors the filesystem-free
// unit-testing approach of .vitepress/headers.ts.

// A stand-in build directory: candidateFiles takes it as an argument, so the tests
// never touch a real filesystem.
const DIST = join("/site", "dist");

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
