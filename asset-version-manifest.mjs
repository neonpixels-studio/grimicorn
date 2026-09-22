import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// This module sits at the repo root; every path below resolves from here so the test
// (run by vitest) and the regen script (run by node) agree on one project root no
// matter which directory they were launched from.
export const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

// The one seam every script that shells out to git goes through (scripts/regenerate-
// asset-version-lock.mjs and scripts/check-asset-version-bump.mjs both read a lock at
// a ref via `git show`). LC_ALL=C is required, not cosmetic: both callers classify
// failures by pattern-matching git's `fatal:` stderr text, which goes through gettext
// — an unpinned locale would translate that text under a non-English git/OS and break
// the "lock absent at this ref" vs. "real git failure" classification silently.
export function runGit(args) {
  return execFileSync("git", args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LC_ALL: "C" },
  });
}

function temporaryPathFor(filePath) {
  return `${filePath}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`;
}

// ENOENT means the temp file was never created (writeFileSync/fsyncSync failed
// before it existed) — nothing to clean up. Any other error removing it is logged,
// not swallowed, so a stuck leftover temp file is never silent.
function removeTemporaryFileIfPresent(temporaryPath) {
  try {
    unlinkSync(temporaryPath);
  } catch (cleanupError) {
    if (cleanupError.code === "ENOENT") {
      return;
    }
    console.error(
      `Failed to remove leftover temp file ${temporaryPath}: ${cleanupError.message}`,
    );
  }
}

// Writes `contents` to a sibling temp file, fsyncs it so the bytes are actually on
// disk (not just buffered), then renames it over `filePath`. The rename is the one
// step that touches `filePath` at all, and a rename is a single atomic filesystem
// operation, so a process kill or disk-full error at any point before it leaves
// `filePath` completely untouched — never truncated or half-written. The fsync
// closes the gap a bare write-then-rename still has under an OS crash or power
// loss: without it, the rename can reach disk before the temp file's data does,
// and a fresh mount could then show the renamed file as empty. This does not (and
// cannot) protect against the file being hand-edited or deleted after the fact.
function writeFileDurably(temporaryPath, contents) {
  const fileDescriptor = openSync(temporaryPath, "w");
  try {
    writeSync(fileDescriptor, contents);
    fsyncSync(fileDescriptor);
  } finally {
    closeSync(fileDescriptor);
  }
}

// Writes `contents` to `filePath` without ever leaving a truncated/partial file in
// its place, even if the write is interrupted. The temp file is created in the same
// directory as `filePath` (never os.tmpdir()) specifically so the rename is a
// same-filesystem rename — a cross-filesystem rename is not atomic. Readers of
// `filePath` never see anything mid-write: either the previous complete contents,
// or the new complete contents, never a partial mix of the two.
export function atomicWriteFileSync(filePath, contents) {
  const temporaryPath = temporaryPathFor(filePath);
  try {
    writeFileDurably(temporaryPath, contents);
    renameSync(temporaryPath, filePath);
  } catch (error) {
    removeTemporaryFileIfPresent(temporaryPath);
    throw error;
  }
}

// Every static asset whose cache-bust ?v= is the shared ASSET_CACHE_BUST token
// (.vitepress/asset-cache-bust.ts). All of these live under a year-long immutable
// cache (see /assets/* and /images/* in netlify.toml), so a byte change behind the
// stable URL only reaches returning visitors if the token bumps. The lockfile
// (asset-version-lock.json) plus the invariant test enforce that. Favicons and fonts
// carry their own independent ?v= tokens and are deliberately outside this set; the
// web-app-manifest icons are NOT — their ?v= is a copy of this shared token.
export const VERSIONED_ASSET_FILES = [
  "public/assets/grimicorn-hero.avif",
  "public/assets/grimicorn-hero.webp",
  "public/assets/grimicorn-hero.png",
  "public/assets/grimicorn-head.avif",
  "public/assets/grimicorn-head.webp",
  "public/assets/grimicorn-head.png",
  "public/assets/grimicorn-og.png",
  "public/images/site.webmanifest",
  "public/images/web-app-manifest-192x192.png",
  "public/images/web-app-manifest-512x512.png",
];

export const ASSET_VERSION_LOCK_FILE = ".vitepress/asset-version-lock.json";
export const ASSET_CACHE_BUST_SOURCE = ".vitepress/asset-cache-bust.ts";
// The manifest is the one versioned asset whose ?v= tokens live inside the file's own
// bytes rather than being appended by withAssetCacheBust() at render time (it is
// static JSON, not code), so nothing rewrites its icon srcs when the shared token
// bumps unless something does it explicitly. See syncManifestCacheBustTokens() below.
export const SITE_WEBMANIFEST_FILE = "public/images/site.webmanifest";

const HASH_ALGORITHM = "sha256";
// Loosely captures whatever literal string follows the assignment (any run of
// non-quote characters), rather than embedding the strict token grammar itself. A
// malformed value ("?v=20260823-1", a dropped digit) still matches this pattern and
// reaches parseAssetCacheBustToken() in readAssetCacheBustToken() below, which raises
// a precise "Malformed" error — encoding the grammar here too would instead make a
// bad value silently fail to match, producing a misleading "could not find a token"
// error that points at a healthy export.
const TOKEN_PATTERN = /^export const ASSET_CACHE_BUST\s*=\s*"([^"]*)"/m;
// The canonical token grammar, built once from shared fragments so there is exactly
// one pattern (below) that both validates a token and parses its date/revision — a
// change to the date or revision shape only has one place to edit.
const TOKEN_DATE_PATTERN_SOURCE = String.raw`\d{8}`;
// A same-day revision suffix: 2-9 as a single digit, or a leading-nonzero multi-digit
// number (10, 11, ...). Both branches are anchored by the pattern's trailing "$", so
// which is tried first doesn't change what matches — this is a plain alternation, not
// an ordering-sensitive one. The day's first revision is the bare token with no
// suffix at all, so 0 and 1 are excluded — otherwise "?v=20260823", "?v=20260823-1"
// and "?v=20260823-01" would all mean the same revision with three valid spellings,
// and a stray leading zero (e.g. "-02" vs the locked "-2") would parse as a no-op
// bump and get rejected by assertTokenBumpedForChangedAssets with a confusing
// "not newer".
const TOKEN_REVISION_PATTERN_SOURCE = String.raw`[2-9]|[1-9]\d+`;
// Splits a token into its date and revision, and — via .test() — validates a
// standalone token string (e.g. "" or "?v=9" or "?v=20260823-01"). One pattern serves
// both jobs so a tightened grammar can't validate a token that then fails to parse
// (or vice versa). A bare date (no suffix) is the day's implicit first revision, so
// DEFAULT_TOKEN_REVISION fills in when the suffix is absent.
const TOKEN_DATE_AND_REVISION_PATTERN = new RegExp(
  `^\\?v=(${TOKEN_DATE_PATTERN_SOURCE})(?:-(${TOKEN_REVISION_PATTERN_SOURCE}))?$`,
);
const DEFAULT_TOKEN_REVISION = 1;
// Matches a JSON "src" value that ends in an image-asset extension, with an optional
// existing ?v= query — an icon src (current usage), or a future manifest image
// member (a screenshot, a shortcut icon) that carries the same cache-bust
// convention. Scoped to the "src" key specifically (not any string in the file) so
// the sync can never rewrite an unrelated URL query, e.g. a "start_url" or "scope"
// version marker. The query is optional (`(?:\?v=[^"&#]*)?`) so a newly added icon
// with no ?v= at all gets one appended, not just an existing one rewritten. Two
// capture groups — the "src":" key prefix (group 1) and the src's path up to the
// extension (group 2) — so the replace() callback in syncManifestCacheBustTokens()
// below can both rebuild the match and record exactly which src (path only, no key
// noise) it rewrote. Matches any run of characters after "?v=" up to the next "&",
// "#", or the closing quote (not the token grammar itself) so a malformed existing
// token — a wrong digit count, a dangling "-" with no revision, stray letters — gets
// replaced wholesale with the valid live token instead of partially overwritten or
// silently left in place. The "&"/"#" boundary keeps this from swallowing an
// unrelated trailing query param (e.g. "?v=20260101&size=2x") that isn't part of the
// cache-bust token at all.
const MANIFEST_TOKEN_PATTERN =
  /("src"\s*:\s*")([^"]*\.(?:png|jpe?g|svg|ico|webp|avif))(?:\?v=[^"&#]*)?"/g;
// Enumerates every "src" value in the manifest regardless of shape, so
// assertEverySrcSynced() below can verify the rewrite's own output rather than
// re-deriving which shapes it accepts — a second pattern describing "what
// MANIFEST_TOKEN_PATTERN matches" would inevitably drift from MANIFEST_TOKEN_PATTERN
// itself (edit one, forget the other) and reopen exactly the silent-skip bug this
// guard exists to close.
const MANIFEST_SRC_KEY_PATTERN = /"src"\s*:\s*"([^"]*)"/g;
// A src that is legitimately out of scope for this cache-bust: a data: URI carries
// its bytes inline in the manifest (no separate cached URL to invalidate, so
// appending "?v=" would corrupt the base64 payload instead of doing anything
// useful), and an absolute or protocol-relative cross-origin URL (e.g. a CDN-hosted
// screenshot) isn't a same-origin asset this repo's immutable-cache rule applies to.
// Checked inside the rewrite callback itself (not just the post-rewrite audit) so an
// exempt src is left completely untouched rather than still getting a token
// appended.
const EXEMPT_FROM_TOKEN_SRC_PATTERN = /^(?:data:|\/\/|[a-z][a-z0-9+.-]*:\/\/)/i;

export function hashAssetBytes(bytes) {
  return createHash(HASH_ALGORITHM).update(bytes).digest("hex");
}

function hashAssetFile(relativePath) {
  const absolutePath = resolve(PROJECT_ROOT, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(
      `${relativePath} is listed in VERSIONED_ASSET_FILES but does not exist on disk.`,
    );
  }
  return hashAssetBytes(readFileSync(absolutePath));
}

// Map every versioned asset to the hash of its current bytes on disk. This is the
// fingerprint the lockfile records and the invariant test recomputes to detect drift.
export function fingerprintAssets() {
  const fingerprint = {};
  for (const relativePath of VERSIONED_ASSET_FILES) {
    fingerprint[relativePath] = hashAssetFile(relativePath);
  }
  return fingerprint;
}

// Read the live ?v= token straight from its source module so the test and the regen
// script agree on one value without a second literal to keep in sync. sourcePath
// defaults to the real project file; tests pass a fixture path instead so exercising
// the parse (including a suffixed token) doesn't depend on editing the committed
// asset-cache-bust.ts. Validates the extracted value through parseAssetCacheBustToken
// so a malformed suffix (e.g. "?v=20260823-1") raises that function's precise
// "Malformed" error, rather than TOKEN_PATTERN itself silently failing to match and
// misreporting a healthy export as missing entirely.
export function readAssetCacheBustToken(
  sourcePath = resolve(PROJECT_ROOT, ASSET_CACHE_BUST_SOURCE),
) {
  const source = readFileSync(sourcePath, "utf8");
  const match = source.match(TOKEN_PATTERN);
  if (!match) {
    throw new Error(
      `Could not find an ASSET_CACHE_BUST "?v=" token in ${sourcePath}.`,
    );
  }
  parseAssetCacheBustToken(match[1]);
  return match[1];
}

// Confirms every "src" in the rewrite's own output was actually reached by it —
// either freshly token-stamped (present in `rewrittenSrcs`) or deliberately exempt.
// Checking membership in the set the rewrite callback itself populated (rather than
// re-testing the resulting string's shape, e.g. "does it end with the token") can't
// be fooled by a src the rewrite never touched whose stale, unrelated query happens
// to already end in a string that matches today's live token.
function assertEverySrcSynced(syncedManifestSource, rewrittenSrcs) {
  const unsyncedSrcs = [
    ...syncedManifestSource.matchAll(MANIFEST_SRC_KEY_PATTERN),
  ]
    .map((match) => match[1])
    .filter(
      (src) =>
        !EXEMPT_FROM_TOKEN_SRC_PATTERN.test(src) && !rewrittenSrcs.has(src),
    );
  if (unsyncedSrcs.length === 0) {
    return;
  }
  throw new Error(
    `Cannot sync ${SITE_WEBMANIFEST_FILE}: "src" value(s) ${unsyncedSrcs.map((src) => JSON.stringify(src)).join(", ")} weren't reached by the rewrite — MANIFEST_TOKEN_PATTERN doesn't recognize this src shape (unrecognized extension or an unexpected query string). Fix the src or extend MANIFEST_TOKEN_PATTERN in asset-version-manifest.mjs before syncing, or it will silently drift stale behind the immutable asset cache.`,
  );
}

// Rewrites (or adds) the ?v= query on every image "src" in manifest JSON source to
// the live token. Pure string logic (no file I/O) so the regen script and its test
// exercise identical rewrite behaviour regardless of how the result gets persisted.
// This is the only code path that writes into a committed asset on a caller-supplied
// token, so it validates the token against the same grammar the lock format enforces
// elsewhere (TOKEN_DATE_AND_REVISION_PATTERN) rather than trusting the caller — an
// empty or malformed token would otherwise strip or corrupt every icon src in the file.
export function syncManifestCacheBustTokens(manifestSource, token) {
  if (!TOKEN_DATE_AND_REVISION_PATTERN.test(token)) {
    throw new Error(
      `Refusing to sync ${SITE_WEBMANIFEST_FILE} with a malformed token: ${JSON.stringify(token)}. Expected ${TOKEN_DATE_AND_REVISION_PATTERN}.`,
    );
  }
  const rewrittenSrcs = new Set();
  const synced = manifestSource.replace(
    MANIFEST_TOKEN_PATTERN,
    (fullMatch, srcKeyPrefix, srcPath) => {
      if (EXEMPT_FROM_TOKEN_SRC_PATTERN.test(srcPath)) {
        return fullMatch;
      }
      rewrittenSrcs.add(`${srcPath}${token}`);
      return `${srcKeyPrefix}${srcPath}${token}"`;
    },
  );
  assertEverySrcSynced(synced, rewrittenSrcs);
  return synced;
}

// Applies syncManifestCacheBustTokens() to the manifest on disk, writing back only when
// the token actually moved. Called before fingerprintAssets() so a token bump alone
// (without hand-editing the JSON) keeps the manifest's icon srcs — and the hash the
// lockfile records for them — in sync with every other versioned asset reference.
// manifestPath defaults to the real project file; tests pass a fixture path instead
// so exercising the write doesn't touch the committed manifest. Returns the pre-sync
// bytes (whether or not a write happened) so a caller that wants to roll back a
// failed regen can use this return value as its snapshot instead of reading the file
// a second time.
export function syncWebManifestCacheBustTokensOnDisk(
  token,
  manifestPath = resolve(PROJECT_ROOT, SITE_WEBMANIFEST_FILE),
) {
  if (!existsSync(manifestPath)) {
    throw new Error(`Web app manifest is missing: ${manifestPath}.`);
  }
  const original = readFileSync(manifestPath, "utf8");
  const synced = syncManifestCacheBustTokens(original, token);
  if (synced !== original) {
    writeFileSync(manifestPath, synced);
  }
  return original;
}

// Parse and shape-check raw lock JSON. Shared so both the working-tree read and the
// regen script's git-baseline read validate a lock the same way. `sourceLabel` names
// the origin in errors (a file path, or `HEAD:<path>` for the committed copy).
export function parseAssetVersionLock(raw, sourceLabel) {
  let lock;
  try {
    lock = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${sourceLabel} is not valid JSON: ${error.message}. Regenerate with \`npm run lock:assets\`.`,
      { cause: error },
    );
  }
  const isObject = typeof lock === "object" && lock !== null;
  const hasToken =
    isObject &&
    typeof lock.token === "string" &&
    TOKEN_DATE_AND_REVISION_PATTERN.test(lock.token);
  const hasAssets =
    isObject && typeof lock.assets === "object" && lock.assets !== null;
  if (!hasToken || !hasAssets) {
    throw new Error(
      `${sourceLabel} is missing a valid "token" (${TOKEN_DATE_AND_REVISION_PATTERN}) or "assets". Regenerate with \`npm run lock:assets\`.`,
    );
  }
  return lock;
}

export function readAssetVersionLock() {
  const lockPath = resolve(PROJECT_ROOT, ASSET_VERSION_LOCK_FILE);
  let raw;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch (error) {
    throw new Error(
      `${ASSET_VERSION_LOCK_FILE} is unreadable: ${error.message}. Regenerate with \`npm run lock:assets\`.`,
      { cause: error },
    );
  }
  return parseAssetVersionLock(raw, ASSET_VERSION_LOCK_FILE);
}

// Existing assets whose bytes changed since the lock was written. A newly tracked
// asset (present now, absent from the old lock) is not "changed" — it has no cached
// copies to invalidate — so it never forces a token bump on its own.
export function changedAssetPaths(previousAssets, nextAssets) {
  return Object.keys(nextAssets).filter((path) => {
    return (
      Object.hasOwn(previousAssets, path) &&
      previousAssets[path] !== nextAssets[path]
    );
  });
}

// Assets the base lock tracked that the current fingerprint no longer has an entry
// for — i.e. their path was removed from VERSIONED_ASSET_FILES. changedAssetPaths()
// alone can't see this: it only walks nextAssets' keys, so a path changed and then
// dropped from VERSIONED_ASSET_FILES in the same PR vanishes from the fingerprint
// entirely and never gets compared. Flagging every drop (not only a provably changed
// one) is a deliberate cost/benefit call, not the only possible fix: once a path stops
// being fingerprinted there is no cheap way to tell whether it also changed, so this
// errs toward a false-positive token bump (churning the shared cache for a plain
// asset removal) over the false negative of a changed-then-dropped asset slipping
// through unbumped.
export function droppedAssetPaths(previousAssets, nextAssets) {
  return Object.keys(previousAssets).filter(
    (path) => !Object.hasOwn(nextAssets, path),
  );
}

// Splits a token into its date and revision for comparison. A bare token (no -N
// suffix) is the day's implicit first revision (DEFAULT_TOKEN_REVISION); an explicit
// "-1" (or "-0") is rejected as malformed, since TOKEN_REVISION_PATTERN_SOURCE starts
// at 2 — the bare token is the only valid spelling of the first revision. Throws on a
// malformed token rather than comparing garbage, mirroring the other
// TOKEN_DATE_AND_REVISION_PATTERN guards in this module.
export function parseAssetCacheBustToken(token) {
  const match = TOKEN_DATE_AND_REVISION_PATTERN.exec(token);
  if (!match) {
    throw new Error(
      `Malformed asset cache-bust token: ${JSON.stringify(token)}. Expected ${TOKEN_DATE_AND_REVISION_PATTERN}.`,
    );
  }
  const [, date, revisionSuffix] = match;
  const revision =
    revisionSuffix === undefined
      ? DEFAULT_TOKEN_REVISION
      : Number(revisionSuffix);
  return { date, revision };
}

// Orders two tokens by date first, then by same-day revision — never by comparing
// the raw strings. A plain string comparison breaks across a two-digit revision
// ("?v=20260823-10" sorts *before* "?v=20260823-2" lexicographically, since "1" < "2"),
// which would let a real regression through. Returns <0, 0, or >0 like a standard
// comparator. Pure so both the regen script and the tests exercise the exact
// enforcement logic.
export function compareAssetCacheBustTokens(tokenA, tokenB) {
  const parsedA = parseAssetCacheBustToken(tokenA);
  const parsedB = parseAssetCacheBustToken(tokenB);
  if (parsedA.date !== parsedB.date) {
    return parsedA.date < parsedB.date ? -1 : 1;
  }
  return parsedA.revision - parsedB.revision;
}

// Builds the human-readable reason clause for a failed bump check, plus a
// drop-specific explanation when any asset was dropped: unlike a proven byte change,
// a drop's remedy ("bump the token") is not self-evident from "the content changed",
// since by definition nothing is left to prove the content did or didn't change.
// Separated from assertTokenBumpedForChangedAssets() so the guard itself stays a
// plain detect/compare/throw and this formatting can be read (and extended) on its own.
function describeBumpFailure(changed, dropped) {
  const reasons = [];
  if (changed.length > 0) {
    reasons.push(`bytes changed (${changed.join(", ")})`);
  }
  if (dropped.length > 0) {
    reasons.push(`dropped from VERSIONED_ASSET_FILES (${dropped.join(", ")})`);
  }
  const droppedClause =
    dropped.length > 0
      ? " Removing a path from VERSIONED_ASSET_FILES retires its fingerprint, so " +
        "nothing can prove its bytes are unchanged; bump the token or restore the path."
      : "";
  return { reasonClause: reasons.join(" and "), droppedClause };
}

// The core guard: if any existing asset's bytes moved, or an asset the lock tracked
// dropped out of the fingerprint entirely (removed from VERSIONED_ASSET_FILES — see
// droppedAssetPaths() above), the shared token must move *forward*, or a year-long
// immutable cache keeps serving stale bytes behind an unchanged URL. The token is a
// YYYYMMDD date with an optional same-day -N revision suffix, so a parsed comparison
// (date, then revision) enforces monotonicity and rejects a same-token no-op and an
// accidental downgrade alike — including a same-day revision downgrade a plain string
// comparison would miss. Pure so both the regen script and the tests exercise the
// exact enforcement logic.
export function assertTokenBumpedForChangedAssets(
  previousLock,
  token,
  fingerprint,
) {
  if (!previousLock) {
    return;
  }
  const changed = changedAssetPaths(previousLock.assets, fingerprint);
  const dropped = droppedAssetPaths(previousLock.assets, fingerprint);
  if (changed.length === 0 && dropped.length === 0) {
    return;
  }
  if (compareAssetCacheBustTokens(token, previousLock.token) > 0) {
    return;
  }
  const { reasonClause, droppedClause } = describeBumpFailure(changed, dropped);
  throw new Error(
    `Asset ${reasonClause} but ASSET_CACHE_BUST (${token}) is not newer ` +
      `than the locked ${previousLock.token}. Bump the token in ${ASSET_CACHE_BUST_SOURCE} before ` +
      `regenerating the lock so the ?v= query moves forward with the content.${droppedClause}`,
  );
}
