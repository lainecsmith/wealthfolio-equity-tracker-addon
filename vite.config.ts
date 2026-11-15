import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  define: {
    // Stub Node globals — addon runs in a sandboxed browser context
    "process.env.NODE_ENV": JSON.stringify("production"),
    process: JSON.stringify({ env: { NODE_ENV: "production" } }),
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/addon.tsx"),
      formats: ["es"],
      fileName: "addon",
    },
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "@wealthfolio/addon-sdk",
        "@wealthfolio/ui",
        "@tanstack/react-query",
      ],
    },
    outDir: "dist",
    minify: false,
    sourcemap: true,
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
