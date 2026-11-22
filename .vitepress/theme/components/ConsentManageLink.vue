<script setup lang="ts">
import { MANAGE_CHOICE_LABEL } from "../constants";
import {
  analyticsAvailable,
  reopenAnalyticsChoice,
} from "../analytics/consent-controller";

defineProps<{ separated?: boolean }>();
</script>

<template>
  <template v-if="analyticsAvailable">
    <template v-if="separated"> &middot; </template>
    <button
      type="button"
      class="hover:text-fg cursor-pointer underline underline-offset-[3px] transition-colors"
      @click="reopenAnalyticsChoice($event.currentTarget as Element)"
    >
      {{ MANAGE_CHOICE_LABEL }}
    </button>
  </template>
</template>
