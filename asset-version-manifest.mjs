import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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

const HASH_ALGORITHM = "sha256";
const TOKEN_PATTERN = /^export const ASSET_CACHE_BUST\s*=\s*"(\?v=\d{8})"/m;
// The canonical token grammar: ?v= plus a YYYYMMDD date. Kept in sync with the
// existing invariant in asset-cache-bust.test.ts. Used to reject a corrupted committed
// token (e.g. "" or "?v=9") that would otherwise silently disable the monotonic guard.
const TOKEN_VALUE_PATTERN = /^\?v=\d{8}$/;

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
// script agree on one value without a second literal to keep in sync.
export function readAssetCacheBustToken() {
  const source = readFileSync(
    resolve(PROJECT_ROOT, ASSET_CACHE_BUST_SOURCE),
    "utf8",
  );
  const match = source.match(TOKEN_PATTERN);
  if (!match) {
    throw new Error(
      `Could not find an ASSET_CACHE_BUST "?v=" token in ${ASSET_CACHE_BUST_SOURCE}.`,
    );
  }
  return match[1];
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
    TOKEN_VALUE_PATTERN.test(lock.token);
  const hasAssets =
    isObject && typeof lock.assets === "object" && lock.assets !== null;
  if (!hasToken || !hasAssets) {
    throw new Error(
      `${sourceLabel} is missing a valid "token" (${TOKEN_VALUE_PATTERN}) or "assets". Regenerate with \`npm run lock:assets\`.`,
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

// The core guard: if any existing asset's bytes moved, the shared token must move
// *forward*, or a year-long immutable cache keeps serving stale bytes behind an
// unchanged URL. The token is a YYYYMMDD date, so a plain string comparison enforces
// monotonicity and rejects a same-token no-op and an accidental downgrade alike. Pure
// so both the regen script and the tests exercise the exact enforcement logic.
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
  if (token > previousLock.token) {
    return;
  }
  throw new Error(
    `Asset bytes changed (${changed.join(", ")}) but ASSET_CACHE_BUST (${token}) is not newer ` +
      `than the locked ${previousLock.token}. Bump the token in ${ASSET_CACHE_BUST_SOURCE} before ` +
      `regenerating the lock so the ?v= query moves forward with the content.`,
  );
}
