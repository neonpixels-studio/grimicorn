import { describe, it, expect } from "vitest";
import {
  eslint,
  createVueLinter,
  expectRuleError,
} from "./helpers/eslint-probe";

// Lints Vue snippets through the project's real eslint.config.js. These tests
// fail if the vuejs-accessibility ruleset is ever unwired from the config,
// which is the whole point: they guard the a11y guardrail itself, not just the
// current markup.
const COMPONENTS_GLOB = ".vitepress/theme/**/*.vue";
const A11Y_RULE_PREFIX = "vuejs-accessibility/";
const lintVue = createVueLinter("_a11y-probe.vue");

describe("eslint accessibility ruleset", () => {
  it("flags an image without an alt attribute", async () => {
    const messages = await lintVue(
      `<template>\n  <img src="/x.png" />\n</template>\n`,
    );
    expectRuleError(messages, "vuejs-accessibility/alt-text");
  });

  it("flags a click handler on a non-interactive element with no keyboard listener", async () => {
    const messages = await lintVue(
      `<template>\n  <div @click="handle">go</div>\n</template>\n`,
    );
    expectRuleError(
      messages,
      "vuejs-accessibility/click-events-have-key-events",
    );
  });

  it("raises no accessibility errors on clean, semantic markup", async () => {
    const messages = await lintVue(
      `<template>\n  <img src="/x.png" alt="a descriptive label" />\n  <button type="button">go</button>\n</template>\n`,
    );
    const accessibilityRuleIds = messages
      .map((message) => message.ruleId)
      .filter((ruleId) => ruleId?.startsWith(A11Y_RULE_PREFIX));
    expect(accessibilityRuleIds).toEqual([]);
  });

  it("resolves the ruleset against the real theme components, not just a synthetic path", async () => {
    const results = await eslint.lintFiles(COMPONENTS_GLOB);
    // A hit here proves the config's `files` globs actually cover the real
    // component directory: a probe-only path could keep passing even if the
    // glob were narrowed to exclude where components truly live.
    expect(results.length).toBeGreaterThan(0);
  });
});
