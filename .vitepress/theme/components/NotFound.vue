<script setup lang="ts">
import { ref, computed, onMounted } from "vue";

const GREMLIN_LINES = [
  "no such page, only gremlins",
  "404 gremlins, 0 pages found",
  "this route was broken on purpose",
  "the unicorn took a wrong turn",
  "page last seen fleeing into the void",
];

const requestedPath = ref("");
const lineIndex = ref(0);

const gremlinLine = computed(() => GREMLIN_LINES[lineIndex.value]);
const displayPath = computed(() => requestedPath.value || "/the-void");

onMounted(() => {
  requestedPath.value = window.location.pathname;
  lineIndex.value = Math.floor(Math.random() * GREMLIN_LINES.length);
});
</script>

<template>
  <div
    class="bg-bg text-fg relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-16 font-mono sm:px-8"
  >
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

    <div class="relative w-full max-w-[680px] text-center">
      <!-- crumb -->
      <div
        class="text-purple mb-6 flex items-center justify-center gap-3 text-xs tracking-[0.16em] uppercase"
      >
        <span class="bg-purple inline-block h-px w-6" />
        error 404 — page not found
        <span class="bg-purple inline-block h-px w-6" />
      </div>

      <!-- big rainbow 404 -->
      <h1
        class="font-display animate-rainbow-pan m-0 bg-clip-text font-bold tracking-[-0.04em] text-transparent select-none"
        style="
          font-size: clamp(6rem, 22vw, 12rem);
          line-height: 0.9;
          background-image: var(--gx-rainbow);
        "
      >
        404
      </h1>

      <!-- headline -->
      <h2
        class="font-display mt-2 mb-5 text-[26px] leading-[1.1] font-bold tracking-[-0.02em] sm:text-[34px]"
      >
        a gremlin ate this page.
      </h2>

      <!-- body -->
      <p class="text-fg-muted mx-auto mb-9 max-w-[440px] text-sm leading-[1.8]">
        The page you wanted got refactored, renamed, or broken on purpose so
        prod wouldn't be. No worries — head back to base and the agent will
        pretend this never happened.
      </p>

      <!-- actions -->
      <div class="mb-12 flex flex-wrap justify-center gap-[14px]">
        <a
          href="/"
          class="text-bg animate-rainbow-pan rounded-lg px-[22px] py-[13px] text-[13px] font-bold no-underline"
          style="background-image: var(--gx-rainbow-cta)"
        >
          &#x25B8; back to home
        </a>
        <a
          href="https://github.com/grimicorn-agent"
          target="_blank"
          rel="noopener noreferrer"
          class="text-fg rounded-lg border border-white/[0.16] bg-white/[0.02] px-[22px] py-[13px] text-[13px] font-medium no-underline"
        >
          view on github &rarr;
        </a>
      </div>

      <!-- terminal trace -->
      <div
        class="mx-auto max-w-[520px] overflow-hidden rounded-xl border border-white/[0.08] text-left text-[13px] leading-loose text-[#d4d4d8]"
        style="background: #08080a; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.4)"
      >
        <div
          class="flex items-center gap-[14px] border-b border-white/[0.07] bg-white/[0.015] px-[18px] py-3"
        >
          <span class="flex gap-2">
            <span class="bg-pink h-3 w-3 rounded-full" />
            <span class="bg-yellow h-3 w-3 rounded-full" />
            <span class="bg-lime h-3 w-3 rounded-full" />
          </span>
          <span class="text-fg-subtle ml-[6px] truncate text-[12.5px]"
            >grimicorn-agent &mdash; zsh</span
          >
        </div>
        <div class="px-[18px] py-4 sm:px-6">
          <div>
            <span class="text-lime">grimicorn</span
            ><span class="text-[#737b8a]">@</span
            ><span class="text-cyan">dev</span>
            <span class="text-[#737b8a]"> ~ %</span> cat
            <span class="text-fg-muted">{{ displayPath }}</span>
          </div>
          <div class="text-[#cdcac4]">
            cat: <span class="text-fg-muted">{{ displayPath }}</span
            >:
            <span class="text-pink">{{ gremlinLine }}</span>
          </div>
          <div>
            <span class="text-lime">grimicorn</span
            ><span class="text-[#737b8a]">@</span
            ><span class="text-cyan">dev</span>
            <span class="text-[#737b8a]"> ~ %</span>
            <span
              class="animate-blink ml-1 inline-block h-[15px] w-[9px] bg-[#d4d4d8] align-[-2px]"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
