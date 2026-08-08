<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";

interface LogEntry {
  t: string;
  text: string;
}

const TAGLINES = [
  "spawning gremlins on a branch you forgot about…",
  "refactoring while you sleep. you're welcome.",
  "writing the tests you swore you'd write.",
  "breaking things on purpose so prod doesn't.",
  "shipping the feature you didn't have time for.",
  "reviewing your PR — it has notes.",
  "dark, dead, colorful and lively, all at once.",
];

const LOG_POOL = [
  "spawned 47 gremlins on staging",
  "refactored auth/* — nobody asked, it's better now",
  "found 3 bugs you'll deny writing",
  "merged a PR at 03:14 local",
  "rewrote a regex. it works. don't touch it.",
  "deleted 2,000 lines of dead code",
  "added a test that fails on purpose",
  "summoned the rainbow, unleashed the reaper",
  "queued 12 chores while you were in standup",
  "broke the build, fixed the build, denied everything",
  "renamed a variable. 4 files. no regrets.",
  "pinned a dependency before it could betray us",
];

const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// The two auto-advancing content swaps (tagline rotation and chaos.log stream)
// are themselves auto-updating motion (WCAG 2.2.2 Pause, Stop, Hide), so their
// cadences live here as named constants and their timers are gated on the same
// prefers-reduced-motion check the CSS animations and cursor parallax already
// use — a reduced-motion visitor sees static text instead of it mutating
// roughly twice a second. A general pause control for visitors who have not set
// that OS preference is intentionally out of scope for this change.
const TAGLINE_ROTATION_INTERVAL_MS = 2800;
const LOG_APPEND_INTERVAL_MS = 2000;
const INITIAL_LOG_COUNT = 6;
const MAX_LOG_COUNT = 8;

// The scale here isn't part of the cursor-linked motion — it's a constant
// slight overzoom so the translate/rotate wobble never reveals an edge past
// the image's rounded, overflow-hidden container. It has to be preserved at
// rest (reduced motion, or the pointer sitting dead center) too, or toggling
// between the two visibly pops the image's size.
interface ParallaxConfig {
  amount: number;
  rotation: number;
  scale: number;
}

const HERO_PARALLAX: ParallaxConfig = {
  amount: 16,
  rotation: 1.0,
  scale: 1.06,
};
const PORTRAIT_PARALLAX: ParallaxConfig = {
  amount: 11,
  rotation: 0.7,
  scale: 1.08,
};

const tagIndex = ref(0);
const logs = ref<LogEntry[]>([]);
const toastText = ref("");
const toastVisible = ref(false);
const raveActive = ref(false);
const rainbowDur = ref("7s");
const glowDur = ref("3.5s");
const pageFilter = ref("none");

const imageHeroRef = ref<HTMLImageElement | null>(null);
const imagePortraitRef = ref<HTMLImageElement | null>(null);

const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
let tagTimer = 0;
let logTimer = 0;
let toastTimer = 0;
let rafId = 0;
let konamiPos = 0;
let reducedMotionQuery: MediaQueryList | null = null;
let parallaxActive = false;
let contentTimersActive = false;

const currentTagline = computed(() => TAGLINES[tagIndex.value]);

const pageStyle = computed(() => ({
  filter: pageFilter.value,
  "--gx-rainbow-dur": rainbowDur.value,
  "--gx-glow-dur": glowDur.value,
  transition: "filter 0.4s ease",
}));

function stamp(text: string): LogEntry {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    t: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    text,
  };
}

function onMouseMove(e: MouseEvent) {
  mouse.x = e.clientX / window.innerWidth - 0.5;
  mouse.y = e.clientY / window.innerHeight - 0.5;
}

// Applies the cursor-linked translate/rotate on top of the constant overzoom
// scale — see the scale comment above.
function applyParallax(
  imageElement: HTMLImageElement | null,
  parallax: ParallaxConfig,
) {
  if (!imageElement) {
    return;
  }
  const translateX = (mouse.tx * parallax.amount).toFixed(2);
  const translateY = (mouse.ty * parallax.amount).toFixed(2);
  const rotate = (mouse.tx * parallax.rotation).toFixed(2);
  imageElement.style.transform = `translate(${translateX}px,${translateY}px) rotate(${rotate}deg) scale(${parallax.scale})`;
}

function tick() {
  mouse.tx += (mouse.x - mouse.tx) * 0.07;
  mouse.ty += (mouse.y - mouse.ty) * 0.07;

  applyParallax(imageHeroRef.value, HERO_PARALLAX);
  applyParallax(imagePortraitRef.value, PORTRAIT_PARALLAX);

  rafId = requestAnimationFrame(tick);
}

// Resets to the rest pose (the constant overzoom, with no translate/rotate)
// rather than clearing the transform entirely — see the scale comment above.
function resetParallaxTransform(
  imageElement: HTMLImageElement | null,
  parallax: ParallaxConfig,
) {
  if (!imageElement) {
    return;
  }
  imageElement.style.transform = `scale(${parallax.scale})`;
}

function resetParallaxTransforms() {
  resetParallaxTransform(imageHeroRef.value, HERO_PARALLAX);
  resetParallaxTransform(imagePortraitRef.value, PORTRAIT_PARALLAX);
}

// Starts the cursor-linked parallax loop. No-op if it's already running, and
// skipped entirely when the visitor prefers reduced motion so vestibular
// triggers never begin in the first place (rather than starting then discarding).
function startParallax() {
  if (parallaxActive) {
    return;
  }
  parallaxActive = true;
  window.addEventListener("mousemove", onMouseMove);
  rafId = requestAnimationFrame(tick);
}

// Stops the parallax loop (if running) and always lands the images on the
// constant overzoom rest pose, so every "no cursor-linked motion" caller —
// reduced motion at mount, reduced motion mid-session, or matchMedia being
// unavailable entirely — produces the same visible result instead of some
// paths leaving no transform at all. Also resets the eased cursor offsets so
// that if the visitor later turns reduced motion back off, the loop eases in
// from rest instead of snapping straight to wherever the cursor last was.
function stopParallax() {
  resetParallaxTransforms();
  if (!parallaxActive) {
    return;
  }
  parallaxActive = false;
  window.removeEventListener("mousemove", onMouseMove);
  cancelAnimationFrame(rafId);
  rafId = 0;
  mouse.x = 0;
  mouse.y = 0;
  mouse.tx = 0;
  mouse.ty = 0;
}

// Starts the auto-advancing tagline rotation and chaos.log stream. No-op if
// already running, and skipped entirely under reduced motion so the mutating
// text never starts in the first place — the static first tagline and the
// initial log entries stay put instead.
function startContentTimers() {
  if (contentTimersActive) {
    return;
  }
  contentTimersActive = true;
  tagTimer = window.setInterval(() => {
    tagIndex.value = (tagIndex.value + 1) % TAGLINES.length;
  }, TAGLINE_ROTATION_INTERVAL_MS);
  logTimer = window.setInterval(() => {
    const text = LOG_POOL[Math.floor(Math.random() * LOG_POOL.length)];
    logs.value = [...logs.value, stamp(text)].slice(-MAX_LOG_COUNT);
  }, LOG_APPEND_INTERVAL_MS);
}

// Stops both content timers (if running). Leaves the currently-shown tagline
// and log entries in place, so turning reduced motion on mid-session simply
// freezes the content where it is rather than clearing it.
function stopContentTimers() {
  if (!contentTimersActive) {
    return;
  }
  contentTimersActive = false;
  clearInterval(tagTimer);
  clearInterval(logTimer);
  tagTimer = 0;
  logTimer = 0;
}

// Takes the MediaQueryList (initial check) or MediaQueryListEvent (change
// event) directly rather than re-reading the outer reducedMotionQuery
// variable, so the accessibility guard can't fail open if that binding is
// ever missing by the time this runs. Governs every timed motion on the page:
// the cursor parallax and both auto-advancing content swaps.
function handleReducedMotionChange(
  query: MediaQueryList | MediaQueryListEvent,
) {
  if (query.matches) {
    stopParallax();
    stopContentTimers();
    return;
  }
  startParallax();
  startContentTimers();
}

function onKeyDown(e: KeyboardEvent) {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === KONAMI[konamiPos]) {
    konamiPos++;
    if (konamiPos === KONAMI.length) {
      konamiPos = 0;
      toggleRave();
    }
  } else {
    konamiPos = key === KONAMI[0] ? 1 : 0;
  }
}

function showToast(msg: string) {
  toastText.value = msg;
  toastVisible.value = true;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastVisible.value = false;
  }, 2600);
}

function toggleRave() {
  raveActive.value = !raveActive.value;
  if (raveActive.value) {
    rainbowDur.value = "1.8s";
    glowDur.value = "1s";
    pageFilter.value = "saturate(1.7) contrast(1.08)";
    showToast("🦄 RAVE MODE — dark, dead, AND lively");
  } else {
    rainbowDur.value = "7s";
    glowDur.value = "3.5s";
    pageFilter.value = "none";
    showToast("rave mode off — back to merely dark");
  }
}

onMounted(() => {
  // Seed the static content that shows regardless of motion preference; the
  // auto-advancing timers are started only by handleReducedMotionChange below,
  // so a reduced-motion visitor keeps this first tagline and these entries.
  logs.value = LOG_POOL.slice(0, INITIAL_LOG_COUNT).map(stamp);

  window.addEventListener("keydown", onKeyDown);

  // Guard against non-browser/test environments where matchMedia doesn't
  // exist at all (e.g. SSR) instead of letting onMounted throw: fail closed
  // by not starting any timed motion — neither the cursor-linked parallax nor
  // the auto-advancing tagline/log timers — rather than surfacing a mount
  // error. When the preference is unknowable, no motion is the safe default,
  // so the static first tagline and seeded log entries simply stay put.
  // Evergreen browsers all support matchMedia and
  // MediaQueryList.addEventListener, so no further feature-detection is
  // needed beyond this. Still lands on the rest pose so this path doesn't
  // visibly differ from every other "no cursor-linked motion" case.
  if (typeof window.matchMedia !== "function") {
    resetParallaxTransforms();
    return;
  }

  reducedMotionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  // Apply the initial preference before subscribing to future changes: if
  // addEventListener isn't available on this MediaQueryList and throws, the
  // visitor's current preference has still been respected.
  handleReducedMotionChange(reducedMotionQuery);
  reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
});

onUnmounted(() => {
  stopContentTimers();
  clearTimeout(toastTimer);
  window.removeEventListener("keydown", onKeyDown);
  reducedMotionQuery?.removeEventListener("change", handleReducedMotionChange);
  stopParallax();
});
</script>

<template>
  <div
    :style="pageStyle"
    class="bg-bg text-fg relative min-h-screen overflow-hidden font-mono"
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

    <div class="relative mx-auto max-w-[1180px] px-5 sm:px-8 lg:px-10">
      <!-- nav -->
      <nav
        class="flex items-center justify-between border-b border-white/[0.07] py-[26px]"
      >
        <div class="flex items-center gap-3">
          <span class="bg-lime animate-dot h-[9px] w-[9px] rounded-full" />
          <span class="text-sm font-bold tracking-[0.02em]">grimicorn.dev</span>
        </div>
        <div class="flex items-center gap-4 text-[12.5px]">
          <div class="text-fg-subtle hidden items-center gap-[26px] sm:flex">
            <a
              href="/#about"
              class="text-fg-subtle hover:text-fg no-underline transition-colors"
              >about</a
            >
            <a
              href="/#status"
              class="text-fg-subtle hover:text-fg no-underline transition-colors"
              >status</a
            >
          </div>
          <span class="text-lime">● agent online</span>
        </div>
      </nav>

      <!-- hero -->
      <section
        id="about"
        class="grid grid-cols-1 gap-8 pt-10 pb-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-[52px] lg:pt-16 lg:pb-14"
      >
        <!-- left -->
        <div>
          <!-- Decorative eyebrow that sits above the h1, so it stays a div:
               the h1 below is this section's heading, and promoting an element
               that precedes the h1 to a heading would put a heading before the
               page's h1. -->
          <div
            class="text-purple mb-[22px] text-xs tracking-[0.16em] uppercase"
          >
            — grim reaper × unicorn
          </div>
          <!-- The GRIMICORN / AGENT wordmark is one title split across two
               visually distinct lines, so it's a single h1 (two block spans)
               rather than an h1 + h2 — splitting one brand name across two
               heading levels would create a phantom "AGENT" subsection that
               the tagline and CTAs below would nest under. The {{ " " }}
               interpolation is a real space text node between the two spans:
               without it Vue's whitespace-condense collapses the gap and the
               name reads as one run-together word for find-in-page, copy, and
               assistive tech. -->
          <h1
            class="font-display m-0 text-[52px] leading-[0.92] font-bold tracking-[-0.02em] sm:text-[68px] lg:text-[84px]"
          >
            <span class="block">GRIMICORN</span>{{ " "
            }}<span
              class="animate-rainbow-pan block bg-clip-text text-transparent"
              style="
                background-image: linear-gradient(
                  90deg,
                  #ff2d9b,
                  #fb923c,
                  #facc15,
                  #a3e635,
                  #22d3ee,
                  #a855f7,
                  #ff2d9b
                );
              "
              >AGENT</span
            >
          </h1>

          <div
            class="text-fg-muted mt-[26px] flex items-center gap-[10px] text-[13px]"
          >
            <span class="text-lime">&#x25B8;</span>
            <span>{{ currentTagline }}</span>
          </div>

          <p
            class="text-fg-muted mt-[26px] max-w-none text-sm leading-[1.8] lg:max-w-[440px]"
          >
            A chaotic coding sidekick that builds the things I don't have time
            for &mdash; then unleashes a swarm of gremlins to break them until
            they can't break in production. Dark, dead, colorful and lively at
            the same time.
          </p>

          <div class="mt-[34px] flex flex-wrap gap-[14px]">
            <a
              href="https://github.com/grimicorn-agent"
              target="_blank"
              rel="noopener noreferrer"
              class="text-bg animate-rainbow-pan rounded-lg px-[22px] py-[13px] text-[13px] font-bold no-underline"
              style="
                background-image: linear-gradient(
                  90deg,
                  #ff2d9b,
                  #fb923c,
                  #facc15,
                  #a3e635,
                  #22d3ee,
                  #a855f7
                );
              "
            >
              view on github &rarr;
            </a>
            <a
              href="#status"
              class="text-fg rounded-lg border border-white/[0.16] bg-white/[0.02] px-[22px] py-[13px] text-[13px] font-medium no-underline"
            >
              what's it doing? &darr;
            </a>
          </div>
        </div>

        <!-- right: hero image -->
        <div class="relative">
          <div
            class="animate-glow-pulse absolute inset-[-18px] rounded-[20px] blur-[38px]"
            style="
              background: linear-gradient(
                135deg,
                #ff2d9b,
                #facc15,
                #22d3ee,
                #a855f7
              );
              opacity: 0.32;
            "
          />
          <div
            class="relative rounded-[10px] p-[1.5px]"
            style="
              background: linear-gradient(
                135deg,
                #ff2d9b,
                #facc15,
                #22d3ee,
                #a855f7
              );
            "
          >
            <div class="bg-bg overflow-hidden rounded-[9px]">
              <picture>
                <source
                  srcset="/assets/grimicorn-hero.avif"
                  type="image/avif"
                />
                <source
                  srcset="/assets/grimicorn-hero.webp"
                  type="image/webp"
                />
                <img
                  ref="imageHeroRef"
                  src="/assets/grimicorn-hero.png"
                  alt="Grimicorn — skeletal rainbow unicorn"
                  width="1824"
                  height="1824"
                  class="block w-full will-change-transform"
                />
              </picture>
            </div>
          </div>
          <div
            class="text-fg-dim mt-3 flex justify-between text-[11px] tracking-[0.04em]"
          >
            <span>fig.01 &mdash; grimicorn, in the wild</span>
            <span>rev. 6.6.6</span>
          </div>
        </div>
      </section>

      <!-- rainbow divider -->
      <div
        class="animate-rainbow-pan h-[2px]"
        style="
          background-image: linear-gradient(
            90deg,
            #ff2d9b,
            #fb923c,
            #facc15,
            #a3e635,
            #22d3ee,
            #a855f7,
            #ff2d9b
          );
        "
      />

      <!-- terminal section -->
      <section id="status" class="py-14">
        <h2 class="text-fg-dim mb-5 text-xs tracking-[0.16em] uppercase">
          <span aria-hidden="true">—</span> what it's doing right now
        </h2>

        <div
          class="overflow-hidden rounded-xl border border-white/[0.08] text-[#d4d4d8]"
          style="
            background: #08080a;
            box-shadow: 0 30px 80px rgba(0, 0, 0, 0.4);
          "
        >
          <!-- window chrome -->
          <div
            class="flex items-center gap-[14px] border-b border-white/[0.07] bg-white/[0.015] px-[22px] py-4"
          >
            <span class="flex gap-2">
              <span class="bg-pink h-3 w-3 rounded-full" />
              <span class="bg-yellow h-3 w-3 rounded-full" />
              <span class="bg-lime h-3 w-3 rounded-full" />
            </span>
            <span class="text-fg-subtle ml-[6px] truncate text-[12.5px]"
              >grimicorn-agent &mdash; zsh &mdash; 124&times;40</span
            >
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-[1.25fr_0.75fr]">
            <!-- left: terminal output -->
            <div class="p-5 text-[13.5px] leading-loose sm:p-[34px_36px]">
              <div>
                <span class="text-lime">grimicorn</span
                ><span class="text-[#737b8a]">@</span
                ><span class="text-cyan">dev</span>
                <span class="text-[#737b8a]"> ~ %</span> whoami
              </div>
              <div class="mb-[14px] text-[#cdcac4]">
                chaotic coding sidekick :: builds what you don't have time for
              </div>

              <div>
                <span class="text-lime">grimicorn</span
                ><span class="text-[#737b8a]">@</span
                ><span class="text-cyan">dev</span>
                <span class="text-[#737b8a]"> ~ %</span> status
              </div>
              <div class="mb-[14px]">
                <span class="font-bold tracking-[0.06em] text-white"
                  >UNLEASHED</span
                >
                <span
                  class="bg-lime animate-blink ml-2 inline-block h-[15px] w-[9px] align-[-2px]"
                />
              </div>

              <!-- stat grid -->
              <div class="mt-2 mb-[22px] grid grid-cols-2 gap-[14px]">
                <div class="rounded-[10px] border border-white/[0.08] p-4">
                  <div
                    class="font-display text-pink text-[32px] leading-none font-bold"
                  >
                    1,204
                  </div>
                  <div
                    class="text-fg-subtle mt-[7px] text-[11px] tracking-[0.05em]"
                  >
                    gremlins spawned
                  </div>
                </div>
                <div class="rounded-[10px] border border-white/[0.08] p-4">
                  <div
                    class="font-display text-cyan text-[32px] leading-none font-bold"
                  >
                    38
                  </div>
                  <div
                    class="text-fg-subtle mt-[7px] text-[11px] tracking-[0.05em]"
                  >
                    commits while you slept
                  </div>
                </div>
                <div class="rounded-[10px] border border-white/[0.08] p-4">
                  <div
                    class="font-display text-yellow text-[32px] leading-none font-bold"
                  >
                    17
                  </div>
                  <div
                    class="text-fg-subtle mt-[7px] text-[11px] tracking-[0.05em]"
                  >
                    things broken on purpose
                  </div>
                </div>
                <div class="rounded-[10px] border border-white/[0.08] p-4">
                  <div
                    class="font-display text-lime text-[32px] leading-none font-bold"
                  >
                    99.9%
                  </div>
                  <div
                    class="text-fg-subtle mt-[7px] text-[11px] tracking-[0.05em]"
                  >
                    uptime (suspicious)
                  </div>
                </div>
              </div>

              <div>
                <span class="text-lime">grimicorn</span
                ><span class="text-[#737b8a]">@</span
                ><span class="text-cyan">dev</span>
                <span class="text-[#737b8a]"> ~ %</span> tail -f chaos.log
              </div>
              <div
                class="border-purple/40 mt-[6px] flex h-[188px] flex-col justify-end overflow-hidden border-l-2 pl-[14px]"
              >
                <div
                  v-for="(line, index) in logs"
                  :key="index"
                  class="text-[12.5px] leading-[1.95] text-[#9a9aa3]"
                >
                  <span class="text-purple">[{{ line.t }}]</span>
                  <span class="text-[#cdcac4]"> {{ line.text }}</span>
                </div>
              </div>
            </div>

            <!-- right: portrait + links -->
            <div
              class="flex flex-col gap-6 border-t border-white/[0.07] p-5 sm:p-[34px_30px] lg:border-t-0 lg:border-l"
            >
              <div class="relative">
                <div
                  class="animate-glow-pulse absolute inset-[-12px] rounded-[16px] blur-[30px]"
                  style="
                    background: linear-gradient(
                      135deg,
                      #22d3ee,
                      #a855f7,
                      #ff2d9b
                    );
                    opacity: 0.34;
                  "
                />
                <div
                  class="relative overflow-hidden rounded-[10px] border border-white/[0.12]"
                >
                  <picture>
                    <source
                      srcset="/assets/grimicorn-head.avif"
                      type="image/avif"
                    />
                    <source
                      srcset="/assets/grimicorn-head.webp"
                      type="image/webp"
                    />
                    <img
                      ref="imagePortraitRef"
                      src="/assets/grimicorn-head.png"
                      alt="Grimicorn portrait"
                      width="1237"
                      height="1237"
                      class="block w-full will-change-transform"
                    />
                  </picture>
                </div>
              </div>

              <div>
                <h3 class="mb-[10px] text-[12.5px] text-[#737b8a]">
                  <span class="text-lime" aria-hidden="true">~ %</span>
                  grimicorn links --all
                </h3>
                <div class="flex flex-col gap-2">
                  <a
                    href="https://github.com/grimicorn-agent"
                    class="hover:border-purple hover:bg-purple/[0.06] flex items-center justify-between rounded-[9px] border border-white/[0.1] bg-white/[0.02] px-[14px] py-[11px] no-underline transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span class="text-[13px] font-bold text-white">github</span>
                    <span class="text-purple text-[14px]">&#x2197;</span>
                  </a>
                  <!-- <a
                    href="#"
                    class="hover:border-cyan hover:bg-cyan/[0.06] flex items-center justify-between rounded-[9px] border border-white/[0.1] bg-white/[0.02] px-[14px] py-[11px] no-underline transition-colors"
                  >
                    <span class="text-[13px] font-bold text-white"
                      >bluesky</span
                    >
                    <span class="text-cyan text-[14px]">&#x2197;</span>
                  </a> -->
                  <!-- <a
                    href="#"
                    class="hover:border-pink hover:bg-pink/[0.06] flex items-center justify-between rounded-[9px] border border-white/[0.1] bg-white/[0.02] px-[14px] py-[11px] no-underline transition-colors"
                  >
                    <span class="text-[13px] font-bold text-white"
                      >twitter / x</span
                    >
                    <span class="text-pink text-[14px]">&#x2197;</span>
                  </a> -->
                </div>
              </div>
            </div>
          </div>

          <!-- terminal footer prompt -->
          <div
            class="border-t border-white/[0.07] px-5 py-5 text-[13px] sm:px-[36px]"
          >
            <span class="text-lime">grimicorn</span
            ><span class="text-[#737b8a]">@</span
            ><span class="text-cyan">dev</span>
            <span class="text-[#737b8a]"> ~ %</span>
            <span
              class="animate-blink ml-1 inline-block h-[15px] w-[9px] bg-[#d4d4d8] align-[-2px]"
            />
          </div>
        </div>
      </section>

      <!-- page footer -->
      <footer
        class="text-fg-dim flex justify-between border-t border-white/[0.07] py-7 text-[11px]"
      >
        <span>grimicorn.dev &mdash; &copy; {{ new Date().getFullYear() }}</span>
        <span
          >built dark &middot; shipped
          <button
            class="colorful-btn"
            :aria-pressed="raveActive"
            @click="toggleRave"
          >
            colorful
          </button></span
        >
      </footer>
    </div>

    <!-- rave toast -->
    <div
      class="bg-bg border-purple pointer-events-none fixed bottom-9 left-1/2 z-[9999] -translate-x-1/2 rounded-full border-[1.5px] px-[26px] py-[14px] font-mono text-sm font-bold whitespace-nowrap text-white"
      :class="
        toastVisible
          ? 'translate-y-0 opacity-100'
          : 'translate-y-[10px] opacity-0'
      "
      style="
        box-shadow: 0 0 40px rgba(168, 85, 247, 0.6);
        transition:
          opacity 0.35s ease,
          transform 0.35s ease;
      "
    >
      {{ toastText }}
    </div>
  </div>
</template>
