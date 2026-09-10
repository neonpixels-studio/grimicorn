import { describe, it, expect } from "vitest";
import {
  checkAssetVersionBump,
  isLockAbsentAtRefError,
  resolveBaseRef,
} from "../../scripts/check-asset-version-bump.mjs";

// Mirrors the fixture shape scripts/regenerate-asset-version-lock.test.ts already
// uses for assertTokenBumpedForChangedAssets, but exercised through
// checkAssetVersionBump()'s injectable readLock/computeFingerprint/readToken seam so
// none of these tests needs a real git repo or the committed lockfile.
interface AssetVersionLock {
  token: string;
  assets: Record<string, string>;
}

describe("checkAssetVersionBump", () => {
  const BASE_REF = "origin/main";
  const baseLock: AssetVersionLock = {
    token: "?v=20260816",
    assets: { "public/assets/grimicorn-hero.png": "hash-old" },
  };

  function withFixture({
    token,
    fingerprint,
    readLock = () => baseLock,
  }: {
    token: string;
    fingerprint: Record<string, string>;
    readLock?: () => AssetVersionLock | null;
  }) {
    return () =>
      checkAssetVersionBump({
        baseRef: BASE_REF,
        readLock,
        computeFingerprint: () => fingerprint,
        readToken: () => token,
      });
  }

  it("passes when a changed asset is paired with a token bumped past the base branch's", () => {
    const run = withFixture({
      token: "?v=20260817",
      fingerprint: { "public/assets/grimicorn-hero.png": "hash-new" },
    });
    expect(run).not.toThrow();
    expect(run()).toEqual({ skipped: false, baseRef: BASE_REF });
  });

  it("fails when a changed asset's token was not bumped past the base branch's", () => {
    const run = withFixture({
      token: baseLock.token,
      fingerprint: { "public/assets/grimicorn-hero.png": "hash-new" },
    });
    expect(run).toThrow(/not newer/);
  });

  it("passes when no asset changed relative to the base branch, even with the same token", () => {
    const run = withFixture({
      token: baseLock.token,
      fingerprint: { "public/assets/grimicorn-hero.png": "hash-old" },
    });
    expect(run).not.toThrow();
    expect(run()).toEqual({ skipped: false, baseRef: BASE_REF });
  });

  it("passes when the base branch has no committed lock yet (first lock)", () => {
    const run = withFixture({
      token: "?v=20260817",
      fingerprint: { "public/assets/grimicorn-hero.png": "hash-new" },
      readLock: () => null,
    });
    expect(run).not.toThrow();
  });

  it("skips without reading the lock when there is no base ref (not a pull request)", () => {
    let readLockCalled = false;
    const result = checkAssetVersionBump({
      baseRef: null,
      readLock: () => {
        readLockCalled = true;
        return baseLock;
      },
    });
    expect(result.skipped).toBe(true);
    expect(readLockCalled).toBe(false);
  });
});

describe("resolveBaseRef", () => {
  it("prefixes GITHUB_BASE_REF with origin/ for a pull_request event", () => {
    expect(resolveBaseRef({ GITHUB_BASE_REF: "main" })).toBe("origin/main");
  });

  it("returns null when GITHUB_BASE_REF is unset (a push event, not a pull request)", () => {
    expect(resolveBaseRef({})).toBe(null);
  });

  it("returns null for an empty GITHUB_BASE_REF", () => {
    expect(resolveBaseRef({ GITHUB_BASE_REF: "" })).toBe(null);
  });
});

describe("isLockAbsentAtRefError", () => {
  it("recognizes git's 'does not exist' message for a missing path at a ref", () => {
    expect(
      isLockAbsentAtRefError(
        "fatal: path '.vitepress/asset-version-lock.json' does not exist in 'origin/main'",
      ),
    ).toBe(true);
  });

  it("recognizes git's 'exists on disk, but not in' message", () => {
    expect(
      isLockAbsentAtRefError(
        "fatal: path '.vitepress/asset-version-lock.json' exists on disk, but not in 'origin/main'",
      ),
    ).toBe(true);
  });

  it("recognizes git's 'unknown revision' message for an unfetched base ref", () => {
    expect(
      isLockAbsentAtRefError(
        "fatal: ambiguous argument 'origin/main': unknown revision or path not in the working tree.",
      ),
    ).toBe(true);
  });

  it("does not classify an unrelated git failure as a missing lock", () => {
    expect(isLockAbsentAtRefError("fatal: not a git repository")).toBe(false);
  });
});
