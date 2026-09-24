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

// The stylesheet's own comments quote selectors and declarations verbatim, so
// matching or counting braces against the raw source risks landing inside a
// comment instead of real CSS.
function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
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
    const beforeRule = stripComments(css.slice(0, ruleStart));
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
  // colorful-btn focus-visible): comments can otherwise be mistaken for real
  // CSS (see stripComments).
  const cssWithoutComments = stripComments(readStyleCss());

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

// `.pause-toggle[aria-pressed="true"]` and `.colorful-btn:hover` carry the
// exact same specificity (one class + one attribute/pseudo-class each), and
// the pressed rule is declared later in the file. With equal specificity the
// cascade falls back to source order, so once pressed, the later pressed
// rule always won — including while hovering — and the rainbow hover fill
// could never come back for a paused stream. The fix scopes the pressed rule
// to `:not(:hover)`, which both raises its specificity past the hover rule
// (so it still wins the non-hover pressed look) and makes the two rules
// mutually exclusive (so hovering removes the pressed rule from
// contention entirely, rather than needing to out-rank it).
describe("pause toggle pressed+hover cascade", () => {
  const css = stripComments(readStyleCss());

  // Same anchor alternation as the other top-level-rule checks above
  // (reduced motion guards, colorful button resting contrast): a selector
  // ending in this attribute selector could in principle appear nested
  // inside some other compound selector, so anchor on a preceding
  // `{`, `}`, `,`, or start of file rather than matching anywhere.
  const PRESSED_RULE_PATTERN =
    /(?:^|\}|\{|,)\s*(\.pause-toggle\[aria-pressed="true"\][^{]*)\{([^}]*)\}/;

  // A minimal CSS specificity scorer covering exactly the selector shapes
  // this stylesheet uses (classes, attribute selectors, pseudo-classes; no
  // IDs or type selectors on these rules). `:not(...)` contributes its
  // argument's specificity rather than being specificity-free, so its
  // wrapper is unwrapped before counting rather than stripped outright —
  // stripping it entirely would under-count `:not(:hover)` as zero instead
  // of the one pseudo-class it actually costs.
  function classAttributePseudoSpecificity(selector: string) {
    const unwrapped = selector.replace(/:not\(([^)]*)\)/g, "$1");
    const classCount = unwrapped.match(/\.[a-zA-Z0-9_-]+/g)?.length ?? 0;
    const attributeCount = unwrapped.match(/\[[^\]]*\]/g)?.length ?? 0;
    const pseudoClassCount = unwrapped.match(/:[a-zA-Z-]+/g)?.length ?? 0;
    return classCount + attributeCount + pseudoClassCount;
  }

  it("scopes the pressed pause-toggle rule to :not(:hover), not a bare aria-pressed selector", () => {
    const pressedRule = css.match(PRESSED_RULE_PATTERN);
    expect(
      pressedRule,
      '.pause-toggle[aria-pressed="true"] rule not found',
    ).not.toBeNull();

    const selector = pressedRule![1].trim();
    expect(
      selector,
      "pressed rule must exclude :hover so it can't win the cascade over .colorful-btn:hover while hovering",
    ).toBe('.pause-toggle[aria-pressed="true"]:not(:hover)');

    // The non-hover pressed appearance itself must be unchanged.
    const declarations = stripWhitespace(pressedRule![2]);
    expect(declarations).toContain("color:var(--color-fg)");
    expect(declarations).toContain("text-decoration:underline");
  });

  it("gives the pressed rule higher specificity than .colorful-btn:hover so its non-hover look still wins outside hover", () => {
    const pressedRule = css.match(PRESSED_RULE_PATTERN);
    expect(
      pressedRule,
      '.pause-toggle[aria-pressed="true"] rule not found',
    ).not.toBeNull();

    const pressedSpecificity = classAttributePseudoSpecificity(
      pressedRule![1].trim(),
    );
    const hoverSpecificity = classAttributePseudoSpecificity(
      ".colorful-btn:hover",
    );

    expect(
      pressedSpecificity,
      "pressed rule regressed to the same (or lower) specificity as .colorful-btn:hover",
    ).toBeGreaterThan(hoverSpecificity);
  });

  it("keeps the base .colorful-btn:hover rainbow fill intact so a pressed+hover pause toggle can still show it", () => {
    const hoverRule = css.match(
      /(?:^|\}|\{|,)\s*\.colorful-btn:hover\s*\{([^}]*)\}/,
    );
    expect(hoverRule, ".colorful-btn:hover rule not found").not.toBeNull();

    const declarations = stripWhitespace(hoverRule![1]);
    expect(declarations).toContain("color:transparent");
    expect(declarations).toContain("animation-name:gx-rainbow-pan");
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
    const beforeRule = stripComments(css.slice(0, ruleStart));
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

// The footer rave toggle carries no class besides `colorful-btn` (unlike the
// pause control, which used to layer its own compliant color on top), so its
// WCAG 1.4.3 resting-state contrast against the page's --color-bg depends
// entirely on the shared base rule's own color. #6f6c66 measured ~3.78:1
// there — under the 4.5:1 AA minimum — until this guard's fix.
describe("colorful button resting contrast", () => {
  // Stripped, like the sibling enclosure checks above (reduced motion guards,
  // colorful-btn focus-visible): comments can otherwise be mistaken for real
  // CSS (see stripComments).
  const css = stripComments(readStyleCss());

  function srgbChannelToLinear(channel: number) {
    const normalized = channel / 255;
    if (normalized <= 0.03928) {
      return normalized / 12.92;
    }
    return ((normalized + 0.055) / 1.055) ** 2.4;
  }

  function relativeLuminance(hexColor: string) {
    const hexDigits = hexColor.replace("#", "");
    const red = parseInt(hexDigits.slice(0, 2), 16);
    const green = parseInt(hexDigits.slice(2, 4), 16);
    const blue = parseInt(hexDigits.slice(4, 6), 16);
    return (
      0.2126 * srgbChannelToLinear(red) +
      0.7152 * srgbChannelToLinear(green) +
      0.0722 * srgbChannelToLinear(blue)
    );
  }

  function contrastRatio(foregroundHex: string, backgroundHex: string) {
    const foregroundLuminance = relativeLuminance(foregroundHex);
    const backgroundLuminance = relativeLuminance(backgroundHex);
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // Reads a token's hex literal from wherever it's declared (`@theme` or
  // plain `:root` — --color-surface lives in the latter, alongside the other
  // template-only-consumed --gx-* tokens). Matches only the declaration
  // (`token: #hex;`), never a `var(token)` usage site, so it can search the
  // whole stylesheet instead of being scoped to one block.
  function readColorTokenHex(tokenName: string) {
    const tokenMatch = css.match(
      new RegExp(`${tokenName}:\\s*(#[0-9a-fA-F]{6})\\s*;`),
    );
    expect(tokenMatch, `${tokenName} declaration not found`).not.toBeNull();
    return tokenMatch![1];
  }

  const WCAG_AA_NORMAL_TEXT_MINIMUM_CONTRAST = 4.5;

  // Backgrounds every .colorful-btn instance actually sits on: the footer
  // rave toggle paints straight onto the page (--color-bg), while the
  // terminal-window pause toggle sits on the card's --color-surface.
  const COLORFUL_BTN_BACKGROUND_TOKENS = [BRAND_BG_TOKEN, "--color-surface"];

  // Same anchor alternation and `matchAll` approach as the reduced-motion
  // guard's HOVER_RULE_PATTERN above: a plain first-match `css.match` would
  // miss a later `.colorful-btn { color: #6f6c66 }` rule that wins the
  // cascade. The anchor alternation includes `{`, so a match can still be
  // nested inside an at-rule — isTopLevelMatch below filters those out
  // before either assertion below trusts a match.
  const COLORFUL_BTN_RULE_PATTERN =
    /(?:^|\}|\{|,)\s*\.colorful-btn\s*\{([^}]*)\}/g;

  function selectorStart(match: RegExpMatchArray, selector: string) {
    return match.index! + match[0].indexOf(selector);
  }

  // A rule matched by COLORFUL_BTN_RULE_PATTERN can still be nested inside an
  // at-rule (the anchor alternation includes `{`), so filter to rules that
  // sit at the stylesheet's top level before trusting any of them.
  function isTopLevelMatch(match: RegExpMatchArray, selector: string) {
    const before = css.slice(0, selectorStart(match, selector));
    return countOccurrences(before, "{") - countOccurrences(before, "}") === 0;
  }

  it("resolves every top-level .colorful-btn resting color from --color-fg-muted, not a literal", () => {
    const topLevelBlocks = [...css.matchAll(COLORFUL_BTN_RULE_PATTERN)].filter(
      (match) => isTopLevelMatch(match, ".colorful-btn"),
    );
    expect(
      topLevelBlocks.length,
      ".colorful-btn top-level rule not found",
    ).toBeGreaterThan(0);

    topLevelBlocks.forEach((block) => {
      expect(stripWhitespace(block[1])).not.toContain("#6f6c66");
    });
    expect(stripWhitespace(topLevelBlocks.at(-1)![1])).toContain(
      "color:var(--color-fg-muted)",
    );
  });

  it("meets WCAG 1.4.3 (>= 4.5:1) for .colorful-btn's resting color on every background it sits on", () => {
    const fgMuted = readColorTokenHex("--color-fg-muted");
    COLORFUL_BTN_BACKGROUND_TOKENS.forEach((backgroundToken) => {
      const ratio = contrastRatio(fgMuted, readColorTokenHex(backgroundToken));
      expect(ratio, `${fgMuted} on ${backgroundToken}`).toBeGreaterThanOrEqual(
        WCAG_AA_NORMAL_TEXT_MINIMUM_CONTRAST,
      );
    });
  });

  // Mirrors the "brand background token" describe's single-source-of-truth
  // guard (:60-83) for the surface token this diff introduces: the literal
  // must live in exactly one place, and its one consumer (the terminal card
  // in GrimicornPage.vue) must reference it via var(), not repeat the hex
  // value — otherwise the card can regress to a hardcoded literal and only a
  // snapshot (routinely regenerated with `-u`) would notice.
  it("keeps --color-surface's literal in exactly one place and consumed via var()", () => {
    const surfaceHex = readColorTokenHex("--color-surface");
    expect(countOccurrences(css, surfaceHex)).toBe(1);

    const grimicornPage = readFileSync(GRIMICORN_PAGE_PATH, "utf8");
    expect(grimicornPage).toContain("var(--color-surface)");
    expect(grimicornPage).not.toContain(surfaceHex);
  });
});
