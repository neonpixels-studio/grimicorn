import { test, expect, type Page } from "@playwright/test";

// `npm run test:e2e` builds with CONTEXT=production, so the consent flow ships.
// Requests to Google are fulfilled with an empty script, never sent for real.

const GTAG_URL_PATTERN = "**/www.googletagmanager.com/**";
const CONSENT_STORAGE_KEY = "grimicorn:analytics-consent";
const BANNER_NAME = "analytics";
const FOOTER_LINK_NAME = "analytics choice";

function trackGoogleRequests(page: Page) {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("googletagmanager.com")) {
      requested.push(request.url());
    }
  });
  return requested;
}

test.beforeEach(async ({ page }) => {
  await page.route(GTAG_URL_PATTERN, (route) =>
    route.fulfill({ contentType: "text/javascript", body: "" }),
  );
});

test("no request to Google before consent, one after accepting", async ({
  page,
}) => {
  const requested = trackGoogleRequests(page);
  await page.goto("/", { waitUntil: "networkidle" });

  const banner = page.getByRole("region", { name: BANNER_NAME });
  await expect(banner).toBeVisible();
  expect(requested).toEqual([]);
  expect(await page.evaluate(() => "dataLayer" in window)).toBe(false);

  await banner.getByRole("button", { name: "accept" }).click();

  await expect.poll(() => requested.length).toBe(1);
  expect(requested[0]).toContain("gtag/js?id=G-");
  await expect(banner).toBeHidden();
});

// The footer link only renders once the theme has mounted and found analytics
// available, so it doubles as the "hydration finished" signal.
async function waitForConsentUi(page: Page) {
  await expect(
    page.getByRole("button", { name: FOOTER_LINK_NAME }),
  ).toBeVisible();
}

test("the stored choice survives a reload and declining loads nothing", async ({
  page,
}) => {
  const requested = trackGoogleRequests(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "decline" }).click();

  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    CONSENT_STORAGE_KEY,
  );
  expect(stored.choice).toBe("declined");
  expect(stored.expiresAt).toBeGreaterThan(Date.now());

  await page.reload({ waitUntil: "networkidle" });
  await waitForConsentUi(page);
  await expect(page.getByRole("region", { name: BANNER_NAME })).toBeHidden();
  expect(requested).toEqual([]);
});

test("the footer link reopens the choice and focus returns to it", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "decline" }).click();

  const footerLink = page.getByRole("button", { name: FOOTER_LINK_NAME });
  await footerLink.focus();
  await footerLink.press("Enter");
  const banner = page.getByRole("region", { name: BANNER_NAME });
  await expect(banner).toBeVisible();
  await expect(banner).toBeFocused();

  await banner.getByRole("button", { name: "decline" }).press("Enter");
  await expect(banner).toBeHidden();
  await expect(footerLink).toBeFocused();
});

test("Global Privacy Control suppresses the banner and the footer link", async ({
  page,
}) => {
  const requested = trackGoogleRequests(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "globalPrivacyControl", {
      value: true,
    });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  // Hydration is done once the pause toggle responds; only then is "hidden" proof.
  const pauseToggle = page.getByRole("button", { name: "pause live updates" });
  await pauseToggle.click();
  await expect(pauseToggle).toHaveAttribute("aria-pressed", "true");

  await expect(page.getByRole("region", { name: BANNER_NAME })).toBeHidden();
  await expect(
    page.getByRole("button", { name: FOOTER_LINK_NAME }),
  ).toBeHidden();
  expect(requested).toEqual([]);
});
