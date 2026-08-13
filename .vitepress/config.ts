import { defineConfig, type HeadConfig } from "vitepress";
import tailwindcss from "@tailwindcss/vite";
import { OG_WIDTH, OG_HEIGHT, OG_IMAGE_FILENAME } from "../og-banner-spec.mjs";

const SITE_URL = "https://grimicorn.dev";
const DESCRIPTION =
  "A chaotic AI coding sidekick — builds what you don't have time for, then unleashes gremlins to break it before production does.";
const OG_IMAGE = `${SITE_URL}/assets/${OG_IMAGE_FILENAME}`;
const OG_IMAGE_WIDTH = String(OG_WIDTH);
const OG_IMAGE_HEIGHT = String(OG_HEIGHT);
const OG_IMAGE_ALT =
  "Grimicorn: a psychedelic, skeletal unicorn with a spiraled horn and flowing rainbow-colored mane, prancing before a rainbow over a surreal landscape.";

// The hero <picture> in GrimicornPage.vue is the landing page's LCP element. It
// offers avif → webp → png; avif is its first (preferred) source, so preloading
// only the avif — gated by type so non-avif browsers skip it and fall back to the
// normal picture resolution — matches what an avif-capable client actually fetches
// with no wasted bytes. A second type-differentiated preload (webp) would double-
// download in browsers that support both formats, so we intentionally omit it.
const HERO_IMAGE_HREF = "/assets/grimicorn-hero.avif";
const HERO_IMAGE_TYPE = "image/avif";
// The hero lives only on the home page, so the preload is scoped to it via
// transformHead — a site-wide head entry would fetch this image on the 404 page
// (which renders no hero), burning a high-priority request and tripping Chrome's
// "preloaded but not used" warning.
const HOME_PAGE_RELATIVE_PATH = "index.md";
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
    // Fonts
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    [
      "link",
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossorigin: "",
      },
    ],
    [
      "link",
      {
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap",
        rel: "stylesheet",
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
    ["link", { rel: "manifest", href: "/images/site.webmanifest?v=20260618" }],
  ],
  transformHead: ({ pageData }) => {
    if (pageData.relativePath !== HOME_PAGE_RELATIVE_PATH) {
      return [];
    }
    return [HERO_PRELOAD_HEAD_ENTRY];
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
