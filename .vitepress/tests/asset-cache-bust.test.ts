import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ASSET_CACHE_BUST, withAssetCacheBust } from "../asset-cache-bust";

const SHARED_MODULE_PATH = resolve(
  process.cwd(),
  ".vitepress/asset-cache-bust.ts",
);
const CONFIG_PATH = resolve(process.cwd(), ".vitepress/config.ts");
const COMPONENT_PATH = resolve(
  process.cwd(),
  ".vitepress/theme/components/GrimicornPage.vue",
);

// The versioned asset paths that must build their URL from the shared helper rather
// than carry an inline ?v= token — three hero sources plus three portrait sources.
const CACHE_BUSTED_ASSET_PATHS = [
  "/assets/grimicorn-hero.avif",
  "/assets/grimicorn-hero.webp",
  "/assets/grimicorn-hero.png",
  "/assets/grimicorn-head.avif",
  "/assets/grimicorn-head.webp",
  "/assets/grimicorn-head.png",
];

const SHARED_MODULE_IMPORT_PATTERN =
  /import\s*\{[^}]*\bwithAssetCacheBust\b[^}]*\}\s*from\s*["'][^"']*asset-cache-bust["']/;

function readSource(filePath: string) {
  return readFileSync(filePath, "utf8");
}

function countOccurrences(source: string, token: string) {
  return source.split(token).length - 1;
}

describe("asset cache-bust token", () => {
  it("exposes an 8-digit dated ?v= token as the single source of truth", () => {
    expect(ASSET_CACHE_BUST).toMatch(/^\?v=\d{8}$/);
  });

  it("appends the token to an asset path via the shared helper", () => {
    expect(withAssetCacheBust("/assets/example.avif")).toBe(
      `/assets/example.avif${ASSET_CACHE_BUST}`,
    );
  });

  it("keeps the token literal in exactly one place — the shared module", () => {
    const sharedOccurrences = countOccurrences(
      readSource(SHARED_MODULE_PATH),
      ASSET_CACHE_BUST,
    );
    const configOccurrences = countOccurrences(
      readSource(CONFIG_PATH),
      ASSET_CACHE_BUST,
    );
    const componentOccurrences = countOccurrences(
      readSource(COMPONENT_PATH),
      ASSET_CACHE_BUST,
    );
    expect(sharedOccurrences).toBe(1);
    expect(configOccurrences).toBe(0);
    expect(componentOccurrences).toBe(0);
  });

  it("has config.ts build its versioned URLs from the shared helper", () => {
    expect(readSource(CONFIG_PATH)).toMatch(SHARED_MODULE_IMPORT_PATTERN);
  });

  it("has GrimicornPage.vue build every versioned image URL from the shared helper", () => {
    const source = readSource(COMPONENT_PATH);
    expect(source).toMatch(SHARED_MODULE_IMPORT_PATTERN);
    for (const assetPath of CACHE_BUSTED_ASSET_PATHS) {
      expect(source, assetPath).toContain(`withAssetCacheBust('${assetPath}')`);
    }
  });
});
