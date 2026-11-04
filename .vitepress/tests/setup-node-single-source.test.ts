import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Node setup lives in one place, the shared composite action, so the Node
// toolchain and the actions/setup-node pin cannot drift between CI jobs and
// the security scan. A workflow job that inlines actions/setup-node instead of
// using the composite action fails here.
const ROOT = process.cwd();
const WORKFLOWS_DIR = resolve(ROOT, ".github/workflows");
const COMPOSITE_ACTION_PATH = resolve(
  ROOT,
  ".github/actions/setup-node-project/action.yml",
);
const YAML_FILE_PATTERN = /\.ya?ml$/;
const SETUP_NODE_PATTERN = /uses:\s*["']?actions\/setup-node@([^\s"']+)/gi;

function setupNodePins(source: string) {
  return [...source.matchAll(SETUP_NODE_PATTERN)].map((match) => match[1]);
}

const ACTIONS_DIR = resolve(ROOT, ".github/actions");
const SHARED_ACTION_NAME = "setup-node-project";

const WORKFLOWS = readdirSync(WORKFLOWS_DIR)
  .filter((file) => YAML_FILE_PATTERN.test(file))
  .map((file) => [file, resolve(WORKFLOWS_DIR, file)] as const);

const OTHER_COMPOSITE_ACTIONS = readdirSync(ACTIONS_DIR, {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory() && entry.name !== SHARED_ACTION_NAME)
  .map(
    (entry) =>
      [entry.name, resolve(ACTIONS_DIR, entry.name, "action.yml")] as const,
  );

describe("Node setup single source", () => {
  it("finds workflows to verify", () => {
    expect(WORKFLOWS.length).toBeGreaterThan(0);
  });

  it("the composite action pins actions/setup-node exactly once", () => {
    const pins = setupNodePins(readFileSync(COMPOSITE_ACTION_PATH, "utf8"));
    expect(pins).toHaveLength(1);
  });

  it.each(WORKFLOWS)(
    "%s does not inline actions/setup-node",
    (_file, filePath) => {
      const pins = setupNodePins(readFileSync(filePath, "utf8"));
      expect(pins).toEqual([]);
    },
  );

  it("matches quoted uses values", () => {
    expect(setupNodePins('uses: "actions/setup-node@abc123"')).toEqual([
      "abc123",
    ]);
  });

  it.each(OTHER_COMPOSITE_ACTIONS)(
    "composite action %s does not inline actions/setup-node",
    (_name, filePath) => {
      expect(setupNodePins(readFileSync(filePath, "utf8"))).toEqual([]);
    },
  );

  it("security.yml uses the shared composite action", () => {
    const source = readFileSync(resolve(WORKFLOWS_DIR, "security.yml"), "utf8");
    expect(source).toContain("uses: ./.github/actions/setup-node-project");
  });
});
