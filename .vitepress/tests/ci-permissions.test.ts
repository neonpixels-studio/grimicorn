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
// A comment line (leading whitespace then `#`) is not YAML content, so it must
// not be mistaken for a `permissions:` entry when the block is compared.
const COMMENT_LINE_PATTERN = /^\s*#/;
// Captures an inline value (e.g. `permissions: write-all`) so a misconfigured
// header is reported as "too broad", not confused with a missing block.
const PERMISSIONS_HEADER_PATTERN = /^permissions:(.*)$/;
// A job (or step) can declare its own `permissions:` block, indented under the
// job key. Per GitHub Actions semantics this fully replaces — not merges with —
// the workflow-level block and can grant broader access, so its mere presence
// defeats the top-level read-only guarantee this test checks for.
const NESTED_PERMISSIONS_PATTERN = /^[ \t]+permissions:/;

// Isolates the top-level `permissions:` block: the lines from `permissions:` up
// to (but not including) the next column-0 key. A nested `permissions` inside a
// job is indented, so it can't satisfy the column-0 header and be mistaken for
// the top-level one.
//
// Returns:
// - `{ kind: "missing" }` if no top-level `permissions:` key exists at all.
// - `{ kind: "inline", value }` if the header carries an inline value
//   (e.g. `permissions: write-all`) rather than a nested block.
// - `{ kind: "block", lines }` for the normal `permissions:\n  contents: read`
//   form, with `lines` holding the block body.
function readTopLevelPermissions(fileName: string) {
  const source = readFileSync(resolve(WORKFLOWS_DIR, fileName), "utf8");
  const lines = source.split("\n");
  const startIndex = lines.findIndex((line) =>
    PERMISSIONS_HEADER_PATTERN.test(line),
  );
  if (startIndex === -1) {
    return { kind: "missing" as const };
  }

  const headerMatch = lines[startIndex].match(PERMISSIONS_HEADER_PATTERN);
  const inlineValue = normalizeLine(headerMatch![1]);
  if (inlineValue) {
    return { kind: "inline" as const, value: inlineValue };
  }

  const rest = lines.slice(startIndex + 1);
  const endOffset = rest.findIndex((line) => TOP_LEVEL_KEY_PATTERN.test(line));
  const blockLines = endOffset === -1 ? rest : rest.slice(0, endOffset);
  return { kind: "block" as const, lines: blockLines };
}

// Strips a trailing inline `# comment` and collapses runs of internal
// whitespace to a single space, so equivalent spellings of the same entry
// (e.g. `contents: read` vs `contents:  read`) compare equal.
function normalizeLine(rawLine: string) {
  const withoutComment = rawLine.replace(/\s+#.*$/, "");
  return withoutComment.trim().replace(/\s+/g, " ");
}

function findNestedPermissionsLine(fileName: string) {
  const source = readFileSync(resolve(WORKFLOWS_DIR, fileName), "utf8");
  const lines = source.split("\n");
  return lines.find((line) => NESTED_PERMISSIONS_PATTERN.test(line));
}

describe("Workflow permissions", () => {
  it("finds at least one workflow to verify", () => {
    expect(WORKFLOW_FILES.length).toBeGreaterThan(0);
  });

  it.each(WORKFLOW_FILES)(
    "%s declares a read-only top-level permissions block",
    (fileName) => {
      const permissions = readTopLevelPermissions(fileName);

      if (permissions.kind === "missing") {
        throw new Error(`${fileName} declares no top-level permissions block`);
      }
      if (permissions.kind === "inline") {
        throw new Error(
          `${fileName} declares an overly broad top-level permissions: ${permissions.value}`,
        );
      }

      const normalizedLines = permissions.lines
        .filter((line) => !COMMENT_LINE_PATTERN.test(line))
        .map(normalizeLine)
        .filter(Boolean);
      expect(normalizedLines).toEqual([EXPECTED_PERMISSIONS_LINE]);
    },
  );

  it.each(WORKFLOW_FILES)(
    "%s has no job-level permissions override",
    (fileName) => {
      const nestedLine = findNestedPermissionsLine(fileName);
      if (nestedLine !== undefined) {
        throw new Error(
          `${fileName} declares a job-level permissions override ("${nestedLine.trim()}"), which replaces (not merges with) the read-only top-level block`,
        );
      }
    },
  );
});
