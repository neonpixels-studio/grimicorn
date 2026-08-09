import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Landscape Open Graph banner spec. Twitter's summary_large_image and most
// platforms render ~1.91:1, so a square source gets center-cropped. We derive a
// 1200x630 banner from the existing square hero art, padded to the site theme
// background so nothing is cropped.
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
// Mirrors --color-bg in .vitepress/theme/style.css so the padding stays on-brand.
const THEME_BACKGROUND = "#0a0a0b";
const PNG_COMPRESSION_LEVEL = 9;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const SOURCE_IMAGE = resolve(projectRoot, "public/assets/grimicorn-hero.png");
const OUTPUT_IMAGE = resolve(projectRoot, "public/assets/grimicorn-og.png");

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
