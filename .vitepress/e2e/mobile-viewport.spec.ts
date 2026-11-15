import { test, expect, type Page } from "@playwright/test";

// Real-browser coverage for the touch/phone layout, run only by the mobile-*
// projects in playwright.config.ts (Pixel 7 and iPhone 14, both narrower than
// the `sm` 640px breakpoint). The happy-dom unit suite has no layout engine and
// no pointer-capability media features, so overflow, the collapsed nav, and the
// touch gate on the parallax loop can only be checked here.

const PAUSE_TOGGLE_NAME = "pause live updates";
const HERO_SELECTOR = 'img[alt="Grimicorn — skeletal rainbow unicorn"]';
// Matches HERO_PARALLAX.scale in GrimicornPage.vue.
const HERO_REST_TRANSFORM = "scale(1.06)";
// Frames to let the rAF loop run after a mouse move before asserting it did not
// start. A loop that wrongly runs writes its first translate() on frame one.
const FRAMES_TO_OBSERVE = 10;

test.beforeEach(({ isMobile }) => {
  test.skip(!isMobile, "mobile viewport coverage only runs in mobile projects");
});

function waitForFrames(page: Page, frames: number) {
  return page.evaluate(
    (frameCount) =>
      new Promise<void>((resolve) => {
        let remaining = frameCount;
        const tick = () => {
          remaining -= 1;
          if (remaining <= 0) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    frames,
  );
}

test("the page does not scroll or overflow horizontally", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: PAUSE_TOGGLE_NAME }),
  ).toBeVisible();

  const metrics = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const elements = Array.from(
      document.querySelectorAll("main h1, main section, nav"),
    );
    const widestRight = Math.max(
      ...elements.map((element) => element.getBoundingClientRect().right),
    );
    return {
      matchedCount: elements.length,
      viewportWidth,
      scrollWidth: document.documentElement.scrollWidth,
      widestRight,
    };
  });

  expect(metrics.matchedCount).toBeGreaterThan(0);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.widestRight).toBeLessThanOrEqual(metrics.viewportWidth);
});

test("the nav collapses its links below the sm breakpoint but keeps the status", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByText("● agent online")).toBeVisible();
  // The collapse is pure CSS (`hidden sm:flex`), so no hydration gate is needed.
  // toBeAttached first: toBeHidden also passes when the links no longer exist.
  for (const name of ["about", "status"]) {
    const link = page.getByRole("link", {
      name,
      exact: true,
      includeHidden: true,
    });
    await expect(link).toBeAttached();
    await expect(link).toBeHidden();
  }
});

test("the pause control stays reachable", async ({ page }) => {
  await page.goto("/");
  const pauseToggle = page.getByRole("button", { name: PAUSE_TOGGLE_NAME });
  await expect(pauseToggle).toBeVisible();

  await pauseToggle.tap();
  await expect(pauseToggle).toHaveAttribute("aria-pressed", "true");
});

test("cursor-like input never starts the parallax loop on a touch device", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: PAUSE_TOGGLE_NAME }),
  ).toBeVisible();
  const hero = page.locator(HERO_SELECTOR);
  await expect(hero).toBeVisible();

  const matchesFinePointer = await page.evaluate(
    () => matchMedia("(hover: hover) and (pointer: fine)").matches,
  );
  expect(matchesFinePointer).toBe(false);

  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("Expected a fixed viewport size for the touch test");
  }
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.mouse.move(viewport.width - 1, viewport.height / 2);
  await waitForFrames(page, FRAMES_TO_OBSERVE);

  // Any write from the loop, in any transform format, changes this from the
  // resting value (nothing written yet, or the constant overzoom).
  const transform = await hero.evaluate(
    (element) => (element as HTMLElement).style.transform,
  );
  expect(["", HERO_REST_TRANSFORM]).toContain(transform);
});
