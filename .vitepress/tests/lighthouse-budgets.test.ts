import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../../lighthouserc.cjs");

const HOME_URL = "http://127.0.0.1:4319/";
const NOT_FOUND_URL = "http://127.0.0.1:4319/404.html";
const CATEGORY_MIN_SCORE = 0.9;
const NOT_FOUND_SEO_AUDITS = [
  "document-title",
  "meta-description",
  "viewport",
  "link-text",
  "crawlable-anchors",
  "hreflang",
];

type Assertion = [string, { minScore?: number; maxNumericValue?: number }];
type Assertions = Record<string, Assertion>;
type MatrixEntry = { matchingUrlPattern: string; assertions: Assertions };

const matrix: MatrixEntry[] = config.ci.assert.assertMatrix;

function assertionsFor(url: string): Assertions {
  const matching = matrix.filter((entry) =>
    new RegExp(entry.matchingUrlPattern).test(url),
  );
  return Object.assign({}, ...matching.map((entry) => entry.assertions));
}

const homeAssertions = assertionsFor(HOME_URL);
const notFoundAssertions = assertionsFor(NOT_FOUND_URL);

const REQUIRED_SIZE_BUDGETS = [
  "resource-summary:total:size",
  "resource-summary:font:size",
  "resource-summary:image:size",
];

// Derived from the config so a newly added size budget can't ship as warn.
const SIZE_BUDGETS = Object.keys(homeAssertions).filter(
  (name) => name.startsWith("resource-summary:") && name.endsWith(":size"),
);

describe("lighthouserc.cjs size budgets", () => {
  it("includes the total, font, and image budgets", () => {
    expect(SIZE_BUDGETS).toEqual(expect.arrayContaining(REQUIRED_SIZE_BUDGETS));
  });

  it.each(SIZE_BUDGETS)(
    "%s fails the job (error level) with a numeric cap",
    (name) => {
      const [level, options] = homeAssertions[name];

      expect(level).toBe("error");
      expect(options.maxNumericValue).toBeGreaterThan(0);
    },
  );
});

describe("lighthouserc.cjs URL coverage", () => {
  it("collects both the homepage and the built 404 page", () => {
    expect(config.ci.collect.url).toEqual([HOME_URL, NOT_FOUND_URL]);
  });

  it("matches each collected URL with exactly one assertMatrix entry", () => {
    for (const url of config.ci.collect.url) {
      const matches = matrix.filter((entry) =>
        new RegExp(entry.matchingUrlPattern).test(url),
      );

      expect(matches, url).toHaveLength(1);
    }
  });

  it("does not match an unknown route, so the 404 is audited as a file", () => {
    const unknownRoute = "http://127.0.0.1:4319/does-not-exist";

    expect(assertionsFor(unknownRoute)).toEqual({});
  });
});

describe("lighthouserc.cjs homepage gates", () => {
  it.each([
    "categories:performance",
    "categories:accessibility",
    "categories:seo",
    "categories:best-practices",
  ])("%s stays an error at 0.9 or higher", (name) => {
    const [level, options] = homeAssertions[name];

    expect(level).toBe("error");
    expect(options.minScore).toBeGreaterThanOrEqual(CATEGORY_MIN_SCORE);
  });

  it.each(["largest-contentful-paint", "uses-text-compression"])(
    "%s stays an error",
    (name) => {
      expect(homeAssertions[name][0]).toBe("error");
    },
  );
});

describe("lighthouserc.cjs 404 gates", () => {
  it.each(["categories:accessibility", "categories:best-practices"])(
    "%s matches the homepage gate",
    (name) => {
      expect(notFoundAssertions[name]).toEqual(homeAssertions[name]);
    },
  );

  it("leaves the noindex-driven SEO category and is-crawlable out", () => {
    expect(notFoundAssertions["categories:seo"]).toBeUndefined();
    expect(notFoundAssertions["is-crawlable"]).toBeUndefined();
  });

  it.each(NOT_FOUND_SEO_AUDITS)("%s must fully pass on the 404", (name) => {
    expect(notFoundAssertions[name]).toEqual(["error", { minScore: 1 }]);
  });

  it("does not apply homepage-only performance and size budgets", () => {
    const homepageOnly = Object.keys(notFoundAssertions).filter(
      (name) =>
        name.startsWith("resource-summary:") ||
        name === "categories:performance" ||
        name === "largest-contentful-paint" ||
        name === "uses-text-compression",
    );

    expect(homepageOnly).toEqual([]);
  });

  it("makes every 404 assertion an error", () => {
    const levels = Object.values(notFoundAssertions).map(([level]) => level);

    expect(new Set(levels)).toEqual(new Set(["error"]));
  });
});
