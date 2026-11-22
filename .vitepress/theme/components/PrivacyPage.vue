<script setup lang="ts">
import { MAIN_CONTENT_ID, MANAGE_CHOICE_LABEL } from "../constants";
import {
  CONSENT_LIFETIME_DAYS,
  CONSENT_STORAGE_KEY,
} from "../analytics/consent";
import { analyticsAvailable } from "../analytics/consent-controller";
import ConsentManageLink from "./ConsentManageLink.vue";
</script>

<template>
  <div class="bg-bg text-fg relative min-h-screen overflow-hidden font-mono">
    <!-- ambient glow -->
    <div
      class="pointer-events-none absolute top-[-200px] right-[-160px] h-[680px] w-[680px] blur-[24px]"
      style="
        background: radial-gradient(
          circle,
          rgba(168, 85, 247, 0.2),
          rgba(34, 211, 238, 0.09) 45%,
          transparent 70%
        );
      "
    />

    <div class="relative mx-auto max-w-[1180px] px-5 sm:px-8 lg:px-10">
      <nav
        class="flex items-center justify-between border-b border-white/[0.07] py-[26px]"
      >
        <div class="flex items-center gap-3">
          <span class="bg-lime h-[9px] w-[9px] rounded-full" />
          <span class="text-sm font-bold tracking-[0.02em]">grimicorn.dev</span>
        </div>
        <a
          href="/"
          class="text-fg-subtle hover:text-fg text-[12.5px] no-underline transition-colors"
          >&larr; back to home</a
        >
      </nav>

      <main
        :id="MAIN_CONTENT_ID"
        tabindex="-1"
        class="max-w-[680px] pt-10 pb-16 lg:pt-16"
      >
        <div class="text-purple mb-[22px] text-xs tracking-[0.16em] uppercase">
          — what leaves your browser
        </div>
        <h1
          class="font-display mt-0 mb-10 text-[34px] leading-[1.1] font-bold tracking-[-0.02em] sm:text-[44px]"
        >
          privacy
        </h1>

        <!-- The one deliberate third-party integration on this otherwise
           first-party site (see GA_MEASUREMENT_ID / ANALYTICS_ENABLED in
           .vitepress/config.ts). This is the site's only disclosure that
           pageviews (and, depending on the GA4 property's Enhanced Measurement
           settings, other interaction events) leave the origin. -->
        <section class="mb-10">
          <h2 class="font-display mb-3 text-[20px] font-bold">analytics</h2>
          <p class="text-fg-muted text-sm leading-[1.8]">
            Google Analytics (GA4) is the only analytics service this site uses,
            and it loads only after you accept it. On your first visit to the
            live production site a banner asks you to accept or decline; until
            you accept, nothing is requested from Google. Once you accept,
            pageviews and basic usage data are sent to Google Analytics (GA4).
            Depending on the analytics property&rsquo;s settings, that may
            include scrolling, outbound link clicks, file downloads, site
            searches, video engagement (plays, progress, completions), and form
            interactions. Links to GitHub are the only other place this site
            points off-site, and those only load if you click them.
          </p>
          <p class="text-fg-muted mt-3 text-sm leading-[1.8]">
            Your choice is stored in this browser (in local storage, under
            <code>{{ CONSENT_STORAGE_KEY }}</code>) for
            {{ CONSENT_LIFETIME_DAYS }} days, after which the banner asks again.
            To change it, use the &ldquo;{{ MANAGE_CHOICE_LABEL }}&rdquo; link
            in the footer of the home page<template v-if="analyticsAvailable">
              or here: <ConsentManageLink /></template
            >. Declining after accepting stops further analytics requests and
            clears the Google Analytics cookies on this domain and its parent
            domains. If your browser sends Global Privacy Control or Do Not
            Track, analytics never loads and the banner is not shown.
          </p>
        </section>

        <!-- Browsers send CSP violation reports on their own from the
           Content-Security-Policy response header (see report-uri / report-to
           in .vitepress/headers.ts), so JS-level opt-outs like GPC/DNT cannot
           stop them. The maintainer accepted that limitation on condition that
           it is disclosed here. -->
        <section>
          <h2 class="font-display mb-3 text-[20px] font-bold">
            error and security reports
          </h2>
          <p class="text-fg-muted text-sm leading-[1.8]">
            On the live production site, if a page error occurs, an error report
            is sent to Sentry unless Global Privacy Control or Do Not Track is
            on. Content Security Policy violation reports are also sent to
            Sentry, to detect broken or injected scripts and other security
            issues. Your browser creates and sends these reports automatically
            from the site&rsquo;s response headers, so they are sent even when
            Global Privacy Control or Do Not Track is on (unlike the error
            reports above). A report includes details such as the page URL, the
            referrer, the URL of the blocked resource, the script location that
            triggered it, and your IP address and user agent as received by
            Sentry.
          </p>
        </section>
      </main>
    </div>
  </div>
</template>
