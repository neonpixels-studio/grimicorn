import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SECURITY_TXT = resolve(
  import.meta.dirname,
  "../../public/.well-known/security.txt",
);
const EXPECTED_CONTACT =
  "https://github.com/neonpixels-studio/grimicorn/security/advisories/new";
const EXPECTED_CANONICAL = "https://grimicorn.dev/.well-known/security.txt";

function readFields(content: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  const lines = content.split("\n");
  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (line.startsWith("#") || separatorIndex === -1) {
      continue;
    }
    const name = line.slice(0, separatorIndex).trim();
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
    expect(fields.get("Contact")).toEqual([EXPECTED_CONTACT]);
  });

  it("declares the production URL of the file as Canonical", () => {
    expect(fields.get("Canonical")).toEqual([EXPECTED_CANONICAL]);
  });

  it("declares English as the preferred language", () => {
    expect(fields.get("Preferred-Languages")).toEqual(["en"]);
  });

  it("has exactly one valid Expires that is in the future and under one year out", () => {
    const expiresValues = fields.get("Expires") ?? [];
    expect(expiresValues).toHaveLength(1);
    expect(expiresValues[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);

    const expires = new Date(expiresValues[0]);
    const now = new Date();
    expect(Number.isNaN(expires.getTime())).toBe(false);
    expect(expires.getTime()).toBeGreaterThan(now.getTime());
    expect(expires.getTime()).toBeLessThan(addOneYear(now).getTime());
  });
});
