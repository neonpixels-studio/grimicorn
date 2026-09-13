import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ESLint } from "eslint";

// Guards against `vue/no-v-html` ever being silently turned back off. v-html
// bypasses Vue's escaping and is a standing XSS footgun, so this rule staying
// wired to "error" matters even though nothing in the codebase uses v-html
// today — the whole point is to catch the first future usage before it lands.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// Anchored to the repo root (not process.cwd()) for the same reason as the
// a11y probe: ESLint config discovery and `files` glob matching resolve
// against `cwd`, so a cwd-relative path could silently lint against no config.
const PROBE_FILE_PATH = path.join(
  REPO_ROOT,
  ".vitepress/theme/components/_no-v-html-probe.vue",
);
const RULE_ID = "vue/no-v-html";
// ESLint's numeric severity for "error"; the point of this rule is to block
// CI, so the test asserts this rather than merely that the rule reported.
const ERROR_SEVERITY = 2;

const eslint = new ESLint({ cwd: REPO_ROOT, errorOnUnmatchedPattern: false });

async function lintVue(source: string) {
  const results = await eslint.lintText(source, { filePath: PROBE_FILE_PATH });
  const messages = results.flatMap((result) => result.messages);
  const fatalMessage = messages.find((message) => message.fatal);
  if (fatalMessage) {
    throw new Error(`Probe source failed to parse: ${fatalMessage.message}`);
  }
  return messages;
}

describe("eslint vue/no-v-html rule", () => {
  it("flags v-html usage as an error", async () => {
    const messages = await lintVue(
      `<template>\n  <div v-html="rawHtml"></div>\n</template>\n`,
    );
    const match = messages.find((message) => message.ruleId === RULE_ID);
    expect(match, `expected an error from ${RULE_ID}`).toBeDefined();
    expect(match?.severity).toBe(ERROR_SEVERITY);
  });

  it("raises no v-html error on markup that avoids it", async () => {
    const messages = await lintVue(
      `<template>\n  <div>{{ safeText }}</div>\n</template>\n`,
    );
    const match = messages.find((message) => message.ruleId === RULE_ID);
    expect(match).toBeUndefined();
  });
});
