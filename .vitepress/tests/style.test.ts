import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STYLE_CSS_PATH = resolve(process.cwd(), ".vitepress/theme/style.css");

const BRAND_BG = "#0a0a0b";
const BRAND_BG_TOKEN = "--color-bg";

function readStyleCss() {
  return readFileSync(STYLE_CSS_PATH, "utf8");
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
