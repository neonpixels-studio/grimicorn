import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkAssetVersionBump,
  isLockAbsentAtRefError,
  isMainModule,
  readLockTextAtRef,
  resolveBaseRef,
} from "../../scripts/check-asset-version-bump.mjs";
import { ASSET_VERSION_LOCK_FILE } from "../../asset-version-manifest.mjs";

const TEST_FILE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

// Mirrors the fixture shape .vitepress/tests/asset-version-lock.test.ts already
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

  it("fails when a tracked asset is dropped from the fingerprint without a token bump", () => {
    // The gap from issue #174: checkAssetVersionBump only walks the *current*
    // fingerprint, so a PR that removes an asset's path from VERSIONED_ASSET_FILES
    // leaves no trace of it in the fingerprint at all — only its absence. The base
    // lock still has the entry; the current fingerprint does not.
    const run = withFixture({
      token: baseLock.token,
      fingerprint: {},
    });
    expect(run).toThrow(/dropped from VERSIONED_ASSET_FILES/);
  });

  it("fails with both reasons when one asset changed and a different asset was dropped in the same PR", () => {
    // The exact combined gap from issue #174: a PR can change one asset's bytes AND
    // remove a different asset's path from VERSIONED_ASSET_FILES in the same change.
    // Overrides the shared single-asset baseLock with a two-asset one, through the
    // injected findMergeBase/readLock seams (this suite never touches real git — see
    // the file-level comment above), so both the "changed" and "dropped" branches
    // fire together.
    const twoAssetBaseLock: AssetVersionLock = {
      token: "?v=20260816",
      assets: {
        "public/assets/grimicorn-hero.png": "hash-old",
        "public/assets/grimicorn-og.png": "hash-og-old",
      },
    };
    const run = withFixture({
      token: twoAssetBaseLock.token,
      fingerprint: { "public/assets/grimicorn-og.png": "hash-og-new" },
      readLock: () => twoAssetBaseLock,
    });
    expect(run).toThrow(
      /bytes changed \(public\/assets\/grimicorn-og\.png\) and dropped from VERSIONED_ASSET_FILES \(public\/assets\/grimicorn-hero\.png\)/,
    );
  });

  it("passes when a dropped asset is paired with a token bumped past the base branch's", () => {
    const run = withFixture({
      token: "?v=20260817",
      fingerprint: {},
    });
    expect(run).not.toThrow();
    expect(run()).toEqual({ skipped: false, comparedRef: MERGE_BASE_SHA });
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

  it("throws instead of silently reading the index when findMergeBase returns an empty ref", () => {
    // An empty comparedRef fed straight into readLock would resolve to `git show
    // :<path>` — the index, not a commit — which in CI matches HEAD and would make
    // the gate compare the PR against itself instead of failing loud.
    let readLockCalled = false;
    const run = () =>
      checkAssetVersionBump({
        baseRef: BASE_REF,
        findMergeBase: () => "",
        readLock: () => {
          readLockCalled = true;
          return baseLock;
        },
      });
    expect(run).toThrow(/Could not resolve a merge base/);
    expect(readLockCalled).toBe(false);
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

  it("returns the raw text on success, invoking git show with a single ref:path arg", () => {
    const receivedArgs: string[][] = [];
    const runGitCommand = (args: string[]) => {
      receivedArgs.push(args);
      return '{"token":"?v=20260816","assets":{}}';
    };
    expect(readLockTextAtRef(REF, runGitCommand)).toBe(
      '{"token":"?v=20260816","assets":{}}',
    );
    expect(receivedArgs).toEqual([
      ["show", `${REF}:${ASSET_VERSION_LOCK_FILE}`],
    ]);
  });
});

describe("isMainModule", () => {
  it("returns false when argv1 is undefined (module imported, not invoked)", () => {
    expect(isMainModule(undefined)).toBe(false);
  });

  it("returns false for an unrelated existing path", () => {
    expect(isMainModule(fileURLToPath(import.meta.url))).toBe(false);
  });

  it("returns false for a path that does not exist on disk, without throwing", () => {
    expect(isMainModule("/nonexistent/path/does-not-exist.mjs")).toBe(false);
  });

  it("returns true when argv1 is a symlink resolving to this module's real path", () => {
    const scriptPath = resolve(
      TEST_FILE_DIRECTORY,
      "../../scripts/check-asset-version-bump.mjs",
    );
    const tempDirectory = mkdtempSync(join(tmpdir(), "isMainModule-"));
    const symlinkPath = join(tempDirectory, "check-asset-version-bump.mjs");
    try {
      symlinkSync(scriptPath, symlinkPath);
      expect(isMainModule(symlinkPath)).toBe(true);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
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

describe("ci.yml's ci job checkout", () => {
  // check:asset-version-bump needs origin/<base> available locally to compute a
  // merge-base against it; without `fetch-depth: 0` the checkout is shallow and
  // findMergeBaseUsingGit() fails with "fatal: Not a valid object name origin/main"
  // for every PR. Reading the raw workflow (rather than asserting in prose) means a
  // dropped `fetch-depth: 0` fails this test instead of only failing CI. (See
  // .github/actions/setup-node-project/action.yml for why checkout is its own
  // step here rather than living inside that composite action.)
  it("sets fetch-depth: 0 so check:asset-version-bump can diff against the base branch", () => {
    const ciYamlPath = resolve(
      TEST_FILE_DIRECTORY,
      "../../.github/workflows/ci.yml",
    );
    const source = readFileSync(ciYamlPath, "utf8");
    const lines = source.split("\n");
    const ciJobStart = lines.findIndex((line) => /^\s*ci:\s*$/.test(line));
    const e2eJobStart = lines.findIndex((line) => /^\s*e2e:\s*$/.test(line));
    expect(ciJobStart).toBeGreaterThanOrEqual(0);
    expect(e2eJobStart).toBeGreaterThan(ciJobStart);
    const ciJobLines = lines.slice(ciJobStart, e2eJobStart);
    // Anchored to the checkout step's own option lines (not "anywhere in the ci
    // job") so a commented-out `# fetch-depth: 0`, an unrelated step's `with:`, or a
    // later checkout step further down the job can't satisfy this test.
    const checkoutStart = ciJobLines.findIndex((line) =>
      /^\s*-\s+uses:\s*actions\/checkout/.test(line),
    );
    expect(checkoutStart).toBeGreaterThanOrEqual(0);
    const afterCheckout = ciJobLines.slice(checkoutStart + 1);
    const nextStepOffset = afterCheckout.findIndex((line) =>
      /^\s*-\s+\S/.test(line),
    );
    const checkoutOptionLines = afterCheckout.slice(
      0,
      nextStepOffset === -1 ? undefined : nextStepOffset,
    );
    expect(
      checkoutOptionLines.some((line) => /^\s+fetch-depth:\s*0\s*$/.test(line)),
    ).toBe(true);
  });
});

// Anchored to the start of a step's `uses:` line (an optional `- ` list marker
// and optional quotes, then `uses:` immediately — never a `#`-commented line
// or a substring inside prose) so neither regex can be satisfied by a comment
// mentioning either action.
const LOCAL_SETUP_ACTION_PATTERN =
  /^\s*(-\s+)?uses:\s*["']?\.\/\.github\/actions\/setup-node-project/;
const CHECKOUT_ACTION_PATTERN = /^\s*(-\s+)?uses:\s*["']?actions\/checkout/;

function splitWorkflowIntoJobs(lines: string[]): string[][] {
  const jobsLineIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  const linesUnderJobs =
    jobsLineIndex === -1 ? [] : lines.slice(jobsLineIndex + 1);
  // Top-level job names sit at exactly two-space indent under `jobs:` (e.g.
  // `  ci:`, optionally with a trailing comment); `[^\s#]` excludes both
  // deeper-indented step lines (whose third character is a space) and a
  // commented-out `  # ci:`. Scoped to start after `jobs:` so a same-indent key
  // under `on:` (`  push:`, `  pull_request:`) can't be mistaken for a job.
  const jobNameLineIndexes = linesUnderJobs
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^ {2}[^\s#][^:]*:\s*(#.*)?$/.test(line))
    .map(({ index }) => index);
  const boundaries = [...jobNameLineIndexes, linesUnderJobs.length];
  return jobNameLineIndexes.map((start, position) =>
    linesUnderJobs.slice(start, boundaries[position + 1]),
  );
}

function findStepIndex(jobLines: string[], pattern: RegExp): number {
  return jobLines.findIndex((line) => pattern.test(line));
}

function findJobsUsingLocalSetupAction(workflowPath: string): string[][] {
  const source = readFileSync(workflowPath, "utf8");
  const jobs = splitWorkflowIntoJobs(source.split("\n"));
  return jobs.filter(
    (jobLines) => findStepIndex(jobLines, LOCAL_SETUP_ACTION_PATTERN) !== -1,
  );
}

function expectCheckoutBeforeLocalSetupAction(jobLines: string[]): void {
  const localActionStart = findStepIndex(jobLines, LOCAL_SETUP_ACTION_PATTERN);
  const checkoutStart = findStepIndex(jobLines, CHECKOUT_ACTION_PATTERN);
  expect(checkoutStart).toBeGreaterThanOrEqual(0);
  expect(checkoutStart).toBeLessThan(localActionStart);
}

describe("workflows using the setup-node-project composite action", () => {
  // Guards the constraint documented on .github/actions/setup-node-project's
  // description: a job referencing the local composite action (`uses: ./...`)
  // must check out the repo first, or the runner fails with "Can't find
  // 'action.yml' ... under '.../.github/actions/setup-node-project'" before any
  // step runs. Reads every workflow file (not a hardcoded list) so a future
  // workflow adopting the action is covered automatically.
  it("checks out the repo before using the local composite action, in every job that uses it", () => {
    const workflowsDirectory = resolve(
      TEST_FILE_DIRECTORY,
      "../../.github/workflows",
    );
    const workflowFiles = readdirSync(workflowsDirectory).filter((name) =>
      /\.ya?ml$/.test(name),
    );
    expect(workflowFiles.length).toBeGreaterThan(0);

    const jobsUsingLocalAction = workflowFiles.flatMap((workflowFile) =>
      findJobsUsingLocalSetupAction(join(workflowsDirectory, workflowFile)),
    );
    // Proves the assertions below actually run against real jobs: without
    // this, a regex drifting out of sync with the workflow YAML would leave
    // this list empty and the test would pass having checked nothing.
    expect(jobsUsingLocalAction.length).toBeGreaterThan(0);
    jobsUsingLocalAction.forEach(expectCheckoutBeforeLocalSetupAction);
  });
});
