import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  const surface = env.VITE_APP_SURFACE === "candidate" || mode === "candidate" ? "candidate" : "recruiter";
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000";
  return ({
  base: surface === "candidate" ? "/" : "/assessment/",
  envDir: "../..",
  plugins: [
    react(),
    // In candidate dev mode, rewrite the root to candidate.html so that
    // visiting / loads the candidate entry point (mirrors the production
    // finalize-candidate-build.mjs rename).
    ...(surface === "candidate" ? [{
      name: "candidate-html-rewrite",
      configureServer(server: import("vite").ViteDevServer) {
        server.middlewares.use((req, _res, next) => {
          if (req.url && (req.url === "/" || req.url.startsWith("/?") || req.url.startsWith("/index.html"))) {
            req.url = req.url.replace(/^\/(index\.html)?/, "/candidate.html");
          }
          next();
        });
      },
    }] : []),
  ],
  server: {
    watch: {
      ignored: [
        "**/public/vendor/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/dist-candidate/**"
      ]
    },
    host: "127.0.0.1",
    port: surface === "candidate" ? 5178 : 8888,
    strictPort: true,
    proxy: {
      "/auth": apiTarget,
      "/config": apiTarget,
      "/student": apiTarget,
      "/provider": apiTarget,
      "/exams": apiTarget,
      "/admin": apiTarget,
      "/hiring": apiTarget,
      "/billing": apiTarget,
      "/desktop-sessions": apiTarget,
      "/proctoring": apiTarget,
      "/tools": apiTarget,
    },
  },
  build: {
    outDir: surface === "candidate" ? "dist-candidate" : "dist",
    emptyOutDir: true,
    // Coding and spreadsheet workspaces are intentionally lazy-loaded. Their
    // Monaco language workers and spreadsheet engine are isolated from the
    // hiring/candidate entry bundle, so the generic 500 kB warning is not a
    // useful signal for this multi-workspace application.
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      input: resolve(projectDirectory, surface === "candidate" ? "candidate.html" : "index.html"),
    },
  },
  });
});
