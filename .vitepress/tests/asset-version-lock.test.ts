import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { ASSET_CACHE_BUST } from "../asset-cache-bust";
import { HERO_AVIF_HREF } from "../../hero-image-spec.mjs";
import { OG_IMAGE_FILENAME } from "../../og-banner-spec.mjs";
import {
  PROJECT_ROOT,
  VERSIONED_ASSET_FILES,
  assertTokenBumpedForChangedAssets,
  changedAssetPaths,
  fingerprintAssets,
  hashAssetBytes,
  readAssetCacheBustToken,
  readAssetVersionLock,
} from "../../asset-version-manifest.mjs";

// Assets under /assets/* and /images/* are served immutable for a year (netlify.toml),
// so the only thing that forces returning visitors to refetch a changed byte is the
// shared ?v= token. These tests bind that token to the actual bytes via
// asset-version-lock.json: change an asset without bumping the token + regenerating the
// lock and the suite goes red. Regenerate with `npm run lock:assets` (after bumping
// ASSET_CACHE_BUST in asset-cache-bust.ts).
const PUBLIC_DIR = "public";
const APPENDED_BYTE = Buffer.from([0]);
const CACHE_BUST_CALL_PATTERN =
  /withAssetCacheBust\(\s*['"](\/[^'"]+)['"]\s*\)/g;
const BUMPED_TOKEN = "?v=29990101";
// Where production code lives. tests/ (fixtures/example paths), cache/ and dist/
// (build output) are excluded so only real render-time call sites are discovered.
const CACHE_BUST_SOURCE_DIR = ".vitepress";
const CACHE_BUST_SOURCE_EXTENSIONS = [".ts", ".mts", ".vue"];
const CACHE_BUST_EXCLUDED_DIRS = ["tests", "cache", "dist"];
// Distinct assets currently cache-busted via a string literal (hero webp/png, head
// avif/webp/png, site.webmanifest). A drop below this means the literal scan silently
// stopped matching — a renamed helper, a reformatted call, a switch to a template
// literal — so the drift guard would go blind. Bump this when call sites legitimately
// change (and add the asset to VERSIONED_ASSET_FILES).
const EXPECTED_LITERAL_CALL_SITE_FILES = 6;

function readProjectFile(relativePath: string) {
  return readFileSync(resolve(PROJECT_ROOT, relativePath), "utf8");
}

function isExcludedSource(relativePath: string) {
  return CACHE_BUST_EXCLUDED_DIRS.some((dir) => {
    return relativePath.startsWith(`${dir}/`);
  });
}

function isScannableSource(relativePath: string) {
  if (isExcludedSource(relativePath)) {
    return false;
  }
  return CACHE_BUST_SOURCE_EXTENSIONS.some((ext) => {
    return relativePath.endsWith(ext);
  });
}

function cacheBustSourceFiles() {
  const sourceRoot = resolve(PROJECT_ROOT, CACHE_BUST_SOURCE_DIR);
  const entries = readdirSync(sourceRoot, { recursive: true }) as string[];
  return entries
    .filter(isScannableSource)
    .map((relativePath) => resolve(sourceRoot, relativePath));
}

// Public URL paths passed as string literals to withAssetCacheBust, mapped to their
// on-disk file under public/. Indirect call sites (spec-derived hrefs like
// HERO_AVIF_HREF) use identifiers, not literals, so they are asserted separately.
function literalCacheBustAssetFiles() {
  const matches = cacheBustSourceFiles().flatMap((absolutePath) => {
    return [
      ...readFileSync(absolutePath, "utf8").matchAll(CACHE_BUST_CALL_PATTERN),
    ];
  });
  return [...new Set(matches.map((match) => `${PUBLIC_DIR}${match[1]}`))];
}

describe("asset version invariant", () => {
  const lock = readAssetVersionLock();

  it("locks the same ?v= token that asset-cache-bust.ts exports", () => {
    expect(lock.token).toBe(ASSET_CACHE_BUST);
    expect(readAssetCacheBustToken()).toBe(ASSET_CACHE_BUST);
  });

  it("locks exactly the set of token-versioned assets", () => {
    const lockedPaths = Object.keys(lock.assets).sort();
    expect(lockedPaths).toEqual([...VERSIONED_ASSET_FILES].sort());
  });

  it("matches every asset's current bytes to its locked content hash", () => {
    expect(fingerprintAssets()).toEqual(lock.assets);
  });

  it("tracks every asset the code cache-busts with the shared token", () => {
    const literalFiles = literalCacheBustAssetFiles();
    expect(literalFiles.length).toBe(EXPECTED_LITERAL_CALL_SITE_FILES);
    const indirectFiles = [
      `${PUBLIC_DIR}${HERO_AVIF_HREF}`,
      `${PUBLIC_DIR}/assets/${OG_IMAGE_FILENAME}`,
    ];
    for (const assetFile of [...literalFiles, ...indirectFiles]) {
      expect(VERSIONED_ASSET_FILES, assetFile).toContain(assetFile);
    }
  });

  it("cache-busts every site.webmanifest icon with the shared token", () => {
    const manifest = JSON.parse(
      readProjectFile("public/images/site.webmanifest"),
    );
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(icon.src.endsWith(ASSET_CACHE_BUST), icon.src).toBe(true);
    }
  });

  // Real end-to-end proof the guard bites: hash actual asset bytes with one extra byte,
  // splice that into the real fingerprint, and assert the shared guard flags it and
  // refuses the unchanged token.
  it("fails the guard when an asset's bytes change under the current token", () => {
    const [firstAsset] = VERSIONED_ASSET_FILES;
    const tamperedBytes = Buffer.concat([
      readFileSync(resolve(PROJECT_ROOT, firstAsset)),
      APPENDED_BYTE,
    ]);
    const tampered = {
      ...lock.assets,
      [firstAsset]: hashAssetBytes(tamperedBytes),
    };
    expect(changedAssetPaths(lock.assets, tampered)).toContain(firstAsset);
    expect(() => {
      assertTokenBumpedForChangedAssets(lock, lock.token, tampered);
    }).toThrow(/not newer/);
  });
});

describe("changedAssetPaths", () => {
  it("reports existing assets whose hash moved", () => {
    const previous = { "a.png": "hash-a", "b.png": "hash-b" };
    const next = { "a.png": "hash-a", "b.png": "hash-b-new" };
    expect(changedAssetPaths(previous, next)).toEqual(["b.png"]);
  });

  it("ignores a newly tracked asset with no cached copies to invalidate", () => {
    const previous = { "a.png": "hash-a" };
    const next = { "a.png": "hash-a", "new.png": "hash-new" };
    expect(changedAssetPaths(previous, next)).toEqual([]);
  });
});

describe("assertTokenBumpedForChangedAssets", () => {
  const previousLock = {
    token: "?v=20260816",
    assets: { "a.png": "hash-a" },
  };

  it("throws when an existing asset changed but the token did not advance", () => {
    const fingerprint = { "a.png": "hash-a-new" };
    expect(() => {
      assertTokenBumpedForChangedAssets(
        previousLock,
        previousLock.token,
        fingerprint,
      );
    }).toThrow(/not newer/);
  });

  it("throws when a changed asset is paired with an older (downgraded) token", () => {
    const fingerprint = { "a.png": "hash-a-new" };
    expect(() => {
      assertTokenBumpedForChangedAssets(
        previousLock,
        "?v=20260101",
        fingerprint,
      );
    }).toThrow(/not newer/);
  });

  it("passes when a changed asset is paired with a newer token", () => {
    const fingerprint = { "a.png": "hash-a-new" };
    expect(() => {
      assertTokenBumpedForChangedAssets(
        previousLock,
        BUMPED_TOKEN,
        fingerprint,
      );
    }).not.toThrow();
  });

  it("passes when only a new asset was added under the same token", () => {
    const fingerprint = { "a.png": "hash-a", "new.png": "hash-new" };
    expect(() => {
      assertTokenBumpedForChangedAssets(
        previousLock,
        previousLock.token,
        fingerprint,
      );
    }).not.toThrow();
  });

  it("passes on the first lock, when there is no previous lock", () => {
    const fingerprint = { "a.png": "hash-a" };
    expect(() => {
      assertTokenBumpedForChangedAssets(null, previousLock.token, fingerprint);
    }).not.toThrow();
  });
});
