import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000";
  return ({
  base: "/assessment/",
  envDir: "../..",
  plugins: [react()],
  server: {
    port: 5176,
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
    outDir: "dist",
    emptyOutDir: true,
  },
  });
});
