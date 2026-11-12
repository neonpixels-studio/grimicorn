import {
  ASSET_VERSION_LOCK_FILE,
  assertTokenBumpedForChangedAssets,
  fingerprintAssets,
  parseAssetVersionLock,
  readAssetCacheBustToken,
  runGit,
} from "../asset-version-manifest.mjs";
import { isMainModule } from "./is-main-module.mjs";

// scripts/regenerate-asset-version-lock.mjs already guards a *local* run: it compares
// the working tree against the lock committed at the developer's own HEAD before they
// commit. That check cannot catch a lock that was hand-edited (or regenerated without
// first bumping the token) *inside* the PR itself, because by the time CI runs, HEAD
// already is the commit carrying the tampered lock — there is no earlier commit left
// in the PR's own history to diff against. This script closes that gap by comparing
// against the PR's base branch instead, which the PR cannot rewrite.
//
// It diffs against the *merge base* with the base branch, not the base branch's
// current tip: a pull_request checkout builds a merge commit against main as it was
// when the job started, but fetch-depth: 0 always fetches main's *current* tip. If
// main gains its own asset bump while this PR is open (or the job is re-run later),
// comparing against the live tip would blame this PR for a change it never made. The
// merge base is fixed to what main actually was at the point this PR forked/merged,
// so only assets this PR itself touched are considered.
//
// GITHUB_BASE_REF (and therefore a base ref to compare against) is only set for
// pull_request events, so a direct push to main has nothing to diff and is skipped —
// this is a base-branch bump *gate for PRs*, matching branch protection that requires
// changes to land through one.

// A base ref with no committed lock (a brand-new repo, or a base branch that predates
// the lock file) has nothing to diff against — same "first lock" allowance
// scripts/regenerate-asset-version-lock.mjs grants at ABSENT_FROM_HEAD_PATTERN.
// Anchored to git's actual "path at ref" message shape (not a loose substring match)
// so an unrelated failure isn't misclassified as a missing lock either way. Relies on
// the shared runGit() (asset-version-manifest.mjs) pinning LC_ALL=C, since git's fatal
// messages go through gettext and would otherwise translate under a non-English git.
const ABSENT_AT_REF_PATTERN =
  /^fatal: path '.+' (?:does not exist in|exists on disk, but not in) '.+'/m;

// True when a `git show <ref>:<path>` failure means "the file doesn't exist at that
// ref" rather than a real problem. Unit-testable without invoking git.
export function isLockAbsentAtRefError(stderrText) {
  return ABSENT_AT_REF_PATTERN.test(stderrText);
}

// Runs `git show <ref>:<lock path>`, returning the raw text, null when the lock is
// absent at that ref, or throwing for any other git failure. `runGitCommand` is an
// injectable seam (defaulting to the real `runGit`) so both branches of the catch are
// unit-testable without invoking git.
export function readLockTextAtRef(ref, runGitCommand = runGit) {
  try {
    return runGitCommand(["show", `${ref}:${ASSET_VERSION_LOCK_FILE}`]);
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
}

// The only function in this file that touches git for real to read the lock. Reached
// through the injectable `readLock` parameter of checkAssetVersionBump(), so tests
// exercise the enforcement logic with canned data and never need a real git repo.
function readLockAtRefUsingGit(ref) {
  const raw = readLockTextAtRef(ref);
  if (raw === null) {
    return null;
  }
  return parseAssetVersionLock(raw, `${ref}:${ASSET_VERSION_LOCK_FILE}`);
}

// The commit both `headRef` and `baseRef` descend from — see the module comment for
// why the merge base, not the base branch's live tip, is the correct comparison point.
function findMergeBaseUsingGit(baseRef, headRef = "HEAD") {
  return runGit(["merge-base", headRef, baseRef]).trim();
}

// The base branch to diff against, derived from the GitHub Actions pull_request
// context. GITHUB_BASE_REF is only set for pull_request events; see the module
// comment for why a push (main itself, or any other non-PR trigger) is skipped.
export function resolveBaseRef(env = process.env) {
  const baseBranch = env.GITHUB_BASE_REF;
  if (!baseBranch) {
    return null;
  }
  return `origin/${baseBranch}`;
}

// The check itself. Every collaborator (git access, asset fingerprinting, token read)
// is an injectable seam defaulting to the real implementation, so tests can drive all
// three required outcomes (bumped, not bumped, unchanged) against canned data without
// a real git repo or filesystem.
/**
 * @param {object} [options]
 * @param {string | null} [options.baseRef]
 * @param {(baseRef: string, headRef?: string) => string} [options.findMergeBase]
 * @param {(ref: string) => ({ token: string, assets: Record<string, string> } | null)} [options.readLock]
 * @param {() => Record<string, string>} [options.computeFingerprint]
 * @param {() => string} [options.readToken]
 * @returns {{ skipped: boolean, reason?: string, comparedRef?: string }}
 */
export function checkAssetVersionBump({
  baseRef = null,
  findMergeBase = findMergeBaseUsingGit,
  readLock = readLockAtRefUsingGit,
  computeFingerprint = fingerprintAssets,
  readToken = readAssetCacheBustToken,
} = {}) {
  if (!baseRef) {
    return { skipped: true, reason: "no base ref (not a pull request)" };
  }
  const comparedRef = findMergeBase(baseRef);
  if (!comparedRef) {
    // Guards against `readLock(undefined)` resolving to `git show :<path>` — a bare
    // `:path` reads the index, not a commit, which in CI matches HEAD and would make
    // the gate silently compare the PR against itself instead of failing loud.
    throw new Error(
      `Could not resolve a merge base between HEAD and ${baseRef}.`,
    );
  }
  const baseLock = readLock(comparedRef);
  const fingerprint = computeFingerprint();
  const token = readToken();
  assertTokenBumpedForChangedAssets(baseLock, token, fingerprint);
  return { skipped: false, comparedRef };
}

function formatResultMessage(result) {
  if (result.skipped) {
    return `Skipping asset-version bump check: ${result.reason}.`;
  }
  return `Asset-version token bump check passed against ${result.comparedRef}.`;
}

function main() {
  const result = checkAssetVersionBump({ baseRef: resolveBaseRef() });
  console.log(formatResultMessage(result));
}

if (isMainModule(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exit(1);
  }
}
