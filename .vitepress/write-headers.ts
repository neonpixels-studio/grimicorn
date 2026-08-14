import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildContentSecurityPolicy,
  buildHeadersFile,
  collectScriptHashes,
} from "./headers";

// Build-time filesystem seam for the generated Netlify `_headers` file: read every
// rendered page from the VitePress output directory and write the CSP carrying the
// per-build inline-script hashes. Kept out of config.ts so the config stays
// declarative and this I/O is unit-testable against a temp directory.

const HTML_EXTENSION = ".html";
const HEADERS_FILENAME = "_headers";

// `parentPath` names the directory of a recursive Dirent (Node 20.12+); the repo
// pins Node 24 via .nvmrc/NODE_VERSION, so it is always present.
export function readRenderedPages(outDir: string) {
  return readdirSync(outDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(HTML_EXTENSION))
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"));
}

// Netlify gives netlify.toml precedence over `_headers` for a shared header name,
// so the CSP lives here alone (the other security headers stay static in
// netlify.toml).
export function writeCspHeaders(outDir: string) {
  const scriptHashes = collectScriptHashes(readRenderedPages(outDir));
  // VitePress always emits inline bootstrap scripts, so zero hashes means the
  // extraction broke (e.g. VitePress changed its output). Fail the build rather
  // than ship a CSP that blocks those scripts and breaks the site in the browser.
  if (scriptHashes.length === 0) {
    throw new Error(
      "No inline script hashes collected; the generated CSP would block VitePress's bootstrap scripts",
    );
  }
  const headersPath = join(outDir, HEADERS_FILENAME);
  // VitePress copies public/ into outDir before buildEnd, so a public/_headers
  // would already be here. Fail loud rather than silently drop its rules.
  if (existsSync(headersPath)) {
    throw new Error(
      `${HEADERS_FILENAME} already exists in ${outDir}; refusing to overwrite it with the generated CSP`,
    );
  }
  writeFileSync(
    headersPath,
    buildHeadersFile(buildContentSecurityPolicy(scriptHashes)),
  );
}
