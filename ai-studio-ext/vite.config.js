import { defineConfig } from "vite";
import { copyFileSync } from "fs";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: "index.html",
        preview: "preview.html",
        content: "src/content.js",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
  plugins: [
    {
      name: "copy-extension-files",
      writeBundle() {
        copyFileSync("manifest.json", "dist/manifest.json");
        copyFileSync("src/content.css", "dist/content.css");
      },
    },
  ],
});
