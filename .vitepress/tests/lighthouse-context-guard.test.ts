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
const CONTEXT_ASSIGNMENT_PATTERN = /\bCONTEXT["']?\s*[:=]/;
const CONFIG_PATH = resolve(process.cwd(), ".vitepress/config.ts");
const CONFIG_ANALYTICS_ASSIGNMENT =
  /const ANALYTICS_ENABLED\s*=\s*process\.env\.CONTEXT === "production";/;

const workflow = readFileSync(WORKFLOW_PATH, "utf8");

function guardStepSource() {
  const stepStart = workflow.indexOf(`- name: ${GUARD_STEP_NAME}`);
  if (stepStart === -1) {
    throw new Error(
      `Guard step "${GUARD_STEP_NAME}" not found in ${WORKFLOW_PATH}`,
    );
  }
  const stepBody = workflow.slice(stepStart);
  const nextStep = stepBody.indexOf(NEXT_STEP_MARKER, 1);
  return nextStep === -1 ? stepBody : stepBody.slice(0, nextStep);
}

function guardScript() {
  const script = guardStepSource().match(RUN_BLOCK_PATTERN)?.[1];
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
  const result = spawnSync("bash", ["-c", guardScript()], {
    env: environment,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

describe("lighthouse.yml CONTEXT guard", () => {
  it("is the first step of the job", () => {
    const stepsStart = workflow.indexOf(FIRST_STEP_MARKER);
    if (stepsStart === -1) {
      throw new Error(`"steps:" block not found in ${WORKFLOW_PATH}`);
    }
    const stepsSource = workflow.slice(stepsStart + FIRST_STEP_MARKER.length);
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
    const outsideGuard = workflow.replace(guardStepSource(), "");
    expect(outsideGuard).not.toMatch(CONTEXT_ASSIGNMENT_PATTERN);
  });

  it("matches the exact predicate config.ts uses for analytics", () => {
    expect(readFileSync(CONFIG_PATH, "utf8")).toMatch(
      CONFIG_ANALYTICS_ASSIGNMENT,
    );
  });
});
