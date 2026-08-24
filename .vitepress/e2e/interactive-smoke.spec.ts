import { test, expect, type Locator, type Page } from "@playwright/test";

// One real-browser smoke test covering the three interactive behaviors the
// happy-dom unit suite (GrimicornPage.test.ts) can't genuinely exercise: the
// Konami rave toggle driven by real keydown events, the pause control's focus
// redirection when a real matchMedia change removes it, and the
// requestAnimationFrame-driven cursor parallax plus its reduced-motion rest pose.
// It guards the integration seam — CSP-gated hydration, focus, layout, rAF — that
// unit tests structurally cannot.

const KONAMI_SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

// Mirrors PAUSE_CONTROL_REMOVED_ANNOUNCEMENT in GrimicornPage.vue: the live-region
// message that must appear once focus is redirected off the removed pause control.
const PAUSE_CONTROL_REMOVED_ANNOUNCEMENT =
  "Live updates stopped, so the pause control was removed. Focus moved to the terminal window title.";

// The page-wide filter rave mode applies to the root container. Asserting the
// rendered effect (not just aria state) proves the toggle's side effects ran
// through hydrated JS.
const RAVE_FILTER_PATTERN = /saturate\(1\.7\) contrast\(1\.08\)/;

// The constant overzoom scale the hero rests at when no cursor-linked
// translate/rotate applies — the exact pose reduced motion must land on.
const HERO_REST_TRANSFORM = "scale(1.06)";

// The parallax easing has to move the hero at least this far horizontally before
// the cursor-linked transform counts as applied. Small, because a single frame of
// 7%-per-frame easing toward a half-viewport offset already clears it.
const MIN_PARALLAX_SHIFT_PIXELS = 1;

function readTransform(image: Locator) {
  return image.evaluate((element) => (element as HTMLElement).style.transform);
}

// Fails loud rather than returning 0 on an unrecognized format: a 0 would make the
// parallax poll time out with "expected 0 to be greater than 1", hiding the real
// cause (e.g. the component emitting translate3d/matrix instead).
function translateXPixels(transform: string) {
  const match = transform.match(/translate\(([-\d.]+)px/);
  if (!match) {
    throw new Error(`Unrecognized hero transform: "${transform}"`);
  }
  return Number(match[1]);
}

// The pause control only renders once onMounted has run (v-if="streamCanAutoAdvance",
// false in SSR), so waiting for it visible is a hydration gate: it proves the
// interactive JS — the window keydown and mousemove listeners included — is live
// before a test fires keys or moves the cursor.
function waitForHydration(page: Page) {
  return expect(
    page.getByRole("button", { name: "pause live updates" }),
  ).toBeVisible();
}

function pressKonamiSequence(page: Page) {
  return KONAMI_SEQUENCE.reduce(
    (chain, key) => chain.then(() => page.keyboard.press(key)),
    Promise.resolve(),
  );
}

// A CSP violation or an uncaught page error would otherwise leave the tests green
// while a real regression (a blocked script, style, image, or connection) ships.
// Collect each into its own bucket — kept distinct so a plain TypeError isn't
// mislabelled a CSP problem — and assert both empty in afterEach so the custom
// CSP-applying server guards more than just script-src hydration.
const cspViolations: string[] = [];
const pageErrors: string[] = [];

test.beforeEach(({ page }) => {
  cspViolations.length = 0;
  pageErrors.length = 0;
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) {
      cspViolations.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
});

test.afterEach(() => {
  expect(cspViolations).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("the Konami sequence toggles rave mode in a real browser", async ({
  page,
}) => {
  const response = await page.goto("/");
  // The server applies the production CSP, including the per-build inline-script
  // hashes. Asserting it directly (not just via hydration) fails loud at the header
  // if the hashing regresses.
  const contentSecurityPolicy = response?.headers()["content-security-policy"];
  expect(contentSecurityPolicy).toContain("script-src");
  expect(contentSecurityPolicy).toContain("sha256-");

  await waitForHydration(page);

  const raveToggle = page.getByRole("button", { name: "colorful" });
  await expect(raveToggle).toHaveAttribute("aria-pressed", "false");
  // The toast text only exists once rave fires, so a zero count here confirms the
  // sequence, not incidental page text, is what makes it appear below.
  await expect(page.getByText("RAVE MODE")).toHaveCount(0);

  // The toast <div> is always in the DOM and Playwright treats opacity:0 as visible,
  // so gate on the opacity-100 class it only gets while actually shown. Arm the wait
  // before firing keys (and await it alongside the presses) so its appearance can't
  // slip past the auto-dismiss timer, and so a press rejection can't orphan it.
  const toastShown = page
    .getByText("RAVE MODE")
    .and(page.locator(".opacity-100"))
    .waitFor({ state: "visible" });
  await Promise.all([toastShown, pressKonamiSequence(page)]);

  await expect(raveToggle).toHaveAttribute("aria-pressed", "true");
  // Assert the computed filter, not the raw style attribute, so the check doesn't
  // couple to the ordering of the other inline styles on the root container.
  await expect
    .poll(() =>
      page
        .locator("div.min-h-screen")
        .evaluate((element) => getComputedStyle(element).filter),
    )
    .toMatch(RAVE_FILTER_PATTERN);
});

test("hiding the focused pause control via reduced motion redirects and announces focus", async ({
  page,
}) => {
  await page.goto("/");

  const pauseControl = page.getByRole("button", {
    name: "pause live updates",
  });
  await expect(pauseControl).toBeVisible();

  await pauseControl.focus();
  await expect(pauseControl).toBeFocused();

  // Emulating the OS switch fires the real matchMedia "change" event, which hides
  // the pause control while it still holds keyboard focus — the exact sequence
  // happy-dom can't reproduce.
  await page.emulateMedia({ reducedMotion: "reduce" });

  await expect(pauseControl).toHaveCount(0);
  await expect(page.locator(".window-chrome-title")).toBeFocused();
  await expect(page.locator(".pause-focus-announcement")).toHaveText(
    PAUSE_CONTROL_REMOVED_ANNOUNCEMENT,
  );
});

test("cursor movement drives the hero parallax and reduced motion rests it", async ({
  page,
}) => {
  await page.goto("/");
  await waitForHydration(page);

  const hero = page.locator('img[alt="Grimicorn — skeletal rainbow unicorn"]');

  // The parallax maps the cursor's position within the viewport to the transform,
  // so derive the target from the viewport (not fixed pixels): the far right edge
  // puts the cursor well right of center, which the component turns into a positive
  // horizontal shift regardless of the configured viewport size.
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("Expected a fixed viewport size for the parallax test");
  }
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.mouse.move(viewport.width - 1, viewport.height / 2);

  // Gate on the loop having written a translate() before parsing it: translateXPixels
  // throws on an unrecognized format (that's deliberate for a genuinely wrong
  // transform), and expect.poll treats a thrown error as terminal, so parsing the
  // brief empty-string window right after hydration would hard-fail instead of
  // retrying a frame later.
  await expect(hero).toHaveAttribute("style", /translate\(/);
  // The rAF loop eases the transform toward the target over several frames, so poll
  // until the cursor-linked translate clears the threshold.
  await expect
    .poll(async () => translateXPixels(await readTransform(hero)))
    .toBeGreaterThan(MIN_PARALLAX_SHIFT_PIXELS);

  // Reduced motion stops the loop and lands the hero on the constant overzoom
  // rest pose with no cursor-linked translate/rotate.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => readTransform(hero)).toBe(HERO_REST_TRANSFORM);
});
