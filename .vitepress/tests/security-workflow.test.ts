import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SECURITY_WORKFLOW_PATH = resolve(
  process.cwd(),
  ".github/workflows/security.yml",
);
const CRON_PATTERN = /^ {2}schedule:\r?\n {4}- cron: "([^"]+)"/m;
const SECURITY_CRON = "0 12 * * 1";
const FULL_HISTORY_STEP_PATTERN =
  /- name: Scan full history\r?\n(?:\s+\w+:[^\n]*\r?\n)*?\s+if: ([^\r\n]+)/;

const PR_RANGE_STEP_PATTERN =
  /- name: Scan pull request commit range\r?\n(?:\s+\w+:[^\n]*\r?\n)*?\s+if: ([^\r\n]+)/;

describe("security workflow triggers", () => {
  const workflow = readFileSync(SECURITY_WORKFLOW_PATH, "utf8");

  it("keeps the push and pull_request triggers on main", () => {
    expect(workflow).toMatch(/^ {2}push:\r?\n {4}branches: \[main\]/m);
    expect(workflow).toMatch(/^ {2}pull_request:\r?\n {4}branches: \[main\]/m);
  });

  it("runs weekly on Mondays 12:00 UTC, ahead of the 14:00 deploy", () => {
    expect(workflow.match(CRON_PATTERN)?.[1]).toBe(SECURITY_CRON);
  });

  it("can be dispatched manually", () => {
    expect(workflow).toMatch(/^ {2}workflow_dispatch:/m);
  });

  it("scans full history on scheduled and manual runs, not only on push", () => {
    const condition = workflow.match(FULL_HISTORY_STEP_PATTERN)?.[1];
    expect(condition).toBe("github.event_name != 'pull_request'");
  });

  it("keeps the pull request range scan limited to pull_request events", () => {
    const condition = workflow.match(PR_RANGE_STEP_PATTERN)?.[1];
    expect(condition).toBe("github.event_name == 'pull_request'");
  });
});
