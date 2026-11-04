import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import config from "../config";

const SITE_PAGE_SOURCE = "index.md";

function rootMarkdownFiles(): string[] {
  return readdirSync(resolve(process.cwd()), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);
}

describe("VitePress srcExclude", () => {
  it("excludes README.md so it is not built or listed in the sitemap", () => {
    expect(config.srcExclude).toContain("README.md");
  });

  it("excludes every repo-root markdown file except the index page", () => {
    const leaking = rootMarkdownFiles().filter(
      (name) =>
        name !== SITE_PAGE_SOURCE && !(config.srcExclude ?? []).includes(name),
    );
    expect(leaking).toEqual([]);
  });

  it("never excludes the index page", () => {
    expect(config.srcExclude).not.toContain(SITE_PAGE_SOURCE);
  });
});
