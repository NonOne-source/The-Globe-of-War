import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During local dev, Vite serves the React app on its own port. API and WebSocket
// requests are proxied to `wrangler dev`, which runs the Worker + Durable Object
// locally. Run both `npm run dev` (Vite) and `npx wrangler dev` (Worker) side by side,
// see README.md for the exact commands.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/room": {
        target: "ws://127.0.0.1:8787",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
