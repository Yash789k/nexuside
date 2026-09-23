import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: "app.js", assetFileNames: "[name][extname]" },
    },
  },
});
