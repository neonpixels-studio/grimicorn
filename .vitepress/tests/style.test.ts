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

// Checks a static `class="..."` attribute for an exact class token. A plain
// substring match on the tag (e.g. `tag.includes('class="colorful-btn')`)
// would false-positive on a hyphenated class like `colorful-btn-sm`, or on a
// Vue binding like `:class="{ 'colorful-btn': isVisible }"` that never
// renders the class unconditionally.
function hasStaticClass(tag: string, className: string) {
  const classAttribute = tag.match(/\sclass="([^"]*)"/);
  return classAttribute?.[1].split(/\s+/).includes(className) ?? false;
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
  // focus; dropping any one leaves the link clipped. Mirrors Tailwind's `sr-only`
  // definition (including `clip-path`, which newer variants use instead of the
  // legacy `clip`), so re-check this list on Tailwind major upgrades.
  const SR_ONLY_OVERRIDES = [
    "position:fixed",
    "width:auto",
    "height:auto",
    "margin:0",
    "overflow:visible",
    "clip:auto",
    "clip-path:none",
    "white-space:normal",
  ];

  it("undoes every sr-only property that affects visibility on focus", () => {
    const rule = css.match(/(?:^|\})\s*\.skip-link:focus\s*\{([^}]*)\}/m);
    expect(rule, ".skip-link:focus rule not found").not.toBeNull();

    const declarations = stripWhitespace(rule![1]);
    SR_ONLY_OVERRIDES.forEach((declaration) => {
      expect(declarations).toContain(declaration);
    });
  });

  it("keeps the reveal rule outside any @layer so it outranks Tailwind's utilities layer", () => {
    // An @layer wrapping .skip-link:focus would drop it below Tailwind's
    // `sr-only` in the utilities layer. Anchor on the real rule (same regex the
    // sibling test uses, so a mention in a comment can't move the offset) and
    // strip comments before counting braces, so their braces can't skew the
    // depth. Enclosure via brace depth is immune to closed sibling @layer blocks.
    const anchor = css.match(/(?:^|\})\s*\.skip-link:focus\s*\{/m);
    expect(anchor, ".skip-link:focus rule not found").not.toBeNull();
    // Land on the selector itself, not the matched prefix: the `\}` branch would
    // otherwise put the offset before a closing brace and undercount depth by one.
    const ruleStart = anchor!.index! + anchor![0].indexOf(".skip-link");
    const beforeRule = css.slice(0, ruleStart).replace(/\/\*[\s\S]*?\*\//g, "");
    const openBraceDepth =
      countOccurrences(beforeRule, "{") - countOccurrences(beforeRule, "}");
    expect(
      openBraceDepth,
      ".skip-link:focus sits inside a nested at-rule",
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

// .colorful-btn:hover sets its own independent `animation-name: gx-rainbow-pan`
// (infinite) rather than relying on the `.animate-rainbow-pan` class the
// reduced-motion block already silences, so hovering it kept spinning the
// rainbow forever for prefers-reduced-motion visitors until reset here too.
//
// The reset selector (`.colorful-btn:hover`) carries the exact same
// specificity as the base hover rule it's meant to override, so wrapping it
// in `@media` alone isn't enough — with equal specificity the cascade falls
// back to source order, and a guard declared *before* the base rule would
// still lose to it. This test checks placement, not just presence, so a
// guard that exists but is ordered before the base rule (and therefore
// silently loses the cascade in a real browser) fails here too.
describe("reduced motion guards", () => {
  // Stripped once, like the sibling enclosure checks above (skip-link focus,
  // colorful-btn focus-visible): this stylesheet's own comments quote
  // selectors and at-rules verbatim, so counting braces or searching for a
  // literal against the raw source risks landing inside a comment instead of
  // real CSS.
  const cssWithoutComments = readStyleCss().replace(/\/\*[\s\S]*?\*\//g, "");

  // Anchored on the preceding `{`, `}`, `,` (a grouped selector list), or
  // start of file, so a future compound selector ending in
  // `.colorful-btn:hover` (e.g. some `.foo .colorful-btn:hover` override)
  // can't be mistaken for one of these two top-level rules. No `m` flag: with
  // it, `^` matches at every line start, which would treat an indented
  // continuation line as "start of file" and defeat the anchor (see the
  // `.colorful-btn:focus-visible` enclosure test below for the same hazard).
  const HOVER_RULE_PATTERN =
    /(?:^|\}|\{|,)\s*\.colorful-btn:hover\s*\{([^}]*)\}/g;

  // The anchor alternation `(?:^|\}|\{)` can consume a real preceding brace
  // (e.g. the @media block's own opening `{` when the rule is the block's
  // first declaration) as part of the match. Land on the selector itself, not
  // that consumed prefix, so index-based ordering/depth math below isn't off
  // by one — mirrors the `.colorful-btn:focus-visible` enclosure check above.
  function selectorStart(match: RegExpMatchArray) {
    return match.index! + match[0].indexOf(".colorful-btn:hover");
  }

  it("orders the colorful-btn hover reduced-motion guard after the base hover rule so it wins the cascade", () => {
    const hoverRuleMatches = [
      ...cssWithoutComments.matchAll(HOVER_RULE_PATTERN),
    ];

    // Select each rule by what it declares, not by array position — matchAll
    // already returns matches in source order, so destructuring by index
    // would make the ordering assertion below true by construction and
    // unable to ever fail.
    const baseHoverRule = hoverRuleMatches.find((rule) =>
      stripWhitespace(rule[1]).includes("animation-name:gx-rainbow-pan"),
    );
    const guardRule = hoverRuleMatches.find((rule) =>
      stripWhitespace(rule[1]).includes("animation:none"),
    );
    expect(
      baseHoverRule,
      "base .colorful-btn:hover rainbow-pan rule not found",
    ).toBeDefined();
    expect(
      guardRule,
      ".colorful-btn:hover reduced-motion reset (animation: none) not found",
    ).toBeDefined();

    const baseHoverStart = selectorStart(baseHoverRule!);
    const guardStart = selectorStart(guardRule!);

    expect(
      guardStart,
      "the reduced-motion guard must be declared after the base .colorful-btn:hover rule — equal specificity means an earlier guard loses the cascade regardless of the @media wrapper",
    ).toBeGreaterThan(baseHoverStart);

    // Whitespace-insensitive, unlike a literal lastIndexOf on the exact
    // source string, so a formatter change to the query's internal spacing
    // (e.g. `prefers-reduced-motion:reduce`) can't fail this for a reason
    // unrelated to the cascade bug it guards.
    const beforeGuard = cssWithoutComments.slice(0, guardStart);
    const mediaQueryMatches = [
      ...beforeGuard.matchAll(
        /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/g,
      ),
    ];
    const lastMediaQueryMatch = mediaQueryMatches.at(-1);
    expect(
      lastMediaQueryMatch,
      "guard rule is not preceded by a prefers-reduced-motion media query",
    ).toBeDefined();
    const mediaQueryStart = lastMediaQueryMatch!.index!;

    const betweenMediaAndGuard = cssWithoutComments.slice(
      mediaQueryStart,
      guardStart,
    );
    const openBraceDepth =
      countOccurrences(betweenMediaAndGuard, "{") -
      countOccurrences(betweenMediaAndGuard, "}");
    expect(
      openBraceDepth,
      "guard rule must still be inside an open prefers-reduced-motion block, not after it closed",
    ).toBe(1);
  });
});

// .colorful-btn resets the UA button outline (border:none, padding:0), so
// without an explicit rule every colorful button — including the footer's
// bare rave toggle, which carries no other class — shows no keyboard focus
// indicator (WCAG 2.4.7). Guards the shared rule so it can't regress back to
// only covering .pause-toggle.
describe("colorful button focus ring", () => {
  const css = readStyleCss();

  it("restores a visible focus-visible outline shared by every .colorful-btn", () => {
    const rule = css.match(
      /(?:^|\})\s*\.colorful-btn:focus-visible\s*\{([^}]*)\}/m,
    );
    expect(rule, ".colorful-btn:focus-visible rule not found").not.toBeNull();

    const declarations = stripWhitespace(rule![1]);
    expect(declarations).toContain("outline:2pxsolidvar(--color-fg-muted)");
    expect(declarations).toContain("outline-offset:2px");
  });

  // Same enclosure hazard the `.skip-link:focus` test above guards against:
  // the `m`-flag regex treats any indented line start as a match anchor, so
  // wrapping the rule in `@media` or `@layer` would still satisfy the
  // rule-exists check above while the focus ring silently stops applying.
  it("keeps the .colorful-btn:focus-visible rule outside any nested at-rule", () => {
    const anchor = css.match(/(?:^|\})\s*\.colorful-btn:focus-visible\s*\{/m);
    expect(anchor, ".colorful-btn:focus-visible rule not found").not.toBeNull();
    const ruleStart = anchor!.index! + anchor![0].indexOf(".colorful-btn");
    const beforeRule = css.slice(0, ruleStart).replace(/\/\*[\s\S]*?\*\//g, "");
    const openBraceDepth =
      countOccurrences(beforeRule, "{") - countOccurrences(beforeRule, "}");
    expect(
      openBraceDepth,
      ".colorful-btn:focus-visible sits inside a nested at-rule",
    ).toBe(0);
  });

  // The CSS rule alone doesn't guard against the actual reported bug: the
  // footer rave toggle regains no focus ring if it stops carrying
  // `colorful-btn` (e.g. renamed to a class the shared rule no longer
  // matches). Anchor on the toggle's unique `toggleRave` click handler
  // (GrimicornPage.vue) rather than a bare class match, so this can't be
  // fooled by some other button in the file that happens to open with
  // `class="colorful-btn"`, and can't false-fail on an unrelated class or
  // attribute reorder. The handler match tolerates `@click`/`v-on:click` and
  // a call-with-parens so a harmless template refactor doesn't trip it.
  it("keeps the footer rave toggle on the shared .colorful-btn class", () => {
    const raveToggleTag = readFileSync(GRIMICORN_PAGE_PATH, "utf8").match(
      /<button\b[^>]*(?:@|v-on:)click="[^"]*\btoggleRave\b[^"]*"[^>]*>/,
    );
    expect(raveToggleTag, "footer rave toggle button not found").not.toBeNull();
    expect(hasStaticClass(raveToggleTag![0], "colorful-btn")).toBe(true);
  });

  // Mirrors the rave-toggle guard above for the other .colorful-btn consumer:
  // this diff replaced .pause-toggle's own dedicated focus-visible rule with
  // the shared one, so the pause control's WCAG 2.4.7 coverage now depends
  // entirely on it keeping the `colorful-btn` class alongside `pause-toggle`.
  it("keeps the pause toggle on the shared .colorful-btn class", () => {
    const pauseToggleTag = readFileSync(GRIMICORN_PAGE_PATH, "utf8").match(
      /<button\b[^>]*(?:@|v-on:)click="[^"]*\btoggleContentPaused\b[^"]*"[^>]*>/,
    );
    expect(pauseToggleTag, "pause toggle button not found").not.toBeNull();
    expect(hasStaticClass(pauseToggleTag![0], "colorful-btn")).toBe(true);
  });
});
