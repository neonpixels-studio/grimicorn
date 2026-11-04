import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SKIP_SCRIPT = resolve(process.cwd(), "scripts/skip-check.sh");
const TRIGGER_SCRIPT = resolve(
  process.cwd(),
  "scripts/trigger-netlify-deploy.sh",
);
const HOOK_URL = "https://hooks.example.test/build";

let workDir: string;
let binDir: string;
let outputFile: string;

function writeStub(name: string, body: string) {
  const stubPath = join(binDir, name);
  writeFileSync(stubPath, `#!/bin/sh\n${body}\n`);
  chmodSync(stubPath, 0o755);
}

function run(
  script: string,
  environment: Record<string, string>,
  cwd = workDir,
) {
  return spawnSync("bash", [script], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: `${binDir}:${process.env.PATH}`,
      GITHUB_OUTPUT: outputFile,
      ...environment,
    },
  });
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "deploy-scripts-"));
  binDir = join(workDir, "bin");
  mkdirSync(binDir);
  outputFile = join(workDir, "github-output");
  writeFileSync(outputFile, "");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("scripts/skip-check.sh", () => {
  function createRepoWithStubbedCheck() {
    const repoDir = join(workDir, "repo");
    mkdirSync(join(repoDir, "scripts"), { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: repoDir });
    spawnSync(
      "git",
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.test",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "init",
      ],
      { cwd: repoDir },
    );
    const sha = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
      encoding: "utf8",
    }).stdout.trim();
    writeStub("node", 'echo "$CURRENT_SHA $1" > "$NODE_CALL_FILE"');
    return { repoDir, sha };
  }

  it("never skips on manual dispatch and does not look up the deploy", () => {
    const { repoDir } = createRepoWithStubbedCheck();
    const callFile = join(workDir, "node-call");
    const result = run(
      SKIP_SCRIPT,
      { EVENT_NAME: "workflow_dispatch", NODE_CALL_FILE: callFile },
      repoDir,
    );
    expect(result.status).toBe(0);
    expect(readFileSync(outputFile, "utf8")).toBe("skip=false\n");
    expect(() => readFileSync(callFile, "utf8")).toThrow();
  });

  it("hands the checked out commit to the undeployed-commits check on schedule", () => {
    const { repoDir, sha } = createRepoWithStubbedCheck();
    const callFile = join(workDir, "node-call");
    const result = run(
      SKIP_SCRIPT,
      { EVENT_NAME: "schedule", NODE_CALL_FILE: callFile },
      repoDir,
    );
    expect(result.status).toBe(0);
    expect(readFileSync(callFile, "utf8").trim()).toBe(
      `${sha} scripts/check-undeployed-commits.mjs`,
    );
  });

  it("fails when the check script fails, so a broken lookup is not hidden", () => {
    const { repoDir } = createRepoWithStubbedCheck();
    writeStub("node", "exit 3");
    const result = run(SKIP_SCRIPT, { EVENT_NAME: "schedule" }, repoDir);
    expect(result.status).toBe(3);
  });
});

describe("scripts/trigger-netlify-deploy.sh", () => {
  function stubCurl(exitCode: number) {
    const callFile = join(workDir, "curl-args");
    writeStub("curl", `echo "$@" > "${callFile}"\nexit ${exitCode}`);
    return callFile;
  }

  it("posts to the hook with the weekly title on schedule and writes outputs", () => {
    const callFile = stubCurl(0);
    const result = run(TRIGGER_SCRIPT, {
      EVENT_NAME: "schedule",
      NETLIFY_BUILD_HOOK_URL: HOOK_URL,
    });
    expect(result.status).toBe(0);
    expect(readFileSync(callFile, "utf8")).toContain(
      `-X POST -d {} ${HOOK_URL}?trigger_title=Weekly+production+deploy`,
    );
    const output = readFileSync(outputFile, "utf8");
    expect(output).toContain("trigger_title=Weekly production deploy\n");
    expect(output).toMatch(
      /triggered_at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n/,
    );
  });

  it("uses the manual title for any non-schedule event", () => {
    const callFile = stubCurl(0);
    const result = run(TRIGGER_SCRIPT, {
      EVENT_NAME: "workflow_dispatch",
      NETLIFY_BUILD_HOOK_URL: HOOK_URL,
    });
    expect(result.status).toBe(0);
    expect(readFileSync(callFile, "utf8")).toContain(
      "trigger_title=Manual+production+deploy",
    );
    expect(readFileSync(outputFile, "utf8")).toContain(
      "trigger_title=Manual production deploy\n",
    );
  });

  it("fails without calling the hook when the secret is missing", () => {
    const callFile = stubCurl(0);
    const result = run(TRIGGER_SCRIPT, { EVENT_NAME: "schedule" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error::");
    expect(() => readFileSync(callFile, "utf8")).toThrow();
    expect(readFileSync(outputFile, "utf8")).toBe("");
  });

  it("fails and writes no outputs when the hook call fails", () => {
    stubCurl(22);
    const result = run(TRIGGER_SCRIPT, {
      EVENT_NAME: "schedule",
      NETLIFY_BUILD_HOOK_URL: HOOK_URL,
    });
    expect(result.status).toBe(22);
    expect(readFileSync(outputFile, "utf8")).toBe("");
  });
});
