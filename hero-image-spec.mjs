// Single source of truth for the hero avif asset path, imported by both the site
// config (.vitepress/config.ts) preload target and the hero <picture> in
// GrimicornPage.vue so the preloaded URL and the fetched source cannot drift.
// Only the base path lives here; each consumer appends its own ?v= cache-bust
// query (see ASSET_CACHE_BUST in config.ts and the matching token on the hero
// srcsets), so the preload and the picture warm and fetch the same file.
export const HERO_AVIF_HREF = "/assets/grimicorn-hero.avif";
