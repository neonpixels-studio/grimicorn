import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const NETLIFY_CONFIG_PATH = resolve(process.cwd(), "netlify.toml");
const DEPLOY_WORKFLOW_PATH = resolve(
  process.cwd(),
  ".github/workflows/weekly-production-deploy.yml",
);

const PRODUCTION_CONTEXT_PATTERN =
  /^\[context\.production\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m;
const IGNORE_LINE_PATTERN = /^\s*ignore\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/m;
const CRON_PATTERN = /^\s*-\s*cron:\s*"([^"]+)"/m;

function readProductionContext() {
  const config = readFileSync(NETLIFY_CONFIG_PATH, "utf8");
  const match = config.match(PRODUCTION_CONTEXT_PATTERN);
  if (!match) {
    throw new Error("netlify.toml has no [context.production] table");
  }
  return match[1];
}

describe("netlify.toml production gate", () => {
  it("never declares ignore at build level", () => {
    const config = readFileSync(NETLIFY_CONFIG_PATH, "utf8");
    const buildSection = config.match(/^\[build\]\s*$([\s\S]*?)(?=^\[)/m)?.[1];
    expect(buildSection).toBeDefined();
    expect(buildSection).not.toMatch(/^\s*ignore\s*=/m);
  });

  function runIgnoreCommand(hookTitle: string | undefined) {
    const rawCommand = readProductionContext().match(IGNORE_LINE_PATTERN)?.[1];
    expect(rawCommand).toBeDefined();
    const command = rawCommand!.replace(/\\"/g, '"');
    const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
    if (hookTitle !== undefined) {
      env.INCOMING_HOOK_TITLE = hookTitle;
    }
    return spawnSync("sh", ["-c", command], { env }).status;
  }

  it("builds (exit 1) when triggered by a build hook", () => {
    expect(runIgnoreCommand("Weekly production deploy")).toBe(1);
  });

  it("cancels the build (exit 0) when no hook triggered it", () => {
    expect(runIgnoreCommand(undefined)).toBe(0);
    expect(runIgnoreCommand("")).toBe(0);
  });
});

describe("weekly-production-deploy workflow", () => {
  const workflow = readFileSync(DEPLOY_WORKFLOW_PATH, "utf8");

  it("runs on Mondays 14:00 UTC and on manual dispatch", () => {
    expect(workflow.match(CRON_PATTERN)?.[1]).toBe("0 14 * * 1");
    expect(workflow).toMatch(/^ {2}workflow_dispatch:/m);
  });

  it("reads the hook URL from the secret via env, not inline interpolation", () => {
    expect(workflow).toContain(
      "NETLIFY_BUILD_HOOK_URL: ${{ secrets.NETLIFY_BUILD_HOOK_URL }}",
    );
    const secretLines = workflow
      .split("\n")
      .filter((line) => line.includes("${{ secrets."));
    expect(secretLines.length).toBeGreaterThan(0);
    secretLines.forEach((line) => {
      expect(line).toMatch(/^\s+[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}\s*$/);
    });
  });

  it("fails on a non-2xx hook response", () => {
    expect(workflow).toMatch(
      /curl --fail --silent --show-error --max-time 30 -X POST/,
    );
  });
});

describe("weekly-production-deploy verification step", () => {
  const workflow = readFileSync(DEPLOY_WORKFLOW_PATH, "utf8");

  it("passes the Netlify token and build id to the verify script via env", () => {
    expect(workflow).toContain(
      "NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}",
    );
    expect(workflow).toContain(
      "NETLIFY_BUILD_ID: ${{ steps.trigger.outputs.build_id }}",
    );
    expect(workflow).toContain("run: node scripts/verify-netlify-deploy.mjs");
  });

  it("only verifies when the hook was actually triggered", () => {
    const verifyStep = workflow
      .split("- name: Verify the Netlify")[1]
      .split("\n      - name:")[0];
    expect(verifyStep).toContain("if: steps.recent.outputs.skip != 'true'");
  });

  it("allows enough time for the Netlify build to be polled", () => {
    const minutes = Number(
      workflow.match(/^ {4}timeout-minutes:\s*(\d+)/m)?.[1],
    );
    expect(minutes).toBeGreaterThanOrEqual(25);
  });
});
