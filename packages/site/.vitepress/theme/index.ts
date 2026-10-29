import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import SupportButtons from "./components/SupportButtons.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("SupportButtons", SupportButtons);
  },
} satisfies Theme;
