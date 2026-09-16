// Single source of truth for parsing the brand background color out of the theme
// stylesheet (.vitepress/theme/style.css). Imported by both the OG banner generator
// (scripts/generate-og-banner.mjs), which pads the banner to this color at runtime,
// and the config test suite (.vitepress/tests/config.test.ts), which asserts the
// manifest and theme-color meta tag stay pinned to it, so there is exactly one CSS
// scan rather than a copy per consumer that can drift out of sync.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractSingleCapture, stripBlockComments } from "./text-extract.mjs";

// Resolved from this module's own location (not process.cwd()) so every consumer —
// a script run from anywhere, or a test suite run from the repo root — reads the
// exact same file rather than two path expressions that merely happen to agree.
const moduleDir = dirname(fileURLToPath(import.meta.url));
const THEME_STYLESHEET_PATH = resolve(moduleDir, ".vitepress/theme/style.css");

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

// Reads and parses the real theme stylesheet. The one I/O entry point every
// consumer should call instead of resolving/reading the file themselves, so the
// path and the parse can't drift apart between callers.
export function readBrandBackgroundColor() {
  return extractBrandBackgroundColor(
    readFileSync(THEME_STYLESHEET_PATH, "utf8"),
    THEME_STYLESHEET_PATH,
  );
}
