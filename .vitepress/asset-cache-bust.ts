// Static image assets are served with a one-year immutable cache (see the /assets/*
// header in netlify.toml), so every reference carries a ?v= cache-bust to force a
// refetch when the file behind the stable URL actually changes. This is the single
// source of truth for that token: config.ts (OG image, hero preload, web manifest)
// and GrimicornPage.vue (hero + portrait <picture> sources) both import it, so a
// version bump here can't drift across files and leave an avif client fetching a
// different URL than the preload warmed.
export const ASSET_CACHE_BUST = "?v=20260816";

// Append the shared cache-bust token to a versioned asset path. Kept tiny and pure
// so both the build config and the page component build identical URLs from one place.
export function withAssetCacheBust(assetPath: string): string {
  return `${assetPath}${ASSET_CACHE_BUST}`;
}
