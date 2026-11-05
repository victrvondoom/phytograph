import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The browser only talks to this origin. /api is proxied to the FastAPI backend, so the
// browser never makes third-party requests and no secrets are shipped to the client.
const apiTarget = process.env.VANASIGNAL_API ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": { target: apiTarget, changeOrigin: false } } },
  preview: { proxy: { "/api": { target: apiTarget, changeOrigin: false } } },
});
