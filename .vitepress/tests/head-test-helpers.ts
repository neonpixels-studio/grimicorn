import config from "../config";

export type HeadEntry = NonNullable<typeof config.head>[number];

// The head VitePress actually renders for a page is config.head (static, every
// page) merged with transformHead's per-page additions (see mergeHead in
// vitepress). Canonical, Open Graph, Twitter Card, and JSON-LD — including the
// ?v=-versioned og:image URL — exist only in transformHead's indexable-page
// output, not in the static head, so both the SEO invariant suite
// (config.test.ts) and the asset cache-bust suite (asset-version-invariant.test.ts)
// need to resolve the real per-page head rather than reading config.head alone.
// A single resolver here keeps the two suites from drifting apart on the
// transformHead context shape or on how a missing hook is handled.
export async function resolveHeadForPage(pageData: {
  isNotFound?: boolean;
}): Promise<HeadEntry[]> {
  const transformHead = config.transformHead;
  if (typeof transformHead !== "function") {
    // Fail loud rather than silently falling back to the static head: canonical,
    // OG, Twitter Card, and JSON-LD (and the versioned og:image reference inside
    // them) would go unchecked by every describe block that relies on this
    // resolver, and both suites would keep passing while checking nothing.
    throw new Error(
      "config.transformHead is not a function — canonical/OG/Twitter/JSON-LD are added there and would silently go unchecked",
    );
  }
  const context = { pageData } as Parameters<typeof transformHead>[0];
  const transformed = (await transformHead(context)) ?? [];
  return [...((config.head ?? []) as HeadEntry[]), ...transformed];
}
