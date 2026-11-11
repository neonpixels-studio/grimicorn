import { execFileSync } from "node:child_process";
import { isMainModule } from "./is-main-module.mjs";

const LABEL_COLOR = "FBCA04";
const LABEL_DESCRIPTION = "security.txt Expires date is approaching";
const RENEWED_COMMENT = "Expires was renewed; closing.";

export class SecurityTxtSyncError extends Error {}

// Due: open the tracking issue, or refresh the open one. Not due: close any open one,
// since the Expires date was renewed.
export function syncTrackingIssue({ gh, label, title, bodyFile, due }) {
  gh.ensureLabel(label);
  const existing = gh.findOpenIssueNumber(label);
  if (!due && existing) {
    gh.closeIssue(existing, RENEWED_COMMENT);
    return { action: "closed", number: existing };
  }
  if (!due) {
    return { action: "none" };
  }
  if (existing) {
    gh.editIssueBody(existing, bodyFile);
    return { action: "updated", number: existing };
  }
  gh.createIssue({ title, label, bodyFile });
  return { action: "created" };
}

function defaultRunner(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

// Every gh call lives here so syncTrackingIssue can be tested with a fake adapter.
export function createGhAdapter(run = defaultRunner) {
  return {
    ensureLabel(label) {
      run([
        "label",
        "create",
        label,
        "--force",
        "--color",
        LABEL_COLOR,
        "--description",
        LABEL_DESCRIPTION,
      ]);
    },
    findOpenIssueNumber(label) {
      const output = run([
        "issue",
        "list",
        "--label",
        label,
        "--state",
        "open",
        "--json",
        "number",
      ]);
      const issues = JSON.parse(output);
      return issues.length > 0 ? issues[0].number : undefined;
    },
    closeIssue(number, comment) {
      run(["issue", "close", String(number), "--comment", comment]);
    },
    editIssueBody(number, bodyFile) {
      run(["issue", "edit", String(number), "--body-file", bodyFile]);
    },
    createIssue({ title, label, bodyFile }) {
      run([
        "issue",
        "create",
        "--title",
        title,
        "--label",
        label,
        "--body-file",
        bodyFile,
      ]);
    },
  };
}

const REQUIRED_VARIABLES = [
  "REMINDER_LABEL",
  "ISSUE_TITLE",
  "ISSUE_BODY_FILE",
  "DUE",
];

function parseDue(value) {
  if (value !== "true" && value !== "false") {
    throw new SecurityTxtSyncError(
      `DUE must be "true" or "false", got "${value}".`,
    );
  }
  return value === "true";
}

export function readConfig(environment) {
  const missing = REQUIRED_VARIABLES.filter((name) => !environment[name]);
  if (missing.length > 0) {
    throw new SecurityTxtSyncError(`Missing ${missing.join(", ")}.`);
  }
  return {
    label: environment.REMINDER_LABEL,
    title: environment.ISSUE_TITLE,
    bodyFile: environment.ISSUE_BODY_FILE,
    due: parseDue(environment.DUE),
  };
}

export function main(
  environment = process.env,
  gh = createGhAdapter(),
  log = console.log,
) {
  const result = syncTrackingIssue({ gh, ...readConfig(environment) });
  log(`security.txt tracking issue: ${result.action}`);
  return result;
}

if (isMainModule(import.meta.url)) {
  main();
}
