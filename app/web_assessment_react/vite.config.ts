import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/assessment/",
  envDir: "../..",
  plugins: [react()],
  server: {
    port: 5176,
    proxy: {
      "/auth": "http://127.0.0.1:8000",
      "/config": "http://127.0.0.1:8000",
      "/student": "http://127.0.0.1:8000",
      "/provider": "http://127.0.0.1:8000",
      "/exams": "http://127.0.0.1:8000",
      "/tools": "http://127.0.0.1:8000",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
