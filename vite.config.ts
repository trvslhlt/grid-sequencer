import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // 0.0.0.0 so the dev server is reachable from outside the container,
    // not just from localhost inside it.
    host: true,
    port: 5173,
    strictPort: true,
  },
});
