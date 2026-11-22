<script setup lang="ts">
import {
  analyticsAvailable,
  reopenAnalyticsChoice,
} from "../analytics/consent-controller";

// The label privacy.md's copy refers to, so the page and the control agree.
const MANAGE_CHOICE_LABEL = "analytics choice";

defineProps<{ separated?: boolean }>();
</script>

<template>
  <template v-if="analyticsAvailable">
    <template v-if="separated"> &middot; </template>
    <button
      type="button"
      class="hover:text-fg cursor-pointer underline underline-offset-[3px] transition-colors"
      @click="reopenAnalyticsChoice"
    >
      {{ MANAGE_CHOICE_LABEL }}
    </button>
  </template>
</template>
