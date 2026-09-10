import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import {
  ASSET_VERSION_LOCK_FILE,
  PROJECT_ROOT,
  assertTokenBumpedForChangedAssets,
  fingerprintAssets,
  parseAssetVersionLock,
  readAssetCacheBustToken,
} from "../asset-version-manifest.mjs";

// scripts/regenerate-asset-version-lock.mjs already guards a *local* run: it compares
// the working tree against the lock committed at the developer's own HEAD before they
// commit. That check cannot catch a lock that was hand-edited (or regenerated without
// first bumping the token) *inside* the PR itself, because by the time CI runs, HEAD
// already is the commit carrying the tampered lock — there is no earlier commit left
// in the PR's own history to diff against. This script closes that gap by comparing
// against the PR's base branch instead, which the PR cannot rewrite.

// A base ref with no committed lock (a brand-new repo, or a base branch that predates
// the lock file) has nothing to diff against — the same "first lock" allowance
// scripts/regenerate-asset-version-lock.mjs grants for a missing HEAD copy. Any other
// git failure must not be swallowed as "no lock", or a broken fetch / unknown ref
// would silently disable the guard instead of failing loud.
const ABSENT_AT_REF_PATTERN =
  /does not exist|exists on disk, but not in|unknown revision/;

function runGit(args) {
  return execFileSync("git", args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// True when a `git show <ref>:<path>` failure means "the file doesn't exist at that
// ref" rather than a real problem (missing ref, broken repo, no fetch). Pulled out as
// its own function so the classification is unit-testable without invoking git.
export function isLockAbsentAtRefError(stderrText) {
  return ABSENT_AT_REF_PATTERN.test(stderrText);
}

// The only function in this file that touches git for real. Every caller reaches it
// through the injectable `readLock` parameter of checkAssetVersionBump(), so tests
// exercise the enforcement logic with canned data and never need a real git repo.
function readLockAtRefUsingGit(ref) {
  let raw;
  try {
    raw = runGit(["show", `${ref}:${ASSET_VERSION_LOCK_FILE}`]);
  } catch (error) {
    const stderr = String(error.stderr ?? "");
    if (isLockAbsentAtRefError(stderr)) {
      return null;
    }
    throw new Error(
      `Could not read ${ASSET_VERSION_LOCK_FILE} at ${ref}: ${stderr.trim() || error.message}`,
      { cause: error },
    );
  }
  return parseAssetVersionLock(raw, `${ref}:${ASSET_VERSION_LOCK_FILE}`);
}

// The base branch to diff against, derived from the GitHub Actions pull_request
// context. GITHUB_BASE_REF is only set for pull_request events, so a push (main
// itself, or any other non-PR trigger) has no PR base to compare against and the
// check is skipped there: the PR that introduced each change already gated it, and by
// the time it lands on main, origin/<base> and HEAD are the same commit anyway. The
// workflow's checkout step fetches full history (see .github/workflows/ci.yml), so
// origin/<base> is available as a local remote-tracking ref without an extra fetch.
export function resolveBaseRef(env = process.env) {
  const baseBranch = env.GITHUB_BASE_REF;
  if (!baseBranch) {
    return null;
  }
  return `origin/${baseBranch}`;
}

// The check itself. Every collaborator (git access, asset fingerprinting, token read)
// is an injectable seam defaulting to the real implementation, so tests can drive all
// three required outcomes (bumped, not bumped, unchanged) against canned baseline/
// current data without a real git repo or filesystem. JSDoc-typed (rather than left
// to plain-JS inference) so the .ts test file that imports this gets an accurate
// `baseRef: string | null` and a `readLock` return type that includes `null` — both
// of which plain inference from the defaults alone gets wrong.
/**
 * @param {object} [options]
 * @param {string | null} [options.baseRef]
 * @param {(ref: string) => ({ token: string, assets: Record<string, string> } | null)} [options.readLock]
 * @param {() => Record<string, string>} [options.computeFingerprint]
 * @param {() => string} [options.readToken]
 * @returns {{ skipped: boolean, reason?: string, baseRef?: string }}
 */
export function checkAssetVersionBump({
  baseRef = null,
  readLock = readLockAtRefUsingGit,
  computeFingerprint = fingerprintAssets,
  readToken = readAssetCacheBustToken,
} = {}) {
  if (!baseRef) {
    return { skipped: true, reason: "no base ref (not a pull request)" };
  }
  const baseLock = readLock(baseRef);
  const fingerprint = computeFingerprint();
  const token = readToken();
  assertTokenBumpedForChangedAssets(baseLock, token, fingerprint);
  return { skipped: false, baseRef };
}

// Only run as a side effect when invoked directly (`node scripts/check-asset-version-
// bump.mjs` / `npm run check:asset-version-bump`), not when imported for its tests.
// argv1 is realpath'd before comparing so invoking through a symlinked path (a `/tmp`
// that is itself a symlink, as on macOS) still resolves to the same URL Node computed
// for this module — see the identical concern documented in
// scripts/regenerate-asset-version-lock.mjs, which this duplicates in miniature
// rather than sharing an import, so each CLI script stays independently readable.
function isMainModule(argv1 = process.argv[1]) {
  if (argv1 == null) {
    return false;
  }
  return import.meta.url === pathToFileURL(realpathSync(argv1)).href;
}

if (isMainModule()) {
  try {
    const result = checkAssetVersionBump({ baseRef: resolveBaseRef() });
    if (result.skipped) {
      console.log(`Skipping asset-version bump check: ${result.reason}.`);
    } else {
      console.log(
        `Asset-version token bump check passed against ${result.baseRef}.`,
      );
    }
  } catch (error) {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exit(1);
  }
}
