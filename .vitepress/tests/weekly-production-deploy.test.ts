import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  it("only declares ignore inside [context.production], never at build level", () => {
    const config = readFileSync(NETLIFY_CONFIG_PATH, "utf8");
    const buildSection = config.match(/^\[build\]\s*$([\s\S]*?)(?=^\[)/m)?.[1];
    expect(buildSection).toBeDefined();
    expect(buildSection).not.toMatch(/^\s*ignore\s*=/m);
  });

  it("cancels the build unless INCOMING_HOOK_TITLE is set", () => {
    const rawCommand = readProductionContext().match(IGNORE_LINE_PATTERN)?.[1];
    expect(rawCommand).toBeDefined();
    const command = rawCommand!.replace(/\\"/g, '"');
    expect(command).toBe(
      'if [ -n "$INCOMING_HOOK_TITLE" ]; then exit 1; else exit 0; fi',
    );
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
    const runLines = workflow
      .split("\n")
      .filter((line) => /secrets\./.test(line) && /\brun:/.test(line));
    expect(runLines).toEqual([]);
  });

  it("fails on a non-2xx hook response", () => {
    expect(workflow).toMatch(/curl --fail --silent --show-error -X POST/);
  });
});
