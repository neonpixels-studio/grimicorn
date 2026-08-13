import { afterEach, describe, it, expect } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readRenderedPages, writeCspHeaders } from "../write-headers";
import {
  buildContentSecurityPolicy,
  buildHeadersFile,
  collectScriptHashes,
} from "../headers";

const HEADERS_FILENAME = "_headers";
const INLINE_SCRIPT = "console.log(1)";

const createdDirs: string[] = [];

function makeDistDir() {
  const dir = mkdtempSync(join(tmpdir(), "grimicorn-headers-"));
  createdDirs.push(dir);
  return dir;
}

function writePage(dir: string, relativePath: string, html: string) {
  const target = join(dir, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, html);
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("readRenderedPages", () => {
  it("walks nested directories and reads only .html files", () => {
    const dir = makeDistDir();
    writePage(dir, "index.html", "<p>home</p>");
    writePage(dir, "guide/page.html", "<p>nested</p>");
    writePage(dir, "assets/app.js", "ignored");
    expect(readRenderedPages(dir).sort()).toEqual(
      ["<p>home</p>", "<p>nested</p>"].sort(),
    );
  });
});

describe("writeCspHeaders", () => {
  it("writes a _headers file with the hashed CSP for every rendered page", () => {
    const dir = makeDistDir();
    writePage(dir, "index.html", `<script>${INLINE_SCRIPT}</script>`);
    writeCspHeaders(dir);
    const expected = buildHeadersFile(
      buildContentSecurityPolicy(
        collectScriptHashes([`<script>${INLINE_SCRIPT}</script>`]),
      ),
    );
    expect(readFileSync(join(dir, HEADERS_FILENAME), "utf8")).toBe(expected);
  });

  it("fails loud when no inline scripts are found, rather than shipping a broken CSP", () => {
    const dir = makeDistDir();
    writePage(dir, "index.html", "<p>no scripts here</p>");
    expect(() => writeCspHeaders(dir)).toThrow(/No inline script hashes/);
  });

  it("refuses to overwrite an existing _headers file", () => {
    const dir = makeDistDir();
    writePage(dir, "index.html", `<script>${INLINE_SCRIPT}</script>`);
    writeFileSync(join(dir, HEADERS_FILENAME), "/*\n  X-From-Public: 1\n");
    expect(() => writeCspHeaders(dir)).toThrow(/already exists/);
  });
});
