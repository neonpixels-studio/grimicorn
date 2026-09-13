import { describe, it, expect } from "vitest";
import { createVueLinter, expectRuleError } from "./helpers/eslint-probe";

// Guards against `vue/no-v-html` ever being silently turned back off. v-html
// bypasses Vue's escaping and is a standing XSS footgun, so this rule staying
// wired to "error" matters even though nothing in the codebase uses v-html
// today — the whole point is to catch the first future usage before it lands.
const RULE_ID = "vue/no-v-html";
const lintVue = createVueLinter("_no-v-html-probe.vue");

describe("eslint vue/no-v-html rule", () => {
  it("flags v-html usage as an error", async () => {
    const messages = await lintVue(
      `<template>\n  <div v-html="rawHtml"></div>\n</template>\n`,
    );
    expectRuleError(messages, RULE_ID);
  });

  it("raises no v-html error on markup that avoids it", async () => {
    const messages = await lintVue(
      `<template>\n  <div>{{ safeText }}</div>\n</template>\n`,
    );
    const match = messages.find((message) => message.ruleId === RULE_ID);
    expect(match).toBeUndefined();
  });
});
