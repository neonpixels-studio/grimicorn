import { describe, it, expect } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { ASSET_CACHE_BUST } from "../asset-cache-bust";
import { HERO_AVIF_HREF } from "../../hero-image-spec.mjs";
import { OG_IMAGE_FILENAME } from "../../og-banner-spec.mjs";
import {
  PROJECT_ROOT,
  SITE_WEBMANIFEST_FILE,
  VERSIONED_ASSET_FILES,
  assertTokenBumpedForChangedAssets,
  changedAssetPaths,
  compareAssetCacheBustTokens,
  fingerprintAssets,
  hashAssetBytes,
  parseAssetCacheBustToken,
  parseAssetVersionLock,
  readAssetCacheBustToken,
  readAssetVersionLock,
  syncManifestCacheBustTokens,
  syncWebManifestCacheBustTokensOnDisk,
} from "../../asset-version-manifest.mjs";
import {
  isMainModule,
  regenerateLock,
} from "../../scripts/regenerate-asset-version-lock.mjs";

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

describe("readAssetCacheBustToken", () => {
  // Exercises the real file read against a throwaway fixture (never the committed
  // asset-cache-bust.ts), proving TOKEN_PATTERN itself extracts a same-day revision
  // suffix — a regression here wouldn't otherwise be caught, since the live token
  // committed in the repo has no suffix today.
  function withTempSourceModule(
    contents: string,
    run: (_path: string) => void,
  ) {
    const tempDir = mkdtempSync(resolve(tmpdir(), "asset-cache-bust-source-"));
    const sourcePath = resolve(tempDir, "asset-cache-bust.ts");
    writeFileSync(sourcePath, contents);
    try {
      run(sourcePath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  it("extracts a bare dated token from the source module", () => {
    withTempSourceModule(
      'export const ASSET_CACHE_BUST = "?v=20260823";\n',
      (sourcePath) => {
        expect(readAssetCacheBustToken(sourcePath)).toBe("?v=20260823");
      },
    );
  });

  it("extracts a token carrying a same-day revision suffix from the source module", () => {
    withTempSourceModule(
      'export const ASSET_CACHE_BUST = "?v=20260823-2";\n',
      (sourcePath) => {
        expect(readAssetCacheBustToken(sourcePath)).toBe("?v=20260823-2");
      },
    );
  });

  it("throws a descriptive error when no token is found", () => {
    withTempSourceModule("export const SOMETHING_ELSE = 1;\n", (sourcePath) => {
      expect(() => {
        readAssetCacheBustToken(sourcePath);
      }).toThrow(/Could not find an ASSET_CACHE_BUST/);
    });
  });
});

describe("parseAssetVersionLock", () => {
  it("accepts a lock whose token carries a same-day revision suffix", () => {
    const lock = parseAssetVersionLock(
      JSON.stringify({ token: "?v=20260823-2", assets: { "a.png": "hash-a" } }),
      "fixture",
    );
    expect(lock.token).toBe("?v=20260823-2");
  });

  it("rejects a lock whose token carries a malformed revision suffix", () => {
    expect(() => {
      parseAssetVersionLock(
        JSON.stringify({ token: "?v=20260823-", assets: {} }),
        "fixture",
      );
    }).toThrow(/missing a valid "token"/);
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

  // Same-day revision suffix: two asset changes on one calendar day must both be
  // able to bump the token, via ?v=YYYYMMDD-N.
  describe("same-day revision suffix", () => {
    const fingerprint = { "a.png": "hash-a-new" };

    it("accepts a bare first-of-day token followed by an explicit -2 revision on the same day", () => {
      const sameDayFirstRevision = {
        token: "?v=20260823",
        assets: { "a.png": "hash-a" },
      };
      expect(() => {
        assertTokenBumpedForChangedAssets(
          sameDayFirstRevision,
          "?v=20260823-2",
          fingerprint,
        );
      }).not.toThrow();
    });

    it("rejects a same-day revision that did not advance past the locked revision", () => {
      const sameDaySecondRevision = {
        token: "?v=20260823-2",
        assets: { "a.png": "hash-a" },
      };
      expect(() => {
        assertTokenBumpedForChangedAssets(
          sameDaySecondRevision,
          "?v=20260823-2",
          fingerprint,
        );
      }).toThrow(/not newer/);
    });

    it("accepts a double-digit same-day revision as newer than a single-digit one (parsed, not lexicographic, comparison)", () => {
      // A plain string comparison would reject this: "?v=20260823-10" sorts before
      // "?v=20260823-2" lexicographically, because "1" < "2".
      const sameDaySecondRevision = {
        token: "?v=20260823-2",
        assets: { "a.png": "hash-a" },
      };
      expect(() => {
        assertTokenBumpedForChangedAssets(
          sameDaySecondRevision,
          "?v=20260823-10",
          fingerprint,
        );
      }).not.toThrow();
    });

    it("rejects a single-digit same-day revision as a downgrade from a double-digit one it would beat lexicographically", () => {
      const sameDayTenthRevision = {
        token: "?v=20260823-10",
        assets: { "a.png": "hash-a" },
      };
      expect(() => {
        assertTokenBumpedForChangedAssets(
          sameDayTenthRevision,
          "?v=20260823-2",
          fingerprint,
        );
      }).toThrow(/not newer/);
    });

    it("accepts a next-day rollover to a bare token, resetting the revision suffix", () => {
      const lastRevisionOfPriorDay = {
        token: "?v=20260823-3",
        assets: { "a.png": "hash-a" },
      };
      expect(() => {
        assertTokenBumpedForChangedAssets(
          lastRevisionOfPriorDay,
          "?v=20260824",
          fingerprint,
        );
      }).not.toThrow();
    });

    it("rejects a same-day revision on a stale date, even with a higher suffix, as a downgrade", () => {
      const nextDayToken = {
        token: "?v=20260824",
        assets: { "a.png": "hash-a" },
      };
      expect(() => {
        assertTokenBumpedForChangedAssets(
          nextDayToken,
          "?v=20260823-5",
          fingerprint,
        );
      }).toThrow(/not newer/);
    });
  });
});

describe("parseAssetCacheBustToken", () => {
  it("parses a bare dated token as the day's implicit first revision", () => {
    expect(parseAssetCacheBustToken("?v=20260823")).toEqual({
      date: "20260823",
      revision: 1,
    });
  });

  it("parses a same-day -N suffix as that day's explicit revision", () => {
    expect(parseAssetCacheBustToken("?v=20260823-2")).toEqual({
      date: "20260823",
      revision: 2,
    });
  });

  it("parses a multi-digit revision starting with 2-9 as a single number, not a truncated single digit", () => {
    // Guards TOKEN_REVISION_PATTERN_SOURCE's branch order: if the single-digit
    // "[2-9]" branch were tried before the multi-digit branch, "-20" would still parse
    // (via backtracking) today, but a future simplification that drops the ordering
    // guarantee could silently truncate it to revision 2.
    expect(parseAssetCacheBustToken("?v=20260823-20")).toEqual({
      date: "20260823",
      revision: 20,
    });
  });

  it("rejects an explicit -1 or -0 suffix, since the bare token is the only valid spelling of the first revision", () => {
    // Allowing "-1" (or "-0") as an alternate spelling of the implicit first revision
    // would let a stray leading-zero variant like "-01" parse as a same-day no-op
    // bump instead of a clear malformed-token error.
    for (const redundantToken of ["?v=20260823-0", "?v=20260823-1"]) {
      expect(() => {
        parseAssetCacheBustToken(redundantToken);
      }).toThrow(/Malformed asset cache-bust token/);
    }
  });

  it("throws a descriptive error for a malformed token", () => {
    for (const malformedToken of [
      "",
      "?v=1",
      "?v=20260823-",
      "20260823",
      "?v=202608231",
      "?v=20260823-2x",
      "?v=20260823--2",
      "?v=20260823-abc",
      "?v=20260823-02",
      " ?v=20260823",
    ]) {
      expect(() => {
        parseAssetCacheBustToken(malformedToken);
      }).toThrow(/Malformed asset cache-bust token/);
    }
  });
});

describe("compareAssetCacheBustTokens", () => {
  it("returns 0 for two tokens with an identical date and revision", () => {
    expect(compareAssetCacheBustTokens("?v=20260823", "?v=20260823")).toBe(0);
    expect(compareAssetCacheBustTokens("?v=20260823-2", "?v=20260823-2")).toBe(
      0,
    );
  });

  it("orders by date first, regardless of revision", () => {
    expect(
      compareAssetCacheBustTokens("?v=20260824", "?v=20260823-9"),
    ).toBeGreaterThan(0);
    expect(
      compareAssetCacheBustTokens("?v=20260823-9", "?v=20260824"),
    ).toBeLessThan(0);
  });

  it("orders by revision within the same date", () => {
    expect(
      compareAssetCacheBustTokens("?v=20260823-2", "?v=20260823"),
    ).toBeGreaterThan(0);
    expect(
      compareAssetCacheBustTokens("?v=20260823", "?v=20260823-2"),
    ).toBeLessThan(0);
  });

  it("orders numerically, not lexicographically, across a digit-count boundary", () => {
    expect(
      compareAssetCacheBustTokens("?v=20260823-10", "?v=20260823-2"),
    ).toBeGreaterThan(0);
  });
});

describe("syncManifestCacheBustTokens", () => {
  const NEW_TOKEN = "?v=20990101";

  it("rewrites every dated ?v= token in the manifest source to the new token", () => {
    const manifestSource = JSON.stringify({
      icons: [
        { src: "/images/web-app-manifest-192x192.png?v=20260101" },
        { src: "/images/web-app-manifest-512x512.png?v=20260101" },
      ],
    });
    const synced = syncManifestCacheBustTokens(manifestSource, NEW_TOKEN);
    expect(synced).not.toContain("?v=20260101");
    expect(synced.match(/\?v=20990101/g)?.length).toBe(2);
  });

  it("leaves unrelated manifest content untouched", () => {
    const manifestSource =
      '{"name":"Grimicorn Agent","icons":[{"src":"/images/icon.png?v=20260101"}]}';
    expect(syncManifestCacheBustTokens(manifestSource, NEW_TOKEN)).toBe(
      '{"name":"Grimicorn Agent","icons":[{"src":"/images/icon.png?v=20990101"}]}',
    );
  });

  it("rewrites an existing same-day revision suffix to the new token wholesale", () => {
    // Proves MANIFEST_TOKEN_PATTERN matches and fully replaces a prior "-N" suffix,
    // rather than leaving it dangling after the new date.
    const manifestSource = '{"src":"/images/icon.png?v=20260101-3"}';
    expect(syncManifestCacheBustTokens(manifestSource, NEW_TOKEN)).toBe(
      `{"src":"/images/icon.png${NEW_TOKEN}"}`,
    );
  });

  it("syncs to a new token that itself carries a same-day revision suffix", () => {
    const manifestSource = '{"src":"/images/icon.png?v=20260101"}';
    const suffixedToken = "?v=20260101-2";
    expect(syncManifestCacheBustTokens(manifestSource, suffixedToken)).toBe(
      `{"src":"/images/icon.png${suffixedToken}"}`,
    );
  });

  it("replaces a broken dangling-dash token instead of silently leaving it in place", () => {
    // A "-" with no digits after it (e.g. a botched hand-edit) doesn't match the
    // strict token grammar, but MANIFEST_TOKEN_PATTERN matches any run of non-quote
    // characters after "?v=" specifically so a malformed existing value still gets
    // replaced wholesale rather than skipped over.
    const manifestSource = '{"src":"/images/icon.png?v=20260823-"}';
    expect(syncManifestCacheBustTokens(manifestSource, NEW_TOKEN)).toBe(
      `{"src":"/images/icon.png${NEW_TOKEN}"}`,
    );
  });

  it("is a no-op (returns an identical string) when every token already matches", () => {
    const manifestSource = `{"src":"/images/icon.png${NEW_TOKEN}"}`;
    expect(syncManifestCacheBustTokens(manifestSource, NEW_TOKEN)).toBe(
      manifestSource,
    );
  });

  it("normalizes a malformed (wrong-length) committed token instead of partially overwriting it", () => {
    // A hand-edit typo (an extra digit) must not survive as a stray trailing digit —
    // the whole run of digits is replaced, not just the first 8.
    const manifestSource = '{"src":"/images/icon.png?v=202601011"}';
    expect(syncManifestCacheBustTokens(manifestSource, NEW_TOKEN)).toBe(
      `{"src":"/images/icon.png${NEW_TOKEN}"}`,
    );
  });

  it("refuses to sync with a malformed target token", () => {
    for (const malformedToken of ["", "v=1", "?v=1", "?v=209901011"]) {
      expect(() => {
        syncManifestCacheBustTokens(
          '{"src":"/images/icon.png?v=20260101"}',
          malformedToken,
        );
      }).toThrow(/malformed token/);
    }
  });

  it("does not rewrite a ?v= query on a non-src field", () => {
    // A webmanifest's start_url/scope can legitimately carry their own unrelated
    // query string; only a "src" value is an asset cache-bust this function owns.
    const manifestSource =
      '{"start_url":"/?v=1","icons":[{"src":"/images/icon.png?v=20260101"}]}';
    expect(syncManifestCacheBustTokens(manifestSource, NEW_TOKEN)).toBe(
      `{"start_url":"/?v=1","icons":[{"src":"/images/icon.png${NEW_TOKEN}"}]}`,
    );
  });

  it("appends the live token to a src that has none yet", () => {
    // A newly added icon (e.g. pasted from a favicon generator's output) may not
    // carry a ?v= at all — the sync must add one, not require one to already exist.
    const manifestSource = '{"icons":[{"src":"/images/icon-96x96.png"}]}';
    expect(syncManifestCacheBustTokens(manifestSource, NEW_TOKEN)).toBe(
      `{"icons":[{"src":"/images/icon-96x96.png${NEW_TOKEN}"}]}`,
    );
  });

  it("the committed manifest's tokens already match the live ASSET_CACHE_BUST", () => {
    // Proves the committed public/images/site.webmanifest is in sync without
    // exercising any write, so a test run can never mutate the tracked file.
    const manifestPath = resolve(PROJECT_ROOT, SITE_WEBMANIFEST_FILE);
    const original = readFileSync(manifestPath, "utf8");
    expect(
      syncManifestCacheBustTokens(original, readAssetCacheBustToken()),
    ).toBe(original);
  });
});

describe("syncWebManifestCacheBustTokensOnDisk", () => {
  const NEW_TOKEN = "?v=20990101";

  // Exercises the real file I/O against a throwaway fixture, never the committed
  // site.webmanifest, so a test run can't leave the working tree dirty.
  function withTempManifest(contents: string, run: (_path: string) => void) {
    const tempDir = mkdtempSync(resolve(tmpdir(), "manifest-sync-"));
    const manifestPath = resolve(tempDir, "site.webmanifest");
    writeFileSync(manifestPath, contents);
    try {
      run(manifestPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  it("writes the synced manifest back to disk when a token changed", () => {
    withTempManifest(
      '{"icons":[{"src":"/images/icon.png?v=20260101"}]}',
      (manifestPath) => {
        syncWebManifestCacheBustTokensOnDisk(NEW_TOKEN, manifestPath);
        expect(readFileSync(manifestPath, "utf8")).toBe(
          `{"icons":[{"src":"/images/icon.png${NEW_TOKEN}"}]}`,
        );
      },
    );
  });

  it("leaves the file's content unchanged when the token is already synced", () => {
    const original = `{"icons":[{"src":"/images/icon.png${NEW_TOKEN}"}]}`;
    withTempManifest(original, (manifestPath) => {
      syncWebManifestCacheBustTokensOnDisk(NEW_TOKEN, manifestPath);
      expect(readFileSync(manifestPath, "utf8")).toBe(original);
    });
  });

  it("returns the pre-sync bytes whether or not a write happened", () => {
    const staleManifest = '{"icons":[{"src":"/images/icon.png?v=20260101"}]}';
    withTempManifest(staleManifest, (manifestPath) => {
      expect(
        syncWebManifestCacheBustTokensOnDisk(NEW_TOKEN, manifestPath),
      ).toBe(staleManifest);
    });
    const alreadySynced = `{"icons":[{"src":"/images/icon.png${NEW_TOKEN}"}]}`;
    withTempManifest(alreadySynced, (manifestPath) => {
      expect(
        syncWebManifestCacheBustTokensOnDisk(NEW_TOKEN, manifestPath),
      ).toBe(alreadySynced);
    });
  });

  it("throws a descriptive error when the manifest file is missing", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "manifest-sync-"));
    try {
      const missingPath = resolve(tempDir, "does-not-exist.webmanifest");
      expect(() => {
        syncWebManifestCacheBustTokensOnDisk(NEW_TOKEN, missingPath);
      }).toThrow(/Web app manifest is missing/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("regenerateLock", () => {
  const STALE_TOKEN = "?v=20260101";
  const LIVE_TOKEN = "?v=20990101";
  const STALE_MANIFEST = `{"icons":[{"src":"/images/icon.png${STALE_TOKEN}"}]}`;

  // Exercises the real function against throwaway manifest/lock fixtures, with an
  // explicit `token: LIVE_TOKEN` override so the test never depends on (or mutates)
  // the real asset-cache-bust.ts, manifest, or lockfile.
  function withRegenerateLockFixture(
    manifestSource: string,
    run: (_paths: { manifestPath: string; lockPath: string }) => void,
  ) {
    const tempDir = mkdtempSync(resolve(tmpdir(), "regenerate-lock-"));
    const manifestPath = resolve(tempDir, "site.webmanifest");
    const lockPath = resolve(tempDir, "asset-version-lock.json");
    writeFileSync(manifestPath, manifestSource);
    try {
      run({ manifestPath, lockPath });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  // The whole point of this feature: regenerateLock() must sync the manifest's
  // tokens to the live value *before* hashing it, or the lockfile records a stale
  // hash that never notices the icon srcs drifted from ASSET_CACHE_BUST. Proven by
  // capturing the manifest's on-disk bytes at the moment computeFingerprint runs —
  // reordering the sync after the fingerprint in the implementation would make this
  // assertion see the stale bytes and fail.
  it("hashes the synced manifest, not the pre-sync bytes", () => {
    withRegenerateLockFixture(STALE_MANIFEST, ({ manifestPath, lockPath }) => {
      let manifestBytesAtFingerprintTime = "";
      regenerateLock({
        token: LIVE_TOKEN,
        manifestPath,
        lockPath,
        loadBaselineLock: () => null,
        computeFingerprint: () => {
          manifestBytesAtFingerprintTime = readFileSync(manifestPath, "utf8");
          return { [SITE_WEBMANIFEST_FILE]: "fake-hash" };
        },
      });
      expect(manifestBytesAtFingerprintTime).toContain(LIVE_TOKEN);
      expect(manifestBytesAtFingerprintTime).not.toContain(STALE_TOKEN);
    });
  });

  it("writes the lock with the live token and the computed fingerprint", () => {
    withRegenerateLockFixture(STALE_MANIFEST, ({ manifestPath, lockPath }) => {
      regenerateLock({
        token: LIVE_TOKEN,
        manifestPath,
        lockPath,
        loadBaselineLock: () => null,
        computeFingerprint: () => ({ [SITE_WEBMANIFEST_FILE]: "fake-hash" }),
      });
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      expect(lock.token).toBe(LIVE_TOKEN);
      expect(lock.assets).toEqual({ [SITE_WEBMANIFEST_FILE]: "fake-hash" });
    });
  });

  // Proves the rollback path: when validation rejects the run, the manifest must be
  // restored to its exact pre-sync bytes rather than left holding the live token
  // with no corresponding lock update.
  it("restores the manifest to its pre-sync bytes when the fingerprint guard rejects the run", () => {
    withRegenerateLockFixture(STALE_MANIFEST, ({ manifestPath, lockPath }) => {
      expect(() => {
        regenerateLock({
          token: LIVE_TOKEN,
          manifestPath,
          lockPath,
          loadBaselineLock: () => ({
            token: LIVE_TOKEN,
            assets: { [SITE_WEBMANIFEST_FILE]: "a-different-hash" },
          }),
          computeFingerprint: () => ({
            [SITE_WEBMANIFEST_FILE]: "fake-hash",
          }),
        });
      }).toThrow(/not newer/);
      expect(readFileSync(manifestPath, "utf8")).toBe(STALE_MANIFEST);
      expect(existsSync(lockPath)).toBe(false);
    });
  });
});

describe("isMainModule", () => {
  it("returns false when there is no argv[1]", () => {
    expect(isMainModule(undefined)).toBe(false);
  });

  it("returns false for an unrelated script path", () => {
    expect(isMainModule(resolve(PROJECT_ROOT, "package.json"))).toBe(false);
  });

  it("resolves a symlinked argv[1] to the same real script (the /tmp-is-a-symlink case on macOS)", () => {
    // Node resolves symlinks when it computes import.meta.url for the entry point,
    // so isMainModule() must realpath argv[1] too, or invoking the script through
    // any symlinked path — a symlinked /tmp, a linked package bin — would make the
    // two URLs disagree and the script would silently do nothing.
    const tempDir = mkdtempSync(resolve(tmpdir(), "is-main-module-"));
    const symlinkPath = resolve(tempDir, "regenerate-asset-version-lock.mjs");
    const realScriptPath = resolve(
      PROJECT_ROOT,
      "scripts/regenerate-asset-version-lock.mjs",
    );
    try {
      symlinkSync(realScriptPath, symlinkPath);
      expect(isMainModule(symlinkPath)).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
