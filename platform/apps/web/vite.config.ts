import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5177,
    host: "127.0.0.1",
    proxy: {
      // Same-origin in the browser, so no CORS and nothing leaves the machine.
      "/trpc": { target: "http://127.0.0.1:5178", changeOrigin: false },
      // Present so the login gate can be exercised in development too, by setting
      // AVILO_PASSWORD before `pnpm dev`. Unused when the gate is off.
      "/login": { target: "http://127.0.0.1:5178", changeOrigin: false },
      "/auth": { target: "http://127.0.0.1:5178", changeOrigin: false },
    },
  },
  build: {
    // Everything is bundled: the application must run with the network switched off.
    assetsInlineLimit: 0,
    target: "es2022",
  },
});
