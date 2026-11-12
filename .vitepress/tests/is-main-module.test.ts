import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isMainModule } from "../../scripts/is-main-module.mjs";

const SCRIPTS_DIRECTORY = resolve(import.meta.dirname, "../../scripts");
const HELPER_FILE_NAME = "is-main-module.mjs";
const HELPER_PATH = join(SCRIPTS_DIRECTORY, HELPER_FILE_NAME);
const MAIN_MARKER = "RAN_AS_MAIN";
const IMPORTED_MARKER = "RAN_AS_IMPORTED";
const EXPECTED_GUARDED_SCRIPTS = [
  "check-asset-version-bump.mjs",
  "check-security-txt-expiry.mjs",
  "check-undeployed-commits.mjs",
  "regenerate-asset-version-lock.mjs",
  "report-workflow-failure.mjs",
  "sync-security-txt-issue.mjs",
  "verify-netlify-deploy.mjs",
];

const scriptFileNames = readdirSync(SCRIPTS_DIRECTORY).filter(
  (fileName) => fileName.endsWith(".mjs") && fileName !== HELPER_FILE_NAME,
);

function writeProbeScript(directory: string) {
  const probePath = join(directory, "probe.mjs");
  writeFileSync(
    probePath,
    `import { isMainModule } from ${JSON.stringify(pathToFileURL(HELPER_PATH).href)};
console.log(isMainModule(import.meta.url) ? "${MAIN_MARKER}" : "${IMPORTED_MARKER}");
`,
  );
  return probePath;
}

describe("isMainModule", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "is-main-module-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const moduleUrl = pathToFileURL(realpathSync(HELPER_PATH)).href;

  it("throws when the caller forgets to pass its import.meta.url", () => {
    expect(() =>
      isMainModule(undefined as unknown as string, HELPER_PATH),
    ).toThrow(TypeError);
  });

  it("returns false when there is no argv[1] (module imported, not invoked)", () => {
    expect(isMainModule(moduleUrl, undefined)).toBe(false);
  });

  it("returns true when argv[1] is the module itself", () => {
    expect(isMainModule(moduleUrl, HELPER_PATH)).toBe(true);
  });

  it("returns false for an unrelated existing path", () => {
    expect(
      isMainModule(moduleUrl, resolve(SCRIPTS_DIRECTORY, "../package.json")),
    ).toBe(false);
  });

  it("returns false for a path that does not exist, without throwing", () => {
    expect(isMainModule(moduleUrl, "/nonexistent/other.mjs")).toBe(false);
  });

  it("resolves a symlinked argv[1] to the real module (the /tmp-is-a-symlink case on macOS)", () => {
    const symlinkPath = join(directory, "linked.mjs");
    symlinkSync(HELPER_PATH, symlinkPath);
    expect(isMainModule(moduleUrl, symlinkPath)).toBe(true);
  });

  it("returns false for a path through a regular file (ENOTDIR), without throwing", () => {
    expect(isMainModule(moduleUrl, join(HELPER_PATH, "child.mjs"))).toBe(false);
  });

  it("rethrows realpath errors that are not a missing path (ELOOP)", () => {
    const loopA = join(directory, "loop-a.mjs");
    const loopB = join(directory, "loop-b.mjs");
    symlinkSync(loopB, loopA);
    symlinkSync(loopA, loopB);
    expect(() => isMainModule(moduleUrl, loopA)).toThrow(
      expect.objectContaining({ code: "ELOOP" }),
    );
  });

  it("uses the caller's module URL, not the helper's own", () => {
    const otherUrl = pathToFileURL(join(SCRIPTS_DIRECTORY, "other.mjs")).href;
    expect(isMainModule(otherUrl, HELPER_PATH)).toBe(false);
  });

  it("detects main when a script runs directly, also through a symlink", () => {
    const probePath = writeProbeScript(directory);
    const symlinkPath = join(directory, "linked-probe.mjs");
    symlinkSync(probePath, symlinkPath);
    expect(execFileSync(process.execPath, [probePath]).toString().trim()).toBe(
      MAIN_MARKER,
    );
    expect(
      execFileSync(process.execPath, [symlinkPath]).toString().trim(),
    ).toBe(MAIN_MARKER);
  });

  it("detects imported when another module loads the script", () => {
    const probePath = writeProbeScript(directory);
    const importerPath = join(directory, "importer.mjs");
    writeFileSync(
      importerPath,
      `await import(${JSON.stringify(pathToFileURL(probePath).href)});\n`,
    );
    expect(
      execFileSync(process.execPath, [importerPath]).toString().trim(),
    ).toBe(IMPORTED_MARKER);
  });
});

describe("scripts using the shared helper", () => {
  const guardedScriptFileNames = scriptFileNames.filter((fileName) =>
    readFileSync(join(SCRIPTS_DIRECTORY, fileName), "utf8").includes(
      "isMainModule",
    ),
  );

  it("is used by exactly the expected entry-point scripts", () => {
    expect([...guardedScriptFileNames].sort()).toEqual(
      EXPECTED_GUARDED_SCRIPTS,
    );
  });

  it.each(guardedScriptFileNames)(
    "%s imports the helper and passes its own import.meta.url",
    (fileName) => {
      const source = readFileSync(join(SCRIPTS_DIRECTORY, fileName), "utf8");
      expect(source).toContain(
        'import { isMainModule } from "./is-main-module.mjs";',
      );
      expect(source).toContain("isMainModule(import.meta.url)");
      expect(source).not.toMatch(/function isMainModule/);
    },
  );
});
