import { describe, it, expect } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "vitepress";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SITE_PAGE_SOURCE = "index.md";

describe("VitePress srcExclude", () => {
  it("builds index.md as the only page, so README.md never reaches the build or sitemap", async () => {
    const siteConfig = await resolveConfig(PROJECT_ROOT, "build", "production");
    expect(siteConfig.pages).toEqual([SITE_PAGE_SOURCE]);
  });
});
