import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const NETLIFY_CONFIG_PATH = resolve(process.cwd(), "netlify.toml");
const CI_WORKFLOW_PATH = resolve(process.cwd(), ".github/workflows/ci.yml");
const PACKAGE_JSON_PATH = resolve(process.cwd(), "package.json");

// Accepts TOML basic ("...") and literal ('...') strings.
const BUILD_COMMAND_PATTERN = /^\s*command\s*=\s*(["'])(.*?)\1\s*$/m;
const BUILD_SECTION_PATTERN = /^\[build\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m;
const COMMAND_SEPARATOR = "&&";
const NPM_RUN_PREFIX = /^npm run /;

// The `ci` job runs the gates a deploy must share; the separate `e2e` job needs
// Playwright browsers and is not part of the Netlify build.
const CI_JOB_PATTERN = /^ {2}ci:\s*$([\s\S]*?)(?=^ {2}[\w-]+:\s*$|(?![\s\S]))/m;
const CI_RUN_STEP_PATTERN = /^\s*run:\s*(npm run \S+)\s*$/gm;

const BUILD_STEP = "npm run build";
// Not runnable on Netlify: it only diffs a pull request against its base branch
// (GITHUB_BASE_REF, never set by Netlify) and needs the full git history Netlify
// does not clone. Build is excluded here because it must always run last.
const CI_STEPS_NOT_RUN_ON_NETLIFY = [
  "npm run check:asset-version-bump",
  BUILD_STEP,
];

function readBuildSteps() {
  const config = readFileSync(NETLIFY_CONFIG_PATH, "utf8");
  const section = config.match(BUILD_SECTION_PATTERN)?.[1];
  const command = section?.match(BUILD_COMMAND_PATTERN)?.[2];
  if (!command) {
    throw new Error("netlify.toml [build] section has no command");
  }
  return command.split(COMMAND_SEPARATOR).map((step) => step.trim());
}

function readCiGateSteps() {
  const workflow = readFileSync(CI_WORKFLOW_PATH, "utf8");
  const ciJob = workflow.match(CI_JOB_PATTERN)?.[1];
  if (!ciJob) {
    throw new Error("ci.yml has no `ci` job");
  }
  return [...ciJob.matchAll(CI_RUN_STEP_PATTERN)].map((match) => match[1]);
}

function readPackageScripts() {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")).scripts;
}

describe("netlify build command", () => {
  it("runs every CI gate that can run on Netlify, then the build last", () => {
    const expectedGates = readCiGateSteps().filter(
      (step) => !CI_STEPS_NOT_RUN_ON_NETLIFY.includes(step),
    );
    expect(expectedGates.length).toBeGreaterThan(0);
    expect(readBuildSteps()).toEqual([...expectedGates, BUILD_STEP]);
  });

  it("includes lint, typecheck and tests", () => {
    expect(readBuildSteps()).toEqual(
      expect.arrayContaining([
        "npm run lint",
        "npm run typecheck",
        "npm run test:ci",
      ]),
    );
  });

  it.each(readBuildSteps())("%s is a defined npm script", (step) => {
    expect(readPackageScripts()).toHaveProperty(
      step.replace(NPM_RUN_PREFIX, ""),
    );
  });
});
