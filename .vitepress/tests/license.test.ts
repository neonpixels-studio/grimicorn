import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT_DIR = process.cwd();
const LICENSE_PATH = resolve(ROOT_DIR, "LICENSE");
const CONTENT_LICENSE_PATH = resolve(ROOT_DIR, "LICENSE-CONTENT");
const PACKAGE_JSON_PATH = resolve(ROOT_DIR, "package.json");
const README_PATH = resolve(ROOT_DIR, "README.md");
const EXPECTED_LICENSE_ID = "MIT";
const MIT_GRANT = "Permission is hereby granted, free of charge";
const MIT_WARRANTY = 'THE SOFTWARE IS PROVIDED "AS IS"';
const COPYRIGHT_HOLDER = "Danny Holloran";

function readText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

describe("LICENSE", () => {
  it("exists", () => {
    expect(existsSync(LICENSE_PATH)).toBe(true);
  });

  it("is the MIT license with the copyright holder named", () => {
    const text = readText(LICENSE_PATH);
    expect(text.startsWith("MIT License")).toBe(true);
    expect(text).toMatch(
      new RegExp(`Copyright \\(c\\) \\d{4} ${COPYRIGHT_HOLDER}`),
    );
    expect(text).toContain(MIT_GRANT);
    expect(text).toContain(MIT_WARRANTY);
  });

  it("points at the content notice", () => {
    expect(readText(LICENSE_PATH)).toContain("LICENSE-CONTENT");
  });
});

describe("package.json license field", () => {
  it("matches the LICENSE file", () => {
    const manifest = JSON.parse(readText(PACKAGE_JSON_PATH));
    expect(manifest.license).toBe(EXPECTED_LICENSE_ID);
  });
});

describe("content notice", () => {
  it("exists and reserves all rights to the content", () => {
    expect(existsSync(CONTENT_LICENSE_PATH)).toBe(true);
    const text = readText(CONTENT_LICENSE_PATH);
    expect(text).toContain(`Copyright (c) 2026 ${COPYRIGHT_HOLDER}`);
    expect(text).toContain("All rights reserved");
    expect(text).toContain("not covered by the MIT license");
  });

  it("notes that the fonts keep their OFL license", () => {
    expect(readText(CONTENT_LICENSE_PATH)).toContain("SIL Open Font License");
  });

  it("is linked from the README license section", () => {
    const readme = readText(README_PATH);
    expect(readme).toContain("## License");
    expect(readme).toContain("LICENSE-CONTENT");
  });
});
