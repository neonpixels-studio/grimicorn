import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT_DIR = process.cwd();
const LICENSE_PATH = resolve(ROOT_DIR, "LICENSE");
const CONTENT_LICENSE_FILENAME = "LICENSE-CONTENT";
const CONTENT_LICENSE_PATH = resolve(ROOT_DIR, CONTENT_LICENSE_FILENAME);
const FONT_LICENSE_PATHS = [
  "jetbrains-mono-OFL.txt",
  "space-grotesk-OFL.txt",
].map((fileName) => resolve(ROOT_DIR, "public/fonts", fileName));
const COPYRIGHT_HOLDER = "Danny Holloran";
const COPYRIGHT_PATTERN = new RegExp(
  `Copyright \\(c\\) \\d{4} ${COPYRIGHT_HOLDER}`,
);
const LICENSE_SECTION_PATTERN =
  /^## License\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m;
const ALL_RIGHTS_RESERVED = "All rights reserved";
const MIT_EXCLUSION = "not covered by the MIT license";
const PACKAGE_JSON_PATH = resolve(ROOT_DIR, "package.json");
const README_PATH = resolve(ROOT_DIR, "README.md");
const EXPECTED_LICENSE_ID = "MIT";
const MIT_TITLE = "MIT License";
const OFL_NAME = "SIL Open Font License";
const MIT_GRANT = "Permission is hereby granted, free of charge";
const MIT_WARRANTY = 'THE SOFTWARE IS PROVIDED "AS IS"';

function readText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function readFlattenedText(filePath: string): string {
  return readText(filePath).replace(/\s+/g, " ");
}

describe("LICENSE", () => {
  it("exists", () => {
    expect(existsSync(LICENSE_PATH)).toBe(true);
  });

  it("is the MIT license with the copyright holder named", () => {
    const text = readFlattenedText(LICENSE_PATH);
    expect(text.startsWith(MIT_TITLE)).toBe(true);
    expect(text).toMatch(COPYRIGHT_PATTERN);
    expect(text).toContain(MIT_GRANT);
    expect(text).toContain(MIT_WARRANTY);
  });

  it("points at the content notice", () => {
    expect(readText(LICENSE_PATH)).toContain(CONTENT_LICENSE_FILENAME);
  });
});

describe("package.json license field", () => {
  it("declares the MIT license", () => {
    const manifest = JSON.parse(readText(PACKAGE_JSON_PATH));
    expect(manifest.license).toBe(EXPECTED_LICENSE_ID);
  });
});

describe("content notice", () => {
  it("exists and reserves all rights to the content", () => {
    expect(existsSync(CONTENT_LICENSE_PATH)).toBe(true);
    const text = readFlattenedText(CONTENT_LICENSE_PATH);
    expect(text).toMatch(COPYRIGHT_PATTERN);
    expect(text).toContain(ALL_RIGHTS_RESERVED);
    expect(text).toContain(MIT_EXCLUSION);
  });

  it("notes that the fonts keep their OFL license", () => {
    expect(readFlattenedText(CONTENT_LICENSE_PATH)).toContain(OFL_NAME);
  });

  it.each(FONT_LICENSE_PATHS)(
    "ships the font license %s",
    (fontLicensePath) => {
      expect(existsSync(fontLicensePath)).toBe(true);
    },
  );

  it("is linked from the README license section", () => {
    const licenseSection =
      readText(README_PATH).match(LICENSE_SECTION_PATTERN)?.[1] ?? "";
    expect(licenseSection).toContain(`](${CONTENT_LICENSE_FILENAME})`);
  });
});
