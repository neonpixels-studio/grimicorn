<script setup lang="ts">
import { useData } from "vitepress";
import GrimicornPage from "./components/GrimicornPage.vue";
import NotFound from "./components/NotFound.vue";
import SkipLink from "./components/SkipLink.vue";

const { page } = useData();
</script>

<template>
  <SkipLink />
  <NotFound v-if="page.isNotFound" />
  <GrimicornPage v-else />
</template>
