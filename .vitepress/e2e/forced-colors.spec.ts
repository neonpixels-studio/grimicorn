import { test, expect, type Locator, type Page } from "@playwright/test";

// Real-browser coverage for the `@media (forced-colors: active)` block in
// style.css, which the text-parsing `forced-colors gradient-text fallback`
// describe in style.test.ts can only prove is declared, not that it paints.
// Chromium and Firefox genuinely apply the cascade under
// page.emulateMedia({ forcedColors: "active" }). WebKit's emulation reports
// `matches: true` but never applies the cascade, so every test here skips it
// rather than fail for a reason that isn't an app bug (see README, "Known
// test-coverage gaps").
//
// Mutation-checked: removing the wordmark `color` rule fails the wordmark and
// 404 specs on Firefox (Chromium's UA already forces a visible color there, so
// those two specs only guard Firefox); removing the hover underline or the
// pressed double underline fails the button specs on both engines.
const EMULATION_BROWSERS = ["chromium", "firefox"];

// What `color: transparent` computes to. The gradient-clipped wordmarks paint
// nothing at all with this value, which is the exact bug the fallback prevents.
const TRANSPARENT_COLOR = "rgba(0, 0, 0, 0)";

// The pause toggle is the page's `.colorful-btn.pause-toggle`.
const PAUSE_TOGGLE_NAME = "pause live updates";

// The unknown route is served the generated 404.html (see serve-dist.mjs).
const NOT_FOUND_PATH = "/forced-colors-missing-page";

test.beforeEach(async ({ page, browserName }) => {
  test.skip(
    !EMULATION_BROWSERS.includes(browserName),
    `${browserName} does not apply the cascade under forced-colors emulation`,
  );
  await page.emulateMedia({ forcedColors: "active" });
});

// Resolves the system color through a probe element instead of hardcoding it:
// CanvasText is a different RGB per engine, so only a live read stays correct.
function resolveCanvasText(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "CanvasText";
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  });
}

// Clears :hover so the resting-state rules apply to a button the pointer last touched.
function movePointerAway(page: Page) {
  return page.mouse.move(0, 0);
}

function readTextStyle(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.color,
      textDecorationLine: style.textDecorationLine,
      textDecorationStyle: style.textDecorationStyle,
    };
  });
}

function expectDecorationLine(locator: Locator, line: string) {
  return expect
    .poll(async () => (await readTextStyle(locator)).textDecorationLine)
    .toBe(line);
}

async function expectPaintsCanvasText(page: Page, locator: Locator) {
  const canvasText = await resolveCanvasText(page);
  // Guards the probe: a transparent CanvasText would make the equality below
  // pass while the text is still invisible.
  expect(canvasText).not.toBe(TRANSPARENT_COLOR);
  await expect
    .poll(async () => (await readTextStyle(locator)).color)
    .toBe(canvasText);
}

test("the emulation is active, so the assertions below exercise real forced colors", async ({
  page,
}) => {
  await page.goto("/");

  const forcedColorsMatches = await page.evaluate(
    () => matchMedia("(forced-colors: active)").matches,
  );
  expect(forcedColorsMatches).toBe(true);
});

test("the AGENT wordmark keeps a visible color once its gradient is stripped", async ({
  page,
}) => {
  await page.goto("/");

  await expectPaintsCanvasText(
    page,
    page.locator("h1 span.bg-clip-text", { hasText: /^AGENT$/ }),
  );
});

test("the 404 numeral keeps a visible color once its gradient is stripped", async ({
  page,
}) => {
  await page.goto(NOT_FOUND_PATH);

  await expectPaintsCanvasText(
    page,
    page.getByRole("heading", { name: "404" }),
  );
});

test("the colorful button paints CanvasText at rest and underlines on hover", async ({
  page,
}) => {
  await page.goto("/");
  const pauseToggle = page.getByRole("button", { name: PAUSE_TOGGLE_NAME });
  await expect(pauseToggle).toBeVisible();
  await movePointerAway(page);

  await expectPaintsCanvasText(page, pauseToggle);
  await expectDecorationLine(pauseToggle, "none");

  await pauseToggle.hover();

  await expectPaintsCanvasText(page, pauseToggle);
  await expectDecorationLine(pauseToggle, "underline");
  await expect
    .poll(() => readTextStyle(pauseToggle))
    .toMatchObject({ textDecorationStyle: "solid" });
});

test("the pressed pause toggle shows a double underline at rest and on hover, unlike a plain hover", async ({
  page,
}) => {
  await page.goto("/");
  const pauseToggle = page.getByRole("button", { name: PAUSE_TOGGLE_NAME });
  await expect(pauseToggle).toBeVisible();

  await pauseToggle.click();
  await expect(pauseToggle).toHaveAttribute("aria-pressed", "true");
  await movePointerAway(page);

  // At rest, the forced-colors override repeats the `:not(:hover)` selector so
  // it ties the base pressed rule's specificity and wins on source order.
  await expectPaintsCanvasText(page, pauseToggle);
  await expect
    .poll(() => readTextStyle(pauseToggle))
    .toMatchObject({
      textDecorationLine: "underline",
      textDecorationStyle: "double",
    });

  // Hovering makes the :not(:hover) rule stop matching, so the bare forced-colors
  // pressed selector wins the tie with `.colorful-btn:hover`; a plain hover on an
  // unpressed button stays a single underline, so the two remain distinct.
  await pauseToggle.hover();

  await expectPaintsCanvasText(page, pauseToggle);
  await expect
    .poll(() => readTextStyle(pauseToggle))
    .toMatchObject({
      textDecorationLine: "underline",
      textDecorationStyle: "double",
    });
});
