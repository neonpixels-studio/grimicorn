import type { Theme } from "vitepress";
import AppLayout from "./AppLayout.vue";
import "./fonts.css";
import "./style.css";

export default {
  Layout: AppLayout,
  enhanceApp() {},
} satisfies Theme;
