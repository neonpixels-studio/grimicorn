// Small, generic text-parsing helpers with no domain of their own. Shared so the
// config test suite has one implementation of "strip CSS block comments" and one
// implementation of "pull exactly one regex capture or fail loud" instead of a
// copy per file that scans (brand-color.mjs, robots.txt, llms.txt, JS imports).

// CSS has block comments only, so a stylesheet scan strips just `/* ... */` — a
// commented-out declaration must not be counted as real.
/**
 * @param {string} source
 * @returns {string}
 */
export function stripBlockComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

// Duplicate declarations/directives are exactly the drift these scans guard
// against, so every extraction insists on exactly one match. Shared across
// callers that each bring their own pattern, so both preconditions on that
// pattern (global, and carrying a capture group) are checked here once rather
// than trusted at every call site.
/**
 * @param {string} source
 * @param {RegExp} pattern
 * @param {string} description
 * @returns {string}
 */
export function extractSingleCapture(source, pattern, description) {
  if (!pattern.global) {
    throw new Error(`Pattern for ${description} must use the global flag`);
  }
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${description}, found ${matches.length}`,
    );
  }
  const [, capture] = matches[0];
  if (capture === undefined) {
    throw new Error(`Pattern for ${description} has no capture group`);
  }
  return capture.trim();
}
