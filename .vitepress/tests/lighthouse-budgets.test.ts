import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../../lighthouserc.cjs");
const assertions = config.ci.assert.assertions;

const SIZE_BUDGETS = [
  "resource-summary:total:size",
  "resource-summary:font:size",
  "resource-summary:image:size",
];

describe("lighthouserc.cjs size budgets", () => {
  it.each(SIZE_BUDGETS)(
    "%s fails the job (error level) with a numeric cap",
    (name) => {
      const [level, options] = assertions[name];

      expect(level).toBe("error");
      expect(options.maxNumericValue).toBeGreaterThan(0);
    },
  );
});
