import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// A hung gitleaks download or npm audit would otherwise hold a runner for
// GitHub's 6 hour default on the weekly schedule, so every job in security.yml
// must declare its own timeout-minutes.
const SECURITY_WORKFLOW = resolve(
  process.cwd(),
  ".github/workflows/security.yml",
);
const JOB_NAME_PATTERN = /^ {2}([A-Za-z0-9_-]+):\s*$/;
const TIMEOUT_PATTERN = /^ {4}timeout-minutes:\s*(\d+)\s*(?:#.*)?$/;
const TOP_LEVEL_KEY_PATTERN = /^\S/;
const COMMENT_LINE_PATTERN = /^\s*#/;
const MAX_TIMEOUT_MINUTES = 30;

type JobTimeouts = Record<string, number | undefined>;

// Maps each job name under the top-level `jobs:` key to its timeout-minutes
// (undefined when the job declares none).
function readJobTimeouts(lines: string[]): JobTimeouts {
  const jobsIndex = lines.findIndex((line) => line === "jobs:");
  if (jobsIndex === -1) {
    return {};
  }

  const timeouts: JobTimeouts = {};
  let currentJob: string | undefined;
  for (const line of lines.slice(jobsIndex + 1)) {
    if (TOP_LEVEL_KEY_PATTERN.test(line) && !COMMENT_LINE_PATTERN.test(line)) {
      break;
    }
    const jobMatch = line.match(JOB_NAME_PATTERN);
    if (jobMatch) {
      currentJob = jobMatch[1];
      timeouts[currentJob] = undefined;
      continue;
    }
    const timeoutMatch = line.match(TIMEOUT_PATTERN);
    if (timeoutMatch && currentJob !== undefined) {
      timeouts[currentJob] = Number(timeoutMatch[1]);
    }
  }
  return timeouts;
}

describe("security.yml job timeouts", () => {
  const timeouts = readJobTimeouts(
    readFileSync(SECURITY_WORKFLOW, "utf8").split("\n"),
  );

  it("finds the gitleaks, audit and notify-failure jobs", () => {
    expect(Object.keys(timeouts)).toEqual(
      expect.arrayContaining(["gitleaks", "audit", "notify-failure"]),
    );
  });

  it.each(Object.keys(timeouts))(
    "%s declares a sensible timeout-minutes",
    (jobName) => {
      const minutes = timeouts[jobName];
      expect(minutes, `${jobName} has no timeout-minutes`).toBeDefined();
      expect(minutes).toBeGreaterThan(0);
      expect(minutes).toBeLessThanOrEqual(MAX_TIMEOUT_MINUTES);
    },
  );
});

describe("readJobTimeouts edge cases", () => {
  it("reports undefined for a job without timeout-minutes", () => {
    const lines = [
      "jobs:",
      "  slow:",
      "    runs-on: ubuntu-latest",
      "  fast:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 5",
    ];
    expect(readJobTimeouts(lines)).toEqual({ slow: undefined, fast: 5 });
  });

  it("ignores a step-level timeout-minutes", () => {
    const lines = [
      "jobs:",
      "  slow:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: x",
      "        timeout-minutes: 5",
    ];
    expect(readJobTimeouts(lines)).toEqual({ slow: undefined });
  });

  it("stops at the next top-level key", () => {
    const lines = ["jobs:", "  a:", "    timeout-minutes: 3", "other:", "  b:"];
    expect(readJobTimeouts(lines)).toEqual({ a: 3 });
  });
});
