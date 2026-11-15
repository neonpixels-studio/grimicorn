import { describe, it, expect, afterEach } from "vitest";
import { shallowMount, enableAutoUnmount } from "@vue/test-utils";
import PrivacyPage from "@components/PrivacyPage.vue";
import { MAIN_CONTENT_ID } from "@theme/constants";

function mountPrivacyText() {
  return shallowMount(PrivacyPage).find("main").text();
}

describe("PrivacyPage", () => {
  enableAutoUnmount(afterEach);

  it("renders correctly", () => {
    expect(shallowMount(PrivacyPage).html()).toMatchSnapshot();
  });

  it("puts the disclosures inside a single focusable main landmark carrying the shared id", () => {
    const wrapper = shallowMount(PrivacyPage);
    const mains = wrapper.findAll("main");
    expect(mains).toHaveLength(1);
    expect(mains[0].attributes("id")).toBe(MAIN_CONTENT_ID);
    // tabindex="-1" lets the skip link move focus here without adding the
    // landmark to the tab order.
    expect(mains[0].attributes("tabindex")).toBe("-1");
    expect(wrapper.find("h1").text()).toBe("privacy");
  });

  it("links back to the homepage", () => {
    const wrapper = shallowMount(PrivacyPage);
    expect(wrapper.find('nav a[href="/"]').exists()).toBe(true);
  });

  // GA4 (see GA_MEASUREMENT_ID / ANALYTICS_ENABLED in .vitepress/config.ts) is
  // the one deliberate third-party integration on this otherwise first-party
  // site, and this page is its only disclosure to a visitor. Asserting on the
  // rendered text (not just the snapshot) means an edit that drops or rewords
  // a claim fails a named test instead of only a snapshot that an unrelated
  // `vitest -u` could silently update away.
  describe("disclosures", () => {
    it("discloses that pageviews are sent to Google Analytics", () => {
      // Pins the actual claim (data flows to Google Analytics), not just the
      // brand name: "we do not use Google Analytics" must still fail.
      expect(mountPrivacyText()).toMatch(/sent\s+to Google Analytics \(GA4\)/);
    });

    // GA4 Enhanced Measurement is a property-level setting outside this repo.
    // The copy deliberately lists the full set of Enhanced Measurement events
    // ("may include") so it never under-discloses, whether or not each is on.
    it("discloses the GA4 Enhanced Measurement event types", () => {
      const privacyText = mountPrivacyText();
      const disclosedEventTypes = [
        "scrolling",
        "outbound link clicks",
        "file downloads",
        "site searches",
        "video engagement",
        "form interactions",
      ];
      expect(privacyText).toMatch(/that may include/);
      for (const eventType of disclosedEventTypes) {
        expect(privacyText).toContain(eventType);
      }
    });

    // Browser-generated CSP reports (report-uri / report-to in headers.ts)
    // cannot honor GPC/DNT, so the page must say so. Pins each load-bearing
    // claim separately so a reword that drops one still fails.
    it("discloses that CSP reports go to Sentry even with GPC or DNT enabled", () => {
      const privacyText = mountPrivacyText();
      expect(privacyText).toMatch(
        /if a page error occurs, an error report is sent to Sentry unless Global Privacy Control or Do Not Track is\s+on/,
      );
      expect(privacyText).toMatch(
        /Content Security Policy violation reports are also sent to\s+Sentry/,
      );
      expect(privacyText).toMatch(
        /sent even when\s+Global Privacy Control or Do Not Track is on/,
      );
      const disclosedReportContents = [
        "the page URL",
        "the URL of the blocked resource",
        "the script location that triggered it",
        "your IP address and user agent",
      ];
      for (const reportContent of disclosedReportContents) {
        expect(privacyText).toContain(reportContent);
      }
      expect(privacyText).toMatch(/the\s+referrer/);
    });
  });
});
