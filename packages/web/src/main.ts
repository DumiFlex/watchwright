import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
import { applyTheme, browserStore, loadTheme } from "./theme";

// Put the saved theme on <html> before the first render.
applyTheme(document.documentElement, loadTheme(browserStore()));

createApp(App).mount("#app");
