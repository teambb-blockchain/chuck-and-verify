import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The signed-in dashboard. `npm run build` writes it to /portal at the repo
// root, which nginx serves as static files (only /api/ reaches Node). Not
// /dashboard: Node maps a bare /dashboard to the /api/dashboard route.
// Built file names carry a content hash, so Cloudflare's cache can't serve a
// stale copy after a deploy. Commit the rebuilt /portal with source changes.
export default defineConfig({
  base: "/portal/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../../portal",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
