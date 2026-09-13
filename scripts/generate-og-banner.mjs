import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { OG_WIDTH, OG_HEIGHT, OG_IMAGE_FILENAME } from "../og-banner-spec.mjs";
import { extractBrandBackgroundColor } from "../brand-color.mjs";

// Landscape Open Graph banner. Twitter's summary_large_image and most platforms
// render ~1.91:1, so a square source gets center-cropped. We derive the banner
// from the existing square hero art, padded to the site theme background so
// nothing is cropped. Dimensions and filename come from the shared spec.
const PNG_COMPRESSION_LEVEL = 9;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const SOURCE_IMAGE = resolve(projectRoot, "public/assets/grimicorn-hero.png");
const OUTPUT_IMAGE = resolve(projectRoot, "public/assets", OG_IMAGE_FILENAME);
const THEME_STYLESHEET = resolve(projectRoot, ".vitepress/theme/style.css");

// Read straight from the theme stylesheet (--color-bg) rather than a hardcoded
// copy, so the padding can't silently drift from the site's real background.
const THEME_BACKGROUND = extractBrandBackgroundColor(
  readFileSync(THEME_STYLESHEET, "utf8"),
  THEME_STYLESHEET,
);

async function generateBanner() {
  const hero = await sharp(SOURCE_IMAGE)
    .resize(OG_HEIGHT, OG_HEIGHT, { fit: "inside" })
    .toBuffer();

  await sharp({
    create: {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      channels: 4,
      background: THEME_BACKGROUND,
    },
  })
    .composite([{ input: hero, gravity: "center" }])
    .flatten({ background: THEME_BACKGROUND })
    .png({ compressionLevel: PNG_COMPRESSION_LEVEL, palette: true })
    .toFile(OUTPUT_IMAGE);
}

await generateBanner().catch((error) => {
  console.error(`Failed to build ${OUTPUT_IMAGE} from ${SOURCE_IMAGE}`);
  console.error(error);
  process.exitCode = 1;
});
