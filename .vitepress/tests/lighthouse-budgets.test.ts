import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../../lighthouserc.cjs");
const assertions = config.ci.assert.assertions;

const REQUIRED_SIZE_BUDGETS = [
  "resource-summary:total:size",
  "resource-summary:font:size",
  "resource-summary:image:size",
];

// Derived from the config so a newly added size budget can't ship as warn.
const SIZE_BUDGETS = Object.keys(assertions).filter(
  (name) => name.startsWith("resource-summary:") && name.endsWith(":size"),
);

describe("lighthouserc.cjs size budgets", () => {
  it("includes the total, font, and image budgets", () => {
    expect(SIZE_BUDGETS).toEqual(expect.arrayContaining(REQUIRED_SIZE_BUDGETS));
  });

  it.each(SIZE_BUDGETS)(
    "%s fails the job (error level) with a numeric cap",
    (name) => {
      const [level, options] = assertions[name];

      expect(level).toBe("error");
      expect(options.maxNumericValue).toBeGreaterThan(0);
    },
  );
});
