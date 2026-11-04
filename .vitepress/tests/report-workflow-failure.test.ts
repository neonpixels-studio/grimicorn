import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FAILURE_LABEL,
  WorkflowFailureReportError,
  buildFailureBody,
  buildIssueTitle,
  buildRunUrl,
  createGhAdapter,
  findExistingIssue,
  isMainModule,
  main,
  readConfig,
  reportFailure,
} from "../../scripts/report-workflow-failure.mjs";

const SCRIPT_PATH = resolve(
  import.meta.dirname,
  "../../scripts/report-workflow-failure.mjs",
);
const WORKFLOWS_DIR = resolve(process.cwd(), ".github/workflows");
const NEW_ISSUE_NUMBER = 77;

const ENVIRONMENT = {
  GITHUB_WORKFLOW: "Weekly production deploy",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "owner/repo",
  GITHUB_RUN_ID: "12345",
  GITHUB_EVENT_NAME: "schedule",
  GITHUB_SHA: "abc123",
};

function fakeGh(openIssues: Array<{ number: number; title: string }> = []) {
  return {
    ensureLabel: vi.fn(async () => {}),
    listOpenIssues: vi.fn(async () => openIssues),
    commentOnIssue: vi.fn(async () => {}),
    createIssue: vi.fn(async (_issue: object) => NEW_ISSUE_NUMBER),
  };
}

describe("message builders", () => {
  it("titles the issue after the workflow", () => {
    expect(buildIssueTitle("Security")).toBe("Security workflow failed");
  });

  it("links the failed run", () => {
    expect(
      buildRunUrl({
        serverUrl: "https://github.com",
        repository: "owner/repo",
        runId: "9",
      }),
    ).toBe("https://github.com/owner/repo/actions/runs/9");
  });

  it("names the workflow, event, commit and run in the body", () => {
    const body = buildFailureBody({
      workflowName: "Security",
      runUrl: "https://example.com/run",
      eventName: "schedule",
      sha: "abc123",
    });
    expect(body).toContain("**Security**");
    expect(body).toContain("`schedule`");
    expect(body).toContain("`abc123`");
    expect(body).toContain("https://example.com/run");
  });
});

describe("findExistingIssue", () => {
  it("matches only the exact title", () => {
    const issues = [
      { number: 1, title: "Security workflow failed (old)" },
      { number: 2, title: "Security workflow failed" },
    ];
    expect(findExistingIssue(issues, "Security workflow failed")?.number).toBe(
      2,
    );
    expect(findExistingIssue(issues, "Other workflow failed")).toBeUndefined();
  });
});

describe("reportFailure", () => {
  it("creates a labeled issue when none is open", async () => {
    const gh = fakeGh();
    const result = await reportFailure({ gh, title: "T", body: "B" });
    expect(result).toEqual({ action: "created", number: NEW_ISSUE_NUMBER });
    expect(gh.createIssue).toHaveBeenCalledWith({
      title: "T",
      body: "B",
      label: FAILURE_LABEL,
    });
    expect(gh.commentOnIssue).not.toHaveBeenCalled();
  });

  it("comments on the open issue instead of opening a duplicate", async () => {
    const gh = fakeGh([{ number: 5, title: "T" }]);
    const result = await reportFailure({ gh, title: "T", body: "B" });
    expect(result).toEqual({ action: "commented", number: 5 });
    expect(gh.commentOnIssue).toHaveBeenCalledWith(5, "B");
    expect(gh.createIssue).not.toHaveBeenCalled();
  });

  it("opens a separate issue when only another workflow's issue is open", async () => {
    const gh = fakeGh([{ number: 5, title: "Other workflow failed" }]);
    const result = await reportFailure({ gh, title: "T", body: "B" });
    expect(result.action).toBe("created");
  });

  it("ensures the label exists and searches by it before deciding", async () => {
    const gh = fakeGh();
    await reportFailure({ gh, title: "T", body: "B" });
    expect(gh.ensureLabel).toHaveBeenCalledWith(FAILURE_LABEL);
    expect(gh.listOpenIssues).toHaveBeenCalledWith(FAILURE_LABEL);
  });

  it("propagates a gh failure instead of reporting success", async () => {
    const gh = fakeGh();
    gh.createIssue.mockRejectedValue(new Error("boom"));
    await expect(reportFailure({ gh, title: "T", body: "B" })).rejects.toThrow(
      "boom",
    );
  });
});

describe("createGhAdapter", () => {
  it("lists open labeled issues as parsed JSON", () => {
    const run = vi.fn((_args: string[]) => '[{"number":3,"title":"T"}]');
    const issues = createGhAdapter(run).listOpenIssues(FAILURE_LABEL);
    expect(issues).toEqual([{ number: 3, title: "T" }]);
    const args = run.mock.calls[0][0];
    expect(args.slice(0, 2)).toEqual(["issue", "list"]);
    expect(args).toContain(FAILURE_LABEL);
    expect(args).toContain("open");
  });

  it("creates the issue with the label and parses the number from the URL", () => {
    const run = vi.fn(
      (_args: string[]) => "https://github.com/owner/repo/issues/42\n",
    );
    const number = createGhAdapter(run).createIssue({
      title: "T",
      body: "B",
      label: FAILURE_LABEL,
    });
    expect(number).toBe(42);
    const args = run.mock.calls[0][0];
    expect(args.slice(0, 2)).toEqual(["issue", "create"]);
    expect(args).toContain(FAILURE_LABEL);
  });

  it("fails loudly when gh prints no issue URL", () => {
    const run = vi.fn((_args: string[]) => "unexpected output");
    expect(() =>
      createGhAdapter(run).createIssue({ title: "T", body: "B", label: "L" }),
    ).toThrow(WorkflowFailureReportError);
  });

  it("comments by issue number", () => {
    const run = vi.fn((_args: string[]) => "");
    createGhAdapter(run).commentOnIssue(5, "B");
    expect(run).toHaveBeenCalledWith(["issue", "comment", "5", "--body", "B"]);
  });

  it("forces label creation so an existing label is not an error", () => {
    const run = vi.fn((_args: string[]) => "");
    createGhAdapter(run).ensureLabel(FAILURE_LABEL);
    const args = run.mock.calls[0][0];
    expect(args.slice(0, 3)).toEqual(["label", "create", FAILURE_LABEL]);
    expect(args).toContain("--force");
  });
});

describe("readConfig", () => {
  it("derives the title and body from the Actions environment", () => {
    const { title, body } = readConfig(ENVIRONMENT);
    expect(title).toBe("Weekly production deploy workflow failed");
    expect(body).toContain("https://github.com/owner/repo/actions/runs/12345");
  });

  it.each(Object.keys(ENVIRONMENT))("requires %s", (name) => {
    expect(() => readConfig({ ...ENVIRONMENT, [name]: "" })).toThrow(
      WorkflowFailureReportError,
    );
  });
});

describe("main", () => {
  it("reports through the injected adapter and logs the outcome", async () => {
    const gh = fakeGh();
    const log = vi.fn();
    const result = await main(ENVIRONMENT, gh as never, log);
    expect(result.action).toBe("created");
    expect(log).toHaveBeenCalledWith(`created issue #${NEW_ISSUE_NUMBER}`);
  });
});

describe("isMainModule", () => {
  it("is true only for the script itself", () => {
    expect(isMainModule(undefined)).toBe(false);
    expect(isMainModule(SCRIPT_PATH)).toBe(true);
    expect(isMainModule("/nonexistent/other.mjs")).toBe(false);
  });
});

describe.each(["weekly-production-deploy.yml", "security.yml"])(
  "%s failure notification job",
  (fileName) => {
    const workflow = readFileSync(resolve(WORKFLOWS_DIR, fileName), "utf8");
    const afterHeader = workflow.split("\n  notify-failure:")[1] ?? "";
    const job = afterHeader.split(/\n {2}[\w-]+:/)[0];
    const otherJobs = workflow.replace(`\n  notify-failure:${job}`, "");

    it("exists and runs only when a needed job failed", () => {
      expect(job).not.toBe("");
      expect(job).toMatch(/^ {4}needs: \[[^\]]+\]/m);
      expect(job).toMatch(/^ {4}if: .*failure\(\)/m);
    });

    it("never fires for pull requests and only on main", () => {
      expect(job).toContain("github.event_name != 'pull_request'");
      expect(job).toContain("github.ref == 'refs/heads/main'");
    });

    it("grants issues: write on this job only", () => {
      expect(job).toMatch(/^ {6}issues: write$/m);
      expect(otherJobs).not.toMatch(/issues: write/);
    });

    it("runs the reporting script with the workflow token", () => {
      expect(job).toContain("run: node scripts/report-workflow-failure.mjs");
      expect(job).toContain("GH_TOKEN: ${{ github.token }}");
    });
  },
);
