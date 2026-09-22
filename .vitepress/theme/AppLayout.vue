<script setup lang="ts">
import { onMounted, watch } from "vue";
import { useData } from "vitepress";
import GrimicornPage from "./components/GrimicornPage.vue";
import NotFound from "./components/NotFound.vue";
import SkipLink from "./components/SkipLink.vue";
import { NOT_FOUND_TITLE, NOT_FOUND_DESCRIPTION } from "../not-found-meta";

const { page } = useData();

const DESCRIPTION_META_SELECTOR = 'meta[name="description"]';

function applyNotFoundMeta() {
  document.title = NOT_FOUND_TITLE;
  const descriptionElement = document.querySelector(DESCRIPTION_META_SELECTOR);
  if (descriptionElement) {
    descriptionElement.setAttribute("content", NOT_FOUND_DESCRIPTION);
  }
}

// VitePress's own client-side head updater unconditionally resets
// document.title and the description meta tag from its internal
// notFoundPageData fallback ("404 | <site>" / "Not Found") on every
// hydration and client-side route change — see ../not-found-meta.ts for the
// full explanation — which would otherwise silently undo config.ts's
// build-time title/description the instant JS runs. onMounted guarantees
// this never runs during SSR (document doesn't exist there); flush: "post"
// guarantees it always runs after VitePress's own default-flush ("pre")
// watcher within the same reactive update, regardless of which was created
// first, so this reliably wins the race on both the initial load and every
// later client-side navigation onto/off of the 404.
//
// Watches the whole page object, not just page.value.isNotFound: VitePress's
// router builds a brand-new object on every failed route load (even a
// 404-to-404 navigation, where isNotFound stays true throughout), and that
// new object is exactly what re-triggers VitePress's own resetting watcher.
// Watching only the boolean would miss that case, since it never changes.
onMounted(() => {
  watch(
    () => page.value,
    (currentPage) => {
      if (!currentPage.isNotFound) {
        return;
      }
      applyNotFoundMeta();
    },
    { immediate: true, flush: "post" },
  );
});
</script>

<template>
  <SkipLink />
  <NotFound v-if="page.isNotFound" />
  <GrimicornPage v-else />
</template>
