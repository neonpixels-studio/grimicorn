import { defineConfig, type HeadConfig } from "vitepress";
import type { SiteConfig } from "vitepress";
import tailwindcss from "@tailwindcss/vite";
import { OG_WIDTH, OG_HEIGHT, OG_IMAGE_FILENAME } from "../og-banner-spec.mjs";
import { writeCspHeaders } from "./write-headers";
import { assertBuildOutputHasNoDisallowedOrigins } from "./scan-origins";

const SITE_URL = "https://grimicorn.dev";
const DESCRIPTION =
  "A chaotic AI coding sidekick — builds what you don't have time for, then unleashes gremlins to break it before production does.";
// Static image assets are served with a one-year immutable cache (see the /assets/*
// header in netlify.toml), so every reference carries a ?v= cache-bust to force a
// refetch when the file behind the stable URL actually changes. The token must match
// the one on the hero <picture> srcsets in GrimicornPage.vue or an avif client fetches
// a different URL than the preload warmed.
const ASSET_CACHE_BUST = "?v=20260816";
const OG_IMAGE = `${SITE_URL}/assets/${OG_IMAGE_FILENAME}${ASSET_CACHE_BUST}`;
const OG_IMAGE_WIDTH = String(OG_WIDTH);
const OG_IMAGE_HEIGHT = String(OG_HEIGHT);
const OG_IMAGE_ALT =
  "Grimicorn: a psychedelic, skeletal unicorn with a spiraled horn and flowing rainbow-colored mane, prancing before a rainbow over a surreal landscape.";

// The hero <picture> in GrimicornPage.vue is the LCP element on every content page.
// avif is its first (preferred) source, so preloading only the avif — gated by type
// so non-avif browsers skip it and fall back to the normal picture resolution —
// matches what an avif-capable client actually fetches with no wasted bytes. A second
// type-differentiated preload (webp) would double-download in browsers that support
// both formats, so we intentionally omit it.
const HERO_IMAGE_HREF = `/assets/grimicorn-hero.avif${ASSET_CACHE_BUST}`;
const HERO_IMAGE_TYPE = "image/avif";
const HERO_PRELOAD_HEAD_ENTRY: HeadConfig = [
  "link",
  {
    rel: "preload",
    as: "image",
    href: HERO_IMAGE_HREF,
    type: HERO_IMAGE_TYPE,
    fetchpriority: "high",
  },
];

const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Grimicorn",
  description: DESCRIPTION,
  url: SITE_URL,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "All",
  image: OG_IMAGE,
});

export default defineConfig({
  title: "Grimicorn",
  description: DESCRIPTION,
  lang: "en-US",
  sitemap: {
    hostname: SITE_URL,
  },
  head: [
    // Fonts are self-hosted via @font-face in .vitepress/theme/fonts.css
    // (served from /public/fonts), so no Google Fonts preconnect or stylesheet
    // is needed here and the CSP stays first-party-only for fonts. Preload only
    // the two latin (default) subsets — they'd otherwise be discovered late, after
    // the CSS bundle parses. crossorigin is required even same-origin: font fetches
    // are always CORS-mode, so a bare preload would download the file twice. The
    // ?v= must match fonts.css or the preload misses the cache and double-fetches.
    [
      "link",
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: "/fonts/space-grotesk-latin.woff2?v=20260813",
        crossorigin: "",
      },
    ],
    [
      "link",
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: "/fonts/jetbrains-mono-latin.woff2?v=20260813",
        crossorigin: "",
      },
    ],
    // Canonical + theme color
    ["link", { rel: "canonical", href: SITE_URL }],
    ["meta", { name: "theme-color", content: "#0a0a0b" }],
    // Open Graph
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:locale", content: "en_US" }],
    ["meta", { property: "og:url", content: SITE_URL }],
    [
      "meta",
      { property: "og:title", content: "Grimicorn – AI Coding Sidekick" },
    ],
    ["meta", { property: "og:description", content: DESCRIPTION }],
    ["meta", { property: "og:image", content: OG_IMAGE }],
    ["meta", { property: "og:image:width", content: OG_IMAGE_WIDTH }],
    ["meta", { property: "og:image:height", content: OG_IMAGE_HEIGHT }],
    ["meta", { property: "og:image:alt", content: OG_IMAGE_ALT }],
    // Twitter Card
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    [
      "meta",
      { name: "twitter:title", content: "Grimicorn – AI Coding Sidekick" },
    ],
    ["meta", { name: "twitter:description", content: DESCRIPTION }],
    ["meta", { name: "twitter:image", content: OG_IMAGE }],
    ["meta", { name: "twitter:image:alt", content: OG_IMAGE_ALT }],
    // Structured data
    ["script", { type: "application/ld+json" }, JSON_LD],
    // Favicon
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        href: "/images/favicon-96x96.png?v=20260618",
        sizes: "96x96",
      },
    ],
    [
      "link",
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/images/favicon.svg?v=20260618",
      },
    ],
    ["link", { rel: "shortcut icon", href: "/images/favicon.ico?v=20260618" }],
    [
      "link",
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/images/apple-touch-icon.png?v=20260618",
      },
    ],
    [
      "meta",
      { name: "apple-mobile-web-app-title", content: "Grimicorn Agent" },
    ],
    // The manifest lives under /images and is now long-cached immutable, so its ?v=
    // must bump whenever its body changes (it just gained versioned icon srcs) or
    // returning visitors keep a stale copy for a year.
    [
      "link",
      { rel: "manifest", href: `/images/site.webmanifest${ASSET_CACHE_BUST}` },
    ],
  ],
  // Scope the preload to where the hero renders: every page except the 404. AppLayout
  // shows NotFound (no hero) when page.isNotFound and GrimicornPage otherwise, so this
  // mirrors that exact condition — preloading on the 404 would burn a high-priority
  // request and trip Chrome's "preloaded but not used" warning. transformHead is a
  // build-time hook, so the preload appears under `vitepress build`/`preview`, not
  // `vitepress dev` — verify the LCP win against a production build.
  transformHead: ({ pageData }) => {
    if (pageData.isNotFound) {
      return [];
    }
    return [HERO_PRELOAD_HEAD_ENTRY];
  },
  vite: {
    plugins: [tailwindcss()],
  },
  buildEnd(siteConfig: SiteConfig) {
    writeCspHeaders(siteConfig.outDir);
    // Guard the rendered output too: the source-level scan can't see an origin a
    // dependency or plugin injects into the built HTML/CSS/JS (see scan-origins.ts).
    assertBuildOutputHasNoDisallowedOrigins(siteConfig.outDir);
  },
});
