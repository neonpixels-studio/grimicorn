import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { OG_WIDTH, OG_HEIGHT, OG_IMAGE_FILENAME } from "../og-banner-spec.mjs";
import { readBrandBackgroundColor } from "../brand-color.mjs";

// Landscape Open Graph banner. Twitter's summary_large_image and most platforms
// render ~1.91:1, so a square source gets center-cropped. We derive the banner
// from the existing square hero art, padded to the site theme background so
// nothing is cropped. Dimensions and filename come from the shared spec.
const PNG_COMPRESSION_LEVEL = 9;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const SOURCE_IMAGE = resolve(projectRoot, "public/assets/grimicorn-hero.png");
const OUTPUT_IMAGE = resolve(projectRoot, "public/assets", OG_IMAGE_FILENAME);

async function generateBanner() {
  // Read inside the try/catch-guarded entry point (see the .catch below) rather
  // than at module top level, so a missing stylesheet or an ambiguous/non-hex
  // --color-bg declaration reports the same contextual failure as any other
  // generation error instead of a bare unhandled-rejection stack trace.
  const themeBackground = readBrandBackgroundColor();

  const hero = await sharp(SOURCE_IMAGE)
    .resize(OG_HEIGHT, OG_HEIGHT, { fit: "inside" })
    .toBuffer();

  await sharp({
    create: {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      channels: 4,
      background: themeBackground,
    },
  })
    .composite([{ input: hero, gravity: "center" }])
    .flatten({ background: themeBackground })
    .png({ compressionLevel: PNG_COMPRESSION_LEVEL, palette: true })
    .toFile(OUTPUT_IMAGE);
}

await generateBanner().catch((error) => {
  console.error(`Failed to build ${OUTPUT_IMAGE} from ${SOURCE_IMAGE}`);
  console.error(error);
  process.exitCode = 1;
});
