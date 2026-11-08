import { afterEach, describe, it, expect, vi } from "vitest";

import {
  OPT_OUT_CHECK_EXPRESSION,
  hasPrivacyOptOut,
  type BrowserGlobals,
} from "../privacy-opt-out";

const OPTED_OUT_CASES: Array<[string, BrowserGlobals]> = [
  ["Global Privacy Control", { navigator: { globalPrivacyControl: true } }],
  ["navigator.doNotTrack", { navigator: { doNotTrack: "1" } }],
  ["window.doNotTrack", { window: { doNotTrack: "1" } }],
  ["navigator.msDoNotTrack", { navigator: { msDoNotTrack: "1" } }],
];

const NOT_OPTED_OUT_CASES: Array<[string, BrowserGlobals]> = [
  ["no signals", { navigator: {}, window: {} }],
  [
    "GPC false and DNT 0",
    { navigator: { globalPrivacyControl: false, doNotTrack: "0" }, window: {} },
  ],
  ["DNT unspecified", { navigator: { doNotTrack: "unspecified" }, window: {} }],
];

// Evaluates the inline-script expression the GA bootstrap embeds.
function evaluateExpression({ navigator = {}, window = {} }: BrowserGlobals) {
  return new Function(
    "navigator",
    "window",
    `return ${OPT_OUT_CHECK_EXPRESSION};`,
  )(navigator, window) as boolean;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hasPrivacyOptOut", () => {
  it.each(OPTED_OUT_CASES)("is true when %s is set", (_label, globals) => {
    expect(hasPrivacyOptOut(globals)).toBe(true);
  });

  it.each(NOT_OPTED_OUT_CASES)("is false with %s", (_label, globals) => {
    expect(hasPrivacyOptOut(globals)).toBe(false);
  });

  it("does not throw when window is absent", () => {
    expect(hasPrivacyOptOut({ navigator: {} })).toBe(false);
  });

  it("reads the real browser globals by default", () => {
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    expect(hasPrivacyOptOut()).toBe(true);
  });
});

describe("OPT_OUT_CHECK_EXPRESSION", () => {
  it.each([...OPTED_OUT_CASES, ...NOT_OPTED_OUT_CASES])(
    "agrees with hasPrivacyOptOut for %s",
    (_label, globals) => {
      expect(evaluateExpression(globals)).toBe(hasPrivacyOptOut(globals));
    },
  );
});
