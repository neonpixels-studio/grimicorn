import { execFileSync } from "node:child_process";
import { isMainModule } from "./is-main-module.mjs";

export const FAILURE_LABEL = "workflow-failure";
const LABEL_COLOR = "D93F0B";
const LABEL_DESCRIPTION = "A scheduled or main-branch workflow run failed";
const ISSUE_LIMIT = 100;
const ISSUE_URL_PATTERN = /\/issues\/(\d+)\s*$/;

export class WorkflowFailureReportError extends Error {}

export function buildIssueTitle(workflowName) {
  return `${workflowName} workflow failed`;
}

export function buildRunUrl({ serverUrl, repository, runId }) {
  return `${serverUrl}/${repository}/actions/runs/${runId}`;
}

export function buildFailureBody({ workflowName, runUrl, eventName, sha }) {
  return [
    `The **${workflowName}** workflow failed on \`${eventName}\` (commit \`${sha}\`).`,
    "",
    `Failed run: ${runUrl}`,
  ].join("\n");
}

// One open tracking issue per workflow: the label scopes the search and the
// exact title tells workflows apart, so repeat failures never open duplicates.
export function findExistingIssue(openIssues, title) {
  return openIssues.find((issue) => issue.title === title);
}

export async function reportFailure({ gh, title, body }) {
  await gh.ensureLabel(FAILURE_LABEL);
  const openIssues = await gh.listOpenIssues(FAILURE_LABEL);
  const existing = findExistingIssue(openIssues, title);
  if (existing) {
    await gh.commentOnIssue(existing.number, body);
    return { action: "commented", number: existing.number };
  }
  const number = await gh.createIssue({
    title,
    body,
    label: FAILURE_LABEL,
  });
  return { action: "created", number };
}

function defaultRunner(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

// Every gh call lives here so reportFailure can be tested with a fake adapter.
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
    listOpenIssues(label) {
      const output = run([
        "issue",
        "list",
        "--label",
        label,
        "--state",
        "open",
        "--limit",
        String(ISSUE_LIMIT),
        "--json",
        "number,title",
      ]);
      return JSON.parse(output);
    },
    commentOnIssue(number, body) {
      run(["issue", "comment", String(number), "--body", body]);
    },
    createIssue({ title, body, label }) {
      const output = run([
        "issue",
        "create",
        "--title",
        title,
        "--label",
        label,
        "--body",
        body,
      ]);
      const match = output.match(ISSUE_URL_PATTERN);
      if (!match) {
        throw new WorkflowFailureReportError(
          `Could not read the issue number from gh output: ${output}`,
        );
      }
      return Number(match[1]);
    },
  };
}

const REQUIRED_VARIABLES = [
  "GITHUB_WORKFLOW",
  "GITHUB_SERVER_URL",
  "GITHUB_REPOSITORY",
  "GITHUB_RUN_ID",
  "GITHUB_EVENT_NAME",
  "GITHUB_SHA",
];

export function readConfig(environment) {
  const missing = REQUIRED_VARIABLES.filter((name) => !environment[name]);
  if (missing.length > 0) {
    throw new WorkflowFailureReportError(`Missing ${missing.join(", ")}.`);
  }
  const workflowName = environment.GITHUB_WORKFLOW;
  const runUrl = buildRunUrl({
    serverUrl: environment.GITHUB_SERVER_URL,
    repository: environment.GITHUB_REPOSITORY,
    runId: environment.GITHUB_RUN_ID,
  });
  return {
    title: buildIssueTitle(workflowName),
    body: buildFailureBody({
      workflowName,
      runUrl,
      eventName: environment.GITHUB_EVENT_NAME,
      sha: environment.GITHUB_SHA,
    }),
  };
}

export async function main(
  environment = process.env,
  gh = createGhAdapter(),
  log = console.log,
) {
  const result = await reportFailure({ gh, ...readConfig(environment) });
  log(`${result.action} issue #${result.number}`);
  return result;
}

if (isMainModule(import.meta.url)) {
  await main();
}
