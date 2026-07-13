import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // 0.0.0.0 so the dev server is reachable from outside the container,
    // not just from localhost inside it.
    host: true,
    port: 5173,
    strictPort: true,
    // Forward API calls to the backend container by its Compose service
    // name. The browser only ever talks to localhost:5175, so there's no
    // cross-origin request anywhere and the backend needs no CORS handling.
    proxy: {
      "/api": { target: "http://backend:3002", changeOrigin: true },
    },
  },
});
