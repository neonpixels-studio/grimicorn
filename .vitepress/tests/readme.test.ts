import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The README documents the npm scripts and the build-time invariants. These tests
// keep it in lockstep with the code it describes, the same way fonts.test.ts and
// asset-cache-bust.test.ts couple config.ts to its collaborators: a renamed script,
// a wrong command string, or a stale token in the docs fails here instead of
// silently leaving the onboarding doc wrong.
const README_PATH = resolve(process.cwd(), "README.md");
const PACKAGE_JSON_PATH = resolve(process.cwd(), "package.json");
const FONTS_CSS_PATH = resolve(process.cwd(), ".vitepress/theme/fonts.css");
const NVMRC_PATH = resolve(process.cwd(), ".nvmrc");

// The core workflow scripts a contributor runs on day one; each must exist in
// package.json and be documented in the table.
const CORE_DOCUMENTED_SCRIPTS = ["dev", "build", "test", "typecheck", "lint"];

// Scripts the README table is not expected to list: `prepare` is a husky lifecycle
// hook npm runs automatically, not something a contributor invokes by hand.
const UNDOCUMENTED_SCRIPT_EXEMPTIONS = ["prepare"];

// Captures the script name from every `npm run <script>` reference in the README.
// A character class (not a backtick-delimited capture) so a compound command like
// `npm run lint && npm run typecheck` yields each script rather than one bad blob.
const NPM_RUN_REFERENCE_PATTERN = /npm run ([\w:-]+)/g;

// A `| `npm run <name>` | `<command>` |` row from the script table, so the command
// is checked against the row it belongs to rather than merely appearing somewhere.
const SCRIPT_TABLE_ROW_PATTERN =
  /^\|\s*`npm run ([\w:-]+)`\s*\|\s*`([^`]+)`\s*\|/gm;

// The self-hosted-font cache-bust token, read from an actual `src: url(...)`
// declaration (not the header comment, which also mentions ?v=). fonts.css and the
// config.ts preloads already move it in lockstep (see fonts.test.ts); this pulls the
// README into that loop so a font refresh can't leave the docs citing a stale token.
const FONT_DECLARATION_TOKEN_PATTERN = /src:\s*url\([^)]*(\?v=\d{8})/;

function readReadme() {
  return readFileSync(README_PATH, "utf8");
}

function packageScripts(): Record<string, string> {
  const parsed = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));
  return parsed.scripts ?? {};
}

function referencedScripts(readme: string) {
  return [...readme.matchAll(NPM_RUN_REFERENCE_PATTERN)].map(
    (match) => match[1],
  );
}

function documentedCommands(readme: string): Map<string, string> {
  return new Map(
    [...readme.matchAll(SCRIPT_TABLE_ROW_PATTERN)].map((match) => [
      match[1],
      match[2],
    ]),
  );
}

function fontCacheBustToken() {
  const token = readFileSync(FONTS_CSS_PATH, "utf8").match(
    FONT_DECLARATION_TOKEN_PATTERN,
  );
  if (!token) {
    throw new Error("No ?v= token found on a fonts.css @font-face src url");
  }
  return token[1];
}

describe("README documents the real build workflow", () => {
  const readme = readReadme();
  const scripts = packageScripts();
  const referenced = new Set(referencedScripts(readme));
  const tableCommands = documentedCommands(readme);

  it("documents every core workflow script, and each still exists", () => {
    for (const script of CORE_DOCUMENTED_SCRIPTS) {
      expect(scripts, script).toHaveProperty(script);
      expect(referenced.has(script), `npm run ${script}`).toBe(true);
    }
  });

  it("references no npm script that package.json does not define", () => {
    const unknown = [...referenced].filter((script) => !(script in scripts));
    expect(
      unknown,
      `undefined scripts referenced in README: ${unknown}`,
    ).toEqual([]);
  });

  it("tabulates every non-exempt script with its exact command", () => {
    for (const [script, command] of Object.entries(scripts)) {
      if (UNDOCUMENTED_SCRIPT_EXEMPTIONS.includes(script)) {
        continue;
      }
      expect(tableCommands.get(script), `command for ${script}`).toBe(command);
    }
  });

  it("cites the current self-hosted-font ?v= token from fonts.css", () => {
    expect(readme, "font ?v= token").toContain(fontCacheBustToken());
  });

  it("cites the pinned Node version from .nvmrc", () => {
    const nodeVersion = readFileSync(NVMRC_PATH, "utf8").trim();
    expect(readme, "Node version").toContain(nodeVersion);
  });
});
