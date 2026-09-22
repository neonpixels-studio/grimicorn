import type { PageData } from "vitepress";
import config from "../config";

export type HeadEntry = NonNullable<typeof config.head>[number];

// Mirrors VitePress's internal mergeHead (dist/client/shared.js, also used
// server-side during build): a `meta` tag in `current` replaces any tag in
// `previous` that shares its first attribute key/value; every other tag is kept
// from both, with `current`'s entries appended last. Reimplemented here rather
// than imported from vitepress's internal dist path, which isn't public API and
// isn't guaranteed stable across versions.
function matchesTag(current: HeadEntry[], [tagType, attributes]: HeadEntry) {
  if (tagType !== "meta") {
    return false;
  }
  const keyAttribute = Object.entries(attributes ?? {})[0];
  if (keyAttribute == null) {
    return false;
  }
  return current.some(
    ([currentTagType, currentAttributes]) =>
      currentTagType === tagType &&
      currentAttributes?.[keyAttribute[0]] === keyAttribute[1],
  );
}

function mergeHead(previous: HeadEntry[], current: HeadEntry[]): HeadEntry[] {
  return [...previous.filter((tag) => !matchesTag(current, tag)), ...current];
}

// VitePress runs frontmatter.head through this same filter (dist/client/app/composables/head.js
// and the equivalent build-time render step) before ever merging it into the
// rendered head: a page's own `description` meta comes from `pageData.description`
// instead, so frontmatter.head can't duplicate or fight that tag.
function isMetaDescription([tagType, attributes]: HeadEntry) {
  return tagType === "meta" && attributes?.name === "description";
}

function filterOutHeadDescription(head: HeadEntry[]): HeadEntry[] {
  return head.filter((tag) => !isMetaDescription(tag));
}

// Neither transformPageData nor transformHead in config.ts reads anything off
// pageData beyond frontmatter and isNotFound, so the fixture only needs to be a
// structurally valid PageData, not a fully realistic render result.
export function buildFixturePageData(
  overrides: {
    isNotFound?: boolean;
    relativePath?: string;
    frontmatter?: Record<string, unknown>;
  } = {},
): PageData {
  const relativePath =
    overrides.relativePath ?? (overrides.isNotFound ? "404.md" : "index.md");
  return {
    title: "",
    description: "",
    headers: [],
    frontmatter: {},
    ...overrides,
    relativePath,
    filePath: relativePath,
  };
}

// Calls config.transformPageData the same way VitePress's real render pipeline
// does (createMarkdownToVueRenderFn): shallow-spread the hook's return value
// onto pageData. A returned `frontmatter` replaces the page's whole frontmatter
// rather than being deep-merged into it, so a config.ts regression that drops
// `...pageData.frontmatter` before adding `head` shows up here instead of being
// silently patched over by a more forgiving test-only merge.
export async function callTransformPageData(
  pageData: PageData,
): Promise<PageData> {
  const { transformPageData } = config;
  if (typeof transformPageData !== "function") {
    // Fail loud rather than silently skipping the dev/build-parity path:
    // canonical, OG, Twitter Card, and JSON-LD (and the versioned og:image
    // reference inside them) would go unchecked by every describe block that
    // relies on this resolver, and both suites would keep passing while
    // checking nothing.
    throw new Error(
      "config.transformPageData is not a function — canonical/OG/Twitter/JSON-LD are added there and would silently go unchecked",
    );
  }
  const context = { siteConfig: config } as unknown as Parameters<
    typeof transformPageData
  >[1];
  const dataToMerge = await transformPageData(pageData, context);
  return { ...pageData, ...dataToMerge };
}

// The head VitePress actually renders for a page is config.head (static, every
// page) merged with transformPageData's per-page frontmatter.head — the
// dev/build-parity path canonical, Open Graph, Twitter Card, and JSON-LD go
// through, see the comment above transformPageData in config.ts — and then
// transformHead's per-page additions, which stay build-only (hero preload, the
// 404's noindex meta). Both suites that resolve a page's head need the real,
// fully-merged result rather than either hook in isolation, so a single resolver
// keeps them from drifting on the merge order or on how a missing hook is
// handled.
export async function resolveHeadForPage(pageData: {
  isNotFound?: boolean;
}): Promise<HeadEntry[]> {
  const { transformHead } = config;
  if (typeof transformHead !== "function") {
    throw new Error(
      "config.transformHead is not a function — the hero preload and the 404's noindex meta are added there and would silently go unchecked",
    );
  }

  const resolvedPageData = await callTransformPageData(
    buildFixturePageData(pageData),
  );

  const headBeforeTransformHead = mergeHead(
    (config.head ?? []) as HeadEntry[],
    filterOutHeadDescription(
      (resolvedPageData.frontmatter.head ?? []) as HeadEntry[],
    ),
  );
  const transformHeadContext = {
    pageData: resolvedPageData,
  } as unknown as Parameters<typeof transformHead>[0];
  const transformed = (await transformHead(transformHeadContext)) ?? [];
  return mergeHead(headBeforeTransformHead, transformed as HeadEntry[]);
}
