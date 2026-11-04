import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CI_WORKFLOW_PATH = resolve(process.cwd(), ".github/workflows/ci.yml");
const SCHEDULE_HEALTH_JOB_PATTERN =
  /^ {2}schedule-health:\r?\n([\s\S]*?)(?=^ {2}\w[\w-]*:\r?\n)/m;

describe("schedule-health job in ci.yml", () => {
  const workflow = readFileSync(CI_WORKFLOW_PATH, "utf8");
  const job = workflow.match(SCHEDULE_HEALTH_JOB_PATTERN)?.[1];

  it("exists and runs only on push events", () => {
    expect(job).toBeDefined();
    expect(job).toMatch(/if: github\.event_name == 'push'/);
  });

  it("reads the state of security.yml from the workflows API", () => {
    expect(job).toMatch(
      /gh api "repos\/\$\{\{ github\.repository \}\}\/actions\/workflows\/security\.yml" --jq \.state/,
    );
  });

  it("fails the job unless the workflow state is active", () => {
    expect(job).toMatch(/if \[ "\$\{state\}" != "active" \]; then/);
    expect(job).toMatch(/exit 1/);
  });

  it("only needs read access to actions", () => {
    expect(job).toMatch(/permissions:\r?\n\s+actions: read/);
    expect(job).not.toMatch(/: write/);
  });
});
