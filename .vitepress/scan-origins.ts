import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { DISALLOWED_ORIGINS } from "./origins";

// Post-build gate for third-party origins. The source-level scan
// (tests/fonts.test.ts) proves the theme source carries no disallowed origin, but a
// dependency, a VitePress plugin, or a comment that survives minification could
// still inject one into the rendered output that the source scan never sees. This
// walks the built output and fails the build loud if any disallowed origin reappears
// there. Wired into buildEnd in config.ts, so `vitepress build` (and CI's build
// step) enforce it. The filesystem access is isolated behind scanBuildOutput so the
// origin-matching logic stays unit-testable against fixture text.

// Only the resource file types a re-introduced font/style/script origin would live
// in and that the CSP governs. License and namespace files (.txt/.xml/.svg)
// legitimately cite unrelated third-party URLs, so scanning them would add false
// positives without adding cover.
const SCANNED_EXTENSIONS = [".html", ".css", ".js"];

export type OriginFinding = {
  file: string;
  origin: string;
};

export function findDisallowedOrigins(
  text: string,
  disallowedOrigins: string[] = DISALLOWED_ORIGINS,
) {
  return disallowedOrigins.filter((origin) => text.includes(origin));
}

function isScannableFile(fileName: string) {
  return SCANNED_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}

function collectScannableFiles(outDir: string) {
  return readdirSync(outDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && isScannableFile(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

export function scanBuildOutput(
  outDir: string,
  disallowedOrigins: string[] = DISALLOWED_ORIGINS,
): OriginFinding[] {
  return collectScannableFiles(outDir).flatMap((filePath) => {
    const contents = readFileSync(filePath, "utf8");
    return findDisallowedOrigins(contents, disallowedOrigins).map((origin) => ({
      file: filePath,
      origin,
    }));
  });
}

function formatFindings(findings: OriginFinding[]) {
  return findings
    .map((finding) => `  ${finding.origin} in ${finding.file}`)
    .join("\n");
}

export function assertBuildOutputHasNoDisallowedOrigins(
  outDir: string,
  disallowedOrigins: string[] = DISALLOWED_ORIGINS,
) {
  const findings = scanBuildOutput(outDir, disallowedOrigins);
  if (findings.length === 0) {
    return;
  }
  throw new Error(
    `Build output references disallowed third-party origins; the first-party-only CSP would block these:\n${formatFindings(findings)}`,
  );
}
