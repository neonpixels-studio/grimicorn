// Single source of truth for parsing the brand background color out of the theme
// stylesheet (.vitepress/theme/style.css). Imported by both the OG banner generator
// (scripts/generate-og-banner.mjs), which pads the banner to this color at runtime,
// and the config test suite (.vitepress/tests/config.test.ts), which asserts the
// manifest and theme-color meta tag stay pinned to it, so there is exactly one CSS
// scan rather than a copy per consumer that can drift out of sync.
export const BRAND_BG_CUSTOM_PROPERTY = "--color-bg";

// Anchored to a declaration boundary: the char before the property must be a
// non-identifier char (start of input, whitespace, `{`, or `;`), so a sibling whose
// name ends with the full `--color-bg` token (e.g. `--accent--color-bg`) can't match
// on a substring. The value runs to the next `;`, block-closing `}`, or end of input,
// so a final declaration that omits its trailing semicolon still matches. The lazy
// value group plus trailing `\s*` stop the capture from absorbing the whitespace
// before a `}` or EOF terminator.
const BRAND_BG_PATTERN = new RegExp(
  `(?<![\\w-])${BRAND_BG_CUSTOM_PROPERTY}\\s*:\\s*([^;}]+?)\\s*(?:;|}|$)`,
  "g",
);
// The stylesheet and every consumer both use 6-digit hex; anything else fails loud
// rather than being silently normalized into a false match.
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// CSS has block comments only, so the stylesheet scan strips just `/* ... */` — a
// commented-out `--color-bg` must not be counted.
/**
 * @param {string} source
 * @returns {string}
 */
export function stripBlockComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

// One hex contract for every consumer: values are held to a 6-digit literal, so
// `#fff` vs `#ffffff` (identical to a browser) fails loud with a clear message
// instead of a confusing diff.
/**
 * @param {unknown} value
 * @param {string} description
 * @returns {string}
 */
export function normalizeHexColor(value, description) {
  if (typeof value !== "string") {
    throw new Error(`${description} is not a string color: ${String(value)}`);
  }
  const normalized = value.trim().toLowerCase();
  if (!HEX_COLOR_PATTERN.test(normalized)) {
    throw new Error(
      `${description} is not a 6-digit hex literal: ${normalized}`,
    );
  }
  return normalized;
}

// Duplicate declarations are exactly the drift this guards against, so every
// extraction insists on exactly one match.
/**
 * @param {string} source
 * @param {RegExp} pattern
 * @param {string} description
 * @returns {string}
 */
function extractSingleCapture(source, pattern, description) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${description}, found ${matches.length}`,
    );
  }
  return matches[0][1].trim();
}

// Parse the single brand background literal out of a stylesheet source. Comments
// must be stripped first; otherwise a commented-out `/* --color-bg: ... */`
// declaration counts as a real match and trips the "exactly one" guard. Pure over
// its input (source and label) so callers can pass either a real file's contents
// or a fixture, and so failures name the source the caller actually passed.
/**
 * @param {string} stylesheet
 * @param {string} sourceLabel
 * @returns {string}
 */
export function extractBrandBackgroundColor(stylesheet, sourceLabel) {
  const value = extractSingleCapture(
    stripBlockComments(stylesheet),
    BRAND_BG_PATTERN,
    `${BRAND_BG_CUSTOM_PROPERTY} declaration in ${sourceLabel}`,
  );
  return normalizeHexColor(
    value,
    `${BRAND_BG_CUSTOM_PROPERTY} in ${sourceLabel}`,
  );
}
