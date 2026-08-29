<script setup lang="ts">
import { MAIN_CONTENT_ID } from "../constants";

// VitePress installs a capture-phase click handler on every same-origin anchor
// and calls preventDefault(), which cancels the native fragment navigation that
// would otherwise move focus into the target. Without moving focus ourselves the
// link would only scroll, leaving DOM focus on the skip link so the next Tab
// lands back in the nav — the exact thing this link exists to bypass. The
// landmark carries tabindex="-1" so it can receive this programmatic focus.
function focusMainContent(event: MouseEvent) {
  // Modified clicks are "open elsewhere" gestures; leave them to the browser
  // rather than hijacking them into a focus move (VitePress's own link handler
  // bails on these too).
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const mainContent = document.getElementById(MAIN_CONTENT_ID);
  if (!mainContent) {
    return;
  }
  // Only cancel the default once the target exists, so a missing landmark falls
  // through to native fragment navigation. focus() also scrolls it into view.
  event.preventDefault();
  mainContent.focus();
}
</script>

<template>
  <!-- Visually hidden until it receives keyboard focus (see .skip-link:focus in
       style.css), so keyboard visitors can jump straight past the nav to the
       primary content while sighted mouse users never see it. -->
  <a
    :href="`#${MAIN_CONTENT_ID}`"
    class="skip-link sr-only"
    @click="focusMainContent"
  >
    skip to content
  </a>
</template>
