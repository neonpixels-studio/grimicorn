import { afterEach, describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertBuildOutputHasNoSourceMaps,
  hasSourceMappingUrlComment,
  scanBuildOutputForSourceMaps,
} from "../scan-source-maps";

const createdDirs: string[] = [];

function makeDistDir() {
  const dir = mkdtempSync(join(tmpdir(), "grimicorn-maps-"));
  createdDirs.push(dir);
  return dir;
}

function writeFile(dir: string, relativePath: string, contents: string) {
  const target = join(dir, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, contents);
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("hasSourceMappingUrlComment", () => {
  it("matches JS and CSS reference comments", () => {
    expect(
      hasSourceMappingUrlComment("a();\n//# sourceMappingURL=a.js.map"),
    ).toBe(true);
    expect(
      hasSourceMappingUrlComment("a{}\n/*# sourceMappingURL=a.css.map */"),
    ).toBe(true);
  });

  it("matches the legacy //@ form", () => {
    expect(
      hasSourceMappingUrlComment("a();\n//@ sourceMappingURL=a.js.map"),
    ).toBe(true);
  });

  it("ignores a comment marker built inside a string literal", () => {
    expect(
      hasSourceMappingUrlComment(
        'const tail = "\\n" + "//# sourceMappingURL=" + url;',
      ),
    ).toBe(false);
  });

  it("ignores a bare mention inside a bundled string", () => {
    expect(
      hasSourceMappingUrlComment('const note = "sourceMappingURL=";'),
    ).toBe(false);
  });
});

describe("scanBuildOutputForSourceMaps", () => {
  it("finds nothing in a clean build output", () => {
    const dir = makeDistDir();
    writeFile(dir, "index.html", "<p>ok</p>");
    writeFile(dir, "assets/app.js", "console.log('ok')");
    expect(scanBuildOutputForSourceMaps(dir)).toEqual([]);
  });

  it("flags a leftover .map file in nested output", () => {
    const dir = makeDistDir();
    writeFile(dir, "assets/chunks/app.js.map", "{}");
    expect(scanBuildOutputForSourceMaps(dir)).toEqual([
      { file: join(dir, "assets/chunks/app.js.map"), reason: "map file" },
    ]);
  });

  it("flags a sourceMappingURL comment even when the map was deleted", () => {
    const dir = makeDistDir();
    writeFile(dir, "assets/app.js", "a();\n//# sourceMappingURL=app.js.map");
    expect(scanBuildOutputForSourceMaps(dir)).toEqual([
      { file: join(dir, "assets/app.js"), reason: "sourceMappingURL comment" },
    ]);
  });
});

describe("scanBuildOutputForSourceMaps file types", () => {
  const COMMENT = "/*# sourceMappingURL=app.css.map */";

  it("reads css files", () => {
    const dir = makeDistDir();
    writeFile(dir, "assets/app.css", COMMENT);
    expect(scanBuildOutputForSourceMaps(dir)).toHaveLength(1);
  });

  it("skips file types that are not scripts or styles", () => {
    const dir = makeDistDir();
    writeFile(dir, "index.html", COMMENT);
    expect(scanBuildOutputForSourceMaps(dir)).toEqual([]);
  });
});

describe("assertBuildOutputHasNoSourceMaps", () => {
  it("passes on a clean build output", () => {
    const dir = makeDistDir();
    writeFile(dir, "assets/app.js", "console.log('ok')");
    expect(() => assertBuildOutputHasNoSourceMaps(dir)).not.toThrow();
  });

  it("fails the build on a leftover map, naming the file", () => {
    const dir = makeDistDir();
    writeFile(dir, "assets/app.js.map", "{}");
    expect(() => assertBuildOutputHasNoSourceMaps(dir)).toThrow(/app\.js\.map/);
  });
});
