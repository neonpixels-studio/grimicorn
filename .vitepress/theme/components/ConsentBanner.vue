<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { PRIVACY_PAGE_PATH } from "../constants";
import {
  acceptAnalytics,
  analyticsAvailable,
  bannerOpen,
  declineAnalytics,
} from "../analytics/consent-controller";

const bannerElement = ref<HTMLElement | null>(null);
let focusBeforeOpen: Element | null = null;

// Not a dialog: nothing traps focus and the page stays usable. When the footer
// link reopens it, focus moves in so keyboard users find it, and goes back to
// that link when it closes. The automatic first-visit prompt leaves focus alone.
async function onBannerToggled(isOpen: boolean) {
  if (!isOpen) {
    const returnTarget = focusBeforeOpen;
    focusBeforeOpen = null;
    if (returnTarget instanceof HTMLElement && returnTarget.isConnected) {
      returnTarget.focus();
    }
    return;
  }
  const active = document.activeElement;
  if (!active || active === document.body) {
    return;
  }
  focusBeforeOpen = active;
  await nextTick();
  bannerElement.value?.focus();
}

watch(bannerOpen, onBannerToggled, { flush: "post" });

const BUTTON_CLASSES =
  "text-fg hover:bg-white/10 cursor-pointer border border-white/30 px-4 py-2 text-[12.5px] transition-colors";
</script>

<template>
  <section
    v-if="analyticsAvailable && bannerOpen"
    ref="bannerElement"
    tabindex="-1"
    aria-labelledby="consent-banner-title"
    class="bg-bg text-fg fixed inset-x-0 bottom-0 z-[9000] border-t border-white/30 px-5 py-4 font-mono sm:px-8"
  >
    <div
      class="mx-auto flex max-w-[1180px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p class="text-fg-muted max-w-[640px] text-[12.5px] leading-[1.7]">
        <strong id="consent-banner-title" class="text-fg font-bold"
          >analytics</strong
        >
        &mdash; allow Google Analytics to count visits to this site? Nothing is
        sent to Google unless you accept.
        <a
          :href="PRIVACY_PAGE_PATH"
          class="hover:text-fg underline underline-offset-[3px]"
          >privacy</a
        >
      </p>
      <div class="flex gap-3">
        <button type="button" :class="BUTTON_CLASSES" @click="acceptAnalytics">
          accept
        </button>
        <button type="button" :class="BUTTON_CLASSES" @click="declineAnalytics">
          decline
        </button>
      </div>
    </div>
  </section>
</template>
