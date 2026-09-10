import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// This module sits at the repo root; every path below resolves from here so the test
// (run by vitest) and the regen script (run by node) agree on one project root no
// matter which directory they were launched from.
export const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

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
// with no ?v= at all gets one appended, not just an existing one rewritten. Captures
// through the extension (group 1) so the replacement can restore everything up to
// that point ahead of the new token and the closing quote. Matches any run of
// characters after "?v=" up to the next "&", "#", or the closing quote (not the
// token grammar itself) so a malformed existing token — a wrong digit count, a
// dangling "-" with no revision, stray letters — gets replaced wholesale with the
// valid live token instead of partially overwritten or silently left in place. The
// "&"/"#" boundary keeps this from swallowing an unrelated trailing query param
// (e.g. "?v=20260101&size=2x") that isn't part of the cache-bust token at all.
const MANIFEST_TOKEN_PATTERN =
  /("src"\s*:\s*"[^"]*\.(?:png|jpe?g|svg|ico|webp|avif))(?:\?v=[^"&#]*)?"/g;

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
  return manifestSource.replace(MANIFEST_TOKEN_PATTERN, `$1${token}"`);
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
    return path in previousAssets && previousAssets[path] !== nextAssets[path];
  });
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

// The core guard: if any existing asset's bytes moved, the shared token must move
// *forward*, or a year-long immutable cache keeps serving stale bytes behind an
// unchanged URL. The token is a YYYYMMDD date with an optional same-day -N revision
// suffix, so a parsed comparison (date, then revision) enforces monotonicity and
// rejects a same-token no-op and an accidental downgrade alike — including a
// same-day revision downgrade a plain string comparison would miss. Pure so both the
// regen script and the tests exercise the exact enforcement logic.
export function assertTokenBumpedForChangedAssets(
  previousLock,
  token,
  fingerprint,
) {
  if (!previousLock) {
    return;
  }
  const changed = changedAssetPaths(previousLock.assets, fingerprint);
  if (changed.length === 0) {
    return;
  }
  if (compareAssetCacheBustTokens(token, previousLock.token) > 0) {
    return;
  }
  throw new Error(
    `Asset bytes changed (${changed.join(", ")}) but ASSET_CACHE_BUST (${token}) is not newer ` +
      `than the locked ${previousLock.token}. Bump the token in ${ASSET_CACHE_BUST_SOURCE} before ` +
      `regenerating the lock so the ?v= query moves forward with the content.`,
  );
}
