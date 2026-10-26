import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// The dev server proxies the API to a running `watchwright serve`. The server only accepts
// changes and WebSocket upgrades from its own origin, so the proxy presents that origin.
const SERVER = process.env.WATCHWRIGHT_URL ?? "http://127.0.0.1:7420";

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: fileURLToPath(new URL("../watchwright/dist/web", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: SERVER,
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (req) => req.setHeader("origin", SERVER));
          proxy.on("proxyReqWs", (req) => req.setHeader("origin", SERVER));
        },
      },
    },
  },
});
