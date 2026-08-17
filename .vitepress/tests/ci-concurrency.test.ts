import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Every workflow must cancel a superseded run when its branch is pushed again, so
// rapid PR pushes don't run the full matrix to completion redundantly. The list is
// derived from disk (not hardcoded) so a new workflow is held to the same contract
// the moment it's added. See .github/workflows/*.yml.
const WORKFLOWS_DIR = resolve(process.cwd(), ".github/workflows");
const YAML_FILE_PATTERN = /\.ya?ml$/;
const WORKFLOW_FILES = readdirSync(WORKFLOWS_DIR).filter((file) =>
  YAML_FILE_PATTERN.test(file),
);

// Keyed on workflow + ref so runs on the same branch share a group (and cancel
// each other) while different branches stay independent.
const EXPECTED_GROUP = "${{ github.workflow }}-${{ github.ref }}";
// Conditional so a push-to-main (or release) run is never cancelled; only
// non-main refs (PR branches) cancel their in-flight predecessor.
const EXPECTED_CANCEL_IN_PROGRESS = "${{ github.ref != 'refs/heads/main' }}";

// A top-level YAML key sits at column 0 and is not a comment; a comment or blank
// line inside the block must not be mistaken for the block's terminator.
const TOP_LEVEL_KEY_PATTERN = /^[^\s#]/;
// Tolerates trailing whitespace / a CRLF `\r` so a checkout with autocrlf=true
// still finds the block.
const CONCURRENCY_HEADER_PATTERN = /^concurrency:\s*$/;

// Isolates the top-level `concurrency:` block: the lines from `concurrency:` up to
// (but not including) the next column-0 key. A nested `concurrency:` inside a job
// is indented, so it can't satisfy the column-0 header and be mistaken for the
// top-level one. Fails loud if the block is absent — that's the defect this guards.
function readTopLevelConcurrencyBlock(fileName: string) {
  const source = readFileSync(resolve(WORKFLOWS_DIR, fileName), "utf8");
  const lines = source.split("\n");
  const startIndex = lines.findIndex((line) =>
    CONCURRENCY_HEADER_PATTERN.test(line),
  );
  if (startIndex === -1) {
    throw new Error(`${fileName} declares no top-level concurrency block`);
  }
  const rest = lines.slice(startIndex + 1);
  const endOffset = rest.findIndex((line) => TOP_LEVEL_KEY_PATTERN.test(line));
  return endOffset === -1 ? rest : rest.slice(0, endOffset);
}

// Strips a trailing inline `# comment` and surrounding quotes, and collapses runs of
// internal whitespace to a single space, so equivalent spellings of the same
// expression (e.g. `${{ github.ref }}` vs `${{github.ref}}`) compare equal. This is
// not a full YAML parse — the workflow files use the plain block form this repo
// commits, matching the hand-parsing style of netlify.test.ts.
function normalizeScalar(rawValue: string) {
  const withoutComment = rawValue.replace(/\s+#.*$/, "").trim();
  const withoutQuotes = withoutComment.replace(/^(["'])(.*)\1$/, "$2");
  return withoutQuotes.replace(/\s+/g, " ");
}

// Reads a single `key: value` entry from the block, insisting on exactly one match
// so a duplicated key (which YAML would silently resolve to the last) fails loud.
function readBlockValue(bodyLines: string[], key: string, fileName: string) {
  const pattern = new RegExp(`^\\s+${key}:\\s*(.+?)\\s*$`);
  const matches = bodyLines
    .map((line) => line.match(pattern))
    .filter((match): match is RegExpMatchArray => match !== null);
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one "${key}" in ${fileName} concurrency block, found ${matches.length}`,
    );
  }
  return normalizeScalar(matches[0][1]);
}

describe("Workflow concurrency groups", () => {
  it("finds at least one workflow to verify", () => {
    expect(WORKFLOW_FILES.length).toBeGreaterThan(0);
  });

  it.each(WORKFLOW_FILES)(
    "%s cancels superseded runs via a top-level concurrency group",
    (fileName) => {
      const bodyLines = readTopLevelConcurrencyBlock(fileName);
      expect(readBlockValue(bodyLines, "group", fileName)).toBe(EXPECTED_GROUP);
      expect(readBlockValue(bodyLines, "cancel-in-progress", fileName)).toBe(
        EXPECTED_CANCEL_IN_PROGRESS,
      );
    },
  );
});
