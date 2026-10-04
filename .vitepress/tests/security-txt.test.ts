import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SECURITY_TXT = resolve(
  import.meta.dirname,
  "../../public/.well-known/security.txt",
);
const EXPECTED_CONTACT =
  "https://github.com/neonpixels-studio/grimicorn/security/advisories/new";
const RENEWAL_WINDOW_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const RFC3339_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const EXPECTED_CANONICAL = "https://grimicorn.dev/.well-known/security.txt";

function readFields(content: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  const lines = content.split("\n");
  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (line.startsWith("#") || separatorIndex === -1) {
      continue;
    }
    const name = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    fields.set(name, [...(fields.get(name) ?? []), value]);
  }
  return fields;
}

function addOneYear(date: Date): Date {
  const limit = new Date(date);
  limit.setUTCFullYear(limit.getUTCFullYear() + 1);
  return limit;
}

describe("/.well-known/security.txt (RFC 9116)", () => {
  const fields = readFields(readFileSync(SECURITY_TXT, "utf8"));

  it("lists the GitHub private vulnerability reporting URL as Contact", () => {
    expect(fields.get("contact")).toEqual([EXPECTED_CONTACT]);
  });

  it("declares the production URL of the file as Canonical", () => {
    expect(fields.get("canonical")).toEqual([EXPECTED_CANONICAL]);
  });

  it("declares English as the preferred language", () => {
    expect(fields.get("preferred-languages")).toEqual(["en"]);
  });

  // Deliberate renewal reminder: fails RENEWAL_WINDOW_DAYS before expiry. Fix by bumping
  // Expires in public/.well-known/security.txt to ~11 months out.
  it(`has exactly one valid Expires, at least ${RENEWAL_WINDOW_DAYS} days out and under one year out`, () => {
    const expiresValues = fields.get("expires") ?? [];
    expect(expiresValues).toHaveLength(1);
    expect(expiresValues[0]).toMatch(RFC3339_UTC_TIMESTAMP);

    const expires = new Date(expiresValues[0]);
    const now = new Date();
    expect(Number.isNaN(expires.getTime())).toBe(false);
    const renewalDeadline =
      now.getTime() + RENEWAL_WINDOW_DAYS * MILLISECONDS_PER_DAY;
    expect(expires.getTime()).toBeGreaterThan(renewalDeadline);
    expect(expires.getTime()).toBeLessThan(addOneYear(now).getTime());
  });
});
