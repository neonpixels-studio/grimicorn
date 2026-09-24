import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Every third-party GitHub Action must be pinned to a full 40-character commit
// SHA (not a mutable tag like `@v7`), so a compromised or force-moved tag can't
// silently change what runs in CI. A trailing `# vX.Y.Z` comment records the
// human-readable version and lets Dependabot bump the pin. The file list is
// derived from disk (not hardcoded) so a new workflow or composite action is
// held to the same contract the moment it's added.
// See .github/workflows/*.yml and .github/actions/*/action.yml.
const ROOT = process.cwd();
const YAML_FILE_PATTERN = /\.ya?ml$/;

// A local action reference (`./.github/actions/...`) is code in this repo, not a
// third-party dependency, so it needs no SHA pin.
const LOCAL_ACTION_PREFIX = "./";
// A `uses:` value pinned as `<owner>/<repo>[/<path>]@<40-hex-sha>`.
const SHA_PINNED_PATTERN = /@[0-9a-f]{40}(\s|$)/;
// Captures the `uses:` value regardless of leading `-`/indentation.
const USES_LINE_PATTERN = /^\s*-?\s*uses:\s*(\S+)/;

function workflowFiles() {
  const dir = resolve(ROOT, ".github/workflows");
  return readdirSync(dir)
    .filter((file) => YAML_FILE_PATTERN.test(file))
    .map((file) => resolve(dir, file));
}

function compositeActionFiles() {
  const dir = resolve(ROOT, ".github/actions");
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(dir, entry.name, "action.yml"));
}

function usesReferences(filePath: string) {
  const source = readFileSync(filePath, "utf8");
  return source
    .split("\n")
    .map((line) => line.match(USES_LINE_PATTERN)?.[1])
    .filter((value): value is string => value !== undefined);
}

function thirdPartyReferences(filePath: string) {
  return usesReferences(filePath).filter(
    (reference) => !reference.startsWith(LOCAL_ACTION_PREFIX),
  );
}

const PINNING_TARGETS = [...workflowFiles(), ...compositeActionFiles()].map(
  (filePath) => [relativeToRoot(filePath), filePath] as const,
);

function relativeToRoot(filePath: string) {
  return filePath.startsWith(ROOT) ? filePath.slice(ROOT.length + 1) : filePath;
}

describe("Workflow action pinning", () => {
  it("finds action files to verify", () => {
    expect(PINNING_TARGETS.length).toBeGreaterThan(0);
  });

  it("finds at least one third-party action to verify", () => {
    const total = PINNING_TARGETS.reduce(
      (count, [, filePath]) => count + thirdPartyReferences(filePath).length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  it.each(PINNING_TARGETS)(
    "%s pins every third-party action to a commit SHA",
    (_label, filePath) => {
      const unpinned = thirdPartyReferences(filePath).filter(
        (reference) => !SHA_PINNED_PATTERN.test(reference),
      );
      if (unpinned.length > 0) {
        throw new Error(
          `${relativeToRoot(filePath)} references third-party actions that are not SHA-pinned: ${unpinned.join(", ")}`,
        );
      }
    },
  );
});
