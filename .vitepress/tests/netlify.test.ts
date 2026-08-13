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
