import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

// lighthouserc.cjs's error-level best-practices assertion assumes Google
// Analytics stays unloaded, which holds only while CONTEXT is not "production"
// (see ANALYTICS_ENABLED in .vitepress/config.ts). lighthouse.yml enforces that
// with a guard step instead of a comment; these tests keep the guard present,
// first, and actually failing.
const WORKFLOW_PATH = resolve(
  process.cwd(),
  ".github/workflows/lighthouse.yml",
);
const GUARD_STEP_NAME = "Guard against CONTEXT=production";
const FIRST_STEP_MARKER = "    steps:\n";
const NEXT_STEP_MARKER = "\n      - ";
const RUN_BLOCK_PATTERN = /run: \|\n((?: {10}.*\n?)+)/;
const CONTEXT_ASSIGNMENT_PATTERN = /^\s*CONTEXT:/m;

const workflow = readFileSync(WORKFLOW_PATH, "utf8");

function guardScript() {
  const stepStart = workflow.indexOf(`- name: ${GUARD_STEP_NAME}`);
  const stepBody = workflow.slice(stepStart);
  const nextStep = stepBody.indexOf(NEXT_STEP_MARKER, 1);
  const step = nextStep === -1 ? stepBody : stepBody.slice(0, nextStep);
  const script = step.match(RUN_BLOCK_PATTERN)?.[1];
  if (!script) {
    throw new Error("Guard step has no run block");
  }
  return script.replace(/^ {10}/gm, "");
}

function runGuard(context: string | undefined) {
  const environment: Record<string, string | undefined> = {
    PATH: process.env.PATH,
  };
  if (context !== undefined) {
    environment.CONTEXT = context;
  }
  return spawnSync("bash", ["-c", guardScript()], {
    env: environment,
    encoding: "utf8",
  });
}

describe("lighthouse.yml CONTEXT guard", () => {
  it("is the first step of the job", () => {
    const stepsSource = workflow.slice(
      workflow.indexOf(FIRST_STEP_MARKER) + FIRST_STEP_MARKER.length,
    );
    const firstStepLine = stepsSource
      .split("\n")
      .find((line) => line.trim() !== "" && !line.trim().startsWith("#"));
    expect(firstStepLine?.trim()).toBe(`- name: ${GUARD_STEP_NAME}`);
  });

  it("fails with an explicit error when CONTEXT is production", () => {
    const result = runGuard("production");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error");
    expect(result.stdout).toContain("CONTEXT must not be 'production'");
  });

  it.each([undefined, "", "deploy-preview", "branch-deploy"])(
    "passes when CONTEXT is %j",
    (context) => {
      expect(runGuard(context).status).toBe(0);
    },
  );

  it("does not assign CONTEXT anywhere the guard cannot see", () => {
    expect(workflow).not.toMatch(CONTEXT_ASSIGNMENT_PATTERN);
  });
});
