import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { mount, type VueWrapper } from "@vue/test-utils";

import config from "../config";
import GrimicornPage from "@components/GrimicornPage.vue";

const PUBLIC_DIR = resolve(process.cwd(), "public");

// The public roots served with a one-year `immutable` Cache-Control (see the
// /assets/* and /images/* [[headers]] blocks in netlify.toml). Each file is frozen
// at its URL for a year, so every reference must carry a ?v= version query to force
// a refetch when the bytes behind that stable URL actually change. This test turns
// that prose assumption into an enforced guard.
const IMMUTABLE_ASSET_DIRS = ["assets", "images"];

// The web app manifest lives under /images and lists its own icon srcs, which are
// immutable assets too, so it is scanned as a reference surface as well as an asset.
const MANIFEST_PATH = resolve(PUBLIC_DIR, "images/site.webmanifest");

// Theme stylesheets are a reference surface too: a background-image url(...) into an
// immutable root is a reference like any other. None exist today (grep-verified),
// but scanning them keeps a future one from silently escaping the version guard.
const THEME_DIR = resolve(PUBLIC_DIR, "..", ".vitepress/theme");

// One immutable-asset reference (path plus its own optional query) inside a larger
// string, e.g. "/assets/grimicorn-hero.avif?v=20260816" — including the one embedded
// in an absolute og:image URL. Built from IMMUTABLE_ASSET_DIRS so a new root can't be
// added to the list yet missed here. Global so a multi-URL string (a srcset, a
// JSON-LD blob, rendered markup) yields one reference per URL, not just the first,
// and the query travels with its own path so the version check can't be satisfied by
// an unrelated ?v= elsewhere in the string. The excluded characters bound each URL at
// the delimiters used by srcset (comma/space), HTML attributes (quotes/angles) and
// CSS url() (parens/backtick).
const ASSET_REFERENCE_PATTERN = new RegExp(
  `/(?:${IMMUTABLE_ASSET_DIRS.join("|")})/[^?#"'\\s,<>)\`]+(?:\\?[^#"'\\s,<>)\`]*)?`,
  "g",
);

// Captures the value of a non-empty version query, e.g. "20260816" from ?v=20260816.
// An empty ?v= would defeat the cache-bust, so the value is required.
const VERSION_QUERY_PATTERN = /[?&]v=([^&#\s"',)]+)/;

interface AssetReference {
  source: string;
  url: string;
  path: string;
}

// The version value of a reference, or "" when it carries none. Single source for
// the three checks (presence, and consistency across surfaces) so they can't drift.
function versionOf(reference: AssetReference): string {
  return reference.url.match(VERSION_QUERY_PATTERN)?.[1] ?? "";
}

function walkFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(entryPath);
    }
    return [entryPath];
  });
}

function toPublicUrlPath(filePath: string): string {
  return filePath.slice(PUBLIC_DIR.length).replace(/\\/g, "/");
}

// A file under an immutable root that can carry a versioned reference. Dotfiles (a
// macOS .DS_Store dropped into public/images) never can, so they are excluded rather
// than reported as unreferenced.
function isReferenceableAsset(urlPath: string): boolean {
  return !basename(urlPath).startsWith(".");
}

function listImmutableAssetUrlPaths(): string[] {
  return IMMUTABLE_ASSET_DIRS.flatMap((subDir) => {
    const dirPath = resolve(PUBLIC_DIR, subDir);
    if (!existsSync(dirPath)) {
      throw new Error(`Immutable asset dir is missing: ${dirPath}`);
    }
    return walkFiles(dirPath).map(toPublicUrlPath).filter(isReferenceableAsset);
  });
}

// A head entry is [tag, attributes?, innerText?]; collect every string value that
// could carry an asset URL (link/meta attributes plus inline JSON-LD text).
function headEntryStrings(
  entry: NonNullable<typeof config.head>[number],
): string[] {
  const [, attributes, innerText] = entry as [
    string,
    Record<string, string>?,
    string?,
  ];
  const attributeValues = attributes
    ? Object.values(attributes).filter((value) => typeof value === "string")
    : [];
  const innerValues = typeof innerText === "string" ? [innerText] : [];
  return [...attributeValues, ...innerValues];
}

function headReferenceStrings(): string[] {
  return (config.head ?? []).flatMap(headEntryStrings);
}

// A full mount renders child components too, so an asset reference stays covered even
// if the hero/portrait <picture> is later extracted into a child (shallowMount would
// stub it out and let that reference escape). Scanning the whole rendered markup
// rather than only img/source src|srcset also catches a background-image, poster, or
// any other rendered reference. The unmount and vi.useRealTimers() run in the finally
// so a throw here can't leave the component mounted or the suite on fake timers.
function componentReferenceStrings(): string[] {
  vi.useFakeTimers();
  let wrapper: VueWrapper | undefined;
  try {
    wrapper = mount(GrimicornPage);
    return [wrapper.html()];
  } finally {
    wrapper?.unmount();
    vi.useRealTimers();
  }
}

// Manifest icon srcs resolve relative to the manifest URL (/images/site.webmanifest).
// A bare or "./"-prefixed src points into /images/; an absolute URL is reduced to its
// pathname. Normalising to a root-absolute path means a relative or absolute
// unversioned icon is caught rather than silently dropped by the reference matcher.
function resolveManifestIconSrc(src: string): string {
  if (/^https?:\/\//.test(src)) {
    return new URL(src).pathname;
  }
  if (src.startsWith("/")) {
    return src;
  }
  return `/images/${src.replace(/^\.\//, "")}`;
}

function manifestReferenceStrings(): string[] {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Web app manifest is missing: ${MANIFEST_PATH}`);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  return icons
    .map((icon: { src?: unknown }) => icon.src)
    .filter((src: unknown): src is string => typeof src === "string")
    .map(resolveManifestIconSrc);
}

// Strip CSS block comments so a comment citing a path (like the ?v= reminder in
// fonts.css) is not mistaken for a resource the browser actually fetches.
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function themeStyleReferenceStrings(): string[] {
  return walkFiles(THEME_DIR)
    .filter((filePath) => filePath.endsWith(".css"))
    .map((filePath) => stripCssComments(readFileSync(filePath, "utf8")));
}

// One AssetReference per asset URL found in the strings. url is the matched URL (path
// plus its own query), so the version check applies to this asset alone; path is that
// URL without the query, for comparison against a file on disk.
function toAssetReferences(
  source: string,
  strings: string[],
): AssetReference[] {
  return strings.flatMap((text) =>
    [...text.matchAll(ASSET_REFERENCE_PATTERN)].map((match) => ({
      source,
      url: match[0],
      path: match[0].split("?")[0],
    })),
  );
}

function collectAssetReferences(): AssetReference[] {
  return [
    ...toAssetReferences("config head", headReferenceStrings()),
    ...toAssetReferences("GrimicornPage render", componentReferenceStrings()),
    ...toAssetReferences("theme stylesheet", themeStyleReferenceStrings()),
    ...toAssetReferences("site.webmanifest icons", manifestReferenceStrings()),
  ];
}

const immutableAssetUrlPaths = listImmutableAssetUrlPaths();
let assetReferences: AssetReference[];
let versionedAssetPaths: Set<string>;

beforeAll(() => {
  assetReferences = collectAssetReferences();
  versionedAssetPaths = new Set(
    assetReferences
      .filter((reference) => versionOf(reference) !== "")
      .map((reference) => reference.path),
  );
});

describe("immutable asset cache-bust invariant", () => {
  it("finds immutable asset files to check", () => {
    // A zero-length it.each below would report as passing and cover nothing.
    expect(immutableAssetUrlPaths.length).toBeGreaterThan(0);
  });

  it("finds asset references to check", () => {
    expect(assetReferences.length).toBeGreaterThan(0);
  });

  // The scanned surfaces (config head, the rendered page, theme stylesheets, the web
  // manifest) are the only ones that reference public assets. A new referencing
  // surface, or an immutable asset that nothing references, must fail here on purpose
  // — an unreferenced immutable file is dead weight, and a reference from an unscanned
  // surface would escape the version guard.
  it.each(immutableAssetUrlPaths)(
    "%s is referenced with a ?v= version query",
    (assetUrlPath) => {
      expect(versionedAssetPaths, assetUrlPath).toContain(assetUrlPath);
    },
  );

  it("carries a ?v= version query on every immutable asset reference", () => {
    const unversioned = assetReferences.filter(
      (reference) => versionOf(reference) === "",
    );
    const detail = unversioned
      .map((reference) => `${reference.source}: ${reference.url}`)
      .join("\n");
    expect(
      unversioned,
      `Unversioned immutable asset references:\n${detail}`,
    ).toEqual([]);
  });

  it("references only immutable assets that exist on disk", () => {
    const knownPaths = new Set(immutableAssetUrlPaths);
    const missing = assetReferences.filter(
      (reference) => !knownPaths.has(reference.path),
    );
    const detail = missing
      .map((reference) => `${reference.source}: ${reference.url}`)
      .join("\n");
    expect(missing, `References to missing files:\n${detail}`).toEqual([]);
  });

  it("uses one version query per asset path across every surface", () => {
    // The preload and the <picture> source for the same file must warm and fetch the
    // identical URL, so a path referenced from two surfaces with different ?v= values
    // is a cache-bust drift bug even though each reference is individually versioned.
    const versionsByPath = new Map<string, Set<string>>();
    for (const reference of assetReferences) {
      const versions = versionsByPath.get(reference.path) ?? new Set<string>();
      versions.add(versionOf(reference));
      versionsByPath.set(reference.path, versions);
    }
    const conflicting = [...versionsByPath].filter(
      ([, versions]) => versions.size > 1,
    );
    const detail = conflicting
      .map(([path, versions]) => `${path}: ${[...versions].join(", ")}`)
      .join("\n");
    expect(conflicting, `Conflicting version queries:\n${detail}`).toEqual([]);
  });
});
