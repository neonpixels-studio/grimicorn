import { afterEach, describe, it, expect } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "vitepress";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SITE_PAGE_SOURCE = "index.md";
// Stands in for gitignored local notes such as _scratch.md, so the exclusion is
// exercised whether or not any exist on this machine.
const LOCAL_NOTE_PROBE = resolve(PROJECT_ROOT, "_src-exclude-probe.md");

afterEach(() => {
  rmSync(LOCAL_NOTE_PROBE, { force: true });
});

describe("VitePress srcExclude", () => {
  it("builds index.md as the only page, so README.md and local _*.md notes never reach the build or sitemap", async () => {
    writeFileSync(LOCAL_NOTE_PROBE, "# local note\n");
    const siteConfig = await resolveConfig(PROJECT_ROOT, "build", "production");
    expect(siteConfig.pages).toEqual([SITE_PAGE_SOURCE]);
  });
});
