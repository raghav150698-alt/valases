import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  const surface = env.VITE_APP_SURFACE === "candidate" || mode === "candidate" ? "candidate" : "recruiter";
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000";
  return ({
  base: surface === "candidate" ? "/" : "/assessment/",
  envDir: "../..",
  plugins: [react()],
  server: {
    port: surface === "candidate" ? 5178 : 5176,
    proxy: {
      "/auth": apiTarget,
      "/config": apiTarget,
      "/student": apiTarget,
      "/provider": apiTarget,
      "/exams": apiTarget,
      "/tools": apiTarget,
    },
  },
  build: {
    outDir: surface === "candidate" ? "dist-candidate" : "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, surface === "candidate" ? "candidate.html" : "index.html"),
    },
  },
  });
});
