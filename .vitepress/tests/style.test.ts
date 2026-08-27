import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STYLE_CSS_PATH = resolve(process.cwd(), ".vitepress/theme/style.css");
const GRIMICORN_PAGE_PATH = resolve(
  process.cwd(),
  ".vitepress/theme/components/GrimicornPage.vue",
);
const NOT_FOUND_PATH = resolve(
  process.cwd(),
  ".vitepress/theme/components/NotFound.vue",
);

const BRAND_BG = "#0a0a0b";
const BRAND_BG_TOKEN = "--color-bg";

const RAINBOW_TOKEN = "--gx-rainbow";
const RAINBOW_CTA_TOKEN = "--gx-rainbow-cta";
// The seamless-loop spectrum repeats the leading pink stop; the CTA fill omits
// it. Whitespace is stripped before matching so multi-line CSS formatting
// doesn't break the comparison.
const RAINBOW_LOOP_LITERAL =
  "linear-gradient(90deg,#ff2d9b,#fb923c,#facc15,#a3e635,#22d3ee,#a855f7,#ff2d9b)";
const RAINBOW_CTA_LITERAL =
  "linear-gradient(90deg,#ff2d9b,#fb923c,#facc15,#a3e635,#22d3ee,#a855f7)";

function readStyleCss() {
  return readFileSync(STYLE_CSS_PATH, "utf8");
}

function stripWhitespace(source: string) {
  return source.replace(/\s+/g, "");
}

function countOccurrences(haystack: string, needle: string) {
  return haystack.split(needle).length - 1;
}

describe("brand background token", () => {
  const css = readStyleCss();

  it("defines --color-bg in @theme as the brand background literal", () => {
    const themeBlock = css.match(/@theme\b[^{]*\{([\s\S]*?)\}/);
    expect(themeBlock, "@theme block not found").not.toBeNull();
    expect(themeBlock![1]).toMatch(
      new RegExp(`${BRAND_BG_TOKEN}:\\s*${BRAND_BG}\\s*;`, "i"),
    );
  });

  it("keeps the brand background literal in exactly one place", () => {
    const occurrences = css.match(new RegExp(BRAND_BG, "gi")) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("sets the html/body background from the token, not a second literal", () => {
    const htmlBodyBlock = css.match(
      /(?:^|\})\s*html\s*,\s*body\s*\{([^}]*background[^}]*)\}/m,
    );
    expect(htmlBodyBlock, "html/body rule not found").not.toBeNull();
    const block = htmlBodyBlock![1];
    expect(block).toMatch(
      new RegExp(`background:\\s*var\\(${BRAND_BG_TOKEN}\\)\\s*;`),
    );
    expect(block).not.toMatch(new RegExp(BRAND_BG, "i"));
  });
});

describe("brand rainbow gradient token", () => {
  const strippedCss = stripWhitespace(readStyleCss());
  const strippedGrimicornPage = stripWhitespace(
    readFileSync(GRIMICORN_PAGE_PATH, "utf8"),
  );
  const strippedNotFound = stripWhitespace(
    readFileSync(NOT_FOUND_PATH, "utf8"),
  );

  it("defines both rainbow tokens with their gradient literals in style.css", () => {
    expect(strippedCss).toContain(`${RAINBOW_TOKEN}:${RAINBOW_LOOP_LITERAL}`);
    expect(strippedCss).toContain(
      `${RAINBOW_CTA_TOKEN}:${RAINBOW_CTA_LITERAL}`,
    );
  });

  it("keeps each rainbow gradient literal in exactly one place in style.css", () => {
    expect(countOccurrences(strippedCss, RAINBOW_LOOP_LITERAL)).toBe(1);
    expect(countOccurrences(strippedCss, RAINBOW_CTA_LITERAL)).toBe(1);
  });

  it("references the tokens from .colorful-btn instead of a second literal", () => {
    const colorfulBtnBlock = strippedCss.match(/\.colorful-btn\{([^}]*)\}/);
    expect(colorfulBtnBlock, ".colorful-btn rule not found").not.toBeNull();
    const block = colorfulBtnBlock![1];
    expect(block).toContain(`background-image:var(${RAINBOW_TOKEN})`);
    expect(block).not.toContain(RAINBOW_LOOP_LITERAL);
  });

  it("paints the templates from the tokens with no inline gradient literal left", () => {
    [strippedGrimicornPage, strippedNotFound].forEach((template) => {
      expect(template).toContain(`var(${RAINBOW_TOKEN})`);
      expect(template).toContain(`var(${RAINBOW_CTA_TOKEN})`);
      expect(template).not.toContain(RAINBOW_LOOP_LITERAL);
      expect(template).not.toContain(RAINBOW_CTA_LITERAL);
    });
  });
});

// The skip link ships `sr-only` and is surfaced only by `.skip-link:focus`
// overriding that hiding. Without this guard the reveal rule can be deleted and
// every DOM/markup test still passes while the link stays invisible forever.
describe("skip link focus reveal", () => {
  const css = readStyleCss();

  // Each Tailwind `sr-only` property the reveal must undo to become visible on
  // focus; dropping any one leaves the link clipped.
  const SR_ONLY_OVERRIDES = [
    "position:fixed",
    "width:auto",
    "height:auto",
    "margin:0",
    "overflow:visible",
    "clip:auto",
    "white-space:normal",
  ];

  it("undoes every sr-only property on focus", () => {
    const rule = css.match(/(?:^|\})\s*\.skip-link:focus\s*\{([^}]*)\}/m);
    expect(rule, ".skip-link:focus rule not found").not.toBeNull();

    const declarations = stripWhitespace(rule![1]);
    SR_ONLY_OVERRIDES.forEach((declaration) => {
      expect(declarations).toContain(declaration);
    });
  });

  it("keeps the reveal rule outside any @layer so it outranks Tailwind's utilities layer", () => {
    // Scoped to the cascade before the rule: an @layer wrapping .skip-link:focus
    // would drop it below Tailwind's `sr-only` in the utilities layer. Unrelated
    // layers added later elsewhere must not fail this.
    const beforeRule = css.slice(0, css.indexOf(".skip-link:focus"));
    expect(
      countOccurrences(beforeRule, "@layer"),
      ".skip-link:focus sits inside an @layer",
    ).toBe(0);
  });

  it("suppresses the focus ring on the programmatically-focused landmark", () => {
    const rule = css.match(
      /(?:^|\})\s*main\[tabindex="-1"\]:focus\s*\{([^}]*)\}/m,
    );
    expect(rule, 'main[tabindex="-1"]:focus rule not found').not.toBeNull();
    expect(stripWhitespace(rule![1])).toContain("outline:none");
  });
});
