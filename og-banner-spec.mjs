// Single source of truth for the Open Graph banner, imported by both the
// generator (scripts/generate-og-banner.mjs) and the site config
// (.vitepress/config.ts) so the dimensions and filename cannot drift apart.
// Platforms render summary_large_image at ~1.91:1, hence the 1200x630 landscape.
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const OG_IMAGE_FILENAME = "grimicorn-og.png";
