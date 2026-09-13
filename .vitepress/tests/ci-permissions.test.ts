import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Every workflow's GITHUB_TOKEN should be scoped to the least privilege it
// actually needs. None of this repo's workflows write back to the repo, so
// each must declare a top-level `permissions: contents: read` block instead
// of falling back to the repo's default (broader) token scope. The list is
// derived from disk (not hardcoded) so a new workflow is held to the same
// contract the moment it's added. See .github/workflows/*.yml.
const WORKFLOWS_DIR = resolve(process.cwd(), ".github/workflows");
const YAML_FILE_PATTERN = /\.ya?ml$/;
const WORKFLOW_FILES = readdirSync(WORKFLOWS_DIR).filter((file) =>
  YAML_FILE_PATTERN.test(file),
);

const EXPECTED_PERMISSIONS_LINE = "contents: read";

// A top-level YAML key sits at column 0 and is not a comment; a comment or blank
// line inside the block must not be mistaken for the block's terminator.
const TOP_LEVEL_KEY_PATTERN = /^[^\s#]/;
// Tolerates trailing whitespace / a CRLF `\r` so a checkout with autocrlf=true
// still finds the block.
const PERMISSIONS_HEADER_PATTERN = /^permissions:\s*$/;

// Isolates the top-level `permissions:` block: the lines from `permissions:` up
// to (but not including) the next column-0 key. A nested `permissions` inside a
// job is indented, so it can't satisfy the column-0 header and be mistaken for
// the top-level one. Returns null if the block is absent — that's the defect
// this guards against.
function readTopLevelPermissionsBlock(fileName: string) {
  const source = readFileSync(resolve(WORKFLOWS_DIR, fileName), "utf8");
  const lines = source.split("\n");
  const startIndex = lines.findIndex((line) =>
    PERMISSIONS_HEADER_PATTERN.test(line),
  );
  if (startIndex === -1) {
    return null;
  }
  const rest = lines.slice(startIndex + 1);
  const endOffset = rest.findIndex((line) => TOP_LEVEL_KEY_PATTERN.test(line));
  return endOffset === -1 ? rest : rest.slice(0, endOffset);
}

// Strips a trailing inline `# comment` and collapses runs of internal
// whitespace to a single space, so equivalent spellings of the same entry
// (e.g. `contents: read` vs `contents:  read`) compare equal.
function normalizeLine(rawLine: string) {
  const withoutComment = rawLine.replace(/\s+#.*$/, "");
  return withoutComment.trim().replace(/\s+/g, " ");
}

describe("Workflow permissions", () => {
  it("finds at least one workflow to verify", () => {
    expect(WORKFLOW_FILES.length).toBeGreaterThan(0);
  });

  it.each(WORKFLOW_FILES)(
    "%s declares a read-only top-level permissions block",
    (fileName) => {
      const bodyLines = readTopLevelPermissionsBlock(fileName);
      if (bodyLines === null) {
        throw new Error(`${fileName} declares no top-level permissions block`);
      }
      const normalizedLines = bodyLines.map(normalizeLine).filter(Boolean);
      expect(normalizedLines).toEqual([EXPECTED_PERMISSIONS_LINE]);
    },
  );
});
