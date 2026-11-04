import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SECURITY_TXT = resolve(
  import.meta.dirname,
  "../../public/.well-known/security.txt",
);
const EXPECTED_CONTACT =
  "https://github.com/neonpixels-studio/grimicorn/security/advisories/new";
// Fixed reference instead of the wall clock: a clock-dependent assertion would turn
// every deploy red as Expires nears. Renewal is flagged by
// .github/workflows/security-txt-expiry.yml instead.
const REFERENCE_DATE = new Date("2026-11-04T00:00:00.000Z");
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

  it("has exactly one valid Expires that is later than the fixed reference date", () => {
    const expiresValues = fields.get("expires") ?? [];
    expect(expiresValues).toHaveLength(1);
    expect(expiresValues[0]).toMatch(RFC3339_UTC_TIMESTAMP);

    const expires = new Date(expiresValues[0]);
    expect(Number.isNaN(expires.getTime())).toBe(false);
    expect(expires.getTime()).toBeGreaterThan(REFERENCE_DATE.getTime());
  });
});
