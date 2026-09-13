import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  eslint,
  REPO_ROOT,
  ERROR_SEVERITY,
  createVueLinter,
  expectRuleError,
} from "./helpers/eslint-probe";

// Guards against `vue/no-v-html` ever being silently turned back off. v-html
// bypasses Vue's escaping and is a standing XSS footgun, so this rule staying
// wired to "error" matters even though nothing in the codebase uses v-html
// today — the whole point is to catch the first future usage before it lands.
const RULE_ID = "vue/no-v-html";
const PROBE_FILE_PATH = path.join(
  REPO_ROOT,
  ".vitepress/theme/components/_no-v-html-probe.vue",
);
const lintVue = createVueLinter("_no-v-html-probe.vue");

describe("eslint vue/no-v-html rule", () => {
  it("flags v-html usage as an error", async () => {
    const messages = await lintVue(
      `<template>\n  <div v-html="rawHtml"></div>\n</template>\n`,
    );
    expectRuleError(messages, RULE_ID);
  });

  it("keeps the rule wired at error severity in the resolved config", async () => {
    // Distinct from the assertion above: a "warn" or "off" level would still
    // let a clean-markup snippet raise zero messages for the rule, so a
    // behavioral "no error on clean markup" test can't tell those apart.
    // Reading the resolved config directly is the only way to pin the level.
    const config = await eslint.calculateConfigForFile(PROBE_FILE_PATH);
    expect(config.rules?.[RULE_ID]?.[0]).toBe(ERROR_SEVERITY);
  });
});
