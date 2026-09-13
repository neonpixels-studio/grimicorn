import { expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ESLint } from "eslint";

// Shared harness for tests that lint a synthetic Vue snippet through the
// project's real eslint.config.js to guard specific rules staying wired to
// "error". Anchored to the repo root, not process.cwd(): both ESLint config
// discovery and the `files` glob matching resolve against `cwd`, so pinning
// it keeps callers honest regardless of where the runner is invoked from.
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

// ESLint's numeric severity for "error"; the point of these rules is to block
// CI, so callers assert this rather than merely that a rule reported.
export const ERROR_SEVERITY = 2;

// errorOnUnmatchedPattern is off so a caller using `lintFiles` on a glob (e.g.
// asserting the ruleset resolves against real theme components) reports its
// own assertion if the components ever move, instead of dying inside ESLint
// with a NoFilesFoundError. It has no effect on `lintText` callers.
export const eslint = new ESLint({
  cwd: REPO_ROOT,
  errorOnUnmatchedPattern: false,
});

/**
 * Builds a `lintVue` function bound to a probe path under
 * `.vitepress/theme/components/`. A path under the theme dir is required so
 * the config's Vue overrides (and any `files`-scoped rule sets) apply.
 */
export function createVueLinter(probeFileName: string) {
  const probeFilePath = path.join(
    REPO_ROOT,
    ".vitepress/theme/components",
    probeFileName,
  );

  return async function lintVue(source: string) {
    const results = await eslint.lintText(source, { filePath: probeFilePath });
    const messages = results.flatMap((result) => result.messages);
    const fatalMessage = messages.find((message) => message.fatal);
    if (fatalMessage) {
      throw new Error(`Probe source failed to parse: ${fatalMessage.message}`);
    }
    // lintText warns rather than errors when the probe path matches an
    // `ignores` pattern, so a negative assertion (expecting no error) would
    // pass vacuously if the probe path were ever ignored. Fail loud instead.
    const ignoredMessage = messages.find(
      (message) =>
        message.ruleId === null && message.message.includes("File ignored"),
    );
    if (ignoredMessage) {
      throw new Error(
        `Probe path is being ignored by ESLint: ${probeFilePath}`,
      );
    }
    return messages;
  };
}

export function expectRuleError(
  messages: Awaited<ReturnType<ReturnType<typeof createVueLinter>>>,
  ruleId: string,
) {
  const match = messages.find((message) => message.ruleId === ruleId);
  expect(match, `expected an error from ${ruleId}`).toBeDefined();
  expect(match?.severity).toBe(ERROR_SEVERITY);
}
