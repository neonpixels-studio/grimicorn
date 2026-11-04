import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REMINDER_THRESHOLD_DAYS,
  SecurityTxtExpiryError,
  buildIssueBody,
  daysUntil,
  evaluateExpiry,
  isMainModule,
  main,
  parseExpires,
} from "../../scripts/check-security-txt-expiry.mjs";

const EXPIRES = "2027-09-04T00:00:00.000Z";
const FILE = `Contact: https://example.com\nExpires: ${EXPIRES}\nCanonical: https://example.com/x\n`;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysBeforeExpiry(days: number) {
  return new Date(new Date(EXPIRES).getTime() - days * DAY_MS);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("parseExpires", () => {
  it("reads the Expires timestamp", () => {
    expect(parseExpires(FILE).toISOString()).toBe(EXPIRES);
  });

  it("throws when Expires is missing", () => {
    expect(() => parseExpires("Contact: x\n")).toThrow(SecurityTxtExpiryError);
  });

  it("throws when Expires is not an RFC 3339 UTC timestamp", () => {
    expect(() => parseExpires("Expires: 2027-09-04\n")).toThrow(
      SecurityTxtExpiryError,
    );
    expect(() => parseExpires("Expires: 2027-13-45T00:00:00Z\n")).toThrow(
      SecurityTxtExpiryError,
    );
  });
});

describe("daysUntil", () => {
  it("rounds down to whole days and goes negative after expiry", () => {
    const expires = new Date(EXPIRES);
    expect(daysUntil(expires, daysBeforeExpiry(10))).toBe(10);
    expect(daysUntil(expires, new Date(expires.getTime() - DAY_MS / 2))).toBe(
      0,
    );
    expect(daysUntil(expires, new Date(expires.getTime() + 3 * DAY_MS))).toBe(
      -3,
    );
  });
});

describe("evaluateExpiry", () => {
  it("uses a 60 day default threshold", () => {
    expect(REMINDER_THRESHOLD_DAYS).toBe(60);
  });

  it("is not due when more than the threshold remains", () => {
    const result = evaluateExpiry({
      content: FILE,
      now: daysBeforeExpiry(REMINDER_THRESHOLD_DAYS + 1),
    });
    expect(result.due).toBe(false);
    expect(result.daysRemaining).toBe(REMINDER_THRESHOLD_DAYS + 1);
  });

  it("is due exactly at the threshold", () => {
    const result = evaluateExpiry({
      content: FILE,
      now: daysBeforeExpiry(REMINDER_THRESHOLD_DAYS),
    });
    expect(result.due).toBe(true);
  });

  it("is due once expired", () => {
    const result = evaluateExpiry({
      content: FILE,
      now: new Date(new Date(EXPIRES).getTime() + DAY_MS),
    });
    expect(result.due).toBe(true);
    expect(result.daysRemaining).toBe(-1);
  });

  it("honours a custom threshold", () => {
    const now = daysBeforeExpiry(20);
    expect(evaluateExpiry({ content: FILE, now, thresholdDays: 10 }).due).toBe(
      false,
    );
    expect(evaluateExpiry({ content: FILE, now, thresholdDays: 30 }).due).toBe(
      true,
    );
  });
});

describe("buildIssueBody", () => {
  it("describes an upcoming expiry", () => {
    expect(buildIssueBody({ daysRemaining: 12, expires: EXPIRES })).toContain(
      "expires in 12 day(s)",
    );
  });

  it("describes an expired file", () => {
    expect(buildIssueBody({ daysRemaining: -4, expires: EXPIRES })).toContain(
      "expired 4 day(s) ago",
    );
  });
});

describe("main", () => {
  function writeFixture() {
    const directory = mkdtempSync(join(tmpdir(), "sectxt-"));
    const securityTxtPath = join(directory, "security.txt");
    writeFileSync(securityTxtPath, FILE);
    vi.spyOn(console, "log").mockImplementation(() => {});
    return {
      securityTxtPath,
      output: join(directory, "out"),
      body: join(directory, "body.md"),
    };
  }

  it("writes outputs and the issue body when due", () => {
    const { securityTxtPath, output, body } = writeFixture();
    const result = main(
      { GITHUB_OUTPUT: output, ISSUE_BODY_FILE: body },
      daysBeforeExpiry(5),
      securityTxtPath,
    );
    expect(result.due).toBe(true);
    expect(readFileSync(output, "utf8")).toBe("due=true\ndays_remaining=5\n");
    expect(readFileSync(body, "utf8")).toContain("expires in 5 day(s)");
  });

  it("writes due=false and no issue body when not due", () => {
    const { securityTxtPath, output, body } = writeFixture();
    main(
      { GITHUB_OUTPUT: output, ISSUE_BODY_FILE: body },
      daysBeforeExpiry(200),
      securityTxtPath,
    );
    expect(readFileSync(output, "utf8")).toContain("due=false");
    expect(existsSync(body)).toBe(false);
  });

  it("reads the real security.txt without throwing", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() => main({}, new Date("2026-11-04T00:00:00.000Z"))).not.toThrow();
  });
});

describe("isMainModule", () => {
  it("is false without an entry path or for another file", () => {
    expect(isMainModule(undefined)).toBe(false);
    expect(isMainModule("/nonexistent/other.mjs")).toBe(false);
  });
});
