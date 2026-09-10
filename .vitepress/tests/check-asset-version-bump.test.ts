import { describe, it, expect } from "vitest";
import {
  checkAssetVersionBump,
  isLockAbsentAtRefError,
  readLockTextAtRef,
  resolveBaseRef,
} from "../../scripts/check-asset-version-bump.mjs";

// Mirrors the fixture shape scripts/regenerate-asset-version-lock.test.ts already
// uses for assertTokenBumpedForChangedAssets, but exercised through
// checkAssetVersionBump()'s injectable findMergeBase/readLock/computeFingerprint/
// readToken seam so none of these tests needs a real git repo or the committed
// lockfile.
interface AssetVersionLock {
  token: string;
  assets: Record<string, string>;
}

describe("checkAssetVersionBump", () => {
  const BASE_REF = "origin/main";
  const MERGE_BASE_SHA = "abc1234";
  const baseLock: AssetVersionLock = {
    token: "?v=20260816",
    assets: { "public/assets/grimicorn-hero.png": "hash-old" },
  };

  function withFixture({
    token,
    fingerprint,
    readLock = () => baseLock,
    findMergeBase = () => MERGE_BASE_SHA,
  }: {
    token: string;
    fingerprint: Record<string, string>;
    readLock?: (_ref: string) => AssetVersionLock | null;
    findMergeBase?: (_ref: string) => string;
  }) {
    return () =>
      checkAssetVersionBump({
        baseRef: BASE_REF,
        findMergeBase,
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
    expect(run()).toEqual({ skipped: false, comparedRef: MERGE_BASE_SHA });
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
    expect(run()).toEqual({ skipped: false, comparedRef: MERGE_BASE_SHA });
  });

  it("passes when the base branch has no committed lock yet (first lock), even with an unbumped token", () => {
    // token is deliberately left at baseLock.token (not bumped): the only reason
    // this must pass is the missing baseLock short-circuiting the guard, not an
    // incidental token bump masking the same result.
    const run = withFixture({
      token: baseLock.token,
      fingerprint: { "public/assets/grimicorn-hero.png": "hash-new" },
      readLock: () => null,
    });
    expect(run).not.toThrow();
    expect(run()).toEqual({ skipped: false, comparedRef: MERGE_BASE_SHA });
  });

  it("propagates a findMergeBase failure (e.g. an unfetched base ref) without reading the lock", () => {
    let readLockCalled = false;
    const run = () =>
      checkAssetVersionBump({
        baseRef: BASE_REF,
        findMergeBase: () => {
          throw new Error(
            "fatal: Not a valid object name origin/nonexistent-branch",
          );
        },
        readLock: () => {
          readLockCalled = true;
          return baseLock;
        },
      });
    expect(run).toThrow(/Not a valid object name/);
    expect(readLockCalled).toBe(false);
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

  it("reads the lock at the PR's merge-base with the base branch, not the base ref directly", () => {
    // Proves the merge-base indirection is actually wired up (not just present as
    // dead code): readLock must receive findMergeBase's return value, and
    // findMergeBase must receive the resolved base ref — never "HEAD" or the base
    // ref passed straight through to readLock.
    const receivedMergeBaseArgs: string[] = [];
    const receivedReadLockArgs: string[] = [];
    checkAssetVersionBump({
      baseRef: BASE_REF,
      findMergeBase: (ref) => {
        receivedMergeBaseArgs.push(ref);
        return MERGE_BASE_SHA;
      },
      readLock: (ref) => {
        receivedReadLockArgs.push(ref);
        return baseLock;
      },
      computeFingerprint: () => baseLock.assets,
      readToken: () => baseLock.token,
    });
    expect(receivedMergeBaseArgs).toEqual([BASE_REF]);
    expect(receivedReadLockArgs).toEqual([MERGE_BASE_SHA]);
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

describe("readLockTextAtRef", () => {
  const REF = "origin/main";

  function fakeGitFailure(stderrText: string): () => never {
    return () => {
      const error = new Error(`Command failed`) as Error & { stderr: string };
      error.stderr = stderrText;
      throw error;
    };
  }

  it("returns null when the lock is absent at the ref, without rethrowing", () => {
    const runGitCommand = fakeGitFailure(
      "fatal: path '.vitepress/asset-version-lock.json' does not exist in 'origin/main'",
    );
    expect(readLockTextAtRef(REF, runGitCommand)).toBe(null);
  });

  it("rethrows a real git failure instead of treating it as a missing lock", () => {
    const runGitCommand = fakeGitFailure(
      "fatal: ambiguous argument 'origin/main': unknown revision or path not in the working tree.",
    );
    expect(() => readLockTextAtRef(REF, runGitCommand)).toThrow(
      /Could not read .*asset-version-lock\.json at origin\/main/,
    );
  });

  it("returns the raw text on success", () => {
    const runGitCommand = () => '{"token":"?v=20260816","assets":{}}';
    expect(readLockTextAtRef(REF, runGitCommand)).toBe(
      '{"token":"?v=20260816","assets":{}}',
    );
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

  it("does NOT classify git's 'unknown revision' message as a missing lock", () => {
    // An unfetched/unknown base ref (e.g. fetch-depth: 0 got dropped from ci.yml) is
    // a broken check, not "no lock yet" — it must fail loud, never silently pass.
    expect(
      isLockAbsentAtRefError(
        "fatal: ambiguous argument 'origin/main': unknown revision or path not in the working tree.",
      ),
    ).toBe(false);
  });

  it("does not classify an unrelated git failure as a missing lock", () => {
    expect(isLockAbsentAtRefError("fatal: not a git repository")).toBe(false);
  });

  it("does not classify a 'does not exist' message about something other than a path-at-ref as a missing lock", () => {
    // Same substring ("does not exist") as the real message, but a different git
    // failure shape (a missing branch, not a missing path at a ref) — must not be
    // matched on the substring alone.
    expect(isLockAbsentAtRefError("fatal: branch 'main' does not exist")).toBe(
      false,
    );
  });
});
