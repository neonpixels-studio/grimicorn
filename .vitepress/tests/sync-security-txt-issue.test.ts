import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SecurityTxtSyncError,
  createGhAdapter,
  main,
  readConfig,
  syncTrackingIssue,
} from "../../scripts/sync-security-txt-issue.mjs";

const LABEL = "security-txt-expiry";
const TITLE = "Renew the security.txt Expires date";
const BODY_FILE = "/tmp/issue-body.md";
const EXISTING_NUMBER = 42;

const ENVIRONMENT = {
  REMINDER_LABEL: LABEL,
  ISSUE_TITLE: TITLE,
  ISSUE_BODY_FILE: BODY_FILE,
  DUE: "true",
};

function fakeGh(existing?: number) {
  return {
    ensureLabel: vi.fn(),
    findOpenIssueNumber: vi.fn(() => existing),
    closeIssue: vi.fn(),
    editIssueBody: vi.fn(),
    createIssue: vi.fn(),
  };
}

function sync(gh: ReturnType<typeof fakeGh>, due: boolean) {
  return syncTrackingIssue({
    gh,
    label: LABEL,
    title: TITLE,
    bodyFile: BODY_FILE,
    due,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncTrackingIssue", () => {
  it("opens an issue when due and none is open", () => {
    const gh = fakeGh();
    expect(sync(gh, true)).toEqual({ action: "created" });
    expect(gh.ensureLabel).toHaveBeenCalledWith(LABEL);
    expect(gh.createIssue).toHaveBeenCalledWith({
      title: TITLE,
      label: LABEL,
      bodyFile: BODY_FILE,
    });
    expect(gh.editIssueBody).not.toHaveBeenCalled();
    expect(gh.closeIssue).not.toHaveBeenCalled();
  });

  it("refreshes the open issue instead of duplicating it when due", () => {
    const gh = fakeGh(EXISTING_NUMBER);
    expect(sync(gh, true)).toEqual({
      action: "updated",
      number: EXISTING_NUMBER,
    });
    expect(gh.editIssueBody).toHaveBeenCalledWith(EXISTING_NUMBER, BODY_FILE);
    expect(gh.createIssue).not.toHaveBeenCalled();
    expect(gh.closeIssue).not.toHaveBeenCalled();
  });

  it("closes the open issue once the date was renewed", () => {
    const gh = fakeGh(EXISTING_NUMBER);
    expect(sync(gh, false)).toEqual({
      action: "closed",
      number: EXISTING_NUMBER,
    });
    expect(gh.closeIssue).toHaveBeenCalledWith(
      EXISTING_NUMBER,
      "Expires was renewed; closing.",
    );
    expect(gh.createIssue).not.toHaveBeenCalled();
    expect(gh.editIssueBody).not.toHaveBeenCalled();
  });

  it("does nothing when not due and no issue is open", () => {
    const gh = fakeGh();
    expect(sync(gh, false)).toEqual({ action: "none" });
    expect(gh.createIssue).not.toHaveBeenCalled();
    expect(gh.editIssueBody).not.toHaveBeenCalled();
    expect(gh.closeIssue).not.toHaveBeenCalled();
  });
});

describe("createGhAdapter", () => {
  it("ensures the label with force, color and description", () => {
    const run = vi.fn();
    createGhAdapter(run).ensureLabel(LABEL);
    expect(run).toHaveBeenCalledWith([
      "label",
      "create",
      LABEL,
      "--force",
      "--color",
      "FBCA04",
      "--description",
      "security.txt Expires date is approaching",
    ]);
  });

  it("returns the first open issue number, or undefined when none", () => {
    const withIssues = vi.fn(() => '[{"number":7},{"number":3}]');
    expect(createGhAdapter(withIssues).findOpenIssueNumber(LABEL)).toBe(7);
    expect(withIssues).toHaveBeenCalledWith([
      "issue",
      "list",
      "--label",
      LABEL,
      "--state",
      "open",
      "--json",
      "number",
    ]);
    const empty = vi.fn(() => "[]");
    expect(createGhAdapter(empty).findOpenIssueNumber(LABEL)).toBeUndefined();
  });

  it("closes with a comment", () => {
    const run = vi.fn();
    createGhAdapter(run).closeIssue(EXISTING_NUMBER, "done");
    expect(run).toHaveBeenCalledWith([
      "issue",
      "close",
      "42",
      "--comment",
      "done",
    ]);
  });

  it("edits the body from a file", () => {
    const run = vi.fn();
    createGhAdapter(run).editIssueBody(EXISTING_NUMBER, BODY_FILE);
    expect(run).toHaveBeenCalledWith([
      "issue",
      "edit",
      "42",
      "--body-file",
      BODY_FILE,
    ]);
  });

  it("creates an issue with title, label and body file", () => {
    const run = vi.fn();
    createGhAdapter(run).createIssue({
      title: TITLE,
      label: LABEL,
      bodyFile: BODY_FILE,
    });
    expect(run).toHaveBeenCalledWith([
      "issue",
      "create",
      "--title",
      TITLE,
      "--label",
      LABEL,
      "--body-file",
      BODY_FILE,
    ]);
  });
});

describe("readConfig", () => {
  it("maps the environment and parses DUE", () => {
    expect(readConfig(ENVIRONMENT)).toEqual({
      label: LABEL,
      title: TITLE,
      bodyFile: BODY_FILE,
      due: true,
    });
    expect(readConfig({ ...ENVIRONMENT, DUE: "false" }).due).toBe(false);
  });

  it("throws naming every missing variable", () => {
    expect(() => readConfig({})).toThrow(
      "Missing REMINDER_LABEL, ISSUE_TITLE, ISSUE_BODY_FILE, DUE.",
    );
    expect(() => readConfig({ ...ENVIRONMENT, DUE: "" })).toThrow(
      SecurityTxtSyncError,
    );
  });

  it("rejects a DUE value that is not true or false", () => {
    expect(() => readConfig({ ...ENVIRONMENT, DUE: "yes" })).toThrow(
      'DUE must be "true" or "false"',
    );
  });
});

describe("main", () => {
  it("syncs through the adapter and logs the action", () => {
    const gh = fakeGh();
    const log = vi.fn();
    const result = main(ENVIRONMENT, gh, log);
    expect(result).toEqual({ action: "created" });
    expect(log).toHaveBeenCalledWith("security.txt tracking issue: created");
  });
});

describe("main with bad config", () => {
  it("fails before any GitHub call", () => {
    const gh = fakeGh();
    expect(() => main({}, gh, vi.fn())).toThrow(SecurityTxtSyncError);
    expect(gh.ensureLabel).not.toHaveBeenCalled();
  });
});
