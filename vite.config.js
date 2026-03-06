import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // During local dev: "vercel dev" runs on 3000, Vite on 5173
      // So proxy /api/* → vercel dev server
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
