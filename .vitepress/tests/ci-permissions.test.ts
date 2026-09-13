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

// A comment line (leading whitespace then `#`) is not YAML content, so it must
// not be mistaken for a `permissions:` entry when the block is compared.
const COMMENT_LINE_PATTERN = /^\s*#/;
// Captures leading indentation and an optional inline value, so the same
// pattern finds both the top-level header (indent "") and a job-level
// override (indent > "").
const PERMISSIONS_HEADER_PATTERN = /^([ \t]*)permissions:(.*)$/;
// Matches the standalone-`{}` flow mapping, which grants *no* scopes — the
// tightest possible setting, not an "overly broad" one.
const EMPTY_FLOW_MAPPING_PATTERN = /^\{\s*\}$/;
// A job (or step) can declare its own `permissions:` block, which per GitHub
// Actions semantics fully replaces — not merges with — the workflow-level
// block. Narrowing further (e.g. `permissions: {}` on one job) is fine; only
// a nested grant of `write`/`write-all` defeats the top-level read-only
// guarantee this test checks for.
const WRITE_KEYWORD_PATTERN = /\bwrite(-all)?\b/i;

type PermissionsResult =
  | { kind: "missing" }
  | { kind: "duplicate"; count: number }
  | { kind: "unsupported-inline"; value: string }
  | { kind: "block"; lines: string[] };

// Strips a trailing inline `# comment` and collapses runs of internal
// whitespace to a single space, so equivalent spellings of the same entry
// (e.g. `contents: read` vs `contents:  read`) compare equal.
function normalizeLine(rawLine: string) {
  const withoutComment = rawLine.replace(/\s+#.*$/, "");
  return withoutComment.trim().replace(/\s+/g, " ");
}

function lineIndent(line: string) {
  return line.match(/^[ \t]*/)?.[0].length ?? 0;
}

// Isolates a `permissions:` block body: the lines after the header up to (but
// not including) the next line at the same or shallower indentation that
// isn't blank or a comment. Works for both the top-level header (indent 0,
// terminated by the next column-0 key) and a nested job-level header.
function readBlockBody(lines: string[], headerIndex: number) {
  const headerIndent = lineIndent(lines[headerIndex]);
  const rest = lines.slice(headerIndex + 1);
  const endOffset = rest.findIndex((line) => {
    if (line.trim() === "" || COMMENT_LINE_PATTERN.test(line)) {
      return false;
    }
    return lineIndent(line) <= headerIndent;
  });
  return endOffset === -1 ? rest : rest.slice(0, endOffset);
}

// Reads the single top-level `permissions:` entry. See `PermissionsResult` for
// the possible outcomes; each is asserted on explicitly by the tests below so
// a regression in this parser (e.g. always returning "block") shows up as a
// failing edge-case test, not just as green-by-accident on today's files.
function parseTopLevelPermissions(lines: string[]): PermissionsResult {
  const headerIndexes = lines.flatMap((line, index) => {
    const match = line.match(PERMISSIONS_HEADER_PATTERN);
    return match && match[1] === "" ? [index] : [];
  });

  if (headerIndexes.length === 0) {
    return { kind: "missing" };
  }
  if (headerIndexes.length > 1) {
    return { kind: "duplicate", count: headerIndexes.length };
  }

  const headerIndex = headerIndexes[0];
  const inlineValue = normalizeLine(
    lines[headerIndex].match(PERMISSIONS_HEADER_PATTERN)![2],
  );
  if (inlineValue === "") {
    const blockLines = readBlockBody(lines, headerIndex)
      .filter((line) => !COMMENT_LINE_PATTERN.test(line))
      .map(normalizeLine)
      .filter(Boolean);
    return { kind: "block", lines: blockLines };
  }
  if (EMPTY_FLOW_MAPPING_PATTERN.test(inlineValue)) {
    // `permissions: {}` grants nothing — strictly tighter than the read-only
    // policy, so it's treated the same as an empty block.
    return { kind: "block", lines: [] };
  }
  return { kind: "unsupported-inline", value: inlineValue };
}

// Finds any job-level `permissions:` override that grants a write scope,
// whether inline (`permissions: write-all`) or in its block body
// (`contents: write`). A narrowing override (e.g. `permissions: {}` on a
// single job) is legitimate least-privilege practice and must not fail here.
function findWriteScopeOverride(lines: string[]) {
  const nestedHeaderIndexes = lines.flatMap((line, index) => {
    const match = line.match(PERMISSIONS_HEADER_PATTERN);
    return match && match[1] !== "" ? [index] : [];
  });

  for (const headerIndex of nestedHeaderIndexes) {
    const inlineValue = lines[headerIndex].match(
      PERMISSIONS_HEADER_PATTERN,
    )![2];
    const blockText = readBlockBody(lines, headerIndex).join("\n");
    const candidateText = `${inlineValue}\n${blockText}`;
    if (WRITE_KEYWORD_PATTERN.test(candidateText)) {
      return lines[headerIndex].trim();
    }
  }
  return undefined;
}

function readWorkflowLines(fileName: string) {
  const source = readFileSync(resolve(WORKFLOWS_DIR, fileName), "utf8");
  return source.split("\n");
}

describe("Workflow permissions", () => {
  it("finds at least one workflow to verify", () => {
    expect(WORKFLOW_FILES.length).toBeGreaterThan(0);
  });

  it.each(WORKFLOW_FILES)(
    "%s declares a read-only top-level permissions block",
    (fileName) => {
      const permissions = parseTopLevelPermissions(readWorkflowLines(fileName));

      if (permissions.kind === "missing") {
        throw new Error(`${fileName} declares no top-level permissions block`);
      }
      if (permissions.kind === "duplicate") {
        throw new Error(
          `${fileName} declares ${permissions.count} top-level permissions keys, expected exactly one`,
        );
      }
      if (permissions.kind === "unsupported-inline") {
        throw new Error(
          `${fileName} declares permissions in an inline form this check can't verify ("${permissions.value}"); use the block form instead`,
        );
      }

      // An empty block (from `permissions: {}`) grants no scopes at all,
      // which is strictly tighter than the read-only policy and also passes.
      const isNoScopes = permissions.lines.length === 0;
      const isReadOnly =
        permissions.lines.length === 1 &&
        permissions.lines[0] === EXPECTED_PERMISSIONS_LINE;
      expect(isNoScopes || isReadOnly).toBe(true);
    },
  );

  it.each(WORKFLOW_FILES)(
    "%s has no job-level permissions override granting write access",
    (fileName) => {
      const writeOverrideLine = findWriteScopeOverride(
        readWorkflowLines(fileName),
      );
      if (writeOverrideLine !== undefined) {
        throw new Error(
          `${fileName} declares a job-level permissions override ("${writeOverrideLine}") that grants write access, defeating the read-only top-level block`,
        );
      }
    },
  );
});

describe("parseTopLevelPermissions edge cases", () => {
  // These synthetic fixtures don't correspond to any file on disk — they
  // exist to exercise the parser's failure branches directly, so a
  // regression that makes it always report "block" (passing on a constant
  // return) is caught even while every real workflow file is compliant.
  it("reports missing when there is no permissions key", () => {
    const lines = [
      "name: Example",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
    ];
    expect(parseTopLevelPermissions(lines)).toEqual({ kind: "missing" });
  });

  it("reports unsupported-inline for an overly broad inline value", () => {
    const lines = ["name: Example", "permissions: write-all", "jobs:"];
    expect(parseTopLevelPermissions(lines)).toEqual({
      kind: "unsupported-inline",
      value: "write-all",
    });
  });

  it("treats an empty flow mapping as the tightest possible block", () => {
    const lines = ["name: Example", "permissions: {}", "jobs:"];
    expect(parseTopLevelPermissions(lines)).toEqual({
      kind: "block",
      lines: [],
    });
  });

  it("strips a trailing inline comment on the permissions entry", () => {
    const lines = [
      "name: Example",
      "permissions:",
      "  contents: read # least privilege",
      "jobs:",
    ];
    expect(parseTopLevelPermissions(lines)).toEqual({
      kind: "block",
      lines: [EXPECTED_PERMISSIONS_LINE],
    });
  });

  it("does not let a column-0 comment terminate or pollute the block", () => {
    const lines = [
      "name: Example",
      "permissions:",
      "  contents: read",
      "",
      "# Everything below runs on PRs and main",
      "jobs:",
    ];
    expect(parseTopLevelPermissions(lines)).toEqual({
      kind: "block",
      lines: [EXPECTED_PERMISSIONS_LINE],
    });
  });

  it("fails loud on a duplicated top-level permissions key", () => {
    const lines = [
      "permissions:",
      "  contents: read",
      "jobs:",
      "  build:",
      "    steps: []",
      "permissions: write-all",
    ];
    expect(parseTopLevelPermissions(lines)).toEqual({
      kind: "duplicate",
      count: 2,
    });
  });

  it("flags a job-level override that grants write access", () => {
    const lines = [
      "permissions:",
      "  contents: read",
      "jobs:",
      "  build:",
      "    permissions:",
      "      contents: write",
    ];
    expect(findWriteScopeOverride(lines)).toBe("permissions:");
  });

  it("allows a job-level override that only narrows further", () => {
    const lines = [
      "permissions:",
      "  contents: read",
      "jobs:",
      "  build:",
      "    permissions: {}",
    ];
    expect(findWriteScopeOverride(lines)).toBeUndefined();
  });
});
