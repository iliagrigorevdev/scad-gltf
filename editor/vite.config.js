import { defineConfig } from "vite";
import { copyFileSync, writeFileSync } from "fs";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
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
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      filename: "manifest.webmanifest", // CRITICAL: Prevents overwriting the Chrome Extension manifest.json
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,wasm,hdr,scad}"],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024, // 30MB limit to ensure Wasm & HDR get cached for offline use
      },
      manifest: {
        name: "SCAD Editor",
        short_name: "SCAD Editor",
        description:
          "A modern, web-based editor and 3D viewer for OpenSCAD supporting WebAssembly compilation, PBR materials, skeletal animations, and texture baking.",
        theme_color: "#222222",
        background_color: "#222222",
        display: "standalone",
        // Use "." for relative resolution (safe for generic hosting/extensions),
        id: ".",
        start_url: ".",
        scope: ".",
        icons: [
          {
            src: "icon.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
    {
      name: "copy-extension-files",
      writeBundle() {
        copyFileSync("manifest.json", "dist/manifest.json");
        copyFileSync("src/content.css", "dist/content.css");
        writeFileSync(
          "dist/content-loader.js",
          `// Workaround for Chrome Extension ES modules
(async () => {
  await import(chrome.runtime.getURL("content.js"));
})();`,
        );
      },
    },
  ],
});
