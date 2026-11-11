import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// A hung step would otherwise hold a runner for GitHub's 6 hour default, so
// every job in every workflow file must declare its own timeout-minutes.
const WORKFLOWS_DIR = resolve(process.cwd(), ".github/workflows");
const WORKFLOW_FILE_PATTERN = /\.ya?ml$/;
const JOBS_KEY_PATTERN = /^jobs:\s*(?:#.*)?$/;
const JOB_NAME_PATTERN = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/;
const TIMEOUT_PATTERN = /^ {4}timeout-minutes:\s*(\d+)\s*(?:#.*)?$/;
const TOP_LEVEL_KEY_PATTERN = /^\S/;
const COMMENT_LINE_PATTERN = /^\s*#/;
const MAX_TIMEOUT_MINUTES = 30;

type JobTimeouts = Record<string, number | undefined>;

// Maps each job name under the top-level `jobs:` key to its timeout-minutes
// (undefined when the job declares none).
function readJobTimeouts(lines: string[]): JobTimeouts {
  const jobsIndex = lines.findIndex((line) => JOBS_KEY_PATTERN.test(line));
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

const workflowFiles = readdirSync(WORKFLOWS_DIR).filter((fileName) =>
  WORKFLOW_FILE_PATTERN.test(fileName),
);

describe("workflow job timeouts", () => {
  it("finds the workflow files", () => {
    expect(workflowFiles).toEqual(
      expect.arrayContaining(["ci.yml", "security.yml"]),
    );
  });

  describe.each(workflowFiles)("%s", (fileName) => {
    const timeouts = readJobTimeouts(
      readFileSync(join(WORKFLOWS_DIR, fileName), "utf8").split(/\r?\n/),
    );

    it("defines at least one job", () => {
      expect(Object.keys(timeouts).length).toBeGreaterThan(0);
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

  it("finds the ci.yml schedule-health and ci jobs", () => {
    const timeouts = readJobTimeouts(
      readFileSync(join(WORKFLOWS_DIR, "ci.yml"), "utf8").split(/\r?\n/),
    );
    expect(Object.keys(timeouts)).toEqual(
      expect.arrayContaining(["schedule-health", "ci", "e2e"]),
    );
  });
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

  it("keeps scanning past a column-0 comment inside jobs", () => {
    const lines = [
      "jobs:",
      "  a:",
      "    timeout-minutes: 3",
      "# note",
      "  b:",
      "    timeout-minutes: 4",
    ];
    expect(readJobTimeouts(lines)).toEqual({ a: 3, b: 4 });
  });

  it("recognises a job header with a trailing comment", () => {
    const lines = [
      "jobs:",
      "  a:",
      "    runs-on: ubuntu-latest",
      "  b: # has its own cap",
      "    timeout-minutes: 4",
    ];
    expect(readJobTimeouts(lines)).toEqual({ a: undefined, b: 4 });
  });

  it("accepts a trailing comment on timeout-minutes", () => {
    const lines = ["jobs:", "  a:", "    timeout-minutes: 5 # cap"];
    expect(readJobTimeouts(lines)).toEqual({ a: 5 });
  });

  it("returns nothing when there is no jobs key", () => {
    expect(readJobTimeouts(["name: Example"])).toEqual({});
  });
});
